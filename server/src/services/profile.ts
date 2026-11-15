import prisma from '../db.js';
import { decryptSecret, encryptSecret, isUnreadable } from '../secrets.js';
import { openAiModelOf, geminiModelOf } from './aiService.js';
import { providerById } from './aiProviders.js';
import { mailConfigured } from './mailer.js';

export const KEY_FIELDS = ['openAiKey', 'geminiKey', 'groqKey', 'huggingFaceKey'] as const;

/** What the app is shown instead of a saved key: bullets plus the last 4 characters. */
export const KEY_MASK = '••••••••';
export function maskKey(plain: string): string {
  return KEY_MASK + plain.slice(-4);
}

/**
 * The account as the signed-in person sees it. The AI keys live encrypted in their own table;
 * they are put back into `settings` here (decrypted, for the owner only) because that is where
 * the app's Settings screens read them.
 */
export async function loadProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, emailVerifiedAt: true, jobTitle: true, bio: true, avatar: true, timezone: true, username: true, pronouns: true, language: true, passwordChangedAt: true, deletionRequestedAt: true, createdAt: true, settings: true, apiKeys: true },
  });
  if (!user) return null;
  const { apiKeys, settings, emailVerifiedAt, ...rest } = user;
  const pending = await prisma.emailToken.findFirst({ where: { userId, kind: 'change', expiresAt: { gt: new Date() } }, select: { newEmail: true } });
  const merged: any = { ...((settings as any) || {}) };
  const unreadableKeys: string[] = [];
  for (const k of KEY_FIELDS) {
    const stored = (apiKeys as any)?.[k];
    const plain = decryptSecret(stored);
    // Never send the key itself back to the app (PEB-59): only a mask that shows a key is set.
    if (plain) merged[k] = maskKey(plain); else delete merged[k];
    // A key IS saved but this install cannot read it (saved under another install's secret): say so (PEB-58).
    if (isUnreadable(stored)) unreadableKeys.push(k);
  }
  if (unreadableKeys.length) merged.unreadableKeys = unreadableKeys; else delete merged.unreadableKeys;
  return { ...rest, emailVerified: !!emailVerifiedAt, pendingEmail: pending?.newEmail || null, mailReady: mailConfigured(), settings: merged };
}

export async function saveKeys(userId: string, incoming: Record<string, any>) {
  const data: any = {};
  for (const k of KEY_FIELDS) {
    // A value that is still the mask means "unchanged": keep the stored key.
    if (incoming[k] !== undefined && !String(incoming[k] ?? '').startsWith(KEY_MASK)) data[k] = encryptSecret(String(incoming[k] ?? ''));
  }
  if (Object.keys(data).length === 0) return;
  await prisma.userApiKeys.upsert({ where: { userId }, create: { userId, ...data }, update: data });
}

/** One-time clean-up at start-up: encrypt keys saved in plain text, and remove their copy from settings. */
export async function protectExistingKeys() {
  const rows = await prisma.userApiKeys.findMany();
  for (const row of rows) {
    const data: any = {};
    for (const k of KEY_FIELDS) {
      const v = (row as any)[k];
      if (v && !v.startsWith('enc:v1:')) data[k] = encryptSecret(v);
    }
    if (Object.keys(data).length) await prisma.userApiKeys.update({ where: { userId: row.userId }, data });
  }
  const users = await prisma.user.findMany({ select: { id: true, settings: true } });
  for (const u of users) {
    const s: any = u.settings || {};
    if (KEY_FIELDS.some((k) => k in s)) {
      for (const k of KEY_FIELDS) {
        // Only drop the plain-text copy once the encrypted copy is saved; otherwise the key would be lost for good.
        if (s[k]) {
          try { await saveKeys(u.id, { [k]: s[k] }); } catch (e: any) { console.warn(`[keys] could not move a saved key for one account: ${e?.message || e}`); continue; }
        }
        delete s[k];
      }
      await prisma.user.update({ where: { id: u.id }, data: { settings: s } });
    }
  }
}

/**
 * One-time move at start-up: an OpenAI or Gemini key saved in the old key fields becomes a normal AI connection
 * (same encrypted value, same chosen model) and the old field is emptied, so a key lives in exactly one place
 * and deleting its connection really removes it. Safe to run again: it only touches accounts that still have an old key.
 */
export async function migrateLegacyKeys() {
  const rows = await prisma.userApiKeys.findMany({ where: { OR: [{ openAiKey: { not: null } }, { geminiKey: { not: null } }] } });
  for (const row of rows) {
    const user = await prisma.user.findUnique({ where: { id: row.userId }, select: { settings: true } });
    if (!user) continue;
    const forModels = { settings: user.settings };
    const last = await prisma.aiConnection.findFirst({ where: { userId: row.userId }, orderBy: { position: 'desc' }, select: { position: true } });
    let position = (last?.position ?? -1) + 1;
    const ops: any[] = [];
    for (const [field, id, model] of [['openAiKey', 'openai', openAiModelOf(forModels)], ['geminiKey', 'gemini', geminiModelOf(forModels)]] as const) {
      const stored = (row as any)[field];
      const info = providerById(id)!;
      if (stored) ops.push(prisma.aiConnection.create({ data: { userId: row.userId, provider: id, label: info.label, baseUrl: info.baseUrl, apiKey: stored, model, position: position++ } }));
    }
    ops.push(prisma.userApiKeys.update({ where: { userId: row.userId }, data: { openAiKey: null, geminiKey: null } }));
    await prisma.$transaction(ops);
  }
}
