export const APP_NAME = 'TrialLight';
export const APP_ICON = 'triallight-crc-favicon.svg';
export const APP_BACKGROUND_IMAGE = 'Background.jpg';

export const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';
export const SIDE_EFFECT_GUIDANCE_PROVIDER =
  import.meta.env.VITE_SIDE_EFFECT_GUIDANCE_PROVIDER || 'firebase-callable';
export const SIDE_EFFECT_GUIDANCE_MODEL =
  import.meta.env.VITE_SIDE_EFFECT_GUIDANCE_MODEL || 'gemini-2.5-flash';

export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || 'https://fygkqituefwldmglijvy.supabase.co';
export const SUPABASE_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5Z2txaXR1ZWZ3bGRtZ2xpanZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY1MDEyNjQsImV4cCI6MjA4MjA3NzI2NH0.1WvXWCFA--ZAhL9bBwVl5D-bshQHc5z4F0BngqSeRIA';

export const DROPOUT_RUNTIME = import.meta.env.VITE_DROPOUT_RUNTIME || 'firestore-mirror';
