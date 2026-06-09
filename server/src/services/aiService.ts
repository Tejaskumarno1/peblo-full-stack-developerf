import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import OpenAI from 'openai';
import prisma from '../db.js';

const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

async function getUserSettings(userId: string) {
  return await prisma.user.findUnique({ 
    where: { id: userId },
    include: { apiKeys: true }
  });
}

function getOpenAIInstance(user: any) {
  const settings = user?.settings as any || {};
  const forceCustomModels = settings.forceCustomModels === true;
  const key = user?.apiKeys?.openAiKey?.trim();
  
  if (key) return new OpenAI({ apiKey: key });
  if (forceCustomModels) return null;
  
  const envKey = process.env.OPENAI_API_KEY?.trim();
  if (!envKey || envKey.includes('your-openai')) return null;
  return new OpenAI({ apiKey: envKey });
}

function getGeminiInstance(user: any) {
  const settings = user?.settings as any || {};
  const forceCustomModels = settings.forceCustomModels === true;
  const key = user?.apiKeys?.geminiKey?.trim();
  
  if (key) return new GoogleGenerativeAI(key);
  if (forceCustomModels) return null;
  
  const keysStr = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '';
  const keys = keysStr.split(',').map(k => k.trim()).filter(k => k && k !== 'your-gemini-api-key-here');
  if (keys.length === 0) return null;
  return new GoogleGenerativeAI(keys[0]);
}

// --- The Core Orchestrator (OpenAI -> Gemini -> Mock) ---
async function runWithCascade(
  operationName: string,
  userId: string,
  executeOpenAI: (openai: OpenAI) => Promise<any>,
  executeGemini: (gemini: GoogleGenerativeAI) => Promise<any>
): Promise<any> {
  const user = await getUserSettings(userId);
  const settings = user?.settings as any || {};
  const defaultModel = settings.defaultAiModel || 'auto';
  
  const openai = getOpenAIInstance(user);
  const gemini = getGeminiInstance(user);
  
  // Decide order based on defaultModel
  const order = defaultModel === 'gemini' ? ['gemini', 'openai'] : ['openai', 'gemini'];
  
  for (const provider of order) {
    if (provider === 'openai' && openai) {
      try {
        console.log(`[${operationName}] Trying OpenAI...`);
        return await executeOpenAI(openai);
      } catch (error: any) {
        console.warn(`[${operationName}] OpenAI failed: ${error.message}.`);
      }
    }
    
    if (provider === 'gemini' && gemini) {
      try {
        console.log(`[${operationName}] Trying Gemini...`);
        return await executeGemini(gemini);
      } catch (error: any) {
        console.warn(`[${operationName}] Gemini Error (${error.message}).`);
      }
    }
  }

  // Tier 3: Mock Fallback
  console.warn(`[${operationName}] All AI providers failed. Using Mock Fallback.`);
  throw new Error('All AI providers exhausted or force custom models is enabled and keys are missing/invalid.'); 
}

// --- Specific Service Functions ---

export async function generateSummary(userId: string, title: string, content: string) {
  try {
    return await runWithCascade('AI Summary', userId,
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
        return JSON.parse(response.choices[0].message.content || '{}');
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

export async function extractActionItems(userId: string, title: string, content: string) {
  try {
    return await runWithCascade('AI Action Items', userId,
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
        return JSON.parse(response.choices[0].message.content || '{}');
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

interface ChatParams {
  message: string;
  mode: 'create' | 'append';
  targetNote?: { id: string; title: string; content: string } | null;
  existingNotes?: { id: string; title: string }[];
}

export async function chatPlanNotes(userId: string, { message, mode, targetNote, existingNotes }: ChatParams) {
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
    return await runWithCascade('AI Chat', userId,
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
        const parsed = JSON.parse(response.choices[0].message.content || '{}');
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

export async function chatPlanNotesStream(userId: string, { message, mode, targetNote, existingNotes }: ChatParams, res: any) {
  const contextList = existingNotes?.slice(0, 20).map(n => `ID: ${n.id} | Title: ${n.title}`).join('\n') || '';
  const titlesContext = contextList ? `Existing notes:\n${contextList}` : 'No existing notes.';
  
  const modeHint = mode === 'append' && targetNote
      ? `You are modifying the existing note "${targetNote.title}" (id: ${targetNote.id}).\nCurrent Note Content:\n"""\n${targetNote.content}\n"""\nBased on the user's message, you can either add to the bottom using 'updateNote.appendContent', OR completely rewrite/edit the old content using 'updateNote.replaceContent'. Do not create new notes unless explicitly asked.`
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

  const user = await getUserSettings(userId);
  const gemini = getGeminiInstance(user);
  if (!gemini) throw new Error('No Gemini API key available');
  
  const model = gemini.getGenerativeModel({
    model: process.env.GEMINI_MODEL?.trim() || 'gemini-2.0-flash',
    systemInstruction: systemPrompt
  });

  const result = await model.generateContentStream({
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

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  let fullResponse = '';
  for await (const chunk of result.stream) {
    const chunkText = chunk.text();
    fullResponse += chunkText;
    res.write(`data: ${JSON.stringify({ chunk: chunkText })}\n\n`);
  }

  let parsed;
  try {
    parsed = JSON.parse(fullResponse);
  } catch (e) {
    parsed = { reply: 'Error parsing AI response', notes: [], updateNote: null };
  }

  return {
    reply: parsed.reply || 'Done! Your notes are ready.',
    notes: Array.isArray(parsed.notes) ? parsed.notes : [],
    updateNote: parsed.updateNote?.noteId ? parsed.updateNote : null,
  };
}

export async function suggestTitle(userId: string, content: string) {
  try {
    return await runWithCascade('AI Title', userId,
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
        return JSON.parse(response.choices[0].message.content || '{}');
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
export async function analyzeAndOrganize(userId: string, rawData: string, template: string = 'auto') {
  const today = new Date().toISOString().split('T')[0];
  const dayOfWeek = new Date().toLocaleDateString('en-US', { weekday: 'long' });

  const templateHints: Record<string, string> = {
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
    return await runWithCascade('Smart Intake', userId,
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
        const parsed = JSON.parse(response.choices[0].message.content || '{}');
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

function normalizeIntakeResult(parsed: any) {
  const validPriorities = ['high', 'medium', 'low'];
  return {
    reply: parsed.reply || 'Done! I organized your data into a note and extracted all tasks.',
    note: {
      title: parsed.note?.title || 'Imported Data',
      content: parsed.note?.content || '',
      category: parsed.note?.category || 'Personal',
      tags: Array.isArray(parsed.note?.tags) ? parsed.note.tags : []
    },
    tasks: Array.isArray(parsed.tasks) ? parsed.tasks.map((t: any) => ({
      text: t.text || '',
      priority: validPriorities.includes(t.priority) ? t.priority : 'medium',
      deadline: t.deadline || null,
      startTime: t.startTime || null,
      endTime: t.endTime || null,
      tags: Array.isArray(t.tags) ? t.tags : []
    })).filter((t: any) => t.text.trim()) : []
  };
}

export async function processTextCommand(userId: string, text: string, command: string): Promise<string> {
  try {
    return await runWithCascade('AI Text Command', userId,
      // OpenAI
      async (openai) => {
        let systemInstruction = "You are a helpful AI writing assistant.";
        let prompt = "";
        if (command === 'summarize') {
          systemInstruction = "You are a concise summaries writer. Summarize the text in 1-2 clear, dense sentences.";
          prompt = `Summarize the following text:\n\n${text}`;
        } else if (command === 'improve') {
          systemInstruction = "You are an expert copyeditor. Rewrite the text to improve clarity, grammar, style, and flow while retaining original meaning.";
          prompt = `Improve the following text:\n\n${text}`;
        } else if (command === 'todo') {
          systemInstruction = "You are a task extractor. Extract all actionable tasks from the text and list them with a '-' prefix. Write only the task list, nothing else.";
          prompt = `Extract tasks from this text:\n\n${text}`;
        } else {
          prompt = `${command} the following text:\n\n${text}`;
        }

        const response = await openai.chat.completions.create({
          model: DEFAULT_OPENAI_MODEL,
          messages: [
            { role: "system", content: systemInstruction },
            { role: "user", content: prompt }
          ]
        });
        return response.choices[0].message.content || '';
      },
      // Gemini
      async (gemini) => {
        let systemInstruction = "You are a helpful AI writing assistant.";
        let prompt = "";
        if (command === 'summarize') {
          systemInstruction = "You are a concise summaries writer. Summarize the text in 1-2 clear, dense sentences.";
          prompt = `Summarize the following text:\n\n${text}`;
        } else if (command === 'improve') {
          systemInstruction = "You are an expert copyeditor. Rewrite the text to improve clarity, grammar, style, and flow while retaining original meaning.";
          prompt = `Improve the following text:\n\n${text}`;
        } else if (command === 'todo') {
          systemInstruction = "You are a task extractor. Extract all actionable tasks from the text and list them with a '-' prefix. Write only the task list, nothing else.";
          prompt = `Extract tasks from this text:\n\n${text}`;
        } else {
          prompt = `${command} the following text:\n\n${text}`;
        }

        const model = gemini.getGenerativeModel({
          model: process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL,
          systemInstruction,
        });
        const result = await model.generateContent({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
        });
        return result.response.text();
      }
    );
  } catch (err) {
    if (command === 'summarize') return `Summary: This is a placeholder summary of the text: "${text.substring(0, 30)}..."`;
    if (command === 'improve') return `Improved: ${text}`;
    if (command === 'todo') return `- Task 1: Check text content\n- Task 2: Follow up on items`;
    return text;
  }
}

export async function generateEmbedding(userId: string, text: string): Promise<number[]> {
  try {
    return await runWithCascade('AI Embedding', userId,
      async (openai) => {
        const response = await openai.embeddings.create({
          model: 'text-embedding-3-small',
          input: text
        });
        return response.data[0].embedding;
      },
      async (gemini) => {
        try {
          const model = gemini.getGenerativeModel({ model: 'text-embedding-004' });
          const result = await model.embedContent(text);
          return result.embedding.values;
        } catch {
          const model = gemini.getGenerativeModel({ model: 'gemini-embedding-001' });
          const result = await model.embedContent(text);
          return result.embedding.values;
        }
      }
    );
  } catch (err) {
    console.error('Failed to generate embedding:', err);
    return [];
  }
}

export async function extractSmartIntake(userId: string, text: string): Promise<any> {
  const user = await getUserSettings(userId);
  const model = getGeminiInstance(user);
  if (!model) return { title: 'Unknown Import', category: 'uncategorized', summary: text.slice(0, 100), actionItems: [] };
  
  const m = model.getGenerativeModel({ model: DEFAULT_GEMINI_MODEL });
  const prompt = `Analyze this text and return ONLY valid JSON:
{
  "title": "A concise title",
  "category": "One of: work, personal, meeting, study",
  "summary": "A 2-3 sentence summary",
  "actionItems": ["action 1", "action 2", "etc (or empty array)"]
}

Text:
${text}`;

  try {
    const result = await m.generateContent(prompt);
    let output = result.response.text();
    output = output.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(output);
  } catch (err) {
    console.error('Gemini Smart Intake Error:', err);
    return { title: 'New Import', category: 'uncategorized', summary: 'Failed to process.', actionItems: [] };
  }
}

export async function processVoiceCallCommand(
  userId: string,
  transcript: string, 
  currentTasks: any[], 
  currentNotes: any[], 
  localTime?: string, 
  timezone?: string
): Promise<any> {
  const user = await getUserSettings(userId);
  const model = getGeminiInstance(user);
  if (!model) return { message: "AI not configured." };
  
  const m = model.getGenerativeModel({ model: DEFAULT_GEMINI_MODEL });
  const tasksContext = JSON.stringify(currentTasks.map(t => ({ id: t.id, text: t.text, deadline: t.deadline })));
  const notesContext = JSON.stringify(currentNotes.map(n => ({ id: n.id, title: n.title })));
  
  const userLocalTime = localTime || new Date().toString();
  const userTimezone = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

  const prompt = `You are a helpful AI voice assistant for a productivity app.
The user has spoken this command over a voice call: "${transcript}"

Here are the user's current tasks for today:
${tasksContext}

Here are the user's existing workspace notes:
${notesContext}

User's Local Time is: ${userLocalTime}
User's Timezone is: ${userTimezone}

Determine the user's intent. They can request any of the following:
1. COMPLETE: Mark a task as done.
2. RESCHEDULE: Move a task to a new time.
3. CREATE: Create a new task.
4. SNOOZE: Postpone the call.
5. CREATE_NOTE: Create a new workspace note (e.g. "Create a note about setup" or "Write a note detailing project guidelines"). 
6. READ_NOTE: Read/summarize an existing note. If the user asks to read/summarize a note (e.g. "What did I write in my workout note?" or "Read note about shopping list"), find the best matching note in the list of existing notes.
7. CLARIFY: If user request is ambiguous.

Return ONLY a valid JSON object matching this structure:
{
  "actions": [
    { "type": "COMPLETE", "taskId": "the-uuid" },
    { "type": "RESCHEDULE", "taskId": "the-uuid", "newDate": "ISO-date-string" },
    { "type": "CREATE", "text": "task text content", "newDate": "ISO-date-string (if specified, otherwise null)" },
    { "type": "SNOOZE", "minutes": 10 },
    { "type": "CREATE_NOTE", "title": "Note Title", "content": "Clean, structured Markdown content of the note based on the user's speech", "tags": ["tag1", "tag2"] },
    { "type": "READ_NOTE", "noteId": "the-note-uuid" }
  ],
  "needClarification": false,
  "responseSpeech": "What you should say back to the user out loud. If CREATE_NOTE: 'Done! I created a note titled styling setup for your workspace.' If READ_NOTE: 'Let me fetch that note details for you.'"
}`;

  try {
    const result = await m.generateContent(prompt);
    let output = result.response.text();
    output = output.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(output);
  } catch (err) {
    console.error('Gemini Voice Call Error:', err);
    return { responseSpeech: "Sorry, I couldn't process that command.", actions: [], needClarification: false };
  }
}

export async function generateVerbalNoteSummary(userId: string, title: string, content: string): Promise<string> {
  const user = await getUserSettings(userId);
  const model = getGeminiInstance(user);
  if (!model) return "No content found.";
  
  const m = model.getGenerativeModel({ model: DEFAULT_GEMINI_MODEL });
  const prompt = `You are a voice assistant summarizing a note for a user over a voice call.
The note title is: "${title}"
The note content is:
${content}

Please provide a highly concise, 1-2 sentence speech-friendly summary of this note to read back to the user. Do not include markdown formatting, bullet points, or special characters (like asterisks). Keep it clear and natural.`;

  try {
    const result = await m.generateContent(prompt);
    return result.response.text().trim();
  } catch (err) {
    console.error('Gemini Note Summary Error:', err);
    return "The note content could not be read.";
  }
}

export async function suggestTag(userId: string, title: string, content: string): Promise<{ suggested_tag: string }> {
  try {
    return await runWithCascade('AI Suggest Tag', userId,
      // OpenAI Implementation
      async (openai) => {
        const response = await openai.chat.completions.create({
          model: DEFAULT_OPENAI_MODEL,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: "Analyze the note content and suggest a single, most relevant one-word tag (like 'Work', 'Personal', 'Ideas', 'Finance', 'Study', 'Recipe', etc.) that best categorizes it. Respond in JSON format with a 'suggested_tag' key." },
            { role: "user", content: `Note Title: ${title}\nNote Content: ${content}` }
          ]
        });
        return JSON.parse(response.choices[0].message.content || '{}');
      },
      // Gemini Implementation
      async (gemini) => {
        const model = gemini.getGenerativeModel({
          model: process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL,
          systemInstruction: "Analyze the note content and suggest a single, most relevant one-word tag (like 'Work', 'Personal', 'Ideas', 'Finance', 'Study', 'Recipe', etc.) that best categorizes it.",
        });
        const prompt = `Note Title: ${title}\nNote Content: ${content}`;
        const result = await model.generateContent({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: { type: SchemaType.OBJECT, properties: { suggested_tag: { type: SchemaType.STRING } }, required: ["suggested_tag"] }
          }
        });
        return JSON.parse(result.response.text());
      }
    );
  } catch (err) {
    return { suggested_tag: 'Note' };
  }
}
