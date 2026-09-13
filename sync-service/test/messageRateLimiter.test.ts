import { describe, expect, it } from "vitest";
import { MessageRateLimiter } from "../src/security/messageRateLimiter.js";

describe("MessageRateLimiter", () => {
  it("allows up to the configured limit within the window", () => {
    const limiter = new MessageRateLimiter(3, 1000);
    const now = 1_000_000;
    expect(limiter.tryConsume(now)).toBe(true);
    expect(limiter.tryConsume(now)).toBe(true);
    expect(limiter.tryConsume(now)).toBe(true);
    expect(limiter.tryConsume(now)).toBe(false);
  });

  it("allows more messages again once the window has slid past the earlier ones", () => {
    const limiter = new MessageRateLimiter(2, 1000);
    const now = 1_000_000;
    expect(limiter.tryConsume(now)).toBe(true);
    expect(limiter.tryConsume(now)).toBe(true);
    expect(limiter.tryConsume(now)).toBe(false);

    expect(limiter.tryConsume(now + 1001)).toBe(true);
  });

  it("tracks each connection independently", () => {
    const a = new MessageRateLimiter(1, 1000);
    const b = new MessageRateLimiter(1, 1000);
    const now = 1_000_000;
    expect(a.tryConsume(now)).toBe(true);
    expect(a.tryConsume(now)).toBe(false);
    expect(b.tryConsume(now)).toBe(true);
  });
});
