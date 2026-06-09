/**
 * AiWorkspacePanel — Extracted from WorkspacePage.
 * The right-side AI panel with Insights tab and Chat Copilot tab.
 */
import { memo } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import {
  Sparkles,
  X,
  MessageSquare,
  PenLine,
  Check,
} from 'lucide-react';
import { marked } from 'marked';

function AiWorkspacePanel({
  aiPanelTab,
  setAiPanelTab,
  aiResults,
  aiError,
  generating,
  noteContent,
  generateAIContent,
  setNoteTitle,
  // Chat copilot props
  wsChatInput,
  setWsChatInput,
  wsChatMessages,
  wsChatLoading,
  handleWsChatSubmit,
}) {
  const { aiPanelOpen, setAiPanelOpen } = useWorkspaceStore();

  if (!aiPanelOpen) return null;

  return (
    <div className="ai-panel">
      <div className="ai-panel-header">
        <h3>
          <Sparkles size={16} className="sparkle-pulse" />
          <span>AI Workspace Copilot</span>
        </h3>
        <button type="button" className="close-ai-btn" onClick={() => setAiPanelOpen(false)} aria-label="Close panel">
          <X size={16} />
        </button>
      </div>

      <div className="ai-tabs-container">
        <div className="ai-tabs-pill">
          <button
            className={`ai-tab-btn ${aiPanelTab === 'assist' ? 'active' : ''}`}
            onClick={() => setAiPanelTab('assist')}
          >
            <Sparkles size={14} />
            <span>Insights</span>
          </button>
          <button
            className={`ai-tab-btn ${aiPanelTab === 'chat' ? 'active' : ''}`}
            onClick={() => setAiPanelTab('chat')}
          >
            <MessageSquare size={14} />
            <span>Chat Copilot</span>
          </button>
        </div>
      </div>

      <div className="ai-panel-content">
        {aiPanelTab === 'assist' && (
          <div className="ai-assist-tab">
            <div className="ai-actions">
              <button
                type="button"
                className={`ai-action-btn primary ${generating ? 'generating' : ''}`}
                onClick={() => generateAIContent('summary')}
                disabled={generating || !noteContent?.trim()}
              >
                <Sparkles size={16} className={`btn-icon ${generating ? 'spinning' : ''}`} />
                <span>{generating ? 'Summarizing Document...' : 'Generate Summary'}</span>
              </button>
              <button
                type="button"
                className={`ai-action-btn outline ${generating ? 'generating' : ''}`}
                onClick={() => generateAIContent('actions')}
                disabled={generating || !noteContent?.trim()}
              >
                <Check size={16} className={`btn-icon ${generating ? 'spinning' : ''}`} />
                <span>{generating ? 'Extracting Tasks...' : 'Extract Action Items'}</span>
              </button>
              <button
                type="button"
                className={`ai-action-btn outline ${generating ? 'generating' : ''}`}
                onClick={() => generateAIContent('title')}
                disabled={generating || !noteContent?.trim()}
              >
                <PenLine size={16} className={`btn-icon ${generating ? 'spinning' : ''}`} />
                <span>{generating ? 'Brainstorming...' : 'Suggest Title'}</span>
              </button>
            </div>

            {aiError && (
              <div className="ai-error-container">
                <p className="ai-error">{aiError}</p>
              </div>
            )}

            {Object.keys(aiResults).length > 0 && (
              <div className="ai-results-card">
                <div className="ai-results-card-header">
                  <Sparkles size={14} className="ai-accent-color" />
                  <span>AI Insights & Analytics</span>
                </div>
                <div className="ai-results-content">
                  {aiResults.summary?.summary && (
                    <div className="ai-result-section">
                      <h5>Summary</h5>
                      <p>{aiResults.summary.summary}</p>
                    </div>
                  )}
                  {aiResults.actions?.action_items?.length > 0 && (
                    <div className="ai-result-section">
                      <h5>Action Items</h5>
                      <ul className="ai-action-list">
                        {aiResults.actions.action_items.map((item, i) => (
                          <li key={i}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {aiResults.title?.suggested_title && (
                    <div className="title-suggestion">
                      <div className="title-suggestion-info">
                        <h5>Suggested Title</h5>
                        <span>{aiResults.title.suggested_title}</span>
                      </div>
                      <button
                        type="button"
                        className="btn btn-sm btn-primary apply-title-btn"
                        onClick={() => setNoteTitle(aiResults.title.suggested_title)}
                      >
                        Apply
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {aiPanelTab === 'chat' && (
          <div className="ws-ai-chat-section">
            <div className="ws-ai-chat-messages">
              {wsChatMessages.length === 0 ? (
                <div className="chat-empty-state">
                  <div className="chat-empty-icon">
                    <MessageSquare size={24} />
                  </div>
                  <h4>Interactive AI Copilot</h4>
                  <p>Ask questions, brainstorm adjustments, or command the AI to edit your note.</p>
                  <div className="chat-suggestions-grid">
                    <button
                      type="button"
                      className="chat-suggestion-chip"
                      onClick={() => setWsChatInput("Summarize my note and list the core takeaways.")}
                    >
                      ✨ Summarize Takeaways
                    </button>
                    <button
                      type="button"
                      className="chat-suggestion-chip"
                      onClick={() => setWsChatInput("Convert this note into a clean checklist.")}
                    >
                      ✅ Make Checklist
                    </button>
                    <button
                      type="button"
                      className="chat-suggestion-chip"
                      onClick={() => setWsChatInput("Fix any grammar errors and make the tone professional.")}
                    >
                      ✍️ Improve Grammar
                    </button>
                    <button
                      type="button"
                      className="chat-suggestion-chip"
                      onClick={() => setWsChatInput("Brainstorm 3 creative follow-up topics based on this.")}
                    >
                      💡 Brainstorm Ideas
                    </button>
                  </div>
                </div>
              ) : (
                wsChatMessages.map((m, i) => (
                  <div key={i} className={`ws-ai-chat-msg ${m.role} ${m.isError ? 'error' : ''}`}>
                    <div className="ws-ai-chat-bubble" dangerouslySetInnerHTML={{ __html: marked.parse(m.text || '') }} />
                  </div>
                ))
              )}
              {wsChatLoading && (
                <div className="ws-ai-chat-msg assistant">
                  <div className="ws-ai-chat-bubble typing">
                    <span className="dot"></span><span className="dot"></span><span className="dot"></span>
                  </div>
                </div>
              )}
            </div>
            <form className="ws-ai-chat-form" onSubmit={handleWsChatSubmit}>
              <div className="ws-ai-chat-input-wrapper">
                <input
                  type="text"
                  placeholder="Ask Copilot to write, edit, or analyze..."
                  value={wsChatInput}
                  onChange={e => setWsChatInput(e.target.value)}
                  disabled={wsChatLoading}
                />
                <button type="submit" className="ws-ai-chat-send" disabled={wsChatLoading || !wsChatInput.trim()}>
                  <Sparkles size={14} />
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(AiWorkspacePanel);
