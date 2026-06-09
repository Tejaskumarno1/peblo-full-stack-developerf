import React, { useState, memo } from 'react';
import { Plus, Clock } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

function TodoCreateForm({ handleCreate, notes }) {
  const [searchParams] = useSearchParams();
  const [newText, setNewText] = useState('');
  const [newPriority, setNewPriority] = useState('medium');
  const [newDeadline, setNewDeadline] = useState(searchParams.get('deadline') || '');
  const [newStartTime, setNewStartTime] = useState('');
  const [newEndTime, setNewEndTime] = useState('');
  const [newRecurrence, setNewRecurrence] = useState('none');
  const [newTags, setNewTags] = useState('');
  const [newNoteId, setNewNoteId] = useState('');

  const onSubmit = (e) => {
    e.preventDefault();
    if (!newText.trim()) return;

    handleCreate({
      text: newText.trim(),
      priority: newPriority,
      deadline: newDeadline || null,
      startTime: newStartTime || null,
      endTime: newEndTime || null,
      recurrence: newRecurrence,
      tags: newTags ? newTags.split(',').map(t => t.trim()).filter(Boolean) : [],
      noteId: newNoteId || null
    });

    setNewText('');
    setNewDeadline('');
    setNewStartTime('');
    setNewEndTime('');
    setNewRecurrence('none');
    setNewTags('');
    setNewNoteId('');
    setNewPriority('medium');
  };

  return (
    <form className="todo-create-form" onSubmit={onSubmit}>
      <div className="todo-create-row">
        <input
          className="todo-create-input"
          type="text"
          placeholder="What needs to be done?"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
        />
        <button type="submit" className="todo-submit-btn" disabled={!newText.trim()}>
          <Plus size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
          Add
        </button>
      </div>

      <div className="todo-time-recurrence-row">
        <div className="todo-time-inputs">
          <Clock size={14} style={{ color: 'var(--dash-text-muted)' }} />
          <input type="time" value={newStartTime} onChange={e => setNewStartTime(e.target.value)} className="todo-time-input" aria-label="Start time" />
          <span className="todo-time-separator">-</span>
          <input type="time" value={newEndTime} onChange={e => setNewEndTime(e.target.value)} className="todo-time-input" aria-label="End time" />
        </div>
        <select value={newRecurrence} onChange={e => setNewRecurrence(e.target.value)} className="todo-recurrence-select">
          <option value="none">Does not repeat</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </select>
      </div>

      <div className="todo-meta-row">
        <div className="priority-selector">
          {['high', 'medium', 'low'].map(p => (
            <button
              key={p}
              type="button"
              className={`priority-btn ${p} ${newPriority === p ? 'active' : ''}`}
              onClick={() => setNewPriority(p)}
            >
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>

        <input
          className="todo-date-input"
          type="date"
          value={newDeadline}
          onChange={(e) => setNewDeadline(e.target.value)}
          placeholder="Deadline"
        />

        <input
          className="todo-tags-input"
          type="text"
          placeholder="Tags (comma separated)"
          value={newTags}
          onChange={(e) => setNewTags(e.target.value)}
        />

        {notes.length > 0 && (
          <select
            className="todo-note-select"
            value={newNoteId}
            onChange={(e) => setNewNoteId(e.target.value)}
          >
            <option value="">Link a note...</option>
            {notes.map(n => (
              <option key={n.id} value={n.id}>{n.title || 'Untitled'}</option>
            ))}
          </select>
        )}
      </div>
    </form>
  );
}

export default memo(TodoCreateForm);
