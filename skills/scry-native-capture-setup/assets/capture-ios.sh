#!/usr/bin/env bash
# scripts/capture.sh - build Kettle, open each registered screen in the iOS simulator, screenshot it,
# and write an SCF bundle to .scry/capture/.
#
#   ./scripts/capture.sh
#
# Needs macOS, Xcode 16+ with an iOS simulator runtime, and Node 20+.
# Optional env: DEVICE (default "iPhone 16"), OUT (default .scry/capture), SCALE (default 3),
#               SKIP_BUILD=1 (reuse .build/), SCHEME / PROJECT (default Kettle / Kettle.xcodeproj).
# It never uploads anything: see README step 4.
set -euo pipefail
cd "$(dirname "$0")/.."

DEVICE="${DEVICE:-iPhone 16}"
OUT="${OUT:-.scry/capture}"
SCALE="${SCALE:-3}"
SCHEME="${SCHEME:-Kettle}"
PROJECT="${PROJECT:-Kettle.xcodeproj}"
DERIVED=".build"

# DEVICE, SCHEME, PROJECT and SCALE reach xcrun/xcodebuild arguments: accept only these shapes. The bad value is
# never printed (it may carry control characters or a secret pasted by mistake).
# LC_ALL=C for the match: [A-Za-z] ranges are locale-sensitive (an accented letter passes under en_US.UTF-8).
check_env() { # <name> <value> <regex>
  local LC_ALL=C
  [[ "$2" =~ $3 ]] || { echo "capture: $1 has an unexpected shape (see the pattern in scripts/capture.sh); not run" >&2; exit 1; }
}
check_env DEVICE  "$DEVICE"  '^[A-Za-z0-9][A-Za-z0-9 ().,_+-]{0,63}$'
check_env SCHEME  "$SCHEME"  '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
check_env PROJECT "$PROJECT" '^[A-Za-z0-9_.][A-Za-z0-9_./-]{0,127}\.xcodeproj$'
check_env SCALE   "$SCALE"   '^[1-9](\.[0-9]{1,3})?$'

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

for tool in xcrun xcodebuild node; do
  command -v "$tool" >/dev/null || { echo "capture: '$tool' not found. This script needs macOS with Xcode and Node 20+." >&2; exit 1; }
done

# OUT is deleted and recreated by make-scf.mjs: refuse a bad one now, before the (slow) build and capture.
node scripts/make-scf.mjs --check --out "$OUT" || exit 1

# Screen ids reach `simctl launch` arguments and grep patterns: accept only this shape.
valid_id() { local LC_ALL=C; [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]]; }

# 1. Find the simulator (the newest available runtime that has $DEVICE).
SIM="$(xcrun simctl list devices available -j | DEVICE="$DEVICE" node -e '
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
  echo "capture: no simulator named \"$DEVICE\" found. Install an iOS runtime (Xcode > Settings > Components), then:" >&2
  echo "  xcrun simctl list devices available | grep -i iphone     # pick a name, then DEVICE=\"<name>\" ./scripts/capture.sh" >&2
  exit 1
fi
echo "capture: simulator $DEVICE, $DEVICE_OS ($UDID)"

# 2. Build the Debug app for that simulator (the capture hook is compiled in Debug only).
if [ "${SKIP_BUILD:-0}" != "1" ]; then
  echo "capture: building $SCHEME (Debug)..."
  if ! xcodebuild -project "$PROJECT" -scheme "$SCHEME" -configuration Debug -sdk iphonesimulator \
       -destination "id=$UDID" -derivedDataPath "$DERIVED" build >"$WORK/build.log" 2>&1; then
    tail -40 "$WORK/build.log" >&2
    echo "capture: build failed (last lines above)" >&2
    exit 1
  fi
fi
APP="$DERIVED/Build/Products/Debug-iphonesimulator/$SCHEME.app"
[ -d "$APP" ] || { echo "capture: $APP not found after build" >&2; exit 1; }
BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Info.plist")"

# 3. Boot, set a clean status bar, install.
xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b >/dev/null
xcrun simctl status_bar "$UDID" override --time "9:41" --batteryState charged --batteryLevel 100 \
  --cellularMode active --cellularBars 4 --wifiBars 3
xcrun simctl install "$UDID" "$APP"

# launch_and_wait <log> <grep-flags> <marker> <args...>: launch with the app's stdout in <log>, wait up to 20 s for <marker>.
# <grep-flags> is -q (marker is a regex, only for the fixed list marker) or -qxF (marker is a whole line, fixed string).
launch_and_wait() {
  local log="$1" flags="$2" marker="$3"; shift 3
  : >"$log"
  xcrun simctl terminate "$UDID" "$BUNDLE_ID" >/dev/null 2>&1 || true
  xcrun simctl launch --console "$UDID" "$BUNDLE_ID" "$@" >"$log" 2>&1 &
  LAUNCH_PID=$!
  for _ in $(seq 1 40); do grep "$flags" -- "$marker" "$log" 2>/dev/null && return 0; sleep 0.5; done
  return 1
}

# 4. Ask the app for its registry (ScryScreens.swift is the single source of ids).
if ! launch_and_wait "$WORK/list.log" -q "^scry:screens " -ScryList YES; then
  echo "capture: the app did not print its screen list (see below)" >&2; cat "$WORK/list.log" >&2; exit 1
fi
kill "$LAUNCH_PID" 2>/dev/null || true
sed -n 's/^scry:screens //p' "$WORK/list.log" | head -1 >"$WORK/screens.json"
IDS="$(SCREENS="$WORK/screens.json" node -e 'for (const s of JSON.parse(require("fs").readFileSync(process.env.SCREENS, "utf8"))) console.log(s.id)')"

# 5. One screenshot per id.
mkdir -p "$WORK/shots"
captured=0
rejected=0
while IFS= read -r id <&3; do
  [ -n "$id" ] || continue
  if ! valid_id "$id"; then
    echo "capture: rejected screen id '$id' (must match ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\$); not launched" >&2
    rejected=$((rejected + 1)); continue
  fi
  if launch_and_wait "$WORK/$id.log" -qxF "scry:ready $id" -ScryScreen "$id"; then
    sleep 0.5   # one settled frame
    xcrun simctl io "$UDID" screenshot --type=png "$WORK/shots/$id.png" >/dev/null 2>&1
    captured=$((captured + 1))
    echo "capture: $id ok"
  else
    echo "capture: $id never reported ready (app output: $(tr '\n' ' ' <"$WORK/$id.log"))" >&2
  fi
  kill "$LAUNCH_PID" 2>/dev/null || true
done 3<<<"$IDS"
xcrun simctl terminate "$UDID" "$BUNDLE_ID" >/dev/null 2>&1 || true
xcrun simctl status_bar "$UDID" clear >/dev/null 2>&1 || true

if [ "$rejected" -gt 0 ]; then
  echo "capture: $rejected screen id(s) rejected; fix the ids in ScryScreens.swift (no bundle written)" >&2
  exit 1
fi
if [ "$captured" -eq 0 ]; then
  echo "capture produced 0 screens" >&2
  exit 1
fi

# 6. Write the bundle (exits 1 if any registered screen is missing, so a half capture never looks green).
node scripts/make-scf.mjs --platform ios --screens "$WORK/screens.json" --shots "$WORK/shots" --out "$OUT" \
  --device "$DEVICE" --device-os "$DEVICE_OS" --scale "$SCALE" --tool-name "scry-sample-ios capture.sh"
echo "capture: bundle written to $OUT. Next: npx @scrymore/scry-deployer upload $OUT --dry-run"
