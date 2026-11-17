# Agentic Chat for Obsidian

Chat with an AI agent that can read, search and edit your vault, on iPhone, iPad and Mac.

The plugin doesn't call any AI service itself. It sends your message to an **iOS/macOS Shortcut**, and the Shortcut talks to the model. So any provider you can use in Shortcuts can power the agent.

## Providers

| Provider | Status |
| --- | --- |
| Apple Intelligence (on-device) | ✅ Supported |
| Apple Intelligence (Private Cloud Compute) | ✅ Supported |
| ChatGPT, Claude, Gemini, others | 🚧 Planned |

## What it can do

- Answer questions using your notes
- Create, append to, edit, rename and move notes (it asks first, unless you turn that off)
- Undo any change it made
- Read answers aloud
- Attach photos and files

## Setup

1. Copy `main.js`, `manifest.json` and `styles.css` to `<vault>/.obsidian/plugins/local-agent/`.
2. Enable **Local Agent** in Obsidian → Settings → Community plugins.
3. In the Shortcuts app, create a Shortcut that:
   - receives text as input,
   - sends it to a model (e.g. **Use Model**),
   - returns the model's reply.
4. Put that Shortcut's name in the plugin settings.
5. Run the command **Test bridge** to check it works.

## How it works

```
Obsidian ──text──▶ Shortcut ──▶ AI model
    ▲                              │
    └────────── reply ◀────────────┘
```

Each model call opens the Shortcuts app and comes back to Obsidian. Keep **Max steps per request** low so it doesn't bounce too often.
