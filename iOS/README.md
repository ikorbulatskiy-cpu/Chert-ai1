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

## Create a signed IPA with GitHub Actions

The workflow `.github/workflows/ios-build.yml` always validates and builds an unsigned IPA. It also has an optional `Sign IPA for registered iPhone` job, which runs only when all four GitHub Actions secrets below exist and the workflow is started manually.

For installing directly on a registered iPhone, prepare an **Apple Development** certificate and an **iOS App Development** provisioning profile that includes that iPhone's UDID and the app identifier `ru.chertai.ios`. An Ad Hoc profile with an Apple Distribution certificate is also supported.

1. In the Apple Developer account, register the target iPhone UDID under Devices.
2. Create an Apple Development certificate and an iOS App Development provisioning profile for `ru.chertai.ios`. The profile must include the registered iPhone.
3. On a Mac, export the certificate **with its private key** from Keychain Access as a password-protected `.p12` file. Download the matching `.mobileprovision` profile.
4. In the GitHub repository, open **Settings → Secrets and variables → Actions → New repository secret**. Add:
   - `IOS_CERTIFICATE_P12_BASE64`: base64-encoded contents of the `.p12` file.
   - `IOS_CERTIFICATE_PASSWORD`: the password used when exporting the `.p12`.
   - `IOS_PROVISIONING_PROFILE_BASE64`: base64-encoded contents of the `.mobileprovision` file.
   - `IOS_TEAM_ID`: the 10-character Team ID from the Apple Developer account.
5. On macOS, create the two base64 values without line breaks:
   ```bash
   base64 -i Certificate.p12 | tr -d '\\n'
   base64 -i Profile.mobileprovision | tr -d '\\n'
   ```
   Paste each output into its matching GitHub secret. Never commit these files or paste their contents into chat.
6. In GitHub, open **Actions → iOS build and signed IPA → Run workflow**. When the signing secrets are valid, the run should produce an artifact named `ChertAI-signed-IPA`.
7. Download the artifact, extract `ChertAI-signed.ipa`, then install it using Apple Configurator or a compatible sideloading tool. A development-signed IPA can only install on devices included in its provisioning profile and may need periodic re-signing.

If the signing job is skipped, one or more secrets are missing. If it fails, inspect the signing job log; common causes are a certificate without its private key, a profile for a different bundle ID/team, or a device UDID missing from the profile.

## Current integration boundary

The app talks to the existing authenticated Chert backend. Galaxy login happens in Apple's in-app browser. The user manually copies visible conversation text and pastes it into the app. No Galaxy cookies, passwords, hidden browser storage, or undocumented endpoints are accessed.

The backend's current worker is a heartbeat process only. It is not an autonomous game bot. Automatic inbox reading and message sending remain unavailable until Mobstudio provides a supported integration interface.
