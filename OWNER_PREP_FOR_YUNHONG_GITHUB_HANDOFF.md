# Owner Preparation Checklist for Giving Yunhong the Full TrialLight Codebase

This checklist is for the current project owner.

Use it before asking Yunhong to clone the workspace.

## 1. Confirm the repository map

Before handoff, confirm that the GitHub structure is exactly this:

1. Main repo
   - `IDP-For-Integration`

2. Submodule repo
   - `IDP_PatientApp`

3. Submodule repo
   - `Patient-Dropout-Prediction`

If any active code is living outside these repos, the handoff is incomplete.

## 2. Make sure Yunhong has GitHub access to all 3 repos

This is the most common failure point.

Yunhong must be able to access:

- `https://github.com/yisheng10/IDP-For-Integration`
- `https://github.com/yisheng10/IDP_PatientApp`
- `https://github.com/yisheng10/Patient-Dropout-Prediction`

Ask Yunhong to confirm that all 3 pages open correctly while signed into GitHub.

## 3. Make sure the root repo has the correct submodule references

In the root repo, confirm that `.gitmodules` points to:

- `Patient-Dropout-Prediction`
- `MyClinicalApp_AndroidAPK_5Jan2026_2138/MyClinicalApp2`

If `.gitmodules` is outdated, Yunhong will clone the wrong thing.

## 4. Push your latest committed work first

Do not ask Yunhong to clone until:

- your main repo changes are committed and pushed
- the patient app submodule changes are committed and pushed
- the dropout prediction submodule changes are committed and pushed
- the root repo submodule pointers are updated and pushed

If you skip the last step, Yunhong may receive the old submodule versions even if the submodule repos themselves are up to date.

## 5. Check what “full codebase” really means

GitHub clone will include committed code only.

It will not include:

- uncommitted local edits
- local-only files
- `.env.local`
- secrets stored only on your machine
- local credential text files that should not be committed

If some important feature only exists in your uncommitted local state, Yunhong will not receive it.

## 6. Decide what secrets Yunhong actually needs

Separate this question from code access.

Code access and secret access are not the same thing.

Decide which of the following Yunhong really needs:

- Firebase project access
- Firebase Hosting deploy access
- Firebase Functions deploy access
- Supabase project access
- Supabase function deploy access
- Gemini or other API keys

Give only the minimum needed for his role.

## 7. Do not use GitHub as the secret handoff channel

Do not commit secrets into the repositories just so Yunhong can clone them.

Recommended approach:

- keep code in GitHub
- share secrets separately through a controlled channel
- document which local files Yunhong must create manually

## 8. Decide the collaboration rule before he starts coding

At minimum, decide these rules:

1. Which branch should Yunhong start from
2. What branch naming pattern to use
3. Whether Yunhong can push directly to `main`
4. Who is allowed to deploy production
5. Which folders or repos each person owns

Recommended minimum:

- nobody develops directly on `main`
- only one person deploys production
- patient app, CRC web, and dropout backend should have clear ownership boundaries

## 9. Tell Yunhong what to do after clone

After the clone succeeds, he will still need:

- install instructions
- environment file instructions
- local preview instructions
- which repo to edit for each feature

Without that, “full codebase received” still does not mean “ready to work”.

## 10. Your practical preparation checklist

Before sending the manual to Yunhong, make sure all boxes below are true:

- all 3 repos are accessible on GitHub
- latest code is pushed to all 3 repos
- root repo points to the correct submodule commits
- `.gitmodules` is correct
- you know which secrets Yunhong should receive
- you decided whether Yunhong may deploy anything
- you can clearly explain which repo owns which feature

## 11. Short message you can send to Yunhong

You can send something like this:

> Please clone the TrialLight workspace from GitHub using the onboarding manual.  
> The project is one main repository plus two submodules, so use the recursive clone command exactly as written.  
> If any of the three GitHub repos shows an access error, tell me before doing anything else.
