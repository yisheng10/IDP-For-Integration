# TrialLight Shareable Teammate Testing Deployment

> Legacy note: this document describes the earlier Render-based sharing path.
> The preferred long-term path is now documented in `SUPABASE_NO_RENDER_PREP.md`.
> Keep this file only as reference while the repository is transitioning away from Render.

This guide prepares two browser links for teammate UAT:

- CRC website: `https://triallight.web.app`
- patient web: `https://triallight-patient.web.app`

The deployment keeps TrialLight on the Firebase Spark plan and avoids Firebase Functions as a runtime dependency for Side Effect Guidance.

## 1. Prepare Your Gemini Key

Create a teammate-testing Gemini API key and restrict it to these HTTP referrers:

- `https://triallight.web.app/*`
- `https://triallight-patient.web.app/*`
- `http://localhost:5173/*`
- `http://localhost:8081/*`

This is a testing-only setup because the key is exposed to the browser.

## 2. Configure CRC Website Environment

Create or update `D:\IDP For Integration\.env.local`:

```env
VITE_GEMINI_API_KEY=replace_with_your_gemini_api_key
VITE_SIDE_EFFECT_GUIDANCE_PROVIDER=gemini-browser
VITE_SIDE_EFFECT_GUIDANCE_MODEL=gemini-2.5-flash
VITE_DROPOUT_SERVICE_BASE_URL=https://your-dropout-service.onrender.com
```

## 3. Configure Patient Web Environment

Create or update `D:\IDP For Integration\MyClinicalApp_AndroidAPK_5Jan2026_2138\MyClinicalApp2\.env`:

```env
EXPO_PUBLIC_GEMINI_API_KEY=replace_with_your_gemini_api_key
EXPO_PUBLIC_SIDE_EFFECT_GUIDANCE_PROVIDER=gemini-browser
EXPO_PUBLIC_SIDE_EFFECT_GUIDANCE_MODEL=gemini-2.5-flash
EXPO_PUBLIC_EPRO_BASE_URL=https://your-epro-service.onrender.com
```

## 4. Publish The ePRO Backend

The ePRO service is deploy-ready for a public Node web service.

Recommended service name:

- `triallight-epro`

Required environment variables:

- `SUPABASE_URL`
- `SUPABASE_KEY`
- optional `GEMINI_API_KEY`
- `ALLOWED_ORIGINS`

Recommended `ALLOWED_ORIGINS` value:

```text
https://triallight.web.app,https://triallight-patient.web.app,http://localhost:5173,http://localhost:8081
```

If you use Render, connect this repository and deploy the Node service from:

- `li qiu's part questionnaire ePRO`

The service must expose:

- `GET /healthz`
- `GET /api/epro/daily-survey?subject_id=...`
- `POST /api/epro/submit`

## 5. Publish The Dropout Backend

The dropout service is deploy-ready for a public Python web service.

Recommended service name:

- `triallight-dropout`

Required environment or runtime setup:

- Python `3.12.x`
- `ALLOWED_ORIGINS`
- Render or another platform-provided `PORT`
- `DROPOUT_DATA_PATH=deploy_assets/data/triallight_dropout_testing.csv`
- `DROPOUT_CHECKPOINTS_DIR=deploy_assets/checkpoints`

Recommended `ALLOWED_ORIGINS` value:

```text
https://triallight.web.app,https://triallight-patient.web.app,http://localhost:5173,http://localhost:8081
```

If you use Render, connect this repository and deploy the Python service from:

- `Patient-Dropout-Prediction`

The repository now includes a testing-only public deployment asset set:

- `Patient-Dropout-Prediction/deploy_assets/data/triallight_dropout_testing.csv`
- `Patient-Dropout-Prediction/deploy_assets/checkpoints/*`

This keeps teammate UAT lightweight and avoids publishing the full local research dataset.

The service must expose:

- `GET /healthz`
- `GET /dropout-risk/testing-subjects`
- `POST /dropout-risk/score`
- `POST /dropout-risk/batch-score`

## 6. Create The Second Firebase Hosting Site

Run this once:

```powershell
cd "D:\IDP For Integration"
npx.cmd firebase hosting:sites:create triallight-patient --project idp-authentication-7e8d7
```

## 7. Build And Deploy The Two Frontends

After both Render services are live and you know their final public URLs, update the local frontend env files first.

Root `D:\IDP For Integration\.env.local`:

```env
VITE_DROPOUT_SERVICE_BASE_URL=https://triallight-dropout.onrender.com
```

Patient `D:\IDP For Integration\MyClinicalApp_AndroidAPK_5Jan2026_2138\MyClinicalApp2\.env`:

```env
EXPO_PUBLIC_EPRO_BASE_URL=https://triallight-epro.onrender.com
```

Then run:

```powershell
cd "D:\IDP For Integration"
npm.cmd run build:shareable
npx.cmd firebase deploy --only hosting:crc,hosting:patient --project idp-authentication-7e8d7
```

This deploys:

- CRC website from root `dist`
- patient web from `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2/web-build`

## 8. Teammate Test Links

Share these links:

- CRC: `https://triallight.web.app`
- patient: `https://triallight-patient.web.app`

## 9. UAT Expectations

CRC link should support:

- login
- patient roster
- Side Effect Guidance
- Protocol Library
- Safety Inbox
- Patient Dropout Prediction

patient link should support:

- login
- Log Vitals
- History
- AI Side Effect Guidance
- ePRO
- My Appointments

## 10. Important Limits

- Browser push is not part of this Spark-plan teammate testing setup.
- Voice/video call works only for web-to-web testing while both pages remain open.
- Emergency phone escalation remains an external phone action, not in-app VoIP emergency handling.
- Render login and service creation still require your own account session in the Render dashboard.
