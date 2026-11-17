# Local Agent Bridge: build the Shortcut (one time, ~3 minutes)

Windows can't create signed `.shortcut` files, so you build this once on the iPhone. It has **2 actions**.

## Needs
- iPhone with Apple Intelligence on (iPhone 15 Pro or newer), iOS 26 or later.
- Settings → Apple Intelligence & Siri → turned on.

## Steps
1. Open the **Shortcuts** app → tap **+** (top right).
2. Tap the title at the top → **Rename** → type exactly: `Local Agent` (capital L and A, one space).
3. Tap **Add Action** → search **Use Model** → tap it.
4. In the action, tap the model name and choose **On-Device**.
5. Tap the prompt field. Delete any text, then tap **Variables** (or the magic-variable bar) → choose **Shortcut Input**.
6. Tap the ⌄ arrow on the action to expand it. Set **Follow Up** to **Off**. Leave "Response Format" as **Text**.
7. Tap **+** below → search **Stop and Output** → tap it. Make sure its output is the **Response** from the Use Model action (it normally fills in automatically). If it says "If there's nothing to output", pick **Do Nothing**.
8. Tap the ⓘ (shortcut settings) → make sure **Receive input from: Quick Actions / Share Sheet** includes **Text** (default is fine).
9. Tap **Done**.

The finished shortcut reads:
```
Use Model (On-Device)  ← prompt: Shortcut Input
Stop and Output        ← Response
```

## First test
Open Obsidian → command palette → **Local Agent: Test provider (Shortcut round trip)** → **Run tests**. (Settings → Local Agent → **Test** runs a quick version.)
iOS will ask permission twice, once to let Obsidian open Shortcuts and once to let Shortcuts open Obsidian. Tap **Allow** or **Open** each time.

## Second shortcut: Private Cloud (default model, ~1 minute)
The plugin uses Apple's **Private Cloud Compute** model first. It is free, private and much better at following instructions, and needs internet. When it fails or you're offline, the plugin automatically uses the on-device `Local Agent` shortcut.

1. In Shortcuts, press and hold **Local Agent** → **Duplicate**.
2. Open the copy → rename it exactly `Cloud Agent`. (Older installs used `Local Agent Cloud`. That still works until you tap **Switch** in the plugin settings.)
3. In its **Use Model** action, tap **On-Device** and change it to **Cloud Pro** (recommended: extended context, best instruction-following) or **Cloud**. Leave "Broad World Knowledge" off. With Cloud Pro, raise *Private Cloud prompt budget* in the plugin settings to ~30000.
4. Done. Run **Local Agent: Test provider** again; test 6 checks it.

To use only the on-device model: Obsidian → Settings → Local Agent → Provider **Apple Intelligence** → **Model** → *On-device only*.

## ChatGPT (optional provider, ~2 minutes)
Pick **ChatGPT** under Settings → Local Agent → **Provider**. The setup steps are shown right there too.

1. Install the **ChatGPT** app and sign in.
2. In Shortcuts → **+** → rename it exactly `ChatGPT Agent`.
3. Add the **Ask ChatGPT** action. Set its message to **Shortcut Input**. If it offers to show or ask for a prompt, turn that off.
4. Add **Stop and Output** with ChatGPT's response.
5. Back in Obsidian settings, tap **Test**.

Your question and the notes the agent reads are sent to OpenAI. Turn on **Fall back to Apple on-device** if you want requests to keep working when ChatGPT is unavailable.

Voice input: use the 🎤 key on the iPhone keyboard (iOS doesn't let plugins use the microphone directly).

## Troubleshooting
| Symptom | Fix |
|---|---|
| "Shortcut not found" | The name must be exactly `Local Agent`, or change it in plugin settings. |
| Returns to Obsidian with "no text" | The last action must be **Stop and Output** with the Use Model **Response**. |
| Nothing happens when sending | Settings → Shortcuts → Advanced → turn on **Allow Running Scripts**/allow sharing if it's offered. Check Apple Intelligence is enabled and the model has finished downloading. |
| Test 5 fails but 1–4 pass | Normal: the on-device model has a small context window. Lower "Prompt size budget" in plugin settings. |

## Shortcut to open the chat directly (deep link)
Link (this vault): `obsidian://local-agent-chat?vault=Personal`

Variants:
- New conversation: `obsidian://local-agent-chat?vault=Personal&new=1`
- Prefilled text: `...&q=Resumo%20do%20meu%20dia`
- Prefilled and sent immediately: `...&q=Resumo%20do%20meu%20dia&send=1`

Make it a one-tap launcher:
1. Shortcuts → **+** → name it `Abrir Agente`.
2. Add the action **Open URLs** and paste the link above.
3. Use it from the Home Screen (share icon → **Add to Home Screen**), the Action Button (Settings → Action Button → Shortcut), Lock Screen/Control Center controls, or Siri ("Abrir Agente").

To ask by voice: add **Dictate Text** first, then **URL** = `obsidian://local-agent-chat?vault=Personal&send=1&q=` followed by the Dictated Text (use **URL Encode** on it), then **Open URLs**.
