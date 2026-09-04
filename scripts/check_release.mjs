import {readdirSync, readFileSync, lstatSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generated = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', 'dist', 'build', '.pytest_cache']);
const problems = [];
let count = 0;
function visit(folder) {
  for (const entry of readdirSync(folder, {withFileTypes: true})) {
    if (generated.has(entry.name)) continue;
    const file = path.join(folder, entry.name), relative = path.relative(root, file).replaceAll('\\', '/');
    if (lstatSync(file).isSymbolicLink()) {problems.push(relative + ': symlink'); continue;}
    if (entry.isDirectory()) {
      if (['backend', 'data', 'imports', 'recordings'].includes(entry.name)) problems.push(relative + ': forbidden private/local tree');
      else visit(file);
      continue;
    }
    count++;
    if (/^(\.env|\.dev\.vars)(\..*)?$/.test(entry.name) && !entry.name.endsWith('.example')) problems.push(relative + ': private settings');
    if (/\.(mp4|mov|avi|pt|onnx|dump|sqlite3?|pem|key)$/i.test(entry.name)) problems.push(relative + ': private data/key/model');
    const text = readFileSync(file, 'utf8');
    const checks = [
      ['database credential', /mongodb(?:\+srv)?:\/\/[^\s"'<>:]+:[^\s"'<>@]+@/],
      ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
      ['GitHub credential', /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})/],
    ];
    for (const [label, expression] of checks) if (expression.test(text)) problems.push(relative + ': ' + label);
    if (relative.startsWith('deployment/render/') && /^(?:from|import)\s+backend(?:\.|\s)/m.test(text)) problems.push(relative + ': old backend dependency');
  }
}
visit(root);
if (problems.length) {console.error(problems.join('\n')); process.exitCode = 1;}
else console.log(`Source hygiene passed: ${count} files; no old backend, private data trees or detected credential patterns.`);
