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
      action_logs: {
        Row: {
          account_id: string | null
          created_at: string
          id: string
          item_id: string | null
          message: string | null
          payload: Json | null
          status: string
          type: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          id?: string
          item_id?: string | null
          message?: string | null
          payload?: Json | null
          status?: string
          type: string
          user_id: string
        }
        Update: {
          account_id?: string | null
          created_at?: string
          id?: string
          item_id?: string | null
          message?: string | null
          payload?: Json | null
          status?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "action_logs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "vinted_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_logs_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "vinted_items"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          plan: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          plan?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          plan?: string
          updated_at?: string
        }
        Relationships: []
      }
      tasks: {
        Row: {
          account_id: string
          attempts: number
          completed_at: string | null
          created_at: string
          id: string
          payload: Json
          result: Json | null
          scheduled_for: string
          status: string
          type: string
          user_id: string
        }
        Insert: {
          account_id: string
          attempts?: number
          completed_at?: string | null
          created_at?: string
          id?: string
          payload?: Json
          result?: Json | null
          scheduled_for?: string
          status?: string
          type: string
          user_id: string
        }
        Update: {
          account_id?: string
          attempts?: number
          completed_at?: string | null
          created_at?: string
          id?: string
          payload?: Json
          result?: Json | null
          scheduled_for?: string
          status?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "vinted_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      vinted_accounts: {
        Row: {
          country: string
          created_at: string
          id: string
          label: string
          last_sync_at: string | null
          status: string
          updated_at: string
          user_id: string
          vinted_user_id: string | null
          vinted_username: string | null
        }
        Insert: {
          country?: string
          created_at?: string
          id?: string
          label: string
          last_sync_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
          vinted_user_id?: string | null
          vinted_username?: string | null
        }
        Update: {
          country?: string
          created_at?: string
          id?: string
          label?: string
          last_sync_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          vinted_user_id?: string | null
          vinted_username?: string | null
        }
        Relationships: []
      }
      vinted_items: {
        Row: {
          account_id: string
          brand: string | null
          created_at: string
          created_at_vinted: string | null
          currency: string | null
          description: string | null
          favourite_count: number | null
          id: string
          last_bumped_at: string | null
          photo_url: string | null
          photo_urls: Json
          price: number | null
          raw: Json | null
          size_title: string | null
          status: string | null
          title: string | null
          updated_at: string
          url: string | null
          user_id: string
          views: number | null
          vinted_item_id: string
        }
        Insert: {
          account_id: string
          brand?: string | null
          created_at?: string
          created_at_vinted?: string | null
          currency?: string | null
          description?: string | null
          favourite_count?: number | null
          id?: string
          last_bumped_at?: string | null
          photo_url?: string | null
          photo_urls?: Json
          price?: number | null
          raw?: Json | null
          size_title?: string | null
          status?: string | null
          title?: string | null
          updated_at?: string
          url?: string | null
          user_id: string
          views?: number | null
          vinted_item_id: string
        }
        Update: {
          account_id?: string
          brand?: string | null
          created_at?: string
          created_at_vinted?: string | null
          currency?: string | null
          description?: string | null
          favourite_count?: number | null
          id?: string
          last_bumped_at?: string | null
          photo_url?: string | null
          photo_urls?: Json
          price?: number | null
          raw?: Json | null
          size_title?: string | null
          status?: string | null
          title?: string | null
          updated_at?: string
          url?: string | null
          user_id?: string
          views?: number | null
          vinted_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vinted_items_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "vinted_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      vinted_tokens: {
        Row: {
          access_token: string
          created_at: string
          expires_at: string | null
          id: string
          raw_cookies: string | null
          refresh_token: string | null
          token_type: string | null
          updated_at: string
          user_agent: string | null
          user_id: string
          vinted_domain: string
          vinted_user_id: string
          vinted_username: string
        }
        Insert: {
          access_token: string
          created_at?: string
          expires_at?: string | null
          id?: string
          raw_cookies?: string | null
          refresh_token?: string | null
          token_type?: string | null
          updated_at?: string
          user_agent?: string | null
          user_id: string
          vinted_domain?: string
          vinted_user_id: string
          vinted_username?: string
        }
        Update: {
          access_token?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          raw_cookies?: string | null
          refresh_token?: string | null
          token_type?: string | null
          updated_at?: string
          user_agent?: string | null
          user_id?: string
          vinted_domain?: string
          vinted_user_id?: string
          vinted_username?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
