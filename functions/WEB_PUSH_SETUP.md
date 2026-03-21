# Browser Push Setup

## Local Files

- Root web env: `D:\IDP For Integration\.env.local`
- Functions env: `D:\IDP For Integration\functions\.env`

## Required Variables

### Web

```text
VITE_WEB_PUSH_PUBLIC_KEY
```

### Functions

```text
WEB_PUSH_PUBLIC_KEY
WEB_PUSH_PRIVATE_KEY
WEB_PUSH_CONTACT_EMAIL
```

## Regenerate VAPID Keys

```powershell
cd "D:\IDP For Integration\functions"
npx web-push generate-vapid-keys
```

After generating a new keypair:

1. Copy the public key into `D:\IDP For Integration\.env.local`
2. Copy the public key into `D:\IDP For Integration\functions\.env`
3. Copy the private key into `D:\IDP For Integration\functions\.env`
4. Replace `WEB_PUSH_CONTACT_EMAIL` with a monitored address before production deployment

## Deploy

```powershell
cd "D:\IDP For Integration"
npx firebase deploy --only functions,hosting
```

## CRC Verification

1. Start the CRC web app
2. Log in as a CRC user
3. Open the Safety Inbox
4. Click `Enable Alerts`
5. Confirm that a document appears under `users/{uid}/web_push_subscriptions/*`
6. Trigger a serious incident and confirm that the browser receives the push
