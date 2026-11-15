/** Shared rules for names, email addresses and passwords, used by sign-up, the profile and password changes. */

// One "@", no spaces, no empty parts: "a@b..com", ".a@b.com" and "a@b." are all refused.
const EMAIL_RE = /^[^\s@.]+(?:\.[^\s@.]+)*@[^\s@.]+(?:\.[^\s@.]+)+$/;
export function validEmail(email: string): boolean {
  return email.length <= 254 && EMAIL_RE.test(email);
}

// Passwords nobody should be allowed to pick (lower case; compared after lower-casing).
const COMMON = new Set([
  'password', 'password1', 'password12', 'password123', 'passw0rd', 'p@ssw0rd', '12345678', '123456789', '1234567890', '11111111', '00000000',
  'qwertyui', 'qwerty123', 'qwertyuiop', 'iloveyou', 'letmein1', 'abcd1234', 'admin123', 'welcome1', 'changeme', 'abc12345', '987654321', '88888888',
]);

/** The rules for a new password, shared by sign-up, change and reset. null = fine. */
export function passwordProblem(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters.';
  if (Buffer.byteLength(password, 'utf8') > 72) return 'Password is too long (72 bytes at most; some characters count as more than one).';
  if (password.trim().length === 0) return 'Password cannot be only spaces.';
  if (COMMON.has(password.toLowerCase())) return 'That password is too common. Choose something harder to guess.';
  return null;
}

/** A display name: trimmed, 1 to 80 characters. Returns the clean name, or an error message. */
export function cleanName(raw: unknown): { name: string } | { error: string } {
  if (typeof raw !== 'string') return { error: 'Name must be text.' };
  const name = raw.replace(/\s+/g, ' ').trim();
  if (!name) return { error: 'Your name cannot be empty.' };
  return { name: name.slice(0, 80) };
}

/** A username: 3 to 30 of a-z 0-9 _ . (a leading @ is ignored). '' means "none". */
export function cleanUsername(raw: unknown): { username: string | null } | { error: string } {
  if (raw === null || raw === '') return { username: null };
  if (typeof raw !== 'string') return { error: 'Username must be text.' };
  const u = raw.trim().replace(/^@/, '').toLowerCase();
  if (!u) return { username: null };
  if (!/^[a-z0-9_.]{3,30}$/.test(u) || /^[._]|[._]$|[._]{2}/.test(u)) return { error: 'Username can use letters, numbers, dots and underscores (3 to 30), with no leading, trailing or doubled dots.' };
  return { username: u };
}

export const LANGUAGES = ['en'];
export const DELETION_GRACE_DAYS = 30;
