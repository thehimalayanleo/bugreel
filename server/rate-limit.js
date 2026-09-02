export function clientKey(headers = {}, remoteAddress = "unknown") {
  const forwarded = String(headers["x-forwarded-for"] || "").split(",")[0].trim();
  return (forwarded || remoteAddress || "unknown").slice(0, 120);
}

export function createRateLimiter({ windowMs = 15 * 60_000, max = 4, now = () => Date.now() } = {}) {
  const requests = new Map();

  function prune(key, timestamp) {
    const active = (requests.get(key) || []).filter((time) => time > timestamp - windowMs);
    if (active.length) requests.set(key, active);
    else requests.delete(key);
    return active;
  }

  return {
    take(key) {
      const timestamp = now();
      const active = prune(key, timestamp);
      if (active.length >= max) {
        const retryAfterSeconds = Math.max(1, Math.ceil((active[0] + windowMs - timestamp) / 1_000));
        return { allowed: false, retryAfterSeconds };
      }
      active.push(timestamp);
      requests.set(key, active);
      return { allowed: true, retryAfterSeconds: 0 };
    },
    size() {
      return requests.size;
    }
  };
}
