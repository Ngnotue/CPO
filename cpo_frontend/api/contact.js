import nodemailer from "nodemailer";
import "dotenv/config";

function sendJson(res, statusCode, payload) {
  res.status(statusCode).json(payload);
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    return sendJson(res, 200, {
      status: "ok",
      service: "cpo-contact-server",
      appUrl: process.env.APP_URL || "https://example.com",
      timestamp: new Date().toISOString()
    });
  }

  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Méthode non autorisée." });
  }

  try {
    const payload = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const { name, email, subject, message } = payload;
    const cleanName = String(name || "").trim();
    const cleanEmail = String(email || "").trim();
    const cleanMessage = String(message || "").trim();

    if (!cleanName || !cleanEmail || !cleanMessage) {
      return sendJson(res, 400, { error: "Tous les champs sont obligatoires." });
    }

    if (cleanName.length > 120 || cleanEmail.length > 254 || cleanMessage.length > 5000) {
      return sendJson(res, 413, { error: "Le message est trop long." });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return sendJson(res, 400, { error: "L'adresse e-mail n'est pas valide." });
    }

    const { SMTP_HOST, SMTP_USER, SMTP_PASSWORD } = process.env;
    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD) {
      return sendJson(res, 503, {
        error: "Le service e-mail n'est pas encore configuré. Ajoutez les variables SMTP dans Vercel."
      });
    }

    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 465),
      secure: String(process.env.SMTP_SECURE || "true") === "true",
      tls: {
        rejectUnauthorized: String(process.env.SMTP_TLS_REJECT_UNAUTHORIZED || "true") === "true"
      },
      auth: {
        user: SMTP_USER,
        pass: String(SMTP_PASSWORD).replace(/\s+/g, "")
      }
    });

    await transporter.sendMail({
      from: SMTP_USER,
      to: process.env.CONTACT_RECIPIENT || "nnoguem@gmail.com",
      replyTo: cleanEmail,
      subject: `CPO - ${subject || "Question générale"} - ${cleanName}`,
      text: `Nom : ${cleanName}\nE-mail : ${cleanEmail}\nObjet : ${subject || "Question générale"}\n\n${cleanMessage}`
    });

    return sendJson(res, 200, { message: "Message envoyé avec succès." });
  } catch (error) {
    console.error("Vercel contact error:", error);
    if (error instanceof SyntaxError) {
      return sendJson(res, 400, { error: "Le format de la requête est invalide." });
    }
    return sendJson(res, 500, { error: "Le message n'a pas pu être envoyé.", code: error.code || "SMTP_ERROR" });
  }
}
