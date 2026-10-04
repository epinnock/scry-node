#!/usr/bin/env bash
# scripts/capture.sh <android|ios|headless> - one screenshot per registered screen, then an SCF bundle in .scry/capture.
#
#   bash scripts/capture.sh android     emulator via `flutter drive` (needs adb, one emulator, JDK 17)
#   bash scripts/capture.sh ios         simulator via `flutter drive` (needs macOS, Xcode, Flutter)
#   bash scripts/capture.sh headless    no device: `flutter test` renders each screen (Material look, not iOS)
#
# Needs Flutter on PATH and Node 20+. Nothing is uploaded. Dev-only: the capture files live in integration_test/,
# test/, test_driver/ and scripts/, never in lib/.
# Env (all optional):
#   SCREENS   scripts/screens.json    (id, kind, title, name, file, line per screen; same ids as the registry)
#   OUT       .scry/capture
#   DEVICE    device name recorded in scf.json (android: the AVD name, else ro.product.model; ios: default "iPhone 16")
#   SCALE     ios pixel scale (default 3)
#   ANDROID_SERIAL  pick one device when several are attached
#   ALLOW_PHYSICAL=1  allow a physical Android phone (default: emulators only; the app is installed over any copy)
#   SCRY_SCREENS  comma list of ids to capture (default all; the bundle then declares only those)
#   TOOL_NAME recorded in scf.json (default "scry-native-capture-setup capture.sh")
#   SCRY_FONTS=off  headless only, a test hook: skip loading fonts to prove the font guard stops the run
set -euo pipefail
cd "$(dirname "$0")/.."

MODE="${1:-}"
SCREENS="${SCREENS:-scripts/screens.json}"
OUT="${OUT:-.scry/capture}"
TOOL_NAME="${TOOL_NAME:-scry-native-capture-setup capture.sh}"

# Values reach flutter, adb and xcrun arguments: accept only these shapes. A bad value is never printed
# (it may carry control characters or a secret pasted by mistake). LC_ALL=C: [A-Za-z] ranges are locale-sensitive.
check_env() { # <name> <value> <regex>
  local LC_ALL=C
  [[ "$2" =~ $3 ]] || { echo "capture: $1 has an unexpected shape (see the pattern in scripts/capture.sh); not run" >&2; exit 1; }
}
case "$MODE" in
  android|ios|headless) ;;
  *) echo "usage: bash scripts/capture.sh <android|ios|headless>" >&2; exit 2 ;;
esac
[ -z "${DEVICE:-}" ] || check_env DEVICE "$DEVICE" '^[A-Za-z0-9][A-Za-z0-9 ().,_+-]{0,63}$'
[ -z "${ANDROID_SERIAL:-}" ] || check_env ANDROID_SERIAL "$ANDROID_SERIAL" '^[A-Za-z0-9][A-Za-z0-9:._-]{0,63}$'
[ -z "${SCRY_SCREENS:-}" ] || check_env SCRY_SCREENS "$SCRY_SCREENS" '^[A-Za-z0-9][A-Za-z0-9._,-]{0,512}$'
SCALE="${SCALE:-3}"; check_env SCALE "$SCALE" '^[1-9](\.[0-9]{1,3})?$'
[ -z "${SCRY_FONTS:-}" ] || check_env SCRY_FONTS "$SCRY_FONTS" '^off$'

for tool in flutter node; do
  command -v "$tool" >/dev/null || { echo "capture: '$tool' not found (install Flutter, and Node 20+)" >&2; exit 2; }
done
# OUT is deleted and recreated by make-scf.mjs: refuse a bad one now, before the (slow) build and capture.
node scripts/make-scf.mjs --check --out "$OUT" || exit 1
# A failed run must not leave an earlier bundle behind to be uploaded by mistake (--check allowed only an empty or
# earlier Scry bundle folder).
rm -rf "$OUT"

SHOTS="$(mktemp -d)"
trap 'rm -rf "$SHOTS"' EXIT
export SCRY_OUT="$SHOTS"
DEFINES=()
[ -z "${SCRY_SCREENS:-}" ] || DEFINES+=("--dart-define=SCRY_SCREENS=$SCRY_SCREENS")

# Only the screens that were asked for are declared, so a filtered run is "n/n captured", not "1/6".
if [ -n "${SCRY_SCREENS:-}" ]; then
  FILTERED="$SHOTS/screens.json"
  node -e 'const w = new Set(process.argv[2].split(",")); const all = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    require("fs").writeFileSync(process.argv[3], JSON.stringify(all.filter((s) => w.has(s.id))));' "$SCREENS" "$SCRY_SCREENS" "$FILTERED"
  SCREENS="$FILTERED"
fi

case "$MODE" in
  headless)
    PLATFORM=other
    DEVICE_NAME="flutter_test 390x844@3x"; DEVICE_OS="flutter_test"; SCALE=3
    # The test loads fonts and fails (no PNGs, no bundle) if it cannot; see test/scry_capture_test.dart.
    [ "${SCRY_FONTS:-}" != off ] || DEFINES+=("--dart-define=SCRY_FONTS=off")
    flutter test test/scry_capture_test.dart "${DEFINES[@]+"${DEFINES[@]}"}"
    ;;
  android)
    PLATFORM=android
    command -v adb >/dev/null || { echo "capture: adb not found (install Android platform-tools)" >&2; exit 2; }
    if [ -z "${ANDROID_SERIAL:-}" ]; then
      attached="$(adb devices | awk 'NR>1 && $2=="device" {print $1}')"
      [ -n "$attached" ] || { echo "capture: no emulator or device attached (adb devices). Start an emulator, then run this again." >&2; exit 1; }
      [ "$(printf '%s\n' "$attached" | wc -l)" -eq 1 ] || { echo "capture: several devices attached; set ANDROID_SERIAL to one of: $(echo $attached)" >&2; exit 1; }
      ANDROID_SERIAL="$attached"
    fi
    export ANDROID_SERIAL
    adb wait-for-device
    until [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = 1 ]; do sleep 2; done
    gp() { adb shell getprop "$1" | tr -d '\r'; }
    model="$(gp ro.product.model | tr '[:upper:]' '[:lower:]')"
    if [ "$(gp ro.kernel.qemu)" = 1 ] || [ "$(gp ro.boot.qemu)" = 1 ] || [[ "$model" == *sdk* ]] || [[ "$model" == *emulator* ]]; then
      :
    elif [ "${ALLOW_PHYSICAL:-0}" != 1 ]; then
      echo "capture: the attached device ($(gp ro.product.model)) does not look like an emulator; refusing to install the app on it." >&2
      echo "capture: start an emulator, or set ALLOW_PHYSICAL=1 to use this device (the debug app is installed over any copy)." >&2
      exit 3
    fi
    density="$(adb shell wm density | grep -Eo '[0-9]+' | tail -1)"
    SCALE="$(node -e 'console.log(Number(process.argv[1]) / 160)' "$density")"
    DEVICE_NAME="${DEVICE:-$(gp ro.boot.qemu.avd_name)}"; [ -n "$DEVICE_NAME" ] || DEVICE_NAME="$(gp ro.product.model)"
    DEVICE_OS="Android $(gp ro.build.version.release)"
    flutter drive --driver=test_driver/integration_test.dart --target=integration_test/scry_capture_test.dart \
      -d "$ANDROID_SERIAL" "${DEFINES[@]+"${DEFINES[@]}"}"
    ;;
  ios)
    PLATFORM=ios
    command -v xcrun >/dev/null || { echo "capture: 'xcrun' not found. The ios path needs macOS with Xcode." >&2; exit 2; }
    DEVICE_NAME="${DEVICE:-iPhone 16}"
    SIM="$(xcrun simctl list devices available -j | DEVICE="$DEVICE_NAME" node -e '
      const d = JSON.parse(require("fs").readFileSync(0, "utf8")).devices;
      const hits = Object.entries(d).filter(([rt]) => rt.includes("iOS"))
        .flatMap(([rt, list]) => list.filter((x) => x.name === process.env.DEVICE).map((x) => ({ rt, udid: x.udid })))
        .sort((a, b) => a.rt.localeCompare(b.rt, undefined, { numeric: true }));
      if (hits.length) { const h = hits[hits.length - 1]; console.log(h.udid + " " + h.rt); }
    ')"
    UDID="${SIM%% *}"
    # Runtime key "com.apple.CoreSimulator.SimRuntime.iOS-18-6" -> "iOS 18.6" (recorded as the device os in scf.json).
    DEVICE_OS="$(printf '%s' "${SIM#* }" | sed -E 's/^.*SimRuntime\.//; s/^([A-Za-z]+)-/\1 /; s/-/./g')"
    if [ -z "$UDID" ]; then
      echo "capture: no simulator named \"$DEVICE_NAME\" found. Install an iOS runtime (Xcode > Settings > Components), then:" >&2
      echo "  xcrun simctl list devices available | grep -i iphone     # pick a name, then DEVICE=\"<name>\" bash scripts/capture.sh ios" >&2
      exit 1
    fi
    echo "capture: simulator $DEVICE_NAME, $DEVICE_OS ($UDID)"
    xcrun simctl boot "$UDID" 2>/dev/null || true
    xcrun simctl bootstatus "$UDID" -b >/dev/null
    flutter drive --driver=test_driver/integration_test.dart --target=integration_test/scry_capture_test.dart \
      -d "$UDID" "${DEFINES[@]+"${DEFINES[@]}"}"
    ;;
esac

node scripts/make-scf.mjs --framework flutter --platform "$PLATFORM" --screens "$SCREENS" --shots "$SHOTS" --out "$OUT" \
  --device "$DEVICE_NAME" --device-os "$DEVICE_OS" --scale "$SCALE" --tool-name "$TOOL_NAME"
