import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer";

interface BookingData {
  booking_id: string;
  slot_id: string;
  mentor_id?: string;
  event_id: string;
  company_name: string;
  booker_email: string;
  start_time: string;
  end_time: string;
  mentor_name: string;
  mentor_email: string;
  mentor_photo_url?: string;
  event_name?: string;
  admin_email?: string;
  interview_admin_emails?: string[];
  interview_cc_emails?: string[];
  meet_link?: string;
  is_ather_team?: boolean;
}

// Generate ICS (iCalendar) file content
function generateICS(data: BookingData): string {
    const uid = `${data.booking_id}@athareg.com`;
    const now = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z";
    const start = new Date(data.start_time).toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z";
    const end = new Date(data.end_time).toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z";

    const summary = data.is_ather_team 
        ? `${data.company_name} - ${data.event_name || 'Athar Accelerator'}`
        : `Mentor Session: ${data.mentor_name} with ${data.company_name}`;
        
    const location = data.meet_link || 'Online';
    
    const description = data.is_ather_team
        ? `Interview with Athar Team (${data.mentor_name}) for ${data.company_name}\nGoogle Meet Link: ${data.meet_link}`
        : `Mentor session booking with ${data.mentor_name} for ${data.company_name}`;

    return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Athar//Mentor Booking//EN
CALSCALE:GREGORIAN
METHOD:REQUEST
BEGIN:VEVENT
DTSTART:${start}
DTEND:${end}
DTSTAMP:${now}
UID:${uid}
ATTENDEE;CN="${data.company_name}";RSVP=TRUE:mailto:${data.booker_email}
ATTENDEE;CN="${data.mentor_name}";RSVP=TRUE:mailto:${data.mentor_email}
${data.admin_email ? `ATTENDEE;CN="Athar Startups";RSVP=TRUE:mailto:${data.admin_email}` : ""}
CREATED:${now}
DESCRIPTION:${description}
LAST-MODIFIED:${now}
LOCATION:${location}
ORGANIZER;CN="Athar":mailto:no-reply@athareg.com
SEQUENCE:0
STATUS:CONFIRMED
SUMMARY:${summary}
TRANSP:OPAQUE
END:VEVENT
END:VCALENDAR`;
}

// Generate HTML email templates
function generateBookerEmail(data: BookingData): string {
    const meetSection = data.meet_link 
        ? `<p><strong>Interview Link (Google Meet):</strong> <a href="${data.meet_link}">${data.meet_link}</a></p>` 
        : '';
    const bookingType = data.is_ather_team ? 'Athar Team Interview' : 'Mentor Session';
    
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Booking Confirmation - ${bookingType}</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8fafc; }
        .container { background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); overflow: hidden; }
        .header { background: linear-gradient(135deg, #1a27c9 0%, #2d3af0 100%); padding: 30px; text-align: center; }
        .header h1 { color: white; margin: 0; font-size: 24px; }
        .content { padding: 30px; }
        .info-box { background-color: #f0f4ff; border-radius: 8px; padding: 20px; margin-bottom: 20px; border-left: 4px solid #1a27c9; }
        .info-box p { margin: 10px 0; }
        .info-box strong { color: #1a27c9; }
        .footer { background-color: #f8fafc; padding: 20px; text-align: center; font-size: 14px; color: #64748b; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Your Booking is Confirmed!</h1>
        </div>
        <div class="content">
            <p>Hello,</p>
            <p>Thank you for booking! Here are your booking details:</p>
            
            <div class="info-box">
                <p><strong>With:</strong> ${data.mentor_name}</p>
                <p><strong>Company:</strong> ${data.company_name}</p>
                <p><strong>Date and Time:</strong> ${new Date(data.start_time).toLocaleString('en-US')}</p>
                <p><strong>Duration:</strong> ${Math.round((new Date(data.end_time).getTime() - new Date(data.start_time).getTime()) / (1000 * 60))} minutes</p>
                ${data.event_name ? `<p><strong>Event/Program:</strong> ${data.event_name}</p>` : ''}
                ${meetSection}
            </div>
            
            <p>A calendar invitation has been sent to your email. Please accept the invitation to add the session to your calendar.</p>
            
            <p>If you have any questions, please don't hesitate to contact us.</p>
            
            <p>Best regards,<br>The Athar Team</p>
        </div>
        <div class="footer">
            <p>© 2024 Athar. All rights reserved.</p>
        </div>
    </div>
</body>
</html>
  `;
}

function generateMentorEmail(data: BookingData): string {
    const title = data.is_ather_team ? 'You Have a New Interview!' : 'You Have a New Session Booking!';
    const meetSection = data.meet_link 
        ? `<p><strong>Interview Link (Google Meet):</strong> <a href="${data.meet_link}">${data.meet_link}</a></p>` 
        : '';
    
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8fafc; }
        .container { background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); overflow: hidden; }
        .header { background: linear-gradient(135deg, #1a27c9 0%, #2d3af0 100%); padding: 30px; text-align: center; }
        .header h1 { color: white; margin: 0; font-size: 24px; }
        .content { padding: 30px; }
        .info-box { background-color: #f0f4ff; border-radius: 8px; padding: 20px; margin-bottom: 20px; border-left: 4px solid #1a27c9; }
        .info-box p { margin: 10px 0; }
        .info-box strong { color: #1a27c9; }
        .footer { background-color: #f8fafc; padding: 20px; text-align: center; font-size: 14px; color: #64748b; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>${title}</h1>
        </div>
        <div class="content">
            <p>Hello ${data.mentor_name},</p>
            <p>A session/interview has been booked with you. Here are the details:</p>
            
            <div class="info-box">
                <p><strong>Company:</strong> ${data.company_name}</p>
                <p><strong>Booker Email:</strong> ${data.booker_email}</p>
                <p><strong>Date and Time:</strong> ${new Date(data.start_time).toLocaleString('en-US')}</p>
                <p><strong>Duration:</strong> ${Math.round((new Date(data.end_time).getTime() - new Date(data.start_time).getTime()) / (1000 * 60))} minutes</p>
                ${data.event_name ? `<p><strong>Event:</strong> ${data.event_name}</p>` : ''}
                ${meetSection}
            </div>
            
            <p>A calendar invitation has been sent to your email. Please accept the invitation to add the session to your calendar.</p>
            
            <p>Best regards,<br>The Athar Team</p>
        </div>
        <div class="footer">
            <p>© 2024 Athar. All rights reserved.</p>
        </div>
    </div>
</body>
</html>
  `;
}

function generateAdminEmail(data: BookingData): string {
    const title = data.is_ather_team ? 'New Interview Booking Notification' : 'New Mentor Session Booking Notification';
    const meetSection = data.meet_link 
        ? `<p><strong>Interview Link (Google Meet):</strong> <a href="${data.meet_link}">${data.meet_link}</a></p>` 
        : '';
    
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8fafc; }
        .container { background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); overflow: hidden; }
        .header { background: linear-gradient(135deg, #1a27c9 0%, #2d3af0 100%); padding: 30px; text-align: center; }
        .header h1 { color: white; margin: 0; font-size: 24px; }
        .content { padding: 30px; }
        .info-box { background-color: #f0f4ff; border-radius: 8px; padding: 20px; margin-bottom: 20px; border-left: 4px solid #1a27c9; }
        .info-box p { margin: 10px 0; }
        .info-box strong { color: #1a27c9; }
        .footer { background-color: #f8fafc; padding: 20px; text-align: center; font-size: 14px; color: #64748b; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>${title}</h1>
        </div>
        <div class="content">
            <p>Hello,</p>
            <p>A new booking has been made. Here are the details:</p>
            
            <div class="info-box">
                <p><strong>Company Name:</strong> ${data.company_name}</p>
                <p><strong>Company Email:</strong> ${data.booker_email}</p>
                <p><strong>Project Manager / Mentor:</strong> ${data.mentor_name}</p>
                <p><strong>Project Manager / Mentor Email:</strong> ${data.mentor_email}</p>
                <p><strong>Date and Time:</strong> ${new Date(data.start_time).toLocaleString('en-US')}</p>
                <p><strong>Duration:</strong> ${Math.round((new Date(data.end_time).getTime() - new Date(data.start_time).getTime()) / (1000 * 60))} minutes</p>
                ${data.event_name ? `<p><strong>Event/Program:</strong> ${data.event_name}</p>` : ''}
                ${meetSection}
            </div>
            
            <p>Best regards,<br>The Athar Team</p>
        </div>
        <div class="footer">
            <p>© 2024 Athar. All rights reserved.</p>
        </div>
    </div>
</body>
</html>
  `;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 405
      });
    }

    const bookingData: BookingData = await req.json();
    console.log('[Booking Notifications] Received data:', bookingData);

    const icsContent = generateICS(bookingData);
    const icsFileName = `booking-${bookingData.booking_id}.ics`;

    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Fetch SMTP settings from database
    const { data: smtpSettings, error: smtpDbError } = await supabase
      .from('smtp_settings')
      .select('*')
      .limit(1)
      .maybeSingle();

    if (smtpDbError) {
      console.error('[Booking Notifications] Error fetching SMTP settings:', smtpDbError);
    }

    const smtpUser = smtpSettings?.smtp_user || Deno.env.get("SMTP_USER");
    const smtpPass = smtpSettings?.smtp_pass || Deno.env.get("SMTP_PASS");
    const smtpHost = smtpSettings?.smtp_host || Deno.env.get("SMTP_HOST") || "smtp.gmail.com";
    const smtpPort = smtpSettings?.smtp_port || parseInt(Deno.env.get("SMTP_PORT") || "465", 10);

    const transporter = smtpUser && smtpPass ? nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    }) : null;

    const senderEmail = smtpUser || 'no-reply@athareg.com';
    const senderName = 'Athar';
    const fromAddress = `"${senderName}" <${senderEmail}>`;

    const emails = [];

    // Booker Subject
    const bookerSubject = bookingData.is_ather_team
      ? `Your Interview with Athar Team (${bookingData.mentor_name}) is Confirmed!`
      : `Your Session with ${bookingData.mentor_name} is Confirmed!`;

    // 1. Email to Booker
    const bookerEmail: any = {
      from: fromAddress,
      to: bookingData.booker_email,
      subject: bookerSubject,
      html: generateBookerEmail(bookingData),
      attachments: [
        {
          filename: icsFileName,
          content: icsContent,
          contentType: 'text/calendar; method=REQUEST; charset=utf-8'
        }
      ]
    };
    
    emails.push(bookerEmail);

    // Mentor/PM Subject
    const mentorSubject = bookingData.is_ather_team
      ? `New Interview with ${bookingData.company_name}!`
      : `New Session Booking with ${bookingData.company_name}!`;

    // 2. Email to Mentor / Project Manager
    emails.push({
      from: fromAddress,
      to: bookingData.mentor_email,
      subject: mentorSubject,
      html: generateMentorEmail(bookingData),
      attachments: [
        {
          filename: icsFileName,
          content: icsContent,
          contentType: 'text/calendar; method=REQUEST; charset=utf-8'
        }
      ]
    });

    // Admin Subject
    const adminSubject = bookingData.is_ather_team
      ? `New Interview Booking - ${bookingData.company_name} with ${bookingData.mentor_name} at ${bookingData.event_name || 'Event'}`
      : `New Mentor Session Booking at ${bookingData.event_name || 'Event'}`;

    // 3. Email to Admin (startups@athareg.com)
    if (bookingData.admin_email) {
      emails.push({
        from: fromAddress,
        to: bookingData.admin_email,
        subject: adminSubject,
        html: generateAdminEmail(bookingData),
        attachments: [
          {
            filename: icsFileName,
            content: icsContent,
            contentType: 'text/calendar; method=REQUEST; charset=utf-8'
          }
        ]
      });
    }

    // 4. Emails to Interview Admin Emails
    if (bookingData.interview_admin_emails && bookingData.interview_admin_emails.length > 0) {
      for (const adminEmail of bookingData.interview_admin_emails) {
        // Extract just the email address if it's in "Name <email>" format
        const cleanEmail = adminEmail.match(/<([^>]+)>/)?.[1] || adminEmail.trim();
        if (cleanEmail) {
          emails.push({
            from: fromAddress,
            to: cleanEmail,
            subject: adminSubject,
            html: generateAdminEmail(bookingData),
            attachments: [
              {
                filename: icsFileName,
                content: icsContent,
                contentType: 'text/calendar; method=REQUEST; charset=utf-8'
              }
            ]
          });
        }
      }
    }

    // 5. Emails to Interview CC Emails
    if (bookingData.interview_cc_emails && bookingData.interview_cc_emails.length > 0) {
      for (const ccEmail of bookingData.interview_cc_emails) {
        // Extract just the email address if it's in "Name <email>" format
        const cleanEmail = ccEmail.match(/<([^>]+)>/)?.[1] || ccEmail.trim();
        if (cleanEmail) {
          emails.push({
            from: fromAddress,
            to: cleanEmail,
            subject: adminSubject,
            html: generateAdminEmail(bookingData),
            attachments: [
              {
                filename: icsFileName,
                content: icsContent,
                contentType: 'text/calendar; method=REQUEST; charset=utf-8'
              }
            ]
          });
        }
      }
    }

    // Send emails using SMTP if available
    if (transporter && smtpUser && smtpPass) {
      console.log('[Booking Notifications] Sending emails via SMTP...');
      
      for (const email of emails) {
        try {
          const info = await transporter.sendMail(email);
          console.log('[Booking Notifications] Email sent to:', email.to, 'MessageId:', info.messageId);
        } catch (sendError) {
          console.error('[Booking Notifications] Failed to send email to:', email.to, sendError);
          throw sendError;
        }
      }

      return new Response(JSON.stringify({ 
        success: true, 
        message: 'Emails sent successfully via SMTP',
        emails_sent: emails.length 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      });
    } else {
      console.warn('[Booking Notifications] SMTP_USER or SMTP_PASS not set, emails not sent');
      
      // Store notifications in the database for later processing (optional)
      const { error: dbError } = await supabase
        .from('booking_notifications')
        .insert({
          booking_id: bookingData.booking_id,
          recipients: emails.map(e => e.to),
          data: bookingData,
          sent_at: new Date().toISOString(),
          status: 'pending'
        });

      if (dbError) {
        console.error('[Booking Notifications] Failed to log notification:', dbError);
      }

      return new Response(JSON.stringify({ 
        success: true, 
        message: 'Notification received (emails pending SMTP config)',
        emails_pending: emails.length 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      });
    }
  } catch (error) {
    console.error('[Booking Notifications] Error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500
    });
  }
});
