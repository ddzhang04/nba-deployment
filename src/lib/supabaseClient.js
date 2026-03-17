import { createClient } from '@supabase/supabase-js';

// Frontend-only setup: these are safe to embed (public anon key).
// Env vars override these when available.
const FALLBACK_SUPABASE_URL = 'https://inrxvurdinlheinomoya.supabase.co';
const FALLBACK_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlucnh2dXJkaW5saGVpbm9tb3lhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NTc0NjMsImV4cCI6MjA4OTMzMzQ2M30.9HGJurYMwo0lw0bssEkHmhmtn_kfWe8_4357i8Jg0HI';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || FALLBACK_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || FALLBACK_SUPABASE_ANON_KEY;

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

