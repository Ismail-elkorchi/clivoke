import { readFile } from 'node:fs/promises';

const tag = normalizeTag(process.argv[2] ?? process.env.GITHUB_REF_NAME ?? '');
if (!tag.startsWith('v')) {
  throw new Error(`release-gate: expected v-prefixed tag, received "${tag}"`);
}

const version = tag.slice(1);
const [packageJson, jsrJson, changelog] = await Promise.all([
  readJson('package.json'),
  readJson('jsr.json'),
  readFile('CHANGELOG.md', 'utf8')
]);

assertEqual(packageJson.version, version, 'package.json version');
assertEqual(jsrJson.version, version, 'jsr.json version');

if (!hasVersionHeading(changelog, version)) {
  throw new Error(`release-gate: missing CHANGELOG section for version ${version}`);
}

process.stdout.write(`release-gate: ok tag=${tag} version=${version}\n`);

function normalizeTag(value) {
  return value.startsWith('refs/tags/') ? value.slice('refs/tags/'.length) : value;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`release-gate: ${label} mismatch (expected=${expected}, actual=${actual})`);
  }
}

function hasVersionHeading(changelog, version) {
  return changelog.replace(/\r\n/gu, '\n').split('\n').some((line) => {
    const trimmed = line.trim();
    if (!(trimmed.startsWith('## ') || trimmed.startsWith('### '))) return false;

    const heading = trimmed.replace(/^#{2,3}\s+/u, '');
    return heading === version
      || heading.startsWith(`${version} `)
      || heading.startsWith(`${version}(`)
      || heading.startsWith(`${version}-`);
  });
}
