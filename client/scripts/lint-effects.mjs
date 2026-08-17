#!/usr/bin/env node
/**
 * lint-effects.mjs — zero-dependency guard against a class of React bugs that
 * have bitten this project before.
 *
 * It scans client/src for dangerous patterns and exits non-zero if any are
 * found, so they can never sneak back in (run in `npm run lint` / pre-build).
 *
 * Rules enforced:
 *  1. NO `useEffect(<bareIdentifier>, deps)` — passing a function *reference*
 *     (e.g. `useEffect(load, [])`). If that function returns a Promise (very
 *     common with `() => api.get(...).then(...)`), React treats the returned
 *     Promise as the effect CLEANUP and calls it on unmount → the infamous
 *     "TypeError: n is not a function" crash.
 *     ✅ Correct:  useEffect(() => { load(); }, [])
 *
 *  2. NO `useEffect(async () => ...)` — an async effect callback returns a
 *     Promise, same cleanup problem, and you can't return a real cleanup.
 *     ✅ Correct:  useEffect(() => { (async () => { ... })(); }, [])
 *
 * To intentionally allow a line, append a comment: // lint-effects-ok
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src');

/** Recursively collect .js/.jsx files under src/. */
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (/\.(jsx?|tsx?)$/.test(name)) out.push(p);
  }
  return out;
}

// Pattern 1: useEffect(identifier, ...)  — a bare function reference.
const BARE_REF = /\buseEffect\s*\(\s*[A-Za-z_$][\w$]*\s*(?:,|\))/;
// Pattern 2: async effect callback.
const ASYNC_CB = /\buseEffect\s*\(\s*async\b/;
// Same checks for useLayoutEffect / useMemo-style cleanups are uncommon here,
// but we also cover useLayoutEffect for completeness.
const BARE_REF_LE = /\buseLayoutEffect\s*\(\s*[A-Za-z_$][\w$]*\s*(?:,|\))/;
const ASYNC_CB_LE = /\buseLayoutEffect\s*\(\s*async\b/;

const violations = [];

for (const file of walk(ROOT)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (line.includes('lint-effects-ok')) return; // explicit opt-out
    const checks = [
      [BARE_REF, 'useEffect(<function reference>) — may return a Promise used as cleanup. Use useEffect(() => { fn(); }, deps).'],
      [ASYNC_CB, 'useEffect(async () => ...) — async effects return a Promise. Use useEffect(() => { (async () => {})(); }, deps).'],
      [BARE_REF_LE, 'useLayoutEffect(<function reference>) — use useLayoutEffect(() => { fn(); }, deps).'],
      [ASYNC_CB_LE, 'useLayoutEffect(async () => ...) — wrap the async work instead.'],
    ];
    for (const [re, msg] of checks) {
      if (re.test(line)) {
        violations.push({ file: relative(join(ROOT, '..'), file), line: i + 1, text: line.trim(), msg });
      }
    }
  });
}

if (violations.length) {
  console.error('\n✗ lint-effects found ' + violations.length + ' issue(s):\n');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`     ${v.text}`);
    console.error(`     → ${v.msg}\n`);
  }
  console.error('Fix the above (or append "// lint-effects-ok" if truly intentional).\n');
  process.exit(1);
}

console.log('✓ lint-effects: no risky useEffect patterns found.');
