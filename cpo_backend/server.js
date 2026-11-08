import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import { handleSupabaseRoute, isSupabaseConfigured } from "./supabase.js";

dotenv.config();

const rootDirectory = fileURLToPath(new URL("../cpo_frontend", import.meta.url));
const port = Number(process.env.PORT || 8000);
const appUrl = process.env.APP_URL || "http://localhost:8000";
const recipient = process.env.CONTACT_RECIPIENT || "nnoguem@gmail.com";
const maxBodySize = 20 * 1024;

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function getTransporter() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE || "true") === "true",
    tls: { rejectUnauthorized: String(process.env.SMTP_TLS_REJECT_UNAUTHORIZED || "true") === "true" },
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD.replace(/\s+/g, "") }
  });
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
    const transporter = getTransporter();
    if (!transporter) return sendJson(response, 503, { error: "Le service e-mail n'est pas encore configure. Ajoutez les variables SMTP dans .env." });
    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: recipient,
      replyTo: cleanEmail,
      subject: `CPO - ${subject || "Question générale"} - ${cleanName}`,
      text: `Nom : ${cleanName}\nE-mail : ${cleanEmail}\nObjet : ${subject || "Question générale"}\n\n${cleanMessage}`
    });
    return sendJson(response, 200, { message: "Message envoye avec succes." });
  } catch (error) {
    if (error.message === "REQUEST_TOO_LARGE") return sendJson(response, 413, { error: "La requête est trop volumineuse." });
    if (error instanceof SyntaxError) return sendJson(response, 400, { error: "Le format de la requête est invalide." });
    console.error("Contact email error:", error.code || "UNKNOWN", error.message);
    return sendJson(response, 500, { error: "Le message n'a pas pu etre envoye.", code: error.code || "SMTP_ERROR" });
  }
}

async function serveStatic(request, response) {
  const requestedPath = request.url === "/" ? "/index.html" : request.url.split("?")[0];
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
