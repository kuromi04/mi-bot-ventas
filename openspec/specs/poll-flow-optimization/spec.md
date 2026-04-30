# Poll Flow Optimization Specification

## Purpose
Improve the user experience when interacting with WhatsApp Polls to prevent perceived redundancy.

## Requirements

### Requirement: Clear Poll Instructions
Every poll message MUST include clear instructional text in the header.

#### Scenario: Poll Instruction Text
- GIVEN a poll is sent to the user
- WHEN the poll name is generated
- THEN it SHALL include "Haga clic en una opción abajo" or similar.

### Requirement: Instant Vote Processing
The bot MUST process poll votes silently (without echoing the choice as a new message from the bot) and transition to the next state immediately.

#### Scenario: Smooth Transition
- GIVEN a user votes in a poll
- WHEN the `pollUpdateMessage` is received
- THEN the bot SHALL update the `userState` AND send the next relevant message without an intermediate "You chose X" confirmation unless medically necessary.

### Requirement: Poll Choice Normalization
The bot MUST robustly match poll options even if they contain emojis or numbering.

#### Scenario: Robust Option Matching
- GIVEN a poll option "1. 🛍️ Compras"
- WHEN the vote is received
- THEN the bot SHALL correctly identify this as the "compras" transition.
