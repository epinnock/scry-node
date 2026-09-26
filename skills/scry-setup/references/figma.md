# Optional Figma linking

Use the [Scry - Storybook Linker community plugin](https://www.figma.com/community/plugin/1602918953997015259).
This is a Figma plugin, separate from an AI assistant's skill or MCP connection.

For basic linking, the user can run it in a Figma file, paste a hosted Storybook
URL into **Connect your Storybook**, and choose **+ Add Storybook**. The URL must
serve `index.json`. No Scry account is required for basic linking or name-based
suggestions, and the Storybook can be hosted outside Scry.

For a Scry project, use **Sign in with Scrymore**, complete the device approval
in the browser, and select the project. This adds project-backed visual
matching, screenshot sync, and design review features. Backend Figma OAuth via
the dashboard's **Connect Figma** is a separate connection; use it when the
requested backend feature needs it, not as a prerequisite for basic linking.

Verify by selecting a component/frame, linking it to a known story, and opening
**View Story**. Suggestions require acceptance before they create links. Use
the Figma UI or an available authorized integration; if neither is accessible,
give the user these exact remaining steps rather than claiming the link exists.

If URL connection fails, check reachability, `index.json`, and CORS. Private
Scry Storybooks should use project sign-in rather than being made public.
Arbitrary Storybooks behind another login/VPN may be unreachable from Figma.
Embedding restrictions are separate from listing stories; use **Open in
Browser** when an iframe preview is blocked. A design diff needs both the
synced Figma render and an uploaded Storybook screenshot.

Source: [Scry Figma guide](https://docs.scrymore.com/guide/figma-plugin).
