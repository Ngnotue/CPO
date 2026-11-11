import nodemailer from "nodemailer";
import { formatContactSubject } from "../cpo_frontend/contact-subject.js";

const BREVO_EMAIL_ENDPOINT = "https://api.brevo.com/v3/smtp/email";
const DEFAULT_CONTACT_RECIPIENT = "nnoguem@gmail.com";
const BREVO_TIMEOUT_MS = 10_000;

export function getContactEmailStatus(env = process.env) {
  const brevoConfigured = Boolean(env.BREVO_API_KEY);
  return {
    provider: brevoConfigured ? "brevo" : "smtp",
    configured: brevoConfigured
      ? Boolean(env.BREVO_SENDER_EMAIL || env.SMTP_USER)
      : Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASSWORD)
  };
}

function makeError(message, code, status = 502) {
  return Object.assign(new Error(message), { code, status });
}

function buildMessage({ name, email, subject, message }, recipient) {
  const cleanSubject = formatContactSubject(subject);
  const cleanName = name.replace(/[\r\n]+/g, " ").trim();
  return {
    recipient,
    subject: `CPO - ${cleanSubject} - ${cleanName}`,
    text: `Nom : ${cleanName}\nE-mail : ${email}\nObjet : ${cleanSubject}\n\n${message}`
  };
}

async function sendWithBrevo(message, env, fetchImpl) {
  const senderEmail = env.BREVO_SENDER_EMAIL || env.SMTP_USER;
  if (!senderEmail) {
    throw makeError("Configurez l’adresse d’expéditeur Brevo.", "BREVO_SENDER_NOT_CONFIGURED", 503);
  }

  let response;
  try {
    response = await fetchImpl(BREVO_EMAIL_ENDPOINT, {
      method: "POST",
      headers: {
        accept: "application/json",
        "api-key": env.BREVO_API_KEY,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        sender: { email: senderEmail, name: env.BREVO_SENDER_NAME || "CPO | Collège Privé de l’Ouest" },
        to: [{ email: message.recipient }],
        replyTo: { email: message.replyTo },
        subject: message.subject,
        textContent: message.text
      }),
      signal: AbortSignal.timeout(BREVO_TIMEOUT_MS)
    });
  } catch (error) {
    const code = error?.name === "TimeoutError" || error?.name === "AbortError" ? "BREVO_TIMEOUT" : "BREVO_NETWORK_ERROR";
    throw makeError("Impossible de joindre le service d’envoi Brevo.", code);
  }

  if (!response.ok) {
    throw makeError("Brevo a refusé le message. Vérifiez la clé API et l’expéditeur vérifié dans Brevo.", `BREVO_HTTP_${response.status}`);
  }
  return { provider: "brevo" };
}

async function sendWithSmtp(message, env) {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASSWORD) {
    throw makeError("Configurez BREVO_API_KEY et BREVO_SENDER_EMAIL dans Render.", "EMAIL_PROVIDER_NOT_CONFIGURED", 503);
  }

  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT || 465),
    secure: String(env.SMTP_SECURE || "true") === "true",
    tls: { rejectUnauthorized: true },
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD.replace(/\s+/g, "") }
  });
  await transporter.sendMail({
    from: env.SMTP_USER,
    to: message.recipient,
    replyTo: message.replyTo,
    subject: message.subject,
    text: message.text
  });
  return { provider: "smtp" };
}

export async function sendContactEmail({ name, email, subject, message }, {
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const mail = buildMessage({ name, email, subject, message }, env.CONTACT_RECIPIENT || DEFAULT_CONTACT_RECIPIENT);
  mail.replyTo = email;
  if (env.BREVO_API_KEY) return sendWithBrevo(mail, env, fetchImpl);
  return sendWithSmtp(mail, env);
}