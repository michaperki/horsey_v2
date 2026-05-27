// Thin Resend HTTP client. No SDK — keeps ADR 0001's dependency-light
// preference. Reads RESEND_API_KEY + EMAIL_FROM from env. When the API key
// is unset (local dev), emails fall through to a console log so the surface
// is observable without delivery.
//
// Set in production via:
//   fly secrets set RESEND_API_KEY=re_... EMAIL_FROM='Horsey <onboarding@resend.dev>'
//
// Resend's onboarding@resend.dev sender works for dev without owning a
// domain; switch to a verified domain when one is brought online.

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export function emailDeliveryConfig() {
  return {
    apiKey: process.env.RESEND_API_KEY || null,
    from: process.env.EMAIL_FROM || "Horsey <onboarding@resend.dev>",
    appUrl: process.env.HORSEY_APP_URL || "http://127.0.0.1:8787"
  };
}

// Tests replace this sink to capture dry-run sends without scraping logs.
// The default sink is silent so test runs (which trigger signups but may
// not install their own sink) don't pollute output. Local dev can opt into
// terminal logging by setting HORSEY_EMAIL_DRY_RUN_LOG=1 — both the
// `npm run dev` scripts do this, so a developer signing up locally can
// copy the verification link straight from the terminal.
let dryRunSink = (entry) => {
  if (process.env.HORSEY_EMAIL_DRY_RUN_LOG === "1") {
    console.log(`[email:dry-run] to=${entry.to} subject=${JSON.stringify(entry.subject)}\n${entry.text || entry.html}`);
  }
};

export function setEmailDryRunSink(sink) {
  const previous = dryRunSink;
  dryRunSink = typeof sink === "function" ? sink : previous;
  return () => { dryRunSink = previous; };
}

export async function sendEmail({ to, subject, html, text }, fetchImpl = globalThis.fetch) {
  const config = emailDeliveryConfig();
  if (!config.apiKey) {
    // Local dev: log the email instead of sending. Useful for inspecting
    // verification / reset links without setting up Resend.
    dryRunSink({ to, subject, html, text });
    return { delivered: false, dryRun: true };
  }
  const response = await fetchImpl(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({ from: config.from, to, subject, html, text })
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const err = new Error(`Resend rejected the email (HTTP ${response.status}): ${body || "no body"}`);
    err.code = "email_delivery_failed";
    err.status = response.status;
    throw err;
  }
  return { delivered: true, dryRun: false };
}

export function verifyEmailBody({ handle, link }) {
  return {
    subject: "Verify your Horsey email",
    text: `Hi ${handle},\n\nClick the link below to verify your email and unlock the full Horsey loop:\n\n${link}\n\nThis link expires in 7 days. If you didn't sign up for Horsey, you can ignore this email.\n`,
    html: `
      <p>Hi ${escapeHtml(handle)},</p>
      <p>Click the link below to verify your email and unlock the full Horsey loop:</p>
      <p><a href="${link}">${link}</a></p>
      <p>This link expires in 7 days. If you didn't sign up for Horsey, you can ignore this email.</p>
    `
  };
}

export function passwordResetBody({ handle, link }) {
  return {
    subject: "Reset your Horsey password",
    text: `Hi ${handle},\n\nClick the link below to choose a new password:\n\n${link}\n\nThis link expires in 1 hour. If you didn't request a reset, you can ignore this email — your current password still works.\n`,
    html: `
      <p>Hi ${escapeHtml(handle)},</p>
      <p>Click the link below to choose a new password:</p>
      <p><a href="${link}">${link}</a></p>
      <p>This link expires in 1 hour. If you didn't request a reset, you can ignore this email — your current password still works.</p>
    `
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
