
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface ProcessBookingRequest {
  booking_id: string;
  is_ather_team: boolean;
}

// Helper function to convert PEM to CryptoKey
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const pemContent = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const der = decode(pemContent);

  return await crypto.subtle.importKey(
    "pkcs8",
    der,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: { name: "SHA-256" },
    },
    false,
    ["sign"]
  );
}

// Helper function to encode string to base64url
function base64urlEncode(data: string | ArrayBuffer): string {
  let base64;
  if (typeof data === "string") {
    base64 = btoa(
      encodeURIComponent(data).replace(/%([0-9A-F]{2})/g, (match, p1) =>
        String.fromCharCode(parseInt(p1, 16))
      )
    );
  } else {
    const bytes = new Uint8Array(data);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    base64 = btoa(binary);
  }
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

// Helper function to get Google OAuth2 access token using service account
async function getGoogleAccessToken(
  serviceAccountKey: any,
  impersonateEmail?: string
): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claim: any = {
    iss: serviceAccountKey.client_email,
    scope: "https://www.googleapis.com/auth/calendar",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  if (impersonateEmail) {
    claim.sub = impersonateEmail;
  }

  const headerSegment = base64urlEncode(JSON.stringify(header));
  const claimSegment = base64urlEncode(JSON.stringify(claim));
  const toSign = `${headerSegment}.${claimSegment}`;

  const privateKey = serviceAccountKey.private_key.replace(/\\n/g, "\n");
  const cryptoKey = await importPrivateKey(privateKey);

  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    cryptoKey,
    new TextEncoder().encode(toSign)
  );

  const signatureSegment = base64urlEncode(signature);
  const token = `${headerSegment}.${claimSegment}.${signatureSegment}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: token,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Failed to get access token:", response.status, errorText);
    throw new Error(`Failed to get Google access token (${response.status}): ${errorText}`);
  }

  const tokenData = await response.json();
  return tokenData.access_token;
}

// Create Google Calendar event with Meet link
async function createCalendarEvent(
  accessToken: string,
  eventData: {
    summary: string;
    start: string;
    end: string;
    attendees?: string[];
    calendarId?: string;
    meetLink?: string | null;
  }
) {
  const calendarId = eventData.calendarId || "primary";
  const eventPayload: any = {
    summary: eventData.summary,
    start: {
      dateTime: eventData.start,
      timeZone: "Africa/Cairo",
    },
    end: {
      dateTime: eventData.end,
      timeZone: "Africa/Cairo",
    },
    attendees: eventData.attendees?.map((email) => ({ email })),
    guestsCanInviteOthers: false,
    guestsCanModify: false,
  };

  if (eventData.meetLink) {
    // Shared Mode: attach existing Meet link
    eventPayload.location = eventData.meetLink;
    eventPayload.description = `Google Meet Link: ${eventData.meetLink}`;
    eventPayload.conferenceData = {
      entryPoints: [
        {
          entryPointType: "video",
          uri: eventData.meetLink,
          label: eventData.meetLink,
        },
      ],
      conferenceSolution: {
        key: { type: "hangoutsMeet" },
        name: "Google Meet",
      },
    };
  } else {
    // Unique Mode: create a new Google Meet link
    eventPayload.conferenceData = {
      createRequest: {
        requestId: crypto.randomUUID(),
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      calendarId
    )}/events?conferenceDataVersion=1&sendUpdates=all`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(eventPayload),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Failed to create calendar event:", response.status, errorText);
    throw new Error(`Failed to create Google calendar event (${response.status}): ${errorText}`);
  }

  return await response.json();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 405,
      });
    }

    const requestData: ProcessBookingRequest = await req.json();
    console.log("Processing booking:", requestData);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Fetch the booking from the appropriate table
    const bookingTable = requestData.is_ather_team
      ? "ather_team_bookings"
      : "bookings";
    const slotTable = requestData.is_ather_team
      ? "ather_team_slots"
      : "mentor_slots";

    const { data: booking, error: bookingError } = await supabase
      .from(bookingTable)
      .select("*")
      .eq("id", requestData.booking_id)
      .single();

    if (bookingError || !booking) {
      throw new Error("Booking not found");
    }

    // Fetch event details for admin/cc emails and Google Meet settings
    const { data: eventDetails, error: eventError } = await supabase
      .from("events")
      .select("interview_admin_emails, interview_cc_emails, meeting_link_mode, shared_google_meet_link")
      .eq("event_id", booking.event_id)
      .single();

    if (eventError) {
      console.warn("Event details not found:", eventError);
    }

    const isSharedMode =
      eventDetails?.meeting_link_mode === "shared" &&
      !!eventDetails?.shared_google_meet_link?.trim();
    const sharedMeetLink = isSharedMode
      ? eventDetails.shared_google_meet_link.trim()
      : null;

    // Get Google service account credentials
    let googleServiceAccountKey: any = null;
    const { data: googleSettings, error: settingsError } = await supabase
      .from("google_settings")
      .select("*")
      .eq("event_id", booking.event_id)
      .limit(1)
      .maybeSingle();

    if (settingsError) {
      console.error("Error fetching Google settings:", settingsError);
    }

    if (!googleSettings?.service_account_key) {
      const { data: globalGoogleSettings, error: globalSettingsError } =
        await supabase
          .from("google_settings")
          .select("*")
          .is("event_id", null)
          .limit(1)
          .maybeSingle();
      if (globalSettingsError) {
        console.error("Error fetching global Google settings:", globalSettingsError);
      }
      if (globalGoogleSettings?.service_account_key) {
        try {
          googleServiceAccountKey = JSON.parse(globalGoogleSettings.service_account_key);
        } catch (e) {
          console.error("Invalid global service account key JSON:", e);
        }
      } else {
        const serviceAccountJson = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY");
        if (serviceAccountJson) {
          googleServiceAccountKey = JSON.parse(serviceAccountJson);
        }
      }
    } else {
      try {
        googleServiceAccountKey = JSON.parse(googleSettings.service_account_key);
      } catch (e) {
        console.error("Invalid per-event service account key JSON:", e);
      }
    }

    if (!googleServiceAccountKey) {
      throw new Error("Google Calendar API credentials not configured");
    }

    const calendarId = googleSettings?.calendar_id || "primary";
    const impersonateEmail = googleSettings?.impersonate_email;

    // Prepare attendees list
    const attendees: string[] = [];
    if (booking.booker_email) attendees.push(booking.booker_email);
    if (booking.mentor_email) attendees.push(booking.mentor_email);

    // Add admin/cc emails
    if (eventDetails?.interview_admin_emails) {
      const adminEmails =
        typeof eventDetails.interview_admin_emails === "string"
          ? JSON.parse(eventDetails.interview_admin_emails)
          : eventDetails.interview_admin_emails;
      if (Array.isArray(adminEmails)) {
        attendees.push(...adminEmails);
      }
    }
    if (eventDetails?.interview_cc_emails) {
      const ccEmails =
        typeof eventDetails.interview_cc_emails === "string"
          ? JSON.parse(eventDetails.interview_cc_emails)
          : eventDetails.interview_cc_emails;
      if (Array.isArray(ccEmails)) {
        attendees.push(...ccEmails);
      }
    }

    // Get access token and create event
    const accessToken = await getGoogleAccessToken(
      googleServiceAccountKey,
      impersonateEmail
    );
    const summary = requestData.is_ather_team
      ? `Interview: ${booking.company_name} with ${booking.mentor_name}`
      : `Mentor Session: ${booking.company_name} with ${booking.mentor_name}`;

    const calendarEvent = await createCalendarEvent(accessToken, {
      summary,
      start: booking.start_time,
      end: booking.end_time,
      attendees,
      calendarId,
      meetLink: sharedMeetLink,
    });

    // Extract or assign Meet link
    let meetLink = sharedMeetLink;
    if (!isSharedMode) {
      meetLink =
        calendarEvent.conferenceData?.entryPoints?.find(
          (ep: any) => ep.entryPointType === "video"
        )?.uri || calendarEvent.hangoutLink || null;
    }

    if (!meetLink) {
      console.error("No Meet link found in event:", calendarEvent);
      throw new Error("Failed to generate Google Meet link");
    }

    // Update booking
    const { error: updateBookingError } = await supabase
      .from(bookingTable)
      .update({
        meet_link: meetLink,
        status: "confirmed",
        calendar_event_id: calendarEvent.id,
      })
      .eq("id", booking.id);

    if (updateBookingError) {
      console.error("Error updating booking:", updateBookingError);
      throw new Error("Failed to update booking");
    }

    // Update slot
    const { error: updateSlotError } = await supabase
      .from(slotTable)
      .update({ meet_link: meetLink })
      .eq("id", booking.slot_id);

    if (updateSlotError) {
      console.error("Error updating slot:", updateSlotError);
    }

    console.log("Successfully processed booking:", booking.id);

    return new Response(
      JSON.stringify({
        success: true,
        meet_link: meetLink,
        calendar_event_id: calendarEvent.id,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error processing booking:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
