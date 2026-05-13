# Yunhong Manual: Get the Full TrialLight Codebase from GitHub

This manual is written for a beginner.

The TrialLight codebase is not a single GitHub repository.
It is one main repository plus two Git submodules.

If you only download the main repository, you will **not** have the full codebase.
You must also fetch the two submodules.

## 1. What you need access to

You need GitHub access to all 3 repositories:

1. `IDP-For-Integration`
   - Main integration repository
   - URL: `https://github.com/yisheng10/IDP-For-Integration.git`

2. `IDP_PatientApp`
   - Patient app repository
   - URL: `https://github.com/yisheng10/IDP_PatientApp.git`

3. `Patient-Dropout-Prediction`
   - Dropout prediction repository
   - URL: `https://github.com/yisheng10/Patient-Dropout-Prediction.git`

Before doing anything else, confirm that:

- you can open all 3 repository pages in GitHub
- you are logged into the correct GitHub account

If any repo shows `404` or `You do not have access`, stop and ask for access first.

## 1.1 What access you will be given

The project owner will allow you to have the following access if needed for collaboration:

- Firebase project access
- Firebase Hosting deploy access
- Firebase Functions deploy access
- Supabase project access
- Supabase function deploy access
- Gemini or other API keys

Important rule:

- you are **not allowed to push directly to `main`**

Always work on your own branch.

## 2. Install the required tools

On Windows, install these first:

1. Git
   - Download from: `https://git-scm.com/download/win`
   - Use the default installer options

2. Visual Studio Code
   - Download from: `https://code.visualstudio.com/`

Optional:

3. GitHub Desktop
   - Download from: `https://desktop.github.com/`
   - Useful for viewing branches and changed files
   - Not required for the initial full clone

4. Node.js
   - Download from: `https://nodejs.org/en/download`
   - If you are unsure, install the current LTS version

5. Python 3.12
   - Download from: `https://www.python.org/downloads/windows/`
   - This is mainly needed if you will work in the dropout prediction repository

## 3. Create a folder for the project

Choose a local folder where you want the full TrialLight workspace to live.

Example:

```powershell
mkdir D:\TrialLight
cd D:\TrialLight
```

You do not need to use the same folder name as another developer.
The important part is that all repositories stay together inside the cloned workspace.

## 4. Clone the full codebase

Open **PowerShell** and run:

```powershell
git clone --recurse-submodules https://github.com/yisheng10/IDP-For-Integration.git
```

This is the most important command.

What it does:

- clones the main repository
- automatically downloads the two submodules

If you forget `--recurse-submodules`, you will get empty or incomplete submodule folders.

## 5. Open the project folder

After the clone finishes, go into the root folder:

```powershell
cd .\IDP-For-Integration
```

Then open it in VS Code:

```powershell
code .
```

## 5.1 Switch to the current collaboration branches

After opening the workspace, switch to the current working branches.

### Root repo

```powershell
git checkout codex/root-integration-sync-20260415
git pull
```

### Patient app submodule

```powershell
git -C .\MyClinicalApp_AndroidAPK_5Jan2026_2138\MyClinicalApp2 checkout codex/patient-app-sync-20260415
git -C .\MyClinicalApp_AndroidAPK_5Jan2026_2138\MyClinicalApp2 pull
```

### Dropout prediction submodule

```powershell
git -C .\Patient-Dropout-Prediction checkout codex/candidate-024-disengagement-hardening
git -C .\Patient-Dropout-Prediction pull
```

Why this matters:

- the root repository controls the workspace integration
- the patient app and dropout repositories also have their own active collaboration branches
- if you stay on the wrong branch, you may not see the latest shared work

## 6. Verify that you really have the full codebase

Inside the root folder, confirm that these folders exist and contain code:

1. Main repo:

- `src`
- `functions`
- `supabase`

2. Submodule repo 1:

- `MyClinicalApp_AndroidAPK_5Jan2026_2138\MyClinicalApp2`

3. Submodule repo 2:

- `Patient-Dropout-Prediction`

If either submodule folder looks empty or incomplete, run:

```powershell
git submodule update --init --recursive
```

## 7. What each repository is for

### Main repository: `IDP-For-Integration`

Main working areas:

- CRC web app: `src`, `public`
- Firebase Functions: `functions`
- Supabase functions: `supabase`
- documentation and scripts

### Submodule: `IDP_PatientApp`

Path inside the workspace:

- `MyClinicalApp_AndroidAPK_5Jan2026_2138\MyClinicalApp2`

Main working areas:

- patient mobile app
- patient ePRO UI
- patient adverse event guidance UI

### Submodule: `Patient-Dropout-Prediction`

Path inside the workspace:

- `Patient-Dropout-Prediction`

Main working areas:

- dropout prediction backend
- explainability
- publish pipeline
- live data adapter

## 8. How to get the latest updates later

When the team says “pull the latest code”, do this from the root repository:

```powershell
cd D:\TrialLight\IDP-For-Integration
git pull
git submodule sync --recursive
git submodule update --init --recursive
```

Use all 3 commands in that order.

Why:

- `git pull` updates the main repo
- `git submodule sync --recursive` refreshes submodule URLs if needed
- `git submodule update --init --recursive` moves submodules to the exact versions recorded by the main repo

## 9. If the submodule folders are already there but stale

Run:

```powershell
git submodule update --init --recursive
```

This is the safe fix in most cases.

## 10. If you cloned the main repo without submodules by mistake

Do this:

```powershell
cd D:\TrialLight\IDP-For-Integration
git submodule update --init --recursive
```

You do **not** need to delete the repo and start over unless it is badly broken.

## 11. What is NOT included automatically

GitHub will give you the code.
It will **not** automatically give you:

- private runtime secrets
- `.env.local`
- Firebase service account JSON
- Supabase service role key
- any local-only credential file

Those must be shared separately and carefully.

Do not assume that “clone succeeded” means “the app is ready to run”.

## 11.1 Environment files you will need

After cloning, you will still need local environment files.

### Root CRC web app

Create:

- `.env.local`

You can start from:

- `.env.example`

Main required values include:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_MEASUREMENT_ID`
- `VITE_GEMINI_API_KEY`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_WEB_PUSH_PUBLIC_KEY`

### Patient app

Create:

- `.env`

You can start from:

- `MyClinicalApp_AndroidAPK_5Jan2026_2138\MyClinicalApp2\.env.example`

Main required values include:

- `EXPO_PUBLIC_FIREBASE_API_KEY`
- `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `EXPO_PUBLIC_FIREBASE_PROJECT_ID`
- `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `EXPO_PUBLIC_FIREBASE_APP_ID`
- `EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID`
- `EXPO_PUBLIC_GEMINI_KEY_LABELS_COFFEE`
- `EXPO_PUBLIC_GEMINI_API_KEYS_COFFEE`
- `EXPO_PUBLIC_GEMINI_KEY_LABELS_MILO`
- `EXPO_PUBLIC_GEMINI_API_KEYS_MILO`
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

If any key or value is missing, ask the project owner.

## 11.2 Install dependencies

Run these commands after the clone finishes.

### Root repo

```powershell
cd D:\TrialLight\IDP-For-Integration
npm install
```

### Firebase Functions

```powershell
cd D:\TrialLight\IDP-For-Integration\functions
npm install
```

### Patient app

```powershell
cd D:\TrialLight\IDP-For-Integration\MyClinicalApp_AndroidAPK_5Jan2026_2138\MyClinicalApp2
npm install
```

### Dropout prediction repo

```powershell
cd D:\TrialLight\IDP-For-Integration\Patient-Dropout-Prediction
py -3.12 -m venv .venv312
.\.venv312\Scripts\Activate.ps1
pip install -r requirements.txt
```

The dropout repository has additional model-specific scripts and runbooks.
If you only need the CRC web app or patient app first, you can postpone the dropout setup.

## 11.3 Local preview instructions

### Preview the CRC web app

```powershell
cd D:\TrialLight\IDP-For-Integration
npm run dev
```

### Preview the patient app in web mode

```powershell
cd D:\TrialLight\IDP-For-Integration\MyClinicalApp_AndroidAPK_5Jan2026_2138\MyClinicalApp2
npx expo start --clear
```

If you only need a static patient web build:

```powershell
cd D:\TrialLight\IDP-For-Integration\MyClinicalApp_AndroidAPK_5Jan2026_2138\MyClinicalApp2
npm run export:web
```

### Work with Firebase Functions locally

Install dependencies first:

```powershell
cd D:\TrialLight\IDP-For-Integration\functions
npm install
```

Then use the Firebase tools workflow that the team agrees on.
Do not deploy production Functions unless the owner explicitly asked you to do it.

## 12. Simple first-day safety rules

Please follow these rules on day one:

1. Do not develop directly on `main`.
2. Create your own branch before editing code.
3. Do not push directly to `main`.
4. Do not deploy Firebase Hosting or Functions unless the team explicitly agreed.
5. Do not deploy production by yourself unless the owner explicitly asked you to.
6. Do not rename or move the submodule folders manually.
7. Do not copy files between repos by hand unless someone asked you to.

## 13. Useful commands

### Show current branch

```powershell
git branch --show-current
```

### Show changed files

```powershell
git status
```

### Create your own branch

```powershell
git checkout -b yunhong/your-feature-name
```

### Check submodule status

```powershell
git submodule status
```

## 14. Quick troubleshooting

### Problem: “I can open the main repo, but one submodule fails”

Cause:

- you do not have permission to that submodule repo

Fix:

- ask for GitHub access to the missing submodule repo

### Problem: “The folder exists but it is almost empty”

Cause:

- submodule was not initialized

Fix:

```powershell
git submodule update --init --recursive
```

### Problem: “I can clone, but the app still does not run”

Cause:

- you probably still need environment variables, credentials, and install steps

Fix:

- ask for the runtime setup instructions after the clone is complete

## 15. Minimum success checklist

You are ready for the next step only when all of these are true:

- you can open all 3 GitHub repositories
- `git clone --recurse-submodules ...` completed successfully
- both submodule folders contain code
- `git submodule status` returns normal output
- you can open the whole workspace in VS Code
- root dependencies are installed
- patient app dependencies are installed
- your environment files are present
- at least one local preview command runs successfully

If all of the above are true, then you have the full TrialLight codebase from GitHub.
