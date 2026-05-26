import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import OpenAI from 'openai';

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

// --- API Key Management ---
let currentGeminiKeyIndex = 0;
let geminiKeys = [];
let geminiInstance = null;
let openaiInstance = null;

function getOpenAI() {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key || key.includes('your-openai')) return null;
  
  if (!openaiInstance) {
    openaiInstance = new OpenAI({ apiKey: key });
  }
  return openaiInstance;
}

function getGeminiKeys() {
  if (geminiKeys.length === 0) {
    const keysStr = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '';
    geminiKeys = keysStr.split(',').map(k => k.trim()).filter(k => k && k !== 'your-gemini-api-key-here');
  }
  return geminiKeys;
}

function rotateGeminiKey() {
  const keys = getGeminiKeys();
  if (keys.length > 1) {
    currentGeminiKeyIndex = (currentGeminiKeyIndex + 1) % keys.length;
    geminiInstance = null;
    console.log(`Rotated to Gemini API key index ${currentGeminiKeyIndex}`);
  }
}

function getGenAI() {
  const keys = getGeminiKeys();
  if (keys.length === 0) return null;
  if (!geminiInstance) {
    geminiInstance = new GoogleGenerativeAI(keys[currentGeminiKeyIndex % keys.length]);
  }
  return geminiInstance;
}

// --- Mock Fallback System ---
function getMockResponse(type, title, content) {
  switch (type) {
    case 'summary':
      return { summary: `This note titled "${title}" discusses key topics. It covers important points that require attention and follow-up.` };
    case 'action_items':
      return { action_items: ['Review main points', 'Follow up on pending items', 'Schedule next session'] };
    case 'title':
      return { suggested_title: title || 'Untitled Note' };
    default:
      return {};
  }
}

// --- The Core Orchestrator (OpenAI -> Gemini -> Mock) ---
async function runWithCascade(operationName, executeOpenAI, executeGemini) {
  // Tier 1: Try OpenAI
  const openai = getOpenAI();
  if (openai) {
    try {
      console.log(`[${operationName}] Trying OpenAI...`);
      return await executeOpenAI(openai);
    } catch (error) {
      console.warn(`[${operationName}] OpenAI failed: ${error.message}. Falling back to Gemini...`);
    }
  }

  // Tier 2: Try Gemini (with key rotation)
  const geminiKeys = getGeminiKeys();
  const maxGeminiAttempts = Math.max(1, geminiKeys.length);
  
  for (let attempt = 1; attempt <= maxGeminiAttempts; attempt++) {
    const ai = getGenAI();
    if (!ai) break;
    
    try {
      console.log(`[${operationName}] Trying Gemini (Attempt ${attempt})...`);
      return await executeGemini(ai);
    } catch (error) {
      if (attempt < maxGeminiAttempts) {
        console.warn(`[${operationName}] Gemini Error (${error.message}). Rotating key...`);
        rotateGeminiKey();
      } else {
        console.warn(`[${operationName}] Gemini failed completely after ${maxGeminiAttempts} attempts.`);
      }
    }
  }

  // Tier 3: Mock Fallback
  console.warn(`[${operationName}] All AI providers failed. Using Mock Fallback.`);
  throw new Error('All AI providers exhausted'); 
}

// --- Specific Service Functions ---

export async function generateSummary(title, content) {
  try {
    return await runWithCascade('AI Summary',
      // OpenAI Implementation
      async (openai) => {
        const response = await openai.chat.completions.create({
          model: DEFAULT_OPENAI_MODEL,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: "You are an elite executive assistant. Your summaries must be extremely dense, removing all fluff, and providing only high-signal information. Respond in JSON format with a 'summary' key." },
            { role: "user", content: `Analyze the following note and provide a concise summary in 2-3 sentences. Focus on the key points and main ideas.\n\nNote Title: ${title}\nNote Content: ${content}` }
          ]
        });
        return JSON.parse(response.choices[0].message.content);
      },
      // Gemini Implementation
      async (gemini) => {
        const model = gemini.getGenerativeModel({
          model: process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL,
          systemInstruction: "You are an elite executive assistant. Your summaries must be extremely dense, removing all fluff, and providing only high-signal information.",
        });
        const prompt = `Analyze the following note and provide a concise summary in 2-3 sentences. Focus on the key points and main ideas.\n\nNote Title: ${title}\nNote Content: ${content}`;
        const result = await model.generateContent({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: { type: SchemaType.OBJECT, properties: { summary: { type: SchemaType.STRING } }, required: ["summary"] }
          }
        });
        return JSON.parse(result.response.text());
      }
    );
  } catch (err) {
    return getMockResponse('summary', title, content);
  }
}

export async function extractActionItems(title, content) {
  try {
    return await runWithCascade('AI Action Items',
      // OpenAI Implementation
      async (openai) => {
        const response = await openai.chat.completions.create({
          model: DEFAULT_OPENAI_MODEL,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: "You are a ruthless project manager. Identify every single implicit or explicit task, assignment, or next step mentioned in the text. Be specific and action-oriented. Respond in JSON format with an 'action_items' array of strings." },
            { role: "user", content: `Extract actionable items from the following note.\n\nNote Title: ${title}\nNote Content: ${content}` }
          ]
        });
        return JSON.parse(response.choices[0].message.content);
      },
      // Gemini Implementation
      async (gemini) => {
        const model = gemini.getGenerativeModel({
          model: process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL,
          systemInstruction: "You are a ruthless project manager. Identify every single implicit or explicit task, assignment, or next step mentioned in the text. Be specific and action-oriented.",
        });
        const prompt = `Extract actionable items from the following note.\n\nNote Title: ${title}\nNote Content: ${content}`;
        const result = await model.generateContent({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: { type: SchemaType.OBJECT, properties: { action_items: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } } }, required: ["action_items"] }
          }
        });
        return JSON.parse(result.response.text());
      }
    );
  } catch (err) {
    return getMockResponse('action_items', title, content);
  }
}

export async function chatPlanNotes({ message, mode, targetNote, existingNotes }) {
  const contextList = existingNotes?.slice(0, 20).map(n => `ID: ${n.id} | Title: ${n.title}`).join('\n') || '';
  const titlesContext = contextList ? `Existing notes:\n${contextList}` : 'No existing notes.';
  
  const modeHint = mode === 'append' && targetNote
      ? `You are modifying the existing note "${targetNote.title}" (id: ${targetNote.id}).
Current Note Content:
"""
${targetNote.content}
"""
Based on the user's message, you can either add to the bottom using 'updateNote.appendContent', OR completely rewrite/edit the old content using 'updateNote.replaceContent'. Do not create new notes unless explicitly asked.`
      : 'You can create new notes OR update existing notes if the user asks you to modify or improve one of their existing notes. Use the ID from the context.';
      
  const systemPrompt = `You are an elite, highly-paid "$10,000/month" AI Chief of Staff and Knowledge Manager.
Your job is perfectly organize the user's thoughts into beautifully structured, comprehensive notes. 
When creating notes:
- Use extensive Markdown (tables, bold, headers, blockquotes, code blocks) to make them visually stunning.
- Expand on brief ideas with deep, insightful additions where appropriate.
- Assign the absolute best category (e.g., Work, Personal, Research, Ideas).
- Generate 2-5 highly relevant tags.
When the user asks to modify or improve an existing note (e.g. "update the list"):
- Find the most relevant note ID from the context.
- Use 'updateNote.replaceContent' to completely rewrite and improve the note, or 'updateNote.appendContent' to just add to the bottom.
- Provide a warm, extremely intelligent, and concise reply to the user.
Respond strictly in JSON with this schema: { reply: string, notes: [{title, content, category, tags}], updateNote: {noteId, appendContent, replaceContent} | null }`;

  const userPrompt = `Context:\n${titlesContext}\n\nUser message: "${message}"\n\nMode: ${modeHint}`;

  try {
    return await runWithCascade('AI Chat',
      // OpenAI Implementation
      async (openai) => {
        const response = await openai.chat.completions.create({
          model: DEFAULT_OPENAI_MODEL,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ]
        });
        const parsed = JSON.parse(response.choices[0].message.content);
        return {
          reply: parsed.reply || 'Done! Your notes are ready.',
          notes: Array.isArray(parsed.notes) ? parsed.notes : [],
          updateNote: parsed.updateNote?.noteId ? parsed.updateNote : null,
        };
      },
      // Gemini Implementation
      async (gemini) => {
        const model = gemini.getGenerativeModel({
          model: process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL,
          systemInstruction: systemPrompt
        });
        const result = await model.generateContent({
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: SchemaType.OBJECT,
              properties: {
                reply: { type: SchemaType.STRING },
                notes: {
                  type: SchemaType.ARRAY,
                  items: {
                    type: SchemaType.OBJECT,
                    properties: {
                      title: { type: SchemaType.STRING },
                      content: { type: SchemaType.STRING },
                      category: { type: SchemaType.STRING },
                      tags: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } }
                    },
                    required: ["title", "content", "category", "tags"]
                  }
                },
                updateNote: {
                  type: SchemaType.OBJECT,
                  properties: {
                    noteId: { type: SchemaType.STRING },
                    appendContent: { type: SchemaType.STRING },
                    replaceContent: { type: SchemaType.STRING }
                  },
                  required: ["noteId"],
                  nullable: true
                }
              },
              required: ["reply", "notes"]
            }
          }
        });
        const parsed = JSON.parse(result.response.text());
        return {
          reply: parsed.reply || 'Done! Your notes are ready.',
          notes: Array.isArray(parsed.notes) ? parsed.notes : [],
          updateNote: parsed.updateNote?.noteId ? parsed.updateNote : null,
        };
      }
    );
  } catch (err) {
    return {
      reply: `(Fallback) I created a placeholder note for your request: "${message.substring(0, 50)}..."`,
      notes: [{
        title: message.substring(0, 48) || 'AI Note',
        content: `## Overview\n\n${message}\n\n*Note: AI generated response disabled due to API limits.*`,
        category: 'Personal',
        tags: ['ai-fallback'],
      }],
      updateNote: null,
    };
  }
}

export async function suggestTitle(content) {
  try {
    return await runWithCascade('AI Title',
      // OpenAI Implementation
      async (openai) => {
        const response = await openai.chat.completions.create({
          model: DEFAULT_OPENAI_MODEL,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: "You are an expert copywriter. Your titles must be extremely engaging, clear, concise (3-8 words), and perfectly capture the core essence of the note. Respond in JSON format with a 'suggested_title' string." },
            { role: "user", content: `Based on the following note content, suggest the perfect title.\n\nNote Content: ${content}` }
          ]
        });
        return JSON.parse(response.choices[0].message.content);
      },
      // Gemini Implementation
      async (gemini) => {
        const model = gemini.getGenerativeModel({
          model: process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL,
          systemInstruction: "You are an expert copywriter. Your titles must be extremely engaging, clear, concise (3-8 words), and perfectly capture the core essence of the note.",
        });
        const prompt = `Based on the following note content, suggest the perfect title.\n\nNote Content: ${content}`;
        const result = await model.generateContent({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: { type: SchemaType.OBJECT, properties: { suggested_title: { type: SchemaType.STRING } }, required: ["suggested_title"] }
          }
        });
        return JSON.parse(result.response.text());
      }
    );
  } catch (err) {
    return getMockResponse('title', '', content);
  }
}
