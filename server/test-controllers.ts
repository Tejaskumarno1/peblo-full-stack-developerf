import { getInsights, getDailyBriefing, getWeeklyReport } from './src/controllers/dashboardController.ts';
import { getTodayTodos } from './src/controllers/todosController.ts';
import prisma from './src/db.ts';

async function main() {
  const user = await prisma.user.findFirst();
  const req = { user: { id: user.id }, query: {} };
  const res = { 
    json: (data) => data, 
    status: (s) => ({ json: (data) => data }) 
  };
  const next = (err) => { console.error("NEXT ERROR:", err); };

  console.time('insights');
  await getInsights(req, res, next);
  console.timeEnd('insights');

  console.time('briefing');
  await getDailyBriefing(req, res, next);
  console.timeEnd('briefing');

  console.time('weekly');
  await getWeeklyReport(req, res, next);
  console.timeEnd('weekly');

  console.time('today');
  await getTodayTodos(req, res, next);
  console.timeEnd('today');
}

main().then(() => prisma.$disconnect());
