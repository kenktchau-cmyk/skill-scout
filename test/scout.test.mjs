import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseSkill, parsePlugin, termsFor, rank, scanLocal, discover as discoverAll, defaultRoots } from '../skills/skill-scout/scripts/scout.mjs';
const discover = options => discoverAll({ kind: 'skills', ...options });

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const script = path.join(root, 'skills/skill-scout/scripts/scout.mjs');
const sha = n => String(n).repeat(40);
const skill = (name, description) => `---\nname: ${name}\ndescription: ${description}\n---\nDo not run this body during discovery.\n`;

async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'skill-scout-test-'));
  t.after(async () => {
    const absolute = path.resolve(dir);
    assert.equal(path.dirname(absolute), path.resolve(tmpdir()));
    assert.ok(path.basename(absolute).startsWith('skill-scout-test-'));
    await rm(absolute, { recursive: true, force: true });
  });
  return dir;
}

async function put(dir, name, description) {
  const folder = path.join(dir, name);
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, 'SKILL.md'), skill(name, description));
  return folder;
}

function fakeGithub(routes, calls = []) {
  return async (url, options) => {
    calls.push({ url, options });
    const route = routes[new URL(url).pathname];
    if (!route) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(route.body ?? route), { status: route.status ?? 200 });
  };
}

test('reads quoted and folded descriptions with BOM and Windows newlines', () => {
  assert.deepEqual(parseSkill('\uFEFF---\r\nname: "pdf-tools"\r\ndescription: >-\r\n  Fill PDF forms\r\n  and inspect fonts.\r\n---\r\n'), {
    name: 'pdf-tools', description: 'Fill PDF forms and inspect fonts.',
  });
  assert.equal(parseSkill(skill('pdf', "'Read users'' PDF files'" )).description, "Read users' PDF files");
  assert.equal(parseSkill(skill('pdf', '"Read PDF files"')).description, 'Read PDF files');
});

test('rejects missing, duplicated, complex or unsafe metadata names', () => {
  for (const input of ['no frontmatter', skill('$(touch-bad)', 'PDF'), skill('pdf', '[one, two]'),
    '---\nname: pdf\nname: other\ndescription: Read PDFs\n---\n']) assert.equal(parseSkill(input), null);
});

test('reads real-world indented plain descriptions without accepting nested mappings', () => {
  const input = '---\nname: react-native\ndescription:\n  React Native and Expo apps. Use\n  when building mobile components.\nlicense: MIT\n---\n';
  assert.equal(parseSkill(input).description, 'React Native and Expo apps. Use when building mobile components.');
  assert.equal(parseSkill('---\nname: pdf\ndescription:\n  nested: value\n---\n'), null);
});

test('ranks capability matches without rewarding generic words or substrings', () => {
  const terms = termsFor('the PDF forms skills');
  assert.deepEqual(terms, ['pdf', 'forms']);
  assert.ok(rank({ name: 'pdf-forms', description: 'editing' }, terms).score > rank({ name: 'docs', description: 'PDF forms' }, terms).score);
  assert.equal(rank({ name: 'artwork', description: 'painting' }, ['art']).score, 0);
});

test('default roots include project, home, and custom CODEX_HOME', () => {
  const roots = defaultRoots('/project', '/home/user', { CODEX_HOME: '/custom/codex' });
  assert.ok(roots.includes(path.join('/project', '.agents', 'skills')));
  assert.ok(roots.includes(path.join('/custom/codex', 'skills')));
});

test('offline scans nested local skills without any network calls or writes', async t => {
  const dir = await fixture(t);
  await put(dir, 'pdf-forms', 'Fill PDF forms');
  await put(path.join(dir, 'namespace'), 'web-tests', 'Browser testing');
  const result = await discover({ query: 'pdf forms', roots: [dir], offline: true,
    fetchImpl: () => { throw new Error('network must not be used'); } });
  assert.deepEqual(result.installed.map(item => item.name), ['pdf-forms']);
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.searchLinks, []);
  assert.equal(result.sources[0].found, 2);
});

test('deduplicates overlapping roots and linked skill folders', async t => {
  const dir = await fixture(t);
  const original = await put(dir, 'pdf', 'Read PDF');
  await symlink(original, path.join(dir, 'pdf-link'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = await scanLocal([dir, original]);
  assert.equal(result.candidates.length, 1);
});

test('reports missing roots and malformed skills instead of claiming complete coverage', async t => {
  const dir = await fixture(t);
  await writeFile(path.join(dir, 'SKILL.md'), 'invalid');
  const result = await scanLocal([dir, path.join(dir, 'absent')]);
  assert.equal(result.sources[0].status, 'partial');
  assert.equal(result.sources[1].status, 'missing');
});

test('bounded scans expose partial coverage', async t => {
  const dir = await fixture(t);
  await put(dir, 'pdf', 'Read PDF');
  const result = await scanLocal([dir], { maxEntries: 1 });
  assert.equal(result.sources[0].status, 'partial');
  assert.ok(result.sources[0].warnings.includes('scan-limit'));
});

test('searches multiple sources, preserves failures, and separates installed overlaps', async t => {
  const dir = await fixture(t);
  await put(dir, 'pdf', 'Read PDF');
  const calls = [];
  const result = await discover({ query: 'pdf forms', roots: [dir], repos: ['one/skills', 'two/skills'], token: 'test-token',
    fetchImpl: fakeGithub({
      '/repos/one/skills/git/trees/HEAD': { tree: [
        { type: 'blob', path: 'skills/pdf/SKILL.md', sha: sha(1) },
        { type: 'blob', path: 'skills/pdf-forms/SKILL.md', sha: sha(2) },
      ] },
      [`/repos/one/skills/git/blobs/${sha(1)}`]: { encoding: 'base64', content: Buffer.from(skill('pdf', 'Read PDF')).toString('base64') },
      [`/repos/one/skills/git/blobs/${sha(2)}`]: { encoding: 'base64', content: Buffer.from(skill('pdf-forms', 'Fill PDF forms')).toString('base64') },
      '/repos/two/skills/git/trees/HEAD': { status: 429, body: {} },
    }, calls),
  });
  assert.deepEqual(result.candidates.map(item => item.name), ['pdf-forms']);
  assert.equal(result.candidates[0].reviewStatus, 'unreviewed');
  assert.equal(result.candidates[0].blobSha, sha(2));
  assert.equal(result.possibleInstalledOverlaps[0].name, 'pdf');
  assert.equal(result.sources.at(-1).status, 'error');
  assert.deepEqual(result.sources.at(-1).warnings, ['github-http-429']);
  assert.ok(result.searchLinks.every(link => link.status === 'not-searched'));
  assert.ok(calls.every(({ url, options }) => new URL(url).origin === 'https://api.github.com'
    && options.redirect === 'error' && options.headers.Authorization === 'Bearer test-token'));
  assert.ok(calls.every(({ url }) => !url.includes('forms')));
  assert.ok(!JSON.stringify(result).includes('test-token'));
});

test('does not treat identical names from different publishers as identical new skills', async () => {
  const routes = {};
  for (const repo of ['one/skills', 'two/skills']) {
    routes[`/repos/${repo}/git/trees/HEAD`] = { tree: [{ type: 'blob', path: 'pdf/SKILL.md', sha: sha(1) }] };
    routes[`/repos/${repo}/git/blobs/${sha(1)}`] = { encoding: 'base64', content: Buffer.from(skill('pdf', 'Read PDF')).toString('base64') };
  }
  const result = await discover({ query: 'pdf', roots: [], repos: ['one/skills', 'two/skills'], fetchImpl: fakeGithub(routes) });
  assert.equal(result.candidates.length, 2);
});

test('marks truncated remote trees and invalid blobs as partial', async () => {
  const result = await discover({ query: 'pdf', roots: [], repos: ['one/skills'], fetchImpl: fakeGithub({
    '/repos/one/skills/git/trees/HEAD': { truncated: true, tree: [{ type: 'blob', path: 'pdf/SKILL.md', sha: sha(1) }] },
    [`/repos/one/skills/git/blobs/${sha(1)}`]: { encoding: 'base64', content: Buffer.from('bad frontmatter').toString('base64') },
  }) });
  assert.equal(result.sources[0].status, 'partial');
  assert.ok(result.sources[0].warnings.includes('truncated-tree'));
  assert.ok(result.sources[0].warnings.includes('unsupported-frontmatter'));
});

test('shared remote deadline aborts requests and returns a usable report', async () => {
  const fetchImpl = async (_url, { signal }) => new Promise((_resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('test guard')), 1000);
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  });
  const result = await discover({ query: 'pdf', roots: [], repos: ['one/skills'], fetchImpl, timeoutMs: 10 });
  assert.deepEqual(result.sources[0].warnings, ['deadline']);
});

test('transport errors never leak arbitrary exception text', async () => {
  const result = await discover({ query: 'pdf', roots: [], repos: ['one/skills'],
    fetchImpl: () => { throw new Error('secret-token-in-error'); } });
  assert.ok(!JSON.stringify(result).includes('secret-token'));
  assert.deepEqual(result.sources[0].warnings, ['request-failed']);
});

test('rejects bad repository targets and unbounded CLI inputs before network access', async () => {
  for (const options of [{ repos: ['https://evil.test/repo'] }, { repos: ['owner/../other'] }, { limit: -1 }, { timeoutMs: 999999 }]) {
    await assert.rejects(discover({ query: 'pdf', roots: [], ...options,
      fetchImpl: () => { assert.fail('network must not be used'); } }));
  }
});

test('CLI provides help and nonzero validation errors', () => {
  const help = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /read-only skill discovery/);
  const invalid = spawnSync(process.execPath, [script, '--query', 'pdf', '--limit', 'NaN'], { encoding: 'utf8' });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /limit must be/);
});

test('all-mode returns skills, MCP and plugins without forwarding GitHub credentials to registry or endpoints', async () => {
  const calls = [];
  const server = { name: 'io.example/github', version: '1.0.0', description: 'GitHub repository tools',
    repository: { url: 'https://github.com/example/mcp' },
    remotes: [{ type: 'streamable-http', url: 'https://example.test/mcp', headers: [{ name: 'API-Key', isRequired: true, value: 'DO-NOT-COPY' }] }],
    packages: [{ registryType: 'npm', identifier: '@example/github', version: '1.0.0', runtimeArguments: ['DO-NOT-RUN'] }] };
  const routes = {
    '/repos/one/skills/git/trees/HEAD': { tree: [{ type: 'blob', path: 'github/SKILL.md', sha: sha(1) }] },
    [`/repos/one/skills/git/blobs/${sha(1)}`]: { encoding: 'base64', content: Buffer.from(skill('github', 'GitHub code review')).toString('base64') },
    '/repos/one/plugins/git/trees/HEAD': { tree: [{ type: 'blob', path: 'plugins/github/.codex-plugin/plugin.json', sha: sha(2) }] },
    [`/repos/one/plugins/git/blobs/${sha(2)}`]: { encoding: 'base64', content: Buffer.from(JSON.stringify({ name: 'github', description: 'GitHub connection', apps: './.app.json' })).toString('base64') },
    '/v0.1/servers': { servers: [{ server, _meta: { 'io.modelcontextprotocol.registry/official': { status: 'active' } } }], metadata: {} },
  };
  const result = await discoverAll({ query: 'github', roots: [], repos: ['one/skills'], pluginRepos: ['one/plugins'], token: 'test-token', fetchImpl: fakeGithub(routes,calls) });
  assert.deepEqual(new Set(result.candidates.map(item => item.kind)), new Set(['skill','mcp','plugin']));
  assert.equal(result.candidateGroups.plugin[0].host, 'codex');
  assert.equal(result.candidateGroups.plugin[0].installed, null);
  assert.equal(result.candidateGroups.mcp[0].connectionState, 'unknown');
  assert.deepEqual(result.candidateGroups.mcp[0].remotes[0].requiredHeaders, ['API-Key']);
  assert.ok(!JSON.stringify(result).includes('DO-NOT-'));
  assert.ok(calls.every(({url}) => ['api.github.com','registry.modelcontextprotocol.io'].includes(new URL(url).hostname)));
  for (const call of calls.filter(({url}) => new URL(url).hostname === 'registry.modelcontextprotocol.io')) {
    assert.equal(call.options.headers.Authorization, undefined);
    assert.equal(call.options.redirect, 'error');
  }
});

test('MCP discovery deduplicates versions, skips inactive entries and exposes pagination limits', async () => {
  const item = (status,name='io.example/github',url='https://github.com/example/mcp') => ({
    server: { name, version: '1', description: 'GitHub tools', repository: { url } },
    _meta: { 'io.modelcontextprotocol.registry/official': { status } },
  });
  const result = await discoverAll({ query: 'github tools', kind:'mcp', fetchImpl: fakeGithub({
    '/v0.1/servers': { servers: [item('active'),item('active'),item('deleted','io.example/deleted'),item('deprecated','io.example/old'),item('active','io.example/github-unsafe','javascript:alert(1)')], metadata:{nextCursor:'next'} },
  }) });
  assert.equal(result.candidateGroups.mcp.length, 2);
  assert.equal(result.candidateGroups.mcp.find(item => item.name.endsWith('unsafe')).repositoryUrl, null);
  assert.equal(result.sources[0].status,'partial');
  assert.ok(result.sources[0].warnings.includes('more-registry-pages'));
});

test('MCP-only and plugin-only offline discovery issue no requests and mark inventory as unchecked', async () => {
  for (const kind of ['mcp','plugins','all']) {
    const result = await discoverAll({ query:'github',kind,offline:true,roots:[],fetchImpl:() => assert.fail('no network') });
    assert.deepEqual(result.candidates,[]);
    assert.equal(result.inventoryCoverage.plugins,'host-check-required');
  }
});

test('MCP failures remain visible when other discovery sources succeed', async () => {
  const result = await discoverAll({ query:'github',roots:[],repos:[],pluginRepos:[],fetchImpl:fakeGithub({
    '/v0.1/servers':{status:429,body:{secret:'never-echo'}},
  }) });
  assert.equal(result.sources[0].status,'error');
  assert.deepEqual(result.sources[0].warnings,['registry-http-429']);
  assert.ok(!JSON.stringify(result).includes('never-echo'));
});

test('plugin manifest parsing and kind validation reject invalid input', async () => {
  assert.equal(parsePlugin('{invalid'),null);
  assert.equal(parsePlugin(JSON.stringify({name:'$(bad)',description:'test'})),null);
  assert.deepEqual(parsePlugin(JSON.stringify({name:'github',description:'GitHub tools',mcpServers:'./.mcp.json'})).components,['mcpServers']);
  await assert.rejects(discoverAll({query:'github',kind:'anything',fetchImpl:() => assert.fail('no network')}),/kind must be/);
});
