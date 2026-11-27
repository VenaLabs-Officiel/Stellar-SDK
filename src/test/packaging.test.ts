import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');

interface PackageJson {
  exports: Record<string, Record<string, string> | string>;
  files: string[];
}

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8')) as PackageJson;

describe('package.json', () => {
  it('lists the "types" condition first in the root export', () => {
    // Conditions are matched in order: TypeScript only finds the declarations
    // when "types" comes before "import" and "require"
    const conditions = Object.keys(pkg.exports['.'] as Record<string, string>);

    expect(conditions[0]).toBe('types');
    expect(conditions).toEqual(['types', 'import', 'require']);
  });

  it('publishes the dist folder only', () => {
    expect(pkg.files).toEqual(['dist']);
  });
});

describe('vite.config.ts', () => {
  it('does not emit source maps into the published dist folder', () => {
    const config = readFileSync(resolve(root, 'vite.config.ts'), 'utf-8');

    expect(config).toMatch(/sourcemap:\s*false/);
    expect(config).not.toMatch(/sourcemap:\s*true/);
  });
});
