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

// --- Smart Intake: Analyze raw data and extract notes + tasks ---
export async function analyzeAndOrganize(rawData, template = 'auto') {
  const today = new Date().toISOString().split('T')[0];
  const dayOfWeek = new Date().toLocaleDateString('en-US', { weekday: 'long' });

  const templateHints = {
    auto: 'Automatically detect the type of data and organize accordingly.',
    meeting: 'This is MEETING NOTES. Focus on: attendees, key decisions, action items with owners, follow-up meetings. Use a table for action items with columns: Owner, Task, Deadline.',
    email: 'This is an EMAIL THREAD. Focus on: sender/recipients, key requests, deadlines, required responses or approvals.',
    project: 'This is a PROJECT BRIEF. Focus on: scope, objectives, milestones, deliverables, team responsibilities, budget, risks. Use tables for milestones.',
    braindump: 'This is a BRAINDUMP. Focus on: grouping related ideas, separating tasks from ideas from reminders, identifying hidden deadlines, prioritizing by urgency.',
    syllabus: 'This is a COURSE SYLLABUS. Focus on: course info, assignment due dates, exam dates, reading schedule, grade breakdown. Create chronological task list.',
  };

  const templateContext = templateHints[template] || templateHints.auto;

  const systemPrompt = `You are an elite AI Chief of Staff and productivity architect.
Your job is to take ANY raw data the user pastes (meeting notes, emails, project briefs, braindumps, syllabi, chat logs, etc.) and transform it into:

1. A BEAUTIFULLY structured Note using rich Markdown (headers, bullet points, tables, bold, blockquotes, code blocks)
2. A list of EVERY actionable task extracted from the data

TEMPLATE CONTEXT: ${templateContext}

CRITICAL RULES for task extraction:
- Extract EVERY implicit or explicit task, deadline, appointment, or action item
- For each task, determine:
  - "text": A clear, actionable task description (imperative voice)
  - "priority": "high" (urgent/critical/ASAP/important), "medium" (normal), or "low" (nice-to-have/optional)
  - "deadline": ISO 8601 date string (YYYY-MM-DD) or null. Interpret relative dates like "next Monday", "by Friday", "in 2 weeks" relative to today (${today}, ${dayOfWeek}). If a task says "tomorrow", that means ${new Date(Date.now() + 86400000).toISOString().split('T')[0]}.
  - "startTime": Time string like "09:00" or null (if a specific time is mentioned)
  - "endTime": Time string like "17:00" or null
  - "tags": 1-3 relevant tags for this specific task

For the note:
- "title": A concise, descriptive title (3-8 words)
- "content": Rich markdown content that organizes the raw data beautifully
- "category": Best fit category (Work, Personal, Research, Ideas, Meeting, Project, Study, Health, Finance)
- "tags": 3-6 relevant tags

- "reply": A brief, warm summary of what you organized (2-3 sentences)

Respond ONLY in valid JSON.`;

  try {
    return await runWithCascade('Smart Intake',
      // OpenAI Implementation
      async (openai) => {
        const response = await openai.chat.completions.create({
          model: DEFAULT_OPENAI_MODEL,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Analyze and organize the following raw data:\n\n---\n${rawData}\n---` }
          ]
        });
        const parsed = JSON.parse(response.choices[0].message.content);
        return normalizeIntakeResult(parsed);
      },
      // Gemini Implementation
      async (gemini) => {
        const model = gemini.getGenerativeModel({
          model: process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL,
          systemInstruction: systemPrompt
        });
        const result = await model.generateContent({
          contents: [{ role: 'user', parts: [{ text: `Analyze and organize the following raw data:\n\n---\n${rawData}\n---` }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: SchemaType.OBJECT,
              properties: {
                reply: { type: SchemaType.STRING },
                note: {
                  type: SchemaType.OBJECT,
                  properties: {
                    title: { type: SchemaType.STRING },
                    content: { type: SchemaType.STRING },
                    category: { type: SchemaType.STRING },
                    tags: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } }
                  },
                  required: ["title", "content", "category", "tags"]
                },
                tasks: {
                  type: SchemaType.ARRAY,
                  items: {
                    type: SchemaType.OBJECT,
                    properties: {
                      text: { type: SchemaType.STRING },
                      priority: { type: SchemaType.STRING },
                      deadline: { type: SchemaType.STRING, nullable: true },
                      startTime: { type: SchemaType.STRING, nullable: true },
                      endTime: { type: SchemaType.STRING, nullable: true },
                      tags: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } }
                    },
                    required: ["text", "priority"]
                  }
                }
              },
              required: ["reply", "note", "tasks"]
            }
          }
        });
        const parsed = JSON.parse(result.response.text());
        return normalizeIntakeResult(parsed);
      }
    );
  } catch (err) {
    // Graceful fallback — create a raw note with the pasted text
    return {
      reply: `I organized your data into a note. AI task extraction is temporarily unavailable, so please review for any action items.`,
      note: {
        title: 'Imported Data',
        content: `## Raw Import\n\n${rawData}`,
        category: 'Personal',
        tags: ['imported', 'needs-review']
      },
      tasks: []
    };
  }
}

function normalizeIntakeResult(parsed) {
  const validPriorities = ['high', 'medium', 'low'];
  return {
    reply: parsed.reply || 'Done! I organized your data into a note and extracted all tasks.',
    note: {
      title: parsed.note?.title || 'Imported Data',
      content: parsed.note?.content || '',
      category: parsed.note?.category || 'Personal',
      tags: Array.isArray(parsed.note?.tags) ? parsed.note.tags : []
    },
    tasks: Array.isArray(parsed.tasks) ? parsed.tasks.map(t => ({
      text: t.text || '',
      priority: validPriorities.includes(t.priority) ? t.priority : 'medium',
      deadline: t.deadline || null,
      startTime: t.startTime || null,
      endTime: t.endTime || null,
      tags: Array.isArray(t.tags) ? t.tags : []
    })).filter(t => t.text.trim()) : []
  };
}

