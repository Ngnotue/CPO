import test from "node:test";
import assert from "node:assert/strict";
import { handleSupabaseRoute, isSupabaseConfigured } from "../supabase.js";
import { FixedWindowRateLimiter } from "../rate-limit.js";

class ResponseRecorder {
  headers = {};
  status = 200;
  body = "";
  writeHead(status, headers = {}) { this.status = status; this.headers = headers; }
  end(body = "") { this.body = body; }
  json() { return this.body ? JSON.parse(this.body) : null; }
}

test("fixed-window rate limiter blocks excess attempts and resets after expiry", () => {
  let now = 1000;
  const limiter = new FixedWindowRateLimiter({ clock: () => now, maxKeys: 2 });
  assert.equal(limiter.consume("user-a", { limit: 2, windowMs: 5000 }).allowed, true);
  assert.equal(limiter.consume("user-a", { limit: 2, windowMs: 5000 }).allowed, true);
  const blocked = limiter.consume("user-a", { limit: 2, windowMs: 5000 });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 5);
  assert.equal(limiter.consume("user-b", { limit: 1, windowMs: 5000 }).allowed, true);
  assert.equal(limiter.consume("user-c", { limit: 1, windowMs: 5000 }).allowed, false);
  now += 5001;
  assert.equal(limiter.consume("user-c", { limit: 1, windowMs: 5000 }).allowed, true);
});

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

test("public publication feed sends ISO timestamps without double encoding", async () => {
  const oldUrl = process.env.SUPABASE_URL;
  const oldPublishable = process.env.SUPABASE_PUBLISHABLE_KEY;
  const originalFetch = globalThis.fetch;
  let requestUrl;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-test-key";
  globalThis.fetch = async (input) => {
    requestUrl = new URL(input);
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const { handled, response } = await call("/api/publications?locale=fr");
    assert.equal(handled, true);
    assert.equal(response.status, 200);
    assert.equal(response.json().configured, true);
    const expiryFilter = requestUrl.searchParams.get("or");
    assert.match(expiryFilter, /expires_at\.gt\.\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
    assert.match(requestUrl.searchParams.get("published_at"), /^lte\.\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  } finally {
    globalThis.fetch = originalFetch;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldPublishable === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY; else process.env.SUPABASE_PUBLISHABLE_KEY = oldPublishable;
  }
});

test("public publication feed selects and returns the full publication body", async () => {
  const oldUrl = process.env.SUPABASE_URL;
  const oldPublishable = process.env.SUPABASE_PUBLISHABLE_KEY;
  const originalFetch = globalThis.fetch;
  let requestUrl;
  const item = { id: "3654d2da-1671-44c3-9913-3a89baa8fbde", kind: "news", title: "Rentrée", summary: "Résumé", body: "Le texte complet de la publication." };
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-test-key";
  globalThis.fetch = async (input) => {
    requestUrl = new URL(input);
    return new Response(JSON.stringify([item]), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const { response } = await call("/api/publications?locale=fr");
    assert.equal(response.status, 200);
    assert.match(requestUrl.searchParams.get("select"), /,body,/);
    assert.equal(response.json().items[0].body, item.body);
  } finally {
    globalThis.fetch = originalFetch;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldPublishable === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY; else process.env.SUPABASE_PUBLISHABLE_KEY = oldPublishable;
  }
});

test("admin can delete an attachment and its private storage object", async () => {
  const oldEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY
  };
  const originalFetch = globalThis.fetch;
  const userId = "11111111-1111-4111-8111-111111111111";
  const fileId = "22222222-2222-4222-8222-222222222222";
  const publicationId = "33333333-3333-4333-8333-333333333333";
  const objectPath = `${userId}/${publicationId}/file.pdf`;
  const calls = [];
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-test-key";
  process.env.SUPABASE_SECRET_KEY = "secret-test-key";
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input);
    calls.push({ url, method: options.method || "GET" });
    if (url.pathname === "/auth/v1/user") return new Response(JSON.stringify({ id: userId, email: "admin@example.org" }), { status: 200 });
    if (url.pathname === "/rest/v1/profiles") return new Response(JSON.stringify([{ id: userId, role: "admin", full_name: "Admin", is_active: true, must_change_password: false }]), { status: 200 });
    if (url.pathname === "/rest/v1/publication_files" && options.method === "GET") return new Response(JSON.stringify([{ id: fileId, publication_id: publicationId, bucket_id: "cpo-private-documents", object_path: objectPath }]), { status: 200 });
    if (url.pathname === "/rest/v1/publications") return new Response(JSON.stringify([{ id: publicationId, author_id: userId }]), { status: 200 });
    if (url.pathname === `/storage/v1/object/cpo-private-documents/${objectPath}` && options.method === "DELETE") return new Response(null, { status: 200 });
    if (url.pathname === "/rest/v1/publication_files" && options.method === "DELETE") return new Response(JSON.stringify([{ id: fileId }]), { status: 200 });
    if (url.pathname === "/rest/v1/audit_log" && options.method === "POST") return new Response(null, { status: 201 });
    throw new Error(`Unexpected mocked request: ${options.method || "GET"} ${url.pathname}`);
  };
  try {
    const { handled, response } = await call(`/api/staff/publication-files/${fileId}`, {
      method: "DELETE",
      headers: { origin: "http://localhost:8000", cookie: "cpo_access=test-access" }
    });
    assert.equal(handled, true);
    assert.equal(response.status, 200);
    assert.deepEqual(response.json(), { ok: true });
    assert.ok(calls.some(({ url, method }) => url.pathname.startsWith("/storage/v1/object/") && method === "DELETE"));
    assert.ok(calls.some(({ url, method }) => url.pathname === "/rest/v1/publication_files" && method === "DELETE"));
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("administrator can read the audit log without requesting private result fields", async () => {
  const oldEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY
  };
  const originalFetch = globalThis.fetch;
  const userId = "11111111-1111-4111-8111-111111111111";
  const event = { id: 1, actor_id: userId, action: "publication.created", target_type: "publication", target_id: "public-id", created_at: "2026-11-09T10:00:00Z" };
  let auditSelect;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-test-key";
  process.env.SUPABASE_SECRET_KEY = "secret-test-key";
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.pathname === "/auth/v1/user") return new Response(JSON.stringify({ id: userId, email: "admin@example.org" }), { status: 200 });
    if (url.pathname === "/rest/v1/profiles") return new Response(JSON.stringify([{ id: userId, role: "admin", full_name: "Admin", is_active: true, must_change_password: false }]), { status: 200 });
    if (url.pathname === "/rest/v1/audit_log") {
      auditSelect = url.searchParams.get("select");
      return new Response(JSON.stringify([event]), { status: 200 });
    }
    throw new Error(`Unexpected mocked request: ${url.pathname}`);
  };
  try {
    const { handled, response } = await call("/api/staff/audit", { headers: { cookie: "cpo_access=test-access" } });
    assert.equal(handled, true);
    assert.equal(response.status, 200);
    assert.deepEqual(response.json(), { events: [event] });
    assert.doesNotMatch(auditSelect, /student_name|result_value|student_identifier/);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("teacher cannot delete an attachment on a publication owned by another user", async () => {
  const oldEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY
  };
  const originalFetch = globalThis.fetch;
  const userId = "11111111-1111-4111-8111-111111111111";
  const ownerId = "44444444-4444-4444-8444-444444444444";
  const fileId = "22222222-2222-4222-8222-222222222222";
  const publicationId = "33333333-3333-4333-8333-333333333333";
  const calls = [];
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-test-key";
  process.env.SUPABASE_SECRET_KEY = "secret-test-key";
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input);
    calls.push({ url, method: options.method || "GET" });
    if (url.pathname === "/auth/v1/user") return new Response(JSON.stringify({ id: userId, email: "teacher@example.org" }), { status: 200 });
    if (url.pathname === "/rest/v1/profiles") return new Response(JSON.stringify([{ id: userId, role: "teacher", full_name: "Teacher", is_active: true, must_change_password: false }]), { status: 200 });
    if (url.pathname === "/rest/v1/publication_files") return new Response(JSON.stringify([{ id: fileId, publication_id: publicationId, bucket_id: "cpo-private-documents", object_path: `${userId}/${publicationId}/file.pdf` }]), { status: 200 });
    if (url.pathname === "/rest/v1/publications") return new Response(JSON.stringify([{ id: publicationId, author_id: ownerId }]), { status: 200 });
    throw new Error(`Unexpected mocked request: ${options.method || "GET"} ${url.pathname}`);
  };
  try {
    const { response } = await call(`/api/staff/publication-files/${fileId}`, {
      method: "DELETE",
      headers: { origin: "http://localhost:8000", cookie: "cpo_access=test-access" }
    });
    assert.equal(response.status, 404);
    assert.equal(calls.some(({ url }) => url.pathname.startsWith("/storage/v1/object/")), false);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
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

test("staff login limits repeated attempts for the same identifier", async () => {
  const oldEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY
  };
  const originalFetch = globalThis.fetch;
  const identifier = `unknown-${Date.now()}-${Math.random()}`;
  let upstreamRequests = 0;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-test-key";
  process.env.SUPABASE_SECRET_KEY = "secret-test-key";
  globalThis.fetch = async () => {
    upstreamRequests += 1;
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const { response } = await call("/api/staff/login", {
        method: "POST",
        headers: { origin: "http://localhost:8000" },
        body: JSON.stringify({ identifier, password: "invalid-password" })
      });
      assert.equal(response.status, 401);
    }
    const callsBeforeBlockedAttempt = upstreamRequests;
    const { response } = await call("/api/staff/login", {
      method: "POST",
      headers: { origin: "http://localhost:8000" },
      body: JSON.stringify({ identifier, password: "invalid-password" })
    });
    assert.equal(response.status, 429);
    assert.equal(response.headers["Retry-After"], "900");
    assert.equal(upstreamRequests, callsBeforeBlockedAttempt);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
