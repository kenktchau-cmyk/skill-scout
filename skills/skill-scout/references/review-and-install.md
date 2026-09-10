# Review and installation by type

Use the smallest useful set of additions. Existing tool access can make a new skill, MCP server, or plugin unnecessary. If a plugin already bundles the required skill and MCP integration, explain that one installation covers the need. Do not combine separate publishers just because their names resemble each other.

| Type | Inspect before recommending | Explain to the user | Install/connect after applicable authorization |
| --- | --- | --- | --- |
| Skill | Actual `SKILL.md`, relevant scripts, referenced resources, runtime/OS, license and overlaps | The part of the task its workflow improves; existing-name collisions | Host skill installer or verified `npx skills add owner/repo --skill exact-name --agent codex`; project scope by default |
| MCP server | Canonical publisher docs and repository; registry version/package; stdio vs HTTP transport; endpoint ownership; available tools; OAuth/API key needs; write/file/network permissions | Whether it runs locally or remotely, what data/tools it exposes, required accounts and verified costs if relevant, current connection status | Fetch current host MCP setup docs. For local stdio, review package and arguments before running code; for remote transport, verify the endpoint and authorization flow. Never copy registry snippets straight into user config |
| Plugin | Exact host directory listing/ID or source manifest; bundled skills/MCP/apps/hooks; required accounts; permissions; supported host; license | What the bundle adds, dependencies it includes, installed/pending/connected status and overlap with other proposals | Prefer host directory suggestion/installation flow with the exact returned ID. Honor tool restrictions. Check individual connector state after installation; installing a plugin alone may not complete authentication |

When available, use host plugin search to discover candidates, dependency inspection to understand the bundle, and permission inspection to check the scopes. Tool availability differs by host; do not assume functions named in a guide are callable. If directory search is unavailable, use the repository and official vendor pages as leads and label host availability unverified.

For a newly discovered integration, distinguish:

- **Available and working:** use it; no installation recommendation.
- **Installed but disconnected:** explain the missing connection; do not recommend a duplicate installation.
- **Not installed:** recommend only after reviewing fit and requirements.
- **Unknown:** inspect through host tools or state that it has not been verified.

The CLI's MCP `remotes` and package fields are metadata only. It does not contact endpoints, enumerate server tools, test credentials, perform OAuth, or prove permissions. Registry-supplied commands/headers and plugin hooks are never executed during discovery. The manifest `components` field identifies declared components; inspect the actual referenced files for the complete dependency picture.

Do not ask the user to paste credentials in chat. Use the host's normal secret and authorization flows. Preserve existing authorization for a specific addition and stop only for an actual missing decision, permission, or account action.

Current sources:

- [MCP Registry consumer API](https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/api/official-registry-api.md)
- [MCP Registry server schema](https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/server-json/generic-server-json.md)
- [OpenAI plugin examples and marketplace](https://github.com/openai/plugins)
