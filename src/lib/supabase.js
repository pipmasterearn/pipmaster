import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (typeof window !== "undefined") {
  try {
    const projectRef = supabaseUrl ? new URL(supabaseUrl).hostname.split(".")[0] : "";
    const legacySessionKey = projectRef ? `sb-${projectRef}-auth-token` : "";
    for (const key of Object.keys(window.localStorage)) {
      if (key === "pipmaster-demo-v1:preview"
        || key.startsWith("pipmaster-demo-v1:")
        || (legacySessionKey && (key === legacySessionKey || key.startsWith(`${legacySessionKey}-`)))) {
        window.localStorage.removeItem(key);
      }
    }
  } catch (error) {
    console.error("Could not remove legacy PIPMASTER browser data.", error);
  }
}

export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
export const supabase = supabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: false,
        detectSessionInUrl: true,
      },
    })
  : null;
