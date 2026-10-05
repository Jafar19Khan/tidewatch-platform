'use strict';

// Dependency-free "lint" step: runs `node --check` on every JavaScript file
// in src/, public/, test/ and scripts/ and fails if any has a syntax error.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const dirs = ['src', 'public', 'test', 'scripts'];
let failed = false;

for (const dir of dirs) {
  for (const file of fs.readdirSync(path.join(root, dir))) {
    if (!file.endsWith('.js')) continue;
    const full = path.join(root, dir, file);
    try {
      execFileSync(process.execPath, ['--check', full], { stdio: 'pipe' });
      console.log(`OK   ${dir}/${file}`);
    } catch (err) {
      failed = true;
      console.error(`FAIL ${dir}/${file}\n${err.stderr}`);
    }
  }
}

process.exit(failed ? 1 : 0);
