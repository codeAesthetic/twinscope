import { describe, expect, it, vi } from 'vitest';
import { configKindOf, createEnvEngine, diffConfig, type EnvDiffData } from './index';
import { parseEnv, flattenK8s, flattenPlan } from './parse';
import { fingerprint, maskValue, secretReason } from './secrets';
import { detectKind } from '../detect';
import { parseYaml } from '../yaml';
import type { EngineCtx, InputRef } from '../types';

const engine = createEnvEngine((text) => {
  const parsed = parseYaml(text, 'file');
  return parsed.documents > 1 ? (parsed.value as unknown[]) : [parsed.value];
});

function ctx(): EngineCtx {
  return { signal: new AbortController().signal, progress: vi.fn() };
}

function ref(side: 'A' | 'B', name: string, text: string): InputRef {
  return { side, kind: 'env', name, text, size: text.length };
}

async function run(name: string, before: string, after: string, options = {}) {
  const result = await engine.compare(
    ref('A', name, before),
    ref('B', name, after),
    { ...engine.defaultOptions(), ...options },
    ctx(),
  );
  return { result, data: result.data as EnvDiffData };
}

describe('secret detection', () => {
  it('catches a secret by its key', () => {
    expect(secretReason('AWS_SECRET_ACCESS_KEY', 'anything')).toBe('key');
    expect(secretReason('API_TOKEN', 'x')).toBe('key');
    expect(secretReason('PORT', '3000')).toBe('none');
  });

  it('catches a password inside a URL, which no key rule would', () => {
    // The whole reason there are two rules: this key says nothing.
    expect(secretReason('DATABASE_URL', 'postgres://app:s3cret@db.internal:5432/app')).toBe(
      'url-password',
    );
    // …and a URL with no password in it is not a secret.
    expect(secretReason('API_BASE', 'https://api.example.com/v1')).toBe('none');
  });

  it('catches a JWT and a PEM block', () => {
    expect(secretReason('SESSION', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcd')).toBe('jwt');
    expect(
      secretReason('CERT', '-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----'),
    ).toBe('pem');
  });

  it('catches a generated-looking value, and leaves ordinary text alone', () => {
    expect(secretReason('THING', 'Xk7Fq2pLm9vTzR4bNw8sYc3D')).toBe('entropy');
    // A long path mixes classes but is not a credential.
    expect(secretReason('CACHE_DIR', '/var/folders/yj/48qx10z55m7f3mghpn0dz7y00000gn/T')).toBe(
      'none',
    );
    // A long lowercase sentence-ish value is not high entropy.
    expect(secretReason('GREETING', 'hello-world-this-is-a-long-value')).toBe('none');
  });
});

describe('masking', () => {
  it('never returns the value, and says how long it was', () => {
    const masked = maskValue('PASSWORD', 'hunter2hunter2', { reveal: false, salt: 's' });
    expect(masked.masked).toBe(true);
    expect(masked.display).not.toContain('hunter2');
    expect(masked.display).toContain('14 chars');
  });

  it('is stable, so two equal secrets still compare equal', () => {
    expect(fingerprint('same', 'salt')).toBe(fingerprint('same', 'salt'));
    expect(fingerprint('one', 'salt')).not.toBe(fingerprint('two', 'salt'));
    // Salted, so a fingerprint cannot be looked up against a table of common values.
    expect(fingerprint('same', 'a')).not.toBe(fingerprint('same', 'b'));
  });

  it('reveals only when explicitly asked', () => {
    expect(maskValue('TOKEN', 'abc', { reveal: true, salt: 's' })).toMatchObject({
      display: 'abc',
      masked: false,
    });
  });
});

describe('.env parsing', () => {
  it('reads exports, comments, quotes and an escaped quote', () => {
    const entries = parseEnv(
      [
        '# a comment',
        'export PORT=3000',
        'NAME="Ada Lovelace"',
        "SINGLE='raw $NOT_EXPANDED'",
        'TRAILING=value # inline comment',
        'ESCAPED="say \\"hi\\""',
        'EMPTY=',
      ].join('\n'),
    );

    expect(entries.map((entry) => [entry.key, entry.value])).toEqual([
      ['PORT', '3000'],
      ['NAME', 'Ada Lovelace'],
      ['SINGLE', 'raw $NOT_EXPANDED'],
      ['TRAILING', 'value'],
      ['ESCAPED', 'say "hi"'],
      ['EMPTY', ''],
    ]);
    expect(entries[5]?.empty).toBe(true);
  });

  it('keeps a multi-line quoted value together', () => {
    const entries = parseEnv('KEY="line one\nline two"\nNEXT=1\n');
    expect(entries[0]?.value).toBe('line one\nline two');
    expect(entries[1]?.key).toBe('NEXT');
  });
});

describe('kubernetes', () => {
  it('keys objects by kind, namespace and name rather than position', () => {
    const entries: ReturnType<typeof parseEnv> = [];
    flattenK8s(
      {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: 'api', namespace: 'prod' },
        spec: { replicas: 2 },
      },
      entries,
    );
    expect(entries[0]?.key).toBe('Deployment/prod/api.metadata.name');
    expect(entries.some((entry) => entry.key === 'Deployment/prod/api.spec.replicas')).toBe(true);
  });

  it('decodes base64 in a Secret before comparing, and marks it', () => {
    const entries: ReturnType<typeof parseEnv> = [];
    flattenK8s(
      {
        kind: 'Secret',
        metadata: { name: 'creds' },
        data: { password: 'aHVudGVyMg==' },
      },
      entries,
    );
    const password = entries.find((entry) => entry.key.endsWith('.data.password'));
    expect(password?.value).toBe('hunter2');
    expect(password?.decoded).toBe(true);
  });
});

describe('terraform plan', () => {
  it('reads planned values by resource address', () => {
    const entries: ReturnType<typeof parseEnv> = [];
    flattenPlan(
      {
        terraform_version: '1.9.0',
        planned_values: {
          root_module: {
            resources: [
              { address: 'aws_db_instance.main', values: { instance_class: 'db.t3.small' } },
            ],
          },
        },
      },
      entries,
    );
    expect(entries[0]).toMatchObject({
      key: 'aws_db_instance.main.instance_class',
      value: 'db.t3.small',
    });
  });
});

describe('detection', () => {
  it('recognises .env by name and a manifest and a plan by shape', () => {
    expect(configKindOf({ name: '.env.production' })).toBe('env');
    expect(configKindOf({ name: 'local.tfvars' })).toBe('tfvars');
    expect(
      configKindOf({ name: 'deploy.yaml', text: 'apiVersion: apps/v1\nkind: Deployment\n' }),
    ).toBe('k8s');
    expect(configKindOf({ name: 'plan.json', text: '{"terraform_version":"1.9.0"}' })).toBe(
      'tfplan',
    );
    expect(configKindOf({ name: 'notes.yaml', text: 'title: hello\n' })).toBeNull();
  });

  it('routes a manifest to the env kind rather than to yaml', () => {
    expect(
      detectKind({ name: 'deploy.yaml', text: 'apiVersion: v1\nkind: Service\n', kind: 'unknown' }),
    ).toBe('env');
    // An ordinary YAML file is still YAML.
    expect(detectKind({ name: 'config.yaml', text: 'a: 1\n', kind: 'unknown' })).toBe('yaml');
  });
});

describe('envEngine', () => {
  it('masks a secret everywhere the row model reaches', async () => {
    const { data, result } = await run(
      '.env',
      'PORT=3000\nDATABASE_URL=postgres://app:s3cret@db/app\n',
      'PORT=3000\nDATABASE_URL=postgres://app:n3wsecret@db/app\n',
    );

    const url = data.rows.find((row) => row.key === 'DATABASE_URL');
    expect(url?.state).toBe('changed');
    expect(url?.secret).toBe(true);
    // The engine's own output — which is what the view, the report, the clipboard and
    // the CLI all receive — carries no credential.
    expect(JSON.stringify(data)).not.toContain('s3cret');
    expect(JSON.stringify(data)).not.toContain('n3wsecret');
    // …and the change is still reported.
    expect(result.summary.modified).toBe(1);
    expect(result.summary.extra?.['secrets']).toBe(1);
  });

  it('shows a secret only when asked, and says so in the notes', async () => {
    const { data, result } = await run('.env', 'TOKEN=abc123\n', 'TOKEN=def456\n', {
      revealSecrets: true,
    });
    expect(data.rows[0]?.before).toBe('abc123');
    expect(result.normalizationNotes[0]).toMatch(/SHOWN/);
  });

  it('separates empty from absent', async () => {
    const { data } = await run('.env', 'A=1\nB=2\n', 'A=\nC=3\n');
    const states = new Map(data.rows.map((row) => [row.key, row.state]));
    expect(states.get('A')).toBe('emptied');
    expect(states.get('B')).toBe('removed');
    expect(states.get('C')).toBe('added');
  });

  it('puts what changed above what did not', async () => {
    const { data } = await run('.env', 'AAA=1\nZZZ=1\n', 'AAA=1\nZZZ=2\n');
    expect(data.rows[0]?.key).toBe('ZZZ');
  });

  it('ignores keys by glob', async () => {
    const { data } = await run('.env', 'BUILD_SHA=aaa\nPORT=1\n', 'BUILD_SHA=bbb\nPORT=2\n', {
      ignoreKeys: ['BUILD_*'],
    });
    expect(data.rows.map((row) => row.key)).toEqual(['PORT']);
  });

  it('compares two manifests by object identity, whatever their order', async () => {
    const first =
      'apiVersion: v1\nkind: Service\nmetadata:\n  name: web\nspec:\n  type: ClusterIP\n';
    const second =
      'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: api\nspec:\n  replicas: 2\n';
    const { data } = await run(
      'k8s.yaml',
      `${first}---\n${second}`,
      // Same two objects, swapped, with one field changed.
      `${second.replace('replicas: 2', 'replicas: 4')}---\n${first}`,
    );

    const replicas = data.rows.find((row) => row.key.endsWith('spec.replicas'));
    expect(replicas?.state).toBe('changed');
    // Nothing was reported as added or removed: both objects were found on both sides.
    expect(data.rows.filter((row) => row.state === 'added' || row.state === 'removed')).toEqual([]);
  });

  it('refuses two different kinds of config, and offers text', async () => {
    await expect(
      engine.compare(
        ref('A', '.env', 'A=1\n'),
        ref('B', 'deploy.yaml', 'apiVersion: v1\nkind: Service\nmetadata:\n  name: x\n'),
        engine.defaultOptions(),
        ctx(),
      ),
    ).rejects.toMatchObject({ name: 'EngineInputError', fallback: { fallbackEngineId: 'text' } });
  });

  it('suppresses a value that differs only by a normalisation rule', async () => {
    const { result } = await run(
      '.env',
      'BUILD_ID=build-2026-08-13T00:00:00Z\n',
      'BUILD_ID=build-2026-08-13T09:41:12Z\n',
      { normalize: { timestamps: true, uuids: false, hashes: false, numbers: false, custom: [] } },
    );
    expect(result.summary.modified).toBe(0);
    expect(result.summary.suppressed).toBe(1);
  });

  it('has a fingerprint that keeps two equal secrets equal', () => {
    const rows = diffConfig(
      [{ key: 'TOKEN', value: 'abc', empty: false }],
      [{ key: 'TOKEN', value: 'abc', empty: false }],
      { revealSecrets: false, ignoreKeys: [] },
      'salt',
    );
    expect(rows.rows[0]?.state).toBe('same');
    expect(rows.rows[0]?.before).toBe(rows.rows[0]?.after);
  });
});
