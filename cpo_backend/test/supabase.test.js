import test from "node:test";
import assert from "node:assert/strict";
import { handleSupabaseRoute, isSupabaseConfigured } from "../supabase.js";

class ResponseRecorder {
  headers = {};
  status = 200;
  body = "";
  writeHead(status, headers = {}) { this.status = status; this.headers = headers; }
  end(body = "") { this.body = body; }
  json() { return this.body ? JSON.parse(this.body) : null; }
}

async function call(path, { method = "GET", headers = {}, body = "" } = {}) {
  const request = {
    method,
    url: path,
    headers: { host: "localhost:8000", ...headers },
    socket: { encrypted: false },
    async *[Symbol.asyncIterator]() { if (body) yield Buffer.from(body); }
  };
  const response = new ResponseRecorder();
  const handled = await handleSupabaseRoute(request, response, new URL(path, "http://localhost:8000"));
  return { handled, response };
}

test("public publication feed returns an explicit empty configured state when Supabase is absent", async () => {
  const oldUrl = process.env.SUPABASE_URL;
  const oldPublishable = process.env.SUPABASE_PUBLISHABLE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_PUBLISHABLE_KEY;
  try {
    assert.equal(isSupabaseConfigured(), false);
    const { handled, response } = await call("/api/publications?locale=fr");
    assert.equal(handled, true);
    assert.equal(response.status, 200);
    assert.deepEqual(response.json(), { configured: false, items: [] });
  } finally {
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldPublishable === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY; else process.env.SUPABASE_PUBLISHABLE_KEY = oldPublishable;
  }
});

test("staff session is not authenticated when database settings are absent", async () => {
  const oldUrl = process.env.SUPABASE_URL;
  const oldPublishable = process.env.SUPABASE_PUBLISHABLE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_PUBLISHABLE_KEY;
  try {
    const { handled, response } = await call("/api/staff/session");
    assert.equal(handled, true);
    assert.equal(response.status, 200);
    assert.deepEqual(response.json(), { configured: false, authenticated: false });
  } finally {
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldPublishable === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY; else process.env.SUPABASE_PUBLISHABLE_KEY = oldPublishable;
  }
});

test("cross-origin staff login is rejected before contacting Supabase", async () => {
  const oldUrl = process.env.SUPABASE_URL;
  const oldPublishable = process.env.SUPABASE_PUBLISHABLE_KEY;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-test-key";
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests += 1; throw new Error("fetch should not run"); };
  try {
    const { handled, response } = await call("/api/staff/login", {
      method: "POST",
      headers: { origin: "https://attacker.example" },
      body: JSON.stringify({ email: "teacher@example.org", password: "not-a-real-password" })
    });
    assert.equal(handled, true);
    assert.equal(response.status, 403);
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldPublishable === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY; else process.env.SUPABASE_PUBLISHABLE_KEY = oldPublishable;
  }
});
