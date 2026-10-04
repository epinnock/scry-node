# The capture bundle (SCF 1.0), in short

A directory with `scf.json` at the root and images under `images/` (PNG, JPEG or WebP, 20 MB
max each). `scf.json` needs `scf: "1.0"`, `source.kind` and `captures[]`; each capture needs `id`
(unique, stable across builds, up to 512 chars) and `image` (path inside the bundle). Two captures
cannot share an image.

Kinds used here: `swiftui-preview` (iOS), `compose-preview` (Android), `flutter-golden` (Flutter: platform `android`, `ios`, or `other` for a no-device `flutter test` render with method `headless-render`). `make-scf.mjs` writes each
capture's own `kind` (`screen`, the default, or `component`, from `screens.json`/the iOS registry) and
`title` (grouping), and takes `--tool-name` for the `tool.name` recorded in `scf.json` (default
`scry-native-capture-setup make-scf.mjs`). The device is written as an object `{ name, os }`
(`source.device`, `defaults.capture.device`), the shape the dashboard reads; a plain string is accepted by
the validator but shows `Device: Not recorded`. `--device` sets the name, `--device-os` the optional OS text
(e.g. `iOS 18.6`, `Android 14`; omitted when not given). Components are full-screen canvases with `crop: none`
(iOS: centred on the app background; Android: the whole device screen), not tight crops. `capture.scale` is the
real pixel scale, so images line up with Figma frames in points. `counts.declared` is how many
screens you meant to capture, `counts.captured` how many are in the bundle; a skipped screen goes
in `counts.skipped` with `reason` one of `error, timeout, filtered, unsupported, empty`
(anything else fails validation).

Validate before anything else (no key needed): `npx @scrymore/scry-deployer upload <dir> --dry-run`
prints `Bundle valid: N captures, source swiftui-preview:ios.` (or `compose-preview:android`, `flutter-golden:android`, `flutter-golden:other`) or the
rule that failed (each error names the capture id). `make-scf.mjs` itself prints
`scf: N/N captured, 0 skipped -> <out>` and exits 1 if any registered screen has no PNG.
Full spec: `scry-capture-format/spec/scf-1.0.md`.
