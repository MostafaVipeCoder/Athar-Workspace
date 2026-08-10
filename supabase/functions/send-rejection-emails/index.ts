import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer";
import { getRecipientDisplayName } from "../_shared/nameParser.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Name formatting is handled by the shared getRecipientDisplayName() utility.
// It correctly handles compound Arabic/English names such as "Abd Al Rahman Ahmed Mohamed"
// and returns the first meaningful given-name unit instead of naively taking word[0]+word[last].

const isArabicText = (str: string) => /[\u0600-\u06FF]/.test(str);

function isFounderNameColumn(header: string): boolean {
  const h = header.toLowerCase();
  if (h.includes('second') || h.includes('العضو الثاني') || h.includes('ثاني')) return false;
  return (
    h.includes('founder name') ||
    h.includes('full name') ||
    h.includes('اسمك بالكامل') ||
    h.includes('الاسم بالكامل') ||
    h.includes('اسم الفاوندر') ||
    h.includes('اسم المؤسس') ||
    h.includes('اسم صاحب') ||
    h.includes('فاوندر') ||
    h.includes('مؤسس') ||
    (h.includes('اسم') && h.includes('founder')) ||
    (h.includes('name') && h.includes('founder'))
  );
}

function extractRecipientDetails(sub: any) {
  let email = sub.email || sub.contact_email;
  let name = sub.founder_name || sub.startup_name || 'Founder';
  const companyName = sub.startup_name || sub.company_name || 'Startup';

  if (!email && sub.additional_data && typeof sub.additional_data === 'object') {
    const additionalData = sub.additional_data;
    const columnOrder = additionalData._column_order;
    let foundEmail = null;

    // 1. Try using column order to locate the email right after the founder's name
    if (Array.isArray(columnOrder)) {
      // Find index of founder name column
      const founderNameIdx = columnOrder.findIndex((header: string) => {
        const lower = header.toLowerCase();
        return (lower.includes('full name') || lower.includes('الاسم بالكامل') || lower.includes('اسمك بالكامل')) &&
               !lower.includes('second') && !lower.includes('العضو الثاني');
      });

      if (founderNameIdx !== -1) {
        // Find the first email column after the founder name column
        for (let i = founderNameIdx + 1; i < columnOrder.length; i++) {
          const header = columnOrder[i];
          const lower = header.toLowerCase();
          if ((lower.includes('email') || lower.includes('البريد الإلكتروني') || lower.includes('البريد الالكتروني')) &&
              !lower.includes('second') && !lower.includes('العضو الثاني')) {
            const val = additionalData[header];
            if (typeof val === 'string' && val.includes('@') && val.includes('.')) {
              const match = val.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
              if (match) {
                foundEmail = match[0].trim();
                break;
              }
            }
          }
        }
      }
    }

    // 2. Fallback: Search all keys, prioritizing keys containing "email" or "البريد الإلكتروني" and ignoring "second member"
    if (!foundEmail) {
      for (const [key, val] of Object.entries(additionalData)) {
        const lowerKey = key.toLowerCase();
        if (lowerKey.includes('second') || lowerKey.includes('العضو الثاني')) {
          continue;
        }
        if (lowerKey.includes('email') || lowerKey.includes('البريد الإلكتروني') || lowerKey.includes('البريد الالكتروني') || lowerKey.includes('البريد')) {
          if (typeof val === 'string' && val.includes('@') && val.includes('.')) {
            const match = val.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
            if (match) {
              foundEmail = match[0].trim();
              break;
            }
          }
        }
      }
    }

    // 3. Last resort: Any email-like string in the object that is not a second member key
    if (!foundEmail) {
      for (const [key, val] of Object.entries(additionalData)) {
        const lowerKey = key.toLowerCase();
        if (lowerKey.includes('second') || lowerKey.includes('العضو الثاني')) {
          continue;
        }
        if (typeof val === 'string' && val.includes('@') && val.includes('.')) {
          const match = val.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
          if (match) {
            foundEmail = match[0].trim();
            break;
          }
        }
      }
    }

    if (foundEmail) {
      email = foundEmail;
    }
  }

  if (sub.additional_data && typeof sub.additional_data === 'object') {
    let englishName: string | null = null;
    let arabicFallbackName: string | null = null;

    const additionalData = sub.additional_data;
    const columnOrder = additionalData._column_order;
    const keysToCheck = Array.isArray(columnOrder) ? columnOrder : Object.keys(additionalData);

    for (const key of keysToCheck) {
      if (!isFounderNameColumn(key)) continue;
      const val = additionalData[key];
      if (typeof val === 'string' && val.trim()) {
        const trimmed = val.trim();
        if (!isArabicText(trimmed)) {
          if (!englishName) englishName = trimmed;
        } else {
          if (!arabicFallbackName) arabicFallbackName = trimmed;
        }
      }
      if (englishName) break;
    }

    if (englishName) {
      name = englishName;
    } else if (arabicFallbackName && (name === sub.founder_name || name === sub.startup_name || name === 'Founder')) {
      name = arabicFallbackName;
    }
  }

  const finalName = getRecipientDisplayName(name) || 'Founder';
  return { email, name: finalName, firstName: finalName, companyName };
}

serve(async (req) => {
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

    const payload = await req.json();
    console.log('[Rejection Emails] Payload received:', JSON.stringify(payload));

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Fetch SMTP settings
    const { data: smtpSettings, error: smtpDbError } = await supabase
      .from('smtp_settings')
      .select('*')
      .limit(1)
      .maybeSingle();

    if (smtpDbError) {
      console.error('[Rejection Emails] Error fetching SMTP settings:', smtpDbError);
    }

    const smtpUser = smtpSettings?.smtp_user || Deno.env.get("SMTP_USER");
    const smtpPass = smtpSettings?.smtp_pass || Deno.env.get("SMTP_PASS");
    const smtpHost = smtpSettings?.smtp_host || Deno.env.get("SMTP_HOST") || "smtp.gmail.com";
    const smtpPort = smtpSettings?.smtp_port || parseInt(Deno.env.get("SMTP_PORT") || "465", 10);

    if (!smtpUser || !smtpPass) {
      return new Response(JSON.stringify({
        success: false,
        error: 'SMTP credentials missing. Please configure smtp_settings in Supabase database.'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
      });
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    const senderName = 'Athar Startups';
    const fromAddress = `"${senderName}" <${smtpUser}>`;
    const emailsToSend: Array<{ to: string; cc?: string; subject: string; html: string; company_name: string }> = [];

    // Case A: eventId and submissionIds provided
    if (payload.eventId && Array.isArray(payload.submissionIds) && payload.submissionIds.length > 0) {
      const { data: event } = await supabase
        .from('events')
        .select('*')
        .eq('event_id', payload.eventId)
        .maybeSingle();

      const { data: submissions, error: subErr } = await supabase
        .from('company_submissions')
        .select('*')
        .in('submission_id', payload.submissionIds);

      if (subErr || !submissions || submissions.length === 0) {
        return new Response(JSON.stringify({
          success: false,
          error: `No submissions found for given IDs`
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 404
        });
      }

      const adminEmails: string[] = event?.rejection_admin_emails || [];
      const ccEmails: string[] = event?.rejection_cc_emails || [];
      const subjectTpl = event?.rejection_email_template_subject || 'Thank You for Your Application';
      const bodyTpl = event?.rejection_email_template_body || 'Dear {{founder_name}},\n\nThank you for applying. We regret to inform you that we will not be moving forward at this time.\n\nBest regards,\nThe Athar Team';

      for (const sub of submissions) {
        const { email, name, firstName, companyName } = extractRecipientDetails(sub);
        if (!email) {
          console.warn(`[Rejection Emails] No email found for startup: ${sub.startup_name}`);
          continue;
        }

        const subject = subjectTpl
          .replace(/\{\{company_name\}\}/g, companyName)
          .replace(/\{\{founder_name\}\}/g, name)
          .replace(/\{\{first_name\}\}/g, firstName);

        const body = bodyTpl
          .replace(/\{\{company_name\}\}/g, companyName)
          .replace(/\{\{founder_name\}\}/g, name)
          .replace(/\{\{first_name\}\}/g, firstName)
          .replace(/\{\{project_manager_name\}\}/g, 'Athar Team');

        const allCc = [...ccEmails, ...adminEmails].filter(Boolean);

        emailsToSend.push({
          from: fromAddress,
          to: email,
          cc: allCc.length > 0 ? allCc.join(', ') : undefined,
          subject,
          html: body.replace(/\n/g, '<br>'),
          company_name: companyName
        });
      }
    } else if (payload.company_email) {
      // Case B: Direct payload
      const allCc = [...(payload.cc_emails || []), ...(payload.admin_emails || [])].filter(Boolean);
      emailsToSend.push({
        from: fromAddress,
        to: payload.company_email,
        cc: allCc.length > 0 ? allCc.join(', ') : undefined,
        subject: payload.subject || 'Thank You for Your Application',
        html: (payload.body || '').replace(/\n/g, '<br>'),
        company_name: payload.company_name || 'Startup'
      });
    }

    if (emailsToSend.length === 0) {
      return new Response(JSON.stringify({
        success: false,
        error: 'No valid recipient email address found for the selected startup(s).'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
      });
    }

    const sentResults = [];
    for (const mail of emailsToSend) {
      console.log(`[Rejection Emails] Sending to ${mail.to}...`);
      const info = await transporter.sendMail({
        from: mail.from,
        to: mail.to,
        cc: mail.cc,
        subject: mail.subject,
        html: mail.html
      });
      console.log(`[Rejection Emails] Sent to ${mail.to}. MessageId: ${info.messageId}`);
      sentResults.push({ to: mail.to, messageId: info.messageId });
    }

    return new Response(JSON.stringify({
      success: true,
      message: `Successfully sent ${sentResults.length} rejection email(s) via SMTP!`,
      details: sentResults
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (error: any) {
    console.error('[Rejection Emails Error]:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error?.message || 'Failed to send rejection email via SMTP'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500
    });
  }
});
