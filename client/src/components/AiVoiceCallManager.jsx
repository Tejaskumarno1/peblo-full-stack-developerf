import React, { useState, useEffect, useRef } from 'react';
import AiVoiceCallModal from './AiVoiceCallModal';
import { todosAPI } from '../api';
import { useAuth } from '../context/AuthContext';
import { callsEnabled, shouldRing, briefingDue, briefingTasks } from '../utils/callRules';

export default function AiVoiceCallManager() {
  const { settings } = useAuth();
  const [showCall, setShowCall] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [callType, setCallType] = useState('morning_briefing');

  const customTimerRef = useRef(null);
  // The timers and listeners below live as long as the app, so they read the latest values from refs.
  const isCallActiveRef = useRef(false);
  const tasksRef = useRef([]);
  const callTypeRef = useRef('morning_briefing');
  const enabledRef = useRef(true);

  isCallActiveRef.current = showCall;
  tasksRef.current = tasks;
  callTypeRef.current = callType;
  enabledRef.current = callsEnabled(settings);

  // Turning calls off cancels a call that is waiting to come back.
  useEffect(() => {
    if (!callsEnabled(settings) && customTimerRef.current) {
      clearTimeout(customTimerRef.current);
      customTimerRef.current = null;
    }
  }, [settings]);

  useEffect(() => {
    const fetchTasks = async () => {
      try {
        const res = await todosAPI.getToday();
        return [
          ...(res.data.todayTasks || []),
          ...(res.data.overdueTasks || []),
          ...(res.data.upcomingTasks || []),
        ];
      } catch (err) {
        console.error('Failed to fetch tasks for call:', err);
        return null;
      }
    };

    const triggerCall = (tasksToDiscuss, type) => {
      tasksRef.current = tasksToDiscuss;
      callTypeRef.current = type;
      setTasks(tasksToDiscuss);
      setCallType(type);
      setShowCall(true);
    };

    const checkSchedules = async () => {
      if (isCallActiveRef.current || !enabledRef.current) return;
      const now = new Date();
      const lastBriefing = localStorage.getItem('peblo_last_morning_briefing') || '';
      const briefing = briefingDue(now, lastBriefing);
      const allTasks = await fetchTasks();
      if (!allTasks || isCallActiveRef.current || !enabledRef.current) return;

      if (briefing) {
        localStorage.setItem('peblo_last_morning_briefing', now.toDateString());
        triggerCall(briefingTasks(allTasks, now), 'morning_briefing');
        return;
      }

      let called = {};
      try { called = JSON.parse(localStorage.getItem('peblo_called_tasks') || '{}'); } catch { called = {}; }
      const due = allTasks.find((t) => shouldRing(t, now, called));
      if (due) {
        called[due.id] = true;
        localStorage.setItem('peblo_called_tasks', JSON.stringify(called));
        triggerCall([due], 'upcoming_task');
      }
    };

    const interval = setInterval(checkSchedules, 60000);
    checkSchedules();

    // "Call me now" (Settings)
    const handleManualTrigger = async () => {
      if (isCallActiveRef.current) return;
      const allTasks = await fetchTasks();
      if (!allTasks) return;
      triggerCall(allTasks.filter((t) => !t.completed), 'manual_trigger');
    };

    const comeBack = (minutes) => {
      if (customTimerRef.current) clearTimeout(customTimerRef.current);
      customTimerRef.current = setTimeout(() => {
        customTimerRef.current = null;
        if (!enabledRef.current || isCallActiveRef.current) return;
        // Same agenda and same kind of call as before it was snoozed
        triggerCall(tasksRef.current, callTypeRef.current);
      }, minutes * 60 * 1000);
    };

    const handleSnooze = (e) => {
      // The call may have changed the list (done, moved, added); bring it back as it stands
      if (Array.isArray(e.detail?.tasks)) {
        tasksRef.current = e.detail.tasks.filter((t) => !t.completed);
      }
      setShowCall(false);
      comeBack(e.detail?.minutes || 10);
    };

    const handleDecline = () => {
      setShowCall(false);
      comeBack(60);
    };

    window.addEventListener('trigger_ai_call', handleManualTrigger);
    window.addEventListener('snooze_ai_call', handleSnooze);
    window.addEventListener('decline_ai_call', handleDecline);

    return () => {
      clearInterval(interval);
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
