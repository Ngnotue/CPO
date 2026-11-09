import { randomUUID } from "node:crypto";
import { FixedWindowRateLimiter } from "./rate-limit.js";

const PUBLICATION_KINDS = new Set(["news", "announcement", "event", "course", "exercise", "resource"]);
const PUBLICATION_STATUSES = new Set(["draft", "published", "archived"]);
const VISIBILITIES = new Set(["public", "private"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCESS_COOKIE = "cpo_access";
const REFRESH_COOKIE = "cpo_refresh";
const ACCESS_FALLBACK_SECONDS = 3600;
const REFRESH_IDLE_SECONDS = 12 * 60 * 60;
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const staffLoginRateLimiter = new FixedWindowRateLimiter();
const ALLOWED_FILE_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/jpeg",
  "image/png",
  "image/webp"
]);

function configuration() {
  const url = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "";
  const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !publishableKey) return null;
  try {
    const parsed = new URL(url);
    if (!(["https:", "http:"].includes(parsed.protocol)) || parsed.username || parsed.password) return null;
  } catch {
    return null;
  }
  return { url, publishableKey, secretKey };
}

export function isSupabaseConfigured() {
  return configuration() !== null;
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}

async function readJson(request, maxBytes = 32 * 1024) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body, "utf8") > maxBytes) {
      const error = new Error("REQUEST_TOO_LARGE");
      error.status = 413;
      throw error;
    }
  }
  try {
    return JSON.parse(body || "{}");
  } catch {
    const error = new Error("INVALID_JSON");
    error.status = 400;
    throw error;
  }
}

function cookieMap(request) {
  return Object.fromEntries(String(request.headers.cookie || "").split(";").map((part) => {
    const separator = part.indexOf("=");
    return separator < 0 ? ["", ""] : [part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())];
  }).filter(([name]) => name));
}

function cookieHeader(name, value, request, maxAge) {
  const secure = request.socket.encrypted || request.headers["x-forwarded-proto"] === "https";
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

function storeSession(response, request, session) {
  const age = Math.max(60, Math.min(Number(session.expires_in) || ACCESS_FALLBACK_SECONDS, 24 * 60 * 60));
  response.setHeader("Set-Cookie", [
    cookieHeader(ACCESS_COOKIE, session.access_token, request, age),
    cookieHeader(REFRESH_COOKIE, session.refresh_token, request, REFRESH_IDLE_SECONDS)
  ]);
}

function clearSession(response, request) {
  response.setHeader("Set-Cookie", [cookieHeader(ACCESS_COOKIE, "", request, 0), cookieHeader(REFRESH_COOKIE, "", request, 0)]);
}

function sameOrigin(request) {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (!origin || !host) return false;
  try {
    return new URL(origin).host.toLowerCase() === String(host).toLowerCase();
  } catch {
    return false;
  }
}

function requireSameOrigin(request, response) {
  if (sameOrigin(request)) return true;
  sendJson(response, 403, { error: "Origine de requête non autorisée." });
  return false;
}

async function supabaseRequest(path, { method = "GET", body, accessToken, admin = false, prefer } = {}) {
  const config = configuration();
  if (!config) throw Object.assign(new Error("SUPABASE_NOT_CONFIGURED"), { status: 503 });
  if (admin && !config.secretKey) throw Object.assign(new Error("SUPABASE_SECRET_KEY_NOT_CONFIGURED"), { status: 503 });
  const key = admin ? config.secretKey : config.publishableKey;
  const headers = { apikey: key, Authorization: `Bearer ${accessToken || key}`, Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (prefer) headers.Prefer = prefer;
  const result = await fetch(`${config.url}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await result.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  if (!result.ok) {
    const error = new Error(data?.msg || data?.message || data?.error_description || "Supabase request failed");
    error.status = result.status;
    error.code = data?.code || data?.error || "SUPABASE_ERROR";
    throw error;
  }
  return data;
}

function postgrest(path, options = {}) {
  return supabaseRequest(`/rest/v1/${path}`, options);
}

async function recordAudit(actorId, action, targetType, targetId, metadata = {}) {
  try {
    await postgrest("audit_log", {
      method: "POST",
      admin: true,
      body: { actor_id: actorId, action, target_type: targetType, target_id: targetId, metadata },
      prefer: "return=minimal"
    });
  } catch {
    console.error("CPO audit event could not be stored:", action);
  }
}

function authRequest(path, options = {}) {
  return supabaseRequest(`/auth/v1/${path}`, options);
}

function encodeObjectPath(path) {
  return path.split("/").map((part) => encodeURIComponent(part)).join("/");
}

function safeFileName(value) {
  const leaf = String(value || "fichier").split(/[\\/]/).pop() || "fichier";
  return leaf.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(-180) || "fichier";
}

function storageRequestPath(bucket, objectPath, action = "object") {
  return `/storage/v1/${action}/${encodeURIComponent(bucket)}/${encodeObjectPath(objectPath)}`;
}

async function signedStorageUrl(bucket, objectPath, expiresIn = 3600) {
  const config = configuration();
  if (!config?.secretKey) return null;
  const result = await supabaseRequest(`/storage/v1/object/sign/${encodeURIComponent(bucket)}/${encodeObjectPath(objectPath)}`, {
    method: "POST",
    admin: true,
    body: { expiresIn }
  });
  const path = result?.signedURL || result?.signedUrl;
  if (!path) return null;
  return /^https?:\/\//i.test(path) ? path : `${config.url}/storage/v1${path.startsWith("/") ? path : `/${path}`}`;
}

async function signedUploadUrl(bucket, objectPath) {
  const config = configuration();
  if (!config?.secretKey) throw Object.assign(new Error("SUPABASE_SECRET_KEY_NOT_CONFIGURED"), { status: 503 });
  const response = await supabaseRequest(storageRequestPath(bucket, objectPath, "object/upload/sign"), {
    method: "POST",
    admin: true,
    body: { upsert: false }
  });
  if (!response?.token) throw Object.assign(new Error("Supabase n'a pas fourni de jeton d'envoi."), { status: 502 });
  return {
    token: response.token,
    upload_url: `${config.url}${storageRequestPath(bucket, objectPath, "object/upload/sign")}?token=${encodeURIComponent(response.token)}`
  };
}

async function verifyStoredObject(bucket, objectPath) {
  return supabaseRequest(storageRequestPath(bucket, objectPath, "object/info"), { admin: true });
}

async function deleteStoredObject(bucket, objectPath) {
  return supabaseRequest(storageRequestPath(bucket, objectPath, "object"), { method: "DELETE", admin: true });
}

async function syncPublicationFiles(publicationId, accessToken, isPublic) {
  await postgrest(`publication_files?publication_id=eq.${encodeURIComponent(publicationId)}`, {
    method: "PATCH",
    accessToken,
    body: { is_public: isPublic },
    prefer: "return=minimal"
  });
}

async function profileFor(id) {
  const rows = await postgrest(`profiles?id=eq.${encodeURIComponent(id)}&select=id,role,full_name,teacher_code,subject,is_active,must_change_password&limit=1`, { admin: true });
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function verifyAccessToken(token) {
  return authRequest("user", { accessToken: token });
}

async function refreshSession(refreshToken) {
  return authRequest("token?grant_type=refresh_token", { method: "POST", body: { refresh_token: refreshToken } });
}

async function authenticatedStaff(request, response, allowedRoles = ["admin", "teacher"], allowPasswordChange = false) {
  const config = configuration();
  if (!config || !config.secretKey) {
    sendJson(response, 503, { error: "Supabase Auth n'est pas encore configuré sur le serveur." });
    return null;
  }
  const cookies = cookieMap(request);
  let session = null;
  let user = null;
  try {
    if (cookies[ACCESS_COOKIE]) user = await verifyAccessToken(cookies[ACCESS_COOKIE]);
  } catch (error) {
    if (error.status !== 401 || !cookies[REFRESH_COOKIE]) {
      clearSession(response, request);
      sendJson(response, 401, { error: "Session expirée. Veuillez vous reconnecter." });
      return null;
    }
  }
  if (!user && cookies[REFRESH_COOKIE]) {
    try {
      session = await refreshSession(cookies[REFRESH_COOKIE]);
      user = await verifyAccessToken(session.access_token);
      storeSession(response, request, session);
    } catch {
      clearSession(response, request);
      sendJson(response, 401, { error: "Session expirée. Veuillez vous reconnecter." });
      return null;
    }
  }
  if (!user?.id) {
    sendJson(response, 401, { error: "Connexion requise." });
    return null;
  }
  let profile;
  try { profile = await profileFor(user.id); }
  catch { sendJson(response, 503, { error: "Impossible de vérifier le profil du compte." }); return null; }
  if (!profile || !profile.is_active || !allowedRoles.includes(profile.role)) {
    sendJson(response, 403, { error: "Accès réservé au personnel autorisé." });
    return null;
  }
  if (profile.must_change_password && !allowPasswordChange) {
    sendJson(response, 403, { error: "Changez votre mot de passe temporaire avant de continuer.", code: "PASSWORD_CHANGE_REQUIRED" });
    return null;
  }
  return { user, profile, accessToken: session?.access_token || cookies[ACCESS_COOKIE] };
}

function safeString(value, maxLength, label, { required = false } = {}) {
  if (value === undefined || value === null) value = "";
  if (typeof value !== "string") throw Object.assign(new Error(`${label} invalide.`), { status: 400 });
  const normalized = value.trim();
  if ((required && !normalized) || normalized.length > maxLength) {
    throw Object.assign(new Error(`${label} invalide.`), { status: 400 });
  }
  return normalized;
}

function slugify(value) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 180) || "publication";
}

function publicationInput(input, { partial = false } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw Object.assign(new Error("Publication invalide."), { status: 400 });
  const output = {};
  if (!partial || input.title !== undefined) {
    output.title = safeString(input.title, 220, "Titre", { required: true });
    output.slug = slugify(output.title);
  }
  for (const [field, max] of [["summary", 600], ["body", 50000], ["category", 100]]) {
    if (!partial || input[field] !== undefined) output[field] = safeString(input[field], max, field);
  }
  if (!partial || input.kind !== undefined) {
    if (!PUBLICATION_KINDS.has(input.kind)) throw Object.assign(new Error("Type de publication invalide."), { status: 400 });
    output.kind = input.kind;
  }
  if (!partial || input.locale !== undefined) {
    output.locale = input.locale || "fr";
    if (!["fr", "en"].includes(output.locale)) throw Object.assign(new Error("Langue de publication invalide."), { status: 400 });
  }
  if (input.status !== undefined || !partial) {
    const status = input.status || "draft";
    if (!PUBLICATION_STATUSES.has(status)) throw Object.assign(new Error("Statut invalide."), { status: 400 });
    output.status = status;
    if (status === "published") output.published_at = new Date().toISOString();
  }
  if (input.visibility !== undefined || !partial) {
    const visibility = input.visibility || "public";
    if (!VISIBILITIES.has(visibility)) throw Object.assign(new Error("Visibilité invalide."), { status: 400 });
    output.visibility = visibility;
  }
  if (input.is_important !== undefined) output.is_important = input.is_important === true;
  if (input.expires_at !== undefined) {
    output.expires_at = input.expires_at || null;
    if (output.expires_at && Number.isNaN(Date.parse(output.expires_at))) throw Object.assign(new Error("Date d'expiration invalide."), { status: 400 });
  }
  for (const field of ["class_id", "subject_id"]) {
    if (input[field] !== undefined) {
      output[field] = input[field] || null;
      if (output[field] && !UUID_PATTERN.test(output[field])) throw Object.assign(new Error(`${field} invalide.`), { status: 400 });
    }
  }
  return output;
}

function jsonError(response, error) {
  if (error.status === 503 && error.message === "SUPABASE_NOT_CONFIGURED") {
    sendJson(response, 503, { error: "Supabase n'est pas configuré. Ajoutez ses variables au serveur." });
  } else if (error.status === 503 && error.message === "SUPABASE_SECRET_KEY_NOT_CONFIGURED") {
    sendJson(response, 503, { error: "La clé secrète Supabase manque dans la configuration serveur." });
  } else if (error.status === 400 || error.status === 413) {
    sendJson(response, error.status, { error: error.message });
  } else {
    console.error("CPO Supabase API error:", error.code || error.status || "UNKNOWN");
    sendJson(response, error.status === 401 ? 401 : error.status === 403 ? 403 : 502, { error: "La demande Supabase n'a pas pu être traitée." });
  }
}

export async function handleSupabaseRoute(request, response, url) {
  const { pathname, searchParams } = url;
  const method = request.method;
  if (!pathname.startsWith("/api/publications") && !pathname.startsWith("/api/staff/")) return false;

  try {
    if (method === "GET" && pathname === "/api/publications") {
      if (!configuration()) return sendJson(response, 200, { configured: false, items: [] }), true;
      const allowedKinds = ["news", "announcement", "event"];
      const requestedKinds = (searchParams.get("kind") || "news,announcement,event").split(",");
      const kinds = requestedKinds.filter((kind) => allowedKinds.includes(kind));
      if (!kinds.length) return sendJson(response, 200, { configured: true, items: [] }), true;
      const limit = Math.max(1, Math.min(Number(searchParams.get("limit")) || 6, 12));
      const now = new Date().toISOString();
      const locale = searchParams.get("locale") === "en" ? "en" : "fr";
      const query = new URLSearchParams({
        select: "id,kind,title,slug,summary,body,category,locale,is_important,published_at,expires_at,publication_files(id,original_name,content_type,object_path,bucket_id)",
        status: "eq.published",
        visibility: "eq.public",
        locale: `eq.${locale}`,
        kind: `in.(${kinds.join(",")})`,
        published_at: `lte.${now}`,
        or: `(expires_at.is.null,expires_at.gt.${now})`,
        order: "is_important.desc,published_at.desc",
        limit: String(limit)
      });
      const items = await postgrest(`publications?${query.toString()}`);
      for (const item of items || []) {
        const files = item.publication_files || [];
        item.files = await Promise.all(files.map(async (file) => ({
          name: file.original_name,
          content_type: file.content_type,
          url: await signedStorageUrl(file.bucket_id, file.object_path)
        })));
        delete item.publication_files;
      }
      return sendJson(response, 200, { configured: true, items }), true;
    }

    if (pathname === "/api/staff/login" && method === "POST") {
      if (!requireSameOrigin(request, response)) return true;
      const { identifier, email, password } = await readJson(request, 8 * 1024);
      const cleanIdentifier = safeString(identifier || email, 254, "Identifiant", { required: true });
      if (typeof password !== "string" || password.length < 1 || password.length > 1024) throw Object.assign(new Error("Mot de passe invalide."), { status: 400 });
      const loginLimit = staffLoginRateLimiter.consume(cleanIdentifier.toLowerCase(), { limit: 8, windowMs: 15 * 60 * 1000 });
      if (!loginLimit.allowed) {
        response.writeHead(429, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Retry-After": String(loginLimit.retryAfterSeconds) });
        response.end(JSON.stringify({ error: "Trop de tentatives de connexion. Réessayez après le délai indiqué." }));
        return true;
      }
      let loginEmail = cleanIdentifier.toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginEmail)) {
        const matches = await postgrest(`profiles?teacher_code=eq.${encodeURIComponent(cleanIdentifier)}&select=id,role,is_active&limit=1`, { admin: true });
        const match = matches?.[0];
        if (!match || match.role !== "teacher" || !match.is_active) throw Object.assign(new Error("Identifiant ou mot de passe incorrect."), { status: 401 });
        const authUser = await authRequest(`admin/users/${encodeURIComponent(match.id)}`, { admin: true });
        loginEmail = authUser?.user?.email || authUser?.email || "";
        if (!loginEmail) throw Object.assign(new Error("Identifiant ou mot de passe incorrect."), { status: 401 });
      }
      const session = await authRequest("token?grant_type=password", { method: "POST", body: { email: loginEmail, password } });
      const user = await verifyAccessToken(session.access_token);
      const profile = await profileFor(user.id);
      if (!profile || !profile.is_active || !["admin", "teacher"].includes(profile.role)) {
        try { await authRequest("logout", { method: "POST", accessToken: session.access_token }); } catch {}
        return sendJson(response, 403, { error: "Ce compte n'a pas accès à l'espace du personnel." }), true;
      }
      storeSession(response, request, session);
      staffLoginRateLimiter.clear(cleanIdentifier.toLowerCase());
      return sendJson(response, 200, { user: { id: user.id, email: user.email }, profile }), true;
    }

    if (pathname === "/api/staff/logout" && method === "POST") {
      if (!requireSameOrigin(request, response)) return true;
      const cookies = cookieMap(request);
      if (cookies[ACCESS_COOKIE]) {
        try { await authRequest("logout", { method: "POST", accessToken: cookies[ACCESS_COOKIE] }); } catch {}
      }
      clearSession(response, request);
      return sendJson(response, 200, { ok: true }), true;
    }

    if (pathname === "/api/staff/session" && method === "GET") {
      if (!configuration()) return sendJson(response, 200, { configured: false, authenticated: false }), true;
      const identity = await authenticatedStaff(request, response, ["admin", "teacher"], true);
      if (!identity) return true;
      return sendJson(response, 200, { configured: true, authenticated: true, user: { id: identity.user.id, email: identity.user.email }, profile: identity.profile }), true;
    }

    if (pathname === "/api/staff/password" && method === "POST") {
      if (!requireSameOrigin(request, response)) return true;
      const identity = await authenticatedStaff(request, response, ["admin", "teacher"], true);
      if (!identity) return true;
      const { password } = await readJson(request, 8 * 1024);
      if (typeof password !== "string" || password.length < 12 || password.length > 128) throw Object.assign(new Error("Le nouveau mot de passe doit contenir au moins 12 caractères."), { status: 400 });
      await authRequest("user", { method: "PUT", accessToken: identity.accessToken, body: { password } });
      await postgrest(`profiles?id=eq.${encodeURIComponent(identity.user.id)}`, { method: "PATCH", admin: true, body: { must_change_password: false }, prefer: "return=minimal" });
      return sendJson(response, 200, { ok: true }), true;
    }

    if (pathname === "/api/staff/publications" && method === "GET") {
      const identity = await authenticatedStaff(request, response);
      if (!identity) return true;
      const query = new URLSearchParams({ select: "id,author_id,kind,status,visibility,locale,title,slug,summary,body,category,class_id,subject_id,is_important,published_at,expires_at,created_at,updated_at,publication_files(id,original_name,content_type,object_path,bucket_id,is_public)", order: "updated_at.desc", limit: "100" });
      const items = await postgrest(`publications?${query.toString()}`, { accessToken: identity.accessToken });
      for (const item of items || []) {
        const files = item.publication_files || [];
        item.files = await Promise.all(files.map(async (file) => ({
          id: file.id,
          name: file.original_name,
          content_type: file.content_type,
          is_public: file.is_public,
          url: await signedStorageUrl(file.bucket_id, file.object_path, 900)
        })));
        delete item.publication_files;
      }
      return sendJson(response, 200, { items }), true;
    }

    if (pathname === "/api/staff/publications" && method === "POST") {
      if (!requireSameOrigin(request, response)) return true;
      const identity = await authenticatedStaff(request, response);
      if (!identity) return true;
      const rawInput = await readJson(request);
      const requestedAuthor = rawInput.author_id;
      const input = publicationInput(rawInput);
      if (requestedAuthor && (identity.profile.role !== "admin" || !UUID_PATTERN.test(requestedAuthor))) {
        throw Object.assign(new Error("Auteur de publication invalide."), { status: 400 });
      }
      input.author_id = identity.profile.role === "admin" && requestedAuthor ? requestedAuthor : identity.user.id;
      if (identity.profile.role === "admin" && requestedAuthor) {
        const authorRows = await postgrest(`profiles?id=eq.${encodeURIComponent(requestedAuthor)}&select=id,role,is_active&limit=1`, { admin: true });
        if (!authorRows?.[0]?.is_active || !["teacher", "admin"].includes(authorRows[0].role)) {
          throw Object.assign(new Error("Le profil choisi n'est pas un membre actif du personnel."), { status: 400 });
        }
      }
      const rows = await postgrest("publications", { method: "POST", accessToken: identity.accessToken, body: input, prefer: "return=representation" });
      await recordAudit(identity.user.id, "publication.created", "publication", rows?.[0]?.id || null, { kind: input.kind, status: input.status, visibility: input.visibility, locale: input.locale });
      return sendJson(response, 201, { item: rows?.[0] || null }), true;
    }

    if (pathname === "/api/staff/audit" && method === "GET") {
      const identity = await authenticatedStaff(request, response, ["admin"]);
      if (!identity) return true;
      const events = await postgrest("audit_log?select=id,actor_id,action,target_type,target_id,created_at&order=created_at.desc&limit=100", { accessToken: identity.accessToken });
      return sendJson(response, 200, { events }), true;
    }

    const publicationFileMatch = pathname.match(/^\/api\/staff\/publication-files\/([0-9a-f-]{36})$/i);
    if (publicationFileMatch && method === "DELETE") {
      if (!requireSameOrigin(request, response)) return true;
      const identity = await authenticatedStaff(request, response);
      if (!identity) return true;
      if (!UUID_PATTERN.test(publicationFileMatch[1])) return sendJson(response, 400, { error: "Identifiant de pièce jointe invalide." }), true;
      const fileFilter = `id=eq.${encodeURIComponent(publicationFileMatch[1])}`;
      const files = await postgrest(`publication_files?${fileFilter}&select=id,publication_id,bucket_id,object_path&limit=1`, { accessToken: identity.accessToken });
      const file = files?.[0];
      if (!file || file.bucket_id !== "cpo-private-documents") return sendJson(response, 404, { error: "Pièce jointe introuvable ou accès refusé." }), true;
      const publications = await postgrest(`publications?id=eq.${encodeURIComponent(file.publication_id)}&select=id,author_id&limit=1`, { accessToken: identity.accessToken });
      const publication = publications?.[0];
      if (!publication || (identity.profile.role !== "admin" && publication.author_id !== identity.user.id)) {
        return sendJson(response, 404, { error: "Pièce jointe introuvable ou accès refusé." }), true;
      }
      await deleteStoredObject(file.bucket_id, file.object_path);
      const deleted = await postgrest(`publication_files?${fileFilter}`, {
        method: "DELETE",
        accessToken: identity.accessToken,
        prefer: "return=representation"
      });
      if (!deleted?.length) return sendJson(response, 404, { error: "Pièce jointe déjà supprimée ou accès refusé." }), true;
      await recordAudit(identity.user.id, "publication_file.deleted", "publication_file", file.id, { publication_id: file.publication_id });
      return sendJson(response, 200, { ok: true }), true;
    }

    if (pathname === "/api/staff/uploads/sign" && method === "POST") {
      if (!requireSameOrigin(request, response)) return true;
      const identity = await authenticatedStaff(request, response);
      if (!identity) return true;
      const input = await readJson(request, 8 * 1024);
      const publicationId = safeString(input.publication_id, 36, "Publication", { required: true });
      const originalName = safeString(input.original_name, 255, "Nom de fichier", { required: true });
      const contentType = safeString(input.content_type, 120, "Type de fichier", { required: true }).toLowerCase();
      const sizeBytes = Number(input.size_bytes);
      if (!UUID_PATTERN.test(publicationId)) throw Object.assign(new Error("Identifiant de publication invalide."), { status: 400 });
      if (!ALLOWED_FILE_TYPES.has(contentType)) throw Object.assign(new Error("Ce format de fichier n'est pas autorisé."), { status: 400 });
      if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_UPLOAD_BYTES) throw Object.assign(new Error("Le fichier dépasse la limite de 100 Mo ou sa taille est invalide."), { status: 400 });
      const publication = await postgrest(`publications?id=eq.${encodeURIComponent(publicationId)}&select=id,author_id,status,visibility&limit=1`, { accessToken: identity.accessToken });
      const record = publication?.[0];
      if (!record || (identity.profile.role !== "admin" && record.author_id !== identity.user.id)) {
        return sendJson(response, 404, { error: "Publication introuvable ou accès refusé." }), true;
      }
      const objectPath = `${identity.user.id}/${publicationId}/${randomUUID()}-${safeFileName(originalName)}`;
      const signed = await signedUploadUrl("cpo-private-documents", objectPath);
      return sendJson(response, 200, {
        ...signed,
        bucket_id: "cpo-private-documents",
        object_path: objectPath,
        publication_id: publicationId,
        original_name: originalName,
        content_type: contentType,
        size_bytes: sizeBytes
      }), true;
    }

    if (pathname === "/api/staff/uploads/finalize" && method === "POST") {
      if (!requireSameOrigin(request, response)) return true;
      const identity = await authenticatedStaff(request, response);
      if (!identity) return true;
      const input = await readJson(request, 8 * 1024);
      const publicationId = safeString(input.publication_id, 36, "Publication", { required: true });
      const objectPath = safeString(input.object_path, 1024, "Chemin de fichier", { required: true });
      const originalName = safeString(input.original_name, 255, "Nom de fichier", { required: true });
      const contentType = safeString(input.content_type, 120, "Type de fichier", { required: true }).toLowerCase();
      const sizeBytes = Number(input.size_bytes);
      if (!UUID_PATTERN.test(publicationId) || objectPath.split("/")[0] !== identity.user.id || objectPath.split("/")[1] !== publicationId) {
        throw Object.assign(new Error("Chemin de fichier invalide."), { status: 400 });
      }
      if (!ALLOWED_FILE_TYPES.has(contentType) || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_UPLOAD_BYTES) {
        throw Object.assign(new Error("Métadonnées de fichier invalides."), { status: 400 });
      }
      const publication = await postgrest(`publications?id=eq.${encodeURIComponent(publicationId)}&select=id,author_id,status,visibility&limit=1`, { accessToken: identity.accessToken });
      const record = publication?.[0];
      if (!record || (identity.profile.role !== "admin" && record.author_id !== identity.user.id)) {
        return sendJson(response, 404, { error: "Publication introuvable ou accès refusé." }), true;
      }
      let inserted;
      try {
        const objectInfo = await verifyStoredObject("cpo-private-documents", objectPath);
        const actualSize = Number(objectInfo?.metadata?.size ?? objectInfo?.size);
        const actualType = String(objectInfo?.metadata?.mimetype ?? objectInfo?.metadata?.contentType ?? contentType).toLowerCase();
        if (Number.isFinite(actualSize) && actualSize !== sizeBytes) {
          throw Object.assign(new Error("La taille du fichier reçu ne correspond pas à l'envoi."), { status: 400 });
        }
        if (!ALLOWED_FILE_TYPES.has(actualType)) {
          throw Object.assign(new Error("Le stockage indique un format de fichier non autorisé."), { status: 400 });
        }
        inserted = await postgrest("publication_files", {
          method: "POST",
          accessToken: identity.accessToken,
          body: {
            publication_id: publicationId,
            uploaded_by: identity.user.id,
            bucket_id: "cpo-private-documents",
            object_path: objectPath,
            original_name: originalName,
            content_type: actualType,
            size_bytes: Number.isFinite(actualSize) ? actualSize : sizeBytes,
            is_public: record.status === "published" && record.visibility === "public"
          },
          prefer: "return=representation"
        });
      } catch (error) {
        try { await deleteStoredObject("cpo-private-documents", objectPath); } catch {}
        throw error;
      }
      return sendJson(response, 201, { file: inserted?.[0] || null }), true;
    }

    const publicationMatch = pathname.match(/^\/api\/staff\/publications\/([0-9a-f-]{36})$/i);
    if (publicationMatch && ["PATCH", "DELETE"].includes(method)) {
      if (!requireSameOrigin(request, response)) return true;
      const identity = await authenticatedStaff(request, response);
      if (!identity) return true;
      if (!UUID_PATTERN.test(publicationMatch[1])) return sendJson(response, 400, { error: "Identifiant invalide." }), true;
      const filter = `id=eq.${encodeURIComponent(publicationMatch[1])}`;
      if (method === "DELETE") {
        const rows = await postgrest(`publications?${filter}`, { method: "PATCH", accessToken: identity.accessToken, body: { status: "archived" }, prefer: "return=representation" });
        if (!rows?.length) return sendJson(response, 404, { error: "Publication introuvable ou accès refusé." }), true;
        await syncPublicationFiles(publicationMatch[1], identity.accessToken, false);
        await recordAudit(identity.user.id, "publication.archived", "publication", publicationMatch[1]);
        return sendJson(response, 200, { item: rows[0] }), true;
      }
      const updates = publicationInput(await readJson(request), { partial: true });
      const rows = await postgrest(`publications?${filter}`, { method: "PATCH", accessToken: identity.accessToken, body: updates, prefer: "return=representation" });
      if (!rows?.length) return sendJson(response, 404, { error: "Publication introuvable ou accès refusé." }), true;
      await syncPublicationFiles(publicationMatch[1], identity.accessToken, rows[0].status === "published" && rows[0].visibility === "public");
      await recordAudit(identity.user.id, "publication.updated", "publication", publicationMatch[1], { status: rows[0].status, visibility: rows[0].visibility, locale: rows[0].locale });
      return sendJson(response, 200, { item: rows[0] }), true;
    }

    if (pathname === "/api/staff/teachers" && method === "GET") {
      const identity = await authenticatedStaff(request, response, ["admin"]);
      if (!identity) return true;
      const teachers = await postgrest("profiles?select=id,role,full_name,teacher_code,subject,is_active,must_change_password,created_at&order=created_at.desc", { admin: true });
      return sendJson(response, 200, { teachers }), true;
    }

    if (pathname === "/api/staff/teachers" && method === "POST") {
      if (!requireSameOrigin(request, response)) return true;
      const identity = await authenticatedStaff(request, response, ["admin"]);
      if (!identity) return true;
      const input = await readJson(request, 12 * 1024);
      const fullName = safeString(input.full_name, 160, "Nom complet", { required: true });
      const email = safeString(input.email, 254, "Adresse e-mail", { required: true }).toLowerCase();
      const teacherCode = safeString(input.teacher_code, 40, "Identifiant professeur", { required: true });
      const subject = safeString(input.subject, 100, "Matière");
      const password = input.temporary_password;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Object.assign(new Error("Adresse e-mail invalide."), { status: 400 });
      if (typeof password !== "string" || password.length < 12 || password.length > 128) throw Object.assign(new Error("Le mot de passe temporaire doit contenir au moins 12 caractères."), { status: 400 });
      const created = await authRequest("admin/users", { method: "POST", admin: true, body: { email, password, email_confirm: true, user_metadata: { full_name: fullName } } });
      try {
        const profiles = await postgrest("profiles", { method: "POST", admin: true, body: { id: created.id, role: "teacher", full_name: fullName, teacher_code: teacherCode, subject: subject || null, is_active: true, must_change_password: true }, prefer: "return=representation" });
        await postgrest("audit_log", { method: "POST", admin: true, body: { actor_id: identity.user.id, action: "teacher.created", target_type: "profile", target_id: created.id, metadata: { teacher_code: teacherCode } }, prefer: "return=minimal" });
        return sendJson(response, 201, { teacher: profiles?.[0] || null }), true;
      } catch (error) {
        try { await authRequest(`admin/users/${encodeURIComponent(created.id)}`, { method: "DELETE", admin: true }); } catch {}
        throw error;
      }
    }

    const teacherMatch = pathname.match(/^\/api\/staff\/teachers\/([0-9a-f-]{36})$/i);
    if (teacherMatch && method === "PATCH") {
      if (!requireSameOrigin(request, response)) return true;
      const identity = await authenticatedStaff(request, response, ["admin"]);
      if (!identity) return true;
      if (!UUID_PATTERN.test(teacherMatch[1])) return sendJson(response, 400, { error: "Identifiant invalide." }), true;
      const input = await readJson(request, 4 * 1024);
      if (typeof input.is_active !== "boolean") throw Object.assign(new Error("Statut de compte invalide."), { status: 400 });
      const rows = await postgrest(`profiles?id=eq.${encodeURIComponent(teacherMatch[1])}&role=eq.teacher`, { method: "PATCH", admin: true, body: { is_active: input.is_active }, prefer: "return=representation" });
      if (!rows?.length) return sendJson(response, 404, { error: "Compte professeur introuvable." }), true;
      await postgrest("audit_log", { method: "POST", admin: true, body: { actor_id: identity.user.id, action: input.is_active ? "teacher.activated" : "teacher.suspended", target_type: "profile", target_id: teacherMatch[1] }, prefer: "return=minimal" });
      return sendJson(response, 200, { teacher: rows[0] }), true;
    }

    if (pathname === "/api/staff/results" && method === "GET") {
      const identity = await authenticatedStaff(request, response, ["admin"]);
      if (!identity) return true;
      const results = await postgrest("school_results?select=id,exam_name,student_name,student_identifier,result_value,class_id,published_at,created_at&order=created_at.desc&limit=200", { admin: true });
      return sendJson(response, 200, { results }), true;
    }

    if (pathname === "/api/staff/results" && method === "POST") {
      if (!requireSameOrigin(request, response)) return true;
      const identity = await authenticatedStaff(request, response, ["admin"]);
      if (!identity) return true;
      const input = await readJson(request, 12 * 1024);
      const examName = safeString(input.exam_name, 180, "Nom de l'examen", { required: true });
      const studentName = safeString(input.student_name, 180, "Nom de l'élève", { required: true });
      const studentIdentifier = safeString(input.student_identifier, 100, "Identifiant élève");
      const resultValue = safeString(input.result_value, 120, "Résultat", { required: true });
      const classId = input.class_id || null;
      if (classId && !UUID_PATTERN.test(classId)) throw Object.assign(new Error("Classe invalide."), { status: 400 });
      const results = await postgrest("school_results", { method: "POST", admin: true, body: { created_by: identity.user.id, exam_name: examName, student_name: studentName, student_identifier: studentIdentifier || null, result_value: resultValue, class_id: classId }, prefer: "return=representation" });
      await postgrest("audit_log", { method: "POST", admin: true, body: { actor_id: identity.user.id, action: "result.created", target_type: "school_result", target_id: results?.[0]?.id || null, metadata: { class_id: classId } }, prefer: "return=minimal" });
      return sendJson(response, 201, { result: results?.[0] || null }), true;
    }

    return sendJson(response, 404, { error: "Route CPO inconnue." }), true;
  } catch (error) {
    jsonError(response, error);
    return true;
  }
}
