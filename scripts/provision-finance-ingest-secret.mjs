#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const envPath = path.resolve(
  process.env.SURMYI_ENV_FILE || '.env.finance-ingest',
);
let source = '';
try {
  source = await fs.readFile(envPath, 'utf8');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const key = 'SURMYI_FINANCE_INGEST_TOKEN';
const existing = source.match(
  new RegExp(`^\\s*${key}\\s*=\\s*(.*?)\\s*$`, 'm'),
);
let token = existing?.[1]?.replace(/^(['"])(.*)\1$/, '$2') || '';
if (!token) {
  token = randomBytes(32).toString('base64url');
  const separator = source && !source.endsWith('\n') ? '\n' : '';
  source = `${source}${separator}${key}=${token}\n`;
  await fs.writeFile(envPath, source, { encoding: 'utf8', mode: 0o600 });
}
await fs.chmod(envPath, 0o600);

const sha256 = createHash('sha256').update(token).digest('hex');
console.log(
  JSON.stringify({
    configured: true,
    envFile: envPath,
    sha256,
  }),
);
