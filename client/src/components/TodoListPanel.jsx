import React, { useState } from 'react';
import { todosAPI } from '../api';
import { CheckCircle2, Circle, Plus, Trash2, X, FileText } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import '../styles/dashboard.css'; 

export default function TodoListPanel({ onClose }) {
  const queryClient = useQueryClient();
  const [newTaskText, setNewTaskText] = useState('');

  const { data: tasks = [], isLoading: loading } = useQuery({
    queryKey: ['todos'],
    queryFn: () => todosAPI.getAll().then(res => res.data.todos)
  });

  const createMutation = useMutation({
    mutationFn: (text) => todosAPI.create({ text }),
    onSuccess: () => {
      queryClient.invalidateQueries(['todos']);
      setNewTaskText('');
    }
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, completed }) => todosAPI.update(id, { completed }),
    onMutate: async ({ id, completed }) => {
      await queryClient.cancelQueries(['todos']);
      const previousTodos = queryClient.getQueryData(['todos']);
      queryClient.setQueryData(['todos'], old => 
        old.map(t => t.id === id ? { ...t, completed } : t)
      );
      return { previousTodos };
    },
    onError: (err, variables, context) => {
      queryClient.setQueryData(['todos'], context.previousTodos);
    },
    onSettled: () => {
      queryClient.invalidateQueries(['todos']);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => todosAPI.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['todos']);
    }
  });

  const handleAddTask = (e) => {
    e.preventDefault();
    if (!newTaskText.trim()) return;
    createMutation.mutate(newTaskText);
  };

  const handleToggleTask = (task) => {
    toggleMutation.mutate({ id: task.id, completed: !task.completed });
  };

  const handleDeleteTask = (id) => {
    deleteMutation.mutate(id);
  };

  return (
    <div className="ai-panel" style={{ display: 'flex', flexDirection: 'column', width: '350px', borderLeft: '1px solid var(--border-subtle)', background: 'var(--bg-panel)' }}>
      <div className="ai-panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', borderBottom: '1px solid var(--border-subtle)' }}>
        <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Tasks</h3>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
          <X size={18} />
        </button>
      </div>

      <div className="ai-panel-content" style={{ padding: '1rem', flex: 1, overflowY: 'auto' }}>
        <form onSubmit={handleAddTask} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
          <input 
            type="text" 
            placeholder="Add a task..." 
            value={newTaskText}
            onChange={(e) => setNewTaskText(e.target.value)}
            style={{ 
              flex: 1, 
              padding: '0.5rem', 
              borderRadius: '6px',
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-surface)',
              color: 'var(--text-primary)',
              fontSize: '0.875rem'
            }}
          />
          <button 
            type="submit"
            disabled={!newTaskText.trim()}
            style={{ 
              background: 'var(--accent)', 
              color: '#fff', 
              border: 'none', 
              padding: '0 0.75rem', 
              borderRadius: '6px',
              cursor: newTaskText.trim() ? 'pointer' : 'not-allowed',
              opacity: newTaskText.trim() ? 1 : 0.6
            }}
          >
            <Plus size={16} />
          </button>
        </form>

        {loading ? (
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>Loading tasks...</p>
        ) : tasks.length === 0 ? (
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>No tasks here yet.</p>
        ) : (
          <div className="dash-todo-list" style={{ gap: '0.5rem' }}>
            {tasks.filter(t => !t.completed).map(task => (
              <div key={task.id} className="dash-todo-item" style={{ alignItems: 'flex-start', padding: '0.5rem' }}>
                <button 
                  onClick={() => handleToggleTask(task)} 
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', marginTop: '2px', padding: 0 }}
                >
                  <Circle size={16} />
                </button>
                <div style={{ width: '6px', height: '6px', borderRadius: '50%', flexShrink: 0, marginTop: '7px', marginLeft: '2px', marginRight: '4px', background: task.priority === 'high' ? '#ef4444' : task.priority === 'low' ? '#22c55e' : '#f59e0b' }}></div>
                <span className="dash-todo-text" style={{ fontSize: '0.875rem', flex: 1 }}>{task.text}</span>
                {task.note && <FileText size={12} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: '3px', opacity: 0.7 }} />}
                <button 
                  onClick={() => handleDeleteTask(task.id)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0, marginLeft: '4px' }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            
            {tasks.filter(t => t.completed).length > 0 && (
              <>
                <div style={{ margin: '1rem 0 0.5rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                  Completed
                </div>
                {tasks.filter(t => t.completed).map(task => (
                  <div key={task.id} className="dash-todo-item completed" style={{ alignItems: 'flex-start', padding: '0.5rem' }}>
                    <button 
                      onClick={() => handleToggleTask(task)} 
                      style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', display: 'flex', marginTop: '2px', padding: 0 }}
                    >
                      <CheckCircle2 size={16} />
                    </button>
                    <span className="dash-todo-text" style={{ fontSize: '0.875rem', flex: 1, textDecoration: 'line-through', opacity: 0.5 }}>{task.text}</span>
                    <button 
                      onClick={() => handleDeleteTask(task.id)}
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
