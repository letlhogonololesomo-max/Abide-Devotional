// =====================================================================
// Abide — Configuration
// =====================================================================
// The Supabase ANON key is designed to be public; security comes from RLS.
// The OneSignal App ID is public by design.
// Sensitive keys (if any are reintroduced later) live ONLY in Supabase
// Edge Function secrets — never in this file.
// =====================================================================

window.ABIDE_CONFIG = {
  // From Supabase: Settings → API
  SUPABASE_URL:      'https://pxrkhxvjqwfmjhuohigh.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB4cmtoeHZqcXdmbWpodW9oaWdoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3MjUwMTcsImV4cCI6MjA5MzMwMTAxN30.cIdJA31lKOhSUhtCW1h92X82EQHgikD1y_yG7h47qY4',

  // From OneSignal: Settings → Keys & IDs (set this when you add OneSignal)
  // Leave as null until then; the app will skip notification setup.
  ONESIGNAL_APP_ID: null,

  // Default translation hint — used as a label only. The app no longer
  // fetches passages automatically; you paste verses yourself in both
  // the devotion Scripture step and when adding memorisation verses.
  DEFAULT_TRANSLATION: 'NIV'
};
