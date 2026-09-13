/**
 * Per-connection sliding-window message-rate limiter (Section 12's backpressure
 * concern: an unbounded fast — or buggy — client shouldn't be able to degrade the
 * session for everyone else sharing the room). Mirrors the Core API's
 * RateLimiter design (a plain per-key deque of timestamps), scoped per WebSocket
 * connection rather than per IP/user since the thing being protected here is the
 * relay's own message-processing loop, not an HTTP endpoint.
 */
export class MessageRateLimiter {
  private readonly timestamps: number[] = [];

  constructor(
    private readonly maxMessages: number,
    private readonly windowMs: number,
  ) {}

  /** Returns true if this message should be processed, false if it should be dropped. */
  tryConsume(now: number = Date.now()): boolean {
    while (this.timestamps.length > 0 && now - this.timestamps[0] > this.windowMs) {
      this.timestamps.shift();
    }
    if (this.timestamps.length >= this.maxMessages) {
      return false;
    }
    this.timestamps.push(now);
    return true;
  }
}
