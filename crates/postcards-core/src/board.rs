//! The progress tree as lines to show, from the events in [`crate::progress`].
//!
//! Every display of a draw, the terminal and the page, applies the same
//! events to a `Board` and paints the lines it lays out. What a row says,
//! when it has a bar and what kind, how the tree is drawn: all decided here,
//! once. A line is a list of runs of text marked dim or bold, nothing more;
//! turning that into escape codes or HTML, and redrawing it, is the display's.
//!
//! The rules:
//! - a bar is only for a quantity: a count fills it, something arriving in
//!   `bytes` with no known size slides;
//! - a row with rows under it is a section title: no bar, no details, only a
//!   word on what has no row of its own (a wait, why it failed);
//! - one spinner per branch, on its top running row;
//! - a failed row stays, as a ✗ with no bar;
//! - after the bar, what was done, then how long it took;
//! - the logs go under the tree, newest last.
//!
//! Time is whatever clock the display has, in seconds: the core has none of
//! its own (a page's WASM cannot read the system's).

use crate::progress::{thousands, Event, Level};

/// Cells in a bar.
pub const WIDTH: usize = 20;
const SPIN: [char; 10] = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
/// Log lines laid out; older ones are counted in the title.
const LOGS_SHOWN: usize = 8;

/// A piece of a line.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Run {
    pub text: String,
    pub dim: bool,
    pub bold: bool,
}

impl Run {
    fn new(text: impl Into<String>) -> Run {
        Run { text: text.into(), ..Run::default() }
    }

    fn dim(text: impl Into<String>) -> Run {
        Run { text: text.into(), dim: true, bold: false }
    }

    fn bold(mut self, bold: bool) -> Run {
        self.bold |= bold;
        self
    }
}

pub type Line = Vec<Run>;

/// A line's text, without its marks.
pub fn plain(line: &Line) -> String {
    line.iter().map(|r| r.text.as_str()).collect()
}

/// The board laid out: the tree's lines, then the logs' (title first).
pub struct Layout {
    pub tree: Vec<Line>,
    pub logs: Vec<Line>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum State {
    Run,
    Ok,
    Fail,
}

struct Row {
    id: String,
    parent: Option<String>,
    label: String,
    total: u64,
    done: u64,
    unit: String,
    state: State,
    note: String,
    t0: f64,
    secs: f64,
}

struct Log {
    level: Level,
    at: f64,
    text: String,
}

/// Events applied, ready to lay out.
#[derive(Default)]
pub struct Board {
    t0: Option<f64>,
    rows: Vec<Row>,
    logs: Vec<Log>,
}

impl Board {
    pub fn new() -> Board {
        Board::default()
    }

    /// Apply `event`, which happened at `now`.
    pub fn apply(&mut self, event: Event, now: f64) {
        let t0 = *self.t0.get_or_insert(now);
        match event {
            Event::Begin { id, parent, label, total, unit } => {
                let row = Row {
                    id: id.into(),
                    parent: parent.map(Into::into),
                    label: label.into(),
                    total,
                    done: 0,
                    unit: unit.into(),
                    state: State::Run,
                    note: String::new(),
                    t0: now,
                    secs: 0.0,
                };
                // A child goes after everything already under its parent.
                let at = match parent.and_then(|p| self.rows.iter().position(|r| r.id == p)) {
                    Some(p) => {
                        let mut at = p + 1;
                        while at < self.rows.len() && ancestors(&self.rows, at).contains(&p) {
                            at += 1;
                        }
                        at
                    }
                    None => self.rows.len(),
                };
                self.rows.insert(at, row);
            }
            Event::Total { id, total } => {
                if let Some(r) = self.row_mut(id) {
                    r.total = total;
                }
            }
            Event::Step { id, done, note } => {
                if let Some(r) = self.row_mut(id) {
                    r.done = done;
                    r.note = note.into();
                }
            }
            Event::End { id, ok, note } => {
                if let Some(r) = self.row_mut(id).filter(|r| r.state == State::Run) {
                    r.state = if ok { State::Ok } else { State::Fail };
                    r.secs = now - r.t0;
                    if ok && r.total > 0 {
                        r.done = r.total;
                    }
                    // "Doing X now" is over once it ends well; a failure
                    // keeps it, as where it stopped.
                    if ok || !note.is_empty() {
                        r.note = note.into();
                    }
                }
            }
            Event::Log { level, text } => self.logs.push(Log { level, at: now - t0, text: text.into() }),
        }
    }

    /// End whatever still runs as failed: the draw stopped under it.
    pub fn fail_running(&mut self, now: f64) {
        for r in self.rows.iter_mut().filter(|r| r.state == State::Run) {
            r.state = State::Fail;
            r.secs = now - r.t0;
        }
    }

    pub fn running(&self) -> bool {
        self.rows.iter().any(|r| r.state == State::Run)
    }

    fn row_mut(&mut self, id: &str) -> Option<&mut Row> {
        self.rows.iter_mut().find(|r| r.id == id)
    }

    fn has_children(&self, i: usize) -> bool {
        self.rows.iter().any(|c| c.parent.as_deref() == Some(&self.rows[i].id))
    }

    /// The tree and the logs as they look at `now`.
    pub fn layout(&self, now: f64) -> Layout {
        let rows = &self.rows;
        let labels: Vec<String> = (0..rows.len()).map(|i| format!("{}{}", branches(rows, i), rows[i].label)).collect();
        let label_w = labels.iter().map(|l| l.chars().count()).max().unwrap_or(0).max(9);
        let spin = SPIN[(now * 1000.0 / 80.0).max(0.0) as usize % SPIN.len()];

        let tree = rows
            .iter()
            .enumerate()
            .map(|(i, r)| {
                let (bar, words) = meter(r, now, self.has_children(i));
                // One spinner per branch: under a running row, its bars move.
                let under_running = ancestors(rows, i).iter().any(|&a| rows[a].state == State::Run);
                let mark = match r.state {
                    State::Ok => '✓',
                    State::Fail => '✗',
                    State::Run if under_running => ' ',
                    State::Run => spin,
                };
                let fail = r.state == State::Fail;
                let pad = " ".repeat(label_w - labels[i].chars().count());
                let mut line = vec![Run::new(format!("{mark} {}{pad}  ", labels[i])).bold(fail)];
                line.extend(bar.into_iter().map(|run| run.bold(fail)));
                if !words.is_empty() {
                    let words = format!(" {words}");
                    line.push(if r.state == State::Ok { Run::dim(words) } else { Run::new(words).bold(fail) });
                }
                trim(line)
            })
            .collect();

        let mut logs = Vec::new();
        let lines: Vec<Line> = self.logs.iter().flat_map(log_lines).collect();
        if !lines.is_empty() {
            let skip = lines.len().saturating_sub(LOGS_SHOWN);
            let title = if skip > 0 { format!(" logs · {skip} earlier ") } else { " logs ".into() };
            let rule = "─".repeat((label_w + WIDTH + 30).saturating_sub(title.chars().count() + 2));
            logs.push(vec![Run::dim(format!("──{title}{rule}"))]);
            logs.extend(lines.into_iter().skip(skip));
        }
        Layout { tree, logs }
    }

    /// Row `id` on one line with no bar, for a display that cannot redraw
    /// (a file, a pipe): printed once, when the row ends.
    pub fn ended_line(&self, id: &str) -> Option<Line> {
        let i = self.rows.iter().position(|r| r.id == id)?;
        let r = &self.rows[i];
        let (_, words) = meter(r, r.t0 + r.secs, self.has_children(i));
        let mark = if r.state == State::Ok { '✓' } else { '✗' };
        let indent = "  ".repeat(ancestors(&self.rows, i).len());
        Some(trim(vec![Run::new(format!("{mark} {indent}{}  {words}", r.label))]))
    }

    /// The newest log entry's lines, for a display that cannot redraw.
    pub fn last_log_lines(&self) -> Vec<Line> {
        self.logs.last().map(log_lines).unwrap_or_default()
    }
}

fn parent_of(rows: &[Row], i: usize) -> Option<usize> {
    let p = rows[i].parent.as_deref()?;
    rows.iter().position(|r| r.id == p)
}

/// Rows above `i`, the root first.
fn ancestors(rows: &[Row], i: usize) -> Vec<usize> {
    let mut out = Vec::new();
    let mut at = i;
    while let Some(p) = parent_of(rows, at) {
        out.push(p);
        at = p;
    }
    out.reverse();
    out
}

fn has_later_sibling(rows: &[Row], i: usize) -> bool {
    rows[i + 1..].iter().any(|r| r.parent == rows[i].parent)
}

/// The tree's drawing in front of row `i`: a rail for every level above that
/// still has rows to come, then the row's own branch.
fn branches(rows: &[Row], i: usize) -> String {
    let above = ancestors(rows, i);
    if above.is_empty() {
        return String::new();
    }
    let mut out = String::new();
    for &a in &above[1..] {
        out.push_str(if has_later_sibling(rows, a) { "│ " } else { "  " });
    }
    out.push_str(if has_later_sibling(rows, i) { "├ " } else { "└ " });
    out
}

/// The bar and the words after it.
fn meter(r: &Row, now: f64, parent: bool) -> (Vec<Run>, String) {
    if parent {
        let words = if r.state == State::Ok { String::new() } else { r.note.clone() };
        return (vec![Run::new(" ".repeat(WIDTH))], words);
    }
    let secs = if r.state == State::Run { (now - r.t0).max(0.0) } else { r.secs };
    let count = match (r.unit.as_str(), r.total) {
        ("bytes", 0) => (r.done > 0).then(|| format!("{} MB", mb(r.done))),
        ("bytes", total) => Some(format!("{}/{} MB", mb(r.done), mb(total))),
        (_, 0 | 1) => None,
        (unit, total) => Some(format!("{}/{} {unit}", thousands(r.done), thousands(total)).trim_end().to_string()),
    };
    let note = (!r.note.is_empty()).then(|| r.note.clone());
    let mut words: Vec<String> = [count, note].into_iter().flatten().collect();
    words.push(format!("{secs:.1} s"));

    let bar = match r.state {
        State::Run if r.total > 0 => bar(r.done as f64 / r.total as f64),
        State::Run if r.unit == "bytes" => bounce(secs),
        State::Ok if r.total > 0 || r.unit == "bytes" => bar(1.0),
        _ => vec![Run::new(" ".repeat(WIDTH))],
    };
    (bar, words.join(" · "))
}

fn mb(bytes: u64) -> String {
    format!("{:.1}", bytes as f64 / 1e6)
}

fn bar(frac: f64) -> Vec<Run> {
    let n = (frac.clamp(0.0, 1.0) * WIDTH as f64).round() as usize;
    vec![Run::new("█".repeat(n)), Run::dim("░".repeat(WIDTH - n))]
}

/// A block sliding to and fro, for something arriving with no known size.
fn bounce(secs: f64) -> Vec<Run> {
    let w = WIDTH / 4;
    let span = WIDTH - w;
    let step = ((secs * 1000.0) / 70.0) as usize % (2 * span);
    let at = if step < span { step } else { 2 * span - step };
    vec![Run::dim("░".repeat(at)), Run::new("█".repeat(w)), Run::dim("░".repeat(span - at))]
}

fn log_lines(log: &Log) -> Vec<Line> {
    let mark = match log.level {
        Level::Info => ' ',
        Level::Warn => '!',
        Level::Error => '✗',
    };
    log.text
        .lines()
        .map(|text| {
            let text = format!("{:>6.1} s  {mark} {text}", log.at);
            vec![match log.level {
                Level::Info => Run::dim(text),
                Level::Warn => Run::new(text),
                Level::Error => Run::new(text).bold(true),
            }]
        })
        .collect()
}

/// `line` without trailing blanks, so a title row ends at its label.
fn trim(mut line: Line) -> Line {
    while let Some(last) = line.last_mut() {
        let kept = last.text.trim_end().len();
        last.text.truncate(kept);
        if !last.text.is_empty() {
            break;
        }
        line.pop();
    }
    line
}

#[cfg(test)]
mod tests {
    use super::*;

    fn begin<'a>(id: &'a str, parent: Option<&'a str>, label: &'a str, total: u64, unit: &'a str) -> Event<'a> {
        Event::Begin { id, parent, label, total, unit }
    }

    #[test]
    fn rows_follow_the_rules() {
        let mut b = Board::new();
        b.apply(begin("download", None, "download", 0, ""), 0.0);
        b.apply(begin("try-a", Some("download"), "OSM from a", 0, "bytes"), 0.0);
        b.apply(Event::End { id: "try-a", ok: false, note: "504 gateway timeout" }, 1.0);
        b.apply(begin("try-b", Some("download"), "OSM from b", 0, "bytes"), 1.0);
        b.apply(Event::Step { id: "try-b", done: 1_500_000, note: "" }, 2.0);
        let running = b.layout(2.0);
        let text: Vec<String> = running.tree.iter().map(plain).collect();
        assert!(text[0].starts_with('⠋') || SPIN.contains(&text[0].chars().next().unwrap()));
        assert_eq!(text[0].trim_end(), text[0], "a title has no trailing blanks");
        assert!(text[1].starts_with("✗ ├ OSM from a") && text[1].ends_with("504 gateway timeout · 1.0 s"));
        assert!(text[2].starts_with("  └ OSM from b"), "no spinner under a running title: {}", text[2]);
        assert!(text[2].contains('█') && text[2].contains("1.5 MB · 1.0 s"));

        b.apply(Event::End { id: "try-b", ok: true, note: "" }, 3.0);
        b.apply(begin("fill", Some("download"), "fill", 1, "pieces"), 3.0);
        b.apply(Event::End { id: "fill", ok: true, note: "8 lines" }, 3.5);
        b.apply(Event::End { id: "download", ok: true, note: "" }, 3.5);
        b.apply(Event::Log { level: Level::Warn, text: "a busy · trying b" }, 3.5);
        let done = b.layout(4.0);
        let text: Vec<String> = done.tree.iter().map(plain).collect();
        assert_eq!(text[0], "✓ download", "a finished title says nothing");
        assert!(text[3].ends_with("█ 8 lines · 0.5 s"), "a single step: a bar, no count: {}", text[3]);
        assert_eq!(plain(&done.logs[1]), "   3.5 s  ! a busy · trying b");
        assert_eq!(plain(&b.ended_line("try-a").unwrap()), "✗   OSM from a  504 gateway timeout · 1.0 s");
    }
}
