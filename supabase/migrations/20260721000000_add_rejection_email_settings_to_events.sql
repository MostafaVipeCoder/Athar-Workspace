
-- Add rejection email settings columns to events table
ALTER TABLE events
ADD COLUMN rejection_admin_emails TEXT[] DEFAULT '{}',
ADD COLUMN rejection_cc_emails TEXT[] DEFAULT '{}',
ADD COLUMN rejection_email_template_subject TEXT DEFAULT 'Thank You for Your Application',
ADD COLUMN rejection_email_template_body TEXT DEFAULT 'Dear {{founder_name}},\n\nThank you for your application to the Athar Green Tech Accelerator. We had the opportunity to review your submission, and while we were impressed with your startup, we have decided not to move forward with your application at this time.\n\nWe received a large number of strong applications, and the selection process was extremely competitive. We encourage you to continue developing your startup and hope you will consider applying again in the future.\n\nBest regards,\nThe Ather Team';
