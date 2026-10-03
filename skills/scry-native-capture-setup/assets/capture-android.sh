#!/usr/bin/env bash
# scripts/capture.sh - one emulator screenshot per registered screen, then an SCF bundle in .scry/capture.
#
# Needs: a running emulator or device (`adb devices` shows one), JDK 17 for the build, Node 20+.
# The app is built from this repo if APK does not exist yet. Nothing is uploaded.
#
# Env (all optional):
#   PACKAGE   com.scrymore.kettle
#   ACTIVITY  .MainActivity
#   APK       app/build/outputs/apk/debug/app-debug.apk   (a DEBUG build: the capture hook is debug-only)
#   SCREENS   scripts/screens.json                         (id, kind, title, name, file, line per screen)
#   OUT       .scry/capture
#   DEVICE    device name recorded in scf.json (default: the AVD name, else ro.product.model)
#   ANDROID_SERIAL  pick one device when several are attached
#   ALLOW_PHYSICAL=1  allow a physical phone/tablet (default: emulators only). The script installs the debug APK
#                     over any existing copy of the app, changes the animation scales and turns on demo mode;
#                     the scales and demo mode are restored on exit, the app install is not.
set -euo pipefail
cd "$(dirname "$0")/.."

PACKAGE="${PACKAGE:-com.scrymore.kettle}"
ACTIVITY="${ACTIVITY:-.MainActivity}"
APK="${APK:-app/build/outputs/apk/debug/app-debug.apk}"
SCREENS="${SCREENS:-scripts/screens.json}"
OUT="${OUT:-.scry/capture}"

# PACKAGE, ACTIVITY, DEVICE and ANDROID_SERIAL reach adb arguments (and the device shell): accept only these shapes.
# The bad value is never printed (it may carry control characters or a secret pasted by mistake).
# LC_ALL=C for the match: [A-Za-z] ranges are locale-sensitive (an accented letter passes under en_US.UTF-8).
check_env() { # <name> <value> <regex>
  local LC_ALL=C
  [[ "$2" =~ $3 ]] || { echo "capture: $1 has an unexpected shape (see the pattern in scripts/capture.sh); not run" >&2; exit 1; }
}
check_env PACKAGE  "$PACKAGE"  '^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$'
check_env ACTIVITY "$ACTIVITY" '^\.?[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*$'
[ -z "${DEVICE:-}" ] || check_env DEVICE "$DEVICE" '^[A-Za-z0-9][A-Za-z0-9 ._()+-]{0,63}$'
[ -z "${ANDROID_SERIAL:-}" ] || check_env ANDROID_SERIAL "$ANDROID_SERIAL" '^[A-Za-z0-9][A-Za-z0-9:._-]{0,63}$'

SHOTS="$(mktemp -d)"
trap 'rm -rf "$SHOTS"' EXIT

# Screen ids reach `adb shell am start` (which the device shell re-parses) and grep: accept only this shape.
valid_id() { local LC_ALL=C; [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]]; }

command -v adb >/dev/null || { echo "capture: adb not found (install Android platform-tools)" >&2; exit 2; }
# OUT is deleted and recreated by make-scf.mjs: refuse a bad one now, before the build and capture.
node scripts/make-scf.mjs --check --out "$OUT" || exit 1
[ -f "$APK" ] || ./gradlew --no-daemon :app:assembleDebug

adb wait-for-device
# Wait until the system has finished booting; installing earlier fails on a cold emulator.
until [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = 1 ]; do sleep 2; done

# Emulators only unless ALLOW_PHYSICAL=1: this script installs the app and changes system settings on the device.
gp() { adb shell getprop "$1" | tr -d '\r'; }
model="$(gp ro.product.model | tr '[:upper:]' '[:lower:]')"
if [ "$(gp ro.kernel.qemu)" = 1 ] || [ "$(gp ro.boot.qemu)" = 1 ] || [[ "$model" == *sdk* ]] || [[ "$model" == *emulator* ]]; then
  :
elif [ "${ALLOW_PHYSICAL:-0}" != 1 ]; then
  echo "capture: the attached device ($(gp ro.product.model)) does not look like an emulator; refusing to install the app or change its settings." >&2
  echo "capture: start an emulator, or set ALLOW_PHYSICAL=1 to use this device (animation scales and demo mode are restored on exit)." >&2
  exit 3
fi

# Remember the settings this script changes and put them back on exit (a value of "null" means it was unset).
prev_scale() { adb shell settings get global "$1" | tr -d '\r'; }
PREV_WINDOW="$(prev_scale window_animation_scale)"
PREV_TRANSITION="$(prev_scale transition_animation_scale)"
PREV_ANIMATOR="$(prev_scale animator_duration_scale)"
PREV_DEMO="$(prev_scale sysui_demo_allowed)"
restore_setting() { # <name> <previous value>
  if [ -z "$2" ] || [ "$2" = null ]; then adb shell settings delete global "$1" >/dev/null 2>&1 || true
  else adb shell settings put global "$1" "$2" >/dev/null 2>&1 || true; fi
}
restore_device() {
  adb shell am broadcast -a com.android.systemui.demo -e command exit >/dev/null 2>&1 || true
  restore_setting window_animation_scale "$PREV_WINDOW"
  restore_setting transition_animation_scale "$PREV_TRANSITION"
  restore_setting animator_duration_scale "$PREV_ANIMATOR"
  restore_setting sysui_demo_allowed "$PREV_DEMO"
}
trap 'rm -rf "$SHOTS"; restore_device' EXIT

adb install -r "$APK" >/dev/null

# No animations, and a fixed status bar (9:41, full battery, no notifications).
adb shell settings put global window_animation_scale 0
adb shell settings put global transition_animation_scale 0
adb shell settings put global animator_duration_scale 0
adb shell settings put global sysui_demo_allowed 1
adb shell am broadcast -a com.android.systemui.demo -e command enter >/dev/null
adb shell am broadcast -a com.android.systemui.demo -e command clock -e hhmm 0941 >/dev/null
adb shell am broadcast -a com.android.systemui.demo -e command battery -e level 100 -e plugged false >/dev/null
adb shell am broadcast -a com.android.systemui.demo -e command network -e wifi show -e level 4 >/dev/null
adb shell am broadcast -a com.android.systemui.demo -e command notifications -e visible false >/dev/null

# The real pixel scale (density / 160), so images line up with Figma frames in dp.
density="$(adb shell wm density | grep -Eo '[0-9]+' | tail -1)"
scale="$(node -e 'console.log(Number(process.argv[1]) / 160)' "$density")"
device="${DEVICE:-$(adb shell getprop ro.boot.qemu.avd_name | tr -d '\r')}"
[ -n "$device" ] || device="$(adb shell getprop ro.product.model | tr -d '\r')"
android_ver="$(adb shell getprop ro.build.version.release | tr -d '\r')"

ids="$(node -e 'for (const s of JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))) console.log(s.id)' "$SCREENS")"
rejected=0
while IFS= read -r id <&3; do
  [ -n "$id" ] || continue
  if ! valid_id "$id"; then
    echo "capture: rejected screen id '$id' (must match ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\$); not launched" >&2
    rejected=$((rejected + 1)); continue
  fi
  adb shell am force-stop "$PACKAGE"
  adb logcat -c
  adb shell am start -n "$PACKAGE/$ACTIVITY" --es scry_screen "$id" >/dev/null
  ok=""
  for _ in $(seq 1 40); do
    # Keep each line from "scry:ready" on, then compare the whole line as a fixed string (no regex from the id).
    if adb logcat -d -s scry:I | tr -d '\r' | sed -n 's/^.*\(scry:ready .*\)$/\1/p' | grep -qxF -- "scry:ready $id"; then ok=1; break; fi
    sleep 0.5
  done
  if [ -n "$ok" ]; then
    sleep 0.5
    adb exec-out screencap -p > "$SHOTS/$id.png"
    echo "capture: $id ok ($(wc -c < "$SHOTS/$id.png") bytes)"
  else
    echo "capture: $id never reported ready" >&2
  fi
done 3<<<"$ids"
adb shell am force-stop "$PACKAGE"
if [ "$rejected" -gt 0 ]; then
  echo "capture: $rejected screen id(s) rejected; fix the ids in $SCREENS (no bundle written)" >&2
  exit 1
fi

node scripts/make-scf.mjs --platform android --screens "$SCREENS" --shots "$SHOTS" --out "$OUT" \
  --device "$device" --device-os "Android $android_ver" --scale "$scale"
