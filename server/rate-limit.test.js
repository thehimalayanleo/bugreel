import test from "node:test";
import assert from "node:assert/strict";
import { clientKey, createRateLimiter } from "./rate-limit.js";

test("uses Render's first forwarded client address when available", () => {
  assert.equal(clientKey({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }, "127.0.0.1"), "203.0.113.7");
  assert.equal(clientKey({}, "127.0.0.1"), "127.0.0.1");
});

test("limits a client within the configured window and later releases it", () => {
  let timestamp = 1_000;
  const limiter = createRateLimiter({ max: 2, windowMs: 10_000, now: () => timestamp });
  assert.deepEqual(limiter.take("client-a"), { allowed: true, retryAfterSeconds: 0 });
  timestamp += 1_000;
  assert.deepEqual(limiter.take("client-a"), { allowed: true, retryAfterSeconds: 0 });
  timestamp += 1_000;
  assert.deepEqual(limiter.take("client-a"), { allowed: false, retryAfterSeconds: 8 });
  timestamp += 8_001;
  assert.deepEqual(limiter.take("client-a"), { allowed: true, retryAfterSeconds: 0 });
});
