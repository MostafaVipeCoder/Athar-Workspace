-- Add interview settings columns to events table
ALTER TABLE events
ADD COLUMN interview_admin_emails TEXT[] DEFAULT '{}',
ADD COLUMN interview_email_template_subject TEXT DEFAULT 'Interview Invitation: {{company_name}}',
ADD COLUMN interview_email_template_body TEXT DEFAULT 'Dear Team,\n\nWe would like to invite {{company_name}} for an interview.\n\nBest regards,\nThe Ather Team';
