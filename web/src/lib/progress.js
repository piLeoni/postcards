/**
 * The download's progress events, sent from the worker: the page's twin of
 * the core's `Task` (`drawland-core/src/progress.rs`), with the same
 * `begin`, `total`, `step`, `end` and `log` events the engine sends for the
 * drawing. The page applies both to the engine's `Board`, which decides how
 * every row reads, for the page as for the terminal.
 */
export class Task {
  static begin(emit, id, parent, label, total = 0, unit = '') {
    emit({ kind: 'begin', id, parent, label, total, unit })
    return new Task(emit, id)
  }

  constructor(emit, id) {
    this.emit = emit
    this.id = id
    this.done = 0
  }

  child(id, label, total = 0, unit = '') {
    return Task.begin(this.emit, id, this.id, label, total, unit)
  }

  setTotal(total) {
    this.emit({ kind: 'total', id: this.id, total })
  }

  step(done, note = '') {
    this.done = done
    this.emit({ kind: 'step', id: this.id, done, note })
  }

  note(note) {
    this.emit({ kind: 'step', id: this.id, done: this.done, note })
  }

  log(level, text) {
    this.emit({ kind: 'log', level, text })
  }

  ok(note = '') {
    this.emit({ kind: 'end', id: this.id, ok: true, note })
  }

  fail(note = '') {
    this.emit({ kind: 'end', id: this.id, ok: false, note })
  }
}
