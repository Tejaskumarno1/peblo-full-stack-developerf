import { google } from 'googleapis';
import prisma from '../db.js';

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'postmessage'
);

export async function syncTodosToCalendar(req, res) {
  try {
    const userId = req.user.id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { googleRefreshToken: true }
    });

    if (!user || !user.googleRefreshToken) {
      return res.status(403).json({ error: 'Google Calendar not connected. Please log in with Google again.' });
    }

    // Set credentials with the refresh token
    oauth2Client.setCredentials({ refresh_token: user.googleRefreshToken });
    
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Fetch user's active tasks with deadlines to sync
    const todos = await prisma.todo.findMany({
      where: { 
        userId, 
        completed: false,
        deadline: { not: null }
      }
    });

    if (todos.length === 0) {
      return res.json({ message: 'No tasks with deadlines to sync' });
    }

    let syncedCount = 0;

    for (const todo of todos) {
      // Define event start and end time (1 hour duration by default if no end time)
      const startTime = new Date(todo.deadline);
      const endTime = new Date(startTime.getTime() + 60 * 60 * 1000); // +1 hour

      const event = {
        summary: `Task: ${todo.text}`,
        description: `Priority: ${todo.priority}\nSynced from Peblo Notes.`,
        start: {
          dateTime: startTime.toISOString(),
          timeZone: 'UTC',
        },
        end: {
          dateTime: endTime.toISOString(),
          timeZone: 'UTC',
        },
        reminders: {
          useDefault: true,
        },
      };

      try {
        await calendar.events.insert({
          calendarId: 'primary',
          requestBody: event,
        });
        syncedCount++;
      } catch (err) {
        console.error(`Failed to sync task ${todo.id}:`, err.message);
      }
    }

    res.json({ message: `Successfully synced ${syncedCount} tasks to Google Calendar!` });
  } catch (error) {
    console.error('Calendar sync error:', error);
    res.status(500).json({ error: 'Failed to sync to Google Calendar' });
  }
}

export async function autoSyncTodoToGoogle(todo, userId, action, timezone = 'UTC') {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { googleRefreshToken: true }
    });

    if (!user || !user.googleRefreshToken) return;

    oauth2Client.setCredentials({ refresh_token: user.googleRefreshToken });
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    if (action === 'delete') {
      if (todo.googleEventId) {
        await calendar.events.delete({ calendarId: 'primary', eventId: todo.googleEventId }).catch(() => {});
      }
      return;
    }

    if (!todo.deadline) return;

    const startTime = new Date(todo.deadline);
    const endTime = new Date(startTime.getTime() + 60 * 60 * 1000); // +1 hour

    // Map priorities to colors
    let colorId = '1'; // default blue
    if (todo.priority === 'high') colorId = '11'; // Tomato Red
    else if (todo.priority === 'medium') colorId = '5'; // Banana Yellow
    else if (todo.priority === 'low') colorId = '10'; // Basil Green

    const event = {
      summary: `Task: ${todo.text}`,
      description: `Priority: ${todo.priority}\nSynced from Peblo Notes.`,
      colorId,
      start: { dateTime: startTime.toISOString(), timeZone: timezone },
      end: { dateTime: endTime.toISOString(), timeZone: timezone },
      reminders: { useDefault: true },
    };

    // Auto-Generate Google Meet link for "High" priority or if text contains "meeting"
    const isMeeting = todo.text.toLowerCase().includes('meeting') || todo.priority === 'high';
    if (isMeeting) {
      event.conferenceData = {
        createRequest: {
          requestId: `peblo-${todo.id}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' }
        }
      };
    }

    if (action === 'create' || (action === 'update' && !todo.googleEventId)) {
      const response = await calendar.events.insert({ 
        calendarId: 'primary', 
        requestBody: event,
        conferenceDataVersion: 1
      });
      if (response.data.id) {
        await prisma.todo.update({ where: { id: todo.id }, data: { googleEventId: response.data.id } });
      }
    } else if (action === 'update' && todo.googleEventId) {
      await calendar.events.update({ 
        calendarId: 'primary', 
        eventId: todo.googleEventId, 
        requestBody: event,
        conferenceDataVersion: 1
      });
    }
  } catch (err) {
    console.error('Background auto-sync failed for task', todo.id, ':', err.message);
  }
}

export async function handleCalendarWebhook(req, res) {
  try {
    const channelId = req.headers['x-goog-channel-id'];
    const resourceState = req.headers['x-goog-resource-state'];
    
    // Google sends 'sync' on first connection, and 'exists' on subsequent updates
    if (resourceState === 'sync') {
      return res.status(200).send('OK');
    }

    // To implement full two-way sync, you would use the channelId to look up the user,
    // fetch the latest events using calendar.events.list with a syncToken,
    // and then update the Todo in your database based on the event details.
    
    console.log('Received webhook from Google Calendar for channel:', channelId);
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).send('Error');
  }
}
