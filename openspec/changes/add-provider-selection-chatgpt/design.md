# Design

## Context

- Requests go through a Shortcuts bridge: the plugin opens `shortcuts://x-callback-url/run-shortcut?name=<name>&input=text&text=<prompt>` and gets the reply back on the `obsidian://local-agent` callback. Nothing in the bridge is Apple-specific; only the Shortcut's contents are.
- Routing today is `modelRoute()`: it returns a `primary` route (Private Cloud) and an optional `fallback` route (on-device), each with a bridge, a prompt budget and a label. The agent loop retries a failed step on the fallback route. After a Private Cloud failure, Private Cloud is paused for a while (`cloudPausedUntil`).
- Settings are one flat object (`modelMode`, `shortcutName`, `cloudShortcutName`, `promptCharBudget`, `cloudPromptCharBudget`, …) merged over defaults on load. Obsidian saves the whole object, so existing installs already have `cloudShortcutName: "Local Agent Cloud"` stored.
- The repo has only the built `main.js`. This design assumes the TypeScript source is available for implementation.

## Goals / Non-Goals

**Goals:**
- A provider abstraction small enough that adding Claude or Gemini later is a new entry, not new routing code.
- Zero behavior change for current Apple users who don't touch the new setting.

**Non-Goals:**
- Calling any provider's HTTP API directly or storing API keys. Every provider runs through a Shortcut.
- Changing the agent loop, tools, permissions or prompt format.
- Changing the plugin id `local-agent` (that would reset users' settings and chats).

## Decisions

**1. Provider registry.** Add a static list of providers, each describing: `id`, display name, the settings keys it owns (Shortcut name, budget), its default Shortcut name, its help steps, and a `route(settings)` function that returns `{primary, fallback?}` in the existing route shape.
- Apple's `route` is the current `modelRoute()` logic moved as-is.
- ChatGPT's `route` returns the ChatGPT Shortcut as primary, plus the on-device route as fallback only when its fallback setting is on.
- *Alternative:* `if (provider === "chatgpt")` branches in `modelRoute()`. Rejected: the help, defaults and labels would each need the same branches, and every new provider would touch all of them.

**2. Flat new settings keys, no nesting.** Add `provider: "apple" | "chatgpt"`, `chatgptShortcutName`, `chatgptPromptCharBudget`, `chatgptFallback`. Keep the existing Apple keys unchanged.
- *Why:* the existing load path (`Object.assign(defaults, saved)`) handles new flat keys with no migration code, and old settings keep working.

**3. Pause logic stays Apple-only.** The Private Cloud pause exists because Private Cloud fails in bursts (offline, quota). For ChatGPT, a failure falls back for that step only, with no pause. Revisit if ChatGPT shows the same pattern.

**4. Cloud Agent rename by default only.** Change the default `cloudShortcutName` to "Cloud Agent" and the empty-value fallback in settings. Don't rewrite saved values: a user whose Shortcut is still called "Local Agent Cloud" would break silently. Settings shows a hint plus a "Switch to Cloud Agent" button when the saved value equals the old default.

**5. Help lives in the provider registry and renders in settings.** Each provider defines its help as a list of steps with placeholders for the Shortcut names. The settings tab renders the selected provider's steps as an ordered list under the Provider dropdown and re-renders on change. The README is the long form of the same text.
- *Alternative:* a separate help modal. Rejected: the user wants the steps next to the fields they fill in.

**6. ChatGPT Shortcut uses the ChatGPT app's "Ask ChatGPT" action.** It takes text in and returns text out, which matches the bridge. "Show prompt" / "Start new chat" options are noted in the help so the action doesn't stop for input.
- *Alternative:* Apple Intelligence's "Use Model → ChatGPT" extension. Not the default because it requires Apple Intelligence hardware, which defeats the point of a separate provider. The help can mention it as an option.

**7. Test reuses the existing bridge test.** The "Test bridge" command already runs round-trip checks against a Shortcut name. The settings Test button runs its first check (PONG round trip) against the selected provider's Shortcut name and shows the result inline. The command palette entry becomes "Test provider" and tests the selected provider.

**8. "Set up <provider>" from chat errors** opens the plugin's settings tab via `app.setting.open()` + `app.setting.openTabById(manifest.id)`. These are unofficial but long-standing Obsidian APIs; if they're missing, show a Notice telling the user where to go.

## Risks / Trade-offs

- [ChatGPT action wording or options change in a ChatGPT app update] → Help text names the action and its key options only; the Test button catches breakage quickly.
- [ChatGPT's reply may add Markdown or chatter around the agent's JSON] → The existing parser already handles malformed replies by retrying; verify with the Test button and a tool-using request during implementation.
- [Each ChatGPT step switches apps, and ChatGPT is slower than on-device] → Keep the existing timeout; help warns about the app switch; Max steps stays user-controlled.
- [Prompt and vault content go to OpenAI] → Help states it plainly for ChatGPT, unlike the Apple options.
- [`app.setting` is not a public API] → Guarded with a fallback Notice (Decision 8).

## Migration Plan

- No data migration. New keys get defaults on load; `provider` defaults to Apple.
- Rollback: installing the previous build ignores the new keys; Apple settings are untouched.
