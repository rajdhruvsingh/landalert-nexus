# LandAlert-Nexus Mobile Application Architecture & Deployment Guide
**System:** LandAlert-Nexus (SIH26001 — Northeast India Landslide Early Warning System)  
**Architecture:** Capacitor Native Hybrid Shell wrapping PWA / Responsive Console  
**Package:** `in.gov.landalert.nexus`  
**Status:** Android Project Configured & Synced · Native Plugins Verified · Store Publishing Pending Credentials  
**Last Updated:** September 2026

---

## 1. Scope & Architectural Philosophy: Why Capacitor over a From-Scratch Native App

In early-warning systems, code duplication between separate web and mobile codebases is an operational hazard:
- Maintaining separate native applications (e.g. Kotlin/Swift or React Native) from scratch introduces logic drift, divergent threshold arithmetic, duplicate i18n localization maintenance across 4 languages, and delayed emergency patches.
- **LandAlert-Nexus wraps the single authoritative responsive web application using Capacitor (`@capacitor/core`, `@capacitor/android`, `@capacitor/ios`)**. This produces real, installable Android (`.apk` / `.aab`) and iOS app shells from the exact same codebase.
- Hardware APIs (GPS geolocation for field observation tagging, camera and gallery media upload) are mediated via official Capacitor native plugins (`@capacitor/geolocation`, `@capacitor/camera`), with automatic fallback to standard W3C Web APIs when running in browser environments.

---

## 2. Hardware Capabilities & Plugin Integration

| Feature | Mobile Native Implementation | Web / Browser Fallback | Consent & Safety Controls |
| :--- | :--- | :--- | :--- |
| **Ground Geotagging** | `@capacitor/geolocation` requesting Android `ACCESS_FINE_LOCATION` / iOS `NSLocationWhenInUseUsageDescription` | `navigator.geolocation.getCurrentPosition` | Explicit GPS acquisition status displayed; coordinates rounded to 5 decimal places; accuracy radius reported in meters. |
| **Field Observation Media** | `@capacitor/camera` accessing native camera sensor (`CameraSource.Prompt`) | Standard HTML5 file picker (`<input type="file" accept="image/*,video/*" />`) | Maximum 3 files; 10MB per photo; 50MB per video; mandatory consent checkbox required before submission; public media quarantined until verified by official. |
| **Offline Telemetry Storage** | IndexedDB cache with ServiceWorker background caching | Browser IndexedDB + ServiceWorker Cache Storage | Local offline queue stores observations with offline banner and auto-sync when network returns. |

---

## 3. Environment Build Verification: What Was and Was Not Verified Locally

In accordance with repo engineering integrity rules, we state plainly what was and was not verified to build in this local development environment:

### Verified Locally:
1. **Capacitor Configuration & CLI Sync**:
   - `capacitor.config.ts` created pointing to `.output/public` static assets.
   - `npx cap add android` executed successfully, initializing the `android/` native project structure with Gradle wrapper and AndroidManifest.
   - `npx cap sync android` completed successfully (`@capacitor/camera@8.2.4` and `@capacitor/geolocation@8.2.2` plugins linked into Android project).
   - Gradle wrapper (`android/gradlew`) successfully downloaded Gradle 8.14.3.
2. **Web Bundle Build**:
   - `npm run build` generates production SSR bundle and static public assets in `.output/public` including `index.html`, PWA service worker, and web manifest.
3. **Application Regression & Key Parity**:
   - Full test suite (`src/lib/backend.test.ts`, `src/lib/i18n.test.ts`) passes with 100% test success and zero i18n key drift.

### Not Verified Locally (Environmental Limitations):
1. **Full Android APK Compilation (`./gradlew assembleDebug`)**:
   - The host system has Oracle JDK 25 installed (`class file major version 69`), which Gradle 8.14.3's Groovy parser does not yet support (requires JDK 17, 21, or 22). Additionally, `ANDROID_HOME` / Android SDK command-line tools are not provisioned in this headless test environment. Full `.apk` compilation was not executed in this session.
2. **iOS Build (`npx cap add ios` / `xcodebuild`)**:
   - The active host machine runs macOS with Command Line Tools only; full `Xcode.app` and `xcodebuild` are not installed. As mandated, iOS compilation is **NOT claimed to be verified** in this environment.

---

## 4. Real-World Prerequisites Required to Publish (Administrative Steps)

These are real-world legal and organizational requirements, not code gaps:

### Google Play Store:
1. **Google Play Console Organization Account**:
   - Registration fee ($25 USD) under the relevant State Disaster Management Authority or North Eastern Council entity.
   - DUNS number verification for government organisation badge.
2. **Production Keystore Creation & App Signing**:
   ```bash
   keytool -genkey -v -keystore landalert-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias landalert
   ```
3. **App Bundle Build**:
   ```bash
   cd android && ./gradlew bundleRelease
   ```
4. **Data Safety Declarations**:
   - Disclosure of precise location collection for disaster incident reporting.

### Apple App Store:
1. **Apple Developer Program Organization Membership**:
   - $99 USD/year organization enrollment requiring D-U-N-S validation.
2. **Build Machine**:
   - macOS workstation with full Xcode 15+ and iOS SDK installed.
3. **Code Signing & Distribution**:
   - Apple Distribution Certificate and Provisioning Profile configured in Xcode.
   - Archive and upload to App Store Connect via Xcode Organizer.
