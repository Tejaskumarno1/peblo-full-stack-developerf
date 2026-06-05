import 'dotenv/config';
import { analyzeAndOrganize } from './src/services/aiService.js';

(async () => {
  try {
    const res = await analyzeAndOrganize("Buy groceries tomorrow", "braindump");
    console.log(res);
  } catch (e) {
    console.error(e);
  }
})();
