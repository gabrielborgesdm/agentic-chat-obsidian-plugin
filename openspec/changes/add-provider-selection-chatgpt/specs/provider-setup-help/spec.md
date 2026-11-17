# Spec Delta

## Purpose

Shows the user, inside Obsidian, how to create and check the Shortcut each provider needs, so setup works without reading the README.

## ADDED Requirements

### Requirement: Setup help per provider
The settings tab SHALL show setup help for the selected provider, directly under the Provider setting. Changing the provider SHALL replace the help with that provider's help.

#### Scenario: Switching provider
- **WHEN** the user changes the Provider setting from Apple Intelligence to ChatGPT
- **THEN** the Apple help is replaced by the ChatGPT help without leaving settings

### Requirement: Apple Intelligence help content
The Apple Intelligence help SHALL give numbered steps for two Shortcuts: the on-device Shortcut (Receive Text, Use Model with On-Device and Shortcut Input, Stop and Output the response) and the Cloud Agent Shortcut (the same steps with Private Cloud Compute), plus the tip to choose Cloud Pro when available and raise the Private Cloud budget.

#### Scenario: Help shows the configured names
- **GIVEN** the on-device Shortcut name is "Local Agent" and the Private Cloud name is "Cloud Agent"
- **WHEN** the user views the Apple help
- **THEN** the steps tell the user to name the Shortcuts "Local Agent" and "Cloud Agent"

### Requirement: ChatGPT help content
The ChatGPT help SHALL give numbered steps: install the ChatGPT app and sign in, create a Shortcut named with the configured ChatGPT name, set it to receive Text, add "Ask ChatGPT" with Shortcut Input as the message and the prompt shown to the user turned off, and end with Stop and Output of the reply. It SHALL also say that each request switches to the Shortcuts app and back.

#### Scenario: Help shows the configured name
- **GIVEN** the ChatGPT Shortcut name is "ChatGPT Agent"
- **WHEN** the user views the ChatGPT help
- **THEN** the steps tell the user to name the Shortcut "ChatGPT Agent"

### Requirement: Test the selected provider
Next to each provider's help, settings SHALL offer a Test button that runs that provider's Shortcut with a short known prompt and reports pass or fail with the reason.

#### Scenario: Test passes
- **WHEN** the user taps Test and the Shortcut returns the expected reply
- **THEN** settings shows that the Shortcut works

#### Scenario: Shortcut missing
- **WHEN** the user taps Test and the Shortcut does not exist or returns nothing
- **THEN** settings shows a failure with the reason and points to the setup steps

### Requirement: Help when a provider fails in chat
When a request fails because the provider's Shortcut is missing, times out, or returned no text, the chat error SHALL include a link or button that opens settings at that provider's setup help.

#### Scenario: ChatGPT Shortcut missing
- **WHEN** a ChatGPT request fails because the Shortcut is missing (it times out) or returned no text
- **THEN** the error in the chat offers "Set up ChatGPT", which opens the ChatGPT help in settings
