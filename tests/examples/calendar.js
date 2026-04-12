/**
 * Calendar & Meeting Examples
 */

import { FeishuClient } from '../src/index.js';

const feishu = new FeishuClient();

if (!process.env.FEISHU_APP_ID || !process.env.FEISHU_APP_SECRET) {
  console.error('❌ Please set FEISHU_APP_ID and FEISHU_APP_SECRET');
  process.exit(1);
}

feishu.init(process.env.FEISHU_APP_ID, process.env.FEISHU_APP_SECRET);

async function main() {
  try {
    console.log('📅 Calendar & Meeting Examples\n');

    await feishu.ensureToken();

    // ============ List Calendars ============
    console.log('1️⃣  Listing calendars...');
    const calendars = await feishu.calendar.listCalendars();
    console.log(`   Found ${calendars.data.calendars?.length || 0} calendars`);
    let primaryCalendarId = null;

    if (calendars.data.calendars?.length > 0) {
      const calendar = calendars.data.calendars[0];
      console.log('   First calendar:', calendar.summary);
      console.log('   Calendar ID:', calendar.calendar_id);
      primaryCalendarId = calendar.calendar_id;
    } else {
      console.log('   ⚠️  No calendars found. Cannot test events.');
      console.log('   Create a calendar in your Feishu account first.');
    }

    if (primaryCalendarId) {
      // ============ Create Event ============
      console.log('\n2️⃣  Creating calendar event...');
      const now = new Date();
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      const eventResult = await feishu.calendar.createEvent(primaryCalendarId, {
        summary: 'Test Meeting 🎉',
        description: 'This is a test event created via Feishu API',
        start_time: {
          timestamp: Math.floor(tomorrow.getTime() / 1000),
          timezone: 'Asia/Shanghai',
        },
        end_time: {
          timestamp: Math.floor(tomorrow.getTime() / 1000) + 3600, // 1 hour later
          timezone: 'Asia/Shanghai',
        },
        location: 'Online / Meeting Room',
        visibility: 'default',
        attendee_num: 5,
      });
      console.log('   Event created:', eventResult.data.event_id);
      const eventId = eventResult.data.event_id;

      // ============ Get Event ============
      console.log('\n3️⃣  Getting event details...');
      const event = await feishu.calendar.getEvent(primaryCalendarId, eventId);
      console.log('   Summary:', event.data.summary);
      console.log('   Start:', new Date(event.data.start_time.timestamp * 1000).toISOString());

      // ============ Update Event ============
      console.log('\n4️⃣  Updating event...');
      await feishu.calendar.updateEvent(primaryCalendarId, eventId, {
        summary: 'Updated Meeting Title 📝',
      });
      const updatedEvent = await feishu.calendar.getEvent(primaryCalendarId, eventId);
      console.log('   New title:', updatedEvent.data.summary);

      // ============ Quick Add Event ============
      console.log('\n5️⃣  Quick adding event from text...');
      await feishu.calendar.quickAdd(
        primaryCalendarId,
        'Team standup tomorrow at 10am for 30 minutes'
      );
      console.log('   ✅ Quick add event created');

      // ============ Create Meeting ============
      console.log('\n6️⃣  Creating meeting (conference)...');
      try {
        const meetingResult = await feishu.meeting.createMeeting({
          start_time: Math.floor(tomorrow.getTime() / 1000),
          end_time: Math.floor(tomorrow.getTime() / 1000) + 3600,
          topic: 'Video Meeting via API',
          description: 'Auto-generated meeting',
        });
        console.log('   Meeting created:', meetingResult.data.meeting_id);
        console.log('   Meeting URL:', meetingResult.data.meeting_url);
      } catch (error) {
        console.log('   ⚠️  Meeting creation may require additional permissions');
      }

      // ============ Free/Busy Check ============
      console.log('\n7️⃣  Checking free/busy...');
      const freebusy = await feishu.calendar.freeBusy(
        [primaryCalendarId],
        Math.floor(now.getTime() / 1000),
        Math.floor(tomorrow.getTime() / 1000)
      );
      console.log('   Free/busy info:', JSON.stringify(freebusy.data).substring(0, 200) + '...');

      // ============ List Resources ============
      console.log('\n8️⃣  Listing resources (meeting rooms)...');
      try {
        const resources = await feishu.calendar.listResources();
        console.log(`   Found ${resources.data.resources?.length || 0} resources`);
        if (resources.data.resources?.length > 0) {
          console.log('   First resource:', resources.data.resources[0].name);
        }
      } catch (error) {
        console.log('   ⚠️  Resource listing may require admin permissions');
      }

      // ============ Delete Event ============
      console.log('\n9️⃣  Deleting event...');
      await feishu.calendar.deleteEvent(primaryCalendarId, eventId);
      console.log('   ✅ Event deleted');
    }

    console.log('\n✅ Calendar & Meeting examples complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('   Code:', error.code);
    console.error('   Details:', error.details || {});
    process.exit(1);
  }
}

main();
