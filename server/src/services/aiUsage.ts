import prisma from '../db.js';

/** Counts one answered AI request for a person (day, provider, feature). Never throws and never blocks the request. */
export function recordUse(userId: string, feature: string, provider: string): void {
  if (!userId) return;
  const f = (feature || 'other').slice(0, 40);
  const p = (provider || 'unknown').slice(0, 60);
  prisma.$executeRaw`
    INSERT INTO ai_usage (user_id, day, provider, feature, requests)
    VALUES (${userId}, CURRENT_DATE, ${p}, ${f}, 1)
    ON CONFLICT (user_id, day, provider, feature) DO UPDATE SET requests = ai_usage.requests + 1`
    .catch((e: any) => console.warn('[ai-usage] not counted:', e?.message || e));
}

export type Usage = {
  today: number;
  month: number;
  days: { day: string; count: number }[];
  providers: { provider: string; count: number }[];
  features: { feature: string; count: number }[];
};

/** Today, this month, the last 14 days, and this month's split by provider and by feature. */
export async function usageFor(userId: string): Promise<Usage> {
  const days: any[] = await prisma.$queryRaw`
    SELECT to_char(day, 'YYYY-MM-DD') AS day, SUM(requests)::int AS count
    FROM ai_usage WHERE user_id = ${userId} AND day > CURRENT_DATE - 14 GROUP BY day ORDER BY day`;
  const prov: any[] = await prisma.$queryRaw`
    SELECT provider, SUM(requests)::int AS count FROM ai_usage
    WHERE user_id = ${userId} AND day >= date_trunc('month', CURRENT_DATE) GROUP BY provider ORDER BY count DESC LIMIT 10`;
  const feat: any[] = await prisma.$queryRaw`
    SELECT feature, SUM(requests)::int AS count FROM ai_usage
    WHERE user_id = ${userId} AND day >= date_trunc('month', CURRENT_DATE) GROUP BY feature ORDER BY count DESC LIMIT 10`;
  const month: any[] = await prisma.$queryRaw`
    SELECT COALESCE(SUM(requests), 0)::int AS n FROM ai_usage WHERE user_id = ${userId} AND day >= date_trunc('month', CURRENT_DATE)`;
  const today: any[] = await prisma.$queryRaw`
    SELECT COALESCE(SUM(requests), 0)::int AS n FROM ai_usage WHERE user_id = ${userId} AND day = CURRENT_DATE`;
  // fill the gaps so the chart always has 14 bars
  const have = new Map<string, number>(days.map((d) => [d.day, Number(d.count)]));
  const out: { day: string; count: number }[] = [];
  const now = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    out.push({ day: k, count: have.get(k) || 0 });
  }
  return {
    today: Number(today[0]?.n || 0), month: Number(month[0]?.n || 0), days: out,
    providers: prov.map((r) => ({ provider: r.provider, count: Number(r.count) })),
    features: feat.map((r) => ({ feature: r.feature, count: Number(r.count) })),
  };
}
