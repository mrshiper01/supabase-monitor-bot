#!/usr/bin/env node
/**
 * Patches sync function index.ts with notifyError.
 * Usage: node patch-and-deploy-sync.mjs <slug> <path_to_index_or_stdin>
 */
const slug = process.argv[2];
const fs = require('fs');
let original;
if (process.argv[3]) {
  original = fs.readFileSync(process.argv[3], 'utf8');
} else {
  original = fs.readFileSync(0, 'utf8');
}
if (!slug || !original) {
  console.error('Usage: node patch-and-deploy-sync.mjs <slug> [file]');
  process.exit(1);
}

const IMPORT = 'import { notifyError } from "./_shared/error_monitor.ts";';
let out = original;
if (!out.includes('notifyError')) {
  const firstImportEnd = out.indexOf('\n', out.indexOf('import ')) + 1;
  out = out.slice(0, firstImportEnd) + IMPORT + '\n\n' + out.slice(firstImportEnd);
}
out = out.replace(
  /} catch \(err\) \{\s*/,
  `} catch (err) {\n    const normalizedError = err instanceof Error ? err : new Error(String(err));\n    await notifyError('${slug}', normalizedError);\n    `
);
out = out.replace(/\berror: err\.message\b/g, 'error: normalizedError.message');
out = out.replace(/\berror: err\?\.message \?\? err\b/g, 'error: normalizedError.message');
out = out.replace(/,\s*err\)/g, ', normalizedError)');
out = out.replace(/:\s*err\)/g, ': normalizedError)');

process.stdout.write(out);
