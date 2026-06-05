import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { todosAPI } from '../api';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Check,
  FileText,
  CalendarDays,
  ListTodo,
  Clock,
  AlertTriangle,
  Flame,
  Trash2,
  Edit2
} from 'lucide-react';
import Navigation from '../components/Navigation';
import { useAuth } from '../context/AuthContext';
import '../styles/dashboard.css';
import '../styles/calendar.css';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function CalendarPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const initial = user?.name ? user.name.charAt(0).toUpperCase() : 'U';

  const [currentDate, setCurrentDate] = useState(new Date());
  const [todos, setTodos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState(new Date()); // Auto-select today
  const [viewMode, setViewMode] = useState('month'); // 'month' or 'day'
  const [isAddingTask, setIsAddingTask] = useState(false);
  const [newTaskText, setNewTaskText] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState('medium');
  const [newTaskStartTime, setNewTaskStartTime] = useState('');
  const [newTaskEndTime, setNewTaskEndTime] = useState('');
  const [newTaskRecurrence, setNewTaskRecurrence] = useState('none');
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [editTaskText, setEditTaskText] = useState('');

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const monthLabel = currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // Load todos for the current month
  useEffect(() => {
    loadMonthTodos();
  }, [year, month]);

  const loadMonthTodos = async () => {
    setLoading(true);
    try {
      const from = new Date(year, month, 1).toISOString();
      const to = new Date(year, month + 1, 0, 23, 59, 59).toISOString();
      const res = await todosAPI.getRange(from, to);
      setTodos(res.data.todos);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    window.addEventListener('todo-updated', loadMonthTodos);
    return () => window.removeEventListener('todo-updated', loadMonthTodos);
  }, [year, month]);

  const handleToggle = async (todo) => {
    const original = todo.completed;
    setTodos(prev => prev.map(t => t.id === todo.id ? { ...t, completed: !t.completed } : t));
    try {
      await todosAPI.update(todo.id, { completed: !original });
    } catch {
      setTodos(prev => prev.map(t => t.id === todo.id ? { ...t, completed: original } : t));
    }
  };

  const handleCreateTask = async (e) => {
    e.preventDefault();
    if (!newTaskText.trim() || !selectedDay) return;
    
    const deadline = new Date(selectedDay);
    deadline.setHours(23, 59, 59, 999);
    
    try {
      const res = await todosAPI.create({
        text: newTaskText,
        priority: newTaskPriority,
        deadline: deadline.toISOString(),
        startTime: newTaskStartTime,
        endTime: newTaskEndTime,
        recurrence: newTaskRecurrence
      });
      setTodos([...todos, res.data.todo]);
      setNewTaskText('');
      setNewTaskStartTime('');
      setNewTaskEndTime('');
      setNewTaskRecurrence('none');
      setIsAddingTask(false);
    } catch (err) {
      console.error('Failed to create task', err);
    }
  };

  const handleDeleteTask = async (id) => {
    const backup = [...todos];
    setTodos(todos.filter(t => t.id !== id));
    try {
      await todosAPI.delete(id);
    } catch {
      setTodos(backup);
    }
  };

  const handleUpdateTask = async (e, id) => {
    e.preventDefault();
    if (!editTaskText.trim()) return;
    
    const backup = [...todos];
    setTodos(todos.map(t => t.id === id ? { ...t, text: editTaskText } : t));
    setEditingTaskId(null);
    
    try {
      await todosAPI.update(id, { text: editTaskText });
    } catch {
      setTodos(backup);
    }
  };

  const handleDropTask = async (taskId, newDate) => {
    const d = new Date(newDate);
    d.setHours(23, 59, 59, 999);
    
    const backup = [...todos];
    setTodos(todos.map(t => t.id === taskId ? { ...t, deadline: d.toISOString() } : t));
    
    try {
      await todosAPI.update(taskId, { deadline: d.toISOString() });
    } catch {
      setTodos(backup);
    }
  };

  const handleJumpToOverdue = () => {
    const overdueTasks = todos.filter(t => {
      if (t.completed || !t.deadline) return false;
      const d = new Date(t.deadline);
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      return d < now;
    });
    if (overdueTasks.length === 0) return;
    
    overdueTasks.sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
    const earliestDate = new Date(overdueTasks[0].deadline);
    
    setCurrentDate(new Date(earliestDate.getFullYear(), earliestDate.getMonth(), 1));
    setSelectedDay(earliestDate);
    setIsAddingTask(false);
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (!selectedDay) return;

      if (e.key === 'ArrowLeft') {
        const prevDay = new Date(selectedDay);
        prevDay.setDate(prevDay.getDate() - 1);
        setSelectedDay(prevDay);
        setCurrentDate(new Date(prevDay.getFullYear(), prevDay.getMonth(), 1));
      } else if (e.key === 'ArrowRight') {
        const nextDay = new Date(selectedDay);
        nextDay.setDate(nextDay.getDate() + 1);
        setSelectedDay(nextDay);
        setCurrentDate(new Date(nextDay.getFullYear(), nextDay.getMonth(), 1));
      } else if (e.key === 'n' || e.key === 'N') {
        setIsAddingTask(true);
        e.preventDefault();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedDay]);

  // Build calendar grid
  const calendarDays = useMemo(() => {
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const cells = [];

    for (let i = firstDay - 1; i >= 0; i--) {
      cells.push({ day: daysInPrevMonth - i, outside: true, date: null });
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d);
      cells.push({ day: d, outside: false, date });
    }

    const remaining = 42 - cells.length;
    for (let i = 1; i <= remaining; i++) {
      cells.push({ day: i, outside: true, date: null });
    }

    return cells;
  }, [year, month]);

  // Map: dateString -> tasks
  const tasksByDate = useMemo(() => {
    const map = {};
    todos.forEach(todo => {
      if (!todo.deadline) return;
      const key = new Date(todo.deadline).toLocaleDateString('en-CA');
      if (!map[key]) map[key] = [];
      map[key].push(todo);
    });
    return map;
  }, [todos]);

  // Month summary stats
  const monthStats = useMemo(() => {
    const total = todos.length;
    const completed = todos.filter(t => t.completed).length;
    const overdue = todos.filter(t => {
      if (t.completed || !t.deadline) return false;
      const d = new Date(t.deadline);
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      return d < now;
    }).length;
    const highPriority = todos.filter(t => !t.completed && t.priority === 'high').length;
    return { total, completed, overdue, highPriority };
  }, [todos]);

  const isToday = (date) => {
    if (!date) return false;
    const now = new Date();
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  };

  const isSelected = (date) => {
    if (!date || !selectedDay) return false;
    return date.getFullYear() === selectedDay.getFullYear() && date.getMonth() === selectedDay.getMonth() && date.getDate() === selectedDay.getDate();
  };

  const getDateKey = (date) => {
    if (!date) return '';
    return date.toLocaleDateString('en-CA');
  };

  const handleCellClick = (cell) => {
    if (cell.outside) return;
    setSelectedDay(cell.date);
  };

  const handlePrevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
    setSelectedDay(null);
    setIsAddingTask(false);
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
    setSelectedDay(null);
    setIsAddingTask(false);
  };

  const handleGoToday = () => {
    const now = new Date();
    setCurrentDate(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelectedDay(now);
    setIsAddingTask(false);
  };

  const selectedDayTasks = selectedDay ? (tasksByDate[getDateKey(selectedDay)] || []) : [];
  
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  const selectedActiveTasks = selectedDayTasks.filter(t => !t.completed).sort((a, b) => {
    if (a.startTime && b.startTime) {
      return a.startTime.localeCompare(b.startTime);
    } else if (a.startTime) {
      return -1;
    } else if (b.startTime) {
      return 1;
    } else {
      return (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1);
    }
  });
  const selectedCompletedTasks = selectedDayTasks.filter(t => t.completed);

  const selectedDayLabel = selectedDay
    ? selectedDay.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    : '';

  const isSelectedToday = selectedDay && isToday(selectedDay);

  // Relative day label
  const getRelativeLabel = () => {
    if (!selectedDay) return '';
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const sel = new Date(selectedDay);
    sel.setHours(0, 0, 0, 0);
    const diff = Math.round((sel - now) / (1000 * 60 * 60 * 24));
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff === -1) return 'Yesterday';
    if (diff > 0 && diff <= 7) return `In ${diff} days`;
    if (diff < 0) return `${Math.abs(diff)} days ago`;
    return '';
  };

  return (
    <div className="dashboard-page">
      <Navigation activeTab="calendar" />

      <div className="cal-layout">
        {/* Left: Calendar Grid */}
        <main className="cal-grid-section">
          {/* Mobile Header */}
          <header className="mobile-organic-header mobile-only" style={{ marginBottom: '1rem' }}>
            <div className="mobile-greeting">
              <span className="mobile-date" style={{ color: 'var(--dash-primary)' }}>Schedule</span>
              <h1>Calendar</h1>
            </div>
            <div className="mobile-avatar-circle" onClick={() => document.querySelector('.profile-trigger')?.click()}>
              {initial}
            </div>
          </header>

          {/* Month Nav */}
          <div className="cal-top-bar">
            <div className="cal-month-nav">
              <button className="cal-nav-btn" onClick={handlePrevMonth} aria-label="Previous month">
                <ChevronLeft size={18} />
              </button>
              <h2 className="cal-month-label">{viewMode === 'month' ? monthLabel : selectedDayLabel}</h2>
              <button className="cal-nav-btn" onClick={handleNextMonth} aria-label="Next month">
                <ChevronRight size={18} />
              </button>
            </div>
            <div className="cal-top-actions" style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <div className="cal-view-toggle desktop-only">
                <button className={viewMode === 'month' ? 'active' : ''} onClick={() => setViewMode('month')}>Month</button>
                <button className={viewMode === 'day' ? 'active' : ''} onClick={() => setViewMode('day')}>Day</button>
              </div>
              <button className="cal-today-btn" onClick={handleGoToday}>
                Today
              </button>
            </div>
          </div>

          {/* Stats Bar */}
          <div className="cal-stats-strip">
            <div className="cal-stat-chip">
              <ListTodo size={13} />
              <span>{monthStats.total} tasks</span>
            </div>
            <div className="cal-stat-chip done">
              <Check size={13} />
              <span>{monthStats.completed} done</span>
            </div>
            {monthStats.overdue > 0 && (
              <div className="cal-stat-chip overdue clickable" onClick={handleJumpToOverdue} style={{ cursor: 'pointer' }} title="Jump to oldest overdue task">
                <AlertTriangle size={13} />
                <span>{monthStats.overdue} overdue</span>
              </div>
            )}
            {monthStats.highPriority > 0 && (
              <div className="cal-stat-chip high">
                <Flame size={13} />
                <span>{monthStats.highPriority} urgent</span>
              </div>
            )}
          </div>

          {/* Calendar Grid */}
          {viewMode === 'day' ? (
            <div className="cal-day-timeline">
              <div className="cal-timeline-all-day">
                <span className="cal-all-day-label">All Day</span>
                <div className="cal-all-day-tasks">
                  {selectedDayTasks.filter(t => !t.startTime).map(t => (
                    <div key={t.id} className={`cal-all-day-task priority-${t.priority} ${t.completed ? 'completed' : ''}`} onClick={() => handleToggle(t)}>
                      {t.completed ? <Check size={11} className="completed-icon" strokeWidth={3} /> : <div className={`cal-dot ${t.priority}`} />}
                      <span className="text">{t.text}</span>
                    </div>
                  ))}
                  {selectedDayTasks.filter(t => !t.startTime).length === 0 && (
                    <span className="cal-all-day-empty">No all-day tasks</span>
                  )}
                </div>
              </div>
              
              <div className="cal-timeline-scroll">
                {Array.from({ length: 24 }).map((_, i) => (
                  <div key={i} className="cal-timeline-hour">
                    <span className="cal-hour-label">
                      {i === 0 ? '12 AM' : i < 12 ? `${i} AM` : i === 12 ? '12 PM' : `${i - 12} PM`}
                    </span>
                    <div className="cal-hour-line" />
                  </div>
                ))}
                
                {selectedDayTasks.filter(t => t.startTime).map(t => {
                  const [sh, sm] = t.startTime.split(':').map(Number);
                  const top = (sh * 60) + sm;
                  let height = 60; // default 1 hour
                  if (t.endTime) {
                    const [eh, em] = t.endTime.split(':').map(Number);
                    height = (eh * 60) + em - top;
                    if (height < 25) height = 25; // min height
                  }
                  
                  return (
                    <div 
                      key={t.id} 
                      className={`cal-timeline-task priority-${t.priority} ${t.completed ? 'completed' : ''}`} 
                      style={{ top: `${top}px`, height: `${height}px` }}
                      onClick={() => handleToggle(t)}
                    >
                      <div className="cal-timeline-task-bg" />
                      <div className="cal-timeline-task-content">
                        <span className="cal-timeline-task-title">{t.text}</span>
                        <span className="cal-timeline-task-time">
                          {t.startTime} {t.endTime ? `- ${t.endTime}` : ''}
                        </span>
                      </div>
                      {t.completed && <Check size={14} className="cal-timeline-check" strokeWidth={3} />}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
          <div className="cal-grid">
            {DAYS.map(day => (
              <div key={day} className="cal-day-header">{day}</div>
            ))}

            {calendarDays.map((cell, i) => {
              const key = getDateKey(cell.date);
              const dayTasks = tasksByDate[key] || [];
              const activeCount = dayTasks.filter(t => !t.completed).length;
              const completedCount = dayTasks.filter(t => t.completed).length;
              const priorities = [...new Set(dayTasks.filter(t => !t.completed).map(t => t.priority))];
              const priorityOrder = ['high', 'medium', 'low'];
              priorities.sort((a, b) => priorityOrder.indexOf(a) - priorityOrder.indexOf(b));

              const cellIsToday = isToday(cell.date);
              const cellIsSelected = isSelected(cell.date);
              
              let isOverdue = false;
              if (cell.date && activeCount > 0) {
                 const d = new Date(cell.date);
                 d.setHours(23, 59, 59, 999);
                 isOverdue = d < new Date();
              }

              return (
                <div
                  key={i}
                  className={`cal-cell ${cell.outside ? 'outside' : ''} ${cellIsToday ? 'today' : ''} ${cellIsSelected ? 'selected' : ''} ${isOverdue ? 'overdue' : ''}`}
                  onClick={() => { handleCellClick(cell); setIsAddingTask(false); }}
                  onDragOver={(e) => {
                    if (!cell.date) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    e.currentTarget.classList.add('drag-over');
                  }}
                  onDragLeave={(e) => {
                    e.currentTarget.classList.remove('drag-over');
                  }}
                  onDrop={(e) => {
                    e.currentTarget.classList.remove('drag-over');
                    if (!cell.date) return;
                    const taskId = e.dataTransfer.getData('taskId');
                    if (taskId) {
                      handleDropTask(taskId, cell.date);
                    }
                  }}
                >
                  <div className="cal-cell-top">
                    <span className={`cal-day-num ${cellIsToday ? 'today-badge' : ''}`}>
                      {cell.day}
                    </span>
                    {activeCount > 0 && (
                      <span className="cal-task-count">{activeCount}</span>
                    )}
                  </div>
                  {priorities.length > 0 && (
                    <div className="cal-dots">
                      {priorities.map((p, pi) => (
                        <div key={pi} className={`cal-dot ${p}`} />
                      ))}
                    </div>
                  )}
                  {completedCount > 0 && activeCount === 0 && (
                    <div className="cal-done-indicator">
                      <Check size={10} strokeWidth={3} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          )}
        </main>

        {/* Right: Day Detail Sidebar */}
        <aside className={`cal-sidebar ${selectedDay ? 'has-selection' : ''}`}>
          {selectedDay ? (
            <>
              {/* Sidebar Header */}
              <div className="cal-sidebar-header">
                <div className="cal-sidebar-date-group">
                  <span className="cal-sidebar-relative">{getRelativeLabel()}</span>
                  <h3 className="cal-sidebar-date">{selectedDayLabel}</h3>
                </div>
                <div className="cal-sidebar-day-badge">
                  <span className="cal-sidebar-day-num">{selectedDay.getDate()}</span>
                  <span className="cal-sidebar-day-month">{MONTHS_SHORT[selectedDay.getMonth()]}</span>
                </div>
              </div>

              {/* Task Summary */}
              {selectedDayTasks.length > 0 && (
                <div className="cal-sidebar-summary">
                  <span>{selectedActiveTasks.length} pending</span>
                  <span className="cal-sidebar-divider">•</span>
                  <span>{selectedCompletedTasks.length} done</span>
                </div>
              )}

              {/* Task List */}
              <div className="cal-sidebar-tasks">
                {selectedDayTasks.length === 0 ? (
                  <div className="cal-sidebar-empty">
                    <CalendarDays size={40} strokeWidth={1.2} />
                    <p>No tasks scheduled</p>
                    <span>Click below to add a task for this day.</span>
                  </div>
                ) : (
                  <>
                    {/* Active tasks */}
                    {selectedActiveTasks.length > 0 && (
                      <div className="cal-task-group">
                        {selectedActiveTasks.map(task => (
                          <div 
                            key={task.id} 
                            className={`cal-task-item priority-${task.priority}`}
                            draggable={true}
                            onDragStart={(e) => {
                              e.dataTransfer.setData('taskId', task.id);
                              e.dataTransfer.effectAllowed = 'move';
                              e.currentTarget.classList.add('dragging');
                            }}
                            onDragEnd={(e) => {
                              e.currentTarget.classList.remove('dragging');
                            }}
                          >
                            <button
                              className="cal-task-check"
                              onClick={() => handleToggle(task)}
                              aria-label="Mark complete"
                            >
                              <div className="cal-check-ring" />
                            </button>
                            <div className="cal-task-body">
                              {editingTaskId === task.id ? (
                                <form className="cal-edit-form" onSubmit={(e) => handleUpdateTask(e, task.id)}>
                                  <input 
                                    type="text" 
                                    value={editTaskText} 
                                    onChange={(e) => setEditTaskText(e.target.value)} 
                                    autoFocus
                                    onBlur={(e) => handleUpdateTask(e, task.id)}
                                  />
                                </form>
                              ) : (
                                <span className="cal-task-text">{task.text}</span>
                              )}
                              <div className="cal-task-meta">
                                <span className={`cal-priority-label ${task.priority}`}>
                                  {task.priority}
                                </span>
                                {task.startTime && (
                                  <span className="cal-time-label">
                                    <Clock size={11} style={{ marginRight: '3px' }} />
                                    {task.startTime}{task.endTime ? ` - ${task.endTime}` : ''}
                                  </span>
                                )}
                                {task.recurrence && task.recurrence !== 'none' && (
                                  <span className="cal-recurrence-label">
                                    ↻ {task.recurrence}
                                  </span>
                                )}
                                {task.todoTags?.length > 0 && task.todoTags.map((tag, ti) => (
                                  <span key={ti} className="cal-task-tag">{tag}</span>
                                ))}
                              </div>
                            </div>
                            <div className="cal-task-actions">
                              <button className="cal-icon-btn" onClick={() => { setEditingTaskId(task.id); setEditTaskText(task.text); }} title="Edit">
                                <Edit2 size={13} />
                              </button>
                              <button className="cal-icon-btn delete" onClick={() => handleDeleteTask(task.id)} title="Delete">
                                <Trash2 size={13} />
                              </button>
                              {task.note && (
                                <button className="cal-icon-btn" onClick={() => navigate(`/notes/${task.note.id}`)} title={`Open: ${task.note.title}`}>
                                  <FileText size={13} />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Completed tasks */}
                    {selectedCompletedTasks.length > 0 && (
                      <div className="cal-task-group completed-group">
                        <div className="cal-completed-divider">
                          <Check size={12} />
                          <span>Completed ({selectedCompletedTasks.length})</span>
                        </div>
                        {selectedCompletedTasks.map(task => (
                          <div 
                            key={task.id} 
                            className="cal-task-item completed"
                            draggable={true}
                            onDragStart={(e) => {
                              e.dataTransfer.setData('taskId', task.id);
                              e.dataTransfer.effectAllowed = 'move';
                              e.currentTarget.classList.add('dragging');
                            }}
                            onDragEnd={(e) => {
                              e.currentTarget.classList.remove('dragging');
                            }}
                          >
                            <button
                              className="cal-task-check checked"
                              onClick={() => handleToggle(task)}
                              aria-label="Mark incomplete"
                            >
                              <Check size={11} strokeWidth={3} />
                            </button>
                            <div className="cal-task-body">
                              <span className="cal-task-text">{task.text}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Add Task Area */}
              {isAddingTask ? (
                <form className="cal-inline-task-form" onSubmit={handleCreateTask}>
                  <input 
                    type="text" 
                    placeholder="What needs to be done?" 
                    value={newTaskText}
                    onChange={(e) => setNewTaskText(e.target.value)}
                    autoFocus
                  />
                  <div className="cal-time-recurrence-row">
                    <div className="cal-time-inputs">
                      <Clock size={13} style={{ color: 'var(--dash-text-muted)' }} />
                      <input type="time" value={newTaskStartTime} onChange={e => setNewTaskStartTime(e.target.value)} className="cal-time-input" aria-label="Start time" />
                      <span className="cal-time-separator">-</span>
                      <input type="time" value={newTaskEndTime} onChange={e => setNewTaskEndTime(e.target.value)} className="cal-time-input" aria-label="End time" />
                    </div>
                    <select value={newTaskRecurrence} onChange={e => setNewTaskRecurrence(e.target.value)} className="cal-recurrence-select">
                      <option value="none">Does not repeat</option>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                      <option value="yearly">Yearly</option>
                    </select>
                  </div>
                  <div className="cal-inline-task-form-bottom">
                    <div className="cal-priority-selector">
                      <button type="button" className={`cal-p-btn high ${newTaskPriority === 'high' ? 'active' : ''}`} onClick={() => setNewTaskPriority('high')}>High</button>
                      <button type="button" className={`cal-p-btn medium ${newTaskPriority === 'medium' ? 'active' : ''}`} onClick={() => setNewTaskPriority('medium')}>Med</button>
                      <button type="button" className={`cal-p-btn low ${newTaskPriority === 'low' ? 'active' : ''}`} onClick={() => setNewTaskPriority('low')}>Low</button>
                    </div>
                    <div className="cal-inline-actions">
                      <button type="button" className="cal-inline-cancel" onClick={() => { setIsAddingTask(false); setNewTaskText(''); }}>Cancel</button>
                      <button type="submit" className="cal-inline-submit" disabled={!newTaskText.trim()}>Save</button>
                    </div>
                  </div>
                </form>
              ) : (
                <button className="cal-add-task-btn" onClick={() => setIsAddingTask(true)}>
                  <Plus size={16} />
                  Add task
                </button>
              )}
            </>
          ) : (
            <div className="cal-sidebar-empty">
              <CalendarDays size={40} strokeWidth={1.2} />
              <p>Select a day</p>
              <span>Click on a date to see its tasks.</span>
            </div>
          )}
        </aside>

        {/* Mobile Detail Panel (overlay) */}
        {selectedDay && (
          <div className="cal-mobile-panel-wrap mobile-only" onClick={() => setSelectedDay(null)}>
            <div className="cal-mobile-panel" onClick={e => e.stopPropagation()}>
              <div className="cal-sidebar-header">
                <div className="cal-sidebar-date-group">
                  <span className="cal-sidebar-relative">{getRelativeLabel()}</span>
                  <h3 className="cal-sidebar-date">{selectedDayLabel}</h3>
                </div>
                <button className="cal-mobile-close" onClick={() => setSelectedDay(null)}>✕</button>
              </div>

              <div className="cal-sidebar-tasks" style={{ maxHeight: '50vh', overflowY: 'auto' }}>
                {selectedDayTasks.length === 0 ? (
                  <div className="cal-sidebar-empty compact">
                    <p>No tasks scheduled</p>
                  </div>
                ) : (
                  <>
                    {/* Active tasks */}
                    {selectedActiveTasks.length > 0 && (
                      <div className="cal-task-group">
                        {selectedActiveTasks.map(task => (
                          <div key={task.id} className={`cal-task-item priority-${task.priority}`}>
                            <button
                              className="cal-task-check"
                              onClick={() => handleToggle(task)}
                            >
                              <div className="cal-check-ring" />
                            </button>
                            <div className="cal-task-body">
                              <span className="cal-task-text">{task.text}</span>
                              <div className="cal-task-meta">
                                <span className={`cal-priority-label ${task.priority}`}>{task.priority}</span>
                                {task.startTime && (
                                  <span className="cal-time-label">
                                    <Clock size={11} style={{ marginRight: '3px' }} />
                                    {task.startTime}{task.endTime ? ` - ${task.endTime}` : ''}
                                  </span>
                                )}
                                {task.recurrence && task.recurrence !== 'none' && (
                                  <span className="cal-recurrence-label">
                                    ↻ {task.recurrence}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="cal-task-actions" style={{ opacity: 1 }}>
                              <button className="cal-icon-btn delete" onClick={() => handleDeleteTask(task.id)} title="Delete">
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Completed tasks */}
                    {selectedCompletedTasks.length > 0 && (
                      <div className="cal-task-group completed-group">
                        <div className="cal-completed-divider" style={{ marginTop: '0.5rem' }}>
                          <Check size={12} />
                          <span>Completed ({selectedCompletedTasks.length})</span>
                        </div>
                        {selectedCompletedTasks.map(task => (
                          <div key={task.id} className="cal-task-item completed">
                            <button
                              className="cal-task-check checked"
                              onClick={() => handleToggle(task)}
                            >
                              <Check size={11} strokeWidth={3} />
                            </button>
                            <div className="cal-task-body">
                              <span className="cal-task-text">{task.text}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Mobile Add Task Area */}
              {isAddingTask ? (
                <form className="cal-inline-task-form mobile-form" onSubmit={handleCreateTask}>
                  <input 
                    type="text" 
                    placeholder="What needs to be done?" 
                    value={newTaskText}
                    onChange={(e) => setNewTaskText(e.target.value)}
                    autoFocus
                  />
                  <div className="cal-time-recurrence-row">
                    <div className="cal-time-inputs">
                      <Clock size={13} style={{ color: 'var(--dash-text-muted)' }} />
                      <input type="time" value={newTaskStartTime} onChange={e => setNewTaskStartTime(e.target.value)} className="cal-time-input" aria-label="Start time" />
                      <span className="cal-time-separator">-</span>
                      <input type="time" value={newTaskEndTime} onChange={e => setNewTaskEndTime(e.target.value)} className="cal-time-input" aria-label="End time" />
                    </div>
                    <select value={newTaskRecurrence} onChange={e => setNewTaskRecurrence(e.target.value)} className="cal-recurrence-select">
                      <option value="none">Does not repeat</option>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                      <option value="yearly">Yearly</option>
                    </select>
                  </div>
                  <div className="cal-inline-task-form-bottom">
                    <div className="cal-priority-selector">
                      <button type="button" className={`cal-p-btn high ${newTaskPriority === 'high' ? 'active' : ''}`} onClick={() => setNewTaskPriority('high')}>High</button>
                      <button type="button" className={`cal-p-btn medium ${newTaskPriority === 'medium' ? 'active' : ''}`} onClick={() => setNewTaskPriority('medium')}>Med</button>
                      <button type="button" className={`cal-p-btn low ${newTaskPriority === 'low' ? 'active' : ''}`} onClick={() => setNewTaskPriority('low')}>Low</button>
                    </div>
                    <div className="cal-inline-actions">
                      <button type="button" className="cal-inline-cancel" onClick={() => { setIsAddingTask(false); setNewTaskText(''); }}>Cancel</button>
                      <button type="submit" className="cal-inline-submit" disabled={!newTaskText.trim()}>Save</button>
                    </div>
                  </div>
                </form>
              ) : (
                <button className="cal-add-task-btn" onClick={() => setIsAddingTask(true)}>
                  <Plus size={16} /> Add task
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
