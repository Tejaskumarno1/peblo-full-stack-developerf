import { AsyncLocalStorage } from 'node:async_hooks';
import prisma from '../db.js';
import { policyOf, policyOfSpace } from './orgPolicy.js';

/** The organization AI keys that apply to one request made inside an organization space (mockup C05, Policy "Require our own key"). */
export interface OrgAiScope { required: boolean; openai: string | null; gemini: string | null }
export const orgAiStore = new AsyncLocalStorage<OrgAiScope>();

/** Keys are kept encrypted exactly as stored; aiService decrypts them like a person's own key. */
export async function orgAiScopeOf(spaceId: string | null | undefined): Promise<OrgAiScope | null> {
  if (!spaceId || spaceId === 'personal') return null;
  const o = await prisma.$queryRaw<{ id: string; policy: any }[]>`SELECT o.id, o.policy FROM spaces s JOIN organizations o ON o.id = s.org_id WHERE s.id = ${spaceId}`;
  if (!o[0]) return null;
  const keys = await prisma.$queryRaw<{ provider: string; secret: string }[]>`SELECT provider, secret FROM org_ai_keys WHERE org_id = ${o[0].id}`;
  return { required: policyOf(o[0].policy).requireOrgKey, openai: keys.find((k) => k.provider === 'openai')?.secret ?? null, gemini: keys.find((k) => k.provider === 'gemini')?.secret ?? null };
}

/** Applies the scope to a loaded user: required means only the organization's keys (no personal keys, no server keys); otherwise the org key fills in for a missing personal one. */
export function applyOrgAi(user: any): any {
  const s = orgAiStore.getStore();
  if (!user || !s) return user;
  const own = user.apiKeys || {};
  if (s.required) {
    user.apiKeys = { ...own, openAiKey: s.openai, geminiKey: s.gemini };
    user.settings = { ...(user.settings || {}), forceCustomModels: true };
    user.aiConnections = [];
  } else if (s.openai || s.gemini) {
    user.apiKeys = { ...own, openAiKey: own.openAiKey || s.openai, geminiKey: own.geminiKey || s.gemini };
  }
  return user;
}

/** Route guard for AI calls made inside an organization space: honours "AI features" off and "Require our own key", and runs the call with the organization keys. */
export async function orgAiGate(req: any, res: any, next: any) {
  try {
    const sp = String(req.headers['x-peblo-space'] ?? '').trim();
    if (!sp || sp === 'personal') return next();
    const pol = await policyOfSpace(sp);
    if (pol && !pol.aiFeatures) return res.status(403).json({ error: 'Your organization has turned AI off for shared notes.' });
    const scope = await orgAiScopeOf(sp);
    if (scope?.required && !scope.openai && !scope.gemini) return res.status(403).json({ error: 'Your organization requires its own AI key for shared notes, and none has been added yet. Ask an admin to add one in Organization > AI keys.', code: 'org_key_missing' });
    if (scope) return orgAiStore.run(scope, () => next());
    next();
  } catch (e) { next(e); }
}
