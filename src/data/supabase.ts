// The Supabase client. Null when the build has no Supabase settings, and the app runs device-only.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const env = import.meta.env ?? {};
const url = env.VITE_SUPABASE_URL, key = env.VITE_SUPABASE_KEY;

export const supabase: SupabaseClient | null = url && key
  ? createClient(url, key, {
    auth: {
      // Implicit flow: the email link works even if it opens in a different browser
      // than the one that asked for it (common with phone mail apps).
      flowType: 'implicit',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  })
  : null;

export const accountsOn = !!supabase;
