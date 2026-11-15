// Sends one real test email through Peblo's own mailer, to check the mail setup before relying on it.
// Run in PowerShell from the repo root (build first: node scripts/_b2.mjs):
//   $env:BREVO_API_KEY='xkeysib-...'; $env:MAIL_FROM='Peblo <you@gmail.com>'; node scripts/mail-test.mjs you@gmail.com
// The key is read from your shell only; nothing is written to disk.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const to = process.argv[2];
if (!to) { console.error('Usage: node scripts/mail-test.mjs <address to send the test to>'); process.exit(2); }
const dist = process.env.PEBLO_SERVER_DIST || 'dist2';
const { sendMail, mailMode } = await import(pathToFileURL(path.resolve(dist, 'server', 'services', 'mailer.js')).href);
console.log('mail mode:', mailMode() || 'not set up');
const ok = await sendMail({ to, subject: 'Peblo mail test', text: 'If you can read this, Peblo can send mail.' });
console.log(ok ? `Sent to ${to}. Check the inbox (and Spam).` : 'Not sent. The line above starting with [mail] says why.');
process.exit(ok ? 0 : 1);
