import 'dotenv/config';
import { analyzeAndOrganize } from './src/services/aiService.js';

(async () => {
  try {
    const res = await analyzeAndOrganize("Buy groceries tomorrow", "braindump");
    console.log(JSON.stringify(res, null, 2));
  } catch (e) {
    console.error(e);
  }
})();
