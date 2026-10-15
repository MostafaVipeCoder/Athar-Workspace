-- Add mentor notification settings columns to events table
ALTER TABLE events
ADD COLUMN IF NOT EXISTS mentor_admin_emails TEXT[] DEFAULT '{}'::TEXT[],
ADD COLUMN IF NOT EXISTS mentor_cc_emails TEXT[] DEFAULT '{}'::TEXT[],
ADD COLUMN IF NOT EXISTS mentor_email_template_subject TEXT DEFAULT 'New Mentor Session Booking: {{company_name}} with {{mentor_name}}',
ADD COLUMN IF NOT EXISTS mentor_email_template_body TEXT DEFAULT 'Dear Team,\n\nA new mentor session has been booked.\n\nCompany: {{company_name}}\nMentor: {{mentor_name}}\n\nBest regards,\nAthar Team';
