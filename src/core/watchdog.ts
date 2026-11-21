/** Spots a model that keeps issuing the same tool calls: the same batch (names and inputs) `threshold` times in a row. */
export class LoopDetector {
  private last = ''
  private n = 0
  constructor(private threshold = 3) {}

  /** True once when the repeat count reaches the threshold; the count then starts over so a long loop re-reports every `threshold` repeats. */
  record(calls: { name: string; input: unknown }[]): boolean {
    const sig = JSON.stringify(calls.map((c) => [c.name, c.input]))
    this.n = sig === this.last ? this.n + 1 : 1
    this.last = sig
    if (this.n < this.threshold) return false
    this.n = 0
    return true
  }
}
