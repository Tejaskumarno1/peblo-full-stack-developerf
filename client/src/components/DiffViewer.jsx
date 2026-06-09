import React, { useState, useMemo } from 'react';
import { diffLines } from 'diff';
import { Columns, List, RotateCcw, ArrowLeft } from 'lucide-react';
import '../styles/diff-viewer.css';

export default function DiffViewer({ oldText = '', newText = '', onRestore, onBack }) {
  const [viewMode, setViewMode] = useState('side-by-side'); // 'side-by-side' or 'inline'

  const diffParts = useMemo(() => {
    return diffLines(oldText, newText);
  }, [oldText, newText]);

  // For Inline View
  const inlineLines = useMemo(() => {
    const lines = [];
    diffParts.forEach((part) => {
      const partLines = part.value.split('\n');
      if (partLines[partLines.length - 1] === '') {
        partLines.pop();
      }
      partLines.forEach((line) => {
        lines.push({
          type: part.added ? 'added' : part.removed ? 'removed' : 'unchanged',
          text: line,
        });
      });
    });
    return lines;
  }, [diffParts]);

  // For Side-by-Side View: Align deletions and additions
  const sideBySideLines = useMemo(() => {
    const leftSide = [];  // Backup / Old
    const rightSide = []; // Current / New

    let idx = 0;
    while (idx < diffParts.length) {
      const currentPart = diffParts[idx];
      const nextPart = diffParts[idx + 1];

      const currentLines = currentPart.value.split('\n');
      if (currentLines[currentLines.length - 1] === '') currentLines.pop();

      if (currentPart.removed && nextPart && nextPart.added) {
        const nextLines = nextPart.value.split('\n');
        if (nextLines[nextLines.length - 1] === '') nextLines.pop();

        const maxLines = Math.max(currentLines.length, nextLines.length);
        for (let i = 0; i < maxLines; i++) {
          leftSide.push({
            type: i < currentLines.length ? 'removed' : 'empty',
            text: i < currentLines.length ? currentLines[i] : '',
          });
          rightSide.push({
            type: i < nextLines.length ? 'added' : 'empty',
            text: i < nextLines.length ? nextLines[i] : '',
          });
        }
        idx += 2;
      } else if (currentPart.removed) {
        currentLines.forEach((line) => {
          leftSide.push({ type: 'removed', text: line });
          rightSide.push({ type: 'empty', text: '' });
        });
        idx += 1;
      } else if (currentPart.added) {
        currentLines.forEach((line) => {
          leftSide.push({ type: 'empty', text: '' });
          rightSide.push({ type: 'added', text: line });
        });
        idx += 1;
      } else {
        currentLines.forEach((line) => {
          leftSide.push({ type: 'unchanged', text: line });
          rightSide.push({ type: 'unchanged', text: line });
        });
        idx += 1;
      }
    }

    return { leftSide, rightSide };
  }, [diffParts]);

  return (
    <div className="diff-viewer">
      <div className="diff-toolbar">
        <button type="button" className="btn-diff-action back-btn" onClick={onBack}>
          <ArrowLeft size={16} />
          <span>Back to list</span>
        </button>

        <div className="diff-toggle-group">
          <button
            type="button"
            className={`diff-toggle-btn ${viewMode === 'side-by-side' ? 'active' : ''}`}
            onClick={() => setViewMode('side-by-side')}
          >
            <Columns size={14} />
            <span>Side-by-Side</span>
          </button>
          <button
            type="button"
            className={`diff-toggle-btn ${viewMode === 'inline' ? 'active' : ''}`}
            onClick={() => setViewMode('inline')}
          >
            <List size={14} />
            <span>Inline</span>
          </button>
        </div>

        <button type="button" className="btn-diff-action restore-btn" onClick={onRestore}>
          <RotateCcw size={14} />
          <span>Restore Version</span>
        </button>
      </div>

      <div className="diff-content-wrapper">
        {viewMode === 'inline' ? (
          <div className="diff-panel-inline">
            <pre className="diff-pre">
              {inlineLines.map((line, index) => (
                <div key={index} className={`diff-line-row ${line.type}`}>
                  <span className="diff-line-indicator">
                    {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                  </span>
                  <span className="diff-line-content">{line.text || ' '}</span>
                </div>
              ))}
            </pre>
          </div>
        ) : (
          <div className="diff-panel-split">
            <div className="diff-split-column left">
              <div className="diff-column-header">Backup Version</div>
              <pre className="diff-pre">
                {sideBySideLines.leftSide.map((line, index) => (
                  <div key={index} className={`diff-line-row ${line.type}`}>
                    <span className="diff-line-num">{line.type !== 'empty' ? index + 1 : ''}</span>
                    <span className="diff-line-indicator">
                      {line.type === 'removed' ? '-' : ' '}
                    </span>
                    <span className="diff-line-content">{line.text || ' '}</span>
                  </div>
                ))}
              </pre>
            </div>
            <div className="diff-split-column right">
              <div className="diff-column-header">Current Version</div>
              <pre className="diff-pre">
                {sideBySideLines.rightSide.map((line, index) => (
                  <div key={index} className={`diff-line-row ${line.type}`}>
                    <span className="diff-line-num">{line.type !== 'empty' ? index + 1 : ''}</span>
                    <span className="diff-line-indicator">
                      {line.type === 'added' ? '+' : ' '}
                    </span>
                    <span className="diff-line-content">{line.text || ' '}</span>
                  </div>
                ))}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
