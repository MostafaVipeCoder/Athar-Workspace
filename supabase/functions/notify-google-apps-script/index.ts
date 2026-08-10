
import { serve } from "https://deno.land/std@0.192.0/http/server.ts";

const GOOGLE_APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbymN2BgmWY2f_zyCg1bV9Nb4L1LYKzVcCv1i21aS5iJNolFi8vagVPl1KDrjU6wUJh2AQ/exec";

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  try {
    // Get the request body from the frontend
    const payload = await req.json();

    // Forward the request to Google Apps Script
    const response = await fetch(GOOGLE_APPS_SCRIPT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    // Get the response from Google Apps Script
    const data = await response.json();

    // Return the response with CORS headers
    return new Response(JSON.stringify(data), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    console.error("Error forwarding request to Google Apps Script:", error);
    return new Response(
      JSON.stringify({ success: false, error: "Failed to notify Google Apps Script" }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }
});
