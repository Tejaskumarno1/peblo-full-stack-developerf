import { useEffect, useRef } from 'react';
import { BlockNoteView } from '@blocknote/mantine';
import { useCreateBlockNote, SuggestionMenuController, getDefaultReactSlashMenuItems } from '@blocknote/react';
import { filterSuggestionItems } from '@blocknote/core/extensions';
import '@blocknote/mantine/style.css';
import { Sparkles, CheckSquare, Wand2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { aiAPI, notesAPI } from '../api/index';
import Backlinks from './Backlinks';

import { useAuth } from '../context/AuthContext';

export default function BlockEditor({ initialContent, onChange, editable = true, formattingToolbar = true, noteId }) {
  const navigate = useNavigate();
  // Titles for the @ menu, refreshed every few seconds so a note made a moment ago can be linked
  const linkCache = useRef({ at: 0, notes: [] });
  // Initialize the editor
  const editor = useCreateBlockNote();
  const { theme } = useAuth();
  // True while the saved content is being loaded, so opening a note doesn't count as an edit
  const loadingRef = useRef(false);

  useEffect(() => {
    async function loadContent() {
      if (!initialContent) {
        return;
      }
      try {
        const newBlocks = await editor.tryParseMarkdownToBlocks(initialContent);
        loadingRef.current = true;
        editor.replaceBlocks(editor.document, newBlocks);
        setTimeout(() => { loadingRef.current = false; }, 0);
      } catch (err) {
        console.error('Failed to parse markdown:', err);
      }
    }
    loadContent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]); // Intentionally ignore initialContent to prevent cursor reset on every keystroke

  // True while an AI command is running: the "AI is processing..." placeholder must never reach autosave (PEB-70)
  const aiBusyRef = useRef(false);

  const handleChange = async () => {
    if (!onChange || loadingRef.current || aiBusyRef.current) return;
    const markdown = await editor.blocksToMarkdownLossy(editor.document);
    onChange(markdown);
  };

  const handleAiCommand = async (editorInstance, command) => {
    const cursorPos = editorInstance.getTextCursorPosition();
    const currentBlock = cursorPos?.block;
    if (!currentBlock) return;

    // Get block text
    let blockText = '';
    if (Array.isArray(currentBlock.content)) {
      blockText = currentBlock.content.map(c => c.text || '').join('');
    } else if (typeof currentBlock.content === 'string') {
      blockText = currentBlock.content;
    }

    if (!blockText || blockText.trim() === '') {
      alert('Please type some text in this block first before calling AI.');
      return;
    }

    const originalContent = currentBlock.content;
    const originalType = currentBlock.type;

    // Set thinking indicator
    aiBusyRef.current = true;
    editorInstance.updateBlock(currentBlock.id, {
      content: [{ type: 'text', text: 'AI is processing...', styles: { italic: true } }]
    });

    try {
      const response = await aiAPI.processBlock({ text: blockText, command });
      const resultText = response.data?.result || '';

      if (!resultText.trim()) {
        throw new Error('Empty response');
      }

      const lines = resultText.split('\n').map(l => l.trim()).filter(Boolean);

      if (lines.length > 0) {
        if (command === 'todo') {
          // Replace current block with first checklist item
          const firstLine = lines[0].replace(/^-\s*|^\[\s*\]\s*|^[0-9]+\.\s*/, '');
          editorInstance.updateBlock(currentBlock.id, {
            type: 'checkListItem',
            content: [{ type: 'text', text: firstLine, styles: {} }]
          });

          // Insert remaining lines as checklist items below
          let lastBlockId = currentBlock.id;
          for (let i = 1; i < lines.length; i++) {
            const cleanLine = lines[i].replace(/^-\s*|^\[\s*\]\s*|^[0-9]+\.\s*/, '');
            const newBlock = {
              type: 'checkListItem',
              content: [{ type: 'text', text: cleanLine, styles: {} }]
            };
            editorInstance.insertBlocks([newBlock], lastBlockId, 'after');
            
            // Find the inserted block to insert the next one after it
            const doc = editorInstance.document;
            const index = doc.findIndex(b => b.id === lastBlockId);
            if (index !== -1 && doc[index + 1]) {
              lastBlockId = doc[index + 1].id;
            }
          }
        } else {
          // Update block with first line
          editorInstance.updateBlock(currentBlock.id, {
            type: 'paragraph',
            content: [{ type: 'text', text: lines[0], styles: {} }]
          });

          // Insert remaining lines as paragraphs below
          let lastBlockId = currentBlock.id;
          for (let i = 1; i < lines.length; i++) {
            const newBlock = {
              type: 'paragraph',
              content: [{ type: 'text', text: lines[i], styles: {} }]
            };
            editorInstance.insertBlocks([newBlock], lastBlockId, 'after');
            
            const doc = editorInstance.document;
            const index = doc.findIndex(b => b.id === lastBlockId);
            if (index !== -1 && doc[index + 1]) {
              lastBlockId = doc[index + 1].id;
            }
          }
        }
      }
    } catch (err) {
      console.error('AI command failed:', err);
      editorInstance.updateBlock(currentBlock.id, {
        type: originalType,
        content: originalContent
      });
      alert('AI processing failed. Please try again.');
    } finally {
      aiBusyRef.current = false;
      handleChange(); // save the real result (or the restored original), never the placeholder
    }
  };

  const getCustomSlashMenuItems = (query) => {
    const defaultItems = getDefaultReactSlashMenuItems(editor);

    const aiItems = [
      {
        title: 'AI Summarize Block',
        onItemClick: () => handleAiCommand(editor, 'summarize'),
        aliases: ['ai-summarize', 'summarize', 'sum', 'ai'],
        group: 'AI Assistant',
        icon: <Sparkles size={16} style={{ color: 'var(--accent, #6366f1)' }} />,
        subtext: 'Summarize block text using AI.',
      },
      {
        title: 'AI Action Items',
        onItemClick: () => handleAiCommand(editor, 'todo'),
        aliases: ['ai-todo', 'todo', 'actions', 'tasks', 'ai'],
        group: 'AI Assistant',
        icon: <CheckSquare size={16} style={{ color: 'var(--accent, #6366f1)' }} />,
        subtext: 'Extract task checklist using AI.',
      },
      {
        title: 'AI Improve Writing',
        onItemClick: () => handleAiCommand(editor, 'improve'),
        aliases: ['ai-improve', 'improve', 'rewrite', 'rephrase', 'ai'],
        group: 'AI Assistant',
        icon: <Wand2 size={16} style={{ color: 'var(--accent, #6366f1)' }} />,
        subtext: 'Rewrite and improve block using AI.',
      },
      {
        title: 'AI Continue Writing',
        onItemClick: () => handleAiCommand(editor, 'continue'),
        aliases: ['ai-continue', 'continue', 'write', 'ai'],
        group: 'AI Assistant',
        icon: <Sparkles size={16} style={{ color: '#ec4899' }} />,
        subtext: 'Let AI write the next sentences for you.',
      }
    ];

    return filterSuggestionItems([...aiItems, ...defaultItems], query);
  };

  // PEB-273: @ opens a list of notes; choosing one inserts a normal Markdown link to /notes/<id>
  const getNoteLinkItems = async (query) => {
    if (Date.now() - linkCache.current.at > 5000) {
      try {
        const { data } = await notesAPI.getAll({ sort: 'updated', limit: 200 });
        linkCache.current = { at: Date.now(), notes: data.notes || [] };
      } catch { /* keep whatever we had */ }
    }
    const q = String(query || '').trim().toLowerCase();
    return linkCache.current.notes
      .filter((n) => n.id !== noteId && (n.title || 'Untitled').toLowerCase().includes(q))
      .slice(0, 8)
      .map((n) => ({
        title: n.title || 'Untitled',
        group: 'Link to a note',
        onItemClick: () => editor.insertInlineContent([{ type: 'link', href: `/notes/${n.id}`, content: n.title || 'Untitled' }, ' ']),
      }));
  };

  // Clicking a link to another note opens that note instead of leaving the app
  const onLinkClick = (e) => {
    const a = e.target?.closest?.('a');
    const m = a && /^\/notes\/([\w-]+)$/.exec(a.getAttribute('href') || '');
    if (m) { e.preventDefault(); e.stopPropagation(); navigate(`/notes/${m[1]}`); }
  };

  return (
    <div className="block-editor-container" onClickCapture={onLinkClick} style={{ padding: '0 24px', flex: 1, height: '100%', overflowY: 'auto', cursor: editable ? 'text' : 'default' }}>
      <BlockNoteView
        editor={editor}
        editable={editable}
        onChange={handleChange}
        theme={theme === 'dark' || theme === 'midnight' || (theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light'}
        slashMenu={false}
        formattingToolbar={formattingToolbar}
      >
        <SuggestionMenuController
          triggerCharacter={'/'}
          getItems={async (query) => getCustomSlashMenuItems(query)}
        />
        <SuggestionMenuController triggerCharacter={'@'} getItems={getNoteLinkItems} />
      </BlockNoteView>
      <Backlinks noteId={noteId} />
    </div>
  );
}
