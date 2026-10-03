# Jetpack Compose (Android)

Needs `adb` with a running emulator or device (`adb devices`), JDK 17, Node 20+. Without a
device, stop after writing files. Source of truth for every asset below: the Kettle sample
(scryorg/scry-sample-android); `assets/` are copies.

1. **Hook, debug only.** Copy `assets/ScryLaunch.kt` and `assets/ScryScreens.kt` into
   `app/src/debug/java/<package path>/` and `assets/ScryLaunch-release.kt` to
   `app/src/release/java/<package path>/ScryLaunch.kt` (same package, same two symbols, no-op).
   Set the package. In `MainActivity.onCreate`: `val id = ScryLaunch.requestedScreen(intent)` and
   `setContent { if (id != null) ScryCaptureRoot(id) else AppRoot() }`. A release build then has no
   capture code and no registry; check with `dexdump` or `apkanalyzer` that the release dex has no
   `scry_screen` or `ScryScreens` (the sample does), and add that as a CI step if the user has CI.
   If the project has other build types, make sure each one gets a source set with the no-op copy.
2. **Fixed canvas.** `ScryLaunch.kt` wraps the screen in the sample's `KettleCanvasBox` (a 390 x 844 dp
   box, top-centred under the status bar, used by the normal app too so the two match). Replace it
   with the app's own root container at a fixed size, and use the same one in the normal launch path.
   Without a fixed canvas the screenshot depends on the device.
3. **Registry.** One `ScryScreen` per screen in `ScryScreens.kt`: `id`, `name`, `file`, `line`, and
   the composable lambda fed with fixtures. Add the same entry to `scripts/screens.json`
   (`id`, `kind` `screen`/`component`, `title`, `name`, `file`, `line`): Android has no
   `-ScryList`, so the two lists are kept in step by hand; say so in the report.
4. **Fixtures.** `Fixtures.kt` with fixed models. No `System.currentTimeMillis()`, no network,
   no random. Reuse `@Preview` sample data where it exists.
5. **Scripts.** Copy `assets/capture-android.sh` to `scripts/capture.sh` and `assets/make-scf.mjs`
   to `scripts/make-scf.mjs`. Set `PACKAGE`, `ACTIVITY`, `APK` defaults at the top. Add `.scry/` to
   `.gitignore`.
6. **Capture.** `bash scripts/capture.sh`. It builds the debug APK if missing, waits for
   `sys.boot_completed`, installs, turns off animations, fixes the status bar (demo mode: 9:41,
   full battery, no notifications; an EXIT trap restores it), then per id starts the activity
   with `--es scry_screen <id>` and waits for logcat `scry:ready <id>`. The scale is read from
   `adb shell wm density` (density / 160), and the device name is the AVD name, else the model
   (`DEVICE=` overrides). `ANDROID_SERIAL` picks one device when several are attached.
7. **Validate** with `npx @scrymore/scry-deployer upload .scry/capture --dry-run` (no key set, no
   project id; the CLI is `scry-deployer`, not `scry`). Expected: `scf: N/N captured, 0 skipped ->
   .scry/capture` from `make-scf.mjs`, then `Bundle valid: N captures, source compose-preview:android.`
   (the sample: N = 5). Give the user these when you cannot run it.

Common failures: `never reported ready` (the activity was already running: the script force-stops
it, but `singleTop`/`singleTask` launch modes need an `onNewIntent` handler; the log tag must be
`scry`, `adb logcat -s scry:I`), a status bar with real notifications (the demo-mode broadcast needs
`sysui_demo_allowed`; some images ignore it), a Wi-Fi glyph that still shows "!" on an emulator
(no validated connection: the clock, battery and notifications are fixed, the glyph can differ;
note it in the report).

Known limit: the capture is the full device screen (1080 x 2400 on the sample emulator), so a
component capture is mostly background and `capture.crop` is `none`. Do not promise tight crops.
