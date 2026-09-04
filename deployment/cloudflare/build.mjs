// Build from the one shared frontend source; never copy .env or the local backend.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const folder = path.dirname(fileURLToPath(import.meta.url));
const frontend = path.resolve(folder, '../../frontend');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
// --skip-install is for local verification with already installed locked dependencies.
// The hosted build command does not pass it.
if (!process.argv.includes('--skip-install')) execFileSync(npm, ['ci'], {cwd: frontend, stdio: 'inherit', shell: process.platform === 'win32'});
execFileSync(npm, ['run', 'check'], {cwd: frontend, stdio: 'inherit', shell: process.platform === 'win32'});
execFileSync(npm, ['run', 'build'], {cwd: frontend, stdio: 'inherit', shell: process.platform === 'win32',
  env: {...process.env, VITE_DEPLOYMENT_MODE: 'cloud'}});
const output = path.join(folder, 'build');
mkdirSync(output, {recursive: true});
// The CI checkout must have an empty output so stale bundles cannot leak.
if (readdirSync(output).length) throw new Error('Use a fresh build directory; existing files will not be overwritten.');
cpSync(path.join(frontend, 'dist'), output, {recursive: true});
writeFileSync(path.join(output, '_routes.json'), JSON.stringify({version: 1, include: ['/api/*'], exclude: []}));
