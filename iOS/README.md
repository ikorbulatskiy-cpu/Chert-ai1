# Chert AI for iPhone

Native SwiftUI iOS client for the existing Chert-ai1 backend.

## Included

- Native iPhone interface (not a web wrapper).
- In-app official Galaxy browser using Apple's Safari Services.
- Backend status and worker controls.
- API token stored in iOS Keychain, not UserDefaults.
- Manual copy/paste import of visible Galaxy chat text.
- AI reply draft display and copy action. The app never sends a reply into Galaxy.

## Build

Open `ChertAI.xcodeproj` in Xcode 15 or newer on a Mac. Select the `ChertAI` scheme, set your Apple Developer Team under Signing & Capabilities, then build to a connected iPhone. A signed device build or TestFlight distribution requires Apple signing credentials.

This repository does not contain signing certificates or provisioning profiles.

## Current integration boundary

The app talks to the existing authenticated Chert backend. Galaxy login happens in Apple's in-app browser. The user manually copies visible conversation text and pastes it into the app. No Galaxy cookies, passwords, hidden browser storage, or undocumented endpoints are accessed.

The backend's current worker is a heartbeat process only. It is not an autonomous game bot. Automatic inbox reading and message sending remain unavailable until Mobstudio provides a supported integration interface.
