// Generated from the live Supabase project (supabase gen types). Regenerate after schema
// changes with `bun run db:types`; keep the two helpers at the bottom.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.18";
  };
  public: {
    Tables: {
      delivery_zones: {
        Row: { active: boolean; fee_kes: number; id: string; name: string; sort_order: number };
        Insert: { active?: boolean; fee_kes: number; id?: string; name: string; sort_order?: number };
        Update: { active?: boolean; fee_kes?: number; id?: string; name?: string; sort_order?: number };
        Relationships: [];
      };
      dining_tables: {
        Row: { active: boolean; id: string; label: string; qr_token: string };
        Insert: { active?: boolean; id?: string; label: string; qr_token?: string };
        Update: { active?: boolean; id?: string; label?: string; qr_token?: string };
        Relationships: [];
      };
      dish_options: {
        Row: { dish_id: string; id: string; is_default: boolean; label: string; price_delta_kes: number; sort_order: number };
        Insert: { dish_id: string; id?: string; is_default?: boolean; label: string; price_delta_kes?: number; sort_order?: number };
        Update: { dish_id?: string; id?: string; is_default?: boolean; label?: string; price_delta_kes?: number; sort_order?: number };
        Relationships: [
          { foreignKeyName: "dish_options_dish_id_fkey"; columns: ["dish_id"]; isOneToOne: false; referencedRelation: "dishes"; referencedColumns: ["id"] },
          { foreignKeyName: "dish_options_dish_id_fkey"; columns: ["dish_id"]; isOneToOne: false; referencedRelation: "todays_menu"; referencedColumns: ["dish_id"] },
        ];
      };
      dishes: {
        Row: {
          archived: boolean;
          category: Database["public"]["Enums"]["dish_category"];
          created_at: string;
          description: string;
          id: string;
          is_regular: boolean;
          last_served_on: string | null;
          name: string;
          photo_key: string | null;
          photo_thumb_url: string | null;
          photo_url: string | null;
          price_kes: number;
          regular_available: boolean;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          archived?: boolean;
          category?: Database["public"]["Enums"]["dish_category"];
          created_at?: string;
          description?: string;
          id?: string;
          is_regular?: boolean;
          last_served_on?: string | null;
          name: string;
          photo_key?: string | null;
          photo_thumb_url?: string | null;
          photo_url?: string | null;
          price_kes: number;
          regular_available?: boolean;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          archived?: boolean;
          category?: Database["public"]["Enums"]["dish_category"];
          created_at?: string;
          description?: string;
          id?: string;
          is_regular?: boolean;
          last_served_on?: string | null;
          name?: string;
          photo_key?: string | null;
          photo_thumb_url?: string | null;
          photo_url?: string | null;
          price_kes?: number;
          regular_available?: boolean;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      menu_entries: {
        Row: {
          auto_hide_sold_out: boolean;
          created_at: string;
          dish_id: string;
          ended_early_at: string | null;
          ends_on: string;
          id: string;
          kind: Database["public"]["Enums"]["entry_kind"];
          plates_per_day: number | null;
          price_kes: number | null;
          published: boolean;
          show_from: string;
          show_until: string;
          sort_order: number;
          starts_on: string;
        };
        Insert: {
          auto_hide_sold_out?: boolean;
          created_at?: string;
          dish_id: string;
          ended_early_at?: string | null;
          ends_on: string;
          id?: string;
          kind?: Database["public"]["Enums"]["entry_kind"];
          plates_per_day?: number | null;
          price_kes?: number | null;
          published?: boolean;
          show_from?: string;
          show_until?: string;
          sort_order?: number;
          starts_on: string;
        };
        Update: {
          auto_hide_sold_out?: boolean;
          created_at?: string;
          dish_id?: string;
          ended_early_at?: string | null;
          ends_on?: string;
          id?: string;
          kind?: Database["public"]["Enums"]["entry_kind"];
          plates_per_day?: number | null;
          price_kes?: number | null;
          published?: boolean;
          show_from?: string;
          show_until?: string;
          sort_order?: number;
          starts_on?: string;
        };
        Relationships: [
          { foreignKeyName: "menu_entries_dish_id_fkey"; columns: ["dish_id"]; isOneToOne: false; referencedRelation: "dishes"; referencedColumns: ["id"] },
          { foreignKeyName: "menu_entries_dish_id_fkey"; columns: ["dish_id"]; isOneToOne: false; referencedRelation: "todays_menu"; referencedColumns: ["dish_id"] },
        ];
      };
      menu_entry_days: {
        Row: { day: string; entry_id: string; plates_sold: number; sold_out_manual: boolean };
        Insert: { day: string; entry_id: string; plates_sold?: number; sold_out_manual?: boolean };
        Update: { day?: string; entry_id?: string; plates_sold?: number; sold_out_manual?: boolean };
        Relationships: [
          { foreignKeyName: "menu_entry_days_entry_id_fkey"; columns: ["entry_id"]; isOneToOne: false; referencedRelation: "menu_entries"; referencedColumns: ["id"] },
          { foreignKeyName: "menu_entry_days_entry_id_fkey"; columns: ["entry_id"]; isOneToOne: false; referencedRelation: "todays_menu"; referencedColumns: ["entry_id"] },
        ];
      };
      order_items: {
        Row: {
          dish_id: string;
          id: string;
          menu_entry_id: string | null;
          name: string;
          note: string | null;
          option_id: string | null;
          option_label: string | null;
          order_id: string;
          quantity: number;
          unit_price_kes: number;
        };
        Insert: {
          dish_id: string;
          id?: string;
          menu_entry_id?: string | null;
          name: string;
          note?: string | null;
          option_id?: string | null;
          option_label?: string | null;
          order_id: string;
          quantity: number;
          unit_price_kes: number;
        };
        Update: {
          dish_id?: string;
          id?: string;
          menu_entry_id?: string | null;
          name?: string;
          note?: string | null;
          option_id?: string | null;
          option_label?: string | null;
          order_id?: string;
          quantity?: number;
          unit_price_kes?: number;
        };
        Relationships: [
          { foreignKeyName: "order_items_dish_id_fkey"; columns: ["dish_id"]; isOneToOne: false; referencedRelation: "dishes"; referencedColumns: ["id"] },
          { foreignKeyName: "order_items_dish_id_fkey"; columns: ["dish_id"]; isOneToOne: false; referencedRelation: "todays_menu"; referencedColumns: ["dish_id"] },
          { foreignKeyName: "order_items_menu_entry_id_fkey"; columns: ["menu_entry_id"]; isOneToOne: false; referencedRelation: "menu_entries"; referencedColumns: ["id"] },
          { foreignKeyName: "order_items_menu_entry_id_fkey"; columns: ["menu_entry_id"]; isOneToOne: false; referencedRelation: "todays_menu"; referencedColumns: ["entry_id"] },
          { foreignKeyName: "order_items_option_id_fkey"; columns: ["option_id"]; isOneToOne: false; referencedRelation: "dish_options"; referencedColumns: ["id"] },
          { foreignKeyName: "order_items_order_id_fkey"; columns: ["order_id"]; isOneToOne: false; referencedRelation: "orders"; referencedColumns: ["id"] },
        ];
      };
      orders: {
        Row: {
          code: string | null;
          created_at: string;
          customer_name: string;
          customer_phone: string;
          delivery_address: string | null;
          delivery_fee_kes: number;
          delivery_notes: string | null;
          delivery_zone_id: string | null;
          id: string;
          mode: Database["public"]["Enums"]["order_mode"];
          mpesa_checkout_request_id: string | null;
          mpesa_receipt: string | null;
          number: number;
          payment_method: Database["public"]["Enums"]["payment_method"];
          payment_status: Database["public"]["Enums"]["payment_status"];
          pickup_at: string | null;
          public_token: string;
          status: Database["public"]["Enums"]["order_status"];
          status_changed_at: string;
          subtotal_kes: number;
          table_id: string | null;
          total_kes: number;
          updated_at: string;
        };
        Insert: {
          code?: string | null;
          created_at?: string;
          customer_name: string;
          customer_phone: string;
          delivery_address?: string | null;
          delivery_fee_kes?: number;
          delivery_notes?: string | null;
          delivery_zone_id?: string | null;
          id?: string;
          mode: Database["public"]["Enums"]["order_mode"];
          mpesa_checkout_request_id?: string | null;
          mpesa_receipt?: string | null;
          number?: never;
          payment_method: Database["public"]["Enums"]["payment_method"];
          payment_status?: Database["public"]["Enums"]["payment_status"];
          pickup_at?: string | null;
          public_token?: string;
          status?: Database["public"]["Enums"]["order_status"];
          status_changed_at?: string;
          subtotal_kes: number;
          table_id?: string | null;
          total_kes: number;
          updated_at?: string;
        };
        Update: {
          code?: string | null;
          created_at?: string;
          customer_name?: string;
          customer_phone?: string;
          delivery_address?: string | null;
          delivery_fee_kes?: number;
          delivery_notes?: string | null;
          delivery_zone_id?: string | null;
          id?: string;
          mode?: Database["public"]["Enums"]["order_mode"];
          mpesa_checkout_request_id?: string | null;
          mpesa_receipt?: string | null;
          number?: never;
          payment_method?: Database["public"]["Enums"]["payment_method"];
          payment_status?: Database["public"]["Enums"]["payment_status"];
          pickup_at?: string | null;
          public_token?: string;
          status?: Database["public"]["Enums"]["order_status"];
          status_changed_at?: string;
          subtotal_kes?: number;
          table_id?: string | null;
          total_kes?: number;
          updated_at?: string;
        };
        Relationships: [
          { foreignKeyName: "orders_delivery_zone_id_fkey"; columns: ["delivery_zone_id"]; isOneToOne: false; referencedRelation: "delivery_zones"; referencedColumns: ["id"] },
          { foreignKeyName: "orders_table_id_fkey"; columns: ["table_id"]; isOneToOne: false; referencedRelation: "dining_tables"; referencedColumns: ["id"] },
        ];
      };
      staff: {
        Row: { created_at: string; display_name: string | null; role: Database["public"]["Enums"]["staff_role"]; user_id: string };
        Insert: { created_at?: string; display_name?: string | null; role?: Database["public"]["Enums"]["staff_role"]; user_id: string };
        Update: { created_at?: string; display_name?: string | null; role?: Database["public"]["Enums"]["staff_role"]; user_id?: string };
        Relationships: [];
      };
    };
    Views: {
      todays_menu: {
        Row: {
          auto_hide_sold_out: boolean | null;
          category: Database["public"]["Enums"]["dish_category"] | null;
          description: string | null;
          dish_id: string | null;
          ends_on: string | null;
          entry_id: string | null;
          kind: Database["public"]["Enums"]["entry_kind"] | null;
          name: string | null;
          open_now: boolean | null;
          photo_key: string | null;
          photo_thumb_url: string | null;
          photo_url: string | null;
          plates_left: number | null;
          plates_per_day: number | null;
          plates_sold: number | null;
          price_kes: number | null;
          show_from: string | null;
          show_until: string | null;
          sold_out: boolean | null;
          sort_order: number | null;
          starts_on: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      copy_menu_day: { Args: { p_from: string; p_to: string }; Returns: number };
      dashboard_stats: { Args: { p_day: string }; Returns: Json };
      get_order_status: { Args: { p_token: string }; Returns: Json };
      is_owner: { Args: never; Returns: boolean };
      is_staff: { Args: never; Returns: boolean };
      nairobi_time: { Args: never; Returns: string };
      nairobi_today: { Args: never; Returns: string };
      place_order: { Args: { p: Json }; Returns: { code: string; public_token: string; total_kes: number }[] };
      resolve_table: { Args: { p_token: string }; Returns: { id: string; label: string }[] };
      set_entry_sold_out: { Args: { p_entry: string; p_sold_out: boolean }; Returns: undefined };
    };
    Enums: {
      dish_category: "mains" | "sides" | "breakfast" | "drinks";
      entry_kind: "day" | "week";
      order_mode: "dine_in" | "pickup" | "delivery";
      order_status: "new" | "preparing" | "ready" | "completed" | "cancelled";
      payment_method: "mpesa" | "card" | "on_handover";
      payment_status: "pending" | "paid" | "failed" | "unpaid";
      staff_role: "owner" | "staff";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

// ───────── app helpers (keep when regenerating) ─────────

type PublicSchema = Database["public"];
export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T];

type ViewRow = PublicSchema["Views"]["todays_menu"]["Row"];
/** Postgres reports every view column as nullable; these ones never are (inner join + not-null columns). */
type NeverNull = Exclude<keyof ViewRow, "plates_left" | "plates_per_day" | "photo_key" | "photo_url" | "photo_thumb_url">;
export type TodaysMenuRow = { [K in NeverNull]: NonNullable<ViewRow[K]> } & Pick<
  ViewRow,
  "plates_left" | "plates_per_day" | "photo_key" | "photo_url" | "photo_thumb_url"
>;
