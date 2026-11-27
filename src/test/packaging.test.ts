import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { UserConfig } from 'vite';

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
  it('does not emit source maps into the published dist folder', async () => {
    // The evaluated configuration, not its source text: a commented-out or
    // overridden option would not be caught by a text search
    const { default: config } = (await import('../../vite.config')) as {
      default: UserConfig;
    };

    expect(config.build?.sourcemap).toBe(false);
  }, 30000);

  it('builds the two published bundles from the package entry', async () => {
    const { default: config } = (await import('../../vite.config')) as {
      default: UserConfig;
    };
    const lib = config.build?.lib;

    expect(lib).toBeTruthy();
    if (!lib) return;
    expect(lib.formats).toEqual(['es', 'umd']);
    // The file names package.json points to
    const fileName = lib.fileName as (format: string) => string;
    const exportsRoot = pkg.exports['.'] as Record<string, string>;
    expect(`./dist/${fileName('es')}`).toBe(exportsRoot.import);
    expect(`./dist/${fileName('umd')}`).toBe(exportsRoot.require);
  }, 30000);
});
