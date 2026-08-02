import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const repository = fileURLToPath(new URL('..', import.meta.url));
const tsc = join(repository, 'node_modules', 'typescript', 'bin', 'tsc');

test('the packed package works offline in Node, Deno, and Bun', async (context) => {
  const workspace = await mkdtemp(join(tmpdir(), 'clivoke-consumer-'));
  context.after(() => rm(workspace, { recursive: true, force: true }));

  const archives = [];
  archives.push(await packInstalled(
    join(repository, 'node_modules', '@ismail-elkorchi', 'cli-core'),
    workspace
  ));
  archives.push(await packInstalled(join(repository, 'node_modules', 'argv-flags'), workspace));
  archives.push(await packProject(workspace));
  await writeFile(join(workspace, 'package.json'), `${JSON.stringify({ private: true, type: 'module' })}\n`);
  await run('npm', [
    'install',
    '--offline',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    ...archives.map((archive) => join(workspace, archive))
  ], workspace);
  await writeFile(join(workspace, 'consumer.mjs'), source);
  await writeFile(join(workspace, 'consumer.ts'), typeSource);
  await execFileAsync(process.execPath, [
    tsc,
    '--noEmit',
    '--strict',
    '--target',
    'ES2022',
    '--module',
    'NodeNext',
    '--moduleResolution',
    'NodeNext',
    'consumer.ts'
  ], { cwd: workspace });
  await run('deno', [
    'check',
    '--deny-import',
    '--node-modules-dir=manual',
    'consumer.ts'
  ], workspace);

  for (const runtime of ['node', 'deno', 'bun']) {
    if (!(await available(runtime))) {
      assert.fail(`${runtime} is required for the packed consumer check`);
    }
    const args = runtime === 'deno' ? ['run', '--allow-read', 'consumer.mjs'] : ['consumer.mjs'];
    const { stdout } = await run(runtime, args, workspace);
    assert.deepEqual(JSON.parse(stdout), { region: 'eu', command: 'ship deploy' });
  }
});

async function packInstalled(cwd, destination) {
  const { stdout } = await run('npm', [
    'pack',
    '--ignore-scripts',
    '--json',
    '--pack-destination',
    destination
  ], cwd);
  const archive = JSON.parse(stdout)[0];
  assert.equal(archive.files.some((file) => file.path === 'src/index.ts'), true);
  return archive.filename;
}

async function packProject(destination) {
  const obsoleteOutput = join(repository, 'dist', 'obsolete', 'index.js');
  await mkdir(join(repository, 'dist', 'obsolete'), { recursive: true });
  await writeFile(obsoleteOutput, 'throw new Error("obsolete output was packaged");\n');
  const { stdout } = await run('npm', [
    'pack',
    '--json',
    '--pack-destination',
    destination
  ], repository);
  const archive = JSON.parse(stdout)[0];
  const paths = new Set(archive.files.map((file) => file.path));
  assert.equal(paths.has('dist/index.js'), true);
  assert.equal(paths.has('dist/obsolete/index.js'), false);
  assert.equal(paths.has('src/index.ts'), true);
  return archive.filename;
}

async function available(command) {
  try {
    await run(command, ['--version'], repository);
    return true;
  } catch {
    return false;
  }
}

function run(command, args, cwd) {
  const executable = process.platform === 'win32'
    ? command === 'npm'
      ? 'npm.cmd'
      : `${command}.exe`
    : command;
  return execFileAsync(executable, args, { cwd });
}

const source = `
import { createCli } from 'clivoke';
const cli = createCli({ name: 'ship', commands: [{ name: 'deploy', options: { region: { type: 'string', flags: ['--region'], required: true } } }] });
const result = cli.parse({ argv: ['deploy', '--region', 'eu'] });
if (result.status !== 'ready') throw new Error('parse failed');
console.log(JSON.stringify({ region: result.optionValues.region, command: result.command.key }));
`;

const typeSource = `
import { createCli } from 'clivoke';
const cli = createCli({ name: 'ship', options: { count: { type: 'count', flags: ['-v'] } } });
const result = cli.parse({ argv: [] });
if (result.status === 'ready') { const count: number = result.optionValues.count; void count; }
`;
