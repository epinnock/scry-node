#!/usr/bin/env bash
# Drift check: the skill's assets/ are copies of the Kettle sample apps (the sample apps are canonical).
# Usage: bash scripts/check-skill-sync.sh <scry-sample-ios dir> <scry-sample-android dir>
# Exit 0 = every copy matches its sample and the CI templates keep the G5 guards; 1 = drift (diff shown).
set -euo pipefail
[ $# -eq 2 ] || { echo "usage: $0 <ios-sample-dir> <android-sample-dir>" >&2; exit 2; }
IOS="$1"; AND="$2"
ASSETS="$(cd "$(dirname "$0")/../skills/scry-native-capture-setup/assets" && pwd)"
AK="$AND/app/src"; fail=0

check() { # <asset> <sample file>
  if [ ! -f "$2" ]; then echo "MISSING sample file: $2"; fail=1
  elif diff -u "$2" "$ASSETS/$1" >"${TMPDIR:-/tmp}/skill-sync.diff"; then echo "ok     $1 == $2"
  else echo "DRIFT  $1 differs from $2"; cat "${TMPDIR:-/tmp}/skill-sync.diff"; fail=1; fi
}
check ScryLaunch.swift        "$IOS/Kettle/ScryLaunch.swift"
check ScryScreens.swift       "$IOS/Kettle/ScryScreens.swift"
check capture-ios.sh          "$IOS/scripts/capture.sh"
check make-scf.mjs            "$IOS/scripts/make-scf.mjs"
check scry-capture-ios.yml    "$IOS/.github/workflows/scry-capture.yml"
check ScryLaunch.kt           "$(ls "$AK"/debug/java/*/*/*/ScryLaunch.kt 2>/dev/null | head -1)"
check ScryScreens.kt          "$(ls "$AK"/debug/java/*/*/*/ScryScreens.kt 2>/dev/null | head -1)"
check ScryLaunch-release.kt   "$(ls "$AK"/release/java/*/*/*/ScryLaunch.kt 2>/dev/null | head -1)"
check capture-android.sh      "$AND/scripts/capture.sh"
check scry-capture-android.yml "$AND/.github/workflows/scry-capture.yml"

# make-scf.mjs is shared: the asset is the iOS version, a superset of the Android sample's (which lacks
# --tool-name and the kind comment). Only that difference is tolerated for the Android copy.
if diff "$AND/scripts/make-scf.mjs" "$ASSETS/make-scf.mjs" | grep -E '^[<>]' | grep -vE "tool-name|kind is|kind\" is|tool: \{ name|a component entry" >/dev/null; then
  echo "DRIFT  Android make-scf.mjs differs from the shared asset beyond --tool-name"; fail=1
else echo "ok     make-scf.mjs: Android sample differs only by --tool-name / kind comment"; fi

# G5 on the CI templates: default branch only, no pull_request(_target), no self-hosted, key only on upload.
for y in scry-capture-ios.yml scry-capture-android.yml; do
  f="$ASSETS/$y"
  grep -Eq '^\s*(pull_request|pull_request_target)\s*:' "$f" && { echo "G5 FAIL $y: pull_request trigger"; fail=1; }
  grep -qi 'self-hosted' "$f" && { echo "G5 FAIL $y: self-hosted"; fail=1; }
  grep -q 'branches: \[main\]' "$f" || { echo "G5 FAIL $y: not limited to a branch"; fail=1; }
  n="$(grep -c 'secrets\.' "$f")"; [ "$n" -eq 1 ] || { echo "G5 FAIL $y: secrets referenced $n times (want 1, the upload step)"; fail=1; }
done
[ "$fail" -eq 0 ] && echo "PASS: skill assets match the samples, CI guards intact" || { echo "FAIL: drift found" >&2; exit 1; }
