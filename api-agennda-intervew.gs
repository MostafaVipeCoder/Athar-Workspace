// ------------------------------
// Configuration
// ------------------------------
var SUPABASE_URL = 'https://nipunwrewluxaikyfbzg.supabase.co';
var SUPABASE_ANON_KEY = 'sb_publishable_PsvF2yugR6vWfUsYCLdQPw_YsD7l5jt'; // Replace with your actual anon key
var CALENDAR_ID = 'primary'; // Or your specific calendar ID (e.g., 'startups@athareg.com')

// ------------------------------
// Helper Functions (ES5 Compatible)
// ------------------------------
function safeGet(obj, path) {
  var keys = path.split('.');
  var result = obj;
  
  for (var i = 0; i < keys.length; i++) {
    if (result == null) {
      return undefined;
    }
    result = result[keys[i]];
  }
  
  return result;
}

function findInArray(arr, callback) {
  for (var i = 0; i < arr.length; i++) {
    if (callback(arr[i])) {
      return arr[i];
    }
  }
  return undefined;
}

function extendObject(obj1, obj2) {
  var result = {};
  for (var key in obj1) {
    if (obj1.hasOwnProperty(key)) {
      result[key] = obj1[key];
    }
  }
  for (var key in obj2) {
    if (obj2.hasOwnProperty(key)) {
      result[key] = obj2[key];
    }
  }
  return result;
}

function mapArray(arr, callback) {
  var result = [];
  for (var i = 0; i < arr.length; i++) {
    result.push(callback(arr[i]));
  }
  return result;
}

function filterArray(arr, callback) {
  var result = [];
  for (var i = 0; i < arr.length; i++) {
    if (callback(arr[i])) {
      result.push(arr[i]);
    }
  }
  return result;
}

function forEachArray(arr, callback) {
  for (var i = 0; i < arr.length; i++) {
    callback(arr[i]);
  }
}

// ------------------------------
// Supabase Helper Functions
// ------------------------------
function supabaseRequest(table, method, data, id) {
  var url = SUPABASE_URL + '/rest/v1/' + table;
  
  if (id) {
    url += '?id=eq.' + id;
  }
  
  var options = {
    method: method,
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    muteHttpExceptions: true
  };
  
  if (data) {
    options.payload = JSON.stringify(data);
  }
  
  var response = UrlFetchApp.fetch(url, options);
  var responseData = JSON.parse(response.getContentText());
  
  if (response.getResponseCode() >= 400) {
    console.error('Supabase error:', responseData);
    throw new Error('Supabase error: ' + JSON.stringify(responseData));
  }
  
  return responseData;
}

// ------------------------------
// Google Calendar Helper Functions
// ------------------------------
function createCalendarEvent(booking, eventDetails) {
  // Validate start_time and end_time
  if (!booking.start_time || !booking.end_time) {
    throw new Error('Missing start_time or end_time in booking data');
  }
  
  // Validate that both times are dateTime (not just date)
  // Also ensure we have proper ISO strings
  var startTime = new Date(booking.start_time);
  var endTime = new Date(booking.end_time);
  
  if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
    throw new Error('Invalid start or end time format');
  }
  
  var meetingLinkMode = (eventDetails && eventDetails.meeting_link_mode) ? eventDetails.meeting_link_mode : 'unique';
  var sharedMeetLink = (eventDetails && eventDetails.shared_google_meet_link) ? String(eventDetails.shared_google_meet_link).trim() : '';

  if (meetingLinkMode === 'shared') {
    if (!sharedMeetLink) {
      return {
        success: false,
        error: 'Shared Google Meet mode is enabled, but no shared Google Meet link is configured.'
      };
    }
  }

  var event = {
    summary: booking.is_ather_team 
      ? '' + booking.company_name + ' with ' + booking.mentor_name 
      : 'Mentor Session: ' + booking.company_name + ' with ' + booking.mentor_name,
    location: (meetingLinkMode === 'shared') ? sharedMeetLink : '',
    description: (meetingLinkMode === 'shared') ? 'Google Meet Link: ' + sharedMeetLink : '',
    start: {
      dateTime: startTime.toISOString(),
      timeZone: 'Africa/Cairo'
    },
    end: {
      dateTime: endTime.toISOString(),
      timeZone: 'Africa/Cairo'
    },
    attendees: [],
    guestsCanInviteOthers: false,
    guestsCanModify: false
  };
  
  // Only add conferenceData.createRequest if in unique mode
  if (meetingLinkMode !== 'shared') {
    event.conferenceData = {
      createRequest: {
        requestId: Utilities.getUuid(),
        conferenceSolutionKey: {
          type: 'hangoutsMeet'
        }
      }
    };
  }

  // Add attendees
  if (booking.booker_email) {
    event.attendees.push({ email: booking.booker_email });
  }
  if (booking.mentor_email) {
    event.attendees.push({ email: booking.mentor_email });
  }
  
  // Add admin emails from event details
  if (eventDetails && eventDetails.interview_admin_emails) {
    var adminEmails;
    if (typeof eventDetails.interview_admin_emails === 'string') {
      adminEmails = JSON.parse(eventDetails.interview_admin_emails);
    } else {
      adminEmails = eventDetails.interview_admin_emails;
    }
    
    forEachArray(adminEmails, function(email) {
      event.attendees.push({ email: email });
    });
  }
  
  if (eventDetails && eventDetails.interview_cc_emails) {
    var ccEmails;
    if (typeof eventDetails.interview_cc_emails === 'string') {
      ccEmails = JSON.parse(eventDetails.interview_cc_emails);
    } else {
      ccEmails = eventDetails.interview_cc_emails;
    }
    
    forEachArray(ccEmails, function(email) {
      event.attendees.push({ email: email });
    });
  }
  
  try {
    // Create the event using Calendar Advanced Service
    var createdEvent = Calendar.Events.insert(event, CALENDAR_ID, {
      conferenceDataVersion: 1,
      sendUpdates: 'all' // This sends the invitations automatically
    });
    
    // Get the Meet link
    var meetLink;
    if (meetingLinkMode === 'shared') {
      meetLink = sharedMeetLink;
    } else {
      var entryPoints = safeGet(createdEvent, 'conferenceData.entryPoints');
      if (entryPoints) {
        var videoEntry = findInArray(entryPoints, function(ep) {
          return ep.entryPointType === 'video';
        });
        if (videoEntry) {
          meetLink = videoEntry.uri;
        }
      }
      
      if (!meetLink) {
        meetLink = createdEvent.hangoutLink;
      }
    }
    
    if (!meetLink) {
      return {
        success: false,
        error: 'Failed to obtain Google Meet link'
      };
    }

    return {
      success: true,
      eventId: createdEvent.id,
      meetLink: meetLink
    };
  } catch (error) {
    console.error('Error creating calendar event:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// ------------------------------
// Booking Processing Functions
// ------------------------------
function processBooking(booking) {
  console.log('Processing booking:', booking.id);
  
  try {
    // Step 0: Fetch event details for admin and cc emails
    var events = supabaseRequest('events', 'GET', null, null);
    var eventDetails = findInArray(events, function(e) {
      return e.event_id === booking.event_id;
    });
    
    // Step 1: Create calendar event with Meet link
    var calendarResult = createCalendarEvent(booking, eventDetails);
    if (!calendarResult.success) {
      console.error('Failed to create calendar event');
      // Update booking status to failed
      var updates = {
        meet_link: null,
        status: 'failed',
        error_message: calendarResult.error
      };
      var bookingTable = booking.is_ather_team ? 'ather_team_bookings' : 'bookings';
      supabaseRequest(bookingTable, 'PATCH', updates, booking.id);
      return false;
    }
    
    // Step 2: Update booking with meet link and mark as processed
    var updates = {
      meet_link: calendarResult.meetLink,
      status: 'confirmed',
      calendar_event_id: calendarResult.eventId
    };
    var bookingTable = booking.is_ather_team ? 'ather_team_bookings' : 'bookings';
    var updatedBooking = supabaseRequest(bookingTable, 'PATCH', updates, booking.id);
    
    // Also update the slot with the meet link
    var slotTable = booking.is_ather_team ? 'ather_team_slots' : 'mentor_slots';
    supabaseRequest(slotTable, 'PATCH', { meet_link: calendarResult.meetLink }, booking.slot_id);
    
    console.log('Successfully processed booking:', booking.id);
    return true;
  } catch (error) {
    console.error('Error processing booking:', error);
    var bookingTable = booking.is_ather_team ? 'ather_team_bookings' : 'bookings';
    var updates = {
      status: 'failed',
      error_message: error.message
    };
    supabaseRequest(bookingTable, 'PATCH', updates, booking.id);
    return false;
  }
}

// ------------------------------
// Web App Endpoint (for webhook)
// ------------------------------
// Handle CORS preflight OPTIONS request
function doOptions(e) {
  return sendCorsResponse({});
}

// Helper to send CORS-enabled responses
function sendCorsResponse(data, statusCode) {
  var response = ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
  
  // Set CORS headers
  var headers = {
    'Access-Control-Allow-Origin': '*', // For development; in production, restrict to specific domains
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization',
    'Access-Control-Max-Age': '3600'
  };
  
  // Apply headers - using the undocumented setHeaders method
  for (var key in headers) {
    response.setHeader(key, headers[key]);
  }
  
  if (statusCode) {
    response.setStatusCode(statusCode);
  }
  
  return response;
}

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    console.log('Received webhook payload:', payload);
    
    // Determine which booking table to use
    var bookingTable = payload.is_ather_team ? 'ather_team_bookings' : 'bookings';
    
    // Fetch the full booking from Supabase
    var bookings = supabaseRequest(bookingTable, 'GET', null, payload.booking_id);
    if (bookings.length === 0) {
      throw new Error('Booking not found');
    }
    
    var booking = extendObject(bookings[0], { is_ather_team: payload.is_ather_team });
    
    // Process the booking
    processBooking(booking);
    
    return sendCorsResponse({
      success: true,
      message: 'Booking processed successfully'
    });
  } catch (error) {
    console.error('Error in doPost:', error);
    return sendCorsResponse({
      success: false,
      error: error.message
    }, 500);
  }
}

// Add doGet for testing purposes (optional)
function doGet(e) {
  return sendCorsResponse({
    message: 'Google Apps Script webhook is running!',
    status: 'ok'
  });
}

// ------------------------------
// Time-Driven Polling Function (runs every X minutes)
// ------------------------------
function pollForNewBookings() {
  try {
    // Fetch unprocessed bookings from both tables
    console.log('Polling for new bookings...');
    
    // Fetch unprocessed mentor bookings
    var mentorBookings = supabaseRequest('bookings', 'GET', null, null);
    var unprocessedMentorBookings = filterArray(mentorBookings, function(b) {
      return !b.meet_link && (!b.status || b.status === 'pending');
    });
    
    // Fetch unprocessed ather team bookings
    var atherTeamBookings = supabaseRequest('ather_team_bookings', 'GET', null, null);
    var unprocessedAtherTeamBookings = filterArray(atherTeamBookings, function(b) {
      return !b.meet_link && (!b.status || b.status === 'pending');
    });
    
    // Process all unprocessed bookings
    var allUnprocessed = [];
    
    // Add mentor bookings
    forEachArray(unprocessedMentorBookings, function(b) {
      allUnprocessed.push(extendObject(b, { is_ather_team: false }));
    });
    
    // Add ather team bookings
    forEachArray(unprocessedAtherTeamBookings, function(b) {
      allUnprocessed.push(extendObject(b, { is_ather_team: true }));
    });
    
    // Process each booking
    forEachArray(allUnprocessed, function(booking) {
      processBooking(booking);
    });
    
    console.log('Poll complete. Processed ' + allUnprocessed.length + ' bookings.');
  } catch (error) {
    console.error('Error polling for bookings:', error);
  }
}

// ------------------------------
// Helper Function to Test Setup
// ------------------------------
function testSetup() {
  console.log('Testing Google Apps Script setup...');
  
  // Test Supabase connection
  try {
    var testResult = supabaseRequest('events', 'GET', null, null);
    console.log('Supabase connection successful. Fetched', testResult.length, 'events.');
  } catch (error) {
    console.error('Supabase connection failed:', error);
  }
  
  // Test Calendar access
  try {
    var testEvent = Calendar.Events.list(CALENDAR_ID, { maxResults: 1 });
    var itemsLength = safeGet(testEvent, 'items.length') || 0;
    console.log('Calendar access successful. Found', itemsLength, 'events.');
  } catch (error) {
    console.error('Calendar access failed:', error);
  }
  
  console.log('Setup test complete!');
}
