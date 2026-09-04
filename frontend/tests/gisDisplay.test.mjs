import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Transpile the actual helper, not a duplicated implementation.
const source = readFileSync(new URL('../src/lib/gisDisplay.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { escapeHtml, gridColor } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));

test('unknown and missing assessments stay grey', () => {
  assert.equal(gridColor('unknown', 'unknown'), '#94a3b8');
  assert.equal(gridColor(null, undefined), '#94a3b8');
});
test('case-insensitive assessments prioritize danger', () => {
  assert.equal(gridColor('healthy', 'HIGH'), '#ef4444');
  assert.equal(gridColor('fair', 'low'), '#f59e0b');
  assert.equal(gridColor('good', 'low'), '#10b981');
});
test('external popup text cannot inject HTML', () => {
  assert.equal(escapeHtml('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  assert.equal(escapeHtml("A&B's"), 'A&amp;B&#39;s');
  assert.equal(escapeHtml(null), '');
});
