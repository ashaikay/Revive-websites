/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_REV_CALENDAR_OAUTH_UI_ENABLED?: 'true' | 'false';
  readonly VITE_REV_PROVIDER_MODE?: 'mock' | 'supabase';
  readonly VITE_REV_MEETING_LIVE_UI_ENABLED?: 'true' | 'false';
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
