import React, { memo } from 'react';
import { FileText } from 'lucide-react';

function DashboardTodoItem({ task, handleToggleTask }) {
  return (
    <label 
      className={`dash-todo-item premium-todo-item ${task.completed ? 'completed' : ''}`} 
      style={{ 
        borderLeft: `4px solid ${task.priority === 'high' ? '#ef4444' : task.priority === 'low' ? '#22c55e' : '#f59e0b'}` 
      }}
    >
      <input
        type="checkbox"
        checked={task.completed}
        onChange={() => handleToggleTask(task)}
        className="dash-todo-checkbox mobile-large-checkbox"
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px', overflow: 'hidden' }}>
        <span className="dash-todo-text">{task.text}</span>
        {task.priority === 'high' && <span className="premium-todo-urgent-badge">Urgent</span>}
      </div>
      {task.note && <div className="premium-todo-note-icon"><FileText size={14} /></div>}
    </label>
  );
}

export default memo(DashboardTodoItem);
