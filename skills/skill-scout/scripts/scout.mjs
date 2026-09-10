#!/usr/bin/env node
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const DEFAULT_REPOS = ['openai/skills', 'anthropics/skills', 'vercel-labs/agent-skills'];
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
            candidates.push({ ...skill, source: 'local', path: location, installed: true });
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
  const source = { source: 'github', repo, status: 'ok', found: 0, inspected: 0, warnings: [] };
  const candidates = [];
  try {
    const tree = await apiJson(`/repos/${repo}/git/trees/HEAD?recursive=1`, options);
    if (!Array.isArray(tree.tree)) throw new Error('invalid-tree-response');
    if (tree.truncated) { source.status = 'partial'; source.warnings.push('truncated-tree'); }
    const paths = tree.tree.filter(item => item.type === 'blob' && /(^|\/)SKILL\.md$/.test(item.path))
      .filter(item => item.mode !== '120000')
      .map(item => ({ ...item, pathScore: rank({ name: path.posix.basename(path.posix.dirname(item.path)), description: '' }, terms).score }))
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
        const skill = parseSkill(bytes.toString('utf8'));
        source.inspected++;
        if (!skill) throw new Error('unsupported-frontmatter');
        candidates.push({ ...skill, source: 'github', repo, skillPath: item.path, blobSha: item.sha,
          sourceUrl: `https://github.com/${repo}/blob/HEAD/${item.path.split('/').map(encodeURIComponent).join('/')}`,
          reviewStatus: 'unreviewed', installed: false });
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
  return /^(github-http-\d{3}|github-response-too-large|invalid-tree-response|invalid-blob-response|invalid-blob-sha|oversize-skill|unsupported-frontmatter)$/.test(error.message)
    ? error.message : 'request-failed';
}

export async function discover({ query, roots = defaultRoots(), repos = DEFAULT_REPOS,
  offline = false, limit = 3, timeoutMs = 15000, fetchImpl = fetch, token = process.env.GITHUB_TOKEN } = {}) {
  if (typeof query !== 'string' || !query.trim() || query.length > 500) throw new Error('Provide 1–500 characters of capability keywords.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('limit must be an integer from 1 to 20');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new Error('timeout-ms must be an integer from 1 to 60000');
  repos.forEach(validateRepo);
  if (repos.length > 8) throw new Error('At most eight repositories are supported per pass.');
  const terms = termsFor(query);
  if (!terms.length) throw new Error('Provide at least one specific capability keyword.');
  const local = await scanLocal(roots);
  const signal = AbortSignal.timeout(timeoutMs);
  const remote = offline ? [] : await Promise.all([...new Set(repos)].map(repo => scanRepo(repo, terms, { fetchImpl, token, signal })));
  const installedNames = new Set(local.candidates.map(item => item.name));
  const sorted = list => list.map(item => rank(item, terms)).filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const rankedRemote = sorted(remote.flatMap(item => item.candidates));
  const newCandidates = rankedRemote.filter(item => !installedNames.has(item.name));
  const overlaps = rankedRemote.filter(item => installedNames.has(item.name)).map(item => ({ ...item, overlap: 'same-name-needs-review' }));
  return {
    schemaVersion: 1, checkedAt: new Date().toISOString(), query, terms, offline,
    installed: sorted(local.candidates), candidates: newCandidates.slice(0, limit), possibleInstalledOverlaps: overlaps,
    sources: [...local.sources, ...remote.map(item => item.source)],
    searchLinks: offline ? [] : [
      { source: 'skills.sh', url: `https://skills.sh/?q=${encodeURIComponent(query)}`, status: 'not-searched' },
      { source: 'github-search', url: `https://github.com/search?q=${encodeURIComponent(`path:SKILL.md ${query}`)}&type=code`, status: 'not-searched' },
    ],
    note: 'Keyword-ranked, unreviewed leads. Review actual skills and dependencies before recommending installation. Remote search matches directory names first; no exhaustive coverage is claimed.',
  };
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    query: { type: 'string' }, root: { type: 'string', multiple: true }, repo: { type: 'string', multiple: true },
    offline: { type: 'boolean', default: false }, limit: { type: 'string', default: '3' },
    'timeout-ms': { type: 'string', default: '15000' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    process.stdout.write('Skill Scout — read-only skill discovery (Node.js 22+)\n\n' +
      'node scout.mjs --query "public capability keywords" [--offline]\n' +
      '  --root PATH       Local skill root; repeat; replaces default roots\n' +
      '  --repo OWNER/REPO GitHub source; repeat; replaces default repositories\n' +
      '  --limit N         Maximum new leads, 1–20 (default 3)\n' +
      '  --timeout-ms N    Shared remote deadline, 1–60000 (default 15000)\n' +
      'Output: JSON. Search links are not visited. No installation is performed.\n');
    return;
  }
  const result = await discover({ query: values.query, roots: values.root, repos: values.repo,
    offline: values.offline, limit: Number(values.limit), timeoutMs: Number(values['timeout-ms']) });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(`Skill Scout: ${error.message}\n`); process.exitCode = 1; });
}
