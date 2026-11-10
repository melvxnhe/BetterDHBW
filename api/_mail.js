// The e-mails the accounts send, and how they leave: through Resend
// (RESEND_API_KEY + MAIL_FROM), else SMTP (SMTP_USER + SMTP_PASS, Gmail by
// default), else, in local development only, into the server console.

import { Problem } from './_http.js';

const SIGNATURE = 'Stundenpläne der DHBW Mannheim (inoffiziell)';
const FAILED = () => new Problem(502, 'mail-failed', 'Die E-Mail konnte gerade nicht verschickt werden. Bitte später noch einmal versuchen.');

// Where e-mail links point. Never derived from the request's Host header, so
// a forged Host can't redirect a reset link.
export function appUrl(ctx) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '');
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (ctx.dev && ctx.origin) return ctx.origin;
  throw new Problem(503, 'no-app-url', 'APP_URL ist nicht gesetzt.');
}

// ---------- what they say ----------

// Each mail: a subject, a few lines and one link. Tokens go in the URL
// fragment, which never reaches a server log or a Referer header.
export const MAILS = {
  // sign-up with an address that already has an account
  taken: (app) => ({
    subject: 'Du hast schon ein Konto',
    lines: ['Jemand (vielleicht du) wollte sich mit dieser Adresse registrieren. Du hast aber schon ein Konto.', 'Passwort vergessen? Über den Link kannst du ein neues setzen. Warst du das nicht, kannst du die Mail ignorieren.'],
    linkLabel: 'Passwort zurücksetzen',
    link: `${app}/?konto=vergessen`,
  }),
  verify: (app, token) => ({
    subject: 'Bestätige dein Konto',
    lines: ['Willkommen! Bestätige deine Adresse, dann ist dein Konto fertig und du bist angemeldet.', 'Der Link gilt 24 Stunden. Hast du dich nicht registriert, ignoriere diese Mail einfach.'],
    linkLabel: 'Konto bestätigen',
    link: `${app}/?konto=bestaetigen#token=${token}`,
  }),
  reset: (app, token) => ({
    subject: 'Neues Passwort setzen',
    lines: ['Über den Link setzt du ein neues Passwort. Danach bist du auf allen anderen Geräten abgemeldet.', 'Der Link gilt eine Stunde. Hast du das nicht angefordert, ignoriere diese Mail; dein Passwort bleibt, wie es ist.'],
    linkLabel: 'Neues Passwort setzen',
    link: `${app}/?konto=passwort#token=${token}`,
  }),
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const textOf = ({ lines, link, linkLabel }) => [...lines, '', link ? `${linkLabel}: ${link}` : '', '', SIGNATURE].join('\n');

const htmlOf = ({ lines, link, linkLabel }) => `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#1d1d1f">${lines.map((l) => `<p>${esc(l)}</p>`).join('')}${link
  ? `<p><a href="${esc(link)}" style="display:inline-block;padding:10px 16px;border-radius:10px;background:#1d1d1f;color:#fff;text-decoration:none">${esc(linkLabel)}</a></p><p style="color:#6e6e73;font-size:13px">Oder diesen Link öffnen: ${esc(link)}</p>`
  : ''}<p style="color:#6e6e73;font-size:13px">${SIGNATURE}</p></div>`;

// ---------- how they leave ----------

async function viaResend(message) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...message, from: process.env.MAIL_FROM, to: [message.to] }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw FAILED();
}

// By default Gmail: SMTP_USER is the address, SMTP_PASS a Google app password.
async function viaSmtp(message) {
  const { createTransport } = await import('nodemailer');
  const port = Number(process.env.SMTP_PORT || 465);
  const transport = createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com', port, secure: port === 465, requireTLS: port !== 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS.replace(/\s+/g, '') }, // app passwords are shown with spaces
    connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 10000,
  });
  try {
    await transport.sendMail({ ...message, from: process.env.MAIL_FROM || `Stundenplan DHBW Mannheim <${process.env.SMTP_USER}>` });
  } catch (err) {
    console.error('smtp', err.code || err.message); // "EAUTH", "ESOCKET", …: enough to find the cause in the logs
    throw FAILED();
  }
}

// `mail` is one of MAILS' results.
export async function sendMail(ctx, to, mail) {
  const message = { to, subject: mail.subject, text: textOf(mail), html: htmlOf(mail) };
  if (process.env.RESEND_API_KEY && process.env.MAIL_FROM) return viaResend(message);
  if (process.env.SMTP_USER && process.env.SMTP_PASS) return viaSmtp(message);
  // local development: no mail service, the link goes to the server console
  if (ctx.dev) return void console.log(`\n[Mail an ${to}] ${message.subject}\n${message.text}\n`);
  throw new Problem(503, 'mail-not-configured', 'Der E-Mail-Versand ist noch nicht eingerichtet. Registrieren geht erst danach.');
}
