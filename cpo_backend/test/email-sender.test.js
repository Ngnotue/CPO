import test from "node:test";
import assert from "node:assert/strict";
import { getContactEmailStatus, sendContactEmail } from "../email-sender.js";

const contact = {
  name: "Parent Example",
  email: "parent@example.net",
  subject: "Demande d'admission",
  message: "Bonjour, je souhaite des informations."
};

test("mail health reports provider and readiness without exposing configuration", () => {
  assert.deepEqual(getContactEmailStatus({ BREVO_API_KEY: "secret", SMTP_USER: "verified@example.com" }), {
    provider: "brevo",
    configured: true
  });
  assert.deepEqual(getContactEmailStatus({ BREVO_API_KEY: "secret" }), { provider: "brevo", configured: false });
  assert.deepEqual(getContactEmailStatus({ SMTP_HOST: "smtp.example.com", SMTP_USER: "user", SMTP_PASSWORD: "secret" }), {
    provider: "smtp",
    configured: true
  });
});

test("Brevo API receives the message with verified sender and reply-to", async () => {
  let request;
  const result = await sendContactEmail(contact, {
    env: {
      BREVO_API_KEY: "test-key-do-not-log",
      BREVO_SENDER_EMAIL: "verified@cpo.example",
      BREVO_SENDER_NAME: "CPO",
      CONTACT_RECIPIENT: "office@cpo.example"
    },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ messageId: "test-message-id" }), { status: 201 });
    }
  });

  assert.equal(result.provider, "brevo");
  assert.equal(request.url, "https://api.brevo.com/v3/smtp/email");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers["api-key"], "test-key-do-not-log");
  const payload = JSON.parse(request.options.body);
  assert.deepEqual(payload.sender, { email: "verified@cpo.example", name: "CPO" });
  assert.deepEqual(payload.to, [{ email: "office@cpo.example" }]);
  assert.deepEqual(payload.replyTo, { email: contact.email });
  assert.equal(payload.textContent.includes(contact.message), true);
});

test("Brevo requires a verified sender address", async () => {
  await assert.rejects(
    sendContactEmail(contact, { env: { BREVO_API_KEY: "test-key-do-not-log" } }),
    (error) => error.code === "BREVO_SENDER_NOT_CONFIGURED" && error.status === 503
  );
});

test("Brevo API rejection returns a safe status code without exposing response body", async () => {
  await assert.rejects(
    sendContactEmail(contact, {
      env: { BREVO_API_KEY: "test-key-do-not-log", BREVO_SENDER_EMAIL: "verified@cpo.example" },
      fetchImpl: async () => new Response(JSON.stringify({ message: "private provider details" }), { status: 401 })
    }),
    (error) => error.code === "BREVO_HTTP_401" && !error.message.includes("private provider details")
  );
});

test("Brevo timeout is reported without exposing credentials", async () => {
  await assert.rejects(
    sendContactEmail(contact, {
      env: { BREVO_API_KEY: "test-key-do-not-log", BREVO_SENDER_EMAIL: "verified@cpo.example" },
      fetchImpl: async () => { throw Object.assign(new Error("request timed out"), { name: "TimeoutError" }); }
    }),
    (error) => error.code === "BREVO_TIMEOUT"
  );
});