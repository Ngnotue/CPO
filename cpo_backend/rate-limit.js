export class FixedWindowRateLimiter {
  constructor({ clock = Date.now, maxKeys = 5000 } = {}) {
    this.clock = clock;
    this.maxKeys = maxKeys;
    this.entries = new Map();
  }

  consume(key, { limit, windowMs }) {
    const now = this.clock();
    let entry = this.entries.get(key);
    if (!entry || now >= entry.resetAt) {
      if (this.entries.has(key)) this.entries.delete(key);
      if (this.entries.size >= this.maxKeys) this.pruneExpired(now);
      if (this.entries.size >= this.maxKeys) {
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(windowMs / 1000)) };
      }
      entry = { count: 0, resetAt: now + windowMs };
      this.entries.set(key, entry);
    }

    if (entry.count >= limit) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
    }

    entry.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  clear(key) {
    this.entries.delete(key);
  }

  pruneExpired(now = this.clock()) {
    for (const [key, entry] of this.entries) {
      if (now >= entry.resetAt) this.entries.delete(key);
    }
  }
}