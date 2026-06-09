import React, { useState, useEffect, useRef } from 'react';
import { Phone, PhoneOff, Mic, Loader2, Check, Settings, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { aiAPI } from '../api';
import { useAuth } from '../context/AuthContext';
import '../styles/ai-call.css';

export default function AiVoiceCallModal({ onClose, tasks, callType = 'morning_briefing' }) {
  const queryClient = useQueryClient();
  const { notifications } = useAuth();
  const [callState, setCallState] = useState('RINGING'); // RINGING, SPEAKING, LISTENING, PROCESSING
  const [transcript, setTranscript] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [currentTasks, setCurrentTasks] = useState(tasks || []);
  
  // Custom User Preferences (Persisted in LocalStorage)
  const [voiceGender, setVoiceGender] = useState(() => localStorage.getItem('peblo_call_gender') || 'female');
  const [voiceRate, setVoiceRate] = useState(() => parseFloat(localStorage.getItem('peblo_call_rate') || '1.05'));
  const [ringtoneSound, setRingtoneSound] = useState(() => localStorage.getItem('peblo_call_ringtone') || 'chime');

  const transcriptRef = useRef('');
  const conversationHistoryRef = useRef(''); // Accumulates dialog context during clarification loops
  const recognitionRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const ringtoneInstanceRef = useRef(null);

  const canvasRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const animationFrameRef = useRef(null);
  const audioStreamRef = useRef(null);

  const startVisualizer = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64; // small size for smooth waves
      analyserRef.current = analyser;
      
      source.connect(analyser);
      
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      
      const draw = () => {
        if (callStateRef.current !== 'LISTENING') return;
        animationFrameRef.current = requestAnimationFrame(draw);
        
        const canvas = canvasRef.current;
        if (!canvas) return;
        const canvasCtx = canvas.getContext('2d');
        
        analyser.getByteFrequencyData(dataArray);
        
        canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
        
        const barWidth = (canvas.width / bufferLength) * 1.5;
        let barHeight;
        let x = 0;
        
        for (let i = 0; i < bufferLength; i++) {
          // Normalize height to look neat in the canvas bounds
          barHeight = (dataArray[i] / 255) * canvas.height * 0.8;
          // Apply minimal height to make the idle state look alive
          if (barHeight < 6) barHeight = 6 + Math.sin(Date.now() * 0.005 + i) * 3;
          
          const centerY = canvas.height / 2;
          
          const gradient = canvasCtx.createLinearGradient(0, centerY - barHeight/2, 0, centerY + barHeight/2);
          gradient.addColorStop(0, '#a78bfa'); // Light purple
          gradient.addColorStop(0.5, '#8b5cf6'); // Purple
          gradient.addColorStop(1, '#a78bfa');
          
          canvasCtx.fillStyle = gradient;
          
          const barX = x;
          const barY = centerY - barHeight / 2;
          const radius = (barWidth - 2) / 2;
          
          canvasCtx.beginPath();
          if (canvasCtx.roundRect) {
            canvasCtx.roundRect(barX, barY, barWidth - 2, barHeight, Math.max(0, radius));
          } else {
            canvasCtx.rect(barX, barY, barWidth - 2, barHeight);
          }
          canvasCtx.fill();
          
          x += barWidth;
        }
      };
      
      draw();
    } catch (err) {
      console.warn("Visualizer audio context start blocked or denied:", err);
    }
  };

  const stopVisualizer = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(track => track.stop());
      audioStreamRef.current = null;
    }
    if (audioCtxRef.current) {
      try { audioCtxRef.current.close(); } catch {}
      audioCtxRef.current = null;
    }
  };

  useEffect(() => {
    if (callState === 'LISTENING') {
      const t = setTimeout(() => startVisualizer(), 100);
      return () => {
        clearTimeout(t);
        stopVisualizer();
      };
    } else {
      stopVisualizer();
    }
  }, [callState]);

  const callStateRef = useRef(callState);

  // Sync state to ref
  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

  // Handle Ringtone Audio Synthesis (Web Audio API)
  useEffect(() => {
    if (callState === 'RINGING' && ringtoneSound !== 'none') {
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
          const ctx = new AudioContext();
          const osc1 = ctx.createOscillator();
          const osc2 = ctx.createOscillator();
          const gain = ctx.createGain();

          osc1.type = 'sine';
          osc1.frequency.setValueAtTime(440, ctx.currentTime); // A4
          osc2.type = 'sine';
          osc2.frequency.setValueAtTime(480, ctx.currentTime); // Retro detuning

          gain.gain.setValueAtTime(0, ctx.currentTime);

          const ringPattern = (time) => {
            if (ctx.state === 'closed') return;
            gain.gain.setValueAtTime(0.12, time);
            gain.gain.setValueAtTime(0, time + 0.4);
            gain.gain.setValueAtTime(0.12, time + 0.6);
            gain.gain.setValueAtTime(0, time + 1.0);
          };

          let now = ctx.currentTime;
          ringPattern(now);
          const interval = setInterval(() => {
            if (ctx.state === 'closed') return;
            ringPattern(ctx.currentTime);
          }, 3000);

          osc1.connect(gain);
          osc2.connect(gain);
          gain.connect(ctx.destination);

          osc1.start();
          osc2.start();

          ringtoneInstanceRef.current = {
            stop: () => {
              clearInterval(interval);
              try {
                osc1.stop();
                osc2.stop();
                ctx.close();
              } catch {}
            }
          };
        }
      } catch (e) {
        console.error("Web Audio ringtone failed to start:", e);
      }
    } else {
      stopRingtone();
    }

    return () => {
      stopRingtone();
    };
  }, [callState, ringtoneSound]);

  const stopRingtone = () => {
    if (ringtoneInstanceRef.current) {
      ringtoneInstanceRef.current.stop();
      ringtoneInstanceRef.current = null;
    }
  };

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const rec = new SpeechRecognition();
      rec.continuous = true;
      rec.interimResults = true;
      
      rec.onresult = (event) => {
        if (callStateRef.current !== 'LISTENING') return;
        let currentTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          currentTranscript += event.results[i][0].transcript;
        }
        setTranscript(currentTranscript);
        transcriptRef.current = currentTranscript;

        // Reset silence timer
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = setTimeout(() => {
          if (transcriptRef.current.trim() && callStateRef.current === 'LISTENING') {
            rec.stop();
          }
        }, 3000); // Wait 3 seconds of silence before assuming they are done
      };

      rec.onerror = (event) => {
        if (event.error === 'aborted') return; // Ignore normal mic resets
        console.error("Speech Recognition Error:", event.error);
        if (event.error === 'not-allowed') {
          alert("Microphone permission was denied. Please allow microphone access to use the voice feature.");
          endCall();
        }
      };

      rec.onend = () => {
        if (callStateRef.current === 'LISTENING') {
          if (transcriptRef.current.trim()) {
            processVoiceCommand(transcriptRef.current);
          } else {
            try { rec.start(); } catch {}
          }
        }
      };
      
      recognitionRef.current = rec;
    }

    return () => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      if (recognitionRef.current) recognitionRef.current.abort();
    };
  }, []);

  useEffect(() => {
    window.__simulateVoiceCommand = (text) => {
      setTranscript(text);
      transcriptRef.current = text;
      setCallState('PROCESSING');
      processVoiceCommand(text);
    };
    return () => {
      delete window.__simulateVoiceCommand;
    };
  }, []);

  const speak = (text, onEndCallback) => {
    // Abort microphone capture to prevent listening to speaker feedback
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch (e) {}
    }

    if (!window.speechSynthesis) {
      console.warn("SpeechSynthesis is not supported in this browser.");
      if (onEndCallback) onEndCallback();
      return;
    }

    window.speechSynthesis.cancel();
    
    setTimeout(() => {
      const utterance = new SpeechSynthesisUtterance(text);
      
      const voices = window.speechSynthesis.getVoices();
      if (voices && voices.length > 0) {
        // Find voice matching selected preference (male/female)
        const preferredVoice = voices.find(v => {
          const name = v.name.toLowerCase();
          if (voiceGender === 'male') {
            return name.includes('google uk english male') || name.includes('david') || name.includes('male');
          } else {
            return name.includes('google us english') || name.includes('samantha') || name.includes('zira') || name.includes('female');
          }
        }) || voices[0];
        
        if (preferredVoice) utterance.voice = preferredVoice;
      }

      utterance.pitch = voiceGender === 'male' ? 0.85 : 1.05;
      utterance.rate = voiceRate; 

      utterance.onend = () => {
        if (onEndCallback) onEndCallback();
      };

      utterance.onerror = (e) => {
        console.error("SpeechSynthesis Error:", e);
        if (onEndCallback) onEndCallback();
      };
      
      setCallState('SPEAKING');
      window.speechSynthesis.speak(utterance);
    }, 50);
  };

  const answerCall = async () => {
    stopRingtone();
    const isAutomated = navigator.webdriver;
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia && !isAutomated) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
      } catch (err) {
        console.error("Mic permission denied:", err);
        alert("Microphone access is required for the AI Assistant. Please allow it in your browser settings.");
        endCall();
        return;
      }
    } else {
      console.warn("navigator.mediaDevices is not available or automated context. Proceeding directly.");
    }

    // 1. Task Agenda
    const incompleteTasks = currentTasks?.filter(t => !t.completed) || [];
    let introText = "";

    if (callType === 'upcoming_task' && incompleteTasks.length > 0) {
      const task = incompleteTasks[0];
      let timeStr = "shortly";
      if (task.deadline) {
        const d = new Date(task.deadline);
        timeStr = d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
      }
      introText = `Hello! This is a reminder for your upcoming task: ${task.text}. The deadline is at ${timeStr}. `;
    } else {
      introText = `Good morning! You have ${incompleteTasks.length} tasks scheduled for today. `;
      if (incompleteTasks.length > 0) {
        introText += "Here is your agenda. ";
        incompleteTasks.forEach((task, index) => {
          let timeStr = "No specific time";
          if (task.deadline) {
            const d = new Date(task.deadline);
            if (d.getHours() !== 0 || d.getMinutes() !== 0) {
               timeStr = d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            }
          }
          introText += `Task ${index + 1}: ${task.text}, scheduled for ${timeStr}. `;
        });
      } else {
        introText += "You have a free schedule! ";
      }

      // 2. Smart Notifications Briefing
      const unreadNotifications = notifications?.filter(n => !n.read) || [];
      if (unreadNotifications.length > 0) {
        introText += `You also have ${unreadNotifications.length} unread updates. `;
        unreadNotifications.slice(0, 2).forEach((n, idx) => {
          introText += `Update ${idx + 1}: ${n.text}. `;
        });
      }
    }

    introText += "Would you like to reschedule, complete, or add any tasks?";

    speak(introText, () => {
      setCallState('LISTENING');
      setTranscript('');
      transcriptRef.current = '';
      conversationHistoryRef.current = '';
      try { recognitionRef.current?.start(); } catch {}
    });
  };

  const processVoiceCommand = async (text) => {
    setCallState('PROCESSING');
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);

    // Build the query containing dialog context if this is a clarification response
    const combinedTranscript = conversationHistoryRef.current 
      ? `${conversationHistoryRef.current} | User reply: "${text}"`
      : text;

    try {
      const res = await aiAPI.processVoiceCommand({ 
        transcript: combinedTranscript,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        localTime: new Date().toString()
      });

      if (res.data.needClarification) {
        // Clarify: Accumulate history and ask again
        conversationHistoryRef.current = `${combinedTranscript} | Assistant asked: "${res.data.responseSpeech}"`;
        speak(res.data.responseSpeech, () => {
          setCallState('LISTENING');
          setTranscript('');
          transcriptRef.current = '';
          try { recognitionRef.current?.start(); } catch {}
        });
      } else if (res.data.snooze) {
        // Snooze call
        speak(res.data.responseSpeech, () => {
          snoozeCall(res.data.snoozeMinutes || 10);
        });
      } else {
        // Apply actions to visual state
        if (res.data.actions && Array.isArray(res.data.actions)) {
          setCurrentTasks(prev => {
            let updated = [...prev];
            res.data.actions.forEach(action => {
              if (action.type === 'COMPLETE' && action.taskId) {
                updated = updated.map(t => t.id === action.taskId ? { ...t, completed: true } : t);
              } else if (action.type === 'RESCHEDULE' && action.taskId) {
                updated = updated.map(t => t.id === action.taskId ? { ...t, deadline: action.newDate } : t);
              } else if (action.type === 'CREATE' && action.text) {
                updated.push({
                  id: Math.random().toString(),
                  text: action.text,
                  deadline: action.newDate || null,
                  completed: false
                });
              }
            });
            return updated;
          });

          // Invalidate React Query cache for instant dashboard sync
          try {
            queryClient.invalidateQueries({ queryKey: ['todayTasks'] });
            queryClient.invalidateQueries({ queryKey: ['notes'] });
            queryClient.invalidateQueries({ queryKey: ['insights'] });
            queryClient.invalidateQueries({ queryKey: ['weeklyReport'] });
          } catch (e) {
            console.error("React Query invalidation failed:", e);
          }
        }

        // Success: Read response and end
        speak(res.data.responseSpeech || "Okay, changes saved. Have a great day!", () => {
          endCall();
        });
      }
    } catch (err) {
      console.error(err);
      speak("Sorry, I had trouble connecting to the server. Please try again.", () => {
        setCallState('LISTENING');
        setTranscript('');
        transcriptRef.current = '';
        try { recognitionRef.current?.start(); } catch {}
      });
    }
  };

  const snoozeCall = (minutes = 10) => {
    stopRingtone();
    window.dispatchEvent(new CustomEvent('snooze_ai_call', { detail: { minutes } }));
    endCall();
  };

  const endCall = () => {
    stopRingtone();
    window.speechSynthesis.cancel();
    if (recognitionRef.current) recognitionRef.current.abort();
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    onClose();
  };

  const handleDeclineClick = () => {
    if (callState === 'RINGING') {
      window.dispatchEvent(new CustomEvent('decline_ai_call'));
    }
    endCall();
  };

  const forceProcess = () => {
    if (recognitionRef.current) recognitionRef.current.stop();
  };

  const saveSetting = (key, val, setter) => {
    setter(val);
    localStorage.setItem(key, val);
  };

  return (
    <div className="ai-call-overlay">
      <div className={`ai-call-container ${callState === 'RINGING' ? 'ringing-anim' : ''}`}>
        
        {/* Settings Trigger Icon */}
        <button 
          className="ai-call-settings-btn"
          onClick={() => setShowSettings(!showSettings)}
          title="Voice Settings"
        >
          <Settings size={20} />
        </button>

        {showSettings ? (
          <div className="ai-call-settings-panel">
            <div className="settings-header">
              <h3>Voice Preferences</h3>
              <button className="settings-close" onClick={() => setShowSettings(false)}>
                <X size={16} />
              </button>
            </div>
            
            <div className="setting-row">
              <label>Voice Gender</label>
              <div className="setting-options">
                <button 
                  className={voiceGender === 'female' ? 'active' : ''} 
                  onClick={() => saveSetting('peblo_call_gender', 'female', setVoiceGender)}
                >
                  Female
                </button>
                <button 
                  className={voiceGender === 'male' ? 'active' : ''} 
                  onClick={() => saveSetting('peblo_call_gender', 'male', setVoiceGender)}
                >
                  Male
                </button>
              </div>
            </div>

            <div className="setting-row">
              <label>Speaking Rate</label>
              <div className="setting-options">
                <button 
                  className={voiceRate === 0.85 ? 'active' : ''} 
                  onClick={() => saveSetting('peblo_call_rate', '0.85', (v) => setVoiceRate(parseFloat(v)))}
                >
                  Slow
                </button>
                <button 
                  className={voiceRate === 1.05 ? 'active' : ''} 
                  onClick={() => saveSetting('peblo_call_rate', '1.05', (v) => setVoiceRate(parseFloat(v)))}
                >
                  Normal
                </button>
                <button 
                  className={voiceRate === 1.25 ? 'active' : ''} 
                  onClick={() => saveSetting('peblo_call_rate', '1.25', (v) => setVoiceRate(parseFloat(v)))}
                >
                  Fast
                </button>
              </div>
            </div>

            <div className="setting-row">
              <label>Ringtone</label>
              <div className="setting-options">
                <button 
                  className={ringtoneSound === 'chime' ? 'active' : ''} 
                  onClick={() => saveSetting('peblo_call_ringtone', 'chime', setRingtoneSound)}
                >
                  Synth Chime
                </button>
                <button 
                  className={ringtoneSound === 'none' ? 'active' : ''} 
                  onClick={() => saveSetting('peblo_call_ringtone', 'none', setRingtoneSound)}
                >
                  Muted
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="ai-call-avatar">
              <div className="avatar-circles">
                {callState === 'LISTENING' || callState === 'SPEAKING' ? (
                  <canvas 
                    ref={canvasRef} 
                    width={100} 
                    height={100} 
                    className="visualizer-canvas"
                  />
                ) : (
                  <>
                    <div className={`circle circle-1 ${callState === 'RINGING' ? 'pulse-fast' : ''}`}></div>
                    <div className={`circle circle-2 ${callState === 'RINGING' ? 'pulse-medium' : ''}`}></div>
                    <div className={`circle circle-3 ${callState === 'RINGING' ? 'pulse-slow' : ''}`}></div>
                    <div className="avatar-img">AI</div>
                  </>
                )}
              </div>
            </div>
            
            <h2 className="ai-call-name">Peblo Assistant</h2>
            <p className="ai-call-status">
              {callState === 'RINGING' && 'Incoming Call...'}
              {callState === 'SPEAKING' && 'Reading briefing...'}
              {callState === 'LISTENING' && 'Listening (speak now)...'}
              {callState === 'PROCESSING' && 'AI processing...'}
            </p>

            {callState === 'LISTENING' && (
              <div className="ai-call-transcript" style={{ position: 'relative' }}>
                {transcript || "..."}
                {transcript.trim() && (
                  <button 
                    onClick={forceProcess}
                    style={{ position: 'absolute', right: '4px', bottom: '4px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: '50%', width: '28px', height: '28px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    title="Send Command"
                  >
                    <Check size={14} />
                  </button>
                )}
              </div>
            )}
            
            {callState === 'PROCESSING' && (
              <div className="ai-call-transcript">
                <Loader2 className="spin" size={16} style={{ display: 'inline', marginRight: 8 }} />
                Saving updates...
              </div>
            )}

            {/* Visual Task Agenda */}
            {callState !== 'RINGING' && currentTasks && currentTasks.length > 0 && (
              <div className="ai-call-tasks-list">
                <h4>Today's Agenda</h4>
                <div className="tasks-scroll">
                  {currentTasks.map((t, idx) => {
                    let timeStr = "";
                    if (t.deadline) {
                      const d = new Date(t.deadline);
                      if (d.getHours() !== 0 || d.getMinutes() !== 0) {
                        timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                      }
                    }
                    return (
                      <div key={t.id || idx} className={`ai-call-task-item ${t.completed ? 'completed' : ''}`}>
                        <span className="task-num">{idx + 1}</span>
                        <span className="task-text">{t.text}</span>
                        {timeStr && <span className="task-time">{timeStr}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="ai-call-actions">
              {callState === 'RINGING' ? (
                <>
                  <button className="call-btn decline" onClick={handleDeclineClick} title="Decline">
                    <PhoneOff size={24} />
                  </button>
                  <button 
                    className="call-btn snooze-btn" 
                    onClick={() => snoozeCall(10)}
                    title="Snooze 10 mins"
                  >
                    Snooze
                  </button>
                  <button className="call-btn answer" onClick={answerCall} title="Answer">
                    <Phone size={24} />
                  </button>
                </>
              ) : (
                <button className="call-btn decline" onClick={endCall} title="End Call">
                  <PhoneOff size={24} />
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
