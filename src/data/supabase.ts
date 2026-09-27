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
      // Passkeys: needed on supabase-js 2.105 to 2.10x; later versions have them on and ignore this.
      experimental: { passkey: true },
    },
  })
  : null;

export const accountsOn = !!supabase;

/** Project URL and publishable key, for the few calls supabase-js doesn't wrap (auth settings). */
export const supabaseUrl: string = url || '';
export const supabaseKey: string = key || '';
