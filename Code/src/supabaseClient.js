// src/supabaseClient.js
import { createClient } from '@supabase/supabase-js';
import 'react-native-url-polyfill/auto'; // <--- ADD THIS LINE AT THE TOP
import { SUPABASE_KEY, SUPABASE_URL } from './config';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storage: null, // React Native handles storage differently (optional config)
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});