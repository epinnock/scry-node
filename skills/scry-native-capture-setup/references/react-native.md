# React Native / Expo

React Native uses the built-in adapter, `scry capture rn`, which captures on-device Storybook
stories. There is no capture script to write; the app needs Storybook and a deterministic mode.

1. **Check what exists.** Is `@storybook/react-native` in the app's `package.json` and is there a
   `.rnstorybook/` folder? If `@storybook/react-native` is missing: **stop and do nothing else.**
   Do not install it, do not add stories, do not touch `package.json`, Metro or Babel config. Tell
   the user that React Native capture needs on-device Storybook, point them to the Scry docs page
   for React Native capture (https://docs.scrymore.com/guide/react-native, published with the native how-to docs), and say they add it
   themselves; offer to continue once it is there. The skill never adds a dependency.
2. **Capture mode.** The adapter sets `EXPO_PUBLIC_SCRY_CAPTURE=1` itself when it starts Metro or
   builds the app, so the user never exports it. The app has to react to it, like the reference
   sample (`scry-sample-rn`, `src/capture.ts`): disable press-feedback animations, give each story
   a root `testID="scry-root"` (the adapter crops to it), hide the on-device Storybook chrome and
   safe-area padding when capture mode is on.
3. **Check a device exists first** (`adb devices` for Android, `xcrun simctl list devices available`
   for iOS). If none is available: stop here, do not claim a capture ran. Print for the user the
   exact `capture rn` command from step 4 (with their device name) and the expected output: a
   `Capturing N stories on <device> ...` line, one `✓ <story id> (...)` line per story (a skipped
   one reads `✗ <story id>: skipped (<reason>)`), then `N of M stories captured, K skipped. Bundle:
   .scry/capture`; after that the `upload .scry/capture --dry-run` command.
   Emulators and simulators only; never use a physical device.
4. **Run:**
   ```
   npx @scrymore/scry-deployer capture rn --platform android --device <AVD name>
   npx @scrymore/scry-deployer capture rn --platform ios --device "iPhone 16" \
     --app-id host.exp.Exponent --open-url exp://127.0.0.1:8081       # Expo Go on a simulator
   ```
   Version 0.10 or newer of `@scrymore/scry-deployer` is required. It starts Metro with
   `STORYBOOK_ENABLED=true`; output goes to `.scry/capture`.
5. **Validate** with `npx @scrymore/scry-deployer upload .scry/capture --dry-run` (no key, no
   project id; run it with `SCRY_API_KEY` unset), check the images, then hand the real upload to the
   user: list the command from SKILL.md step 8 for them to run in their own shell. You do not run it.

Native iOS dev builds of an Expo SDK 57 app need Xcode 26; Expo Go works with older Xcode.
A skipped story is reported with its reason (timeout, screenshot failed); fix it rather than
filtering it out.
