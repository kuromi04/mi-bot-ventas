# Global AI Fallback Specification

## Purpose
Ensure the bot is responsive to general inquiries that do not match specific menu paths.

## Requirements

### Requirement: Fallback Trigger
If a user message does NOT match a known intent (e.g., 'hola', 'menu') AND does NOT match a valid menu option for the current state, the bot MUST delegate the response to the AI (Gemini).

#### Scenario: General Question Fallback
- GIVEN the bot is in the 'inicio' state (welcome poll sent)
- WHEN the user sends "What are your opening hours?" (which is not an option in the poll)
- THEN the bot MUST use Gemini to answer the question instead of repeating the welcome poll or ignoring the message.

### Requirement: State Retention
Using the global fallback MUST NOT lose the user's current menu context unless the user explicitly requests to change state.

#### Scenario: Fallback then Menu
- GIVEN the user is in the 'compras' menu
- WHEN the user asks a side question "Do you have parking?"
- THEN the bot SHALL answer via AI AND SHOULD prompt to continue with the 'compras' flow.
