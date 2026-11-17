# Spec Delta

## Purpose

Decides which AI provider answers each chat request, which iOS/macOS Shortcut is run for it, and how the plugin falls back when a provider's Shortcut fails.

## ADDED Requirements

### Requirement: Provider selection
The plugin SHALL offer a Provider setting with the options Apple Intelligence and ChatGPT, and SHALL send every model call for a request to the selected provider's Shortcut.

#### Scenario: ChatGPT selected
- **WHEN** the Provider setting is ChatGPT and the user sends a message
- **THEN** the plugin runs the ChatGPT Shortcut with the prompt as text input
- **AND** the status line names ChatGPT while it waits

#### Scenario: Apple Intelligence selected
- **WHEN** the Provider setting is Apple Intelligence and the user sends a message
- **THEN** the plugin runs the Apple Shortcut chosen by the Apple model option, as it does today

### Requirement: Default provider for existing installs
The plugin SHALL default the Provider setting to Apple Intelligence when no provider has been saved, so existing installs behave as before the change.

#### Scenario: Upgrade from a version without providers
- **GIVEN** saved settings with no provider field
- **WHEN** the plugin loads
- **THEN** the Provider setting is Apple Intelligence and the saved Apple options and Shortcut names are unchanged

### Requirement: Apple Intelligence model options
When the provider is Apple Intelligence, the plugin SHALL offer the model options "Private Cloud, on-device fallback" and "On-device only", with the same routing, fallback and pause behavior as before this change.

#### Scenario: Private Cloud fails
- **GIVEN** provider Apple Intelligence with "Private Cloud, on-device fallback"
- **WHEN** the Private Cloud Shortcut fails
- **THEN** the plugin retries the step with the on-device Shortcut and pauses Private Cloud as before

### Requirement: ChatGPT Shortcut name
The plugin SHALL let the user set the ChatGPT Shortcut name, defaulting to "ChatGPT Agent".

#### Scenario: Custom name
- **WHEN** the user sets the ChatGPT Shortcut name to "My GPT"
- **THEN** ChatGPT requests run the Shortcut named "My GPT"

#### Scenario: Empty name
- **WHEN** the user clears the ChatGPT Shortcut name
- **THEN** the plugin uses "ChatGPT Agent"

### Requirement: ChatGPT fallback to on-device
The plugin SHALL offer a ChatGPT setting "Fall back to Apple on-device", off by default. When on and the ChatGPT Shortcut fails for any reason other than user cancel, the plugin SHALL retry that step with the Apple on-device Shortcut and tell the user.

#### Scenario: Fallback on
- **GIVEN** provider ChatGPT with fallback on
- **WHEN** the ChatGPT Shortcut returns an error
- **THEN** the plugin retries the step with the on-device Shortcut and shows a notice naming both Shortcuts

#### Scenario: Fallback off
- **GIVEN** provider ChatGPT with fallback off
- **WHEN** the ChatGPT Shortcut returns an error
- **THEN** the request ends with an error message that includes the Shortcut's error text

#### Scenario: User cancels
- **WHEN** the user cancels the ChatGPT Shortcut
- **THEN** the plugin does not fall back

### Requirement: ChatGPT prompt budget
The plugin SHALL keep a separate prompt character budget for ChatGPT, defaulting to 30000 characters, and SHALL use the on-device budget when a step falls back to the on-device Shortcut.

#### Scenario: Long chat with ChatGPT
- **WHEN** a ChatGPT request's prompt would exceed the ChatGPT budget
- **THEN** the plugin trims context to fit the ChatGPT budget

### Requirement: Cloud Agent default Shortcut name
The default name of the Apple Private Cloud Shortcut SHALL be "Cloud Agent". The plugin SHALL NOT change a Private Cloud Shortcut name that is already saved.

#### Scenario: New install
- **WHEN** the plugin is installed with no saved settings
- **THEN** the Private Cloud Shortcut name is "Cloud Agent"

#### Scenario: Existing install on the old default
- **GIVEN** a saved Private Cloud Shortcut name of "Local Agent Cloud"
- **WHEN** the plugin loads
- **THEN** the saved name stays "Local Agent Cloud" and requests keep working

#### Scenario: Empty name
- **WHEN** the user clears the Private Cloud Shortcut name
- **THEN** the plugin uses "Cloud Agent"

### Requirement: Switch to the new Cloud Agent name
When the saved Private Cloud Shortcut name is "Local Agent Cloud", settings SHALL show a hint to rename the Shortcut to "Cloud Agent" in the Shortcuts app, with a button that sets the plugin's name to "Cloud Agent".

#### Scenario: User switches
- **GIVEN** the saved name is "Local Agent Cloud"
- **WHEN** the user taps the switch button
- **THEN** the saved name becomes "Cloud Agent" and the hint disappears

### Requirement: Provider-neutral labels
User-facing text that describes generic agent behavior SHALL name the active provider instead of assuming Apple Intelligence.

#### Scenario: Fallback notice with ChatGPT
- **WHEN** a ChatGPT step falls back to on-device
- **THEN** the notice names the ChatGPT Shortcut, not Private Cloud
