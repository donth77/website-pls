import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Memoized admin client for server-only usage (API routes + worker).
let supabaseAdmin: SupabaseClient | null = null;

function getRequiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export function getSupabaseAdmin(): SupabaseClient {
  if (supabaseAdmin) return supabaseAdmin;

  const url = getRequiredEnv("SUPABASE_URL");
  const key = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");

  supabaseAdmin = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  return supabaseAdmin;
}

export function getGeneratedBucket(): string {
  return process.env.SUPABASE_STORAGE_BUCKET ?? "generated-sites";
}

