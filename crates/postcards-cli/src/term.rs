//! The draw's progress in the terminal. What the lines say comes from the
//! core's [`Board`], the same one the page shows; this only paints them.
//!
//! On a terminal the lines are redrawn in place a dozen times a second, the
//! tree on top and the logs under it. When stderr is a file or a pipe escape
//! codes would only litter it, so each task prints one plain line when it
//! ends and each log when it comes.

use postcards_core::board::{plain, Board, Line};
use postcards_core::progress::{Event, Progress};
use std::io::{IsTerminal, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const DIM: &str = "\x1b[2m";
const BOLD: &str = "\x1b[1m";
const RESET: &str = "\x1b[0m";

struct Screen {
    board: Board,
    /// Lines the last redraw printed, to climb back over.
    drawn: usize,
    last: Option<Instant>,
}

pub struct Term {
    screen: Arc<Mutex<Screen>>,
    clock: Instant,
    live: bool,
    ticker: Mutex<Option<std::thread::JoinHandle<()>>>,
    stop: Arc<AtomicBool>,
    finished: AtomicBool,
}

impl Term {
    pub fn new() -> Term {
        let live = std::io::stderr().is_terminal();
        let clock = Instant::now();
        let screen = Arc::new(Mutex::new(Screen { board: Board::new(), drawn: 0, last: None }));
        let stop = Arc::new(AtomicBool::new(false));
        // Spinners and sliding bars move with time, not with events.
        let ticker = live.then(|| {
            let (screen, stop) = (screen.clone(), stop.clone());
            std::thread::spawn(move || {
                while !stop.load(Ordering::Relaxed) {
                    std::thread::sleep(Duration::from_millis(80));
                    let mut s = screen.lock().unwrap();
                    if s.board.running() {
                        redraw(&mut s, clock);
                    }
                }
            })
        });
        Term { screen, clock, live, ticker: Mutex::new(ticker), stop, finished: AtomicBool::new(false) }
    }

    /// Draw the final state once and leave it on screen: whatever is printed
    /// next goes below it.
    pub fn finish(&self) {
        if self.finished.swap(true, Ordering::Relaxed) {
            return;
        }
        self.stop.store(true, Ordering::Relaxed);
        if let Some(t) = self.ticker.lock().unwrap().take() {
            let _ = t.join();
        }
        if self.live {
            let mut s = self.screen.lock().unwrap();
            redraw(&mut s, self.clock);
            s.drawn = 0;
        }
    }
}

impl Drop for Term {
    fn drop(&mut self) {
        self.finish();
    }
}

impl Progress for Term {
    fn event(&self, event: Event) {
        let mut s = self.screen.lock().unwrap();
        s.board.apply(event, self.clock.elapsed().as_secs_f64());
        if !self.live {
            let lines = match event {
                Event::End { id, .. } => s.board.ended_line(id).into_iter().collect(),
                Event::Log { .. } => s.board.last_log_lines(),
                _ => Vec::new(),
            };
            for line in &lines {
                eprintln!("{}", plain(line));
            }
            return;
        }
        // Ends, new rows and logs show at once; counts at most every 30 ms.
        let urgent = matches!(event, Event::Begin { .. } | Event::End { .. } | Event::Log { .. });
        if urgent || s.last.is_none_or(|t| t.elapsed() > Duration::from_millis(30)) {
            redraw(&mut s, self.clock);
        }
    }
}

fn redraw(s: &mut Screen, clock: Instant) {
    s.last = Some(Instant::now());
    let layout = s.board.layout(clock.elapsed().as_secs_f64());
    let (cols, rows) = screen();
    // The logs stay in sight; if the screen is short, the top of the tree
    // scrolls off first.
    let room = rows.saturating_sub(layout.logs.len()).max(1);
    let skip = layout.tree.len().saturating_sub(room);
    let lines: Vec<String> =
        layout.tree.iter().skip(skip).chain(&layout.logs).map(|l| clip(&paint(l), cols.saturating_sub(1))).collect();

    let mut err = std::io::stderr().lock();
    if s.drawn > 0 {
        let _ = write!(err, "\x1b[{}F", s.drawn);
    }
    let _ = write!(err, "\x1b[J");
    for line in &lines {
        let _ = writeln!(err, "{line}");
    }
    let _ = err.flush();
    s.drawn = lines.len();
}

fn paint(line: &Line) -> String {
    let mut out = String::new();
    for run in line {
        match (run.dim, run.bold) {
            (false, false) => out.push_str(&run.text),
            (dim, bold) => {
                out.push_str(if bold { BOLD } else { "" });
                out.push_str(if dim { DIM } else { "" });
                out.push_str(&run.text);
                out.push_str(RESET);
            }
        }
    }
    out
}

/// `line` cut to `cols` visible characters, escape codes kept whole: a line
/// that wrapped would throw off the climb back up on the next redraw.
fn clip(line: &str, cols: usize) -> String {
    let mut out = String::with_capacity(line.len());
    let (mut seen, mut chars) = (0, line.chars());
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            out.push(c);
            for c in chars.by_ref() {
                out.push(c);
                if c.is_ascii_alphabetic() {
                    break;
                }
            }
            continue;
        }
        if seen == cols {
            out.push('…');
            out.push_str(RESET);
            break;
        }
        out.push(c);
        seen += 1;
    }
    out
}

/// Columns and rows of the terminal behind stderr.
fn screen() -> (usize, usize) {
    #[cfg(unix)]
    unsafe {
        let mut ws: libc::winsize = std::mem::zeroed();
        if libc::ioctl(2, libc::TIOCGWINSZ, &mut ws) == 0 && ws.ws_col > 0 && ws.ws_row > 0 {
            return (ws.ws_col as usize, ws.ws_row as usize - 1);
        }
    }
    (100, 40)
}
