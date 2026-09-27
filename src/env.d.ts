// Build-time settings from Vite. Set in .env.production (both values are public by design).
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_KEY?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
