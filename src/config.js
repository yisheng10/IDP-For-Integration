export const APP_NAME = 'My Clinical App';
export const APP_ICON = 'https://cdn-icons-png.flaticon.com/512/3063/3063176.png';
export const APP_BACKGROUND_IMAGE =
  'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?ixlib=rb-1.2.1&auto=format&fit=crop&w=1950&q=80';

export const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY || '';
export const SIDE_EFFECT_GUIDANCE_PROVIDER =
  process.env.EXPO_PUBLIC_SIDE_EFFECT_GUIDANCE_PROVIDER || 'gemini-browser';
export const SIDE_EFFECT_GUIDANCE_MODEL =
  process.env.EXPO_PUBLIC_SIDE_EFFECT_GUIDANCE_MODEL || 'gemini-2.5-flash';

export const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://fygkqituefwldmglijvy.supabase.co';
export const SUPABASE_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5Z2txaXR1ZWZ3bGRtZ2xpanZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY1MDEyNjQsImV4cCI6MjA4MjA3NzI2NH0.1WvXWCFA--ZAhL9bBwVl5D-bshQHc5z4F0BngqSeRIA';

export const EPRO_RUNTIME = process.env.EXPO_PUBLIC_EPRO_RUNTIME || 'supabase-edge';
