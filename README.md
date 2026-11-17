# Agentic Chat for Obsidian

Chat with an AI agent that can read, search and edit your vault, on iPhone, iPad and Mac.

The plugin doesn't call any AI service itself. It sends your message to an **iOS/macOS Shortcut**, and the Shortcut talks to the model. So any provider you can use in Shortcuts can power the agent.

## What it can do

- Answer questions using your notes
- Create, append to, edit, rename and move notes (it asks first, unless you turn that off)
- Undo any change it made
- Read answers aloud
- Attach photos and files

## Setup

1. Copy `main.js`, `manifest.json` and `styles.css` to `<vault>/.obsidian/plugins/local-agent/`.
2. Enable **Local Agent** in Obsidian → Settings → Community plugins.
3. Create the Shortcut for your provider (see [Providers](#providers)).
4. Run the command **Test bridge** to check it works.

## Providers

| Provider | Status |
| --- | --- |
| Apple Intelligence: on-device | ✅ Supported |
| Apple Intelligence: Private Cloud | ✅ Supported |
| ChatGPT, Claude, Gemini, others | 🚧 Planned |

Both Apple options need a device with Apple Intelligence turned on.

### Apple Intelligence: on-device

Free, offline and private, but a small model with a small context window.

1. In the Shortcuts app, create a new Shortcut named **Local Agent**.
2. Tap the **ⓘ** button and set **Receive** to **Text**.
3. Add **Use Model**. Set the model to **On-Device** and the prompt to **Shortcut Input**.
4. Add **Stop and Output** with **Response** from the step above.
5. In the plugin settings, set **Model** to **On-device only**.

### Apple Intelligence: Private Cloud

Apple's larger model. Free and private (Apple doesn't store your data), but needs internet. Recommended.

1. In the Shortcuts app, create a new Shortcut named **Local Agent Cloud**.
2. Tap the **ⓘ** button and set **Receive** to **Text**.
3. Add **Use Model**. Set the model to **Private Cloud Compute** and the prompt to **Shortcut Input**.
4. Add **Stop and Output** with **Response** from the step above.
5. In the plugin settings, set **Model** to **Private Cloud, on-device fallback**.

Tips:

- Also set up the on-device Shortcut. The plugin falls back to it when the cloud is unavailable.
- If your device offers **Cloud Pro**, pick it in step 3 (larger context, better at following instructions) and raise **Private Cloud prompt budget** to about 30000.

You can use other Shortcut names, as long as they match the names in the plugin settings.

## How it works

```
Obsidian ──text──▶ Shortcut ──▶ AI model
    ▲                              │
    └────────── reply ◀────────────┘
```

Each model call opens the Shortcuts app and comes back to Obsidian. Keep **Max steps per request** low so it doesn't bounce too often.
