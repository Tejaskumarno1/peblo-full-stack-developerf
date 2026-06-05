import { useEffect, useState, useMemo } from 'react';
import { BlockNoteView } from '@blocknote/mantine';
import { useCreateBlockNote } from '@blocknote/react';
import '@blocknote/mantine/style.css';

export default function BlockEditor({ initialContent, onChange, editable = true }) {
  const [blocks, setBlocks] = useState(null);

  // Initialize the editor
  const editor = useCreateBlockNote({
    // We start empty, and load markdown asynchronously
  });

  useEffect(() => {
    async function loadContent() {
      if (!initialContent) {
        // If empty, just ensure it has one empty paragraph
        // editor.document is already empty by default, so we can just return
        return;
      }
      try {
        const newBlocks = await editor.tryParseMarkdownToBlocks(initialContent);
        editor.replaceBlocks(editor.document, newBlocks);
      } catch (err) {
        console.error('Failed to parse markdown:', err);
      }
    }
    loadContent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]); // Intentionally ignore initialContent to prevent cursor reset on every keystroke

  const handleChange = async () => {
    if (!onChange) return;
    const markdown = await editor.blocksToMarkdownLossy(editor.document);
    onChange(markdown);
  };

  return (
    <div className="block-editor-container" style={{ padding: '0 24px', flex: 1, height: '100%', overflowY: 'auto', cursor: editable ? 'text' : 'default' }}>
      <BlockNoteView
        editor={editor}
        editable={editable}
        onChange={handleChange}
        theme="light" // Will adapt to Peblo's design later
      />
    </div>
  );
}
