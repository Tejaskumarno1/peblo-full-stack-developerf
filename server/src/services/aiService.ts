import { decryptSecret } from '../secrets.js';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import OpenAI from 'openai';
import prisma from '../db.js';
import { serverZone, dayKey, dayBounds } from '../utils/userTime.js';

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

async function getUserSettings(userId: string) {
  return await prisma.user.findUnique({ 
    where: { id: userId },
    include: { apiKeys: true }
  });
}

/** An OpenAI-compatible chat provider: OpenAI itself, or a local Ollama server. */
export interface OAIProvider {
  name: 'openai' | 'ollama';
  client: OpenAI;
  model: string;
  embedModel: string;
}

type ProviderName = 'openai' | 'gemini' | 'ollama';

function getOpenAIProvider(user: any): OAIProvider | null {
  const settings = user?.settings as any || {};
  const key = decryptSecret(user?.apiKeys?.openAiKey)?.trim();
  let apiKey = key;
  if (!apiKey && settings.forceCustomModels !== true) {
    const envKey = process.env.OPENAI_API_KEY?.trim();
    if (envKey && !envKey.includes('your-openai')) apiKey = envKey;
  }
  if (!apiKey) return null;
  return { name: 'openai', client: new OpenAI({ apiKey, timeout: PROVIDER_TIMEOUT_MS, maxRetries: 1 }), model: DEFAULT_OPENAI_MODEL, embedModel: 'text-embedding-3-small' };
}

export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
export const DEFAULT_OLLAMA_MODEL = 'llama3.2';
export const DEFAULT_OLLAMA_EMBED_MODEL = 'nomic-embed-text';

/** Local AI through Ollama (https://ollama.com), which speaks the OpenAI API on /v1. Nothing leaves the computer. */
function getOllamaProvider(user: any): OAIProvider | null {
  const settings = user?.settings as any || {};
  if (settings.ollamaEnabled !== true) return null;
  const base = String(settings.ollamaUrl || DEFAULT_OLLAMA_URL).trim().replace(/\/+$/, '');
  return {
    name: 'ollama',
    client: new OpenAI({ baseURL: `${base}/v1`, apiKey: 'ollama', timeout: 2 * 60 * 1000, maxRetries: 0 }),
    model: String(settings.ollamaModel || DEFAULT_OLLAMA_MODEL).trim(),
    embedModel: String(settings.ollamaEmbedModel || DEFAULT_OLLAMA_EMBED_MODEL).trim(),
  };
}

function getGeminiInstance(user: any) {
  const settings = user?.settings as any || {};
  const forceCustomModels = settings.forceCustomModels === true;
  const key = decryptSecret(user?.apiKeys?.geminiKey)?.trim();

  if (key) return new GoogleGenerativeAI(key);
  if (forceCustomModels) return null;

  const keysStr = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '';
  const keys = keysStr.split(',').map(k => k.trim()).filter(k => k && k !== 'your-gemini-api-key-here');
  if (keys.length === 0) return null;
  return new GoogleGenerativeAI(keys[0]);
}

/**
 * Which providers to try, in order, based on Settings → AI Providers → default model.
 * Choosing Local AI means local only: we never silently fall back to a cloud provider,
 * because that would send the user's notes off the computer against their choice.
 */
function providerOrder(user: any): ProviderName[] {
  const choice = (user?.settings as any)?.defaultAiModel || 'auto';
  // "Local only" and "Ask first" never send anything to the cloud from background features.
  // (The AI Hub asks the user before using a cloud model under "Ask first".)
  if (choice === 'ollama' || choice === 'ask') return ['ollama'];
  if (choice === 'openai') return ['openai', 'gemini', 'ollama'];
  if (choice === 'gemini') return ['gemini', 'openai', 'ollama'];
  return ['openai', 'gemini', 'ollama'];
}

function localOnlyError() {
  const err: any = new Error('Local AI is off or not running, and your AI setting keeps notes on this device. Start Ollama, or change "When Peblo needs AI" in AI Hub → Connections.');
  err.statusCode = 400;
  err.code = 'LOCAL_ONLY';
  return err;
}

function noKeyError() {
  const err: any = new Error('No AI set up. Add an OpenAI or Gemini API key, or turn on Local AI (Ollama), in AI Hub → Connections.');
  err.statusCode = 400;
  err.code = 'NO_AI_KEY';
  return err;
}

const PROVIDER_TIMEOUT_MS = 60_000;

/** Gives up on a provider that never answers, so the next one (or the error) is not kept waiting for minutes. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { const e: any = new Error('The AI took too long to answer.'); e.code = 'TIMEOUT'; reject(e); }, ms);
  });
  return Promise.race([p, limit]).finally(() => clearTimeout(timer));
}

// --- The Core Orchestrator: tries each configured provider in order ---
async function runWithCascade(
  operationName: string,
  userId: string,
  executeOpenAI: (openai: OpenAI, p: OAIProvider) => Promise<any>,
  executeGemini: (gemini: GoogleGenerativeAI) => Promise<any>
): Promise<any> {
  const user = await getUserSettings(userId);
  const providers = {
    openai: getOpenAIProvider(user),
    ollama: getOllamaProvider(user),
    gemini: getGeminiInstance(user),
  };

  const order = providerOrder(user);
  if (!order.some((n) => providers[n])) {
    if (order.length === 1 && (providers.openai || providers.gemini)) throw localOnlyError();
    throw noKeyError();
  }

  let timedOut = false;
  for (const name of order) {
    try {
      if (name === 'gemini' && providers.gemini) {
        console.log(`[${operationName}] Trying Gemini...`);
        return await withTimeout(executeGemini(providers.gemini), PROVIDER_TIMEOUT_MS);
      }
      if ((name === 'openai' || name === 'ollama') && providers[name]) {
        const p = providers[name]!;
        console.log(`[${operationName}] Trying ${p.name} (${p.model})...`);
        return await executeOpenAI(p.client, p);
      }
    } catch (error: any) {
      if (error?.code === 'TIMEOUT' || error?.name === 'APIConnectionTimeoutError') timedOut = true;
      console.warn(`[${operationName}] ${name} failed: ${error.message}`);
    }
  }

  const err: any = new Error(timedOut
    ? 'The AI took too long to answer. Try again, or pick a faster model in AI Hub → Connections.'
    : 'The AI request failed. Check AI Hub → Connections: your API key may be invalid or out of credit, or Ollama may not be running.');
  err.statusCode = 502;
  err.code = timedOut ? 'TIMEOUT' : 'PROVIDER_ERROR';
  throw err;
}

/** Ask for a JSON object from whichever provider is configured. */
async function completeJSON(operationName: string, userId: string, system: string, prompt: string): Promise<any> {
  return runWithCascade(operationName, userId,
    async (openai, p) => {
      const response = await openai.chat.completions.create({
        model: p.model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: `${system}\nRespond with valid JSON only.` },
          { role: 'user', content: prompt },
        ],
      });
      return parseJSONLoose(response.choices[0].message.content || '{}');
    },
    async (gemini) => {
      const model = gemini.getGenerativeModel({ model: process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL, systemInstruction: system });
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' },
      });
      return parseJSONLoose(result.response.text());
    }
  );
}

/** Ask for plain text from whichever provider is configured. */
async function completeText(operationName: string, userId: string, system: string, prompt: string): Promise<string> {
  return runWithCascade(operationName, userId,
    async (openai, p) => {
      const response = await openai.chat.completions.create({
        model: p.model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
      });
      return (response.choices[0].message.content || '').trim();
    },
    async (gemini) => {
      const model = gemini.getGenerativeModel({ model: process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL, systemInstruction: system });
      const result = await model.generateContent(prompt);
      return result.response.text().trim();
    }
  );
}

function parseJSONLoose(text: string): any {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error('AI returned invalid JSON');
  }
}

/** Lists models installed in the user's Ollama, to check the connection from Settings. */
export async function checkOllama(url?: string): Promise<{ ok: boolean; models: string[]; error?: string }> {
  const base = String(url || DEFAULT_OLLAMA_URL).trim().replace(/\/+$/, '');
  try {
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return { ok: false, models: [], error: `Ollama answered with HTTP ${res.status}` };
    const data: any = await res.json();
    return { ok: true, models: (data.models || []).map((m: any) => m.name) };
  } catch (err: any) {
    return { ok: false, models: [], error: `Could not reach Ollama at ${base}. Is it installed and running?` };
  }
}

// --- Specific Service Functions ---

export async function generateSummary(userId: string, title: string, content: string) {
  try {
    return await runWithCascade('AI Summary', userId,
      // OpenAI Implementation
      async (openai, p) => {
        const response = await openai.chat.completions.create({
          model: p.model,
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
    // Never invent a result. The error reaches the person, and nothing is saved or created.
    throw err;
  }
}

export async function extractActionItems(userId: string, title: string, content: string) {
  try {
    return await runWithCascade('AI Action Items', userId,
      // OpenAI Implementation
      async (openai, p) => {
        const response = await openai.chat.completions.create({
          model: p.model,
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
    // Never invent a result. The error reaches the person, and nothing is saved or created.
    throw err;
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
      async (openai, p) => {
        const response = await openai.chat.completions.create({
          model: p.model,
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
    // Never invent a result. The error reaches the person, and nothing is saved or created.
    throw err;
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
  const providers: Record<ProviderName, any> = {
    openai: getOpenAIProvider(user),
    ollama: getOllamaProvider(user),
    gemini: getGeminiInstance(user),
  };
  const chosen = providerOrder(user).find((n) => providers[n]);
  if (!chosen) throw noKeyError();

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  let fullResponse = '';

  if (chosen === 'gemini') {
    const model = providers.gemini.getGenerativeModel({
      model: process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL,
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

    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      fullResponse += chunkText;
      res.write(`data: ${JSON.stringify({ chunk: chunkText })}\n\n`);
    }
  } else {
    const p: OAIProvider = providers[chosen];
    const stream = await p.client.chat.completions.create({
      model: p.model,
      stream: true,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });
    for await (const part of stream) {
      const chunkText = part.choices[0]?.delta?.content || '';
      if (!chunkText) continue;
      fullResponse += chunkText;
      res.write(`data: ${JSON.stringify({ chunk: chunkText })}\n\n`);
    }
  }

  let parsed;
  try {
    parsed = parseJSONLoose(fullResponse);
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
      async (openai, p) => {
        const response = await openai.chat.completions.create({
          model: p.model,
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
    // Never invent a result. The error reaches the person, and nothing is saved or created.
    throw err;
  }
}

// --- Smart Intake: Analyze raw data and extract notes + tasks ---
export async function analyzeAndOrganize(userId: string, rawData: string, template: string = 'auto', tz: string = serverZone()) {
  // "today" and "tomorrow" are the person's, not the server's
  const today = dayKey(new Date(), tz);
  const tomorrow = dayKey(dayBounds(tz, new Date(), 1).start, tz);
  const dayOfWeek = new Date().toLocaleDateString('en-US', { weekday: 'long', timeZone: tz });

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
  - "deadline": ISO 8601 date string (YYYY-MM-DD) or null. Interpret relative dates like "next Monday", "by Friday", "in 2 weeks" relative to today (${today}, ${dayOfWeek}). If a task says "tomorrow", that means ${tomorrow}.
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
      async (openai, p) => {
        const response = await openai.chat.completions.create({
          model: p.model,
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
      async (openai, p) => {
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
          model: p.model,
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
    // Never invent a result. The error reaches the person, and nothing is saved or created.
    throw err;
  }
}

export async function generateEmbedding(userId: string, text: string): Promise<number[]> {
  try {
    return await runWithCascade('AI Embedding', userId,
      async (openai, p) => {
        const response = await openai.embeddings.create({
          model: p.embedModel,
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
    return await completeJSON('Smart Intake Extract', userId, 'You extract structure from raw text.', prompt);
  } catch (err: any) {
    if (err?.code === 'NO_AI_KEY') return { title: 'Unknown Import', category: 'uncategorized', summary: text.slice(0, 100), actionItems: [] };
    console.error('Smart Intake Error:', err);
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
    return await completeJSON('Voice Command', userId, 'You are a helpful AI voice assistant for a productivity app.', prompt);
  } catch (err: any) {
    if (err?.code === 'NO_AI_KEY') return { responseSpeech: 'AI is not set up yet. Add a key or turn on Local AI in Settings.', actions: [], needClarification: false };
    console.error('Voice Call Error:', err);
    return { responseSpeech: "Sorry, I couldn't process that command.", actions: [], needClarification: false };
  }
}

export async function generateVerbalNoteSummary(userId: string, title: string, content: string): Promise<string> {
  const prompt = `You are a voice assistant summarizing a note for a user over a voice call.
The note title is: "${title}"
The note content is:
${content}

Please provide a highly concise, 1-2 sentence speech-friendly summary of this note to read back to the user. Do not include markdown formatting, bullet points, or special characters (like asterisks). Keep it clear and natural.`;

  try {
    return await completeText('Verbal Summary', userId, 'You are a concise voice assistant.', prompt);
  } catch (err) {
    console.error('Note Summary Error:', err);
    return "The note content could not be read.";
  }
}

export async function suggestTag(userId: string, title: string, content: string): Promise<{ suggested_tag: string }> {
  try {
    return await runWithCascade('AI Suggest Tag', userId,
      // OpenAI Implementation
      async (openai, p) => {
        const response = await openai.chat.completions.create({
          model: p.model,
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


// ─────────────────────────── AI Hub ───────────────────────────

export interface HubMessage { role: 'user' | 'assistant'; content: string }

export interface HubModelInfo {
  routing: string;
  local: { enabled: boolean; ok: boolean; url: string; chatModel: string; embedModel: string; models: string[]; error?: string };
  cloud: { provider: 'openai' | 'gemini'; label: string; configured: boolean; model: string }[];
}

/** Everything the model picker and the Connections page need to know. */
export async function listHubModels(userId: string): Promise<HubModelInfo> {
  const user = await getUserSettings(userId);
  const settings = (user?.settings as any) || {};
  const ollama = getOllamaProvider(user);
  const url = String(settings.ollamaUrl || DEFAULT_OLLAMA_URL);
  const check = settings.ollamaEnabled === true ? await checkOllama(url) : { ok: false, models: [] as string[], error: undefined };
  return {
    routing: settings.defaultAiModel || 'auto',
    local: {
      enabled: settings.ollamaEnabled === true,
      ok: check.ok,
      url,
      chatModel: ollama?.model || DEFAULT_OLLAMA_MODEL,
      embedModel: ollama?.embedModel || DEFAULT_OLLAMA_EMBED_MODEL,
      models: check.models,
      error: check.error,
    },
    cloud: [
      { provider: 'openai', label: 'OpenAI', configured: !!getOpenAIProvider(user), model: DEFAULT_OPENAI_MODEL },
      { provider: 'gemini', label: 'Google Gemini', configured: !!getGeminiInstance(user), model: process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL },
    ],
  };
}

export interface HubRunOptions {
  /** Force a provider ('ollama' | 'openai' | 'gemini'); otherwise follow the routing setting. */
  provider?: ProviderName;
  /** Override the model name (e.g. a specific Ollama model). */
  model?: string;
  /** The user said yes to using a cloud model for this message. */
  allowCloud?: boolean;
  signal?: AbortSignal;
}

export interface HubRunResult { provider: ProviderName; model: string; local: boolean }

/**
 * Streams one AI Hub answer. Calls onDelta with each piece of text.
 * Throws an error with code CLOUD_CONSENT when only a cloud model could answer and the
 * user's setting says to ask first; the UI then asks and retries with allowCloud.
 */
export async function streamHubChat(
  userId: string,
  system: string,
  messages: HubMessage[],
  opts: HubRunOptions,
  onDelta: (text: string) => void
): Promise<HubRunResult> {
  const user = await getUserSettings(userId);
  const routing = ((user?.settings as any)?.defaultAiModel) || 'auto';
  const providers: Record<ProviderName, any> = {
    openai: getOpenAIProvider(user),
    ollama: getOllamaProvider(user),
    gemini: getGeminiInstance(user),
  };

  let order: ProviderName[];
  if (opts.provider) {
    order = [opts.provider];
  } else if (routing === 'ask') {
    order = opts.allowCloud ? ['ollama', 'openai', 'gemini'] : ['ollama'];
  } else {
    order = providerOrder(user);
  }

  const isCloud = (n: ProviderName) => n !== 'ollama';
  if (routing === 'ollama' && order.some(isCloud) && !opts.allowCloud) {
    const err: any = new Error('Your AI setting is "Local only", so cloud models are switched off. Change it in Connections to use them.');
    err.code = 'LOCAL_ONLY';
    throw err;
  }
  if (routing === 'ask' && opts.provider && isCloud(opts.provider) && !opts.allowCloud) {
    const err: any = new Error('This will send your question and the matching notes to ' + (opts.provider === 'openai' ? 'OpenAI' : 'Google') + '.');
    err.code = 'CLOUD_CONSENT';
    err.provider = opts.provider;
    throw err;
  }

  const available = order.filter((n) => providers[n]);
  if (!available.length) {
    if (routing === 'ask' && !opts.allowCloud && (providers.openai || providers.gemini)) {
      const err: any = new Error('Local AI isn\'t running. Answering this would send your question and the matching notes to ' + (providers.openai ? 'OpenAI' : 'Google') + '.');
      err.code = 'CLOUD_CONSENT';
      err.provider = providers.openai ? 'openai' : 'gemini';
      throw err;
    }
    if (order.length === 1 && order[0] === 'ollama' && (providers.openai || providers.gemini)) throw localOnlyError();
    throw noKeyError();
  }

  let lastError: any = null;
  for (const name of available) {
    let sent = false;
    try {
      if (name === 'gemini') {
        const modelName = opts.model || process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
        const model = providers.gemini.getGenerativeModel({ model: modelName, systemInstruction: system });
        const result = await model.generateContentStream({
          contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        });
        for await (const chunk of result.stream) {
          if (opts.signal?.aborted) break;
          const text = chunk.text();
          if (text) { sent = true; onDelta(text); }
        }
        return { provider: 'gemini', model: modelName, local: false };
      }
      const p: OAIProvider = providers[name];
      const modelName = opts.model && (opts.provider === name || name === 'ollama') ? opts.model : p.model;
      const stream = await p.client.chat.completions.create(
        { model: modelName, stream: true, messages: [{ role: 'system', content: system }, ...messages] },
        { signal: opts.signal }
      );
      for await (const part of stream) {
        const text = part.choices[0]?.delta?.content || '';
        if (text) { sent = true; onDelta(text); }
      }
      return { provider: name, model: modelName, local: name === 'ollama' };
    } catch (error: any) {
      if (opts.signal?.aborted) throw error;
      lastError = error;
      console.warn(`[AI Hub] ${name} failed: ${error.message}`);
      if (sent) throw error; // don't mix two models' answers
    }
  }
  // "Ask first": local AI was tried and failed; offer the cloud instead of just failing.
  if (routing === 'ask' && !opts.allowCloud && !opts.provider && (providers.openai || providers.gemini)) {
    const err: any = new Error('Local AI didn\'t answer (is Ollama running?). Answering would send your question and the matching notes to ' + (providers.openai ? 'OpenAI' : 'Google') + '.');
    err.code = 'CLOUD_CONSENT';
    err.provider = providers.openai ? 'openai' : 'gemini';
    throw err;
  }
  const err: any = new Error(lastError?.message?.includes('ECONNREFUSED') || lastError?.message?.includes('Connection error')
    ? 'Could not reach the model. If you use Local AI, check that Ollama is running.'
    : 'The AI request failed: ' + (lastError?.message || 'unknown error'));
  err.code = 'AI_FAILED';
  throw err;
}

// --- River and Orbit styles ---

export interface QuizQuestion { q: string; options: string[]; answer: number; explain: string; concept: string; note: number | null }

/**
 * Multiple-choice questions written only from the given notes.
 * Each question says which note it came from (its number in the list) and the short concept it tests.
 */
export async function makeQuiz(userId: string, topic: string, notes: { title: string; content: string }[], count = 10): Promise<QuizQuestion[]> {
  const material = notes
    .map((n, i) => `[${i + 1}] ${n.title}\n${n.content.slice(0, 2500)}`)
    .join('\n\n')
    .slice(0, 12000);
  const system = 'You write fair, exam-style multiple-choice quizzes for a student, using only the notes given. Never test facts that are not in the notes.';
  const prompt = `Topic: ${topic}\n\nWrite ${count} questions from these notes. Mix easy and hard. Each question has exactly 4 options and one correct answer.\n` +
    'Return JSON: {"questions":[{"q":"question","options":["a","b","c","d"],"answer":0,"explain":"one sentence on why","concept":"2-4 word concept it tests","note":1}]}\n' +
    '"answer" is the index (0-3) of the correct option. "note" is the number of the note the question comes from.\n\n' +
    `Notes:\n${material}`;
  const out = await completeJSON('Quiz', userId, system, prompt);
  const list: any[] = Array.isArray(out?.questions) ? out.questions : [];
  return list
    .filter((x) => x && typeof x.q === 'string' && Array.isArray(x.options) && x.options.length >= 2)
    .slice(0, count)
    .map((x) => {
      const options = x.options.slice(0, 4).map((o: any) => String(o));
      const answer = Number.isInteger(x.answer) && x.answer >= 0 && x.answer < options.length ? x.answer : 0;
      const note = Number.isInteger(x.note) && x.note >= 1 && x.note <= notes.length ? x.note : null;
      return { q: String(x.q), options, answer, explain: String(x.explain || ''), concept: String(x.concept || topic).slice(0, 60), note };
    });
}

export interface Promise_ { text: string; owner: string; due: string | null }

/** Commitments in a note: who promised what, and by when (ISO date, or null). */
export async function findPromises(userId: string, title: string, content: string, writtenAt: Date): Promise<Promise_[]> {
  const system = 'You find commitments in meeting notes and documents: things someone said they would do. Ignore general ideas and facts.';
  const prompt = `The note was written on ${writtenAt.toISOString()} (use it to turn "Thursday" or "tomorrow" into a date).\n` +
    'Return JSON: {"promises":[{"text":"short action, starting with a verb","owner":"name, or \\"you\\" if the writer","due":"ISO 8601 date-time or null"}]}\n' +
    'At most 6. If there are none, return {"promises":[]}.\n\n' +
    `Title: ${title}\n\n${content.slice(0, 8000)}`;
  const out = await completeJSON('Promises', userId, system, prompt);
  const list: any[] = Array.isArray(out?.promises) ? out.promises : [];
  return list
    .filter((x) => x && typeof x.text === 'string' && x.text.trim())
    .slice(0, 6)
    .map((x) => {
      const d = x.due ? new Date(x.due) : null;
      return { text: x.text.trim().slice(0, 160), owner: String(x.owner || 'you').slice(0, 40), due: d && !isNaN(d.getTime()) ? d.toISOString() : null };
    });
}

/** Three to five short points to read before a meeting, from the notes that mention it. */
export async function meetingBrief(userId: string, meeting: string, when: string, sources: string): Promise<{ points: { text: string; cite: number[] }[] }> {
  const system = "You prepare a busy person for a meeting using only their own notes. Be specific and short.";
  const prompt = `Meeting: ${meeting} (${when}).\n` +
    'Write 3 to 5 points to read before it: decisions, numbers, what people asked for, and open questions. Cite the notes each point uses by their numbers.\n' +
    'Return JSON: {"points":[{"text":"one sentence","cite":[1]}]}. If the notes say nothing useful about this meeting, return {"points":[]}.\n' +
    sources;
  const out = await completeJSON('Meeting brief', userId, system, prompt);
  const points: any[] = Array.isArray(out?.points) ? out.points : [];
  return {
    points: points
      .filter((p) => p && typeof p.text === 'string' && p.text.trim())
      .slice(0, 5)
      .map((p) => ({ text: p.text.trim(), cite: Array.isArray(p.cite) ? p.cite.filter((n: any) => Number.isInteger(n)).slice(0, 3) : [] })),
  };
}
