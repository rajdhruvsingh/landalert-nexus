export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      alerts: {
        Row: {
          channel: string;
          delivery_attempts: number;
          dispatched_at: string;
          dispatched_by: string;
          explanation: string;
          id: number;
          idempotency_key: string | null;
          language: string;
          last_error: string | null;
          message: string;
          recipient_group: string;
          risk_level: string;
          status: "pending" | "sent" | "delivered" | "failed";
          zone_id: number;
        };
        Insert: {
          channel?: string;
          delivery_attempts?: number;
          dispatched_at?: string;
          dispatched_by?: string;
          explanation: string;
          id?: number;
          idempotency_key?: string | null;
          language?: string;
          last_error?: string | null;
          message: string;
          recipient_group?: string;
          risk_level: string;
          status?: "pending" | "sent" | "delivered" | "failed";
          zone_id: number;
        };
        Update: {
          channel?: string;
          delivery_attempts?: number;
          dispatched_at?: string;
          dispatched_by?: string;
          explanation?: string;
          id?: number;
          idempotency_key?: string | null;
          language?: string;
          last_error?: string | null;
          message?: string;
          recipient_group?: string;
          risk_level?: string;
          status?: "pending" | "sent" | "delivered" | "failed";
          zone_id?: number;
        };
        Relationships: [
          {
            foreignKeyName: "alerts_zone_id_fkey";
            columns: ["zone_id"];
            isOneToOne: false;
            referencedRelation: "risk_zones";
            referencedColumns: ["id"];
          },
        ];
      };
      historical_landslides: {
        Row: {
          event_date: string;
          id: number;
          lat: number;
          lng: number;
          severity: string;
          source: string;
          zone_id: number | null;
        };
        Insert: {
          event_date: string;
          id?: number;
          lat: number;
          lng: number;
          severity?: string;
          source?: string;
          zone_id?: number | null;
        };
        Update: {
          event_date?: string;
          id?: number;
          lat?: number;
          lng?: number;
          severity?: string;
          source?: string;
          zone_id?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "historical_landslides_zone_id_fkey";
            columns: ["zone_id"];
            isOneToOne: false;
            referencedRelation: "risk_zones";
            referencedColumns: ["id"];
          },
        ];
      };
      risk_zones: {
        Row: {
          centroid_lat: number;
          centroid_lng: number;
          current_risk_level: string;
          district: string;
          explanation: string | null;
          id: number;
          last_computed_at: string;
          mean_slope_deg: number;
          population: number;
          risk_score: number;
          soil_moisture_pct: number | null;
          soil_moisture_reading_time: string | null;
          soil_moisture_status: "measured" | "stale" | "missing" | "fallback";
          state: string;
          threshold_e_mm: number;
          zone_name: string;
        };
        Insert: {
          centroid_lat: number;
          centroid_lng: number;
          current_risk_level?: string;
          district: string;
          explanation?: string | null;
          id?: number;
          last_computed_at?: string;
          mean_slope_deg?: number;
          population?: number;
          risk_score?: number;
          soil_moisture_pct?: number | null;
          soil_moisture_reading_time?: string | null;
          soil_moisture_status?: "measured" | "stale" | "missing" | "fallback";
          state: string;
          threshold_e_mm?: number;
          zone_name: string;
        };
        Update: {
          centroid_lat?: number;
          centroid_lng?: number;
          current_risk_level?: string;
          district?: string;
          explanation?: string | null;
          id?: number;
          last_computed_at?: string;
          mean_slope_deg?: number;
          population?: number;
          risk_score?: number;
          soil_moisture_pct?: number | null;
          soil_moisture_reading_time?: string | null;
          soil_moisture_status?: "measured" | "stale" | "missing" | "fallback";
          state?: string;
          threshold_e_mm?: number;
          zone_name?: string;
        };
        Relationships: [];
      };
      road_segments: {
        Row: {
          id: number;
          length_km: number;
          road_name: string;
          segment_label: string;
          status: string;
          updated_at: string;
          zone_id: number;
        };
        Insert: {
          id?: number;
          length_km?: number;
          road_name: string;
          segment_label: string;
          status?: string;
          updated_at?: string;
          zone_id: number;
        };
        Update: {
          id?: number;
          length_km?: number;
          road_name?: string;
          segment_label?: string;
          status?: string;
          updated_at?: string;
          zone_id?: number;
        };
        Relationships: [
          {
            foreignKeyName: "road_segments_zone_id_fkey";
            columns: ["zone_id"];
            isOneToOne: false;
            referencedRelation: "risk_zones";
            referencedColumns: ["id"];
          },
        ];
      };
      weather_readings: {
        Row: {
          id: number;
          rainfall_mm: number;
          reading_time: string;
          soil_moisture_pct: number | null;
          source: string;
          station_id: string;
          zone_id: number;
        };
        Insert: {
          id?: number;
          rainfall_mm?: number;
          reading_time?: string;
          soil_moisture_pct?: number | null;
          source?: string;
          station_id: string;
          zone_id: number;
        };
        Update: {
          id?: number;
          rainfall_mm?: number;
          reading_time?: string;
          soil_moisture_pct?: number | null;
          source?: string;
          station_id?: string;
          zone_id?: number;
        };
        Relationships: [
          {
            foreignKeyName: "weather_readings_zone_id_fkey";
            columns: ["zone_id"];
            isOneToOne: false;
            referencedRelation: "risk_zones";
            referencedColumns: ["id"];
          },
        ];
      };
      risk_model_config: {
        Row: {
          activated_at: string | null;
          artifact_path: string | null;
          cutoff_high: number;
          cutoff_moderate: number;
          cutoff_severe: number;
          dataset_fingerprint: string | null;
          feature_schema_version: string | null;
          id: number;
          is_active: boolean;
          model_version: string;
          notes: string | null;
          pr_auc: number | null;
          recall_at_80_precision: number | null;
          retired_at: string | null;
          status: string;
          trained_at: string | null;
          weight_antecedent: number;
          weight_history: number;
          weight_intensity: number;
          weight_slope: number;
          weight_soil_moisture: number;
        };
        Insert: {
          activated_at?: string | null;
          artifact_path?: string | null;
          cutoff_high?: number;
          cutoff_moderate?: number;
          cutoff_severe?: number;
          dataset_fingerprint?: string | null;
          feature_schema_version?: string | null;
          id?: number;
          is_active?: boolean;
          model_version: string;
          notes?: string | null;
          pr_auc?: number | null;
          recall_at_80_precision?: number | null;
          retired_at?: string | null;
          status?: string;
          trained_at?: string | null;
          weight_antecedent: number;
          weight_history: number;
          weight_intensity: number;
          weight_slope: number;
          weight_soil_moisture: number;
        };
        Update: {
          activated_at?: string | null;
          artifact_path?: string | null;
          cutoff_high?: number;
          cutoff_moderate?: number;
          cutoff_severe?: number;
          dataset_fingerprint?: string | null;
          feature_schema_version?: string | null;
          id?: number;
          is_active?: boolean;
          model_version?: string;
          notes?: string | null;
          pr_auc?: number | null;
          recall_at_80_precision?: number | null;
          retired_at?: string | null;
          status?: string;
          trained_at?: string | null;
          weight_antecedent?: number;
          weight_history?: number;
          weight_intensity?: number;
          weight_slope?: number;
          weight_soil_moisture?: number;
        };
        Relationships: [];
      };
      risk_model_activation_log: {
        Row: {
          action: string;
          actor: string;
          id: number;
          model_version: string;
          previous_active_version: string | null;
          reason: string | null;
          timestamp: string;
        };
        Insert: {
          action: string;
          actor?: string;
          id?: number;
          model_version: string;
          previous_active_version?: string | null;
          reason?: string | null;
          timestamp?: string;
        };
        Update: {
          action?: string;
          actor?: string;
          id?: number;
          model_version?: string;
          previous_active_version?: string | null;
          reason?: string | null;
          timestamp?: string;
        };
        Relationships: [];
      };
      risk_predictions: {
        Row: {
          created_at: string;
          data_quality: Json;
          explanation: string;
          feature_schema_version: string;
          features: Json;
          id: number;
          model_version: string;
          prediction_time: string;
          probability: number;
          risk_category: "Low" | "Moderate" | "High" | "Severe";
          risk_score: number;
          zone_id: number;
        };
        Insert: {
          created_at?: string;
          data_quality?: Json;
          explanation: string;
          feature_schema_version?: string;
          features?: Json;
          id?: number;
          model_version: string;
          prediction_time?: string;
          probability: number;
          risk_category: "Low" | "Moderate" | "High" | "Severe";
          risk_score: number;
          zone_id: number;
        };
        Update: {
          created_at?: string;
          data_quality?: Json;
          explanation?: string;
          feature_schema_version?: string;
          features?: Json;
          id?: number;
          model_version?: string;
          prediction_time?: string;
          probability?: number;
          risk_category?: "Low" | "Moderate" | "High" | "Severe";
          risk_score?: number;
          zone_id?: number;
        };
        Relationships: [
          {
            foreignKeyName: "risk_predictions_zone_id_fkey";
            columns: ["zone_id"];
            isOneToOne: false;
            referencedRelation: "risk_zones";
            referencedColumns: ["id"];
          },
        ];
      };
      field_observations: {
        Row: {
          client_timestamp: string;
          id: string;
          idempotency_key: string | null;
          observed_at: string;
          observer_id: string;
          rainfall_mm: number | null;
          road_status: "open" | "restricted" | "blocked" | "unknown" | null;
          soil_condition: string | null;
          sync_status: "pending" | "synced" | "conflict";
          synced_at: string;
          visual_signs: string | null;
          zone_id: number;
        };
        Insert: {
          client_timestamp: string;
          id?: string;
          idempotency_key?: string | null;
          observed_at: string;
          observer_id?: string;
          rainfall_mm?: number | null;
          road_status?: "open" | "restricted" | "blocked" | "unknown" | null;
          soil_condition?: string | null;
          sync_status?: "pending" | "synced" | "conflict";
          synced_at?: string;
          visual_signs?: string | null;
          zone_id: number;
        };
        Update: {
          client_timestamp?: string;
          id?: string;
          idempotency_key?: string | null;
          observed_at?: string;
          observer_id?: string;
          rainfall_mm?: number | null;
          road_status?: "open" | "restricted" | "blocked" | "unknown" | null;
          soil_condition?: string | null;
          sync_status?: "pending" | "synced" | "conflict";
          synced_at?: string;
          visual_signs?: string | null;
          zone_id?: number;
        };
        Relationships: [
          {
            foreignKeyName: "field_observations_zone_id_fkey";
            columns: ["zone_id"];
            isOneToOne: false;
            referencedRelation: "risk_zones";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      recompute_risk: { Args: never; Returns: undefined };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
