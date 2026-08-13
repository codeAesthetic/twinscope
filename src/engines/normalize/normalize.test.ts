import { describe, expect, it } from 'vitest';
import {
  createNormalizer,
  DEFAULT_NORMALIZE_OPTIONS,
  MAX_CUSTOM_RULES,
  normalizeOptionsFrom,
  type NormalizeOptions,
} from './index';
import { diffJson, DEFAULT_JSON_OPTIONS } from '../json/jsonDiff';
import { diffText, DEFAULT_TEXT_OPTIONS } from '../text/textDiff';
import { diffCsv, DEFAULT_CSV_OPTIONS } from '../csv/csvDiff';

const rules = (patch: Partial<NormalizeOptions> = {}): NormalizeOptions => ({
  ...DEFAULT_NORMALIZE_OPTIONS,
  custom: [],
  ...patch,
});

describe('createNormalizer — defaults', () => {
  it('is inert when nothing is enabled, so engines can skip the work', () => {
    const normalizer = createNormalizer(rules());
    expect(normalizer.inert).toBe(true);
    // Normalisation nobody asked for is a comparison quietly lying.
    expect(normalizer.equivalent('a', 'b')).toBe(false);
    expect(normalizer.suppressed()).toBe(0);
    expect(normalizer.notes()).toEqual([]);
  });

  it('still says two identical values are identical', () => {
    expect(createNormalizer(rules()).equivalent('same', 'same')).toBe(true);
  });
});

describe('createNormalizer — masking', () => {
  it('masks a UUID wherever it appears, not only as a whole value', () => {
    // The point of masking over matching: the id is inside a sentence.
    const normalizer = createNormalizer(rules({ uuids: true }));
    expect(
      normalizer.equivalent(
        'created user 3f2504e0-4f89-11d3-9a0c-0305e82c3301 at start',
        'created user 8a6b1c22-1111-4444-8888-0305e82c3301 at start',
      ),
    ).toBe(true);
    // A difference elsewhere in the string is still a difference.
    expect(
      normalizer.equivalent(
        'created user 3f2504e0-4f89-11d3-9a0c-0305e82c3301 at start',
        'deleted user 8a6b1c22-1111-4444-8888-0305e82c3301 at start',
      ),
    ).toBe(false);
  });

  it('masks timestamps in several shapes', () => {
    const normalizer = createNormalizer(rules({ timestamps: true }));
    expect(normalizer.equivalent('built 2026-01-01T10:00:00Z', 'built 2026-08-13T22:31:04Z')).toBe(
      true,
    );
    // A space instead of a T — SQL and log files.
    expect(normalizer.equivalent('at 2026-01-01 10:00:00', 'at 2026-08-13 22:31:04')).toBe(true);
    // And a bare date.
    expect(normalizer.equivalent('on 2026-01-01', 'on 2026-08-13')).toBe(true);
  });

  it('does not treat any number as a timestamp', () => {
    // `Date.parse` accepts "12" and a lot of prose; the pattern is deliberate.
    const normalizer = createNormalizer(rules({ timestamps: true }));
    expect(normalizer.equivalent('12', '13')).toBe(false);
    expect(normalizer.equivalent('version 1', 'version 2')).toBe(false);
  });

  it('masks hashes of 32 hex characters or more, and not shorter runs', () => {
    const normalizer = createNormalizer(rules({ hashes: true }));
    const one = 'sha 5d41402abc4b2a76b9719d911017c592a1b2c3d4';
    const two = 'sha 7d793037a0760186574b0282f2f435e7a1b2c3d4';
    expect(normalizer.equivalent(one, two)).toBe(true);
    // `deadbeef` is a word as often as it is a hash.
    expect(normalizer.equivalent('id deadbeef', 'id cafebabe')).toBe(false);
  });

  it('applies several rules at once', () => {
    const normalizer = createNormalizer(rules({ uuids: true, timestamps: true }));
    expect(
      normalizer.equivalent(
        'job 3f2504e0-4f89-11d3-9a0c-0305e82c3301 ran at 2026-01-01T00:00:00Z',
        'job 8a6b1c22-1111-4444-8888-0305e82c3301 ran at 2026-08-13T09:12:00Z',
      ),
    ).toBe(true);
  });

  it('does not carry regex state between calls', () => {
    // A shared `g`-flagged regex keeps `lastIndex`, which silently skips matches on
    // the second value and made every other comparison fail.
    const normalizer = createNormalizer(rules({ uuids: true }));
    const a = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
    const b = '8a6b1c22-1111-4444-8888-0305e82c3301';
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(normalizer.equivalent(a, b), `attempt ${attempt}`).toBe(true);
    }
  });
});

describe('createNormalizer — tolerance', () => {
  it('treats two whole timestamps within tolerance as equal', () => {
    const normalizer = createNormalizer(rules({ timestampToleranceMs: 60_000 }));
    expect(normalizer.equivalent('2026-08-13T10:00:00Z', '2026-08-13T10:00:30Z')).toBe(true);
    expect(normalizer.equivalent('2026-08-13T10:00:00Z', '2026-08-13T10:05:00Z')).toBe(false);
  });

  it('needs the WHOLE value to be a timestamp, since a mask cannot hold tolerance', () => {
    const normalizer = createNormalizer(rules({ timestampToleranceMs: 60_000 }));
    expect(normalizer.equivalent('at 2026-08-13T10:00:00Z', 'at 2026-08-13T10:00:30Z')).toBe(false);
  });

  it('compares numbers within a tolerance', () => {
    const normalizer = createNormalizer(rules({ numbers: true, numberTolerance: 0.01 }));
    expect(normalizer.equivalent('1.001', '1.002')).toBe(true);
    expect(normalizer.equivalent('1.0', '1.5')).toBe(false);
    // Not a number: no tolerance applies.
    expect(normalizer.equivalent('1.0a', '1.0b')).toBe(false);
  });

  it('never masks numbers, which would equate 1 with 9999', () => {
    const normalizer = createNormalizer(rules({ numbers: true, numberTolerance: 0.5 }));
    expect(normalizer.equivalent('port 1', 'port 9999')).toBe(false);
  });
});

describe('createNormalizer — custom rules', () => {
  it('masks what a custom pattern matches, and names it', () => {
    const normalizer = createNormalizer(
      rules({ custom: [{ pattern: 'req_[a-z0-9]+', label: 'request ids' }] }),
    );
    expect(normalizer.equivalent('trace req_abc123 ok', 'trace req_zzz999 ok')).toBe(true);
    expect(normalizer.notes()).toEqual(['Ignored 1 difference in request ids.']);
  });

  it('falls back to the pattern as the label', () => {
    const normalizer = createNormalizer(rules({ custom: [{ pattern: 'v\\d+' }] }));
    normalizer.equivalent('api v1', 'api v2');
    expect(normalizer.notes()[0]).toContain('v\\d+');
  });

  it('skips an uncompilable pattern and says so, rather than failing the comparison', () => {
    const normalizer = createNormalizer(rules({ custom: [{ pattern: '([unclosed' }] }));
    expect(normalizer.equivalent('a', 'b')).toBe(false);
    expect(normalizer.notes().join(' ')).toContain('is not a valid regular expression');
  });

  it('caps the rule count and the pattern length', () => {
    const many = Array.from({ length: MAX_CUSTOM_RULES + 4 }, (_, index) => ({
      pattern: `x${index}`,
    }));
    const normalizer = createNormalizer(rules({ custom: many }));
    // Rule 9 onwards is not compiled, so the value it would have masked still differs.
    expect(normalizer.equivalent('x9', 'x11')).toBe(false);

    const long = createNormalizer(rules({ custom: [{ pattern: 'a'.repeat(500) }] }));
    expect(long.notes().join(' ')).toContain('not a valid regular expression');
  });

  it('masks every occurrence, not just the first', () => {
    const normalizer = createNormalizer(rules({ custom: [{ pattern: '\\d+' }] }));
    expect(normalizer.equivalent('a1 b2 c3', 'a9 b8 c7')).toBe(true);
  });
});

describe('createNormalizer — explainability', () => {
  it('counts each rule separately and orders by frequency', () => {
    const normalizer = createNormalizer(rules({ uuids: true, timestamps: true }));
    normalizer.equivalent('2026-01-01', '2026-08-13');
    normalizer.equivalent('2026-02-01', '2026-08-14');
    normalizer.equivalent(
      '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
      '8a6b1c22-1111-4444-8888-0305e82c3301',
    );
    expect(normalizer.applied()).toEqual([
      { id: 'timestamps', label: 'timestamps', count: 2 },
      { id: 'uuids', label: 'UUIDs', count: 1 },
    ]);
    expect(normalizer.suppressed()).toBe(3);
  });

  it('counts nothing for a comparison it did not change', () => {
    const normalizer = createNormalizer(rules({ uuids: true }));
    normalizer.equivalent('one', 'two');
    normalizer.equivalent('same', 'same');
    expect(normalizer.suppressed()).toBe(0);
  });
});

describe('normalizeOptionsFrom', () => {
  it('fills the defaults and survives a partial or absent object', () => {
    expect(normalizeOptionsFrom(undefined)).toEqual(DEFAULT_NORMALIZE_OPTIONS);
    expect(normalizeOptionsFrom({ uuids: true })).toMatchObject({ uuids: true, hashes: false });
  });

  it('refuses a non-array custom list, which is what a corrupted setting looks like', () => {
    expect(normalizeOptionsFrom({ custom: 'nonsense' }).custom).toEqual([]);
  });
});

/**
 * The point of the whole feature: one pipeline, three engines. These are the tests
 * that would have caught wiring it into only one of them.
 */
describe('the same rules in every engine', () => {
  const normalize = rules({ uuids: true, timestamps: true });

  it('suppresses a difference in the text engine', () => {
    const before = 'id: 3f2504e0-4f89-11d3-9a0c-0305e82c3301\nname: Ada\n';
    const after = 'id: 8a6b1c22-1111-4444-8888-0305e82c3301\nname: Ada\n';

    const plain = diffText(before, after, { ...DEFAULT_TEXT_OPTIONS });
    expect(plain.stats.modified + plain.stats.added).toBeGreaterThan(0);

    const normalised = diffText(before, after, { ...DEFAULT_TEXT_OPTIONS, normalize });
    expect(normalised.stats).toMatchObject({ added: 0, removed: 0, modified: 0 });
    expect(normalised.notes.join(' ')).toContain('differ only by a normalisation rule');

    // And what is *displayed* still comes from both files. A context row that paired
    // only because a rule masked the difference carries the BEFORE line too, or the
    // view would show the AFTER text on both sides.
    const paired = normalised.data.rows.find((row) => row.textBefore !== undefined);
    expect(paired?.text).toContain('8a6b1c22');
    expect(paired?.textBefore).toContain('3f2504e0');
  });

  it('suppresses a difference in the JSON core, and counts it', () => {
    const before = { id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301', at: '2026-01-01T00:00:00Z' };
    const after = { id: '8a6b1c22-1111-4444-8888-0305e82c3301', at: '2026-08-13T09:00:00Z' };

    const plain = diffJson(before, after, { ...DEFAULT_JSON_OPTIONS, ignorePaths: [] });
    expect(plain.stats.changed).toBe(2);

    const normalised = diffJson(before, after, {
      ...DEFAULT_JSON_OPTIONS,
      ignorePaths: [],
      normalize,
    });
    expect(normalised.stats.changed).toBe(0);
    expect(normalised.stats.suppressed).toBe(2);
    expect(normalised.notes.join(' ')).toContain('Ignored 1 difference in UUIDs');
    expect(normalised.notes.join(' ')).toContain('Ignored 1 difference in timestamps');
  });

  it('suppresses a difference in the CSV engine', () => {
    const before = 'id,name,at\n3f2504e0-4f89-11d3-9a0c-0305e82c3301,Ada,2026-01-01\n';
    const after = 'id,name,at\n8a6b1c22-1111-4444-8888-0305e82c3301,Ada,2026-08-13\n';

    const plain = diffCsv(before, after, { ...DEFAULT_CSV_OPTIONS, ignoreColumns: [] });
    // Two of three columns differ, so similarity puts it below the pairing
    // threshold — an unpaired removal plus an addition rather than one edit.
    expect(plain.stats.added + plain.stats.removed + plain.stats.modified).toBeGreaterThan(0);

    const normalised = diffCsv(before, after, {
      ...DEFAULT_CSV_OPTIONS,
      ignoreColumns: [],
      normalize,
    });
    expect(normalised.stats).toMatchObject({ added: 0, removed: 0, modified: 0, identical: 1 });
    expect(normalised.stats.suppressed).toBe(2);
    expect(normalised.notes.join(' ')).toContain('Ignored');
  });

  it('still aligns CSV rows whose ids were masked', () => {
    // Without masking the *signature* too, the rows fail to align and everything
    // below the first regenerated id reads as changed.
    const before = 'id,name,city\nreq_1,Ada,London\nreq_2,Bob,Leeds\nreq_3,Cy,Hull\n';
    const after = 'id,name,city\nreq_9,Ada,London\nreq_8,Bob,Leeds\nreq_7,Cy,Hull\n';
    const { stats } = diffCsv(before, after, {
      ...DEFAULT_CSV_OPTIONS,
      ignoreColumns: [],
      normalize: rules({ custom: [{ pattern: 'req_\\d+', label: 'request ids' }] }),
    });
    expect(stats).toMatchObject({ added: 0, removed: 0, modified: 0, identical: 3 });
  });
});
