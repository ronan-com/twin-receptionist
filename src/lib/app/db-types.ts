// Row shapes of Answered's original database, kept as the UI contract (types only).
// Our server returns JSON in these shapes. Copied from the Answered snapshot.
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
      ai_agents: {
        Row: {
          accent: string | null
          after_hours_message: string | null
          booking_rules: Json
          business_context: string | null
          business_hours_behaviour: Json
          business_id: string
          created_at: string
          escalation_rules: Json
          fallback_model: string | null
          greeting: string | null
          id: string
          interruption_settings: Json
          language: string
          last_published_at: string | null
          latency_settings: Json
          llm_model: string | null
          max_duration_seconds: number | null
          name: string
          personality: string | null
          provider: Database["public"]["Enums"]["provider_kind"] | null
          provider_agent_id: string | null
          provider_config_id: string | null
          qualification_questions: Json
          restricted_topics: Json
          routing_status: string
          speaking_speed: number
          status: Database["public"]["Enums"]["agent_status"]
          system_prompt: string | null
          temperature: number | null
          tone: string | null
          tool_permissions: Json
          transfer_number: string | null
          transfer_rules: Json
          updated_at: string
          voice_id: string | null
          voicemail_behaviour: Json
        }
        Insert: {
          accent?: string | null
          after_hours_message?: string | null
          booking_rules?: Json
          business_context?: string | null
          business_hours_behaviour?: Json
          business_id: string
          created_at?: string
          escalation_rules?: Json
          fallback_model?: string | null
          greeting?: string | null
          id?: string
          interruption_settings?: Json
          language?: string
          last_published_at?: string | null
          latency_settings?: Json
          llm_model?: string | null
          max_duration_seconds?: number | null
          name?: string
          personality?: string | null
          provider?: Database["public"]["Enums"]["provider_kind"] | null
          provider_agent_id?: string | null
          provider_config_id?: string | null
          qualification_questions?: Json
          restricted_topics?: Json
          routing_status?: string
          speaking_speed?: number
          status?: Database["public"]["Enums"]["agent_status"]
          system_prompt?: string | null
          temperature?: number | null
          tone?: string | null
          tool_permissions?: Json
          transfer_number?: string | null
          transfer_rules?: Json
          updated_at?: string
          voice_id?: string | null
          voicemail_behaviour?: Json
        }
        Update: {
          accent?: string | null
          after_hours_message?: string | null
          booking_rules?: Json
          business_context?: string | null
          business_hours_behaviour?: Json
          business_id?: string
          created_at?: string
          escalation_rules?: Json
          fallback_model?: string | null
          greeting?: string | null
          id?: string
          interruption_settings?: Json
          language?: string
          last_published_at?: string | null
          latency_settings?: Json
          llm_model?: string | null
          max_duration_seconds?: number | null
          name?: string
          personality?: string | null
          provider?: Database["public"]["Enums"]["provider_kind"] | null
          provider_agent_id?: string | null
          provider_config_id?: string | null
          qualification_questions?: Json
          restricted_topics?: Json
          routing_status?: string
          speaking_speed?: number
          status?: Database["public"]["Enums"]["agent_status"]
          system_prompt?: string | null
          temperature?: number | null
          tone?: string | null
          tool_permissions?: Json
          transfer_number?: string | null
          transfer_rules?: Json
          updated_at?: string
          voice_id?: string | null
          voicemail_behaviour?: Json
        }
        Relationships: [
          {
            foreignKeyName: "ai_agents_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_agents_provider_config_id_fkey"
            columns: ["provider_config_id"]
            isOneToOne: false
            referencedRelation: "provider_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_agents_voice_id_fkey"
            columns: ["voice_id"]
            isOneToOne: false
            referencedRelation: "voices"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          business_id: string
          call_id: string | null
          contact_id: string | null
          created_at: string
          customer_email: string | null
          customer_name: string | null
          customer_phone: string | null
          ends_at: string | null
          external_ref: string | null
          id: string
          integration_id: string | null
          location: string | null
          notes: string | null
          reason: string | null
          service: string | null
          source: string
          staff_name: string | null
          starts_at: string
          status: Database["public"]["Enums"]["appointment_status"]
          sync_status: string
          updated_at: string
        }
        Insert: {
          business_id: string
          call_id?: string | null
          contact_id?: string | null
          created_at?: string
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          ends_at?: string | null
          external_ref?: string | null
          id?: string
          integration_id?: string | null
          location?: string | null
          notes?: string | null
          reason?: string | null
          service?: string | null
          source?: string
          staff_name?: string | null
          starts_at: string
          status?: Database["public"]["Enums"]["appointment_status"]
          sync_status?: string
          updated_at?: string
        }
        Update: {
          business_id?: string
          call_id?: string | null
          contact_id?: string | null
          created_at?: string
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          ends_at?: string | null
          external_ref?: string | null
          id?: string
          integration_id?: string | null
          location?: string | null
          notes?: string | null
          reason?: string | null
          service?: string | null
          source?: string
          staff_name?: string | null
          starts_at?: string
          status?: Database["public"]["Enums"]["appointment_status"]
          sync_status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          business_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json
          summary: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          business_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          metadata?: Json
          summary?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          business_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          metadata?: Json
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      business_memberships: {
        Row: {
          business_id: string
          created_at: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["membership_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["membership_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["membership_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_memberships_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_memberships_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      businesses: {
        Row: {
          address_line1: string | null
          business_hours: Json
          city: string | null
          country: string | null
          created_at: string
          created_by: string | null
          default_transfer_number: string | null
          email: string | null
          id: string
          industry: string | null
          is_demo: boolean
          name: string
          notification_prefs: Json
          phone: string | null
          postal_code: string | null
          recording_policy: Json
          region: string | null
          slug: string
          status: string
          timezone: string
          updated_at: string
          website: string | null
        }
        Insert: {
          address_line1?: string | null
          business_hours?: Json
          city?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          default_transfer_number?: string | null
          email?: string | null
          id?: string
          industry?: string | null
          is_demo?: boolean
          name: string
          notification_prefs?: Json
          phone?: string | null
          postal_code?: string | null
          recording_policy?: Json
          region?: string | null
          slug: string
          status?: string
          timezone?: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          address_line1?: string | null
          business_hours?: Json
          city?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          default_transfer_number?: string | null
          email?: string | null
          id?: string
          industry?: string | null
          is_demo?: boolean
          name?: string
          notification_prefs?: Json
          phone?: string | null
          postal_code?: string | null
          recording_policy?: Json
          region?: string | null
          slug?: string
          status?: string
          timezone?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      call_events: {
        Row: {
          business_id: string
          call_id: string
          created_at: string
          id: string
          message: string | null
          occurred_at: string
          payload: Json
          severity: Database["public"]["Enums"]["event_severity"]
          type: string
        }
        Insert: {
          business_id: string
          call_id: string
          created_at?: string
          id?: string
          message?: string | null
          occurred_at?: string
          payload?: Json
          severity?: Database["public"]["Enums"]["event_severity"]
          type: string
        }
        Update: {
          business_id?: string
          call_id?: string
          created_at?: string
          id?: string
          message?: string | null
          occurred_at?: string
          payload?: Json
          severity?: Database["public"]["Enums"]["event_severity"]
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_events_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
        ]
      }
      calls: {
        Row: {
          after_hours: boolean
          agent_id: string | null
          ai_handled: boolean
          answered_at: string | null
          business_id: string
          confidence: number | null
          contact_id: string | null
          cost_cents: number | null
          created_at: string
          direction: Database["public"]["Enums"]["call_direction"]
          duration_seconds: number
          ended_at: string | null
          error_code: string | null
          error_message: string | null
          from_number: string | null
          id: string
          intent: string | null
          metadata: Json
          outcome: Database["public"]["Enums"]["call_outcome"] | null
          phone_number_id: string | null
          provider: Database["public"]["Enums"]["provider_kind"] | null
          provider_call_id: string | null
          qa_notes: string | null
          qa_reviewed_at: string | null
          qa_reviewed_by: string | null
          qa_status: Database["public"]["Enums"]["qa_status"]
          sentiment: Database["public"]["Enums"]["call_sentiment"] | null
          started_at: string
          status: Database["public"]["Enums"]["call_status"]
          summary: string | null
          talk_time_seconds: number
          to_number: string | null
          transfer_target: string | null
          transferred: boolean
          updated_at: string
        }
        Insert: {
          after_hours?: boolean
          agent_id?: string | null
          ai_handled?: boolean
          answered_at?: string | null
          business_id: string
          confidence?: number | null
          contact_id?: string | null
          cost_cents?: number | null
          created_at?: string
          direction?: Database["public"]["Enums"]["call_direction"]
          duration_seconds?: number
          ended_at?: string | null
          error_code?: string | null
          error_message?: string | null
          from_number?: string | null
          id?: string
          intent?: string | null
          metadata?: Json
          outcome?: Database["public"]["Enums"]["call_outcome"] | null
          phone_number_id?: string | null
          provider?: Database["public"]["Enums"]["provider_kind"] | null
          provider_call_id?: string | null
          qa_notes?: string | null
          qa_reviewed_at?: string | null
          qa_reviewed_by?: string | null
          qa_status?: Database["public"]["Enums"]["qa_status"]
          sentiment?: Database["public"]["Enums"]["call_sentiment"] | null
          started_at?: string
          status?: Database["public"]["Enums"]["call_status"]
          summary?: string | null
          talk_time_seconds?: number
          to_number?: string | null
          transfer_target?: string | null
          transferred?: boolean
          updated_at?: string
        }
        Update: {
          after_hours?: boolean
          agent_id?: string | null
          ai_handled?: boolean
          answered_at?: string | null
          business_id?: string
          confidence?: number | null
          contact_id?: string | null
          cost_cents?: number | null
          created_at?: string
          direction?: Database["public"]["Enums"]["call_direction"]
          duration_seconds?: number
          ended_at?: string | null
          error_code?: string | null
          error_message?: string | null
          from_number?: string | null
          id?: string
          intent?: string | null
          metadata?: Json
          outcome?: Database["public"]["Enums"]["call_outcome"] | null
          phone_number_id?: string | null
          provider?: Database["public"]["Enums"]["provider_kind"] | null
          provider_call_id?: string | null
          qa_notes?: string | null
          qa_reviewed_at?: string | null
          qa_reviewed_by?: string | null
          qa_status?: Database["public"]["Enums"]["qa_status"]
          sentiment?: Database["public"]["Enums"]["call_sentiment"] | null
          started_at?: string
          status?: Database["public"]["Enums"]["call_status"]
          summary?: string | null
          talk_time_seconds?: number
          to_number?: string | null
          transfer_target?: string | null
          transferred?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "calls_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_phone_number_id_fkey"
            columns: ["phone_number_id"]
            isOneToOne: false
            referencedRelation: "phone_numbers"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          business_id: string
          company: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          last_seen_at: string | null
          notes: string | null
          phone: string | null
          tags: string[]
          updated_at: string
        }
        Insert: {
          business_id: string
          company?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          last_seen_at?: string | null
          notes?: string | null
          phone?: string | null
          tags?: string[]
          updated_at?: string
        }
        Update: {
          business_id?: string
          company?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          last_seen_at?: string | null
          notes?: string | null
          phone?: string | null
          tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_events: {
        Row: {
          business_id: string
          created_at: string
          id: string
          integration_id: string
          message: string | null
          occurred_at: string
          payload: Json
          severity: Database["public"]["Enums"]["event_severity"]
          type: string
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          integration_id: string
          message?: string | null
          occurred_at?: string
          payload?: Json
          severity?: Database["public"]["Enums"]["event_severity"]
          type: string
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          integration_id?: string
          message?: string | null
          occurred_at?: string
          payload?: Json
          severity?: Database["public"]["Enums"]["event_severity"]
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_events_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      integrations: {
        Row: {
          business_id: string
          config: Json
          connected_at: string | null
          connected_by: string | null
          created_at: string
          display_name: string | null
          id: string
          last_error: string | null
          last_sync_at: string | null
          provider: string
          status: Database["public"]["Enums"]["integration_status"]
          updated_at: string
        }
        Insert: {
          business_id: string
          config?: Json
          connected_at?: string | null
          connected_by?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          last_error?: string | null
          last_sync_at?: string | null
          provider: string
          status?: Database["public"]["Enums"]["integration_status"]
          updated_at?: string
        }
        Update: {
          business_id?: string
          config?: Json
          connected_at?: string | null
          connected_by?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          last_error?: string | null
          last_sync_at?: string | null
          provider?: string
          status?: Database["public"]["Enums"]["integration_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "integrations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      internal_admins: {
        Row: {
          created_at: string
          granted_by: string | null
          id: string
          notes: string | null
          role: Database["public"]["Enums"]["internal_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          id?: string
          notes?: string | null
          role?: Database["public"]["Enums"]["internal_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          id?: string
          notes?: string | null
          role?: Database["public"]["Enums"]["internal_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "internal_admins_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          business_id: string
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["membership_role"]
          status: Database["public"]["Enums"]["invitation_status"]
          token: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          business_id: string
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["membership_role"]
          status?: Database["public"]["Enums"]["invitation_status"]
          token?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          business_id?: string
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["membership_role"]
          status?: Database["public"]["Enums"]["invitation_status"]
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount_cents: number
          business_id: string
          created_at: string
          currency: string
          due_at: string | null
          external_ref: string | null
          id: string
          issued_at: string | null
          line_items: Json
          number: string | null
          paid_at: string | null
          period_end: string | null
          period_start: string | null
          status: string
          subscription_id: string | null
          updated_at: string
        }
        Insert: {
          amount_cents?: number
          business_id: string
          created_at?: string
          currency?: string
          due_at?: string | null
          external_ref?: string | null
          id?: string
          issued_at?: string | null
          line_items?: Json
          number?: string | null
          paid_at?: string | null
          period_end?: string | null
          period_start?: string | null
          status?: string
          subscription_id?: string | null
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          business_id?: string
          created_at?: string
          currency?: string
          due_at?: string | null
          external_ref?: string | null
          id?: string
          issued_at?: string | null
          line_items?: Json
          number?: string | null
          paid_at?: string | null
          period_end?: string | null
          period_start?: string | null
          status?: string
          subscription_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_base_items: {
        Row: {
          answer: string | null
          business_id: string
          content: string | null
          created_at: string
          created_by: string | null
          id: string
          metadata: Json
          question: string | null
          source: string
          status: Database["public"]["Enums"]["knowledge_status"]
          tags: string[]
          title: string
          type: Database["public"]["Enums"]["knowledge_type"]
          updated_at: string
          url: string | null
        }
        Insert: {
          answer?: string | null
          business_id: string
          content?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          metadata?: Json
          question?: string | null
          source?: string
          status?: Database["public"]["Enums"]["knowledge_status"]
          tags?: string[]
          title: string
          type?: Database["public"]["Enums"]["knowledge_type"]
          updated_at?: string
          url?: string | null
        }
        Update: {
          answer?: string | null
          business_id?: string
          content?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          metadata?: Json
          question?: string | null
          source?: string
          status?: Database["public"]["Enums"]["knowledge_status"]
          tags?: string[]
          title?: string
          type?: Database["public"]["Enums"]["knowledge_type"]
          updated_at?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_base_items_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          assigned_to: string | null
          business_id: string
          call_id: string | null
          contact_id: string | null
          created_at: string
          email: string | null
          enquiry: string | null
          follow_up_at: string | null
          follow_up_status: string
          id: string
          intent: string | null
          name: string | null
          phone: string | null
          qualification: Json
          stage: Database["public"]["Enums"]["lead_stage"]
          summary: string | null
          updated_at: string
          value_cents: number | null
        }
        Insert: {
          assigned_to?: string | null
          business_id: string
          call_id?: string | null
          contact_id?: string | null
          created_at?: string
          email?: string | null
          enquiry?: string | null
          follow_up_at?: string | null
          follow_up_status?: string
          id?: string
          intent?: string | null
          name?: string | null
          phone?: string | null
          qualification?: Json
          stage?: Database["public"]["Enums"]["lead_stage"]
          summary?: string | null
          updated_at?: string
          value_cents?: number | null
        }
        Update: {
          assigned_to?: string | null
          business_id?: string
          call_id?: string | null
          contact_id?: string | null
          created_at?: string
          email?: string | null
          enquiry?: string | null
          follow_up_at?: string | null
          follow_up_status?: string
          id?: string
          intent?: string | null
          name?: string | null
          phone?: string | null
          qualification?: Json
          stage?: Database["public"]["Enums"]["lead_stage"]
          summary?: string | null
          updated_at?: string
          value_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      phone_numbers: {
        Row: {
          agent_id: string | null
          business_hours: Json
          business_id: string | null
          capabilities: Json
          country: string | null
          created_at: string
          e164: string
          fallback_number: string | null
          forward_to: string | null
          friendly_name: string | null
          health: string
          id: string
          is_outbound_caller_id: boolean
          last_health_check_at: string | null
          monthly_usage_minutes: number
          notes: string | null
          provider: Database["public"]["Enums"]["provider_kind"]
          provider_number_id: string | null
          routing_mode: Database["public"]["Enums"]["phone_routing_mode"]
          status: Database["public"]["Enums"]["phone_number_status"]
          updated_at: string
        }
        Insert: {
          agent_id?: string | null
          business_hours?: Json
          business_id?: string | null
          capabilities?: Json
          country?: string | null
          created_at?: string
          e164: string
          fallback_number?: string | null
          forward_to?: string | null
          friendly_name?: string | null
          health?: string
          id?: string
          is_outbound_caller_id?: boolean
          last_health_check_at?: string | null
          monthly_usage_minutes?: number
          notes?: string | null
          provider?: Database["public"]["Enums"]["provider_kind"]
          provider_number_id?: string | null
          routing_mode?: Database["public"]["Enums"]["phone_routing_mode"]
          status?: Database["public"]["Enums"]["phone_number_status"]
          updated_at?: string
        }
        Update: {
          agent_id?: string | null
          business_hours?: Json
          business_id?: string | null
          capabilities?: Json
          country?: string | null
          created_at?: string
          e164?: string
          fallback_number?: string | null
          forward_to?: string | null
          friendly_name?: string | null
          health?: string
          id?: string
          is_outbound_caller_id?: boolean
          last_health_check_at?: string | null
          monthly_usage_minutes?: number
          notes?: string | null
          provider?: Database["public"]["Enums"]["provider_kind"]
          provider_number_id?: string | null
          routing_mode?: Database["public"]["Enums"]["phone_routing_mode"]
          status?: Database["public"]["Enums"]["phone_number_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "phone_numbers_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phone_numbers_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          billing_interval: string
          code: string
          created_at: string
          currency: string
          features: Json
          id: string
          included_minutes: number
          included_numbers: number
          included_sms: number
          is_active: boolean
          name: string
          overage_minute_cents: number
          price_cents: number
          updated_at: string
        }
        Insert: {
          billing_interval?: string
          code: string
          created_at?: string
          currency?: string
          features?: Json
          id?: string
          included_minutes?: number
          included_numbers?: number
          included_sms?: number
          is_active?: boolean
          name: string
          overage_minute_cents?: number
          price_cents?: number
          updated_at?: string
        }
        Update: {
          billing_interval?: string
          code?: string
          created_at?: string
          currency?: string
          features?: Json
          id?: string
          included_minutes?: number
          included_numbers?: number
          included_sms?: number
          is_active?: boolean
          name?: string
          overage_minute_cents?: number
          price_cents?: number
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          timezone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          timezone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          timezone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      provider_configs: {
        Row: {
          account_ref: string | null
          business_id: string | null
          capabilities: Json
          created_at: string
          credentials_set: boolean
          id: string
          last_checked_at: string | null
          last_error: string | null
          name: string
          provider: Database["public"]["Enums"]["provider_kind"]
          region: string | null
          settings: Json
          status: Database["public"]["Enums"]["provider_status"]
          updated_at: string
        }
        Insert: {
          account_ref?: string | null
          business_id?: string | null
          capabilities?: Json
          created_at?: string
          credentials_set?: boolean
          id?: string
          last_checked_at?: string | null
          last_error?: string | null
          name: string
          provider: Database["public"]["Enums"]["provider_kind"]
          region?: string | null
          settings?: Json
          status?: Database["public"]["Enums"]["provider_status"]
          updated_at?: string
        }
        Update: {
          account_ref?: string | null
          business_id?: string | null
          capabilities?: Json
          created_at?: string
          credentials_set?: boolean
          id?: string
          last_checked_at?: string | null
          last_error?: string | null
          name?: string
          provider?: Database["public"]["Enums"]["provider_kind"]
          region?: string | null
          settings?: Json
          status?: Database["public"]["Enums"]["provider_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_configs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      recordings: {
        Row: {
          business_id: string
          call_id: string
          created_at: string
          duration_seconds: number | null
          expires_at: string | null
          format: string | null
          id: string
          provider: Database["public"]["Enums"]["provider_kind"] | null
          provider_recording_id: string | null
          size_bytes: number | null
          status: string
          url: string | null
        }
        Insert: {
          business_id: string
          call_id: string
          created_at?: string
          duration_seconds?: number | null
          expires_at?: string | null
          format?: string | null
          id?: string
          provider?: Database["public"]["Enums"]["provider_kind"] | null
          provider_recording_id?: string | null
          size_bytes?: number | null
          status?: string
          url?: string | null
        }
        Update: {
          business_id?: string
          call_id?: string
          created_at?: string
          duration_seconds?: number | null
          expires_at?: string | null
          format?: string | null
          id?: string
          provider?: Database["public"]["Enums"]["provider_kind"] | null
          provider_recording_id?: string | null
          size_bytes?: number | null
          status?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recordings_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recordings_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          business_id: string
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          external_customer_ref: string | null
          external_subscription_ref: string | null
          id: string
          plan_id: string | null
          seats: number
          status: Database["public"]["Enums"]["subscription_status"]
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          external_customer_ref?: string | null
          external_subscription_ref?: string | null
          id?: string
          plan_id?: string | null
          seats?: number
          status?: Database["public"]["Enums"]["subscription_status"]
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          external_customer_ref?: string | null
          external_subscription_ref?: string | null
          id?: string
          plan_id?: string | null
          seats?: number
          status?: Database["public"]["Enums"]["subscription_status"]
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      system_incidents: {
        Row: {
          business_id: string | null
          created_at: string
          details: string | null
          id: string
          resolved_at: string | null
          severity: Database["public"]["Enums"]["event_severity"]
          source: string | null
          started_at: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          business_id?: string | null
          created_at?: string
          details?: string | null
          id?: string
          resolved_at?: string | null
          severity?: Database["public"]["Enums"]["event_severity"]
          source?: string | null
          started_at?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          business_id?: string | null
          created_at?: string
          details?: string | null
          id?: string
          resolved_at?: string | null
          severity?: Database["public"]["Enums"]["event_severity"]
          source?: string | null
          started_at?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "system_incidents_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      transcript_segments: {
        Row: {
          business_id: string
          call_id: string
          confidence: number | null
          created_at: string
          ended_ms: number | null
          id: string
          seq: number
          speaker: string
          started_ms: number | null
          text: string
        }
        Insert: {
          business_id: string
          call_id: string
          confidence?: number | null
          created_at?: string
          ended_ms?: number | null
          id?: string
          seq: number
          speaker?: string
          started_ms?: number | null
          text: string
        }
        Update: {
          business_id?: string
          call_id?: string
          confidence?: number | null
          created_at?: string
          ended_ms?: number | null
          id?: string
          seq?: number
          speaker?: string
          started_ms?: number | null
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "transcript_segments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transcript_segments_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
        ]
      }
      unanswered_questions: {
        Row: {
          business_id: string
          call_id: string | null
          confidence: number | null
          created_at: string
          id: string
          knowledge_item_id: string | null
          occurrences: number
          question: string
          status: string
          updated_at: string
        }
        Insert: {
          business_id: string
          call_id?: string | null
          confidence?: number | null
          created_at?: string
          id?: string
          knowledge_item_id?: string | null
          occurrences?: number
          question: string
          status?: string
          updated_at?: string
        }
        Update: {
          business_id?: string
          call_id?: string | null
          confidence?: number | null
          created_at?: string
          id?: string
          knowledge_item_id?: string | null
          occurrences?: number
          question?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "unanswered_questions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unanswered_questions_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unanswered_questions_knowledge_item_id_fkey"
            columns: ["knowledge_item_id"]
            isOneToOne: false
            referencedRelation: "knowledge_base_items"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_records: {
        Row: {
          business_id: string
          call_id: string | null
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["usage_kind"]
          metadata: Json
          period_end: string
          period_start: string
          quantity: number
          unit: string
        }
        Insert: {
          business_id: string
          call_id?: string | null
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["usage_kind"]
          metadata?: Json
          period_end: string
          period_start: string
          quantity?: number
          unit?: string
        }
        Update: {
          business_id?: string
          call_id?: string | null
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["usage_kind"]
          metadata?: Json
          period_end?: string
          period_start?: string
          quantity?: number
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_records_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_records_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_configs: {
        Row: {
          agent_id: string
          business_id: string
          created_at: string
          id: string
          pitch: number | null
          provider: Database["public"]["Enums"]["provider_kind"]
          provider_voice_id: string | null
          settings: Json
          similarity: number | null
          speed: number | null
          stability: number | null
          status: Database["public"]["Enums"]["provider_status"]
          updated_at: string
          voice_id: string | null
        }
        Insert: {
          agent_id: string
          business_id: string
          created_at?: string
          id?: string
          pitch?: number | null
          provider: Database["public"]["Enums"]["provider_kind"]
          provider_voice_id?: string | null
          settings?: Json
          similarity?: number | null
          speed?: number | null
          stability?: number | null
          status?: Database["public"]["Enums"]["provider_status"]
          updated_at?: string
          voice_id?: string | null
        }
        Update: {
          agent_id?: string
          business_id?: string
          created_at?: string
          id?: string
          pitch?: number | null
          provider?: Database["public"]["Enums"]["provider_kind"]
          provider_voice_id?: string | null
          settings?: Json
          similarity?: number | null
          speed?: number | null
          stability?: number | null
          status?: Database["public"]["Enums"]["provider_status"]
          updated_at?: string
          voice_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "voice_configs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: true
            referencedRelation: "ai_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_configs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_configs_voice_id_fkey"
            columns: ["voice_id"]
            isOneToOne: false
            referencedRelation: "voices"
            referencedColumns: ["id"]
          },
        ]
      }
      voices: {
        Row: {
          accent: string | null
          client_visible: boolean
          created_at: string
          description: string | null
          display_name: string
          gender: string | null
          id: string
          language: string
          preview_url: string | null
          provider: Database["public"]["Enums"]["provider_kind"]
          provider_voice_id: string | null
          status: string
          style: string | null
          updated_at: string
        }
        Insert: {
          accent?: string | null
          client_visible?: boolean
          created_at?: string
          description?: string | null
          display_name: string
          gender?: string | null
          id?: string
          language?: string
          preview_url?: string | null
          provider: Database["public"]["Enums"]["provider_kind"]
          provider_voice_id?: string | null
          status?: string
          style?: string | null
          updated_at?: string
        }
        Update: {
          accent?: string | null
          client_visible?: boolean
          created_at?: string
          description?: string | null
          display_name?: string
          gender?: string | null
          id?: string
          language?: string
          preview_url?: string | null
          provider?: Database["public"]["Enums"]["provider_kind"]
          provider_voice_id?: string | null
          status?: string
          style?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      business_role: {
        Args: { _business_id: string; _user_id: string }
        Returns: Database["public"]["Enums"]["membership_role"]
      }
      can_edit_business: {
        Args: { _business_id: string; _user_id: string }
        Returns: boolean
      }
      can_manage_business: {
        Args: { _business_id: string; _user_id: string }
        Returns: boolean
      }
      create_business: {
        Args: {
          _industry?: string
          _name: string
          _phone?: string
          _timezone?: string
          _website?: string
        }
        Returns: string
      }
      ensure_profile: { Args: never; Returns: Json }
      grant_internal_admin: {
        Args: {
          _email: string
          _role?: Database["public"]["Enums"]["internal_role"]
        }
        Returns: string
      }
      has_business_access: {
        Args: { _business_id: string; _user_id: string }
        Returns: boolean
      }
      invite_member: {
        Args: {
          _business_id: string
          _email: string
          _role?: Database["public"]["Enums"]["membership_role"]
        }
        Returns: string
      }
      is_internal_admin: { Args: { _user_id: string }; Returns: boolean }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      revoke_internal_admin: { Args: { _user_id: string }; Returns: undefined }
      shares_business: { Args: { _a: string; _b: string }; Returns: boolean }
    }
    Enums: {
      agent_status: "draft" | "active" | "paused" | "disabled"
      appointment_status:
        | "pending"
        | "confirmed"
        | "completed"
        | "cancelled"
        | "no_show"
      call_direction: "inbound" | "outbound"
      call_outcome:
        | "resolved"
        | "booked"
        | "lead_captured"
        | "transferred"
        | "voicemail"
        | "no_answer"
        | "spam"
        | "callback_requested"
        | "unresolved"
      call_sentiment: "positive" | "neutral" | "negative"
      call_status:
        | "queued"
        | "ringing"
        | "in_progress"
        | "completed"
        | "missed"
        | "failed"
        | "voicemail"
        | "cancelled"
      event_severity: "info" | "warning" | "error"
      integration_status:
        | "available"
        | "not_connected"
        | "connected"
        | "error"
        | "coming_soon"
      internal_role: "super_admin" | "support"
      invitation_status: "pending" | "accepted" | "revoked" | "expired"
      knowledge_status: "draft" | "published" | "archived"
      knowledge_type:
        | "faq"
        | "service"
        | "pricing"
        | "policy"
        | "location"
        | "fact"
        | "url"
        | "document"
        | "custom_qa"
      lead_stage:
        | "new"
        | "contacted"
        | "qualified"
        | "proposal"
        | "won"
        | "lost"
      membership_role: "owner" | "admin" | "staff" | "read_only"
      phone_number_status:
        | "active"
        | "pending"
        | "unassigned"
        | "suspended"
        | "released"
      phone_routing_mode:
        | "ai_receptionist"
        | "forward"
        | "ai_after_hours"
        | "voicemail"
        | "disabled"
      provider_kind:
        | "twilio"
        | "telnyx"
        | "vapi"
        | "retell"
        | "elevenlabs"
        | "custom"
      provider_status:
        | "not_connected"
        | "configured"
        | "active"
        | "error"
        | "disabled"
      qa_status: "unreviewed" | "passed" | "needs_review" | "failed"
      subscription_status:
        | "trialing"
        | "active"
        | "past_due"
        | "cancelled"
        | "paused"
      usage_kind:
        | "call_minutes"
        | "ai_tokens"
        | "sms"
        | "phone_number"
        | "transfer_minutes"
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
      agent_status: ["draft", "active", "paused", "disabled"],
      appointment_status: [
        "pending",
        "confirmed",
        "completed",
        "cancelled",
        "no_show",
      ],
      call_direction: ["inbound", "outbound"],
      call_outcome: [
        "resolved",
        "booked",
        "lead_captured",
        "transferred",
        "voicemail",
        "no_answer",
        "spam",
        "callback_requested",
        "unresolved",
      ],
      call_sentiment: ["positive", "neutral", "negative"],
      call_status: [
        "queued",
        "ringing",
        "in_progress",
        "completed",
        "missed",
        "failed",
        "voicemail",
        "cancelled",
      ],
      event_severity: ["info", "warning", "error"],
      integration_status: [
        "available",
        "not_connected",
        "connected",
        "error",
        "coming_soon",
      ],
      internal_role: ["super_admin", "support"],
      invitation_status: ["pending", "accepted", "revoked", "expired"],
      knowledge_status: ["draft", "published", "archived"],
      knowledge_type: [
        "faq",
        "service",
        "pricing",
        "policy",
        "location",
        "fact",
        "url",
        "document",
        "custom_qa",
      ],
      lead_stage: ["new", "contacted", "qualified", "proposal", "won", "lost"],
      membership_role: ["owner", "admin", "staff", "read_only"],
      phone_number_status: [
        "active",
        "pending",
        "unassigned",
        "suspended",
        "released",
      ],
      phone_routing_mode: [
        "ai_receptionist",
        "forward",
        "ai_after_hours",
        "voicemail",
        "disabled",
      ],
      provider_kind: [
        "twilio",
        "telnyx",
        "vapi",
        "retell",
        "elevenlabs",
        "custom",
      ],
      provider_status: [
        "not_connected",
        "configured",
        "active",
        "error",
        "disabled",
      ],
      qa_status: ["unreviewed", "passed", "needs_review", "failed"],
      subscription_status: [
        "trialing",
        "active",
        "past_due",
        "cancelled",
        "paused",
      ],
      usage_kind: [
        "call_minutes",
        "ai_tokens",
        "sms",
        "phone_number",
        "transfer_minutes",
      ],
    },
  },
} as const
