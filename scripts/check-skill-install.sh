#!/usr/bin/env bash
# AT-16: install skills/scry-native-capture-setup from this checkout with `npx skills add` into a
# throwaway HOME and project, then check the skill landed and its SKILL.md frontmatter parses.
# Usage: bash scripts/check-skill-install.sh [skill-name]   (default: scry-native-capture-setup)
# Also fails if the skill names the old epinnock/scry-node repo. Needs network for `npx skills` (npm registry) the first time. Never touches the real HOME or repo.
set -euo pipefail
SKILL="${1:-scry-native-capture-setup}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/home" "$TMP/project"
git -C "$TMP/project" init -q .

# F14: the skill must name the canonical repo, never the old epinnock/ name.
if grep -rn "epinnock/scry-node" "$REPO/skills/$SKILL" >/dev/null 2>&1; then
  echo "FAIL: skills/$SKILL still mentions epinnock/scry-node (use scryorg/scry-node)" >&2; exit 1
fi
grep -q "npx skills add scryorg/scry-node --skill $SKILL" "$REPO/skills/$SKILL/SKILL.md" \
  || { echo "FAIL: SKILL.md does not show 'npx skills add scryorg/scry-node --skill $SKILL'" >&2; exit 1; }
echo "canonical install command: npx skills add scryorg/scry-node --skill $SKILL (this script installs from the local checkout)"

echo "install: npx skills add $REPO --skill $SKILL  (HOME=$TMP/home)"
(cd "$TMP/project" && HOME="$TMP/home" npx --yes skills add "$REPO" --skill "$SKILL" -y >"$TMP/install.log" 2>&1) \
  || { tail -20 "$TMP/install.log" >&2; echo "FAIL: skills add exited non-zero" >&2; exit 1; }

# The installer writes the canonical copy to .agents/skills/<name> and links Claude Code to it
# (other agents such as Amp get a rewritten copy under agent/skills; not checked here).
FOUND="$TMP/project/.agents/skills/$SKILL/SKILL.md"
[ -f "$FOUND" ] || { tail -20 "$TMP/install.log" >&2; echo "FAIL: .agents/skills/$SKILL/SKILL.md not found after install" >&2; exit 1; }
echo "landed:  ${FOUND#"$TMP"/}"
[ -f "$TMP/project/.claude/skills/$SKILL/SKILL.md" ] || { echo "FAIL: Claude Code link .claude/skills/$SKILL missing" >&2; exit 1; }
echo "landed:  project/.claude/skills/$SKILL/SKILL.md (Claude Code)"

# Only the requested skill may have been installed (no scry-setup riding along).
OTHERS="$(find "$TMP/project/.agents/skills" -mindepth 2 -maxdepth 2 -name SKILL.md ! -path "*/$SKILL/*" 2>/dev/null || true)"
[ -z "$OTHERS" ] || { echo "FAIL: unexpected extra skills installed: $OTHERS" >&2; exit 1; }

SKILL_MD="$FOUND" SKILL_NAME="$SKILL" node -e '
const fs = require("fs"), path = require("path");
const file = process.env.SKILL_MD, name = process.env.SKILL_NAME;
const text = fs.readFileSync(file, "utf8");
const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
if (!m) { console.error("FAIL: no YAML frontmatter"); process.exit(1); }
const fm = {};
for (const line of m[1].split(/\r?\n/)) { const k = /^([A-Za-z_-]+):\s*(.*)$/.exec(line); if (k) fm[k[1]] = k[2].trim(); }
if (fm.name !== name) { console.error(`FAIL: frontmatter name "${fm.name}" != "${name}"`); process.exit(1); }
if (!fm.description || fm.description.length < 40 || fm.description.length > 1024) { console.error("FAIL: description missing or outside 40..1024 chars"); process.exit(1); }
// every relative link in SKILL.md must resolve inside the installed skill
const dir = path.dirname(file), bad = [];
for (const l of text.matchAll(/\]\((?!https?:|#)([^)\s]+)\)/g)) if (!fs.existsSync(path.join(dir, l[1]))) bad.push(l[1]);
if (bad.length) { console.error("FAIL: broken relative links: " + bad.join(", ")); process.exit(1); }
const files = fs.readdirSync(dir, { recursive: true }).filter((f) => fs.statSync(path.join(dir, f)).isFile());
console.log(`frontmatter ok: name=${fm.name}, description ${fm.description.length} chars, ${files.length} files installed`);
'

# scry-native-capture-setup covers Flutter (feature flutter-capture): the Flutter files must have landed, the
# skill must not still refuse Flutter, and UIKit-only must still be refused with the pointer to bundle.md.
if [ "$SKILL" = scry-native-capture-setup ]; then
  D="$TMP/project/.agents/skills/$SKILL"
  for f in references/flutter.md references/bundle.md assets/make-scf.mjs assets/flutter/capture.sh assets/flutter/screens.dart \
           assets/flutter/screens.json assets/flutter/scry_capture_test.dart assets/flutter/headless_scry_capture_test.dart \
           assets/flutter/test_driver_integration_test.dart assets/flutter/scry_fonts.dart assets/flutter/scry_registry_test.dart; do
    [ -f "$D/$f" ] || { echo "FAIL: $f missing from the installed skill" >&2; exit 1; }
  done
  if grep -Eqi 'not for[^.]*flutter|UIKit-only, Flutter' "$D/SKILL.md"; then
    echo "FAIL: SKILL.md still refuses Flutter" >&2; exit 1
  fi
  grep -qi 'UIKit-only' "$D/SKILL.md" && grep -q 'references/bundle.md' "$D/SKILL.md" \
    || { echo "FAIL: SKILL.md no longer refuses UIKit-only with the pointer to references/bundle.md" >&2; exit 1; }
  grep -q 'references/flutter.md' "$D/SKILL.md" || { echo "FAIL: SKILL.md does not link references/flutter.md" >&2; exit 1; }
  echo "flutter: reference and assets installed, Flutter no longer refused, UIKit-only still refused"
fi
echo "PASS: $SKILL installs and parses"
