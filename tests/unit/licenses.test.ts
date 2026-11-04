import { readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Licence choke point (ARCHITECTURE.md): every shipped asset has a manifest row with an allowed licence.
const ALLOWED = new Set(['CC0-1.0', 'CC-BY-4.0']);
const ASSET_DIRS = ['public/art'];
const manifest = JSON.parse(readFileSync('assets/LICENSES.json', 'utf8')) as {
  files: Record<string, { license: string; source: string; author: string }>;
};

function walk(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    const p = `${dir}/${name}`;
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const missing = (files: string[], rows: Record<string, unknown>) => files.filter((f) => !rows[f]);

describe('asset licences', () => {
  const shipped = ASSET_DIRS.flatMap(walk);

  it('every shipped asset file is in assets/LICENSES.json', () => {
    expect(shipped.length).toBeGreaterThan(0);
    expect(missing(shipped, manifest.files)).toEqual([]);
  });

  it('every manifest row has an allowed licence, a source and an author', () => {
    for (const [file, row] of Object.entries(manifest.files)) {
      expect(ALLOWED.has(row.license), `${file}: ${row.license}`).toBe(true);
      expect(row.source, file).toMatch(/^https:\/\//);
      expect(row.author, file).toBeTruthy();
    }
  });

  it('the guard flags an unlisted file and passes a listed one (two-sided)', () => {
    expect(missing(['public/models/x.glb'], {})).toEqual(['public/models/x.glb']);
    expect(missing(['public/models/x.glb'], { 'public/models/x.glb': {} })).toEqual([]);
  });
});
