import { GoogleGenerativeAI } from '@google/generative-ai';
import 'dotenv/config';

async function checkKeys() {
  const keysStr = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '';
  const keys = keysStr.split(',').map(k => k.trim()).filter(Boolean);
  
  for (let i = 0; i < keys.length; i++) {
    const ai = new GoogleGenerativeAI(keys[i]);
    const model = ai.getGenerativeModel({ model: 'gemini-2.5-flash' });
    try {
      await model.generateContent('hi');
      console.log(`Key ${i} is WORKING`);
    } catch (e) {
      console.log(`Key ${i} is FAILED: ${e.message}`);
    }
  }
}

checkKeys();
