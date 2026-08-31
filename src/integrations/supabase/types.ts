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
      alerts: {
        Row: {
          channel: string
          dispatched_at: string
          dispatched_by: string
          explanation: string
          id: number
          language: string
          message: string
          risk_level: string
          zone_id: number
        }
        Insert: {
          channel?: string
          dispatched_at?: string
          dispatched_by?: string
          explanation: string
          id?: number
          language?: string
          message: string
          risk_level: string
          zone_id: number
        }
        Update: {
          channel?: string
          dispatched_at?: string
          dispatched_by?: string
          explanation?: string
          id?: number
          language?: string
          message?: string
          risk_level?: string
          zone_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "alerts_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "risk_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      historical_landslides: {
        Row: {
          event_date: string
          id: number
          lat: number
          lng: number
          severity: string
          source: string
          zone_id: number | null
        }
        Insert: {
          event_date: string
          id?: number
          lat: number
          lng: number
          severity?: string
          source?: string
          zone_id?: number | null
        }
        Update: {
          event_date?: string
          id?: number
          lat?: number
          lng?: number
          severity?: string
          source?: string
          zone_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "historical_landslides_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "risk_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      risk_zones: {
        Row: {
          centroid_lat: number
          centroid_lng: number
          current_risk_level: string
          district: string
          explanation: string | null
          id: number
          last_computed_at: string
          mean_slope_deg: number
          population: number
          risk_score: number
          state: string
          threshold_e_mm: number
          zone_name: string
        }
        Insert: {
          centroid_lat: number
          centroid_lng: number
          current_risk_level?: string
          district: string
          explanation?: string | null
          id?: number
          last_computed_at?: string
          mean_slope_deg?: number
          population?: number
          risk_score?: number
          state: string
          threshold_e_mm?: number
          zone_name: string
        }
        Update: {
          centroid_lat?: number
          centroid_lng?: number
          current_risk_level?: string
          district?: string
          explanation?: string | null
          id?: number
          last_computed_at?: string
          mean_slope_deg?: number
          population?: number
          risk_score?: number
          state?: string
          threshold_e_mm?: number
          zone_name?: string
        }
        Relationships: []
      }
      road_segments: {
        Row: {
          id: number
          length_km: number
          road_name: string
          segment_label: string
          status: string
          updated_at: string
          zone_id: number
        }
        Insert: {
          id?: number
          length_km?: number
          road_name: string
          segment_label: string
          status?: string
          updated_at?: string
          zone_id: number
        }
        Update: {
          id?: number
          length_km?: number
          road_name?: string
          segment_label?: string
          status?: string
          updated_at?: string
          zone_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "road_segments_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "risk_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      weather_readings: {
        Row: {
          id: number
          rainfall_mm: number
          reading_time: string
          soil_moisture_pct: number | null
          source: string
          station_id: string
          zone_id: number
        }
        Insert: {
          id?: number
          rainfall_mm?: number
          reading_time?: string
          soil_moisture_pct?: number | null
          source?: string
          station_id: string
          zone_id: number
        }
        Update: {
          id?: number
          rainfall_mm?: number
          reading_time?: string
          soil_moisture_pct?: number | null
          source?: string
          station_id?: string
          zone_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "weather_readings_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "risk_zones"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      recompute_risk: { Args: never; Returns: undefined }
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
