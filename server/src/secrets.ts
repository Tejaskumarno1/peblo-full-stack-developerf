import crypto from 'crypto';

/*
 * Encrypts secrets (users' AI provider keys) before they are written to the database, so a
 * leaked database dump or backup does not leak the keys. AES-256-GCM; the key is derived from
 * KEY_ENCRYPTION_SECRET, or from JWT_SECRET when that is not set.
 */
const PREFIX = 'enc:v1:';

function masterKey(): Buffer {
  const secret = process.env.KEY_ENCRYPTION_SECRET || process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me';
  return crypto.createHash('sha256').update(`peblo-keys:${secret}`).digest();
}

export function isEncrypted(value: string | null | undefined): boolean {
  return !!value && value.startsWith(PREFIX);
}

export function encryptSecret(plain: string | null | undefined): string | null {
  const text = (plain ?? '').trim();
  if (!text) return null;
  if (isEncrypted(text)) return text;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + [iv, tag, data].map((b) => b.toString('base64')).join(':');
}

/** Returns the original text. Values saved before encryption existed pass through unchanged. */
export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (!isEncrypted(stored)) return stored;
  try {
    const [iv, tag, data] = stored.slice(PREFIX.length).split(':').map((s) => Buffer.from(s, 'base64'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    // Wrong secret (it was changed) or damaged value: treat as no key rather than crashing.
    return null;
  }
}
