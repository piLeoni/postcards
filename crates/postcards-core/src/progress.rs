//! What a draw is doing while it runs, for a progress display.
//!
//! A draw is a tree of tasks. A task with a `total` counts something it
//! knows the size of (the total may grow as it learns more), and a display
//! fills a bar; a total of 1 is a single step, a bar with no count written. A task in `bytes` with no total is receiving something it
//! cannot size yet, off the network, and a display shows motion rather than
//! a guess. Any other task with no total is just running: a spinner and the
//! time. Next to the tree runs a log of what went wrong.
//!
//! The command line draws these events in the terminal; the page receives
//! the very same events from the WASM build and draws them in its loading
//! card. Whatever one shows, the other shows.

use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Level {
    Info,
    Warn,
    Error,
}

impl Level {
    pub fn as_str(self) -> &'static str {
        match self {
            Level::Info => "info",
            Level::Warn => "warn",
            Level::Error => "error",
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub enum Event<'a> {
    /// A task begins, under `parent` when it is part of another. `total` is
    /// 0 when it has nothing to count.
    Begin { id: &'a str, parent: Option<&'a str>, label: &'a str, total: u64, unit: &'a str },
    /// It found out there is more (or less) to do.
    Total { id: &'a str, total: u64 },
    /// `done` of its total so far, and what it is doing now.
    Step { id: &'a str, done: u64, note: &'a str },
    /// Finished, well or not, with a word on how.
    End { id: &'a str, ok: bool, note: &'a str },
    Log { level: Level, text: &'a str },
}

/// Told of every event, from whichever thread has it.
pub trait Progress: Sync {
    fn event(&self, event: Event);
}

/// Nobody watching.
impl Progress for () {
    fn event(&self, _: Event) {}
}

/// Steps a counted task reports over its whole run. A fill over 5,000
/// buildings ticks 5,000 times; a display only needs to hear of a few of them.
const STEPS: u64 = 100;

/// A running task. Ends as failed if dropped without `ok`, so an early `?`
/// return does not leave a bar spinning.
pub struct Task<'p> {
    progress: &'p dyn Progress,
    id: String,
    total: AtomicU64,
    done: AtomicU64,
    ended: std::sync::atomic::AtomicBool,
}

impl<'p> Task<'p> {
    pub fn begin(progress: &'p dyn Progress, id: &str, parent: Option<&str>, label: &str, total: u64, unit: &str) -> Self {
        progress.event(Event::Begin { id, parent, label, total, unit });
        Task {
            progress,
            id: id.to_string(),
            total: AtomicU64::new(total),
            done: AtomicU64::new(0),
            ended: Default::default(),
        }
    }

    /// A task under this one.
    pub fn child(&self, id: &str, label: &str, total: u64, unit: &str) -> Task<'p> {
        Task::begin(self.progress, id, Some(&self.id), label, total, unit)
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn set_total(&self, total: u64) {
        self.total.store(total, Ordering::Relaxed);
        self.progress.event(Event::Total { id: &self.id, total });
    }

    /// One more done; safe from many threads at once.
    pub fn tick(&self) {
        let done = self.done.fetch_add(1, Ordering::Relaxed) + 1;
        let total = self.total.load(Ordering::Relaxed);
        let every = (total / STEPS).max(1);
        if done % every == 0 || done == total {
            self.progress.event(Event::Step { id: &self.id, done, note: "" });
        }
    }

    /// `done` so far, and what it is doing now.
    pub fn step(&self, done: u64, note: &str) {
        self.done.store(done, Ordering::Relaxed);
        self.progress.event(Event::Step { id: &self.id, done, note });
    }

    /// What it is doing now, without a count.
    pub fn note(&self, note: &str) {
        let done = self.done.load(Ordering::Relaxed);
        self.progress.event(Event::Step { id: &self.id, done, note });
    }

    pub fn log(&self, level: Level, text: &str) {
        self.progress.event(Event::Log { level, text });
    }

    pub fn ok(self, note: &str) {
        self.end(true, note);
    }

    pub fn fail(self, note: &str) {
        self.end(false, note);
    }

    fn end(&self, ok: bool, note: &str) {
        if !self.ended.swap(true, Ordering::Relaxed) {
            self.progress.event(Event::End { id: &self.id, ok, note });
        }
    }
}

impl Drop for Task<'_> {
    fn drop(&mut self) {
        self.end(false, "");
    }
}

/// "1,234,567".
pub fn thousands(n: u64) -> String {
    let s = n.to_string();
    let mut out = String::new();
    for (i, c) in s.chars().enumerate() {
        if i > 0 && (s.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[derive(Default)]
    struct Record(Mutex<Vec<String>>);

    impl Progress for Record {
        fn event(&self, e: Event) {
            let line = match e {
                Event::Begin { id, parent, total, .. } => format!("begin {id} {parent:?} {total}"),
                Event::Total { id, total } => format!("total {id} {total}"),
                Event::Step { id, done, .. } => format!("step {id} {done}"),
                Event::End { id, ok, .. } => format!("end {id} {ok}"),
                Event::Log { text, .. } => format!("log {text}"),
            };
            self.0.lock().unwrap().push(line);
        }
    }

    #[test]
    fn ticks_are_thinned_and_drop_fails() {
        let rec = Record::default();
        {
            let t = Task::begin(&rec, "fill", None, "fill", 1000, "");
            for _ in 0..1000 {
                t.tick();
            }
            let c = t.child("a", "a", 0, "");
            c.ok("");
            let _left = t.child("b", "b", 0, "");
        }
        let lines = rec.0.lock().unwrap();
        let steps = lines.iter().filter(|l| l.starts_with("step fill")).count();
        assert_eq!(steps, 100);
        assert!(lines.contains(&"begin a Some(\"fill\") 0".to_string()));
        assert!(lines.contains(&"end b false".to_string()));
        assert!(lines.contains(&"end fill false".to_string()));
        assert_eq!(thousands(1234567), "1,234,567");
    }
}
