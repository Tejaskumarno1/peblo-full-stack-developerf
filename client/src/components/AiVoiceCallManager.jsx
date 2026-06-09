import React, { useState, useEffect, useRef } from 'react';
import AiVoiceCallModal from './AiVoiceCallModal';
import { todosAPI } from '../api';

export default function AiVoiceCallManager() {
  const [showCall, setShowCall] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [callType, setCallType] = useState('morning_briefing');

  const checkIntervalRef = useRef(null);
  const customTimerRef = useRef(null);
  const isCallActiveRef = useRef(showCall);

  useEffect(() => {
    isCallActiveRef.current = showCall;
  }, [showCall]);

  useEffect(() => {
    const fetchTasks = async () => {
      try {
        const res = await todosAPI.getToday();
        return [
          ...(res.data.todayTasks || []),
          ...(res.data.overdueTasks || []),
          ...(res.data.upcomingTasks || [])
        ];
      } catch (err) {
        console.error("Failed to fetch tasks for call:", err);
        return [];
      }
    };

    const triggerCall = (tasksToDiscuss, type = 'morning_briefing') => {
      setTasks(tasksToDiscuss);
      setCallType(type);
      setShowCall(true);
    };

    const checkSchedules = async () => {
      if (isCallActiveRef.current) return;

      const now = new Date();
      const allTasks = await fetchTasks();
      
      // 1. Morning Briefing check (7:30 AM)
      const lastBriefingDate = localStorage.getItem('peblo_last_morning_briefing');
      const todayDateStr = now.toDateString();
      
      if (now.getHours() === 7 && now.getMinutes() >= 30 && lastBriefingDate !== todayDateStr) {
        localStorage.setItem('peblo_last_morning_briefing', todayDateStr);
        // Provide today's tasks and overdue tasks
        triggerCall(allTasks.filter(t => !t.deadline || new Date(t.deadline).toDateString() === todayDateStr || new Date(t.deadline) < now), 'morning_briefing');
        return;
      }

      // 2. Deadline approaching check (2 hours before)
      const calledTasksStr = localStorage.getItem('peblo_called_tasks') || '{}';
      const calledTasks = JSON.parse(calledTasksStr);
      let foundTaskToCall = null;

      for (const task of allTasks) {
        if (!task.deadline || task.completed) continue;
        const deadline = new Date(task.deadline);
        const timeDiff = deadline.getTime() - now.getTime();
        const hoursLeft = timeDiff / (1000 * 60 * 60);

        // If deadline is between 1.9 and 2.1 hours away and we haven't called yet
        if (hoursLeft > 0 && hoursLeft <= 2.1 && !calledTasks[task.id]) {
          foundTaskToCall = task;
          calledTasks[task.id] = true;
          break; // Trigger one at a time
        }
      }

      if (foundTaskToCall) {
        localStorage.setItem('peblo_called_tasks', JSON.stringify(calledTasks));
        triggerCall([foundTaskToCall], 'upcoming_task');
      }
    };

    // Run check every minute
    checkIntervalRef.current = setInterval(checkSchedules, 60000);
    // Run immediately on mount
    checkSchedules();
    
    const handleManualTrigger = async () => {
      const allTasks = await fetchTasks();
      triggerCall(allTasks, 'manual_trigger');
    };
    
    const handleSnooze = (e) => {
      const minutes = e.detail?.minutes || 10;
      console.log(`AI Voice Call snoozed for ${minutes} minutes.`);
      setShowCall(false);
      
      if (customTimerRef.current) clearTimeout(customTimerRef.current);
      customTimerRef.current = setTimeout(async () => {
        triggerCall(tasks, callType); // preserve tasks and type
      }, minutes * 60 * 1000);
    };

    const handleDecline = () => {
      console.log(`AI Voice Call declined. Will recall in 1 hour.`);
      setShowCall(false);
      
      if (customTimerRef.current) clearTimeout(customTimerRef.current);
      customTimerRef.current = setTimeout(async () => {
        triggerCall(tasks, callType); // preserve tasks and type
      }, 60 * 60 * 1000); // 1 hour
    };

    window.addEventListener('trigger_ai_call', handleManualTrigger);
    window.addEventListener('snooze_ai_call', handleSnooze);
    window.addEventListener('decline_ai_call', handleDecline);
    
    return () => {
      if (checkIntervalRef.current) clearInterval(checkIntervalRef.current);
      if (customTimerRef.current) clearTimeout(customTimerRef.current);
      window.removeEventListener('trigger_ai_call', handleManualTrigger);
      window.removeEventListener('snooze_ai_call', handleSnooze);
      window.removeEventListener('decline_ai_call', handleDecline);
    };
  }, []);

  if (!showCall) return null;

  return (
    <AiVoiceCallModal 
      tasks={tasks} 
      callType={callType}
      onClose={() => setShowCall(false)} 
    />
  );
}
