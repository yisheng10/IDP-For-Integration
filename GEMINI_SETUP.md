# Gemini Key Setup

TrialLight v1 testing now uses direct browser/app Gemini access so the project can run without Firebase Blaze.

## Security note

This setup is for teammate testing only.

- The Gemini API key is exposed to the browser or Expo web bundle.
- Do not treat this as a production-safe deployment pattern.
- Rotate the key before any broader release.

## CRC website

Create `D:\IDP For Integration\.env.local`:

```env
VITE_GEMINI_API_KEY=your_gemini_api_key
VITE_SIDE_EFFECT_GUIDANCE_PROVIDER=gemini-browser
VITE_SIDE_EFFECT_GUIDANCE_MODEL=gemini-2.5-flash
VITE_DROPOUT_SERVICE_BASE_URL=http://127.0.0.1:8000
```

Restart the CRC website dev server after editing the file.

## Patient app

Create `D:\IDP For Integration\MyClinicalApp_AndroidAPK_5Jan2026_2138\MyClinicalApp2\.env`:

```env
EXPO_PUBLIC_GEMINI_API_KEY=your_gemini_api_key
EXPO_PUBLIC_SIDE_EFFECT_GUIDANCE_PROVIDER=gemini-browser
EXPO_PUBLIC_SIDE_EFFECT_GUIDANCE_MODEL=gemini-2.5-flash
```

Restart Expo after editing the file.

## Where the key is used

- CRC Side Effect Guidance
- CRC appointment date suggestion
- Patient AI Side Effect Guidance
- Patient appointment suggestion and symptom extraction paths that use Gemini

## How to replace the current key

1. Generate or choose your Gemini API key in your own Google AI Studio account.
2. Put the key into the two local env files above.
3. Restart `npm.cmd run dev` for the CRC website.
4. Restart `npm.cmd start -c` for the patient app.
5. Confirm the AI features answer normally and no longer depend on any previously hardcoded key.
