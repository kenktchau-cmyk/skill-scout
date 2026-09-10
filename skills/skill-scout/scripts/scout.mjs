#!/usr/bin/env node
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const DEFAULT_REPOS = ['openai/skills', 'anthropics/skills', 'vercel-labs/agent-skills'];
export const DEFAULT_PLUGIN_REPOS = ['openai/plugins'];
const MAX_BYTES = 256 * 1024;
const SKIP = new Set(['.git', 'node_modules', '.venv', 'vendor', 'build', 'dist']);
const STOP = new Set(['a', 'an', 'and', 'for', 'the', 'to', 'with', 'skill', 'skills']);

export function termsFor(query) {
  return [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])]
    .filter(word => word.length > 1 && !STOP.has(word));
}

function unquote(value) {
  if (value.startsWith('"')) {
    try { return JSON.parse(value); } catch { return null; }
  }
  if (value.startsWith("'")) {
    return value.endsWith("'") ? value.slice(1, -1).replaceAll("''", "'") : null;
  }
  if (/^[\[\]{}&*!>|]/.test(value)) return null;
  return value.replace(/\s+#.*$/, '').trim();
}

export function parseSkill(text) {
  const front = text.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n').match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!front) return null;
  const lines = front[1].split('\n');
  const fields = {};
  for (let i = 0; i < lines.length; i++) {
    const match = /^(name|description):\s*(.*?)\s*$/.exec(lines[i]);
    if (!match) continue;
    if (Object.hasOwn(fields, match[1])) return null;
    let value = match[2];
    if (/^[>|][-+]?$/.test(value)) {
      const block = [];
      while (i + 1 < lines.length && /^(\s|$)/.test(lines[i + 1])) block.push(lines[++i].trim());
      value = block.join(value.startsWith('>') ? ' ' : '\n').trim();
    } else {
      // YAML also permits indented continuation of a plain string without >.
      // Do not interpret nested mappings or collections as descriptions.
      if (!value.startsWith('"') && !value.startsWith("'")) {
        const continuation = [];
        while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) continuation.push(lines[++i].trim());
        if (continuation.some(line => /^[-?]\s|^[\w-]+:\s/.test(line))) return null;
        value = [value, ...continuation].filter(Boolean).join(' ');
      }
      value = unquote(value);
    }
    fields[match[1]] = value;
  }
  if (typeof fields.name !== 'string' || typeof fields.description !== 'string') return null;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fields.name) || fields.name.length > 64) return null;
  if (!fields.description.trim() || fields.description.length > 4096) return null;
  return { name: fields.name, description: fields.description };
}

export function rank(candidate, terms) {
  const name = new Set(termsFor(candidate.name));
  const description = new Set(termsFor(candidate.description ?? ''));
  const matchedTerms = terms.filter(term => name.has(term) || description.has(term));
  const score = matchedTerms.reduce((sum, term) => sum + (name.has(term) ? 5 : 2), 0);
  return { ...candidate, score, matchedTerms };
}

export function parsePlugin(text) {
  let manifest;
  try { manifest = JSON.parse(text); } catch { return null; }
  if (!manifest || typeof manifest.name !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(manifest.name)) return null;
  if (typeof manifest.description !== 'string' || !manifest.description.trim()) return null;
  return { name: manifest.name, description: manifest.description.slice(0,4096),
    version: typeof manifest.version === 'string' ? manifest.version : null,
    components: ['skills', 'apps', 'mcpServers', 'hooks', 'commands'].filter(key => Object.hasOwn(manifest, key)) };
}

export function defaultRoots(cwd = process.cwd(), home = homedir(), env = process.env) {
  return [...new Set([
    ...['.agents', '.codex', '.claude'].map(dir => path.join(cwd, dir, 'skills')),
    path.join(home, '.agents', 'skills'),
    path.join(env.CODEX_HOME || path.join(home, '.codex'), 'skills'),
    path.join(home, '.claude', 'skills'),
  ])];
}

export async function scanLocal(roots, { maxEntries = 3000, maxDepth = 8 } = {}) {
  const candidates = [];
  const sources = [];
  const visited = new Set();
  let count = 0;
  for (const root of roots) {
    const source = { source: 'local', root: path.resolve(root), status: 'ok', found: 0, warnings: [] };
    async function walk(folder, depth) {
      if (++count > maxEntries || depth > maxDepth) {
        source.status = 'partial';
        if (!source.warnings.includes('scan-limit')) source.warnings.push('scan-limit');
        return;
      }
      let canonical;
      let entries;
      try {
        canonical = await realpath(folder);
        if (visited.has(canonical)) return;
        visited.add(canonical);
        entries = await readdir(canonical, { withFileTypes: true });
      } catch (error) {
        if (depth === 0 && error.code === 'ENOENT') source.status = 'missing';
        else { source.status = 'partial'; source.warnings.push(`unreadable-directory:${error.code ?? 'error'}`); }
        return;
      }
      for (const entry of entries) {
        if (SKIP.has(entry.name)) continue;
        const location = path.join(canonical, entry.name);
        if (entry.name === 'SKILL.md' && entry.isFile()) {
          try {
            if ((await stat(location)).size > MAX_BYTES) throw new Error('oversize-skill');
            const skill = parseSkill(await readFile(location, 'utf8'));
            if (!skill) throw new Error('unsupported-frontmatter');
            candidates.push({ ...skill, kind: 'skill', source: 'local', path: location, installed: true });
            source.found++;
          } catch (error) {
            source.status = 'partial';
            source.warnings.push(`${entry.name}:${error.code ?? error.message}`);
          }
        } else if (entry.isDirectory() || entry.isSymbolicLink()) {
          if (count >= maxEntries) {
            source.status = 'partial';
            if (!source.warnings.includes('scan-limit')) source.warnings.push('scan-limit');
            break;
          }
          await walk(location, depth + 1);
        }
      }
    }
    await walk(root, 0);
    sources.push(source);
  }
  return { candidates, sources };
}

export function validateRepo(repo) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*\/[a-zA-Z0-9_.-]+$/.test(repo) || /\/(\.|\.\.)$/.test(repo)) {
    throw new Error(`Invalid repository: expected owner/repository`);
  }
  return repo;
}

async function apiJson(endpoint, { fetchImpl, token, signal }) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'skill-scout' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetchImpl(`https://api.github.com${endpoint}`, { headers, signal, redirect: 'error' });
  if (!response.ok) throw new Error(`github-http-${response.status}`);
  // Tree responses have a documented maximum of 7 MB. Bound all responses.
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 8 * 1024 * 1024) throw new Error('github-response-too-large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function scanRepo(repo, terms, options) {
  validateRepo(repo);
  const kind = options.kind ?? 'skill';
  const source = { source: 'github', kind, repo, status: 'ok', found: 0, inspected: 0, warnings: [] };
  const candidates = [];
  try {
    const tree = await apiJson(`/repos/${repo}/git/trees/HEAD?recursive=1`, options);
    if (!Array.isArray(tree.tree)) throw new Error('invalid-tree-response');
    if (tree.truncated) { source.status = 'partial'; source.warnings.push('truncated-tree'); }
    const filePattern = kind === 'plugin' ? /(^|\/)\.(codex|claude)-plugin\/plugin\.json$/ : /(^|\/)SKILL\.md$/;
    const paths = tree.tree.filter(item => item.type === 'blob' && filePattern.test(item.path))
      .filter(item => item.mode !== '120000')
      .map(item => ({ ...item, pathScore: rank({ name: path.posix.basename(kind === 'plugin'
        ? path.posix.dirname(path.posix.dirname(item.path)) : path.posix.dirname(item.path)), description: '' }, terms).score }))
      .filter(item => item.pathScore > 0)
      .sort((a, b) => b.pathScore - a.pathScore || a.path.localeCompare(b.path));
    source.pathMatches = paths.length;
    if (paths.length > 8) { source.status = 'partial'; source.warnings.push('candidate-limit'); }
    // Sequential blobs avoid bursts; repositories run concurrently under one deadline.
    for (const item of paths.slice(0, 8)) {
      if (options.signal.aborted) { source.status = 'partial'; source.warnings.push('deadline'); break; }
      try {
        if (!/^[a-f0-9]{40,64}$/.test(item.sha)) throw new Error('invalid-blob-sha');
        if (item.size > MAX_BYTES) throw new Error('oversize-skill');
        const blob = await apiJson(`/repos/${repo}/git/blobs/${item.sha}`, options);
        if (blob.encoding !== 'base64' || typeof blob.content !== 'string') throw new Error('invalid-blob-response');
        const bytes = Buffer.from(blob.content, 'base64');
        if (bytes.length > MAX_BYTES) throw new Error('oversize-skill');
        const skill = kind === 'plugin' ? parsePlugin(bytes.toString('utf8')) : parseSkill(bytes.toString('utf8'));
        source.inspected++;
        if (!skill) throw new Error(kind === 'plugin' ? 'unsupported-plugin-manifest' : 'unsupported-frontmatter');
        candidates.push({ ...skill, kind, source: 'github', repo, metadataPath: item.path,
          ...(kind === 'skill' ? { skillPath: item.path } : { host: item.path.includes('.codex-plugin/') ? 'codex' : 'claude-code', connectionState: 'unknown' }), blobSha: item.sha,
          sourceUrl: `https://github.com/${repo}/blob/HEAD/${item.path.split('/').map(encodeURIComponent).join('/')}`,
          reviewStatus: 'unreviewed', installed: kind === 'skill' ? false : null });
        source.found++;
      } catch (error) {
        source.status = 'partial';
        source.warnings.push(options.signal.aborted ? 'deadline' : safeError(error));
        if (/github-http-(403|429)/.test(error.message) || options.signal.aborted) break;
      }
    }
  } catch (error) {
    source.status = 'error';
    source.warnings.push(options.signal.aborted ? 'deadline' : safeError(error));
  }
  return { candidates, source };
}

function safeError(error) {
  // Never echo a transport error, header, token, or arbitrary response body.
  return /^(github-http-\d{3}|github-response-too-large|invalid-tree-response|invalid-blob-response|invalid-blob-sha|oversize-skill|unsupported-frontmatter|unsupported-plugin-manifest|registry-http-\d{3}|invalid-registry-response|registry-response-too-large)$/.test(error.message)
    ? error.message : 'request-failed';
}

function publicHttps(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export async function scanMcp(terms, { fetchImpl, signal }) {
  const source = { source: 'mcp-registry', kind: 'mcp', status: 'ok', found: 0, queries: [], warnings: [] };
  const candidates = new Map();
  let succeeded = 0;
  for (const term of terms.slice(0,4)) {
    if (signal.aborted) { source.status = succeeded ? 'partial' : 'error'; source.warnings.push('deadline'); break; }
    source.queries.push(term);
    try {
      const url = new URL('https://registry.modelcontextprotocol.io/v0.1/servers');
      url.search = new URLSearchParams({ search: term, version: 'latest', limit: '20' }).toString();
      // Never forward a GitHub token, local config, or endpoint credentials.
      const response = await fetchImpl(url.href, { headers: { Accept: 'application/json' }, signal, redirect: 'error' });
      if (!response.ok) throw new Error(`registry-http-${response.status}`);
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) throw new Error('registry-response-too-large');
        chunks.push(chunk);
      }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!Array.isArray(data.servers)) throw new Error('invalid-registry-response');
      succeeded++;
      if (data.metadata?.nextCursor) { source.status = 'partial'; source.warnings.push('more-registry-pages'); }
      for (const entry of data.servers.slice(0,20)) {
        const server = entry?.server;
        const status = entry?._meta?.['io.modelcontextprotocol.registry/official']?.status;
        if (status && status !== 'active') continue;
        if (!server || typeof server.name !== 'string' || !server.name.trim() || server.name.length > 200
          || typeof server.version !== 'string' || typeof server.description !== 'string') {
          source.status = 'partial'; source.warnings.push('invalid-registry-entry'); continue;
        }
        const item = { kind: 'mcp', name: server.name, description: server.description.slice(0,4096), version: server.version,
          source: 'mcp-registry', sourceUrl: `https://registry.modelcontextprotocol.io/v0.1/servers/${encodeURIComponent(server.name)}/versions/${encodeURIComponent(server.version)}`,
          repositoryUrl: publicHttps(server.repository?.url), registryStatus: status ?? 'unknown',
          remotes: (Array.isArray(server.remotes) ? server.remotes : []).slice(0,8).map(remote => ({
            transport: typeof remote?.type === 'string' ? remote.type : null, url: publicHttps(remote?.url),
            requiredHeaders: (Array.isArray(remote?.headers) ? remote.headers : []).filter(header => header?.isRequired && typeof header.name === 'string').map(header => header.name),
          })),
          packages: (Array.isArray(server.packages) ? server.packages : []).slice(0,8).map(pkg => ({
            registryType: typeof pkg?.registryType === 'string' ? pkg.registryType : null,
            identifier: typeof pkg?.identifier === 'string' ? pkg.identifier : null,
            version: typeof pkg?.version === 'string' ? pkg.version : null,
          })),
          installed: null, connectionState: 'unknown', reviewStatus: 'unreviewed' };
        candidates.set(`${item.name}@${item.version}`, item);
      }
    } catch (error) {
      source.warnings.push(signal.aborted ? 'deadline' : safeError(error));
      source.status = succeeded ? 'partial' : 'error';
      if (signal.aborted || /registry-http-(403|429)/.test(error.message)) break;
    }
  }
  source.found = candidates.size;
  if (succeeded && source.status === 'error') source.status = 'partial';
  source.warnings = [...new Set(source.warnings)];
  return { candidates: [...candidates.values()], source };
}

export async function discover({ query, roots = defaultRoots(), repos = DEFAULT_REPOS, pluginRepos = DEFAULT_PLUGIN_REPOS, kind = 'all',
  offline = false, limit = 3, timeoutMs = 15000, fetchImpl = fetch, token = process.env.GITHUB_TOKEN } = {}) {
  if (typeof query !== 'string' || !query.trim() || query.length > 500) throw new Error('Provide 1–500 characters of capability keywords.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('limit must be an integer from 1 to 20');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new Error('timeout-ms must be an integer from 1 to 60000');
  if (!['all', 'skills', 'mcp', 'plugins'].includes(kind)) throw new Error('kind must be all, skills, mcp, or plugins');
  [...repos, ...pluginRepos].forEach(validateRepo);
  const repositoryCount = (['all','skills'].includes(kind) ? repos.length : 0) + (['all','plugins'].includes(kind) ? pluginRepos.length : 0);
  if (repositoryCount > 8) throw new Error('At most eight repositories are supported per pass.');
  const terms = termsFor(query);
  if (!terms.length) throw new Error('Provide at least one specific capability keyword.');
  const local = ['all', 'skills'].includes(kind) ? await scanLocal(roots) : { candidates: [], sources: [] };
  const signal = AbortSignal.timeout(timeoutMs);
  const jobs = [];
  if (!offline) {
    if (['all', 'skills'].includes(kind)) jobs.push(...[...new Set(repos)].map(repo => scanRepo(repo, terms, { fetchImpl, token, signal })));
    if (['all', 'plugins'].includes(kind)) jobs.push(...[...new Set(pluginRepos)].map(repo => scanRepo(repo, terms, { fetchImpl, token, signal, kind: 'plugin' })));
    if (['all', 'mcp'].includes(kind)) jobs.push(scanMcp(terms, { fetchImpl, signal }));
  }
  const remote = await Promise.all(jobs);
  const installedNames = new Set(local.candidates.map(item => item.name));
  const sorted = list => list.map(item => rank(item, terms)).filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const rankedRemote = sorted(remote.flatMap(item => item.candidates));
  const isOverlap = item => item.kind === 'skill' && installedNames.has(item.name);
  const newCandidates = rankedRemote.filter(item => !isOverlap(item));
  const overlaps = rankedRemote.filter(isOverlap).map(item => ({ ...item, overlap: 'same-name-needs-review' }));
  return {
    schemaVersion: 2, checkedAt: new Date().toISOString(), query, terms, offline, kind,
    installed: sorted(local.candidates), candidates: newCandidates.slice(0, limit), possibleInstalledOverlaps: overlaps,
    candidateGroups: Object.fromEntries(['skill','mcp','plugin'].map(type => [type, newCandidates.filter(item => item.kind === type).slice(0,limit)])),
    inventoryCoverage: { skills: ['all','skills'].includes(kind) ? 'local-roots-only' : 'not-scanned', mcp: 'host-check-required', plugins: 'host-check-required' },
    sources: [...local.sources, ...remote.map(item => item.source)],
    searchLinks: offline ? [] : [
      { source: 'skills.sh', url: `https://skills.sh/?q=${encodeURIComponent(query)}`, status: 'not-searched' },
      { source: 'github-search', url: `https://github.com/search?q=${encodeURIComponent(query + ' MCP skills plugins')}&type=repositories`, status: 'not-searched' },
    ],
    note: 'Unreviewed leads across skills, MCP servers, and plugins. Check host tools and connection state; review dependencies before recommending. GitHub filtering uses directory names; MCP queries search names only. No exhaustive coverage is claimed.',
  };
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    query: { type: 'string' }, root: { type: 'string', multiple: true }, repo: { type: 'string', multiple: true },
    kind: { type: 'string', default: 'all' }, 'plugin-repo': { type: 'string', multiple: true },
    offline: { type: 'boolean', default: false }, limit: { type: 'string', default: '3' },
    'timeout-ms': { type: 'string', default: '15000' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    process.stdout.write('Skill Scout — read-only skill discovery, MCP and plugin search (Node.js 22+)\n\n' +
      'node scout.mjs --query "public capability keywords" [--offline]\n' +
      '  --root PATH       Local skill root; repeat; replaces default roots\n' +
      '  --kind TYPE       all (default), skills, mcp, or plugins\n' +
      '  --repo OWNER/REPO Skill GitHub source; repeat; replaces skill repositories\n' +
      '  --plugin-repo OWNER/REPO Plugin GitHub source; repeat; replaces plugin repositories\n' +
      '  --limit N         Maximum new leads, 1–20 (default 3)\n' +
      '  --timeout-ms N    Shared remote deadline, 1–60000 (default 15000)\n' +
      'Output: JSON. MCP Registry receives up to four public keywords. No installation or server connection is performed.\n');
    return;
  }
  const result = await discover({ query: values.query, roots: values.root, repos: values.repo,
    kind: values.kind, pluginRepos: values['plugin-repo'],
    offline: values.offline, limit: Number(values.limit), timeoutMs: Number(values['timeout-ms']) });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(`Skill Scout: ${error.message}\n`); process.exitCode = 1; });
}
