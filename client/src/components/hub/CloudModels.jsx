import { useAuth } from '../../context/AuthContext';
import { Check } from 'lucide-react';
import './localModels.css';

export const OPENAI_MODELS = [['gpt-4o-mini', 'GPT-4o mini', 'Fast and cheap'], ['gpt-4o', 'GPT-4o', 'Stronger'], ['gpt-4.1-mini', 'GPT-4.1 mini', 'Fast, newer'], ['gpt-4.1', 'GPT-4.1', 'Strongest']];
export const GEMINI_MODELS = [['gemini-2.5-flash', 'Gemini 2.5 Flash', 'Fast'], ['gemini-2.5-flash-lite', 'Gemini 2.5 Flash-Lite', 'Fastest, cheapest'], ['gemini-2.5-pro', 'Gemini 2.5 Pro', 'Strongest']];

function Group({ title, value, list, onPick, enabled }) {
  return (
    <div className="cm-group" role="radiogroup" aria-label={title}>
      <span className="cm-h">{title}{!enabled && <em> · add a key to use it</em>}</span>
      <div className="cm-list">
        {list.map(([id, name, note]) => {
          const on = value === id;
          return (
            <button key={id} type="button" role="radio" aria-checked={on} className={`cm-chip${on ? ' on' : ''}`} onClick={() => onPick(id)}>
              <b>{name}</b><small>{note}</small>{on && <Check size={14} strokeWidth={2.6} aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Pick which cloud model answers: one list per provider, the chosen one marked. Saved in the account settings. */
export default function CloudModels({ apply }) {
  const { settings } = useAuth();
  return (
    <div className="cm">
      <Group title="OpenAI model" enabled={!!settings?.openAiKey} value={settings?.openAiModel || 'gpt-4o-mini'} list={OPENAI_MODELS} onPick={(v) => apply({ openAiModel: v })} />
      <Group title="Gemini model" enabled={!!settings?.geminiKey} value={settings?.geminiModel || 'gemini-2.5-flash'} list={GEMINI_MODELS} onPick={(v) => apply({ geminiModel: v })} />
    </div>
  );
}
