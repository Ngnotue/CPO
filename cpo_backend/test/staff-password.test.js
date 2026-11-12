import test from "node:test";
import assert from "node:assert/strict";
import { handleSupabaseRoute } from "../supabase.js";

const userId = "11111111-1111-4111-8111-111111111111";

async function runPasswordRequest(mock) {
  const old = Object.fromEntries(["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY"].map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-test-key";
  process.env.SUPABASE_SECRET_KEY = "secret-test-key";
  const calls = [];
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(input);
    calls.push({ path: url.pathname, method: options.method, options });
    if (url.pathname === "/auth/v1/user" && options.method === "GET") return Response.json({ id: userId });
    if (url.pathname === "/rest/v1/profiles" && options.method === "GET") return Response.json([{ id: userId, role: "teacher", is_active: true, must_change_password: true }]);
    return mock(url, options);
  };
  const request = {
    method: "POST",
    headers: { host: "localhost:8000", origin: "http://localhost:8000", cookie: "cpo_access=test-access" },
    socket: { encrypted: false },
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ password: "test-password-123" })); }
  };
  const response = {
    status: null, body: "", headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers); },
    end(body) { this.body = body; }
  };
  try {
    await handleSupabaseRoute(request, response, new URL("http://localhost:8000/api/staff/password"));
    return { status: response.status, payload: JSON.parse(response.body), calls };
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

test("staff password change confirms profile update before succeeding", async () => {
  const result = await runPasswordRequest((url, options) => {
    if (url.pathname === "/auth/v1/user" && options.method === "PUT") return Response.json({ id: userId });
    if (url.pathname === "/rest/v1/profiles" && options.method === "PATCH") {
      assert.equal(options.headers.Prefer, "return=representation");
      assert.deepEqual(JSON.parse(options.body), { must_change_password: false });
      return Response.json([{ id: userId, must_change_password: false }]);
    }
    throw new Error("Unexpected request");
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.payload, { ok: true });
});

test("a repeated password is explained without exposing the upstream message", async () => {
  const result = await runPasswordRequest((url, options) => {
    if (url.pathname === "/auth/v1/user" && options.method === "PUT") return Response.json({ error_code: "same_password", message: "private upstream details" }, { status: 422 });
    throw new Error("Profile must not be changed after an auth rejection");
  });
  assert.equal(result.status, 400);
  assert.match(result.payload.error, /différent/);
  assert.doesNotMatch(result.payload.error, /private upstream details/);
  assert.equal(result.calls.some((call) => call.path === "/rest/v1/profiles" && call.method === "PATCH"), false);
});

test("a rejected weak password is reported safely", async () => {
  const result = await runPasswordRequest((url, options) => {
    if (url.pathname === "/auth/v1/user" && options.method === "PUT") return Response.json({ code: "weak_password", message: "private upstream details" }, { status: 422 });
    throw new Error("Unexpected request");
  });
  assert.equal(result.status, 400);
  assert.match(result.payload.error, /plus sûr/);
  assert.doesNotMatch(result.payload.error, /private upstream details/);
});

test("profile update failure warns that the password was changed", async () => {
  const result = await runPasswordRequest((url, options) => {
    if (url.pathname === "/auth/v1/user" && options.method === "PUT") return Response.json({ id: userId });
    if (url.pathname === "/rest/v1/profiles" && options.method === "PATCH") return Response.json({ code: "PGRST_ERROR", message: "private database details" }, { status: 500 });
    throw new Error("Unexpected request");
  });
  assert.equal(result.status, 503);
  assert.match(result.payload.error, /mot de passe a été modifié/);
  assert.doesNotMatch(result.payload.error, /private database details/);
});

test("an empty profile update is not treated as success", async () => {
  const result = await runPasswordRequest((url, options) => {
    if (url.pathname === "/auth/v1/user" && options.method === "PUT") return Response.json({ id: userId });
    if (url.pathname === "/rest/v1/profiles" && options.method === "PATCH") return Response.json([]);
    throw new Error("Unexpected request");
  });
  assert.equal(result.status, 503);
  assert.match(result.payload.error, /mot de passe a été modifié/);
});
