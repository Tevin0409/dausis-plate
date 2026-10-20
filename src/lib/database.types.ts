// Hand-written to match supabase/migrations. Regenerate with `bun run db:types`
// once the local Supabase stack is running; the shape below matches its output.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type DishCategory = "mains" | "sides" | "breakfast" | "drinks";
type EntryKind = "day" | "week";
type OrderMode = "dine_in" | "pickup" | "delivery";
type PaymentMethod = "mpesa" | "card" | "on_handover";
type PaymentStatus = "pending" | "paid" | "failed" | "unpaid";
type OrderStatus = "new" | "preparing" | "ready" | "completed" | "cancelled";
type StaffRole = "owner" | "staff";

export type Database = {
  public: {
    Tables: {
      staff: {
        Row: { user_id: string; role: StaffRole; display_name: string | null; created_at: string };
        Insert: { user_id: string; role?: StaffRole; display_name?: string | null; created_at?: string };
        Update: { user_id?: string; role?: StaffRole; display_name?: string | null; created_at?: string };
        Relationships: [];
      };
      dishes: {
        Row: {
          id: string;
          name: string;
          description: string;
          price_kes: number;
          photo_key: string | null;
          photo_url: string | null;
          photo_thumb_url: string | null;
          category: DishCategory;
          is_regular: boolean;
          regular_available: boolean;
          sort_order: number;
          archived: boolean;
          last_served_on: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          description?: string;
          price_kes: number;
          photo_key?: string | null;
          photo_url?: string | null;
          photo_thumb_url?: string | null;
          category?: DishCategory;
          is_regular?: boolean;
          regular_available?: boolean;
          sort_order?: number;
          archived?: boolean;
          last_served_on?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["dishes"]["Insert"]>;
        Relationships: [];
      };
      dish_options: {
        Row: { id: string; dish_id: string; label: string; price_delta_kes: number; is_default: boolean; sort_order: number };
        Insert: { id?: string; dish_id: string; label: string; price_delta_kes?: number; is_default?: boolean; sort_order?: number };
        Update: Partial<Database["public"]["Tables"]["dish_options"]["Insert"]>;
        Relationships: [
          { foreignKeyName: "dish_options_dish_id_fkey"; columns: ["dish_id"]; isOneToOne: false; referencedRelation: "dishes"; referencedColumns: ["id"] },
        ];
      };
      menu_entries: {
        Row: {
          id: string;
          dish_id: string;
          kind: EntryKind;
          starts_on: string;
          ends_on: string;
          price_kes: number | null;
          plates_per_day: number | null;
          show_from: string;
          show_until: string;
          auto_hide_sold_out: boolean;
          published: boolean;
          ended_early_at: string | null;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          dish_id: string;
          kind?: EntryKind;
          starts_on: string;
          ends_on: string;
          price_kes?: number | null;
          plates_per_day?: number | null;
          show_from?: string;
          show_until?: string;
          auto_hide_sold_out?: boolean;
          published?: boolean;
          ended_early_at?: string | null;
          sort_order?: number;
        };
        Update: Partial<Database["public"]["Tables"]["menu_entries"]["Insert"]>;
        Relationships: [
          { foreignKeyName: "menu_entries_dish_id_fkey"; columns: ["dish_id"]; isOneToOne: false; referencedRelation: "dishes"; referencedColumns: ["id"] },
        ];
      };
      menu_entry_days: {
        Row: { entry_id: string; day: string; plates_sold: number; sold_out_manual: boolean };
        Insert: { entry_id: string; day: string; plates_sold?: number; sold_out_manual?: boolean };
        Update: Partial<Database["public"]["Tables"]["menu_entry_days"]["Insert"]>;
        Relationships: [
          { foreignKeyName: "menu_entry_days_entry_id_fkey"; columns: ["entry_id"]; isOneToOne: false; referencedRelation: "menu_entries"; referencedColumns: ["id"] },
        ];
      };
      dining_tables: {
        Row: { id: string; label: string; qr_token: string; active: boolean };
        Insert: { id?: string; label: string; qr_token?: string; active?: boolean };
        Update: Partial<Database["public"]["Tables"]["dining_tables"]["Insert"]>;
        Relationships: [];
      };
      delivery_zones: {
        Row: { id: string; name: string; fee_kes: number; active: boolean; sort_order: number };
        Insert: { id?: string; name: string; fee_kes: number; active?: boolean; sort_order?: number };
        Update: Partial<Database["public"]["Tables"]["delivery_zones"]["Insert"]>;
        Relationships: [];
      };
      orders: {
        Row: {
          id: string;
          number: number;
          code: string;
          public_token: string;
          mode: OrderMode;
          table_id: string | null;
          pickup_at: string | null;
          delivery_zone_id: string | null;
          delivery_address: string | null;
          delivery_notes: string | null;
          customer_name: string;
          customer_phone: string;
          payment_method: PaymentMethod;
          payment_status: PaymentStatus;
          status: OrderStatus;
          subtotal_kes: number;
          delivery_fee_kes: number;
          total_kes: number;
          mpesa_checkout_request_id: string | null;
          mpesa_receipt: string | null;
          created_at: string;
          updated_at: string;
          status_changed_at: string;
        };
        Insert: never;
        Update: {
          status?: OrderStatus;
          payment_status?: PaymentStatus;
          mpesa_checkout_request_id?: string | null;
          mpesa_receipt?: string | null;
        };
        Relationships: [
          { foreignKeyName: "orders_table_id_fkey"; columns: ["table_id"]; isOneToOne: false; referencedRelation: "dining_tables"; referencedColumns: ["id"] },
          { foreignKeyName: "orders_delivery_zone_id_fkey"; columns: ["delivery_zone_id"]; isOneToOne: false; referencedRelation: "delivery_zones"; referencedColumns: ["id"] },
        ];
      };
      order_items: {
        Row: {
          id: string;
          order_id: string;
          dish_id: string;
          menu_entry_id: string | null;
          option_id: string | null;
          name: string;
          option_label: string | null;
          unit_price_kes: number;
          quantity: number;
          note: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [
          { foreignKeyName: "order_items_order_id_fkey"; columns: ["order_id"]; isOneToOne: false; referencedRelation: "orders"; referencedColumns: ["id"] },
        ];
      };
    };
    Views: {
      todays_menu: {
        Row: {
          entry_id: string;
          kind: EntryKind;
          starts_on: string;
          ends_on: string;
          show_from: string;
          show_until: string;
          sort_order: number;
          dish_id: string;
          name: string;
          description: string;
          photo_key: string | null;
          category: DishCategory;
          price_kes: number;
          plates_per_day: number | null;
          plates_sold: number;
          plates_left: number | null;
          sold_out: boolean;
          open_now: boolean;
          auto_hide_sold_out: boolean;
          photo_url: string | null;
          photo_thumb_url: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      place_order: { Args: { p: Json }; Returns: { public_token: string; code: string; total_kes: number }[] };
      get_order_status: { Args: { p_token: string }; Returns: Json };
      resolve_table: { Args: { p_token: string }; Returns: { id: string; label: string }[] };
      copy_menu_day: { Args: { p_from: string; p_to: string }; Returns: number };
      set_entry_sold_out: { Args: { p_entry: string; p_sold_out: boolean }; Returns: undefined };
      dashboard_stats: { Args: { p_day: string }; Returns: Json };
      is_staff: { Args: Record<PropertyKey, never>; Returns: boolean };
      nairobi_today: { Args: Record<PropertyKey, never>; Returns: string };
    };
    Enums: {
      dish_category: DishCategory;
      entry_kind: EntryKind;
      order_mode: OrderMode;
      payment_method: PaymentMethod;
      payment_status: PaymentStatus;
      order_status: OrderStatus;
      staff_role: StaffRole;
    };
    CompositeTypes: Record<string, never>;
  };
};

type PublicSchema = Database["public"];
export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"];
export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T];
export type TodaysMenuRow = PublicSchema["Views"]["todays_menu"]["Row"];
