# Tasks

## 1. Source and settings

- [x] 1.1 Add the plugin's TypeScript source and build setup to the repo, and verify the build produces a `main.js` that behaves like the current one (chat, Test bridge, Private Cloud fallback)
- [x] 1.2 Add settings keys `provider` (default `apple`), `chatgptShortcutName` (default "ChatGPT Agent"), `chatgptPromptCharBudget` (default 30000), `chatgptFallback` (default off); verify loading an old `data.json` with none of these keys yields Apple provider and unchanged Apple values
- [x] 1.3 Change the default `cloudShortcutName` and its empty-value fallback to "Cloud Agent"; verify a fresh install shows "Cloud Agent" and a saved "Local Agent Cloud" is left as is

## 2. Provider routing

- [x] 2.1 Add the provider registry and move the current `modelRoute()` logic into the Apple provider's `route`; verify Apple requests, Private Cloud fallback and the pause behave exactly as before
- [x] 2.2 Add the ChatGPT provider `route`: ChatGPT Shortcut as primary with the ChatGPT budget, on-device fallback only when `chatgptFallback` is on; verify a request runs "ChatGPT Agent", and that a failing Shortcut falls back with fallback on and errors with fallback off
- [x] 2.3 Skip fallback on user cancel and keep the Private Cloud pause Apple-only; verify cancelling a ChatGPT Shortcut ends the request without fallback and does not pause anything
- [x] 2.4 Make status labels and fallback notices use the active provider's label and Shortcut name; verify the status line reads "Thinking · ChatGPT…" and the fallback notice names the ChatGPT Shortcut

## 3. Settings UI and in-app help

- [ ] 3.1 Add the Provider dropdown at the top of the model section; show Apple fields (model option, both Shortcut names, budgets) only for Apple and ChatGPT fields (name, budget, fallback toggle) only for ChatGPT; verify switching providers swaps the fields without reopening settings
- [ ] 3.2 Render the selected provider's help steps under the dropdown, filling in the configured Shortcut names; verify Apple help shows "Local Agent" and "Cloud Agent" steps plus the Cloud Pro tip, and ChatGPT help shows the "Ask ChatGPT" steps, the app-switch note and the data-goes-to-OpenAI note
- [ ] 3.3 Show the "Switch to Cloud Agent" hint and button when the Private Cloud name is "Local Agent Cloud"; verify tapping it saves "Cloud Agent" and hides the hint
- [ ] 3.4 Add a Test button per provider that runs the PONG round trip on that provider's Shortcut and shows pass/fail inline; rename the command to "Test provider"; verify pass with a working Shortcut and a clear failure with a missing one

## 4. Chat error help

- [ ] 4.1 For "Shortcut missing" and "no text returned" errors, add a "Set up <provider>" action that opens the plugin's settings tab, with a Notice fallback if the settings API is unavailable; verify on iPhone that it opens the right help

## 5. Docs and release

- [x] 5.1 Update the README Providers section: ChatGPT marked supported with its setup steps, Private Cloud Shortcut named "Cloud Agent", note about renaming from "Local Agent Cloud"; verify the steps match the in-app help text
- [x] 5.2 Bump `manifest.json` version to 0.3.0
- [ ] 5.3 End-to-end check on iPhone: one Apple Private Cloud chat, one on-device chat, one ChatGPT chat that creates a note, and one ChatGPT chat with the Shortcut renamed (fallback on and off)

## Workflow follow-up

- Archive the change after review.
