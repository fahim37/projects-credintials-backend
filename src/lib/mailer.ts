import nodemailer from "nodemailer";
import { env } from "../config/env.js";

const transport = env.SMTP_HOST
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    })
  : null;

export async function sendMail(to: string, subject: string, html: string, text: string) {
  if (!transport) {
    // No SMTP configured (local dev): print instead of sending.
    console.log(`\n[mail] to=${to} subject="${subject}"\n${text}\n`);
    return;
  }
  await transport.sendMail({ from: env.MAIL_FROM, to, subject, html, text });
}

export function sendOtpMail(to: string, name: string, otp: string) {
  const text = `Hi ${name},\n\nYour SCALEUP password reset code is ${otp}. It expires in ${env.OTP_TTL_MINUTES} minutes.\n\nIf you did not request this, you can ignore this email.`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px">
      <h2 style="color:#16a34a;margin:0 0 16px">SCALEUP</h2>
      <p>Hi ${escapeHtml(name)},</p>
      <p>Your password reset code is:</p>
      <p style="font-size:32px;letter-spacing:8px;font-weight:bold;margin:16px 0">${otp}</p>
      <p style="color:#666">It expires in ${env.OTP_TTL_MINUTES} minutes. If you did not request this, you can ignore this email.</p>
    </div>`;
  return sendMail(to, "Your SCALEUP password reset code", html, text);
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
