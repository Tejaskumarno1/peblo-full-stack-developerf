import React, { useState, useEffect } from 'react';
import { X, Save, Clock } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function TodoEditModal({ task, onClose, onSave, notes }) {
  const [editText, setEditText] = useState('');
  const [editPriority, setEditPriority] = useState('medium');
  const [editDeadline, setEditDeadline] = useState('');
  const [editStartTime, setEditStartTime] = useState('');
  const [editEndTime, setEditEndTime] = useState('');
  const [editRecurrence, setEditRecurrence] = useState('none');
  const [editTags, setEditTags] = useState('');
  const [editNoteId, setEditNoteId] = useState('');

  useEffect(() => {
    if (task) {
      setEditText(task.text || '');
      setEditPriority(task.priority || 'medium');
      // format date if needed, standard is YYYY-MM-DD
      setEditDeadline(task.deadline ? new Date(task.deadline).toISOString().split('T')[0] : '');
      setEditStartTime(task.startTime || '');
      setEditEndTime(task.endTime || '');
      setEditRecurrence(task.recurrence || 'none');
      setEditTags(task.todoTags ? task.todoTags.join(', ') : '');
      setEditNoteId(task.noteId || (task.note ? task.note.id : ''));
    }
  }, [task]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!editText.trim()) return;

    onSave({
      id: task.id,
      text: editText.trim(),
      priority: editPriority,
      deadline: editDeadline ? new Date(editDeadline).toISOString() : null,
      startTime: editStartTime || null,
      endTime: editEndTime || null,
      recurrence: editRecurrence,
      tags: editTags ? editTags.split(',').map(t => t.trim()).filter(Boolean) : [],
      noteId: editNoteId || null
    });
  };

  if (!task) return null;

  return (
    <AnimatePresence>
      <div className="settings-hub-overlay" onClick={onClose} style={{ zIndex: 9999 }}>
        <motion.div 
          className="settings-hub-container" 
          onClick={(e) => e.stopPropagation()}
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          style={{ maxWidth: '600px', height: 'auto', padding: '2rem', display: 'block' }}
        >
          <button className="settings-hub-close" onClick={onClose} type="button">
            <X size={18} />
          </button>
          
          <h2 className="settings-section-title" style={{ marginBottom: '1.5rem' }}>Edit Task</h2>

          <form onSubmit={handleSubmit}>
            <div className="settings-field-group">
              <label className="settings-field-label">Task Description</label>
              <input
                type="text"
                className="settings-field-input"
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                autoFocus
                required
              />
            </div>

            <div className="settings-grid-2">
              <div className="settings-field-group">
                <label className="settings-field-label">Priority</label>
                <div className="priority-selector" style={{ marginTop: '0.5rem' }}>
                  {['high', 'medium', 'low'].map(p => (
                    <button
                      key={p}
                      type="button"
                      className={`priority-btn ${p} ${editPriority === p ? 'active' : ''}`}
                      onClick={() => setEditPriority(p)}
                    >
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-field-group">
                <label className="settings-field-label">Deadline</label>
                <input
                  className="settings-field-input"
                  type="date"
                  value={editDeadline}
                  onChange={(e) => setEditDeadline(e.target.value)}
                />
              </div>
            </div>

            <div className="settings-grid-2">
              <div className="settings-field-group">
                <label className="settings-field-label">Time Window</label>
                <div className="todo-time-inputs" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '10px', padding: '0.65rem', marginTop: '0.5rem' }}>
                  <Clock size={14} style={{ color: 'var(--text-muted)' }} />
                  <input type="time" value={editStartTime} onChange={e => setEditStartTime(e.target.value)} className="todo-time-input" />
                  <span className="todo-time-separator">-</span>
                  <input type="time" value={editEndTime} onChange={e => setEditEndTime(e.target.value)} className="todo-time-input" />
                </div>
              </div>

              <div className="settings-field-group">
                <label className="settings-field-label">Recurrence</label>
                <select 
                  value={editRecurrence} 
                  onChange={e => setEditRecurrence(e.target.value)} 
                  className="settings-field-input"
                  style={{ marginTop: '0.5rem' }}
                >
                  <option value="none">Does not repeat</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>
            </div>

            <div className="settings-grid-2">
              <div className="settings-field-group">
                <label className="settings-field-label">Tags (comma separated)</label>
                <input
                  className="settings-field-input"
                  type="text"
                  value={editTags}
                  onChange={(e) => setEditTags(e.target.value)}
                  placeholder="e.g. Work, Urgent"
                />
              </div>

              {notes && notes.length > 0 && (
                <div className="settings-field-group">
                  <label className="settings-field-label">Linked Note</label>
                  <select
                    className="settings-field-input"
                    value={editNoteId}
                    onChange={(e) => setEditNoteId(e.target.value)}
                  >
                    <option value="">None</option>
                    {notes.map(n => (
                      <option key={n.id} value={n.id}>{n.title || 'Untitled'}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '2rem' }}>
              <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary">
                <Save size={16} /> Save Changes
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
