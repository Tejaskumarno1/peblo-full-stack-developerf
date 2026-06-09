import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { todosAPI, notesAPI } from '../api';
import { ChevronDown, ChevronRight, ListTodo, AlertTriangle, Flame, Briefcase, Home, Play, Pause, Square } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Navigation from '../components/Navigation';
import { useAuth } from '../context/AuthContext';
import TodoItem from '../components/todo/TodoItem';
import TodoCreateForm from '../components/todo/TodoCreateForm';
import TodoEditModal from '../components/todo/TodoEditModal';
import '../styles/dashboard.css';
import '../styles/todolist.css';

export default function TodoListPage() {
  const { user } = useAuth();
  const initial = user?.name ? user.name.charAt(0).toUpperCase() : 'U';

  const queryClient = useQueryClient();

  const { data: todos = [], isLoading: loadingTodos } = useQuery({
    queryKey: ['todos'],
    queryFn: () => todosAPI.getAll().then(res => res.data.todos)
  });

  const { data: notes = [], isLoading: loadingNotes } = useQuery({
    queryKey: ['notes'],
    queryFn: () => notesAPI.getAll({ archived: false }).then(res => res.data.notes || [])
  });

  const loading = loadingTodos || loadingNotes;

  const [showCompleted, setShowCompleted] = useState(false);
  const [filterMode, setFilterMode] = useState('all'); // all, high, work, personal
  const [editingTask, setEditingTask] = useState(null);

  // Pomodoro Timer State
  const [timer, setTimer] = useState({ taskId: null, timeLeft: 25 * 60, isRunning: false });

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

  const createTodo = useMutation({
    mutationFn: (payload) => todosAPI.create(payload),
    onSuccess: (res) => {
      queryClient.setQueryData(['todos'], old => [res.data.todo, ...(old || [])]);
    }
  });

  const handleCreate = (payload) => {
    createTodo.mutate(payload);
  };

  const toggleTodo = useMutation({
    mutationFn: (todo) => todosAPI.update(todo.id, { completed: !todo.completed }),
    onMutate: async (todo) => {
      await queryClient.cancelQueries({ queryKey: ['todos'] });
      const prevTodos = queryClient.getQueryData(['todos']);
      queryClient.setQueryData(['todos'], old =>
        old.map(t => t.id === todo.id ? { ...t, completed: !t.completed } : t)
      );
      return { prevTodos };
    },
    onError: (err, todo, context) => queryClient.setQueryData(['todos'], context.prevTodos),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['todos'] })
  });

  const handleToggle = (todo) => toggleTodo.mutate(todo);

  const deleteTodo = useMutation({
    mutationFn: (id) => todosAPI.delete(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['todos'] });
      const prevTodos = queryClient.getQueryData(['todos']);
      queryClient.setQueryData(['todos'], old => old.filter(t => t.id !== id));
      return { prevTodos };
    },
    onError: (err, id, context) => queryClient.setQueryData(['todos'], context.prevTodos),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['todos'] })
  });

  const handleDelete = (id) => deleteTodo.mutate(id);

  const updateTask = useMutation({
    mutationFn: (payload) => {
      const { id, ...data } = payload;
      return todosAPI.update(id, data);
    },
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: ['todos'] });
      const prevTodos = queryClient.getQueryData(['todos']);
      queryClient.setQueryData(['todos'], old => old.map(t => t.id === payload.id ? { ...t, ...payload } : t));
      return { prevTodos };
    },
    onError: (err, variables, context) => queryClient.setQueryData(['todos'], context.prevTodos),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['todos'] })
  });

  const handleUpdateText = (id, newText) => {
    updateTask.mutate({ id, text: newText });
  };

  const handleSaveTask = (taskData) => {
    updateTask.mutate(taskData);
    setEditingTask(null);
  };

  const snoozeTodo = useMutation({
    mutationFn: ({ id, deadline }) => todosAPI.update(id, { deadline }),
    onMutate: async ({ id, deadline }) => {
      await queryClient.cancelQueries({ queryKey: ['todos'] });
      const prevTodos = queryClient.getQueryData(['todos']);
      queryClient.setQueryData(['todos'], old => old.map(t => t.id === id ? { ...t, deadline } : t));
      return { prevTodos };
    },
    onError: (err, variables, context) => queryClient.setQueryData(['todos'], context.prevTodos),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['todos'] })
  });

  const handleSnooze = (task) => {
    const tmrw = new Date();
    tmrw.setDate(tmrw.getDate() + 1);
    tmrw.setHours(23, 59, 59, 999);
    snoozeTodo.mutate({ id: task.id, deadline: tmrw.toISOString() });
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

  const getDateKey = (dateStr) => {
    if (!dateStr) return 'no-deadline';
    const d = new Date(dateStr);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const formatDateSectionTitle = (dateStr) => {
    if (!dateStr) return 'No Deadline';
    if (isToday(dateStr)) return 'Today';

    const d = new Date(dateStr);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const normalized = new Date(d);
    normalized.setHours(0, 0, 0, 0);

    if (normalized.getTime() === tomorrow.getTime()) return 'Tomorrow';
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  // Group tasks by actual due date.
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

    const priorityOrder = { high: 0, medium: 1, low: 2 };
    const sortByPriority = (a, b) => (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1);

    const sortByTime = (a, b) => {
      if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime);
      if (a.startTime) return -1;
      if (b.startTime) return 1;
      return sortByPriority(a, b);
    };

    const buildDateGroups = (items, newestFirst = false) => Object.entries(
      items.reduce((acc, task) => {
        const key = getDateKey(task.deadline);
        if (!acc[key]) acc[key] = [];
        acc[key].push(task);
        return acc;
      }, {})
    )
      .map(([key, tasks]) => ({
        key,
        date: key === 'no-deadline' ? null : tasks[0].deadline,
        title: key === 'no-deadline' ? 'No Deadline' : formatDateSectionTitle(tasks[0].deadline),
        tasks: tasks.sort(sortByTime),
        isOverdue: key !== 'no-deadline' && isOverdue(tasks[0].deadline),
        isToday: key !== 'no-deadline' && isToday(tasks[0].deadline),
      }))
      .sort((a, b) => {
        if (a.key === 'no-deadline') return 1;
        if (b.key === 'no-deadline') return -1;
        const direction = newestFirst ? -1 : 1;
        return (new Date(a.date) - new Date(b.date)) * direction;
      });

    const dateGroups = buildDateGroups(active);
    const completedDateGroups = buildDateGroups(completed, true);

    return {
      dateGroups,
      completed,
      completedDateGroups
    };
  }, [todos, filterMode]);

  // Daily Progress calculation
  const todayGroup = grouped.dateGroups.find(group => group.isToday);
  const todayTotal = (todayGroup?.tasks.length || 0) + grouped.completed.filter(t => isToday(t.deadline)).length;
  const todayCompleted = grouped.completed.filter(t => isToday(t.deadline)).length;
  const progressPercent = todayTotal === 0 ? 0 : Math.round((todayCompleted / todayTotal) * 100);

  const renderTask = (task) => (
    <TodoItem
      key={task.id}
      task={task}
      handleToggle={handleToggle}
      handleUpdateText={handleUpdateText}
      setTimer={setTimer}
      handleSnooze={handleSnooze}
      handleDelete={handleDelete}
      getDeadlineClass={getDeadlineClass}
      formatDeadline={formatDeadline}
      onEditTask={setEditingTask}
    />
  );

  const renderSection = (title, tasks, extra) => {
    if (tasks.length === 0) return null;
    return (
      <div className="todo-section">
        <div className={`todo-section-header ${extra || ''}`}>
          {extra === 'overdue' && <AlertTriangle size={14} />}
          {title}
          <span className="todo-section-count">{tasks.length}</span>
          {extra === 'today' && todayTotal > 0 && (
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
        <TodoCreateForm handleCreate={handleCreate} notes={notes} />

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
            {grouped.dateGroups.map(group => (
              <React.Fragment key={group.key}>
                {renderSection(group.title, group.tasks, group.isOverdue ? 'overdue' : group.isToday ? 'today' : '')}
              </React.Fragment>
            ))}

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
                  {showCompleted && grouped.completedDateGroups.map(group => (
                    <div key={`completed-${group.key}`} className="todo-completed-date-group">
                      <div className="todo-completed-date-label">
                        {group.title}
                        <span className="todo-section-count">{group.tasks.length}</span>
                      </div>
                      {group.tasks.map(renderTask)}
                    </div>
                  ))}
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

      {/* Edit Task Modal */}
      <TodoEditModal
        task={editingTask}
        onClose={() => setEditingTask(null)}
        onSave={handleSaveTask}
        notes={notes}
      />
    </div>
  );
}
