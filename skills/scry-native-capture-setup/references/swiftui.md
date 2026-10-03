# SwiftUI (iOS)

Needs macOS with Xcode 16+ and an installed simulator runtime, Node 20+. Check with
`xcrun simctl list devices available | grep -i iphone`. Without it, stop after writing files.
Source of truth for every asset below: the Kettle sample (scryorg/scry-sample-ios); `assets/` are copies.

1. **Hook.** Copy `assets/ScryLaunch.swift` and `assets/ScryScreens.swift` into the app target.
   Both are wrapped in `#if DEBUG`; do not remove that. In the `@main App`, wrap the root in
   `ScryLaunchRoot { RootView() }`. That is the only change to existing code: in Debug it shows one
   screen for `-ScryScreen <id>`, prints the registry for `-ScryList YES`, and otherwise shows the
   normal root; in Release it is a pass-through and no capture code or string ships.
2. **Add the files to the target.** Check `grep PBXFileSystemSynchronizedRootGroup
   *.xcodeproj/project.pbxproj`. Hit: the folder is synchronized, a file in it is in the target.
   No hit: a classic project, which is untested. Add each new file to the app target explicitly
   (file reference, build file, Sources phase) or tell the user to drag them in, and say in the
   report that you did. Do the same for `Fixtures.swift` and any test file.
3. **Registry.** One `ScryScreen` per screen: `id`, `name`, `kind` (`"screen"` or `"component"`),
   `title` (grouping, `["Screens"]` / `["Components"]`), `file`, `line`, and `view: AnyView(...)`
   built from fixtures. A screen that needs an `@EnvironmentObject` gets it injected in the entry.
   A component goes in `ComponentCanvas { ... }`: it is captured as a full-screen canvas (component
   centred on the app background, `crop: none`), so do not promise a tight crop. If the app has a
   test target, add a test that every entry's `file` exists and its `line` holds a declaration
   (write it in the app's own test target; the sample's version is not shipped in `assets/`).
4. **Fixtures.** `Fixtures.swift` with fixed models (names, prices, dates as literal values,
   no `Date()`, no `UUID()`, no network). If the app has SwiftUI previews, reuse their sample data.
   Use the system font unless the app bundles one.
5. **Scripts.** Copy `assets/capture-ios.sh` to `scripts/capture.sh` and `assets/make-scf.mjs`
   to `scripts/make-scf.mjs`. Set `SCHEME`, `PROJECT` (defaults `Kettle`, `Kettle.xcodeproj`) and
   the `--tool-name` string at the bottom of `capture.sh`. There is no `screens.json` to write: the
   script launches the app with `-ScryList YES` and reads the registry it prints. Add `.scry/` and
   `.build/` to `.gitignore`.
6. **Capture.** `bash scripts/capture.sh`. It resolves the simulator UDID of the newest iOS runtime
   with `DEVICE` (default `iPhone 16`), builds Debug into `.build/`, boots and waits (`bootstatus`),
   sets a 9:41 status bar, screenshots each id, clears the status bar. `SKIP_BUILD=1` reuses the
   build. Other device: `DEVICE="iPhone 16e"`, and `SCALE=2` for a 2x device (default 3, right for
   iPhone 16) so Figma alignment is correct. If no simulator has that name, the script prints
   the commands to pick one and exits 1.
7. **Validate** with `npx @scrymore/scry-deployer upload .scry/capture --dry-run` (no key set, no
   project id). Expected from `capture.sh`: `scf: N/N captured, 0 skipped -> .scry/capture`, then
   `Bundle valid: N captures, source swiftui-preview:ios.` (the sample: N = 5). Give the user
   these when you cannot run it.

Common failures: `never reported ready` (the launch argument is not reaching the app: check the
`ScryLaunchRoot` wrapper; the hook prints with `print` + `fflush` and the script reads it through
`simctl launch --console`, not `--console-pty`, so it works over ssh), `capture produced 0 screens`
(nothing reported ready, nothing is written), a blank screenshot (raise the `sleep 0.5` settle),
a status bar showing the real time (the override ran before boot finished: do not remove
the `bootstatus` wait). Capture pins light mode, default text size and no animation: two runs
give identical PNGs, and a normal-launch screenshot of the same screen should match; repeat that
byte comparison on the user's app and report the result.
