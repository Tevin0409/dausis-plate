import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/database.types";
import { env } from "@/lib/env";

/** Supabase client bound to the request's auth cookies (RLS applies). */
export async function createClient() {
  const store = await cookies();
  return createServerClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a Server Component: middleware refreshes the session instead.
        }
      },
    },
  });
}

/** Returns the signed-in staff member, or null. Throws if the staff list can't be read. */
export async function getStaff() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase.from("staff").select("role, display_name").eq("user_id", user.id).maybeSingle();
  if (error) {
    // Not "not on the staff list": the lookup itself failed.
    console.error("[db] loading staff failed:", error.code ?? "", error.message);
    throw new Error("Couldn't load staff");
  }
  if (!data) return null;
  return { id: user.id, email: user.email ?? null, role: data.role, name: data.display_name };
}
