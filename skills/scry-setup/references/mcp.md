# Connect the remote MCP server

The hosted endpoint is `https://mcp.scrymore.com/mcp`. It uses browser OAuth and
sees projects readable by the signed-in account. Connecting it does not require
cloning the MCP worker, supplying Firebase service credentials, or installing
the Storybook deployer.

Inspect the client and existing server entry first. Reuse an entry pointing to
this endpoint, including a plugin-managed connection. Preserve other servers
and the user's configuration scope. If the client cannot be inferred, ask which
one to configure rather than modifying every installed assistant.

## Client configuration

For **Claude Code**, use its HTTP transport. `--scope project` shares the endpoint
configuration with this repository; use the user's requested scope if different:

```bash
claude mcp add --transport http --scope project scry https://mcp.scrymore.com/mcp
```

For **Codex**, check `codex mcp add --help`, then add and authenticate:

```bash
codex mcp add scry --url https://mcp.scrymore.com/mcp
codex mcp login scry
```

The CLI normally manages user configuration. For a requested project-local
connection, merge the equivalent entry into the project's supported Codex
configuration instead:

```toml
[mcp_servers.scry]
url = "https://mcp.scrymore.com/mcp"
```

For **other clients**, prefer their supported remote HTTP/OAuth connection UI or
configuration. Follow their current schema rather than copying another client's
JSON. For a client that requires stdio, merge this bridge into its MCP config:

```json
{
  "mcpServers": {
    "scry": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://mcp.scrymore.com/mcp"]
    }
  }
}
```

The bridge needs Node/npm. For a chat-only assistant without filesystem access,
guide the user through its connector UI; do not claim to have edited local
configuration. Reload/restart the client if needed and let the user complete
browser sign-in. Do not embed a deployment API key or a Firebase session token
in the MCP configuration.

## Verify an authenticated project search

1. Confirm the server exposes tools; call its `whoami` tool to establish the
   connected account. `whoami` here is an MCP tool, not the shell command.
2. Inspect the actual `search_components` input schema. Search for a known local
   component with `query` and the repository's `project_id` (and a small `limit`
   if supported). Do not omit the project filter merely because no match returns.
3. Check a result's `projectId`, `sourcePath`, and build/freshness metadata when
   provided. Fetch its screenshot with `get_component_screenshot`, using the
   actual tool schema, if screenshots are part of the requested verification.

Without `project_id`, search spans all projects readable by the account.
Broader discovery should be deliberate. The guide describes `scope: "project"`
and `scope: "org"`, but some server versions expose only `project_id`; only send
`scope` if the connected server advertises it. An empty search does not prove an
auth failure or a broken integration: check the query, project, uploaded
metadata, and processing status.

Use `sourcePath` for candidate imports and verify it exists locally; `storyPath`
is the story file. Cross-project matches may not be importable here. Freshness
can lag hosting; missing freshness fields do not establish that a result is
current. Screenshot URLs expire, so fetch screenshots through the tool when
needed rather than persisting signed URLs.

For 401/no tools, complete or renew OAuth and verify project access. For rate
limits, respect the server's retry guidance. Do not loop indefinitely while a
build is processing; report the pending phase and a concrete recheck.

Sources: [Scry MCP guide](https://docs.scrymore.com/guide/mcp),
[Codex MCP documentation](https://developers.openai.com/codex/mcp/),
[Claude Code MCP documentation](https://code.claude.com/docs/en/mcp).
