import React, { useState, useRef, useEffect, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Calendar as CalendarIcon, Clock, FileText, Play, Moon, Trash2, MoreVertical, Edit2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

function TodoItem({
  task,
  handleToggle,
  handleUpdateText,
  setTimer,
  handleSnooze,
  handleDelete,
  getDeadlineClass,
  formatDeadline,
  onEditTask
}) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <motion.div 
      className={`todo-item ${task.completed ? 'completed' : ''}`}
      layout
      initial={{ opacity: 0, y: 15, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
      transition={{ duration: 0.2 }}
    >
      <button
        className={`todo-checkbox ${task.completed ? 'checked' : ''}`}
        onClick={() => handleToggle(task)}
        aria-label={task.completed ? 'Mark incomplete' : 'Mark complete'}
      >
        {task.completed && <Check size={14} strokeWidth={3} />}
      </button>

      <div className="todo-priority-dot" data-priority={task.priority}>
        <span className={`todo-priority-dot ${task.priority}`}></span>
      </div>

      <div className="todo-item-content">
        <div className="todo-item-text" onClick={() => onEditTask && onEditTask(task)}>
          {task.text}
        </div>
        <div className="todo-item-meta">
          {task.deadline && (
            <span className={`todo-deadline-badge ${getDeadlineClass(task.deadline)}`}>
              <CalendarIcon size={10} style={{ marginRight: '3px', verticalAlign: 'middle' }} />
              {formatDeadline(task.deadline)}
            </span>
          )}
          {task.startTime && (
            <span className="todo-time-badge">
              <Clock size={10} style={{ marginRight: '3px', verticalAlign: 'middle' }} />
              {task.startTime}{task.endTime ? ` - ${task.endTime}` : ''}
            </span>
          )}
          {task.recurrence && task.recurrence !== 'none' && (
            <span className="todo-recurrence-badge">
              ↻ {task.recurrence}
            </span>
          )}
          {task.todoTags?.map((tag, i) => (
            <span key={i} className="todo-tag-pill">{tag}</span>
          ))}
          {task.note && (
            <button
              className="todo-note-link"
              onClick={(e) => { e.stopPropagation(); navigate(`/notes/${task.note.id}`); }}
              title={`Open: ${task.note.title}`}
            >
              <FileText size={12} />
              {task.note.title?.substring(0, 20) || 'Note'}
            </button>
          )}
        </div>
      </div>

      <div className="todo-actions-dropdown" ref={menuRef} style={{ position: 'relative' }}>
        <button 
          className="todo-delete-btn" 
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="More options"
        >
          <MoreVertical size={16} />
        </button>

        <AnimatePresence>
          {menuOpen && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 5 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 5 }}
              transition={{ duration: 0.15 }}
              className="task-dropdown-menu"
              style={{
                position: 'absolute',
                right: 0,
                top: '100%',
                marginTop: '0.25rem',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '10px',
                boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
                zIndex: 50,
                minWidth: '160px',
                padding: '0.5rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px'
              }}
            >
              <button className="task-dropdown-item" onClick={() => { setMenuOpen(false); onEditTask && onEditTask(task); }}>
                <Edit2 size={14} /> Edit Task
              </button>
              <button className="task-dropdown-item" onClick={() => { setMenuOpen(false); setTimer({ taskId: task.id, timeLeft: 25 * 60, isRunning: true }); }}>
                <Play size={14} /> Start Timer
              </button>
              <button className="task-dropdown-item" onClick={() => { setMenuOpen(false); handleSnooze(task); }}>
                <Moon size={14} /> Snooze Tomorrow
              </button>
              <div style={{ height: '1px', background: 'var(--border-subtle)', margin: '4px 0' }}></div>
              <button className="task-dropdown-item danger" onClick={() => { setMenuOpen(false); handleDelete(task.id); }}>
                <Trash2 size={14} /> Delete
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

export default memo(TodoItem);
