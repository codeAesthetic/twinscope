import { describe, expect, it } from 'vitest';
import { droppedText, isTypingTarget, nextEmptySide } from './intake';
import type { InputPayload } from '../../../shared/channels';

/**
 * The intake decisions, tested without React or a DOM.
 *
 * Every route in — drop, picker, paste — converges on `setInput`, so what is
 * worth pinning is the small set of judgements made before that: which side
 * gets filled, whether a keystroke belongs to a text field, and whether a
 * dragged selection is worth accepting at all.
 */

const input = (side: 'A' | 'B'): InputPayload => ({
  side,
  kind: 'text',
  name: `${side}.txt`,
  size: 1,
  text: 'x',
});

describe('nextEmptySide', () => {
  it('fills A first, the order the user reads in', () => {
    expect(nextEmptySide(null, null)).toBe('A');
  });

  it('fills B once A is taken', () => {
    expect(nextEmptySide(input('A'), null)).toBe('B');
  });

  it('fills A when only B is taken', () => {
    expect(nextEmptySide(null, input('B'))).toBe('A');
  });

  it('replaces BEFORE when both are taken', () => {
    // A third paste is almost always the start of a new comparison, and BEFORE
    // is the side that makes the next paste land in AFTER.
    expect(nextEmptySide(input('A'), input('B'))).toBe('A');
  });
});

describe('isTypingTarget', () => {
  const element = (tagName: string, contentEditable = false): EventTarget =>
    ({ tagName, isContentEditable: contentEditable }) as unknown as EventTarget;

  it('claims inputs and textareas', () => {
    expect(isTypingTarget(element('INPUT'))).toBe(true);
    expect(isTypingTarget(element('TEXTAREA'))).toBe(true);
  });

  it('claims contenteditable regions whatever the tag', () => {
    expect(isTypingTarget(element('DIV', true))).toBe(true);
  });

  it('leaves ordinary elements alone', () => {
    expect(isTypingTarget(element('DIV'))).toBe(false);
    expect(isTypingTarget(element('BUTTON'))).toBe(false);
  });

  it('treats a missing target as not typing', () => {
    // Keyboard events can arrive with a null target; a global binding should
    // still fire rather than swallow the key.
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('droppedText', () => {
  it('builds a payload naming the side it landed on', () => {
    const payload = droppedText('B', 'hello');
    expect(payload).toMatchObject({
      side: 'B',
      kind: 'text',
      name: 'dropped-b.txt',
      text: 'hello',
    });
  });

  it('measures size from the text, since there is no file behind it', () => {
    expect(droppedText('A', 'abcd')?.size).toBe(4);
  });

  it('refuses whitespace, so a stray drag does not fill a zone with nothing', () => {
    expect(droppedText('A', '   \n\t ')).toBeNull();
    expect(droppedText('A', '')).toBeNull();
  });
});
