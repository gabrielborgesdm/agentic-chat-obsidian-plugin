# Proposal

## Why

The plugin only works with Apple Intelligence, but its Shortcuts bridge can run any Shortcut that takes text and returns text. Supporting ChatGPT through Shortcuts is the first step toward the multi-provider goal, and users need a clear way to pick a provider and set up its Shortcut without leaving Obsidian.

## What Changes

- Add a **Provider** setting that chooses which AI provider answers: Apple Intelligence or ChatGPT.
- Add **ChatGPT** as a provider, run through a user-created Shortcut (default name **ChatGPT Agent**) that uses the ChatGPT app's "Ask ChatGPT" action.
- Keep the Apple Intelligence options under the Apple provider: Private Cloud with on-device fallback, or on-device only.
- Let ChatGPT optionally fall back to the Apple on-device Shortcut when the ChatGPT Shortcut fails.
- Add in-app setup help for each provider: step-by-step Shortcut instructions shown in settings next to the provider, plus a way to test that provider's Shortcut.
- Rename the default Private Cloud Shortcut from **Local Agent Cloud** to **Cloud Agent**. Existing installs keep their saved name so nothing breaks; settings offers a one-tap switch to the new name.
- Make user-facing labels provider-neutral where they currently say "Apple Intelligence" or "Private Cloud" for generic behavior (status line, fallback notices, prompt budget).
- Update the README's Providers section to match (ChatGPT supported, Cloud Agent name).

## Capabilities

### New Capabilities
- `model-providers`: Which AI provider answers a request, how each provider's Shortcut is named and called, fallback between providers, and the settings that control this.
- `provider-setup-help`: In-app instructions and a test action that help the user create and verify the Shortcut for the selected provider.

### Modified Capabilities
<!-- None: the project has no existing specs. -->

## Impact

- **Code:** settings defaults and settings tab, model routing (`modelRoute` / cloud bridge), fallback and pause logic, the "Test bridge" command, status labels and notices, data migration on load.
- **Source availability:** the repo currently contains only the built `main.js`. The plugin's TypeScript source is needed to implement this change cleanly.
- **Users:** existing Apple Intelligence users keep working with no action. A new setting appears. Users still on "Local Agent Cloud" see a hint in settings to switch to "Cloud Agent" after renaming their Shortcut.
- **Dependencies:** none in code. ChatGPT users need the ChatGPT iOS app (which provides the Shortcuts action) and an OpenAI account.
- **Docs:** README Providers section.
