#!/usr/bin/env node
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = await mkdtemp(join(tmpdir(), 'pax-conquest-'));
const outfile = join(dir, 'conquest-test.mjs');
try {
  await build({
    entryPoints: [join(import.meta.dirname, 'conquest-test.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
  });
  await import(pathToFileURL(outfile).href);
} finally {
  await rm(dir, { recursive: true, force: true });
}
