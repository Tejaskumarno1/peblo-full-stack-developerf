import tls from 'node:tls';
import { appendFileSync } from 'node:fs';
import type { Request } from 'express';

/*
 * Sends the few emails Peblo needs (confirm an address, a change of address). No extra package:
 *  - SMTP_HOST + SMTP_USER + SMTP_PASS (port 465, TLS): works with Gmail (use an App Password), Outlook, any host.
 *  - RESEND_API_KEY: the Resend HTTPS API.
 *  - MAIL_OUTBOX=<file>: tests only; each mail is written to that file as one JSON line and nothing is sent.
 * MAIL_FROM is the "From" address (defaults to SMTP_USER). Without any of these, mail is simply "not set up"
 * and the app says so plainly instead of pretending.
 */
export type Mail = { to: string; subject: string; text: string; html?: string };

export function mailMode(): 'outbox' | 'resend' | 'smtp' | null {
  if (process.env.MAIL_OUTBOX) return 'outbox';
  if (process.env.RESEND_API_KEY) return 'resend';
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) return 'smtp';
  return null;
}
export const mailConfigured = () => mailMode() !== null;

/** The address links in emails point at: the hosted app, never this computer's own address (same rule as /api/config). */
export function publicBase(req: Request): string {
  const configured = (process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '');
  const host = req.get('host') || '';
  const local = /^(localhost|127\.|\[::1\])/.test(host);
  return configured || (local ? 'https://peblo-stxo.onrender.com' : `${req.protocol}://${host}`);
}

const clean = (s: string) => String(s).replace(/[\r\n]+/g, ' ').trim();
const fromAddress = () => clean(process.env.MAIL_FROM || process.env.SMTP_USER || 'Peblo <no-reply@peblo.app>');
const bareAddress = (s: string) => (s.match(/<([^>]+)>/)?.[1] || s).trim();

/** Talks SMTP over an implicit-TLS connection (port 465). Resolves when the server accepted the message. */
function smtpSend(mail: Mail): Promise<void> {
  const host = process.env.SMTP_HOST!;
  const port = Number(process.env.SMTP_PORT) || 465;
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port, servername: host });
    socket.setTimeout(20_000, () => { socket.destroy(); reject(new Error('The mail server did not answer in time.')); });
    let buf = '';
    let waiter: ((code: number, text: string) => void) | null = null;
    const check = () => {
      // A reply ends at a line whose 4th character is a space ("250 OK"); "250-..." lines continue it.
      const lines = buf.split('\r\n');
      for (let i = 0; i < lines.length - 1; i++) {
        if (/^\d{3} /.test(lines[i]) || /^\d{3}$/.test(lines[i])) {
          const text = lines.slice(0, i + 1).join('\n');
          buf = lines.slice(i + 1).join('\r\n');
          const w = waiter; waiter = null;
          w?.(Number(lines[i].slice(0, 3)), text);
          return;
        }
      }
    };
    socket.on('data', (d) => { buf += d.toString('utf8'); check(); });
    socket.on('error', reject);
    const reply = () => new Promise<{ code: number; text: string }>((res) => { waiter = (code, text) => res({ code, text }); check(); });
    const say = async (line: string, ok: number[]) => {
      socket.write(`${line}\r\n`);
      const r = await reply();
      if (!ok.includes(r.code)) throw new Error(`Mail server said: ${r.text.split('\n').pop()}`);
    };
    (async () => {
      const banner = await reply();
      if (banner.code !== 220) throw new Error('The mail server refused the connection.');
      await say(`EHLO peblo`, [250]);
      await say('AUTH LOGIN', [334]);
      await say(Buffer.from(process.env.SMTP_USER!).toString('base64'), [334]);
      await say(Buffer.from(process.env.SMTP_PASS!).toString('base64'), [235]);
      await say(`MAIL FROM:<${bareAddress(fromAddress())}>`, [250]);
      await say(`RCPT TO:<${bareAddress(clean(mail.to))}>`, [250, 251]);
      await say('DATA', [354]);
      const boundary = `peblo-${Date.now().toString(36)}`;
      const body = [
        `From: ${fromAddress()}`, `To: ${clean(mail.to)}`, `Subject: =?UTF-8?B?${Buffer.from(clean(mail.subject)).toString('base64')}?=`,
        'MIME-Version: 1.0', `Content-Type: multipart/alternative; boundary="${boundary}"`, '',
        `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', Buffer.from(mail.text).toString('base64').replace(/(.{76})/g, '$1\r\n'),
        ...(mail.html ? [`--${boundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', Buffer.from(mail.html).toString('base64').replace(/(.{76})/g, '$1\r\n')] : []),
        `--${boundary}--`,
      ].join('\r\n');
      socket.write(`${body}\r\n.\r\n`);
      const done = await reply();
      if (done.code !== 250) throw new Error(`Mail server said: ${done.text.split('\n').pop()}`);
      socket.write('QUIT\r\n');
      socket.end();
    })().then(resolve, (e) => { socket.destroy(); reject(e); });
  });
}

/** Returns true when the mail was handed to the provider. Never throws: callers decide what to tell the person. */
export async function sendMail(mail: Mail): Promise<boolean> {
  const mode = mailMode();
  try {
    if (mode === 'outbox') { appendFileSync(process.env.MAIL_OUTBOX!, `${JSON.stringify(mail)}\n`); return true; }
    if (mode === 'resend') {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: fromAddress(), to: [clean(mail.to)], subject: clean(mail.subject), text: mail.text, html: mail.html }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!r.ok) throw new Error(`Resend answered ${r.status}`);
      return true;
    }
    if (mode === 'smtp') { await smtpSend(mail); return true; }
  } catch (e: any) {
    console.error('[mail] could not send:', e?.message || e);
  }
  return false;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const shell = (title: string, intro: string, link: string, button: string, outro: string) => ({
  html: `<div style="font-family:system-ui,Segoe UI,sans-serif;max-width:480px;margin:auto;padding:24px;color:#2b2118"><h2 style="margin:0 0 12px">${esc(title)}</h2><p>${esc(intro)}</p><p><a href="${esc(link)}" style="display:inline-block;background:#c2410c;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:700">${esc(button)}</a></p><p style="font-size:13px;color:#6b5d50">Or paste this address into your browser:<br>${esc(link)}</p><p style="font-size:13px;color:#6b5d50">${esc(outro)}</p></div>`,
  text: `${title}\n\n${intro}\n\n${link}\n\n${outro}`,
});

export function verifyEmailMail(to: string, link: string): Mail {
  const m = shell('Confirm your email', 'Press the button to confirm this address for your Peblo account. The link works once and expires in 24 hours.', link, 'Confirm my email', 'If you did not ask for this, you can ignore this email.');
  return { to, subject: 'Confirm your email for Peblo', ...m };
}
export function changeEmailMail(to: string, link: string): Mail {
  const m = shell('Confirm your new email', 'Someone asked to move a Peblo account to this address. Press the button to finish the change. The link works once and expires in 24 hours.', link, 'Use this email', 'If this was not you, ignore this email: nothing changes until the link is opened.');
  return { to, subject: 'Confirm your new email for Peblo', ...m };
}
export function emailChangedNotice(to: string, newEmail: string): Mail {
  return { to, subject: 'Your Peblo email was changed', text: `The sign-in email for your Peblo account was changed to ${newEmail}.\n\nIf this was not you, sign in and change your password right away.` };
}
