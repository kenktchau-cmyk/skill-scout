# Sources and execution

| Source | How to use it | Scope and limits |
| --- | --- | --- |
| Host's available skills | Read the supplied names/descriptions first | Authoritative for what this session can use, including plugin skills |
| Local directories | Bundled scanner; or inspect known `SKILL.md` files | Defaults: project `.agents/skills`, `.codex/skills`, `.claude/skills`; user equivalents; respects `CODEX_HOME` for user Codex skills |
| OpenAI | [openai/skills](https://github.com/openai/skills) | Repository metadata is a lead; inspect the actual skill and dependencies |
| Anthropic | [anthropics/skills](https://github.com/anthropics/skills) | Some workflows or licenses may be specific to their environment |
| Vercel | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) | Focused web development skills; check the actual framework match |
| skills.sh | [Skill directory](https://skills.sh/) via search/browser; or `npx skills find public-keywords` when the CLI is already available or its use is authorized | Directory listings are leads, not audited packages; opening a generated link is a separate search |
| GitHub / vendor docs | Search `"SKILL.md" public-keywords` and follow primary links | Community collections can identify candidates but are not canonical installation sources |

The helper uses GitHub's public REST API with GET requests. It does not send query text or local files; it fetches configured repository trees and matching blobs, then ranks locally. `GITHUB_TOKEN`, if set by the user, is sent only to `api.github.com`. Tokens are not required for public repositories; unauthenticated rate limits are small. Redirects are rejected. No package manager or remote script is executed.

Remote filtering starts with skill directory names and fetches at most eight matching files per repository. A source may therefore have zero matches even if a suitable skill has an unrelated name. A truncated tree, request failure, invalid metadata, or request budget expiry is recorded as partial/error, not a successful exhaustive search. The overall deadline defaults to 15 seconds. There is no persistent cache or recommendation history; the agent keeps repetition/decline context within the task.

```bash
# Offline: no external requests; query and inventory stay local.
node /path/to/skill-scout/scripts/scout.mjs --query "pdf forms" --offline

# Explicit roots replace defaults (repeat the flag for multiple roots).
node /path/to/skill-scout/scripts/scout.mjs --query "testing" --root /path/to/skills --offline

# Explicit repositories replace defaults; this reads that repository only.
node /path/to/skill-scout/scripts/scout.mjs --query "deployment" --repo your-team/skills
```

Local scanning follows symlinked skill folders, deduplicates their real paths, and is bounded by depth and entry count. It does not scan entire drives or plugin caches. Pass additional known roots explicitly; use the host's available-skill list to cover plugin skills. An identical skill name is marked as a possible installed overlap, not proof that two publishers provide the same skill.

The small frontmatter reader supports plain and quoted strings and folded/literal block descriptions. It is not a complete YAML parser; complex metadata should be read by the agent when the helper reports it unsupported. Search ranking is keyword matching, not a security score or a semantic guarantee. For Chinese requests the agent should derive suitable English capability keywords before running the helper.

Installation: verify the canonical repository and exact frontmatter name, review referenced code, then generate a command for the user's shell and agent. Project scope is the Skills CLI default. Use the host's native installer if it is more appropriate. Do not install all skills from a repository to obtain one skill. Inspect any different installation behavior immediately before proceeding with existing user authorization.

Documentation checked on 2026-09-10:

- [Skills CLI](https://github.com/vercel-labs/skills): `find`, named `add`, `--agent`, and project scope.
- [GitHub Git Trees API](https://docs.github.com/en/rest/git/trees): recursive tree listing and truncation.
- [GitHub Git Blobs API](https://docs.github.com/en/rest/git/blobs): read exact blob contents by SHA.
- [OpenAI skill authoring](https://learn.chatgpt.com/docs/build-skills): skill structure and invocation.
- [OpenAI AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md): project instructions.
