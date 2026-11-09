import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { handleSupabaseRoute, isSupabaseConfigured } from "./supabase.js";
import { FixedWindowRateLimiter } from "./rate-limit.js";
import { getContactEmailStatus, sendContactEmail } from "./email-sender.js";

dotenv.config();

const rootDirectory = fileURLToPath(new URL("../cpo_frontend", import.meta.url));
const port = Number(process.env.PORT || 8000);
const appUrl = process.env.APP_URL || "http://localhost:8000";
const maxBodySize = 20 * 1024;
const contactRateLimiter = new FixedWindowRateLimiter();

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

async function readRequestBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body, "utf8") > maxBodySize) throw new Error("REQUEST_TOO_LARGE");
  }
  return JSON.parse(body);
}

async function handleContact(request, response) {
  try {
    const { name, email, subject, message } = await readRequestBody(request);
    const cleanName = name?.trim();
    const cleanEmail = email?.trim();
    const cleanMessage = message?.trim();
    if (!cleanName || !cleanEmail || !cleanMessage) return sendJson(response, 400, { error: "Tous les champs sont obligatoires." });
    if (cleanName.length > 120 || cleanEmail.length > 254 || cleanMessage.length > 5000) return sendJson(response, 413, { error: "Le message est trop long." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return sendJson(response, 400, { error: "L'adresse e-mail n'est pas valide." });
    const limit = contactRateLimiter.consume(cleanEmail.toLowerCase(), { limit: 3, windowMs: 10 * 60 * 1000 });
    if (!limit.allowed) {
      response.writeHead(429, { "Content-Type": "application/json; charset=utf-8", "Retry-After": String(limit.retryAfterSeconds) });
      return response.end(JSON.stringify({ error: "Trop de messages ont été envoyés depuis cette adresse. Réessayez un peu plus tard." }));
    }
    await sendContactEmail({ name: cleanName, email: cleanEmail, subject, message: cleanMessage });
    return sendJson(response, 200, { message: "Message envoye avec succes." });
  } catch (error) {
    if (error.message === "REQUEST_TOO_LARGE") return sendJson(response, 413, { error: "La requête est trop volumineuse." });
    if (error instanceof SyntaxError) return sendJson(response, 400, { error: "Le format de la requête est invalide." });
    const code = error.code || "EMAIL_SEND_FAILED";
    console.error("Contact email error:", code);
    const status = error.status === 503 ? 503 : 502;
    const errorMessage = error.status === 503
      ? "Le service d’envoi n’est pas encore configuré dans Render."
      : error.code?.startsWith("BREVO_")
        ? "Brevo n’a pas accepté l’envoi. Vérifiez que l’expéditeur est validé dans Brevo et que la clé API est correcte."
        : "Le service e-mail est temporairement indisponible. Réessayez plus tard ou écrivez directement à l’adresse indiquée.";
    return sendJson(response, status, { error: errorMessage, code });
  }
}

async function serveStatic(request, response) {
  const pathname = new URL(request.url, appUrl).pathname;
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = resolve(rootDirectory, `.${requestedPath}`);
  if (filePath !== rootDirectory && !filePath.startsWith(`${rootDirectory}${sep}`)) return sendJson(response, 403, { error: "Acces refuse." });
  try {
    const content = await readFile(filePath);
    const contentTypes = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" };
    response.writeHead(200, { "Cache-Control": "no-store", "Content-Type": `${contentTypes[extname(filePath)] || "application/octet-stream"}; charset=utf-8` });
    response.end(content);
  } catch {
    sendJson(response, 404, { error: "Ressource introuvable." });
  }
}

const server = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/api/health") {
    return sendJson(response, 200, {
      status: "ok",
      service: "cpo-contact-server",
      appUrl,
      contactEmail: getContactEmailStatus(),
      supabaseConfigured: isSupabaseConfigured(),
      timestamp: new Date().toISOString()
    });
  }
  if (request.method === "POST" && request.url === "/api/contact") return handleContact(request, response);
  const requestUrl = new URL(request.url, appUrl);
  if (await handleSupabaseRoute(request, response, requestUrl)) return;
  if (request.method === "GET") return serveStatic(request, response);
  sendJson(response, 405, { error: "Methode non autorisee." });
});

server.listen(port, () => console.log(`CPO server running at http://localhost:${port}`));
