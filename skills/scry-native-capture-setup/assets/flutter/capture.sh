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
WORK="$(mktemp -d)" # logs of the drive and of the device watcher; never part of the bundle
cleanup() { if declare -F restore_device >/dev/null; then restore_device; fi; rm -rf "$SHOTS" "$WORK"; }
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
  # Wait (bounded) until the device has finished booting and the package manager answers; a cold emulator fails earlier.
  BOOT_TIMEOUT="${CAPTURE_BOOT_TIMEOUT:-600}"
  if [ -z "${ANDROID_SERIAL:-}" ] && [ "$(adb devices | awk 'NR > 1 && $2 == "device"' | wc -l)" -gt 1 ]; then
    echo "capture: more than one Android device is attached: set ANDROID_SERIAL=<serial> to pick one (adb devices)" >&2
    exit 3
  fi
  waited=0
  until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] && adb shell pm path android >/dev/null 2>&1; do
    sleep 2; waited=$((waited + 2))
    if [ "$waited" -ge "$BOOT_TIMEOUT" ]; then
      echo "capture: no booted Android device after ${BOOT_TIMEOUT}s. Likely causes: no emulator is running (adb devices), the emulator is still booting on a busy machine, or adb is wedged (adb kill-server)." >&2
      echo "capture: retry: bash scripts/capture.sh android" >&2
      exit 4
    fi
  done
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

  # --- Reliability: a fresh emulator keeps doing first-boot work (default roles, package state, resource overlays) for a
  # minute or more after sys.boot_completed, longer on a busy machine. That work changes the resource assets path, which
  # Android answers by destroying and relaunching every visible activity (it cannot be declared in configChanges). If it
  # lands mid-run, the app restarts, `flutter drive` stays attached to the dead app and never finishes: no PNG, no exit.
  # So: (1) wait until the device is quiet before the drive, (2) watch for that relaunch and for a drive that is done
  # but not finishing, (3) stop it, say why, and retry the drive once.
  # Tuning (seconds, all optional): CAPTURE_SETTLE_QUIET 25, CAPTURE_SETTLE_UPTIME 150, CAPTURE_SETTLE_MAX 300,
  # CAPTURE_DONE_GRACE 60, CAPTURE_DRIVE_TIMEOUT 900, CAPTURE_RETRIES 1.
  WATCH_LOG="$WORK/relaunch.log"; WATCH_PID=""
  start_watch() { # every activity relaunch on the device, one line each (event-log tag wm_relaunch_resume_activity)
    : >"$WATCH_LOG"
    ( adb -s "$serial" logcat -b events -T 1 2>/dev/null | grep --line-buffered wm_relaunch_resume_activity >>"$WATCH_LOG" ) &
    WATCH_PID=$!
  }
  stop_watch() { if [ -n "$WATCH_PID" ]; then pkill -P "$WATCH_PID" 2>/dev/null || true; kill "$WATCH_PID" 2>/dev/null || true; WATCH_PID=""; fi; }
  APP_ID="$(grep -hEo 'applicationId[ =]+"[A-Za-z][A-Za-z0-9_.]*"' android/app/build.gradle android/app/build.gradle.kts 2>/dev/null | grep -Eo '"[^"]+"' | tr -d '"' | head -1 || true)"
  EXPECTED="$(printf '%s\n' "$ids" | grep -c . || true)"

  settle() { # wait until the device has been up long enough and no activity has been relaunched for a while
    local quiet="${CAPTURE_SETTLE_QUIET:-25}" minup="${CAPTURE_SETTLE_UPTIME:-150}" max="${CAPTURE_SETTLE_MAX:-300}"
    local t0 now up lines last lastchange
    t0="$(date +%s)"; lastchange="$t0"; last="$(wc -l <"$WATCH_LOG")"
    # A canary: Settings is a visible activity too, so it is relaunched by the same events and makes them countable.
    adb -s "$serial" shell am start -a android.settings.SETTINGS >/dev/null 2>&1 || true
    while :; do
      sleep 3
      now="$(date +%s)"
      up="$(adb -s "$serial" shell cat /proc/uptime 2>/dev/null | tr -d '\r' | cut -d. -f1)"; up="${up:-0}"
      lines="$(wc -l <"$WATCH_LOG")"
      if [ "$lines" != "$last" ]; then last="$lines"; lastchange="$now"; fi
      if [ "$up" -ge "$minup" ] && [ $((now - lastchange)) -ge "$quiet" ]; then break; fi
      if [ $((now - t0)) -ge "$max" ]; then echo "capture: device still busy after ${max}s (uptime ${up}s); continuing, the watchdog will retry if the app is relaunched" >&2; break; fi
    done
    adb -s "$serial" shell input keyevent KEYCODE_HOME >/dev/null 2>&1 || true
    echo "capture: device settled after $(( $(date +%s) - t0 ))s (uptime ${up}s, $last activity relaunches seen)" >&2
  }

  drive_android() {
    local retries="${CAPTURE_RETRIES:-1}" grace="${CAPTURE_DONE_GRACE:-60}" limit="${CAPTURE_DRIVE_TIMEOUT:-900}"
    local attempt=1 dlog="$WORK/drive.log" mark dpid tpid start now done_at reason rc pngs
    start_watch
    while :; do
      settle
      rm -f "$SHOTS"/*.png; : >"$dlog"
      mark="$(wc -l <"$WATCH_LOG")"
      set -m # the drive gets its own process group so the watchdog can stop it and everything it started
      SCRY_OUT="$SHOTS" flutter drive --driver=test_driver/integration_test.dart \
        --target=integration_test/scry_capture_test.dart -d "$serial" >"$dlog" 2>&1 &
      dpid=$!
      set +m
      tail -n +1 -f "$dlog" & tpid=$!
      reason=""; done_at=""; start="$(date +%s)"
      while kill -0 "$dpid" 2>/dev/null; do
        sleep 2
        now="$(date +%s)"
        if [ -n "$APP_ID" ] && tail -n +"$((mark + 1))" "$WATCH_LOG" | grep -F "$APP_ID/" >/dev/null; then
          reason="the app was destroyed and relaunched on the device mid-run (the emulator was still doing first-boot work), so flutter drive is attached to a dead app"; break
        fi
        if [ -z "$done_at" ] && grep -qE 'All tests passed|Some tests failed' "$dlog"; then done_at="$now"; fi
        if [ -n "$done_at" ] && [ $((now - done_at)) -ge "$grace" ]; then
          reason="the tests reported done ${grace}s ago but flutter drive has not finished and no screenshot was written"; break
        fi
        if [ $((now - start)) -ge "$limit" ]; then reason="flutter drive did not finish within ${limit}s"; break; fi
      done
      rc=0
      if [ -n "$reason" ]; then
        kill -TERM -- "-$dpid" 2>/dev/null || true; sleep 2; kill -KILL -- "-$dpid" 2>/dev/null || true
        wait "$dpid" 2>/dev/null || true
        [ -z "$APP_ID" ] || adb -s "$serial" shell am force-stop "$APP_ID" >/dev/null 2>&1 || true
      else
        wait "$dpid" || rc=$?
      fi
      sleep 1; kill "$tpid" 2>/dev/null || true; wait "$tpid" 2>/dev/null || true
      pngs="$(find "$SHOTS" -maxdepth 1 -name '*.png' | wc -l | tr -d ' ')"
      if [ -z "$reason" ] && [ "$rc" = 0 ] && [ "$pngs" = "$EXPECTED" ]; then stop_watch; return 0; fi
      if [ -z "$reason" ] && [ "$rc" != 0 ]; then
        stop_watch; echo "capture: flutter drive failed (exit $rc); the test output above says why. No bundle written." >&2; exit "$rc"
      fi
      [ -n "$reason" ] || reason="flutter drive exited 0 but wrote $pngs of $EXPECTED screenshots"
      if [ "$attempt" -le "$retries" ]; then
        echo "capture: attempt $attempt failed: $reason. Retrying the drive (attempt $((attempt + 1)))." >&2
        attempt=$((attempt + 1)); continue
      fi
      stop_watch
      echo "capture: android capture failed after $attempt attempt(s): $reason." >&2
      echo "capture: likely causes: (1) a freshly created emulator still doing first-boot work: wait a few minutes after boot and retry; (2) a busy machine starving the emulator: close other emulators and builds; (3) a system dialog holding focus: look at the screen (adb -s $serial exec-out screencap -p > screen.png); (4) a wedged adb: adb kill-server." >&2
      echo "capture: retry with: ANDROID_SERIAL=$serial bash scripts/capture.sh android" >&2
      exit 4
    done
  }

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
    stop_watch
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
  drive_android
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
