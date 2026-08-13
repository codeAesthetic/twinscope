import { describe, expect, it } from 'vitest';
import { bumpBetween, bumpLabel, parseVersion, stripRange } from './semver';
import { isDependencyFile, readDepSource, sourceKindFor } from './manifest';
import { DEFAULT_DEPS_OPTIONS, diffDeps } from './depsDiff';
import { depsEngine } from './index';
import { detectKind } from '../detect';
import { EngineInputError, type EngineCtx, type InputRef } from '../types';

const options = (patch: Partial<typeof DEFAULT_DEPS_OPTIONS> = {}) => ({
  ...DEFAULT_DEPS_OPTIONS,
  ...patch,
});

describe('semver', () => {
  it('strips the range operator', () => {
    expect(stripRange('^1.2.3')).toBe('1.2.3');
    expect(stripRange('~1.2.3')).toBe('1.2.3');
    expect(stripRange('>=1.2.3')).toBe('1.2.3');
    expect(stripRange(' v1.2.3 ')).toBe('1.2.3');
  });

  it('parses partial versions', () => {
    expect(parseVersion('1')).toEqual({ major: 1, minor: 0, patch: 0, prerelease: '' });
    expect(parseVersion('^2.3')).toEqual({ major: 2, minor: 3, patch: 0, prerelease: '' });
    expect(parseVersion('1.2.3-beta.1')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: 'beta.1',
    });
    expect(parseVersion('workspace:*')).toBeNull();
  });

  it('names the size of the change', () => {
    expect(bumpBetween('1.2.3', '2.0.0').kind).toBe('major');
    expect(bumpBetween('1.2.3', '1.3.0').kind).toBe('minor');
    expect(bumpBetween('1.2.3', '1.2.4').kind).toBe('patch');
    expect(bumpBetween('1.2.3-beta.1', '1.2.3-beta.2').kind).toBe('prerelease');
  });

  it('calls a pin a range change rather than no change', () => {
    // `^1.2.3` → `1.2.3` is a deliberate act, and reporting "no change" hides it.
    expect(bumpBetween('^1.2.3', '1.2.3')).toEqual({ kind: 'range', downgrade: false });
  });

  it('distinguishes a DOWNGRADE from an upgrade of the same size', () => {
    // The question `semver.diff` alone does not answer, and the reason for our own.
    expect(bumpBetween('3.0.0', '2.9.0')).toEqual({ kind: 'major', downgrade: true });
    expect(bumpBetween('2.9.0', '3.0.0')).toEqual({ kind: 'major', downgrade: false });
    expect(bumpLabel(bumpBetween('3.0.0', '2.9.0'))).toBe('major ↓');
  });

  it('ranks a release above its own prerelease', () => {
    expect(bumpBetween('1.0.0', '1.0.0-rc.1').downgrade).toBe(true);
    expect(bumpBetween('1.0.0-rc.1', '1.0.0').downgrade).toBe(false);
  });

  it('says "unknown" for a version it cannot read, rather than guessing', () => {
    expect(bumpBetween('workspace:*', 'file:../local')).toEqual({
      kind: 'unknown',
      downgrade: false,
    });
    expect(bumpLabel({ kind: 'unknown', downgrade: false })).toBe('changed');
  });
});

describe('source recognition', () => {
  it('recognises all four by filename, not extension', () => {
    // All of them are .json or .yaml, which is why detection cannot use extensions.
    expect(sourceKindFor('package.json')).toBe('manifest');
    expect(sourceKindFor('/a/b/package-lock.json')).toBe('npm-lock');
    expect(sourceKindFor('pnpm-lock.yaml')).toBe('pnpm-lock');
    expect(sourceKindFor('yarn.lock')).toBe('yarn-lock');
    expect(sourceKindFor('tsconfig.json')).toBe('unknown');
    expect(isDependencyFile('package.json')).toBe(true);
    expect(isDependencyFile('data.json')).toBe(false);
  });

  it('routes a manifest to the deps kind ahead of json', () => {
    expect(detectKind({ name: 'package.json', kind: 'unknown' })).toBe('deps');
    expect(detectKind({ name: 'yarn.lock', kind: 'unknown' })).toBe('deps');
    // An ordinary .json is untouched.
    expect(detectKind({ name: 'data.json', kind: 'unknown' })).toBe('json');
  });
});

describe('readDepSource — manifest', () => {
  const manifest = JSON.stringify({
    name: 'example',
    dependencies: { react: '^19.0.0', lodash: '4.17.20' },
    devDependencies: { vitest: '^4.0.0' },
    peerDependencies: { typescript: '>=5' },
    optionalDependencies: { fsevents: '^2.3.0' },
  });

  it('reads all four dependency fields with their kinds', () => {
    const source = readDepSource('package.json', manifest);
    expect(source.kind).toBe('manifest');
    expect(source.project).toBe('example');
    expect(source.direct.map((dep) => [dep.name, dep.kind])).toEqual(
      expect.arrayContaining([
        ['react', 'prod'],
        ['vitest', 'dev'],
        ['typescript', 'peer'],
        ['fsevents', 'optional'],
      ]),
    );
    // A manifest resolves nothing — that is the whole difference from a lockfile.
    expect(source.resolved.size).toBe(0);
  });

  it('throws a readable error for broken JSON', () => {
    expect(() => readDepSource('package.json', '{ nope')).toThrow(/not valid JSON/);
  });

  it('tolerates a manifest with no dependencies at all', () => {
    expect(readDepSource('package.json', '{"name":"bare"}').direct).toEqual([]);
  });
});

describe('readDepSource — npm lockfile', () => {
  const lock = JSON.stringify({
    name: 'example',
    lockfileVersion: 3,
    packages: {
      '': {
        name: 'example',
        dependencies: { react: '^19.0.0' },
        devDependencies: { vitest: '^4.0.0' },
      },
      'node_modules/react': { version: '19.2.8', license: 'MIT' },
      'node_modules/vitest': { version: '4.1.10', license: 'MIT' },
      'node_modules/scheduler': { version: '0.30.0', license: 'MIT' },
      'node_modules/react/node_modules/nested': { version: '1.0.0', license: 'ISC' },
    },
  });

  it('takes direct dependencies from the root entry and resolves their versions', () => {
    const source = readDepSource('package-lock.json', lock);
    expect(source.kind).toBe('npm-lock');
    const react = source.direct.find((dep) => dep.name === 'react');
    // The resolved version, not the range: it is what is actually installed.
    expect(react).toMatchObject({ version: '19.2.8', kind: 'prod', license: 'MIT' });
    expect(source.direct.find((dep) => dep.name === 'vitest')?.kind).toBe('dev');
  });

  it('reads a nested path as the package it names', () => {
    const source = readDepSource('package-lock.json', lock);
    expect(source.resolved.get('nested')).toEqual({ version: '1.0.0', license: 'ISC' });
    expect(source.resolved.size).toBe(4);
  });
});

describe('readDepSource — pnpm lockfile', () => {
  it('reads both key shapes and the importers block', () => {
    const lock = [
      'lockfileVersion: 9.0',
      'importers:',
      '  .:',
      '    dependencies:',
      '      react:',
      '        specifier: ^19.0.0',
      '        version: 19.2.8',
      '    devDependencies:',
      '      vitest:',
      '        specifier: ^4.0.0',
      '        version: 4.1.10',
      'packages:',
      '  /react@19.2.8: {}',
      '  /@scope/thing@2.0.0: {}',
      '  /old-style/1.0.0: {}',
      '',
    ].join('\n');

    const source = readDepSource('pnpm-lock.yaml', lock);
    expect(source.kind).toBe('pnpm-lock');
    expect(source.direct.map((dep) => [dep.name, dep.version, dep.kind])).toEqual([
      ['react', '19.2.8', 'prod'],
      ['vitest', '4.1.10', 'dev'],
    ]);
    // The version is after the LAST `@`, so a scope is not mistaken for one.
    expect(source.resolved.get('@scope/thing')).toEqual({ version: '2.0.0' });
    expect(source.resolved.get('old-style')).toEqual({ version: '1.0.0' });
    // pnpm records no licences.
    expect(source.direct.every((dep) => dep.license === undefined)).toBe(true);
  });
});

describe('readDepSource — yarn.lock', () => {
  it('reads the classic format, including multi-specifier entries', () => {
    const lock = [
      '# yarn lockfile v1',
      '',
      '"@scope/thing@^2.0.0":',
      '  version "2.0.1"',
      '  resolved "https://registry.example/thing"',
      '',
      'lodash@^4.17.20, lodash@^4.17.21:',
      '  version "4.17.21"',
      '',
    ].join('\n');

    const source = readDepSource('yarn.lock', lock);
    expect(source.resolved.get('@scope/thing')).toEqual({ version: '2.0.1' });
    // Both specifiers name the same package, and it appears once.
    expect(source.resolved.get('lodash')).toEqual({ version: '4.17.21' });
    expect(source.resolved.size).toBe(2);
  });
});

describe('diffDeps — manifests', () => {
  const before = JSON.stringify({
    name: 'example',
    dependencies: { react: '^19.0.0', lodash: '^4.17.20', gone: '^1.0.0' },
    devDependencies: { vitest: '^4.0.0' },
  });
  const after = JSON.stringify({
    name: 'example',
    dependencies: { react: '^19.0.0', lodash: '^4.18.0', added: '^2.0.0' },
    devDependencies: { vitest: '^4.0.1' },
  });

  it('reports additions, removals and bumps with their size', () => {
    const { data, stats } = diffDeps('package.json', before, 'package.json', after, options());
    expect(stats).toMatchObject({ added: 1, removed: 1, modified: 2, same: 1 });

    const byName = new Map(data.rows.map((row) => [row.name, row]));
    expect(byName.get('lodash')).toMatchObject({ status: 'mod', bump: 'minor' });
    expect(byName.get('vitest')).toMatchObject({ status: 'mod', bump: 'patch', kind: 'dev' });
    expect(byName.get('added')?.status).toBe('add');
    expect(byName.get('gone')?.status).toBe('del');
    expect(byName.get('react')?.status).toBe('same');
  });

  it('says a manifest pair cannot show resolved versions or licences — Rule 3', () => {
    const { data, notes } = diffDeps('package.json', before, 'package.json', after, options());
    expect(data.resolved).toBe(false);
    expect(notes.join(' ')).toContain('Compare the two lockfiles');
  });

  it('can leave development dependencies out', () => {
    const { data } = diffDeps(
      'package.json',
      before,
      'package.json',
      after,
      options({ includeDev: false }),
    );
    expect(data.rows.some((row) => row.name === 'vitest')).toBe(false);
  });

  it('flags a downgrade', () => {
    const { stats, notes } = diffDeps(
      'package.json',
      JSON.stringify({ dependencies: { thing: '3.0.0' } }),
      'package.json',
      JSON.stringify({ dependencies: { thing: '2.9.0' } }),
      options(),
    );
    expect(stats.downgrades).toBe(1);
    expect(notes.join(' ')).toContain('moved to a LOWER version');
  });
});

describe('diffDeps — lockfiles', () => {
  const lock = (packages: Record<string, { version: string; license?: string }>): string =>
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { dependencies: { react: '^19.0.0' } },
        ...Object.fromEntries(
          Object.entries(packages).map(([name, entry]) => [`node_modules/${name}`, entry]),
        ),
      },
    });

  it('counts transitive packages and lists them separately', () => {
    const { data, stats } = diffDeps(
      'package-lock.json',
      lock({ react: { version: '19.2.0' }, scheduler: { version: '0.30.0' } }),
      'package-lock.json',
      lock({
        react: { version: '19.2.8' },
        scheduler: { version: '0.31.0' },
        brandnew: { version: '1.0.0' },
      }),
      options(),
    );

    expect(data.resolved).toBe(true);
    expect(data.transitive).toEqual({ before: 2, after: 3 });

    const byName = new Map(data.rows.map((row) => [row.name, row]));
    // A direct dependency carries no `transitive` key at all, rather than `false`.
    expect(byName.get('react')?.transitive).toBeUndefined();
    expect(byName.get('react')?.status).toBe('mod');
    expect(byName.get('scheduler')).toMatchObject({ transitive: true, status: 'mod' });
    expect(byName.get('brandnew')).toMatchObject({ transitive: true, status: 'add' });
    expect(stats.modified).toBe(2);
  });

  it('reports a licence change, which only an npm lockfile can tell it', () => {
    const { stats, data } = diffDeps(
      'package-lock.json',
      lock({ react: { version: '19.2.0', license: 'MIT' } }),
      'package-lock.json',
      lock({ react: { version: '19.2.0', license: 'AGPL-3.0' } }),
      options(),
    );
    expect(stats.licenseChanges).toBe(1);
    expect(data.rows[0]).toMatchObject({ licenseBefore: 'MIT', licenseAfter: 'AGPL-3.0' });
  });

  it('excludes transitive rows on request but still counts them', () => {
    const { data } = diffDeps(
      'package-lock.json',
      lock({ react: { version: '19.2.0' }, scheduler: { version: '0.30.0' } }),
      'package-lock.json',
      lock({ react: { version: '19.2.0' }, scheduler: { version: '0.31.0' } }),
      options({ includeTransitive: false }),
    );
    expect(data.rows.some((row) => row.transitive === true)).toBe(false);
    expect(data.transitive).toEqual({ before: 2, after: 2 });
  });

  it('warns when the two sides are different kinds of file', () => {
    const { notes } = diffDeps(
      'package.json',
      JSON.stringify({ dependencies: { react: '^19.0.0' } }),
      'package-lock.json',
      lock({ react: { version: '19.2.8' } }),
      options(),
    );
    expect(notes.join(' ')).toContain('different kinds of file');
  });

  it('says pnpm records no licences', () => {
    const { notes } = diffDeps(
      'pnpm-lock.yaml',
      'packages:\n  /react@19.2.0: {}\n',
      'pnpm-lock.yaml',
      'packages:\n  /react@19.2.8: {}\n',
      options(),
    );
    expect(notes.join(' ')).toContain('do not record licences');
  });
});

describe('the deps engine', () => {
  const ctx = (): EngineCtx => ({
    signal: new AbortController().signal,
    progress: () => undefined,
  });

  const ref = (side: 'A' | 'B', name: string, text: string): InputRef => ({
    side,
    kind: 'deps',
    name,
    size: text.length,
    text,
  });

  it('claims two dependency files and nothing else', () => {
    const deps = ref('A', 'package.json', '{}');
    expect(depsEngine.canHandle(deps, ref('B', 'package.json', '{}'))).toBe(true);
    expect(depsEngine.canHandle(deps, { ...deps, side: 'B', kind: 'json' })).toBe(false);
  });

  it('summarises the comparison, with the risky counts as extras', async () => {
    const result = await depsEngine.compare(
      ref('A', 'package.json', JSON.stringify({ dependencies: { a: '1.0.0', b: '2.0.0' } })),
      ref('B', 'package.json', JSON.stringify({ dependencies: { a: '2.0.0', c: '1.0.0' } })),
      depsEngine.defaultOptions(),
      ctx(),
    );
    expect(result.engineId).toBe('deps');
    expect(result.summary).toMatchObject({ added: 1, removed: 1, modified: 1 });
    expect(result.summary.extra?.major).toBe(1);
  });

  it('offers the JSON engine when the files are not dependency files', async () => {
    await expect(
      depsEngine.compare(
        ref('A', 'data.json', '{}'),
        ref('B', 'data.json', '{}'),
        depsEngine.defaultOptions(),
        ctx(),
      ),
    ).rejects.toThrow(EngineInputError);
  });

  it('offers the text engine when a dependency file will not parse', async () => {
    try {
      await depsEngine.compare(
        ref('A', 'package.json', '{ broken'),
        ref('B', 'package.json', '{}'),
        depsEngine.defaultOptions(),
        ctx(),
      );
      expect.unreachable('should have thrown');
    } catch (cause) {
      expect((cause as EngineInputError).fallback?.fallbackEngineId).toBe('text');
    }
  });
});
