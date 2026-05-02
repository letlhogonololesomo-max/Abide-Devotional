// =====================================================================
// Abide — Configuration
// =====================================================================
// Fill in your keys below. None of these keys are sensitive enough that
// exposing them in client-side code is a problem:
//   - Supabase ANON key is designed to be public; security comes from RLS
//   - OneSignal App ID is public by design
//
// The truly sensitive keys (API.Bible, ESV, OneSignal REST key) live
// only in Supabase Edge Function secrets — never in this file.
// =====================================================================

window.ABIDE_CONFIG = {
  // From Supabase: Settings → API
  SUPABASE_URL:      'https://YOUR-PROJECT.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR-ANON-KEY-HERE',

  // From OneSignal: Settings → Keys & IDs (set this when you add OneSignal)
  // Leave as null until then; the app will skip notification setup.
  ONESIGNAL_APP_ID: null,

  // Default translation. User can change this in-app later.
  DEFAULT_TRANSLATION: 'NIV',

  // Available translations (must match what your API.Bible plan covers
  // and what your Edge Function knows about)
  TRANSLATIONS: ['NIV', 'ESV', 'MSG'],
};
