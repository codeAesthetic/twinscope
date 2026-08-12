import { beforeEach, describe, expect, it } from 'vitest';
import { useCompareStore } from './compare';
import type { InputPayload } from '../../../shared/channels';

const input = (side: 'A' | 'B', name: string): InputPayload => ({
  side,
  kind: 'json',
  name,
  size: 10,
  text: '{}',
});

const store = () => useCompareStore.getState();

describe('compare store — intake', () => {
  beforeEach(() => {
    store().reset();
  });

  it('fills a side and leaves the other alone', () => {
    store().setInput('A', input('A', 'before.json'));
    expect(store().a?.name).toBe('before.json');
    expect(store().b).toBeNull();
  });

  it('clears a side with null', () => {
    store().setInput('A', input('A', 'before.json'));
    store().setInput('A', null);
    expect(store().a).toBeNull();
  });

  it('swaps sides and rewrites their side labels', () => {
    store().setInput('A', input('A', 'before.json'));
    store().setInput('B', input('B', 'after.json'));
    store().swap();

    expect(store().a?.name).toBe('after.json');
    expect(store().a?.side).toBe('A');
    expect(store().b?.name).toBe('before.json');
    expect(store().b?.side).toBe('B');
  });

  it('swaps correctly when only one side is filled', () => {
    store().setInput('A', input('A', 'only.json'));
    store().swap();
    expect(store().a).toBeNull();
    expect(store().b?.name).toBe('only.json');
    expect(store().b?.side).toBe('B');
  });

  /** A stale result must not be shown against newly chosen inputs. */
  it('discards a finished result when an input changes', () => {
    store().setInput('A', input('A', 'before.json'));
    store().setInput('B', input('B', 'after.json'));
    useCompareStore.setState({ jobId: 'job-1', status: 'done' });
    store().applyEvent({
      type: 'done',
      jobId: 'job-1',
      engineId: 'demo',
      summary: { added: 1, removed: 0, modified: 0 },
      data: null,
      normalizationNotes: [],
      ms: 5,
    });
    expect(store().result).not.toBeNull();

    store().setInput('B', input('B', 'different.json'));
    expect(store().result).toBeNull();
    expect(store().status).toBe('idle');
  });

  it('reset clears inputs, engine override and job state', () => {
    store().setInput('A', input('A', 'before.json'));
    store().setEngineOverride('text');
    store().reset();

    expect(store().a).toBeNull();
    expect(store().engineOverride).toBeNull();
    expect(store().status).toBe('idle');
  });
});

describe('compare store — job events', () => {
  beforeEach(() => {
    store().reset();
    useCompareStore.setState({ jobId: 'job-1', status: 'running' });
  });

  it('tracks progress', () => {
    store().applyEvent({ type: 'progress', jobId: 'job-1', percent: 42, message: 'step 4' });
    expect(store().percent).toBe(42);
    expect(store().progressMessage).toBe('step 4');
  });

  it('records a result on done', () => {
    store().applyEvent({
      type: 'done',
      jobId: 'job-1',
      engineId: 'text',
      summary: { added: 2, removed: 1, modified: 3 },
      data: { rows: [] },
      normalizationNotes: ['ignored whitespace'],
      ms: 12,
    });

    expect(store().status).toBe('done');
    expect(store().percent).toBe(100);
    expect(store().result?.summary.modified).toBe(3);
    expect(store().result?.normalizationNotes).toEqual(['ignored whitespace']);
  });

  it('distinguishes cancellation from failure', () => {
    store().applyEvent({
      type: 'error',
      jobId: 'job-1',
      message: 'Comparison cancelled.',
      reason: 'cancelled',
    });
    expect(store().status).toBe('error');
    expect(store().error?.reason).toBe('cancelled');
  });

  /**
   * The reason `applyEvent` filters on jobId: a superseded job keeps emitting
   * until it notices the abort, and those events must not overwrite the new one.
   */
  it('ignores events from a superseded job', () => {
    store().applyEvent({ type: 'progress', jobId: 'job-OLD', percent: 99 });
    expect(store().percent).toBe(0);

    store().applyEvent({
      type: 'error',
      jobId: 'job-OLD',
      message: 'should be ignored',
      reason: 'failed',
    });
    expect(store().status).toBe('running');
    expect(store().error).toBeNull();
  });
});
