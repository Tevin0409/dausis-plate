// Generated from the live Supabase project, then hand-edited to match supabase/migrations:
// `bun run db:types` needs the Docker-based Supabase CLI stack, which this project's dev stack
// does not use. Keep it in step with every migration; keep the two helpers at the bottom.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.18";
  };
  public: {
    Tables: {
      change_log: {
        Row: {
          action: string; actor: string | null; actor_name: string; after: Json | null; area: Database["public"]["Enums"]["change_area"];
          at: string; before: Json | null; id: number; subject_id: string | null; subject_label: string | null; tx: number;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      staff_grants: {
        Row: { granted_at: string; granted_by: string | null; job: Database["public"]["Enums"]["staff_grant"]; user_id: string };
        Insert: { granted_at?: string; granted_by?: string | null; job: Database["public"]["Enums"]["staff_grant"]; user_id: string };
        Update: { granted_at?: string; granted_by?: string | null; job?: Database["public"]["Enums"]["staff_grant"]; user_id?: string };
        Relationships: [
          { foreignKeyName: "staff_grants_user_id_fkey"; columns: ["user_id"]; isOneToOne: false; referencedRelation: "staff"; referencedColumns: ["user_id"] },
        ];
      };
      delivery_zones: {
        Row: { active: boolean; fee_kes: number; id: string; min_order_kes: number; name: string; sort_order: number };
        Insert: { active?: boolean; fee_kes: number; id?: string; min_order_kes?: number; name: string; sort_order?: number };
        Update: { active?: boolean; fee_kes?: number; id?: string; min_order_kes?: number; name?: string; sort_order?: number };
        Relationships: [];
      };
      dining_tables: {
        Row: { active: boolean; id: string; label: string; qr_token: string };
        Insert: { active?: boolean; id?: string; label: string; qr_token?: string };
        Update: { active?: boolean; id?: string; label?: string; qr_token?: string };
        Relationships: [];
      };
      table_requests: {
        Row: {
          auto_cleared: boolean;
          cleared_at: string | null;
          cleared_by: string | null;
          created_at: string;
          id: string;
          kind: Database["public"]["Enums"]["table_request_kind"];
          order_id: string | null;
          table_id: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      dish_options: {
        Row: {
          archived: boolean; dish_id: string; id: string; is_default: boolean; kind: "choice" | "extra"; label: string;
          out_on: string | null; price_delta_kes: number; sort_order: number;
        };
        Insert: {
          archived?: boolean; dish_id: string; id?: string; is_default?: boolean; kind?: "choice" | "extra"; label: string;
          out_on?: string | null; price_delta_kes?: number; sort_order?: number;
        };
        Update: {
          archived?: boolean; dish_id?: string; id?: string; is_default?: boolean; kind?: "choice" | "extra"; label?: string;
          out_on?: string | null; price_delta_kes?: number; sort_order?: number;
        };
        Relationships: [
          { foreignKeyName: "dish_options_dish_id_fkey"; columns: ["dish_id"]; isOneToOne: false; referencedRelation: "dishes"; referencedColumns: ["id"] },
          { foreignKeyName: "dish_options_dish_id_fkey"; columns: ["dish_id"]; isOneToOne: false; referencedRelation: "todays_menu"; referencedColumns: ["dish_id"] },
        ];
      };
      dishes: {
        Row: {
          archived: boolean;
          archived_at: string | null;
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
          rating_count: number;
          rating_total: number;
          sort_order: number;
          unavailable_on: string | null;
          updated_at: string;
        };
        Insert: {
          archived?: boolean;
          archived_at?: string | null;
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
          sort_order?: number;
          unavailable_on?: string | null;
          updated_at?: string;
        };
        Update: {
          archived?: boolean;
          archived_at?: string | null;
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
          sort_order?: number;
          unavailable_on?: string | null;
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
        Row: { day: string; entry_id: string; plates_sold: number; sold_out_at: string | null; sold_out_manual: boolean };
        Insert: { day: string; entry_id: string; plates_sold?: number; sold_out_at?: string | null; sold_out_manual?: boolean };
        Update: { day?: string; entry_id?: string; plates_sold?: number; sold_out_at?: string | null; sold_out_manual?: boolean };
        Relationships: [
          { foreignKeyName: "menu_entry_days_entry_id_fkey"; columns: ["entry_id"]; isOneToOne: false; referencedRelation: "menu_entries"; referencedColumns: ["id"] },
          { foreignKeyName: "menu_entry_days_entry_id_fkey"; columns: ["entry_id"]; isOneToOne: false; referencedRelation: "todays_menu"; referencedColumns: ["entry_id"] },
        ];
      };
      menu_entry_off_days: {
        Row: { created_at: string; created_by: string | null; day: string; entry_id: string };
        Insert: { created_at?: string; created_by?: string | null; day: string; entry_id: string };
        Update: { created_at?: string; created_by?: string | null; day?: string; entry_id?: string };
        Relationships: [
          { foreignKeyName: "menu_entry_off_days_entry_id_fkey"; columns: ["entry_id"]; isOneToOne: false; referencedRelation: "menu_entries"; referencedColumns: ["id"] },
        ];
      };
      order_item_extras: {
        Row: { id: string; label: string; option_id: string; order_item_id: string; price_kes: number; sort_order: number };
        Insert: never;
        Update: never;
        Relationships: [
          { foreignKeyName: "order_item_extras_order_item_id_fkey"; columns: ["order_item_id"]; isOneToOne: false; referencedRelation: "order_items"; referencedColumns: ["id"] },
          { foreignKeyName: "order_item_extras_option_id_fkey"; columns: ["option_id"]; isOneToOne: false; referencedRelation: "dish_options"; referencedColumns: ["id"] },
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
          { foreignKeyName: "order_items_dish_id_fkey"; columns: ["dish_id"]; isOneToOne: false; referencedRelation: "dishes"; referencedColumns: ["id"] },
          { foreignKeyName: "order_items_menu_entry_id_fkey"; columns: ["menu_entry_id"]; isOneToOne: false; referencedRelation: "menu_entries"; referencedColumns: ["id"] },
          { foreignKeyName: "order_items_option_id_fkey"; columns: ["option_id"]; isOneToOne: false; referencedRelation: "dish_options"; referencedColumns: ["id"] },
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
          cancel_reason: Database["public"]["Enums"]["cancel_reason"] | null;
          cancel_note: string | null;
          prev_status: Database["public"]["Enums"]["order_status"] | null;
          paid_at: string | null;
          paid_from: Database["public"]["Enums"]["payment_status"] | null;
          paid_with: Database["public"]["Enums"]["paid_with"] | null;
          delivery_zone_id: string | null;
          id: string;
          idempotency_key: string | null;
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
          cancel_reason?: Database["public"]["Enums"]["cancel_reason"] | null;
          cancel_note?: string | null;
          prev_status?: Database["public"]["Enums"]["order_status"] | null;
          paid_at?: string | null;
          paid_from?: Database["public"]["Enums"]["payment_status"] | null;
          paid_with?: Database["public"]["Enums"]["paid_with"] | null;
          delivery_zone_id?: string | null;
          id?: string;
          idempotency_key?: string | null;
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
          cancel_reason?: Database["public"]["Enums"]["cancel_reason"] | null;
          cancel_note?: string | null;
          prev_status?: Database["public"]["Enums"]["order_status"] | null;
          paid_at?: string | null;
          paid_from?: Database["public"]["Enums"]["payment_status"] | null;
          paid_with?: Database["public"]["Enums"]["paid_with"] | null;
          delivery_zone_id?: string | null;
          id?: string;
          idempotency_key?: string | null;
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
      credit_notes: {
        Row: {
          id: string;
          number: number;
          order_id: string;
          amount_kes: number;
          reason: string;
          issued_at: string;
          issued_by: string;
          refunded_with: Database["public"]["Enums"]["paid_with"];
          voided_at: string | null;
          voided_by: string | null;
          void_reason: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [{ foreignKeyName: "credit_notes_order_id_fkey"; columns: ["order_id"]; isOneToOne: false; referencedRelation: "orders"; referencedColumns: ["id"] }];
      };
      opening_hours: {
        Row: { weekday: number; is_open: boolean; opens: string; closes: string };
        Insert: { weekday: number; is_open?: boolean; opens?: string; closes?: string };
        Update: { weekday?: number; is_open?: boolean; opens?: string; closes?: string };
        Relationships: [];
      };
      closed_dates: {
        Row: { day: string; note: string | null; created_by: string | null; created_at: string };
        Insert: { day: string; note?: string | null; created_by?: string | null; created_at?: string };
        Update: { day?: string; note?: string | null; created_by?: string | null; created_at?: string };
        Relationships: [];
      };
      kitchen_settings: {
        Row: {
          id: boolean;
          last_orders_minutes: number;
          closed_early_on: string | null;
          closed_early_at: string | null;
          closed_early_by: string | null;
          till_number: string | null;
          phone: string | null;
          address: string | null;
          maps_url: string | null;
          google_review_url: string | null;
          updated_at: string;
        };
        Insert: { id?: boolean; last_orders_minutes?: number; closed_early_on?: string | null; closed_early_at?: string | null; closed_early_by?: string | null; till_number?: string | null; phone?: string | null; address?: string | null; maps_url?: string | null; updated_at?: string };
        Update: { id?: boolean; last_orders_minutes?: number; closed_early_on?: string | null; closed_early_at?: string | null; closed_early_by?: string | null; till_number?: string | null; phone?: string | null; address?: string | null; maps_url?: string | null; updated_at?: string };
        Relationships: [];
      };
      staff: {
        Row: {
          created_at: string; display_name: string | null; invited_at: string | null; must_change_password: boolean;
          role: Database["public"]["Enums"]["staff_role"]; user_id: string; ratings_seen_at: string | null;
        };
        Insert: {
          created_at?: string; display_name?: string | null; invited_at?: string | null; must_change_password?: boolean;
          role?: Database["public"]["Enums"]["staff_role"]; user_id: string;
        };
        Update: {
          created_at?: string; display_name?: string | null; invited_at?: string | null; must_change_password?: boolean;
          role?: Database["public"]["Enums"]["staff_role"]; user_id?: string;
        };
        Relationships: [];
      };
      // spec-2.10: owners read; every write goes through rate_order / set_rating_hidden / reply_to_rating.
      order_ratings: {
        Row: {
          order_id: string;
          stars: number;
          comment: string | null;
          created_at: string;
          hidden_at: string | null;
          hidden_by: string | null;
          reply: string | null;
          replied_at: string | null;
          replied_by: string | null;
        };
        Insert: never;
        Update: never;
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
          rating_avg: number | null;
          rating_count: number | null;
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
      close_early: { Args: never; Returns: Json };
      has_grant: { Args: { p_job: Database["public"]["Enums"]["staff_grant"] }; Returns: boolean };
      history_people: { Args: never; Returns: { actor: string; actor_name: string; on_team: boolean }[] };
      has_permission: { Args: { p_permission: string }; Returns: boolean };
      kitchen_status: { Args: never; Returns: Json };
      request_table_help: {
        Args: { p_token: string; p_kind: Database["public"]["Enums"]["table_request_kind"] };
        Returns: { asked_at: string; created: boolean }[];
      };
      request_waiter_at_table: { Args: { p_qr_token: string }; Returns: { asked_at: string; created: boolean }[] };
      table_waiter_status: { Args: { p_qr_token: string }; Returns: Json };
      open_table_requests: { Args: never; Returns: Json };
      clear_table_request: { Args: { p_id: string }; Returns: boolean };
      undo_clear_table_request: { Args: { p_id: string }; Returns: undefined };
      mark_orders_paid: { Args: { p_ids: string[]; p_with: Database["public"]["Enums"]["paid_with"] }; Returns: Json };
      unmark_orders_paid: { Args: { p_items: Json }; Returns: undefined };
      regular_on_sale: { Args: { p_unavailable_on: string | null }; Returns: boolean };
      reopen_today: { Args: never; Returns: Json };
      save_opening_hours: { Args: { p_days: Json; p_last_orders_minutes: number }; Returns: Json };
      set_regular_on_sale: { Args: { p_dish: string; p_on_sale: boolean }; Returns: undefined };
      set_till_number: { Args: { p_till: string }; Returns: string | null };
      rate_order: { Args: { p_token: string; p_stars: number; p_comment: string | null }; Returns: Json };
      list_ratings: {
        Args: { p_show?: string; p_before?: string | null };
        Returns: {
          order_id: string;
          code: string;
          first_name: string;
          sent_at: string;
          stars: number;
          dishes: string[];
          comment: string | null;
          hidden_at: string | null;
          reply: string | null;
          replied_at: string | null;
          is_new: boolean;
        }[];
      };
      ratings_summary: { Args: never; Returns: { avg_stars: number | null; visible: number; hidden: number }[] };
      set_rating_hidden: { Args: { p_order_id: string; p_hidden: boolean }; Returns: boolean };
      reply_to_rating: { Args: { p_order_id: string; p_reply: string | null }; Returns: Json };
      mark_ratings_seen: { Args: never; Returns: undefined };
      set_google_review_url: { Args: { p_url: string }; Returns: string | null };
      advance_order: { Args: { p_order: string; p_from: Database["public"]["Enums"]["order_status"]; p_to: Database["public"]["Enums"]["order_status"] }; Returns: number };
      cancel_order: {
        Args: { p_order: string; p_from: Database["public"]["Enums"]["order_status"]; p_reason: Database["public"]["Enums"]["cancel_reason"]; p_note?: string | null };
        Returns: undefined;
      };
      undo_order_move: { Args: { p_order: string; p_status: Database["public"]["Enums"]["order_status"]; p_version: number }; Returns: undefined };
      unmark_order_paid: { Args: { p_order: string; p_version: number }; Returns: undefined };
      copy_menu_day: { Args: { p_from: string; p_to: string }; Returns: Json };
      copy_menu_week_preview: { Args: { p_week_start: string }; Returns: Json };
      add_menu_entry: {
        Args: {
          p_dish: string;
          p_kind: Database["public"]["Enums"]["entry_kind"];
          p_days: string[];
          p_from: string;
          p_until: string;
          p_plates: number | null;
          p_price: number | null;
        };
        Returns: string;
      };
      update_menu_entry: {
        Args: { p_entry: string; p_from: string; p_until: string; p_plates: number | null; p_price: number | null; p_days?: string[] | null };
        Returns: Json;
      };
      remove_menu_entry: { Args: { p_entry: string; p_day?: string | null }; Returns: Json };
      restore_menu_entry: { Args: { p_undo: Json }; Returns: string };
      dashboard_stats: { Args: { p_day: string }; Returns: Json };
      delete_dish: { Args: { p_dish: string }; Returns: Json };
      dish_has_orders: { Args: { p_dish: string }; Returns: boolean };
      restore_dish: { Args: { p_dish: string }; Returns: Json };
      save_dish_options: { Args: { p_dish: string; p_options: Json }; Returns: Json };
      set_option_out: { Args: { p_option: string; p_out: boolean }; Returns: Json };
      choices_all_out: { Args: { p_dish: string }; Returns: boolean };
      set_kitchen_phone: { Args: { p_phone: string }; Returns: string | null };
      team_set_role: { Args: { p_user: string; p_role: Database["public"]["Enums"]["staff_role"] }; Returns: undefined };
      team_set_name: { Args: { p_user: string; p_name: string }; Returns: undefined };
      team_remove: { Args: { p_user: string; p_invite?: boolean }; Returns: undefined };
      team_log_reset: { Args: { p_user: string }; Returns: undefined };
      clear_must_change_password: { Args: never; Returns: undefined };
      has_password: { Args: never; Returns: boolean };
      get_order_status: { Args: { p_token: string }; Returns: Json };
      check_cart: { Args: { p_lines: Json }; Returns: Json };
      customer_menu: {
        Args: never;
        Returns: {
          menu_day: string; entry_id: string; kind: Database["public"]["Enums"]["entry_kind"]; starts_on: string; ends_on: string;
          show_from: string; show_until: string; sort_order: number; dish_id: string; name: string; description: string;
          photo_key: string | null; category: Database["public"]["Enums"]["dish_category"]; price_kes: number;
          plates_per_day: number | null; plates_sold: number; plates_left: number | null; sold_out: boolean; open_now: boolean;
          auto_hide_sold_out: boolean; photo_url: string | null; photo_thumb_url: string | null;
        }[];
      };
      menu_day: { Args: never; Returns: string };
      find_order: { Args: { p_phone: string; p_code: string }; Returns: string | null };
      order_lookup_days: { Args: never; Returns: number };
      set_kitchen_address: { Args: { p_address: string; p_maps_url: string }; Returns: undefined };
      kitchen_place: { Args: never; Returns: Json };
      is_owner: { Args: never; Returns: boolean };
      is_staff: { Args: never; Returns: boolean };
      mark_order_paid: { Args: { p_order: string; p_with: Database["public"]["Enums"]["paid_with"] }; Returns: number | null };
      issue_credit_note: { Args: { p_order: string; p_amount: number; p_reason: string; p_refunded_with: Database["public"]["Enums"]["paid_with"] }; Returns: Json };
      void_credit_note: { Args: { p_id: string; p_reason: string }; Returns: undefined };
      report_sales: { Args: { p_from: string; p_to: string; p_cmp_from?: string | null; p_cmp_to?: string | null }; Returns: Json };
      report_order: { Args: { p_code: string }; Returns: Json };
      report_dishes: { Args: { p_from: string; p_to: string }; Returns: Json };
      report_times: { Args: { p_from: string; p_to: string }; Returns: Json };
      report_delivery: { Args: { p_from: string; p_to: string }; Returns: Json };
      report_orders_csv: { Args: { p_from: string; p_to: string }; Returns: Json[] };
      report_credit_notes_csv: { Args: { p_from: string; p_to: string }; Returns: Json[] };
      nairobi_time: { Args: never; Returns: string };
      nairobi_today: { Args: never; Returns: string };
      place_order: { Args: { p: Json }; Returns: { code: string; public_token: string; replayed: boolean; total_kes: number }[] };
      resolve_table: { Args: { p_token: string }; Returns: { id: string; label: string }[] };
      set_entry_sold_out: { Args: { p_entry: string; p_sold_out: boolean }; Returns: undefined };
    };
    Enums: {
      change_area: "menu" | "orders" | "tables" | "team" | "settings" | "ratings";
      dish_category: "mains" | "sides" | "breakfast" | "drinks";
      entry_kind: "day" | "week";
      order_mode: "dine_in" | "pickup" | "delivery";
      order_status: "new" | "preparing" | "ready" | "on_the_way" | "completed" | "cancelled";
      cancel_reason: "sold_out" | "too_busy" | "cant_deliver" | "customer_asked" | "no_show" | "other";
      payment_method: "mpesa" | "card" | "on_handover" | "at_counter";
      payment_status: "pending" | "paid" | "failed" | "unpaid";
      paid_with: "cash" | "mpesa" | "card";
      staff_grant: "everyday_menu" | "dishes_prices" | "tables_delivery" | "close_early";
      staff_role: "owner" | "staff";
      table_request_kind: "waiter" | "bill";
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
type Nullable = "plates_left" | "plates_per_day" | "photo_key" | "photo_url" | "photo_thumb_url" | "rating_avg";
type NeverNull = Exclude<keyof ViewRow, Nullable>;
export type TodaysMenuRow = { [K in NeverNull]: NonNullable<ViewRow[K]> } & Pick<ViewRow, Nullable>;
