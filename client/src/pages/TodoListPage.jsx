import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { todosAPI, notesAPI } from '../api';
import { Check, Trash2, FileText, ChevronDown, ChevronRight, ListTodo, AlertTriangle, Plus, Calendar as CalendarIcon, Clock, Moon, Flame, Briefcase, Home, Play, Pause, Square } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Navigation from '../components/Navigation';
import { useAuth } from '../context/AuthContext';
import '../styles/dashboard.css';
import '../styles/todolist.css';

export default function TodoListPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const initial = user?.name ? user.name.charAt(0).toUpperCase() : 'U';

  const [todos, setTodos] = useState([]);
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCompleted, setShowCompleted] = useState(false);
  const [filterMode, setFilterMode] = useState('all'); // all, high, work, personal

  // Form state
  const [newText, setNewText] = useState('');
  const [newPriority, setNewPriority] = useState('medium');
  const [newDeadline, setNewDeadline] = useState(searchParams.get('deadline') || '');
  const [newStartTime, setNewStartTime] = useState('');
  const [newEndTime, setNewEndTime] = useState('');
  const [newRecurrence, setNewRecurrence] = useState('none');
  const [newTags, setNewTags] = useState('');
  const [newNoteId, setNewNoteId] = useState('');

  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');

  // Pomodoro Timer State
  const [timer, setTimer] = useState({ taskId: null, timeLeft: 25 * 60, isRunning: false });

  useEffect(() => {
    loadData();
  }, []);

  // Timer Tick Effect
  useEffect(() => {
    let interval = null;
    if (timer.isRunning && timer.timeLeft > 0) {
      interval = setInterval(() => {
        setTimer(prev => ({ ...prev, timeLeft: prev.timeLeft - 1 }));
      }, 1000);
    } else if (timer.timeLeft === 0 && timer.isRunning) {
      setTimer(prev => ({ ...prev, isRunning: false }));
      // Optional: Could trigger browser notification or sound here
    }
    return () => clearInterval(interval);
  }, [timer.isRunning, timer.timeLeft]);

  const loadData = async () => {
    try {
      const [todosRes, notesRes] = await Promise.all([
        todosAPI.getAll(),
        notesAPI.getAll({ archived: false })
      ]);
      setTodos(todosRes.data.todos);
      setNotes(notesRes.data.notes || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newText.trim()) return;

    try {
      const payload = {
        text: newText.trim(),
        priority: newPriority,
        deadline: newDeadline || null,
        startTime: newStartTime || null,
        endTime: newEndTime || null,
        recurrence: newRecurrence,
        tags: newTags ? newTags.split(',').map(t => t.trim()).filter(Boolean) : [],
        noteId: newNoteId || null
      };
      const res = await todosAPI.create(payload);
      setTodos(prev => [res.data.todo, ...prev]);
      setNewText('');
      setNewDeadline('');
      setNewStartTime('');
      setNewEndTime('');
      setNewRecurrence('none');
      setNewTags('');
      setNewNoteId('');
      setNewPriority('medium');
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggle = async (todo) => {
    const original = todo.completed;
    setTodos(prev => prev.map(t => t.id === todo.id ? { ...t, completed: !t.completed } : t));
    try {
      await todosAPI.update(todo.id, { completed: !original });
    } catch {
      setTodos(prev => prev.map(t => t.id === todo.id ? { ...t, completed: original } : t));
    }
  };

  const handleDelete = async (id) => {
    setTodos(prev => prev.filter(t => t.id !== id));
    try {
      await todosAPI.delete(id);
    } catch {
      loadData();
    }
  };

  const handleUpdateText = async (e, id) => {
    e.preventDefault();
    if (!editText.trim()) return;
    const backup = [...todos];
    setTodos(todos.map(t => t.id === id ? { ...t, text: editText } : t));
    setEditingId(null);
    try {
      await todosAPI.update(id, { text: editText });
    } catch {
      setTodos(backup);
    }
  };

  const handleSnooze = async (task) => {
    const tmrw = new Date();
    tmrw.setDate(tmrw.getDate() + 1);
    tmrw.setHours(23, 59, 59, 999);
    const backup = [...todos];
    setTodos(todos.map(t => t.id === task.id ? { ...t, deadline: tmrw.toISOString() } : t));
    try {
      await todosAPI.update(task.id, { deadline: tmrw.toISOString() });
    } catch {
      setTodos(backup);
    }
  };

  // Helpers
  const isToday = (dateStr) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  };

  const isOverdue = (dateStr) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return d < now;
  };

  const formatDeadline = (dateStr) => {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (isToday(dateStr)) return 'Today';
    if (isOverdue(dateStr)) return 'Overdue';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const getDeadlineClass = (dateStr) => {
    if (isToday(dateStr)) return 'today';
    if (isOverdue(dateStr)) return 'overdue';
    return '';
  };

  // Group tasks
  const grouped = useMemo(() => {
    const filteredTodos = todos.filter(t => {
      if (filterMode === 'all') return true;
      if (filterMode === 'high') return t.priority === 'high' && !t.completed;
      if (filterMode === 'work') return t.todoTags?.some(tag => tag.toLowerCase() === 'work');
      if (filterMode === 'personal') return t.todoTags?.some(tag => tag.toLowerCase() === 'personal');
      return true;
    });

    const active = filteredTodos.filter(t => !t.completed);
    const completed = filteredTodos.filter(t => t.completed);

    const overdue = active.filter(t => t.deadline && isOverdue(t.deadline));
    const today = active.filter(t => t.deadline && isToday(t.deadline));
    const upcoming = active.filter(t => t.deadline && !isOverdue(t.deadline) && !isToday(t.deadline));
    const noDeadline = active.filter(t => !t.deadline);

    const priorityOrder = { high: 0, medium: 1, low: 2 };
    const sortByPriority = (a, b) => (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1);

    const sortByTime = (a, b) => {
      if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime);
      if (a.startTime) return -1;
      if (b.startTime) return 1;
      return sortByPriority(a, b);
    };

    return {
      overdue: overdue.sort(sortByTime),
      today: today.sort(sortByTime),
      upcoming: upcoming.sort((a, b) => {
        const dateA = new Date(a.deadline);
        const dateB = new Date(b.deadline);
        if (dateA.getTime() !== dateB.getTime()) return dateA - dateB;
        return sortByTime(a, b);
      }),
      noDeadline: noDeadline.sort(sortByPriority),
      completed
    };
  }, [todos, filterMode]);

  // Daily Progress calculation
  const todayTotal = grouped.today.length + grouped.completed.filter(t => isToday(t.deadline)).length;
  const todayCompleted = grouped.completed.filter(t => isToday(t.deadline)).length;
  const progressPercent = todayTotal === 0 ? 0 : Math.round((todayCompleted / todayTotal) * 100);

  const renderTask = (task) => (
    <motion.div 
      key={task.id} 
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
        {editingId === task.id ? (
          <form onSubmit={(e) => handleUpdateText(e, task.id)} style={{ width: '100%', marginBottom: '0.4rem' }}>
            <input
              type="text"
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              autoFocus
              onBlur={(e) => handleUpdateText(e, task.id)}
              className="todo-edit-input"
            />
          </form>
        ) : (
          <div className="todo-item-text" onClick={() => { setEditingId(task.id); setEditText(task.text); }}>
            {task.text}
          </div>
        )}
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

      <div className="todo-actions-hover">
        <button className="todo-delete-btn" onClick={() => setTimer({ taskId: task.id, timeLeft: 25 * 60, isRunning: true })} title="Start 25m Focus Timer">
          <Play size={16} />
        </button>
        <button className="todo-delete-btn" onClick={() => handleSnooze(task)} title="Snooze to Tomorrow">
          <Moon size={16} />
        </button>
        <button className="todo-delete-btn" onClick={() => handleDelete(task.id)} title="Delete task">
          <Trash2 size={16} />
        </button>
      </div>
    </motion.div>
  );

  const renderSection = (title, tasks, extra) => {
    if (tasks.length === 0) return null;
    return (
      <div className="todo-section">
        <div className={`todo-section-header ${extra || ''}`}>
          {extra === 'overdue' && <AlertTriangle size={14} />}
          {title}
          <span className="todo-section-count">{tasks.length}</span>
          {title === 'Today' && todayTotal > 0 && (
            <div className="todo-daily-progress">
              <div className="todo-progress-bar">
                <div className="todo-progress-fill" style={{ width: `${progressPercent}%` }} />
              </div>
              <span className="todo-progress-text">{progressPercent}%</span>
            </div>
          )}
        </div>
        <AnimatePresence mode="popLayout">
          {tasks.map(renderTask)}
        </AnimatePresence>
      </div>
    );
  };

  return (
    <div className="dashboard-page">
      <Navigation activeTab="tasks" />

      <main className="todo-main">
        {/* Mobile Header */}
        <header className="mobile-organic-header mobile-only" style={{ marginBottom: '1.5rem' }}>
          <div className="mobile-greeting">
            <span className="mobile-date" style={{ color: 'var(--dash-primary)' }}>Tasks</span>
            <h1>To-Do List</h1>
          </div>
          <div className="mobile-avatar-circle" onClick={() => document.querySelector('.profile-trigger')?.click()}>
            {initial}
          </div>
        </header>

        {/* Desktop Header */}
        <div className="todo-page-header desktop-only">
          <h1 className="todo-page-title">To-Do List</h1>
          <p className="todo-page-subtitle">Create tasks, set priorities, and track deadlines.</p>
          
          {/* Smart Filters */}
          <div className="todo-smart-filters">
            <button className={`todo-filter-chip ${filterMode === 'all' ? 'active' : ''}`} onClick={() => setFilterMode('all')}>
              <ListTodo size={14} style={{ marginRight: '6px', verticalAlign: 'middle', marginTop: '-2px' }} />
              All Tasks
            </button>
            <button className={`todo-filter-chip ${filterMode === 'high' ? 'active' : ''}`} onClick={() => setFilterMode('high')}>
              <Flame size={14} style={{ marginRight: '6px', verticalAlign: 'middle', marginTop: '-2px' }} />
              High Priority
            </button>
            <button className={`todo-filter-chip ${filterMode === 'work' ? 'active' : ''}`} onClick={() => setFilterMode('work')}>
              <Briefcase size={14} style={{ marginRight: '6px', verticalAlign: 'middle', marginTop: '-2px' }} />
              Work
            </button>
            <button className={`todo-filter-chip ${filterMode === 'personal' ? 'active' : ''}`} onClick={() => setFilterMode('personal')}>
              <Home size={14} style={{ marginRight: '6px', verticalAlign: 'middle', marginTop: '-2px' }} />
              Personal
            </button>
          </div>
        </div>

        {/* Task Creation Form */}
        <form className="todo-create-form" onSubmit={handleCreate}>
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

        {/* Task List */}
        {loading ? (
          <div className="todo-empty">
            <p>Loading tasks...</p>
          </div>
        ) : todos.length === 0 ? (
          <div className="todo-empty">
            <div className="todo-empty-icon">
              <ListTodo size={48} />
            </div>
            <h3>No tasks yet</h3>
            <p>Create your first task above to get started.</p>
          </div>
        ) : (
          <>
            {renderSection('Overdue', grouped.overdue, 'overdue')}
            {renderSection('Today', grouped.today)}
            {renderSection('Upcoming', grouped.upcoming)}
            {renderSection('No Deadline', grouped.noDeadline)}

            {grouped.completed.length > 0 && (
              <div className="todo-section">
                <button
                  className="todo-completed-toggle"
                  onClick={() => setShowCompleted(!showCompleted)}
                >
                  {showCompleted ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  Completed
                  <span className="todo-section-count">{grouped.completed.length}</span>
                </button>
                <AnimatePresence>
                  {showCompleted && grouped.completed.map(renderTask)}
                </AnimatePresence>
              </div>
            )}
          </>
        )}
      </main>

      {/* Floating Pomodoro Timer */}
      <AnimatePresence>
        {timer.taskId && (
          <motion.div 
            className="todo-floating-timer"
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
          >
            <div className="timer-info">
              <span className="timer-task">Focusing on: {todos.find(t => t.id === timer.taskId)?.text || 'Task'}</span>
              <span className="timer-time">
                {Math.floor(timer.timeLeft / 60).toString().padStart(2, '0')}:
                {(timer.timeLeft % 60).toString().padStart(2, '0')}
              </span>
            </div>
            <div className="timer-controls">
              {timer.isRunning ? (
                <button onClick={() => setTimer(prev => ({ ...prev, isRunning: false }))} className="timer-btn pause"><Pause size={20} /></button>
              ) : (
                <button onClick={() => setTimer(prev => ({ ...prev, isRunning: true }))} className="timer-btn play"><Play size={20} /></button>
              )}
              <button onClick={() => setTimer({ taskId: null, timeLeft: 25 * 60, isRunning: false })} className="timer-btn stop"><Square size={18} /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
