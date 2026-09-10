# Sources and execution

| Source | How to use it | Scope and limits |
| --- | --- | --- |
| Host's available capabilities | Read supplied skills/tools and connected MCP/plugin status first | Authoritative for what this session can use; built-in tools come first |
| Local directories | Bundled scanner; or inspect known `SKILL.md` files | Defaults: project `.agents/skills`, `.codex/skills`, `.claude/skills`; user equivalents; respects `CODEX_HOME` for user Codex skills |
| OpenAI | [openai/skills](https://github.com/openai/skills) | Repository metadata is a lead; inspect the actual skill and dependencies |
| Anthropic | [anthropics/skills](https://github.com/anthropics/skills) | Some workflows or licenses may be specific to their environment |
| Vercel | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) | Focused web development skills; check the actual framework match |
| MCP Registry | [Official registry](https://registry.modelcontextprotocol.io/), public `/v0.1/servers` API | Searches names using up to four public keywords, latest versions only; listings are unreviewed publisher metadata |
| Plugin repositories | [openai/plugins](https://github.com/openai/plugins), or explicit `--plugin-repo` | Reads `.codex-plugin/plugin.json` or `.claude-plugin/plugin.json`; manifests do not prove host directory availability or connection state |
| Host plugin directory | Use read-only directory search when offered, then inspect exact IDs, dependencies and permissions | Preferred for host-compatible integrations; a recommended list is not a complete catalog |
| skills.sh | [Skill directory](https://skills.sh/) via search/browser; or `npx skills find public-keywords` when the CLI is already available or its use is authorized | Directory listings are leads, not audited packages; opening a generated link is a separate search |
| GitHub / vendor docs | Search `"SKILL.md" public-keywords` and follow primary links | Community collections can identify candidates but are not canonical installation sources |

The helper uses GET requests to `api.github.com` and `registry.modelcontextprotocol.io`. GitHub receives repository tree/blob requests, not query text. MCP Registry receives up to four public capability keywords. Neither receives local files or configuration. `GITHUB_TOKEN`, if set by the user, is sent only to `api.github.com`, never to the registry or listed endpoints. No package manager, candidate script, hook, or MCP server is executed. Redirects are rejected.

GitHub filtering starts with skill/plugin directory names and fetches at most eight matching files per repository. MCP searches server names, at most 20 latest entries per keyword on the first page, deduplicates server name/version, and skips explicitly inactive listings. Pagination is reported as partial coverage. A source may have zero matches when descriptions use different words. A truncated tree, failed request, invalid metadata or deadline is recorded as partial/error. All remote sources share a 15-second deadline. There is no persistent cache/history; the agent keeps repetition/decline context within the task.

```bash
# Offline: no external requests; query and inventory stay local.
node /path/to/skill-scout/scripts/scout.mjs --query "pdf forms" --offline

# Explicit roots replace defaults (repeat the flag for multiple roots).
node /path/to/skill-scout/scripts/scout.mjs --query "testing" --root /path/to/skills --offline

# Restrict search type; default is all three types.
node /path/to/skill-scout/scripts/scout.mjs --query "github" --kind mcp

# Explicit skill repositories replace skill defaults; kind restricts other types.
node /path/to/skill-scout/scripts/scout.mjs --query "deployment" --kind skills --repo your-team/skills

# Explicit plugin repositories replace the default OpenAI examples repository.
node /path/to/skill-scout/scripts/scout.mjs --query "calendar" --kind plugins --plugin-repo your-team/plugins
```

Local scanning follows symlinked skill folders, deduplicates real paths, and is bounded by depth/entry count. It does not scan entire drives, plugin caches, or MCP config containing secrets. Use host tools to inspect live integration state. CLI `installed: null` and `connectionState: unknown` mean unverified, not absent. Same-named local skills are possible overlaps; a skill name must not suppress an unrelated MCP or plugin.

The small frontmatter reader supports plain and quoted strings and folded/literal block descriptions. It is not a complete YAML parser; complex metadata should be read by the agent when the helper reports it unsupported. Search ranking is keyword matching, not a security score or a semantic guarantee. For Chinese requests the agent should derive suitable English capability keywords before running the helper.

Installation: verify the canonical repository and exact frontmatter name, review referenced code, then generate a command for the user's shell and agent. Project scope is the Skills CLI default. Use the host's native installer if it is more appropriate. Do not install all skills from a repository to obtain one skill. Inspect any different installation behavior immediately before proceeding with existing user authorization.

Documentation checked on 2026-09-10:

- [Skills CLI](https://github.com/vercel-labs/skills): `find`, named `add`, `--agent`, and project scope.
- [GitHub Git Trees API](https://docs.github.com/en/rest/git/trees): recursive tree listing and truncation.
- [GitHub Git Blobs API](https://docs.github.com/en/rest/git/blobs): read exact blob contents by SHA.
- [OpenAI skill authoring](https://learn.chatgpt.com/docs/build-skills): skill structure and invocation.
- [OpenAI AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md): project instructions.
- [MCP Registry](https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/api/official-registry-api.md): keyword filtering, versions and pagination.
- [OpenAI plugins](https://github.com/openai/plugins): repository manifests and marketplace examples.
