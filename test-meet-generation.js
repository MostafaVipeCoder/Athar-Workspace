// Test script for Google Meet generation and booking notifications
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client (we'll use the service role key or anon key?
// For this test, let's just create a test call
const SUPABASE_URL = 'https://nipunwrewluxaikyfbzg.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_PsvF2yugR6vWfUsYCLdQPw_YsD7l5jt';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

console.log('Testing generate-google-meet...');

const testGenerateMeet = async () => {
  const { data, error } = await supabase.functions.invoke('generate-google-meet', {
    body: {
      slot_id: 'aaa8392f-3f95-4365-8367-1357a8cf3f64',
      event_id: 'bdf987a0-493e-4e0c-9514-e8c1390f2e6c',
      start_time: '2026-07-16T09:35:00Z',
      end_time: '2026-07-16T09:50:00Z',
      summary: 'Test Interview - Abdullah Shaban',
      attendees: ['abdullah.shaban615@gmail.com']
    }
  });

  if (error) {
    console.error('Error generating meet link:', error);
    if (error.context?.body) {
      try {
        const errBody = await error.context.json();
        console.error('Error body:', errBody);
      } catch (e) {
        console.error('Could not parse error body');
      }
    }
    return;
  }

  console.log('Generated Meet Link:', data);

  // Now test send-booking-notifications
  console.log('\nTesting send-booking-notifications...');
  const bookingNotification = {
    booking_id: 'test-booking-123',
    slot_id: 'aaa8392f-3f95-4365-8367-1357a8cf3f64',
    event_id: 'bdf987a0-493e-4e0c-9514-e8c1390f2e6c',
    company_name: 'Test Company',
    booker_email: 'abdullah.shaban615@gmail.com',
    start_time: '2026-07-16T09:35:00Z',
    end_time: '2026-07-16T09:50:00Z',
    mentor_name: 'Test PM',
    mentor_email: 'test@athareg.com',
    event_name: 'Test Event',
    admin_email: 'startups@athareg.com',
    meet_link: data?.meet_link,
    is_ather_team: true
  };

  const { data: notifData, error: notifError } = await supabase.functions.invoke('send-booking-notifications', {
    body: bookingNotification
  });

  if (notifError) {
    console.error('Error sending notifications:', notifError);
    if (notifError.context?.body) {
      try {
        const errBody = await notifError.context.json();
        console.error('Error body:', errBody);
      } catch (e) {
        console.error('Could not parse error body');
      }
    }
    return;
  }

  console.log('Notifications sent:', notifData);
};

testGenerateMeet();
