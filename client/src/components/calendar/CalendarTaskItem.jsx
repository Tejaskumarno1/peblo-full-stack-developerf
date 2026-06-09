import React, { useState, memo } from 'react';
import { Clock, Trash2, Check } from 'lucide-react';

function CalendarTaskItem({ 
  task, 
  handleToggle, 
  handleDeleteTask, 
  handleUpdateTask, 
  editingTaskId, 
  setEditingTaskId,
  editTaskText,
  setEditTaskText
}) {
  return (
    <div 
      className={`cal-task-item priority-${task.priority} ${task.completed ? 'completed' : ''}`}
      draggable={!task.completed}
      onDragStart={(e) => {
        if (task.completed) return;
        e.dataTransfer.setData('taskId', task.id);
        e.dataTransfer.effectAllowed = 'move';
        e.currentTarget.classList.add('dragging');
      }}
      onDragEnd={(e) => {
        if (task.completed) return;
        e.currentTarget.classList.remove('dragging');
      }}
    >
      <button
        className={`cal-task-check ${task.completed ? 'checked' : ''}`}
        onClick={() => handleToggle(task)}
        aria-label="Mark complete"
      >
        {task.completed ? <Check size={11} strokeWidth={3} /> : <div className="cal-check-ring" />}
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
          <span 
            className="cal-task-text"
            onDoubleClick={() => {
              if (task.completed) return;
              setEditingTaskId(task.id);
              setEditTaskText(task.text);
            }}
          >
            {task.text}
          </span>
        )}
        {!task.completed && (
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
        )}
      </div>
      
      <div className="cal-task-actions" style={{ opacity: 1 }}>
        <button className="cal-icon-btn delete" onClick={() => handleDeleteTask(task.id)} title="Delete">
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

export default memo(CalendarTaskItem);
