#!/usr/bin/env node
/**
 * Runs the server test suite, discovering files instead of listing them.
 *
 * The server has tests in two dialects: some use the built-in `node:test`
 * runner, others are written against Jest's API (`jest.mock`, `jest.fn`). They
 * need different runners, and the split used to be a hand-maintained list of
 * filenames in package.json. Anything not on that list silently never ran, so
 * those files drifted out of date without anyone noticing.
 *
 * This classifies each file by what it actually imports, runs each group with
 * the runner it needs, and reports loudly when a group cannot be run at all.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Shopify Functions are tested here rather than under vitest because they are
// plain ESM with no DOM. They were written as .test.mjs and so matched nothing
// any runner looked at — the same silent gap this script was written to close.
const TEST_ROOTS = [path.join(ROOT, 'server', 'src'), path.join(ROOT, 'extensions')];
const TEST_SUFFIXES = ['.test.js', '.test.mjs'];

function findTestFiles(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // `generated` and `dist` hold build output, not sources under test.
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      findTestFiles(full, out);
    } else if (entry.isFile() && TEST_SUFFIXES.some(suffix => entry.name.endsWith(suffix))) {
      out.push(full);
    }
  }
  return out;
}

/** `node:test` files declare the runner they need; everything else expects Jest. */
function usesNodeTestRunner(file) {
  const source = fs.readFileSync(file, 'utf8');
  return /require\(\s*['"]node:test['"]\s*\)/.test(source) || /from\s+['"]node:test['"]/.test(source);
}

/** The installed CLI, not the package entry: `jest/bin` is not an export path. */
function jestBinary() {
  const bin = path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'jest.cmd' : 'jest');
  return fs.existsSync(bin) ? bin : null;
}

function run(command, args) {
  execFileSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      // Modules under test read these at import time; the suites never make real
      // Shopify calls, so placeholders keep them importable.
      SHOPIFY_API_KEY: process.env.SHOPIFY_API_KEY || 'test',
      SHOPIFY_API_SECRET: process.env.SHOPIFY_API_SECRET || 'test',
      SHOPIFY_SCOPES: process.env.SHOPIFY_SCOPES || 'read_products',
    },
  });
}

function main() {
  const files = TEST_ROOTS.flatMap(root => findTestFiles(root)).sort();
  if (files.length === 0) {
    console.error('No server test files found — check the paths in this script.');
    process.exit(1);
  }

  const nodeTests = files.filter(usesNodeTestRunner);
  const jestTests = files.filter(file => !usesNodeTestRunner(file));
  const rel = file => path.relative(ROOT, file);

  console.log(
    `Server tests: ${files.length} files (${nodeTests.length} node:test, ${jestTests.length} jest)`
  );

  let failed = false;

  if (nodeTests.length > 0) {
    try {
      run(process.execPath, ['--test', ...nodeTests.map(rel)]);
    } catch (error) {
      // Distinguish a runner that would not start from tests that failed;
      // swallowing this made a broken invocation look like a passing group.
      if (typeof error.status !== 'number') {
        console.error(`node:test runner did not start: ${error.message}`);
      }
      failed = true;
    }
  }

  if (jestTests.length > 0) {
    const jest = jestBinary();
    if (jest) {
      try {
        run(jest, ['--silent', ...jestTests.map(rel)]);
      } catch (error) {
        if (typeof error.status !== 'number') {
          console.error(`jest did not start: ${error.message}`);
        }
        failed = true;
      }
    } else {
      // Loud, not silent: these were unrunnable for so long that real
      // regressions landed in them unnoticed.
      console.warn(
        `\nSKIPPED ${jestTests.length} Jest-style server test files: jest is not installed.\n` +
          'Install it as a devDependency to include them, or port them to node:test.\n' +
          jestTests.map(file => `  - ${rel(file)}`).join('\n')
      );
    }
  }

  process.exit(failed ? 1 : 0);
}

main();
