#!/usr/bin/env bash
# scripts/capture.sh <android|ios|headless> - one screenshot per registered screen, then an SCF bundle in .scry/capture.
#
#   android    an Android emulator (`adb devices` shows one), driven by `flutter drive`; the emulator's real size and density.
#   ios        an iOS simulator that is booted (macOS only), driven by `flutter drive`.
#   headless   no device: `flutter test` renders each screen on the host (Flutter Material look).
#              Fails and writes NO bundle if the fonts did not load (see test/scry_fonts.dart).
#
# Needs: the Flutter SDK on PATH (flutter --version), Node 20+. Nothing is uploaded.
#
# Env (all optional):
#   SCREENS   scripts/screens.json     (id, kind, title, name, file, line per screen)
#   OUT       .scry/capture
#   DEVICE    device name recorded in scf.json (default: the AVD name / simulator name)
#   ANDROID_SERIAL  pick one device when several are attached
#   IOS_UDID  pick one simulator when several are booted (xcrun simctl list devices booted)
#   ALLOW_PHYSICAL=1  allow a physical Android device (default: emulators only). The script changes the animation
#                     scales and the immersive-mode confirmation on the device and restores them on exit.
#   SCALE     pixels per logical pixel recorded in scf.json (default: from the device density; ios 3)
set -euo pipefail
cd "$(dirname "$0")/.."

MODE="${1:-}"
case "$MODE" in android | ios | headless) ;; *) echo "usage: bash scripts/capture.sh <android|ios|headless>" >&2; exit 2 ;; esac
SCREENS="${SCREENS:-scripts/screens.json}"
OUT="${OUT:-.scry/capture}"

# DEVICE, ANDROID_SERIAL and SCALE reach adb/flutter arguments and the bundle: accept only these shapes.
# The bad value is never printed (it may carry control characters or a secret pasted by mistake).
check_env() { # <name> <value> <regex>
  local LC_ALL=C
  [[ "$2" =~ $3 ]] || { echo "capture: $1 has an unexpected shape (see the pattern in scripts/capture.sh); not run" >&2; exit 1; }
}
[ -z "${DEVICE:-}" ] || check_env DEVICE "$DEVICE" '^[A-Za-z0-9][A-Za-z0-9 ._()+@-]{0,63}$'
[ -z "${ANDROID_SERIAL:-}" ] || check_env ANDROID_SERIAL "$ANDROID_SERIAL" '^[A-Za-z0-9][A-Za-z0-9:._-]{0,63}$'
[ -z "${SCALE:-}" ] || check_env SCALE "$SCALE" '^[0-9]+(\.[0-9]+)?$'

command -v flutter >/dev/null || { echo "capture: flutter not found on PATH (install the Flutter SDK, then flutter --version)" >&2; exit 2; }
command -v node >/dev/null || { echo "capture: node not found (Node 20+)" >&2; exit 2; }
# OUT is deleted and recreated by make-scf.mjs: refuse a bad one now, before the build and capture.
node scripts/make-scf.mjs --check --out "$OUT" || exit 1
# A failed run must never leave an older bundle looking current.
rm -rf "$OUT"

SHOTS="$(mktemp -d)"
cleanup() { rm -rf "$SHOTS"; if declare -F restore_device >/dev/null; then restore_device; fi; }
trap cleanup EXIT

# Screen ids reach file names and the bundle: accept only a plain shape.
ids="$(node -e 'for (const s of JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))) console.log(s.id)' "$SCREENS")"
while IFS= read -r id; do
  [ -z "$id" ] || { LC_ALL=C; [[ "$id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]]; } \
    || { echo "capture: rejected screen id '$id' (must match ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\$); no bundle written" >&2; exit 1; }
done <<<"$ids"

# flutter_test needs the SDK location for the Roboto and MaterialIcons font files.
if [ -z "${FLUTTER_ROOT:-}" ]; then
  FLUTTER_ROOT="$(cd "$(dirname "$(readlink -f "$(command -v flutter)")")/.." && pwd)"
  export FLUTTER_ROOT
fi
flutter pub get >/dev/null

make_scf() { # <platform> <device> <device-os> <scale>
  node scripts/make-scf.mjs --framework flutter --platform "$1" --screens "$SCREENS" --shots "$SHOTS" --out "$OUT" \
    --device "$2" --device-os "$3" --scale "$4"
}

drive() { # <flutter device id>
  SCRY_OUT="$SHOTS" flutter drive --driver=test_driver/integration_test.dart \
    --target=integration_test/scry_capture_test.dart -d "$1"
}

case "$MODE" in
headless)
  SCRY_OUT="$SHOTS" flutter test test/scry_capture_test.dart
  make_scf other "${DEVICE:-flutter_test 390x844@3x}" flutter_test "${SCALE:-3}"
  ;;

android)
  command -v adb >/dev/null || { echo "capture: adb not found (install Android platform-tools)" >&2; exit 2; }
  adb wait-for-device
  # Wait until the system has finished booting; installing earlier fails on a cold emulator.
  until [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = 1 ]; do sleep 2; done
  gp() { adb shell getprop "$1" | tr -d '\r'; }
  model="$(gp ro.product.model | tr '[:upper:]' '[:lower:]')"
  if [ "$(gp ro.kernel.qemu)" = 1 ] || [ "$(gp ro.boot.qemu)" = 1 ] || [[ "$model" == *sdk* ]] || [[ "$model" == *emulator* ]]; then
    :
  elif [ "${ALLOW_PHYSICAL:-0}" != 1 ]; then
    echo "capture: the attached device ($(gp ro.product.model)) does not look like an emulator; refusing to install the app or change its settings." >&2
    echo "capture: start an emulator, or set ALLOW_PHYSICAL=1 to use this device (animation scales and the immersive-mode confirmation are restored on exit)." >&2
    exit 3
  fi
  serial="${ANDROID_SERIAL:-$(adb get-serialno | tr -d '\r')}"
  check_env serial "$serial" '^[A-Za-z0-9][A-Za-z0-9:._-]{0,63}$'

  # Remember the settings this script changes and put them back on exit (a value of "null" means it was unset).
  prev() { # <namespace> <name>
    adb -s "$serial" shell settings get "$1" "$2" | tr -d '\r'
  }
  PREV_WINDOW="$(prev global window_animation_scale)"; PREV_TRANSITION="$(prev global transition_animation_scale)"
  PREV_ANIMATOR="$(prev global animator_duration_scale)"; PREV_IMMERSIVE="$(prev secure immersive_mode_confirmations)"
  restore_setting() { # <namespace> <name> <previous value>
    if [ -z "$3" ] || [ "$3" = null ]; then adb -s "$serial" shell settings delete "$1" "$2" >/dev/null 2>&1 || true
    else adb -s "$serial" shell settings put "$1" "$2" "$3" >/dev/null 2>&1 || true; fi
  }
  restore_device() {
    restore_setting global window_animation_scale "$PREV_WINDOW"
    restore_setting global transition_animation_scale "$PREV_TRANSITION"
    restore_setting global animator_duration_scale "$PREV_ANIMATOR"
    restore_setting secure immersive_mode_confirmations "$PREV_IMMERSIVE"
  }
  for s in window_animation_scale transition_animation_scale animator_duration_scale; do
    adb -s "$serial" shell settings put global "$s" 0
  done
  # The test enters immersive mode. On a fresh emulator Android then shows a "Viewing full screen" confirmation that
  # takes focus, and `flutter drive` never finishes. Marking it confirmed up front makes a fresh AVD work unattended.
  adb -s "$serial" shell settings put secure immersive_mode_confirmations confirmed

  # The real pixel scale (density / 160), so images line up with Figma frames in logical pixels.
  density="$(adb -s "$serial" shell wm density | grep -Eo '[0-9]+' | tail -1)"
  scale="${SCALE:-$(node -e 'console.log(Number(process.argv[1]) / 160)' "$density")}"
  device="${DEVICE:-$(gp ro.boot.qemu.avd_name)}"
  [ -n "$device" ] || device="$(gp ro.product.model)"
  drive "$serial"
  make_scf android "$device" "Android $(gp ro.build.version.release)" "$scale"
  ;;

ios)
  [ "$(uname)" = Darwin ] || { echo "capture: ios needs macOS with Xcode (xcrun simctl)" >&2; exit 2; }
  booted="$(xcrun simctl list devices booted -j)"
  # One booted simulator: "<udid>|<name>|<runtime, e.g. iOS 18.6>". Physical devices are never used.
  # With several booted, IOS_UDID picks yours; the others are left alone.
  [ -z "${IOS_UDID:-}" ] || check_env IOS_UDID "$IOS_UDID" '^[A-Fa-f0-9-]{36}$'
  line="$(WANT="${IOS_UDID:-}" node -e '
    const d = JSON.parse(process.argv[1]).devices; const out = [];
    for (const [rt, list] of Object.entries(d)) for (const s of list) if (s.state === "Booted")
      out.push(`${s.udid}|${s.name}|${rt.replace(/^.*SimRuntime\./, "").replace(/^iOS-/, "iOS ").replace(/-/g, ".")}`);
    const want = (process.env.WANT || "").toUpperCase();
    const pick = want ? out.filter((o) => o.split("|")[0].toUpperCase() === want) : out;
    if (pick.length !== 1) {
      console.error(want ? "IOS_UDID is not a booted simulator (xcrun simctl boot <udid>)"
        : out.length ? "more than one simulator is booted: set IOS_UDID=<udid> to pick one (xcrun simctl list devices booted)"
        : "no simulator is booted (xcrun simctl boot <name>)");
      process.exit(1);
    }
    console.log(pick[0]);' "$booted")" || { echo "capture: $line" >&2; exit 3; }
  IFS='|' read -r udid name runtime <<<"$line"
  check_env udid "$udid" '^[A-Fa-f0-9-]{36}$'
  drive "$udid"
  make_scf ios "${DEVICE:-$name}" "$runtime" "${SCALE:-3}"
  ;;
esac
