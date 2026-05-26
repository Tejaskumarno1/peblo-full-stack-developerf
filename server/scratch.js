import { GoogleGenerativeAI } from '@google/generative-ai';

async function testKeys() {
  const keys = [
    'AIzaSyCEc9gV1JjFueMqRyTZ4rZj-eYO8VweT4o',
    'AIzaSyDOsB5SjBy0v5XsGpcLVzgm9PlJ-up_DAo',
    'AIzaSyA1ipR1Cx1z8jQ0-Qj_GcEg0aCHjshgDOM'
  ];

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    console.log(`Testing key ${i + 1}...`);
    try {
      const genAI = new GoogleGenerativeAI(key);
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      const result = await model.generateContent('Say hello in 1 word');
      console.log(`Key ${i + 1} Success! Output: ${result.response.text()}`);
    } catch (err) {
      console.log(`Key ${i + 1} Failed: ${err.message.substring(0, 100)}`);
    }
  }
}
testKeys();
