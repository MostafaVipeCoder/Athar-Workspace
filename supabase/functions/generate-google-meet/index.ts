import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface GenerateMeetLinkRequest {
  slot_id: string;
  event_id: string;
  start_time: string;
  end_time: string;
  summary?: string;
  attendees?: string[];
}

// Helper function to convert PEM to CryptoKey
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  // Remove PEM headers/footers and whitespace
  const pemContent = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");

  // Decode base64 to get DER
  const der = decode(pemContent);

  // Import as PKCS8
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
  // Create JWT header
  const header = {
    alg: "RS256",
    typ: "JWT",
  };

  // Create JWT claim set
  const now = Math.floor(Date.now() / 1000);
  const claim: any = {
    iss: serviceAccountKey.client_email,
    scope: "https://www.googleapis.com/auth/calendar",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600, // 1 hour expiration
    iat: now,
  };

  // Add subject (impersonation email) if provided
  if (impersonateEmail) {
    claim.sub = impersonateEmail;
  }

  // Create header and claim segments
  const headerSegment = base64urlEncode(JSON.stringify(header));
  const claimSegment = base64urlEncode(JSON.stringify(claim));
  const toSign = `${headerSegment}.${claimSegment}`;

  // Import private key
  const privateKey = serviceAccountKey.private_key.replace(/\\n/g, "\n");
  const cryptoKey = await importPrivateKey(privateKey);

  // Sign the JWT
  const signature = await crypto.subtle.sign(
    {
      name: "RSASSA-PKCS1-v1_5",
    },
    cryptoKey,
    new TextEncoder().encode(toSign)
  );

  const signatureSegment = base64urlEncode(signature);

  // Assemble JWT
  const token = `${headerSegment}.${claimSegment}.${signatureSegment}`;

  // Exchange JWT for access token
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: token,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Failed to get access token:", response.status, errorText);
    throw new Error(`Failed to get access token: ${response.status} - ${errorText}`);
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
  }
) {
  const calendarId = eventData.calendarId || "primary";
  
  const eventPayload = {
    summary: eventData.summary,
    start: {
      dateTime: eventData.start,
      timeZone: "UTC",
    },
    end: {
      dateTime: eventData.end,
      timeZone: "UTC",
    },
    conferenceData: {
      createRequest: {
        requestId: crypto.randomUUID(),
        conferenceSolutionKey: {
          type: "hangoutsMeet",
        },
      },
    },
    attendees: eventData.attendees?.map((email) => ({ email })),
  };

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      calendarId
    )}/events?conferenceDataVersion=1`,
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
    throw new Error(`Failed to create calendar event: ${response.status}`);
  }

  const event = await response.json();
  return event;
}

serve(async (req) => {
  // Handle CORS preflight request
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

    const requestData: GenerateMeetLinkRequest = await req.json();
    console.log("Received request to generate Meet link:", requestData);

    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get Google service account credentials from database or environment variables
    let googleServiceAccountKey: any = null;

    // First, check if we have settings in the database
    const { data: googleSettings, error: settingsError } = await supabase
      .from("google_settings")
      .select("*")
      .eq("event_id", requestData.event_id)
      .limit(1)
      .maybeSingle();

    if (settingsError) {
      console.error("Error fetching Google settings:", settingsError);
    }

    // If we don't have per-event settings, try global settings or env vars
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
          googleServiceAccountKey = JSON.parse(
            globalGoogleSettings.service_account_key
          );
        } catch (e) {
          console.error("Invalid global service account key JSON:", e);
        }
      } else {
        // Fallback to environment variable
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
      return new Response(
        JSON.stringify({
          success: false,
          error:
            "Google Calendar API credentials not configured. Please set up your service account key.",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    // Get calendar ID and impersonation email from settings
    const calendarId = googleSettings?.calendar_id || "primary";
    const impersonateEmail = googleSettings?.impersonate_email;

    // Get access token
    const accessToken = await getGoogleAccessToken(googleServiceAccountKey, impersonateEmail);
    console.log("Successfully obtained Google access token");

    // Create the calendar event
    const summary =
      requestData.summary ||
      `Meeting (Slot ${requestData.slot_id.slice(0, 8)})`;
    const calendarEvent = await createCalendarEvent(accessToken, {
      summary,
      start: requestData.start_time,
      end: requestData.end_time,
      attendees: requestData.attendees,
      calendarId,
    });

    // Extract the Google Meet link
    const meetLink =
      calendarEvent.conferenceData?.entryPoints?.find(
        (ep: any) => ep.entryPointType === "video"
      )?.uri ||
      calendarEvent.hangoutLink ||
      null;

    if (!meetLink) {
      console.error("No Meet link found in event:", calendarEvent);
      return new Response(
        JSON.stringify({
          success: false,
          error: "Failed to generate Google Meet link. Event created but no link found.",
          event: calendarEvent,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    console.log("Successfully generated Meet link:", meetLink);

    // Success!
    return new Response(
      JSON.stringify({
        success: true,
        meet_link: meetLink,
        calendar_event_id: calendarEvent.id,
        event: calendarEvent,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error generating Google Meet link:", error);
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
