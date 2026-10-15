import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer";
import { getRecipientDisplayName } from "../_shared/nameParser.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const isArabicText = (str: string) => /[\u0600-\u06FF]/.test(str);

function isFounderNameColumn(header: string): boolean {
  const h = header.toLowerCase();
  if (h.includes('second') || h.includes('العضو الثاني') || h.includes('ثاني')) return false;
  return (
    h.includes('founder name') || h.includes('full name') ||
    h.includes('اسمك بالكامل') || h.includes('الاسم بالكامل') ||
    h.includes('اسم الفاوندر') || h.includes('اسم المؤسس') ||
    h.includes('اسم صاحب') || h.includes('فاوندر') || h.includes('مؤسس') ||
    (h.includes('اسم') && h.includes('founder')) ||
    (h.includes('name') && h.includes('founder'))
  );
}

function extractRecipientDetails(sub: any) {
  let email = sub.founder_email || sub.email || sub.contact_email;
  let name = sub.founder_name || sub.startup_name || 'Founder';
  const companyName = sub.company_name || sub.startup_name || 'Startup';

  if (!email && sub.additional_data && typeof sub.additional_data === 'object') {
    const additionalData = sub.additional_data;
    const columnOrder = additionalData._column_order;
    let foundEmail = null;

    if (Array.isArray(columnOrder)) {
      const founderNameIdx = columnOrder.findIndex((header: string) => {
        const lower = header.toLowerCase();
        return (lower.includes('full name') || lower.includes('الاسم بالكامل') || lower.includes('اسمك بالكامل')) &&
               !lower.includes('second') && !lower.includes('العضو الثاني');
      });
      if (founderNameIdx !== -1) {
        for (let i = founderNameIdx + 1; i < columnOrder.length; i++) {
          const header = columnOrder[i];
          const lower = header.toLowerCase();
          if ((lower.includes('email') || lower.includes('البريد')) &&
              !lower.includes('second') && !lower.includes('العضو الثاني')) {
            const val = additionalData[header];
            if (typeof val === 'string' && val.includes('@')) {
              const match = val.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
              if (match) { foundEmail = match[0].trim(); break; }
            }
          }
        }
      }
    }
    if (!foundEmail) {
      for (const [key, val] of Object.entries(additionalData)) {
        const lk = key.toLowerCase();
        if (lk.includes('second') || lk.includes('العضو الثاني')) continue;
        if (lk.includes('email') || lk.includes('البريد')) {
          if (typeof val === 'string' && val.includes('@')) {
            const match = val.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
            if (match) { foundEmail = match[0].trim(); break; }
          }
        }
      }
    }
    if (!foundEmail) {
      for (const [key, val] of Object.entries(additionalData)) {
        const lk = key.toLowerCase();
        if (lk.includes('second') || lk.includes('العضو الثاني')) continue;
        if (typeof val === 'string' && val.includes('@')) {
          const match = val.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
          if (match) { foundEmail = match[0].trim(); break; }
        }
      }
    }
    if (foundEmail) email = foundEmail;
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
        if (!isArabicText(trimmed)) { if (!englishName) englishName = trimmed; }
        else { if (!arabicFallbackName) arabicFallbackName = trimmed; }
      }
      if (englishName) break;
    }
    if (englishName) name = englishName;
    else if (arabicFallbackName && (name === sub.founder_name || name === sub.startup_name || name === 'Founder')) name = arabicFallbackName;
  }

  const finalName = getRecipientDisplayName(name) || 'Founder';
  return { email, name: finalName, firstName: finalName, companyName };
}

function isHtml(str: string): boolean {
  return /<[a-z][\s\S]*>/i.test(str);
}

function buildHtmlBody(bodyTpl: string, vars: Record<string, string>): string {
  let result = bodyTpl;
  for (const [key, val] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), val);
  }
  return isHtml(result) ? result : result.replace(/\n/g, '<br>');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 405
      });
    }

    const payload = await req.json();
    console.log('[Acceptance Emails] Payload received:', JSON.stringify(payload));

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: smtpSettings } = await supabase.from('smtp_settings').select('*').limit(1).maybeSingle();
    const smtpUser = smtpSettings?.smtp_user || Deno.env.get("SMTP_USER");
    const smtpPass = smtpSettings?.smtp_pass || Deno.env.get("SMTP_PASS");
    const smtpHost = smtpSettings?.smtp_host || Deno.env.get("SMTP_HOST") || "smtp.gmail.com";
    const smtpPort = smtpSettings?.smtp_port || parseInt(Deno.env.get("SMTP_PORT") || "465", 10);

    if (!smtpUser || !smtpPass) {
      return new Response(JSON.stringify({ success: false, error: 'SMTP credentials missing.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400
      });
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost, port: smtpPort, secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPass }
    });

    const fromAddress = `"Athar Startups" <${smtpUser}>`;
    const perSubmissionResults: any[] = [];

    if (payload.eventId && Array.isArray(payload.submissionIds) && payload.submissionIds.length > 0) {
      const { data: event } = await supabase.from('events').select('*').eq('event_id', payload.eventId).maybeSingle();
      const { data: submissions, error: subErr } = await supabase
        .from('company_submissions').select('*').in('submission_id', payload.submissionIds);

      if (subErr || !submissions || submissions.length === 0) {
        return new Response(JSON.stringify({ success: false, error: 'No submissions found.' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404
        });
      }

      const adminEmails: string[] = event?.acceptance_admin_emails || [];
      const ccEmails: string[] = event?.acceptance_cc_emails || [];
      const subjectTpl = event?.acceptance_email_template_subject || "Congratulations! You've been selected - {{company_name}}";
      const bodyTpl = event?.acceptance_email_template_body || 'Dear {{founder_name}},\n\nCongratulations! We are thrilled to inform you that {{company_name}} has been selected to join our program.\n\nLooking forward to working with you!\n\nWarmly,\nThe Athar Team';

      for (const sub of submissions) {
        const { email, name, firstName, companyName } = extractRecipientDetails(sub);
        if (!email) {
          perSubmissionResults.push({ submission_id: sub.submission_id, success: false, email: null, error: 'No email found' });
          await supabase.from('email_audit_log').insert({
            event_id: payload.eventId, submission_id: sub.submission_id,
            email_type: 'acceptance', recipient: 'unknown', status: 'failed',
            error_message: 'No email found', sent_by: payload.sentBy || null
          });
          continue;
        }

        const vars = { company_name: companyName, founder_name: name, first_name: firstName, project_manager_name: 'Athar Team' };
        const subject = subjectTpl.replace(/\{\{company_name\}\}/g, companyName).replace(/\{\{founder_name\}\}/g, name).replace(/\{\{first_name\}\}/g, firstName);
        const html = buildHtmlBody(bodyTpl, vars);
        const allCc = [...ccEmails, ...adminEmails].filter(Boolean);

        try {
          const info = await transporter.sendMail({
            from: fromAddress, to: email,
            cc: allCc.length > 0 ? allCc.join(', ') : undefined,
            subject, html
          });
          console.log(`[Acceptance Emails] Sent to ${email}. MessageId: ${info.messageId}`);
          perSubmissionResults.push({ submission_id: sub.submission_id, success: true, email });

          const currentCount = (sub.email_send_count as any) || {};
          const newCount = { ...currentCount, acceptance: (currentCount.acceptance || 0) + 1 };
          await supabase.from('company_submissions').update({ email_send_count: newCount }).eq('submission_id', sub.submission_id);

          await supabase.from('email_audit_log').insert({
            event_id: payload.eventId, submission_id: sub.submission_id,
            email_type: 'acceptance', recipient: email, status: 'sent',
            sent_by: payload.sentBy || null
          });
        } catch (sendErr: any) {
          console.error(`[Acceptance Emails] Failed for ${email}:`, sendErr);
          perSubmissionResults.push({ submission_id: sub.submission_id, success: false, email, error: sendErr.message });
          await supabase.from('email_audit_log').insert({
            event_id: payload.eventId, submission_id: sub.submission_id,
            email_type: 'acceptance', recipient: email, status: 'failed',
            error_message: sendErr.message, sent_by: payload.sentBy || null
          });
        }
      }
    } else if (payload.company_email) {
      const allCc = [...(payload.cc_emails || []), ...(payload.admin_emails || [])].filter(Boolean);
      try {
        await transporter.sendMail({
          from: fromAddress, to: payload.company_email,
          cc: allCc.length > 0 ? allCc.join(', ') : undefined,
          subject: payload.subject || "Congratulations! You've been selected",
          html: isHtml(payload.body || '') ? payload.body : (payload.body || '').replace(/\n/g, '<br>')
        });
        perSubmissionResults.push({ submission_id: payload.submission_id || null, success: true, email: payload.company_email });
      } catch (sendErr: any) {
        perSubmissionResults.push({ submission_id: payload.submission_id || null, success: false, email: payload.company_email, error: sendErr.message });
      }
    }

    const successCount = perSubmissionResults.filter(r => r.success).length;
    const failCount = perSubmissionResults.filter(r => !r.success).length;

    return new Response(JSON.stringify({
      success: true,
      message: `Sent ${successCount} acceptance email(s). ${failCount > 0 ? `${failCount} failed.` : ''}`,
      results: perSubmissionResults
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });

  } catch (error: any) {
    console.error('[Acceptance Emails Error]:', error);
    return new Response(JSON.stringify({ success: false, error: error?.message || 'Failed to send acceptance email' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500
    });
  }
});
