'use strict';
// без SMTP_* в .env письмо не отправляется, а печатается в консоль (см. README)
const nodemailer = require('nodemailer');

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_SECURE = process.env.SMTP_SECURE === 'true';
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER || 'no-reply@bauman-stage-crew.local';

let transporter = null;
if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

async function sendMail({ to, subject, text }) {
  if (!transporter) {
    console.log('[mailer] SMTP не настроен (см. .env) — письмо ниже НЕ отправлено, только выведено в консоль:');
    console.log(`[mailer] Кому: ${to}\n[mailer] Тема: ${subject}\n[mailer] ---\n${text}\n[mailer] ---`);
    return { delivered: false };
  }
  try {
    await transporter.sendMail({ from: SMTP_FROM, to, subject, text });
    return { delivered: true };
  } catch (err) {
    console.error('[mailer] Не удалось отправить письмо через SMTP:', err.message);
    console.log(`[mailer] Содержимое недоставленного письма для ${to}:\n${text}`);
    return { delivered: false, error: err };
  }
}

module.exports = { sendMail, isConfigured: () => Boolean(transporter) };
