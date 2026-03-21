export const APP_NAME = "TrialLight"; 
// export const APP_ICON = "https://cdn-icons-png.flaticon.com/512/3063/3063176.png"; 
export const APP_ICON = "icon.png"; 
export const APP_BACKGROUND_IMAGE = "Background.jpg"; 

// 🚨 PASTE YOUR KEYS HERE
// export const GEMINI_API_KEY = "AIzaSyDkJ_TF5lN1MwtbZKuNGf387zotbFVnh9c";
// export const GEMINI_API_KEY = "AIzaSyAaE3iXBNfrxDt2SVYv9Zxn3lE5NaGo6Nc";
// export const GEMINI_API_KEY = "AIzaSyD6Sn6EqE8goE6EeHeaOVbZDhxvksg10Go";
// export const GEMINI_API_KEY = "AIzaSyAwz-SJ5Btxk00sIljOY9PEpw5qN7vU7G8";	// main
// export const GEMINI_API_KEY = "AIzaSyDCJ2owMKhfmi_TLKcDgLcz5DXKA_uPRAQ";	// siswamail
export const GEMINI_API_KEY = "AIzaSyAwJ76zvQ_QcNZJBcMNDhYJlpyGEhyCsTo";	// gemini alt

export const SUPABASE_URL = "https://fygkqituefwldmglijvy.supabase.co"; 
export const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5Z2txaXR1ZWZ3bGRtZ2xpanZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY1MDEyNjQsImV4cCI6MjA4MjA3NzI2NH0.1WvXWCFA--ZAhL9bBwVl5D-bshQHc5z4F0BngqSeRIA";
export const OLLAMA_BASE_URL = (import.meta.env.VITE_OLLAMA_BASE_URL || "http://localhost:11434").replace(/\/$/, "");
export const OLLAMA_MODEL = import.meta.env.VITE_OLLAMA_MODEL || "qwen3:8b";
