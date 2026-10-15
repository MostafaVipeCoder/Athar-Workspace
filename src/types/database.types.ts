export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      agenda_slots: {
        Row: {
          bullet_points: Json | null
          bullet_points_ar: Json | null
          day_id: string | null
          end_time: string | null
          presenter_name: string | null
          presenter_name_ar: string | null
          show_presenter: boolean | null
          slot_id: string
          slot_title: string
          slot_title_ar: string | null
          sort_order: number | null
          start_time: string | null
        }
        Insert: {
          bullet_points?: Json | null
          bullet_points_ar?: Json | null
          day_id?: string | null
          end_time?: string | null
          presenter_name?: string | null
          presenter_name_ar?: string | null
          show_presenter?: boolean | null
          slot_id?: string
          slot_title: string
          slot_title_ar?: string | null
          sort_order?: number | null
          start_time?: string | null
        }
        Update: {
          bullet_points?: Json | null
          bullet_points_ar?: Json | null
          day_id?: string | null
          end_time?: string | null
          presenter_name?: string | null
          presenter_name_ar?: string | null
          show_presenter?: boolean | null
          slot_id?: string
          slot_title?: string
          slot_title_ar?: string | null
          sort_order?: number | null
          start_time?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agenda_slots_day_id_fkey"
            columns: ["day_id"]
            isOneToOne: false
            referencedRelation: "event_days"
            referencedColumns: ["day_id"]
          },
        ]
      }
      alumni_invitations: {
        Row: {
          accepted_at: string | null
          company_id: string
          created_at: string
          founder_email: string
          founder_id: string | null
          id: string
          sent_at: string
          sent_by: string | null
          status: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          company_id: string
          created_at?: string
          founder_email: string
          founder_id?: string | null
          id?: string
          sent_at?: string
          sent_by?: string | null
          status?: string
          token: string
        }
        Update: {
          accepted_at?: string | null
          company_id?: string
          created_at?: string
          founder_email?: string
          founder_id?: string | null
          id?: string
          sent_at?: string
          sent_by?: string | null
          status?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "alumni_invitations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "alumni_invitations_founder_id_fkey"
            columns: ["founder_id"]
            isOneToOne: false
            referencedRelation: "founders"
            referencedColumns: ["founder_id"]
          },
        ]
      }
      ather_team_bookings: {
        Row: {
          ather_team_member_id: string
          booker_email: string
          calendar_event_id: string | null
          company_name: string
          created_at: string | null
          end_time: string | null
          error_message: string | null
          event_id: string
          id: string
          meet_link: string | null
          mentor_email: string | null
          mentor_name: string | null
          slot_id: string
          start_time: string | null
          status: string | null
          submission_id: string | null
          updated_at: string | null
        }
        Insert: {
          ather_team_member_id: string
          booker_email: string
          calendar_event_id?: string | null
          company_name: string
          created_at?: string | null
          end_time?: string | null
          error_message?: string | null
          event_id: string
          id?: string
          meet_link?: string | null
          mentor_email?: string | null
          mentor_name?: string | null
          slot_id: string
          start_time?: string | null
          status?: string | null
          submission_id?: string | null
          updated_at?: string | null
        }
        Update: {
          ather_team_member_id?: string
          booker_email?: string
          calendar_event_id?: string | null
          company_name?: string
          created_at?: string | null
          end_time?: string | null
          error_message?: string | null
          event_id?: string
          id?: string
          meet_link?: string | null
          mentor_email?: string | null
          mentor_name?: string | null
          slot_id?: string
          start_time?: string | null
          status?: string | null
          submission_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ather_team_bookings_ather_team_member_id_fkey"
            columns: ["ather_team_member_id"]
            isOneToOne: false
            referencedRelation: "ather_team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ather_team_bookings_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "ather_team_slots"
            referencedColumns: ["id"]
          },
        ]
      }
      ather_team_members: {
        Row: {
          advance_notice_minutes: number | null
          bio: string | null
          created_at: string | null
          email: string | null
          event_id: string
          id: string
          name: string
          photo_url: string | null
          updated_at: string | null
        }
        Insert: {
          advance_notice_minutes?: number | null
          bio?: string | null
          created_at?: string | null
          email?: string | null
          event_id: string
          id?: string
          name: string
          photo_url?: string | null
          updated_at?: string | null
        }
        Update: {
          advance_notice_minutes?: number | null
          bio?: string | null
          created_at?: string | null
          email?: string | null
          event_id?: string
          id?: string
          name?: string
          photo_url?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      ather_team_slots: {
        Row: {
          ather_team_member_id: string
          created_at: string | null
          end_time: string
          event_id: string
          id: string
          is_available: boolean | null
          meet_link: string | null
          start_time: string
          updated_at: string | null
        }
        Insert: {
          ather_team_member_id: string
          created_at?: string | null
          end_time: string
          event_id: string
          id?: string
          is_available?: boolean | null
          meet_link?: string | null
          start_time: string
          updated_at?: string | null
        }
        Update: {
          ather_team_member_id?: string
          created_at?: string | null
          end_time?: string
          event_id?: string
          id?: string
          is_available?: boolean | null
          meet_link?: string | null
          start_time?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ather_team_slots_ather_team_member_id_fkey"
            columns: ["ather_team_member_id"]
            isOneToOne: false
            referencedRelation: "ather_team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_notifications: {
        Row: {
          booking_id: string
          created_at: string | null
          data: Json
          id: string
          recipients: string[]
          sent_at: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          booking_id: string
          created_at?: string | null
          data: Json
          id?: string
          recipients: string[]
          sent_at?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          booking_id?: string
          created_at?: string | null
          data?: Json
          id?: string
          recipients?: string[]
          sent_at?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_notifications_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          booker_email: string
          calendar_event_id: string | null
          company_name: string
          created_at: string | null
          end_time: string | null
          error_message: string | null
          event_id: string
          id: string
          meet_link: string | null
          mentor_email: string | null
          mentor_id: string
          mentor_name: string | null
          slot_id: string
          start_time: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          booker_email: string
          calendar_event_id?: string | null
          company_name: string
          created_at?: string | null
          end_time?: string | null
          error_message?: string | null
          event_id: string
          id?: string
          meet_link?: string | null
          mentor_email?: string | null
          mentor_id: string
          mentor_name?: string | null
          slot_id: string
          start_time?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          booker_email?: string
          calendar_event_id?: string | null
          company_name?: string
          created_at?: string | null
          end_time?: string | null
          error_message?: string | null
          event_id?: string
          id?: string
          meet_link?: string | null
          mentor_email?: string | null
          mentor_id?: string
          mentor_name?: string | null
          slot_id?: string
          start_time?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bookings_mentor_id_fkey"
            columns: ["mentor_id"]
            isOneToOne: false
            referencedRelation: "mentors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_slot_id_fkey"
            columns: ["slot_id"]
            isOneToOne: false
            referencedRelation: "mentor_slots"
            referencedColumns: ["id"]
          },
        ]
      }
      certificates: {
        Row: {
          certificate_id: string
          created_at: string | null
          event_id: string | null
          founder_id: string
          issue_date: string
          issued_by: string | null
          pdf_url: string | null
          program_id: string
          template_id: string | null
          verification_code: string
        }
        Insert: {
          certificate_id?: string
          created_at?: string | null
          event_id?: string | null
          founder_id: string
          issue_date?: string
          issued_by?: string | null
          pdf_url?: string | null
          program_id: string
          template_id?: string | null
          verification_code?: string
        }
        Update: {
          certificate_id?: string
          created_at?: string | null
          event_id?: string | null
          founder_id?: string
          issue_date?: string
          issued_by?: string | null
          pdf_url?: string | null
          program_id?: string
          template_id?: string | null
          verification_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "certificates_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "certificates_founder_id_fkey"
            columns: ["founder_id"]
            isOneToOne: false
            referencedRelation: "founders"
            referencedColumns: ["founder_id"]
          },
          {
            foreignKeyName: "certificates_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["program_id"]
          },
        ]
      }
      companies: {
        Row: {
          bio: string | null
          company_id: string
          description: string | null
          description_ar: string | null
          display_config: Json | null
          employees: string | null
          event_id: string | null
          founder: string | null
          founder_ar: string | null
          founding_year: number | null
          governorate: string | null
          governorate_ar: string | null
          industry: string | null
          industry_ar: string | null
          is_alumni: boolean | null
          linkedin_url: string | null
          links: Json | null
          location: string | null
          location_ar: string | null
          logo_url: string | null
          name: string
          name_ar: string | null
          province: string | null
          role: string | null
          sector: string | null
          sort_order: number | null
          stage: string | null
          status: string | null
          website_url: string | null
        }
        Insert: {
          bio?: string | null
          company_id?: string
          description?: string | null
          description_ar?: string | null
          display_config?: Json | null
          employees?: string | null
          event_id?: string | null
          founder?: string | null
          founder_ar?: string | null
          founding_year?: number | null
          governorate?: string | null
          governorate_ar?: string | null
          industry?: string | null
          industry_ar?: string | null
          is_alumni?: boolean | null
          linkedin_url?: string | null
          links?: Json | null
          location?: string | null
          location_ar?: string | null
          logo_url?: string | null
          name: string
          name_ar?: string | null
          province?: string | null
          role?: string | null
          sector?: string | null
          sort_order?: number | null
          stage?: string | null
          status?: string | null
          website_url?: string | null
        }
        Update: {
          bio?: string | null
          company_id?: string
          description?: string | null
          description_ar?: string | null
          display_config?: Json | null
          employees?: string | null
          event_id?: string | null
          founder?: string | null
          founder_ar?: string | null
          founding_year?: number | null
          governorate?: string | null
          governorate_ar?: string | null
          industry?: string | null
          industry_ar?: string | null
          is_alumni?: boolean | null
          linkedin_url?: string | null
          links?: Json | null
          location?: string | null
          location_ar?: string | null
          logo_url?: string | null
          name?: string
          name_ar?: string | null
          province?: string | null
          role?: string | null
          sector?: string | null
          sort_order?: number | null
          stage?: string | null
          status?: string | null
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "companies_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["event_id"]
          },
        ]
      }
      company_founders: {
        Row: {
          company_id: string
          created_at: string | null
          founder_id: string
          id: string
          is_primary: boolean | null
          role: string | null
          role_in_company: string | null
        }
        Insert: {
          company_id: string
          created_at?: string | null
          founder_id: string
          id?: string
          is_primary?: boolean | null
          role?: string | null
          role_in_company?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string | null
          founder_id?: string
          id?: string
          is_primary?: boolean | null
          role?: string | null
          role_in_company?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_founders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "company_founders_founder_id_fkey"
            columns: ["founder_id"]
            isOneToOne: false
            referencedRelation: "founders"
            referencedColumns: ["founder_id"]
          },
        ]
      }
      company_snapshots: {
        Row: {
          company_id: string
          created_at: string | null
          data: Json
          form_response_id: string | null
          id: string | null
          snapshot_date: string
          snapshot_id: string
          snapshot_type: string
          source: string
        }
        Insert: {
          company_id: string
          created_at?: string | null
          data?: Json
          form_response_id?: string | null
          id?: string | null
          snapshot_date?: string
          snapshot_id?: string
          snapshot_type: string
          source?: string
        }
        Update: {
          company_id?: string
          created_at?: string | null
          data?: Json
          form_response_id?: string | null
          id?: string | null
          snapshot_date?: string
          snapshot_id?: string
          snapshot_type?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_snapshots_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "company_snapshots_form_response_id_fkey"
            columns: ["form_response_id"]
            isOneToOne: false
            referencedRelation: "form_responses"
            referencedColumns: ["response_id"]
          },
        ]
      }
      company_submissions: {
        Row: {
          additional_data: Json | null
          company_name: string | null
          created_at: string | null
          email_send_count: Json | null
          event_id: string | null
          form_id: string | null
          founder_email: string | null
          founder_name: string | null
          industry: string | null
          location: string | null
          logo_url: string | null
          national_id: string | null
          phone: string | null
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          startup_name: string
          status: string | null
          submission_id: string
          submitted_at: string | null
          updated_at: string | null
        }
        Insert: {
          additional_data?: Json | null
          company_name?: string | null
          created_at?: string | null
          email_send_count?: Json | null
          event_id?: string | null
          form_id?: string | null
          founder_email?: string | null
          founder_name?: string | null
          industry?: string | null
          location?: string | null
          logo_url?: string | null
          national_id?: string | null
          phone?: string | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          startup_name: string
          status?: string | null
          submission_id?: string
          submitted_at?: string | null
          updated_at?: string | null
        }
        Update: {
          additional_data?: Json | null
          company_name?: string | null
          created_at?: string | null
          email_send_count?: Json | null
          event_id?: string | null
          form_id?: string | null
          founder_email?: string | null
          founder_name?: string | null
          industry?: string | null
          location?: string | null
          logo_url?: string | null
          national_id?: string | null
          phone?: string | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          startup_name?: string
          status?: string | null
          submission_id?: string
          submitted_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_submissions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "company_submissions_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "event_forms"
            referencedColumns: ["form_id"]
          },
        ]
      }
      email_audit_log: {
        Row: {
          email_type: string
          error_message: string | null
          event_id: string
          id: number
          recipient: string
          sent_at: string | null
          sent_by: string | null
          status: string
          submission_id: string | null
        }
        Insert: {
          email_type: string
          error_message?: string | null
          event_id: string
          id?: number
          recipient: string
          sent_at?: string | null
          sent_by?: string | null
          status: string
          submission_id?: string | null
        }
        Update: {
          email_type?: string
          error_message?: string | null
          event_id?: string
          id?: number
          recipient?: string
          sent_at?: string | null
          sent_by?: string | null
          status?: string
          submission_id?: string | null
        }
        Relationships: []
      }
      event_days: {
        Row: {
          day_date: string | null
          day_id: string
          day_name: string
          day_name_ar: string | null
          day_number: number | null
          event_id: string | null
        }
        Insert: {
          day_date?: string | null
          day_id?: string
          day_name: string
          day_name_ar?: string | null
          day_number?: number | null
          event_id?: string | null
        }
        Update: {
          day_date?: string | null
          day_id?: string
          day_name?: string
          day_name_ar?: string | null
          day_number?: number | null
          event_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_days_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["event_id"]
          },
        ]
      }
      event_forms: {
        Row: {
          cover_id: string | null
          cover_image_url: string | null
          created_at: string | null
          description: string | null
          event_id: string | null
          form_id: string
          form_name: string
          form_name_ar: string | null
          integrations: Json | null
          is_active: boolean | null
          library_form_id: string | null
          share_description: string | null
          share_image_url: string | null
          share_title: string | null
          show_thank_you_image: boolean | null
          social_channels_config: Json | null
          target_module: string
          thank_you_image_url: string | null
          thank_you_message: string | null
          updated_at: string | null
        }
        Insert: {
          cover_id?: string | null
          cover_image_url?: string | null
          created_at?: string | null
          description?: string | null
          event_id?: string | null
          form_id?: string
          form_name: string
          form_name_ar?: string | null
          integrations?: Json | null
          is_active?: boolean | null
          library_form_id?: string | null
          share_description?: string | null
          share_image_url?: string | null
          share_title?: string | null
          show_thank_you_image?: boolean | null
          social_channels_config?: Json | null
          target_module: string
          thank_you_image_url?: string | null
          thank_you_message?: string | null
          updated_at?: string | null
        }
        Update: {
          cover_id?: string | null
          cover_image_url?: string | null
          created_at?: string | null
          description?: string | null
          event_id?: string | null
          form_id?: string
          form_name?: string
          form_name_ar?: string | null
          integrations?: Json | null
          is_active?: boolean | null
          library_form_id?: string | null
          share_description?: string | null
          share_image_url?: string | null
          share_title?: string | null
          show_thank_you_image?: boolean | null
          social_channels_config?: Json | null
          target_module?: string
          thank_you_image_url?: string | null
          thank_you_message?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "event_forms_cover_id_fkey"
            columns: ["cover_id"]
            isOneToOne: false
            referencedRelation: "form_covers"
            referencedColumns: ["cover_id"]
          },
          {
            foreignKeyName: "event_forms_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "event_forms_library_form_id_fkey"
            columns: ["library_form_id"]
            isOneToOne: false
            referencedRelation: "library_forms"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          acceptance_admin_emails: string[] | null
          acceptance_cc_emails: string[] | null
          acceptance_email_template_body: string | null
          acceptance_email_template_subject: string | null
          admin_email: string | null
          background_image_url: string | null
          company_portal_enabled: boolean | null
          company_portal_message: string | null
          created_at: string | null
          event_id: string
          event_name: string
          event_name_ar: string | null
          expert_portal_enabled: boolean | null
          expert_portal_message: string | null
          experts_color: string | null
          footer_image_url: string | null
          form_cover_image_url: string | null
          gsheets_url: string | null
          header_height: string | null
          header_image_url: string | null
          header_settings: Json | null
          id: string | null
          interview_admin_emails: string[] | null
          interview_cc_emails: string[] | null
          interview_email_template_body: string | null
          interview_email_template_subject: string | null
          meeting_link_mode: string | null
          mentor_admin_emails: string[] | null
          mentor_cc_emails: string[] | null
          mentor_email_template_body: string | null
          mentor_email_template_subject: string | null
          name: string | null
          program_id: string | null
          rejection_admin_emails: string[] | null
          rejection_cc_emails: string[] | null
          rejection_email_template_body: string | null
          rejection_email_template_subject: string | null
          selection_process_gsheets_url: string | null
          seo_description: string | null
          seo_image_url: string | null
          seo_title: string | null
          shared_google_meet_link: string | null
          show_day_names: boolean | null
          startups_color: string | null
          status: string | null
          submission_deadline: string | null
        }
        Insert: {
          acceptance_admin_emails?: string[] | null
          acceptance_cc_emails?: string[] | null
          acceptance_email_template_body?: string | null
          acceptance_email_template_subject?: string | null
          admin_email?: string | null
          background_image_url?: string | null
          company_portal_enabled?: boolean | null
          company_portal_message?: string | null
          created_at?: string | null
          event_id?: string
          event_name: string
          event_name_ar?: string | null
          expert_portal_enabled?: boolean | null
          expert_portal_message?: string | null
          experts_color?: string | null
          footer_image_url?: string | null
          form_cover_image_url?: string | null
          gsheets_url?: string | null
          header_height?: string | null
          header_image_url?: string | null
          header_settings?: Json | null
          id?: string | null
          interview_admin_emails?: string[] | null
          interview_cc_emails?: string[] | null
          interview_email_template_body?: string | null
          interview_email_template_subject?: string | null
          meeting_link_mode?: string | null
          mentor_admin_emails?: string[] | null
          mentor_cc_emails?: string[] | null
          mentor_email_template_body?: string | null
          mentor_email_template_subject?: string | null
          name?: string | null
          program_id?: string | null
          rejection_admin_emails?: string[] | null
          rejection_cc_emails?: string[] | null
          rejection_email_template_body?: string | null
          rejection_email_template_subject?: string | null
          selection_process_gsheets_url?: string | null
          seo_description?: string | null
          seo_image_url?: string | null
          seo_title?: string | null
          shared_google_meet_link?: string | null
          show_day_names?: boolean | null
          startups_color?: string | null
          status?: string | null
          submission_deadline?: string | null
        }
        Update: {
          acceptance_admin_emails?: string[] | null
          acceptance_cc_emails?: string[] | null
          acceptance_email_template_body?: string | null
          acceptance_email_template_subject?: string | null
          admin_email?: string | null
          background_image_url?: string | null
          company_portal_enabled?: boolean | null
          company_portal_message?: string | null
          created_at?: string | null
          event_id?: string
          event_name?: string
          event_name_ar?: string | null
          expert_portal_enabled?: boolean | null
          expert_portal_message?: string | null
          experts_color?: string | null
          footer_image_url?: string | null
          form_cover_image_url?: string | null
          gsheets_url?: string | null
          header_height?: string | null
          header_image_url?: string | null
          header_settings?: Json | null
          id?: string | null
          interview_admin_emails?: string[] | null
          interview_cc_emails?: string[] | null
          interview_email_template_body?: string | null
          interview_email_template_subject?: string | null
          meeting_link_mode?: string | null
          mentor_admin_emails?: string[] | null
          mentor_cc_emails?: string[] | null
          mentor_email_template_body?: string | null
          mentor_email_template_subject?: string | null
          name?: string | null
          program_id?: string | null
          rejection_admin_emails?: string[] | null
          rejection_cc_emails?: string[] | null
          rejection_email_template_body?: string | null
          rejection_email_template_subject?: string | null
          selection_process_gsheets_url?: string | null
          seo_description?: string | null
          seo_image_url?: string | null
          seo_title?: string | null
          shared_google_meet_link?: string | null
          show_day_names?: boolean | null
          startups_color?: string | null
          status?: string | null
          submission_deadline?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["program_id"]
          },
        ]
      }
      expert_submissions: {
        Row: {
          additional_data: Json | null
          bio: string | null
          company: string | null
          created_at: string | null
          event_id: string | null
          expert_name: string
          form_id: string | null
          photo_url: string | null
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string | null
          submission_id: string
          submitted_at: string | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          additional_data?: Json | null
          bio?: string | null
          company?: string | null
          created_at?: string | null
          event_id?: string | null
          expert_name: string
          form_id?: string | null
          photo_url?: string | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          submission_id?: string
          submitted_at?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          additional_data?: Json | null
          bio?: string | null
          company?: string | null
          created_at?: string | null
          event_id?: string | null
          expert_name?: string
          form_id?: string | null
          photo_url?: string | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          submission_id?: string
          submitted_at?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expert_submissions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "expert_submissions_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "event_forms"
            referencedColumns: ["form_id"]
          },
        ]
      }
      experts: {
        Row: {
          bio: string | null
          bio_ar: string | null
          company: string | null
          company_ar: string | null
          event_id: string | null
          expert_id: string
          linkedin_url: string | null
          master_id: string | null
          name: string
          name_ar: string | null
          photo_url: string | null
          role: string | null
          sort_order: number | null
          title: string | null
          title_ar: string | null
        }
        Insert: {
          bio?: string | null
          bio_ar?: string | null
          company?: string | null
          company_ar?: string | null
          event_id?: string | null
          expert_id?: string
          linkedin_url?: string | null
          master_id?: string | null
          name: string
          name_ar?: string | null
          photo_url?: string | null
          role?: string | null
          sort_order?: number | null
          title?: string | null
          title_ar?: string | null
        }
        Update: {
          bio?: string | null
          bio_ar?: string | null
          company?: string | null
          company_ar?: string | null
          event_id?: string | null
          expert_id?: string
          linkedin_url?: string | null
          master_id?: string | null
          name?: string
          name_ar?: string | null
          photo_url?: string | null
          role?: string | null
          sort_order?: number | null
          title?: string | null
          title_ar?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "experts_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "experts_master_id_fkey"
            columns: ["master_id"]
            isOneToOne: false
            referencedRelation: "master_experts"
            referencedColumns: ["id"]
          },
        ]
      }
      form_covers: {
        Row: {
          cover_id: string
          created_at: string | null
          event_id: string | null
          image_url: string
          name: string
          updated_at: string | null
        }
        Insert: {
          cover_id?: string
          created_at?: string | null
          event_id?: string | null
          image_url: string
          name: string
          updated_at?: string | null
        }
        Update: {
          cover_id?: string
          created_at?: string | null
          event_id?: string | null
          image_url?: string
          name?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "form_covers_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["event_id"]
          },
        ]
      }
      form_field_configs: {
        Row: {
          config_id: string
          created_at: string | null
          display_order: number | null
          entity_type: string
          event_id: string | null
          field_label: string
          field_name: string
          field_options: Json | null
          field_type: string
          form_id: string | null
          help_text: string | null
          is_custom: boolean | null
          is_required: boolean | null
          placeholder: string | null
          show_in_card: boolean | null
          updated_at: string | null
          validation_rules: Json | null
        }
        Insert: {
          config_id?: string
          created_at?: string | null
          display_order?: number | null
          entity_type: string
          event_id?: string | null
          field_label: string
          field_name: string
          field_options?: Json | null
          field_type: string
          form_id?: string | null
          help_text?: string | null
          is_custom?: boolean | null
          is_required?: boolean | null
          placeholder?: string | null
          show_in_card?: boolean | null
          updated_at?: string | null
          validation_rules?: Json | null
        }
        Update: {
          config_id?: string
          created_at?: string | null
          display_order?: number | null
          entity_type?: string
          event_id?: string | null
          field_label?: string
          field_name?: string
          field_options?: Json | null
          field_type?: string
          form_id?: string | null
          help_text?: string | null
          is_custom?: boolean | null
          is_required?: boolean | null
          placeholder?: string | null
          show_in_card?: boolean | null
          updated_at?: string | null
          validation_rules?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "form_field_configs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "form_field_configs_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "event_forms"
            referencedColumns: ["form_id"]
          },
        ]
      }
      form_responses: {
        Row: {
          answers: Json
          created_at: string | null
          event_id: string
          form_id: string
          library_form_id: string | null
          response_id: string
          source: string | null
          status: string | null
          submitted_at: string | null
          tracking_data: Json | null
          updated_at: string | null
        }
        Insert: {
          answers?: Json
          created_at?: string | null
          event_id: string
          form_id: string
          library_form_id?: string | null
          response_id?: string
          source?: string | null
          status?: string | null
          submitted_at?: string | null
          tracking_data?: Json | null
          updated_at?: string | null
        }
        Update: {
          answers?: Json
          created_at?: string | null
          event_id?: string
          form_id?: string
          library_form_id?: string | null
          response_id?: string
          source?: string | null
          status?: string | null
          submitted_at?: string | null
          tracking_data?: Json | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "form_responses_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "form_responses_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "event_forms"
            referencedColumns: ["form_id"]
          },
          {
            foreignKeyName: "form_responses_library_form_id_fkey"
            columns: ["library_form_id"]
            isOneToOne: false
            referencedRelation: "library_forms"
            referencedColumns: ["id"]
          },
        ]
      }
      form_share_events: {
        Row: {
          clicked_at: string | null
          form_id: string
          id: string
          platform: string
          user_agent: string | null
        }
        Insert: {
          clicked_at?: string | null
          form_id: string
          id?: string
          platform: string
          user_agent?: string | null
        }
        Update: {
          clicked_at?: string | null
          form_id?: string
          id?: string
          platform?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "form_share_events_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "event_forms"
            referencedColumns: ["form_id"]
          },
        ]
      }
      founders: {
        Row: {
          auth_user_id: string | null
          bio_ar: string | null
          bio_en: string | null
          created_at: string | null
          email: string | null
          founder_id: string
          linkedin_url: string | null
          name_ar: string
          name_en: string | null
          phone: string | null
          photo_url: string | null
          updated_at: string | null
        }
        Insert: {
          auth_user_id?: string | null
          bio_ar?: string | null
          bio_en?: string | null
          created_at?: string | null
          email?: string | null
          founder_id?: string
          linkedin_url?: string | null
          name_ar: string
          name_en?: string | null
          phone?: string | null
          photo_url?: string | null
          updated_at?: string | null
        }
        Update: {
          auth_user_id?: string | null
          bio_ar?: string | null
          bio_en?: string | null
          created_at?: string | null
          email?: string | null
          founder_id?: string
          linkedin_url?: string | null
          name_ar?: string
          name_en?: string | null
          phone?: string | null
          photo_url?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      google_settings: {
        Row: {
          calendar_id: string | null
          created_at: string | null
          event_id: string | null
          id: string
          impersonate_email: string | null
          service_account_key: string | null
          updated_at: string | null
        }
        Insert: {
          calendar_id?: string | null
          created_at?: string | null
          event_id?: string | null
          id?: string
          impersonate_email?: string | null
          service_account_key?: string | null
          updated_at?: string | null
        }
        Update: {
          calendar_id?: string | null
          created_at?: string | null
          event_id?: string | null
          id?: string
          impersonate_email?: string | null
          service_account_key?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      investor_requests: {
        Row: {
          company_id: string | null
          created_at: string | null
          id: string
          message: string | null
          request_type: string | null
          requester_email: string
          requester_name: string
          requester_org: string | null
          status: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string | null
          id?: string
          message?: string | null
          request_type?: string | null
          requester_email: string
          requester_name: string
          requester_org?: string | null
          status?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string | null
          id?: string
          message?: string | null
          request_type?: string | null
          requester_email?: string
          requester_name?: string
          requester_org?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "investor_requests_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["company_id"]
          },
        ]
      }
      join_athar_analytics: {
        Row: {
          card_id: string | null
          event_type: string
          id: string
          page_id: string
          platform: string | null
          timestamp: string | null
        }
        Insert: {
          card_id?: string | null
          event_type: string
          id?: string
          page_id: string
          platform?: string | null
          timestamp?: string | null
        }
        Update: {
          card_id?: string | null
          event_type?: string
          id?: string
          page_id?: string
          platform?: string | null
          timestamp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "join_athar_analytics_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "join_athar_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "join_athar_analytics_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "join_athar_pages"
            referencedColumns: ["id"]
          },
        ]
      }
      join_athar_cards: {
        Row: {
          button_text: string
          button_url: string
          created_at: string | null
          description: string | null
          id: string
          image_url: string | null
          order_index: number
          page_id: string
          title: string
          updated_at: string | null
        }
        Insert: {
          button_text?: string
          button_url?: string
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          order_index?: number
          page_id: string
          title?: string
          updated_at?: string | null
        }
        Update: {
          button_text?: string
          button_url?: string
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          order_index?: number
          page_id?: string
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "join_athar_cards_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "join_athar_pages"
            referencedColumns: ["id"]
          },
        ]
      }
      join_athar_pages: {
        Row: {
          canvas_background_url: string | null
          canvas_overlay_position: Json | null
          cover_url: string | null
          created_at: string | null
          id: string
          layout_columns: number
          main_title: string
          project_id: string
          updated_at: string | null
        }
        Insert: {
          canvas_background_url?: string | null
          canvas_overlay_position?: Json | null
          cover_url?: string | null
          created_at?: string | null
          id?: string
          layout_columns?: number
          main_title?: string
          project_id: string
          updated_at?: string | null
        }
        Update: {
          canvas_background_url?: string | null
          canvas_overlay_position?: Json | null
          cover_url?: string | null
          created_at?: string | null
          id?: string
          layout_columns?: number
          main_title?: string
          project_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      join_athar_share_presets: {
        Row: {
          created_at: string | null
          id: string
          page_id: string
          platform: string
          preset_message: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          page_id: string
          platform: string
          preset_message?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          page_id?: string
          platform?: string
          preset_message?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "join_athar_share_presets_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "join_athar_pages"
            referencedColumns: ["id"]
          },
        ]
      }
      library_forms: {
        Row: {
          cover_id: string | null
          cover_image_url: string | null
          created_at: string | null
          description: string | null
          event_id: string | null
          fields: Json | null
          form_name: string
          form_name_ar: string | null
          id: string
          import_count: number | null
          integrations: Json | null
          scope: string | null
          share_description: string | null
          share_image_url: string | null
          share_title: string | null
          show_thank_you_image: boolean | null
          social_channels_config: Json | null
          target_module: string | null
          thank_you_image_url: string | null
          thank_you_message: string | null
          updated_at: string | null
        }
        Insert: {
          cover_id?: string | null
          cover_image_url?: string | null
          created_at?: string | null
          description?: string | null
          event_id?: string | null
          fields?: Json | null
          form_name: string
          form_name_ar?: string | null
          id?: string
          import_count?: number | null
          integrations?: Json | null
          scope?: string | null
          share_description?: string | null
          share_image_url?: string | null
          share_title?: string | null
          show_thank_you_image?: boolean | null
          social_channels_config?: Json | null
          target_module?: string | null
          thank_you_image_url?: string | null
          thank_you_message?: string | null
          updated_at?: string | null
        }
        Update: {
          cover_id?: string | null
          cover_image_url?: string | null
          created_at?: string | null
          description?: string | null
          event_id?: string | null
          fields?: Json | null
          form_name?: string
          form_name_ar?: string | null
          id?: string
          import_count?: number | null
          integrations?: Json | null
          scope?: string | null
          share_description?: string | null
          share_image_url?: string | null
          share_title?: string | null
          show_thank_you_image?: boolean | null
          social_channels_config?: Json | null
          target_module?: string | null
          thank_you_image_url?: string | null
          thank_you_message?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "library_forms_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["event_id"]
          },
        ]
      }
      library_resources: {
        Row: {
          created_at: string | null
          event_id: string | null
          is_central: boolean | null
          resource_id: string
          resource_type: string
          sort_order: number | null
          title_ar: string
          title_en: string
          url: string
        }
        Insert: {
          created_at?: string | null
          event_id?: string | null
          is_central?: boolean | null
          resource_id?: string
          resource_type: string
          sort_order?: number | null
          title_ar: string
          title_en: string
          url: string
        }
        Update: {
          created_at?: string | null
          event_id?: string | null
          is_central?: boolean | null
          resource_id?: string
          resource_type?: string
          sort_order?: number | null
          title_ar?: string
          title_en?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "library_resources_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["event_id"]
          },
        ]
      }
      master_experts: {
        Row: {
          bio: string | null
          bio_ar: string | null
          company: string | null
          company_ar: string | null
          created_at: string | null
          id: string
          linkedin_url: string | null
          name: string
          name_ar: string | null
          photo_url: string | null
          title: string | null
          title_ar: string | null
          updated_at: string | null
        }
        Insert: {
          bio?: string | null
          bio_ar?: string | null
          company?: string | null
          company_ar?: string | null
          created_at?: string | null
          id?: string
          linkedin_url?: string | null
          name: string
          name_ar?: string | null
          photo_url?: string | null
          title?: string | null
          title_ar?: string | null
          updated_at?: string | null
        }
        Update: {
          bio?: string | null
          bio_ar?: string | null
          company?: string | null
          company_ar?: string | null
          created_at?: string | null
          id?: string
          linkedin_url?: string | null
          name?: string
          name_ar?: string | null
          photo_url?: string | null
          title?: string | null
          title_ar?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      mentor_day_config: {
        Row: {
          break_between_slots_minutes: number
          created_at: string | null
          day_date: string | null
          day_number: number
          event_id: string
          id: string
          session_end_time: string
          session_start_time: string
          slot_duration_minutes: number
          updated_at: string | null
        }
        Insert: {
          break_between_slots_minutes?: number
          created_at?: string | null
          day_date?: string | null
          day_number: number
          event_id: string
          id?: string
          session_end_time?: string
          session_start_time?: string
          slot_duration_minutes?: number
          updated_at?: string | null
        }
        Update: {
          break_between_slots_minutes?: number
          created_at?: string | null
          day_date?: string | null
          day_number?: number
          event_id?: string
          id?: string
          session_end_time?: string
          session_start_time?: string
          slot_duration_minutes?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      mentor_slots: {
        Row: {
          created_at: string | null
          end_time: string
          event_id: string
          id: string
          is_available: boolean | null
          meet_link: string | null
          mentor_id: string
          start_time: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          end_time: string
          event_id: string
          id?: string
          is_available?: boolean | null
          meet_link?: string | null
          mentor_id: string
          start_time: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          end_time?: string
          event_id?: string
          id?: string
          is_available?: boolean | null
          meet_link?: string | null
          mentor_id?: string
          start_time?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mentor_slots_mentor_id_fkey"
            columns: ["mentor_id"]
            isOneToOne: false
            referencedRelation: "mentors"
            referencedColumns: ["id"]
          },
        ]
      }
      mentoring_distribution_config: {
        Row: {
          break_slots: Json | null
          created_at: string | null
          event_id: string
          finalized_days: number[] | null
          id: string
          is_published: boolean
          mentor_availability: Json | null
          num_days: number
          slot_duration_minutes: number
          start_time: string
          timer_state: Json | null
          total_round_minutes: number
          unique_pairing: boolean
          updated_at: string | null
        }
        Insert: {
          break_slots?: Json | null
          created_at?: string | null
          event_id: string
          finalized_days?: number[] | null
          id?: string
          is_published?: boolean
          mentor_availability?: Json | null
          num_days?: number
          slot_duration_minutes?: number
          start_time?: string
          timer_state?: Json | null
          total_round_minutes?: number
          unique_pairing?: boolean
          updated_at?: string | null
        }
        Update: {
          break_slots?: Json | null
          created_at?: string | null
          event_id?: string
          finalized_days?: number[] | null
          id?: string
          is_published?: boolean
          mentor_availability?: Json | null
          num_days?: number
          slot_duration_minutes?: number
          start_time?: string
          timer_state?: Json | null
          total_round_minutes?: number
          unique_pairing?: boolean
          updated_at?: string | null
        }
        Relationships: []
      }
      mentoring_distribution_day_config: {
        Row: {
          break_between_slots_minutes: number
          created_at: string | null
          day_date: string | null
          day_index: number
          event_id: string
          id: string
          mentor_ids: string[] | null
          session_end_time: string | null
          session_start_time: string
          slot_duration_minutes: number | null
          total_round_minutes: number | null
          updated_at: string | null
        }
        Insert: {
          break_between_slots_minutes?: number
          created_at?: string | null
          day_date?: string | null
          day_index: number
          event_id: string
          id?: string
          mentor_ids?: string[] | null
          session_end_time?: string | null
          session_start_time?: string
          slot_duration_minutes?: number | null
          total_round_minutes?: number | null
          updated_at?: string | null
        }
        Update: {
          break_between_slots_minutes?: number
          created_at?: string | null
          day_date?: string | null
          day_index?: number
          event_id?: string
          id?: string
          mentor_ids?: string[] | null
          session_end_time?: string | null
          session_start_time?: string
          slot_duration_minutes?: number | null
          total_round_minutes?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      mentoring_sessions: {
        Row: {
          company_id: string | null
          company_name: string | null
          conflict_reason: string | null
          created_at: string | null
          day_index: number
          event_id: string
          has_conflict: boolean
          id: string
          is_break: boolean
          is_manual_override: boolean | null
          mentor_id: string | null
          mentor_name: string | null
          slot_end_time: string | null
          slot_index: number
          slot_start_time: string | null
          updated_at: string | null
        }
        Insert: {
          company_id?: string | null
          company_name?: string | null
          conflict_reason?: string | null
          created_at?: string | null
          day_index?: number
          event_id: string
          has_conflict?: boolean
          id?: string
          is_break?: boolean
          is_manual_override?: boolean | null
          mentor_id?: string | null
          mentor_name?: string | null
          slot_end_time?: string | null
          slot_index?: number
          slot_start_time?: string | null
          updated_at?: string | null
        }
        Update: {
          company_id?: string | null
          company_name?: string | null
          conflict_reason?: string | null
          created_at?: string | null
          day_index?: number
          event_id?: string
          has_conflict?: boolean
          id?: string
          is_break?: boolean
          is_manual_override?: boolean | null
          mentor_id?: string | null
          mentor_name?: string | null
          slot_end_time?: string | null
          slot_index?: number
          slot_start_time?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      mentors: {
        Row: {
          advance_notice_minutes: number | null
          bio: string | null
          created_at: string | null
          email: string
          event_id: string
          id: string
          master_id: string | null
          name: string
          photo_url: string | null
          updated_at: string | null
        }
        Insert: {
          advance_notice_minutes?: number | null
          bio?: string | null
          created_at?: string | null
          email: string
          event_id: string
          id?: string
          master_id?: string | null
          name: string
          photo_url?: string | null
          updated_at?: string | null
        }
        Update: {
          advance_notice_minutes?: number | null
          bio?: string | null
          created_at?: string | null
          email?: string
          event_id?: string
          id?: string
          master_id?: string | null
          name?: string
          photo_url?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          audience_target_id: string | null
          audience_type: string | null
          body: string
          broadcast_id: string | null
          created_at: string
          founder_id: string | null
          id: string
          is_read: boolean
          metadata: Json | null
          recipient_id: string | null
          sent_by: string | null
          title: string
        }
        Insert: {
          audience_target_id?: string | null
          audience_type?: string | null
          body: string
          broadcast_id?: string | null
          created_at?: string
          founder_id?: string | null
          id?: string
          is_read?: boolean
          metadata?: Json | null
          recipient_id?: string | null
          sent_by?: string | null
          title: string
        }
        Update: {
          audience_target_id?: string | null
          audience_type?: string | null
          body?: string
          broadcast_id?: string | null
          created_at?: string
          founder_id?: string | null
          id?: string
          is_read?: boolean
          metadata?: Json | null
          recipient_id?: string | null
          sent_by?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_founder_id_fkey"
            columns: ["founder_id"]
            isOneToOne: false
            referencedRelation: "founders"
            referencedColumns: ["founder_id"]
          },
        ]
      }
      opportunities: {
        Row: {
          created_at: string | null
          deadline: string | null
          description_ar: string | null
          description_en: string | null
          eligibility: string | null
          image_url: string | null
          is_active: boolean | null
          link: string | null
          opportunity_id: string
          order_index: number | null
          title_ar: string
          title_en: string | null
          type: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          deadline?: string | null
          description_ar?: string | null
          description_en?: string | null
          eligibility?: string | null
          image_url?: string | null
          is_active?: boolean | null
          link?: string | null
          opportunity_id?: string
          order_index?: number | null
          title_ar: string
          title_en?: string | null
          type?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          deadline?: string | null
          description_ar?: string | null
          description_en?: string | null
          eligibility?: string | null
          image_url?: string | null
          is_active?: boolean | null
          link?: string | null
          opportunity_id?: string
          order_index?: number | null
          title_ar?: string
          title_en?: string | null
          type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      opportunity_applications: {
        Row: {
          applied_at: string | null
          company_id: string
          founder_id: string | null
          id: string
          notes: string | null
          opportunity_id: string
          status: string | null
        }
        Insert: {
          applied_at?: string | null
          company_id: string
          founder_id?: string | null
          id?: string
          notes?: string | null
          opportunity_id: string
          status?: string | null
        }
        Update: {
          applied_at?: string | null
          company_id?: string
          founder_id?: string | null
          id?: string
          notes?: string | null
          opportunity_id?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_applications_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "opportunity_applications_founder_id_fkey"
            columns: ["founder_id"]
            isOneToOne: false
            referencedRelation: "founders"
            referencedColumns: ["founder_id"]
          },
          {
            foreignKeyName: "opportunity_applications_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["opportunity_id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_color: string | null
          avatar_url: string | null
          full_name: string | null
          id: string
          updated_at: string | null
        }
        Insert: {
          avatar_color?: string | null
          avatar_url?: string | null
          full_name?: string | null
          id: string
          updated_at?: string | null
        }
        Update: {
          avatar_color?: string | null
          avatar_url?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      program_participations: {
        Row: {
          company_id: string
          created_at: string | null
          end_date: string | null
          event_id: string | null
          graduation_status: string | null
          id: string
          notes: string | null
          program_id: string
          start_date: string | null
          updated_at: string | null
        }
        Insert: {
          company_id: string
          created_at?: string | null
          end_date?: string | null
          event_id?: string | null
          graduation_status?: string | null
          id?: string
          notes?: string | null
          program_id: string
          start_date?: string | null
          updated_at?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string | null
          end_date?: string | null
          event_id?: string | null
          graduation_status?: string | null
          id?: string
          notes?: string | null
          program_id?: string
          start_date?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "program_participations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["company_id"]
          },
          {
            foreignKeyName: "program_participations_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "program_participations_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["program_id"]
          },
        ]
      }
      programs: {
        Row: {
          created_at: string | null
          description: string | null
          name: string
          name_ar: string | null
          program_id: string
          program_type: string | null
          status: string | null
          updated_at: string | null
          year: number | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          name: string
          name_ar?: string | null
          program_id?: string
          program_type?: string | null
          status?: string | null
          updated_at?: string | null
          year?: number | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          name?: string
          name_ar?: string | null
          program_id?: string
          program_type?: string | null
          status?: string | null
          updated_at?: string | null
          year?: number | null
        }
        Relationships: []
      }
      project_managers: {
        Row: {
          added_at: string | null
          added_by: string | null
          assigned_at: string
          assigned_by: string | null
          event_id: string
          id: string
          project_id: string | null
          role_in_project: string
          user_id: string
        }
        Insert: {
          added_at?: string | null
          added_by?: string | null
          assigned_at?: string
          assigned_by?: string | null
          event_id: string
          id?: string
          project_id?: string | null
          role_in_project?: string
          user_id: string
        }
        Update: {
          added_at?: string | null
          added_by?: string | null
          assigned_at?: string
          assigned_by?: string | null
          event_id?: string
          id?: string
          project_id?: string | null
          role_in_project?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_managers_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["event_id"]
          },
          {
            foreignKeyName: "project_managers_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["event_id"]
          },
        ]
      }
      roles: {
        Row: {
          description: string | null
          id: string
          key: string
          name_ar: string
          name_en: string
        }
        Insert: {
          description?: string | null
          id?: string
          key: string
          name_ar: string
          name_en: string
        }
        Update: {
          description?: string | null
          id?: string
          key?: string
          name_ar?: string
          name_en?: string
        }
        Relationships: []
      }
      smtp_settings: {
        Row: {
          created_at: string
          id: number
          smtp_host: string
          smtp_pass: string
          smtp_port: number
          smtp_user: string
        }
        Insert: {
          created_at?: string
          id?: never
          smtp_host?: string
          smtp_pass: string
          smtp_port?: number
          smtp_user: string
        }
        Update: {
          created_at?: string
          id?: never
          smtp_host?: string
          smtp_pass?: string
          smtp_port?: number
          smtp_user?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          assigned_at: string
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          assigned_at?: string
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          assigned_at?: string
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_user_roles: { Args: { p_user_id: string }; Returns: string[] }
      has_role: {
        Args: { check_user_id?: string; role_name: string }
        Returns: boolean
      }
      is_project_manager: {
        Args: { check_event_id: string; check_user_id?: string }
        Returns: boolean
      }
      is_project_owner: {
        Args: { check_event_id: string; check_user_id?: string }
        Returns: boolean
      }
      is_super_admin: { Args: { check_user_id?: string }; Returns: boolean }
    }
    Enums: {
      app_role: "super_admin" | "project_manager" | "alumni_manager" | "founder"
      project_role: "owner" | "collaborator"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["super_admin", "project_manager", "alumni_manager", "founder"],
      project_role: ["owner", "collaborator"],
    },
  },
} as const
