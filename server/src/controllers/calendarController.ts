import { Request, Response } from 'express';
import { google } from 'googleapis';
import prisma from '../db.js';

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID || '',
  process.env.GOOGLE_CLIENT_SECRET || '',
  'postmessage'
);

export async function syncTodosToCalendar(req: Request, res: Response) {
  try {
    const userId = req.user!.id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { googleRefreshToken: true, googleChannelId: true, googleResourceId: true }
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

    let syncedCount = 0;

    if (todos.length > 0) {
      for (const todo of todos) {
        // Define event start and end time (1 hour duration by default if no end time)
        const startTime = new Date(todo.deadline!);
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
        } catch (err: any) {
          console.error(`Failed to sync task ${todo.id}:`, err.message);
        }
      }
    }

    // Register Webhook watch channel if WEBHOOK_URL is configured
    if (process.env.WEBHOOK_URL) {
      const channelId = `channel-${userId}`;
      try {
        // Stop old watch channel if exists
        if (user.googleChannelId && user.googleResourceId) {
          try {
            await calendar.channels.stop({
              requestBody: {
                id: user.googleChannelId,
                resourceId: user.googleResourceId
              }
            });
          } catch (stopErr) {
            // ignore if already expired
          }
        }

        const watchResponse = await calendar.events.watch({
          calendarId: 'primary',
          requestBody: {
            id: channelId,
            type: 'web_hook',
            address: `${process.env.WEBHOOK_URL}/api/calendar/webhook`,
          },
        });

        await prisma.user.update({
          where: { id: userId },
          data: {
            googleChannelId: channelId,
            googleResourceId: watchResponse.data.resourceId || null
          }
        });
      } catch (watchErr: any) {
        console.error('Failed to register Google Calendar watch channel:', watchErr.message);
      }
    }

    res.json({ message: `Successfully synced ${syncedCount} tasks to Google Calendar!` });
  } catch (error) {
    console.error('Calendar sync error:', error);
    res.status(500).json({ error: 'Failed to sync to Google Calendar' });
  }
}

export async function autoSyncTodoToGoogle(todo: any, userId: string, action: string, timezone: string = 'UTC') {
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

    const event: any = {
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
  } catch (err: any) {
    console.error('Background auto-sync failed for task', todo.id, ':', err.message);
  }
}

export async function handleCalendarWebhook(req: Request, res: Response) {
  try {
    const channelId = req.headers['x-goog-channel-id'] as string;
    const resourceState = req.headers['x-goog-resource-state'] as string;
    
    // Google sends 'sync' on first connection, and 'exists' on subsequent updates
    if (resourceState === 'sync') {
      return res.status(200).send('OK');
    }

    if (!channelId) {
      return res.status(400).send('Missing channel ID');
    }

    const user = await prisma.user.findFirst({
      where: { googleChannelId: channelId }
    });

    if (!user || !user.googleRefreshToken) {
      return res.status(200).send('User or tokens not found for channel');
    }

    // Set credentials with user refresh token
    oauth2Client.setCredentials({ refresh_token: user.googleRefreshToken });
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    // Fetch events modified in the last 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const response = await calendar.events.list({
      calendarId: 'primary',
      updatedMin: fiveMinutesAgo,
      singleEvents: true,
      showDeleted: true
    });

    const events = response.data.items || [];

    for (const event of events) {
      const eventId = event.id;
      if (!eventId) continue;

      const todo = await prisma.todo.findFirst({
        where: { googleEventId: eventId, userId: user.id }
      });

      if (event.status === 'cancelled') {
        if (todo) {
          await prisma.todo.delete({
            where: { id: todo.id }
          });
          console.log(`Deleted local Todo ${todo.id} because Google Event was deleted.`);
        }
      } else {
        // Active event
        const text = event.summary || 'Google Calendar Event';
        const deadline = event.start?.dateTime ? new Date(event.start.dateTime) : (event.start?.date ? new Date(event.start.date) : null);
        
        // Map colorId back to priority
        let priority = 'medium';
        if (event.colorId === '11') priority = 'high';
        else if (event.colorId === '10') priority = 'low';
        else if (event.colorId === '5') priority = 'medium';

        // Extract priority from description if present
        if (event.description && event.description.includes('Priority:')) {
          const match = event.description.match(/Priority:\s*(high|medium|low)/i);
          if (match) {
            priority = match[1].toLowerCase();
          }
        }

        if (todo) {
          // Compare and update only if values differ
          const localDeadlineTime = todo.deadline ? new Date(todo.deadline).getTime() : 0;
          const googleDeadlineTime = deadline ? new Date(deadline).getTime() : 0;

          if (todo.text !== text || todo.priority !== priority || localDeadlineTime !== googleDeadlineTime) {
            await prisma.todo.update({
              where: { id: todo.id },
              data: {
                text,
                deadline,
                priority
              }
            });
            console.log(`Updated local Todo ${todo.id} from Google Event.`);
          }
        } else {
          // Create new local Todo if not exists (two-way sync)
          await prisma.todo.create({
            data: {
              userId: user.id,
              text,
              completed: false,
              priority,
              deadline,
              googleEventId: eventId
            }
          });
          console.log(`Created new local Todo for Google Event ${eventId}.`);
        }
      }
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).send('Error');
  }
}
