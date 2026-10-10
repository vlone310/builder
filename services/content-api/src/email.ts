import { appendFile } from "node:fs/promises";
import { createTransport } from "nodemailer";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export type EmailSender = (message: EmailMessage) => Promise<void>;

/** Sends through an SMTP server, e.g. smtp://user:pass@mail.example.com:587. */
export function smtpSender({ url, from }: { url: string; from: string }): EmailSender {
  const transport = createTransport(url);
  return async (message) => {
    await transport.sendMail({ from, ...message });
  };
}

/** Development: prints the email, links included, to the server log. */
export function consoleSender(): EmailSender {
  return async (message) => {
    console.log(
      `[email] to=${message.to} subject=${JSON.stringify(message.subject)}\n${message.text}`,
    );
  };
}

/** Development and e2e: appends each email as a JSON line to a file. */
export function fileSender(path: string): EmailSender {
  return async (message) => {
    await appendFile(path, `${JSON.stringify({ ...message, sentAt: new Date().toISOString() })}\n`);
  };
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** A one-link email in plain text and minimal HTML. */
export function linkEmail(input: {
  to: string;
  subject: string;
  intro: string;
  action: string;
  url: string;
  outro: string;
}): EmailMessage {
  return {
    to: input.to,
    subject: input.subject,
    text: `${input.intro}\n\n${input.action}: ${input.url}\n\n${input.outro}\n`,
    html: `<p>${escapeHtml(input.intro)}</p><p><a href="${escapeHtml(input.url)}">${escapeHtml(input.action)}</a></p><p style="color:#666">${escapeHtml(input.outro)}</p>`,
  };
}
