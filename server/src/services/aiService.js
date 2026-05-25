import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';

const DEFAULT_MODEL = 'gemini-2.5-flash';

let genAI = null;

function getGenAI() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'your-gemini-api-key-here') {
    return null;
  }
  if (!genAI) {
    genAI = new GoogleGenerativeAI(apiKey);
  }
  return genAI;
}

// Fallback mock responses when no API key is configured
function getMockResponse(type, title, content) {
  const snippet = content?.substring(0, 100) || '';
  switch (type) {
    case 'summary':
      return { summary: `This note titled "${title}" discusses key topics including the main ideas presented in the content. It covers important points that require attention and follow-up.` };
    case 'action_items':
      return { action_items: ['Review the main points discussed', 'Follow up on pending items', 'Schedule next review session'] };
    case 'title':
      return { suggested_title: title || 'Untitled Note' };
    default:
      return {};
  }
}

export async function generateSummary(title, content) {
  const ai = getGenAI();
  if (!ai) return getMockResponse('summary', title, content);

  const model = ai.getGenerativeModel({
    model: process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL,
    systemInstruction: "You are an elite executive assistant. Your summaries must be extremely dense, removing all fluff, and providing only high-signal information.",
  });

  try {
    const prompt = `Analyze the following note and provide a concise summary in 2-3 sentences. Focus on the key points and main ideas.\n\nNote Title: ${title}\nNote Content: ${content}`;

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            summary: { type: SchemaType.STRING, description: "The concise executive summary" }
          },
          required: ["summary"]
        }
      }
    });

    return JSON.parse(result.response.text());
  } catch (error) {
    console.error('AI Summary Error:', error.message);
    const err = new Error(error.message || 'AI summary failed');
    err.statusCode = 502;
    throw err;
  }
}

export async function extractActionItems(title, content) {
  const ai = getGenAI();
  if (!ai) return getMockResponse('action_items', title, content);

  const model = ai.getGenerativeModel({
    model: process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL,
    systemInstruction: "You are a ruthless project manager. Identify every single implicit or explicit task, assignment, or next step mentioned in the text. Be specific and action-oriented.",
  });

  try {
    const prompt = `Extract actionable items from the following note.\n\nNote Title: ${title}\nNote Content: ${content}`;

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            action_items: { 
              type: SchemaType.ARRAY, 
              items: { type: SchemaType.STRING },
              description: "List of highly specific actionable tasks"
            }
          },
          required: ["action_items"]
        }
      }
    });

    return JSON.parse(result.response.text());
  } catch (error) {
    console.error('AI Action Items Error:', error.message);
    const err = new Error(error.message || 'AI action extraction failed');
    err.statusCode = 502;
    throw err;
  }
}

export async function chatPlanNotes({ message, mode, targetNote, existingNotes }) {
  const ai = getGenAI();
  
  const contextList = existingNotes?.slice(0, 20).map(n => `ID: ${n.id} | Title: ${n.title}`).join('\n') || '';
  const titlesContext = contextList ? `Existing notes:\n${contextList}` : 'No existing notes.';

  const modeHint =
    mode === 'append' && targetNote
      ? `You are modifying the existing note "${targetNote.title}" (id: ${targetNote.id}).
Current Note Content:
"""
${targetNote.content}
"""
Based on the user's message, you can either add to the bottom using 'updateNote.appendContent', OR completely rewrite/edit the old content using 'updateNote.replaceContent'. Do not create new notes unless explicitly asked.`
      : 'You can create new notes OR update existing notes if the user asks you to modify or improve one of their existing notes. Use the ID from the context.';

  if (!ai) {
    return {
      reply: `I created a note from your request: "${message.slice(0, 80)}${message.length > 80 ? '…' : ''}"`,
      notes: [
        {
          title: message.slice(0, 48) || 'AI Note',
          content: `## Overview\n\n${message}\n\n## Next steps\n\n- Review and edit this note\n- Add tags in Workspace`,
          category: 'Personal',
          tags: ['ai', 'ideas'],
        },
      ],
      updateNote: null,
    };
  }

  const model = ai.getGenerativeModel({
    model: process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL,
    systemInstruction: `You are an elite, highly-paid "$10,000/month" AI Chief of Staff and Knowledge Manager.
Your job is to perfectly organize the user's thoughts into beautifully structured, comprehensive notes. 
When creating notes:
- Use extensive Markdown (tables, bold, headers, blockquotes, code blocks) to make them visually stunning.
- Expand on brief ideas with deep, insightful additions where appropriate.
- Assign the absolute best category (e.g., Work, Personal, Research, Ideas).
- Generate 2-5 highly relevant tags.
When the user asks to modify or improve an existing note (e.g. "update the list"):
- Find the most relevant note ID from the context.
- Use 'updateNote.replaceContent' to completely rewrite and improve the note, or 'updateNote.appendContent' to just add to the bottom.
- Provide a warm, extremely intelligent, and concise reply to the user.`
  });

  const prompt = `Context:
${titlesContext}

User message: "${message}"

Mode: ${modeHint}`;

  try {
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            reply: { type: SchemaType.STRING, description: "A warm, hyper-intelligent 1-2 sentence response to the user." },
            notes: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  title: { type: SchemaType.STRING, description: "Brilliant, engaging note title (3-8 words)" },
                  content: { type: SchemaType.STRING, description: "Extensive, beautifully formatted Markdown content" },
                  category: { type: SchemaType.STRING, description: "Note category (e.g., Work, Personal, Research, Learning, Ideas)" },
                  tags: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: "2-5 highly relevant tags (lowercase)" }
                },
                required: ["title", "content", "category", "tags"]
              }
            },
            updateNote: {
              type: SchemaType.OBJECT,
              properties: {
                noteId: { type: SchemaType.STRING, description: "ID of the existing note to update" },
                appendContent: { type: SchemaType.STRING, description: "Markdown content to append to the bottom" },
                replaceContent: { type: SchemaType.STRING, description: "Markdown content to completely REPLACE the existing note" }
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
  } catch (error) {
    console.error('AI Chat Error:', error.message);
    const err = new Error(error.message || 'AI chat failed');
    err.statusCode = 502;
    throw err;
  }
}

export async function suggestTitle(content) {
  const ai = getGenAI();
  if (!ai) return getMockResponse('title', '', content);

  const model = ai.getGenerativeModel({
    model: process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL,
    systemInstruction: "You are an expert copywriter. Your titles must be extremely engaging, clear, concise (3-8 words), and perfectly capture the core essence of the note.",
  });

  try {
    const prompt = `Based on the following note content, suggest the perfect title.\n\nNote Content: ${content}`;

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            suggested_title: { type: SchemaType.STRING }
          },
          required: ["suggested_title"]
        }
      }
    });

    return JSON.parse(result.response.text());
  } catch (error) {
    console.error('AI Title Error:', error.message);
    const err = new Error(error.message || 'AI title suggestion failed');
    err.statusCode = 502;
    throw err;
  }
}
