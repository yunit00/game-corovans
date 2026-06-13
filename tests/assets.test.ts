import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(ROOT, 'public', 'assets', 'asset-manifest.json');

describe('ассеты', () => {
  it('asset-manifest.json существует (иначе: npm run assets:fetch && npm run assets:prepare)', () => {
    expect(fs.existsSync(manifestPath)).toBe(true);
  });

  it('все обязательные ассеты на диске', () => {
    const { entries } = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      entries: { key: string; path: string; required: boolean }[];
    };
    const missing = entries
      .filter((e) => e.required && !fs.existsSync(path.join(ROOT, 'public', e.path)))
      .map((e) => e.key);
    expect(missing).toEqual([]);
  });
});
