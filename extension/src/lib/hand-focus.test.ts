import { afterEach, describe, expect, it } from 'vitest';

import { handFocusBack } from './hand-focus';

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
});

function setUp() {
  const answer = document.createElement('p');
  answer.id = 'answer';
  answer.textContent = 'Alpha bravo charlie';
  const box = document.createElement('textarea');
  const stop = document.createElement('button');
  stop.textContent = 'Stop';
  document.body.append(answer, box, stop);
  stop.focus();
  return { box, stop };
}

describe('handFocusBack', () => {
  it('focuses the message box after a pointer press', () => {
    const { box } = setUp();
    handFocusBack(box, { pointer: true });
    expect(document.activeElement).toBe(box);
  });

  it('leaves focus alone after a keyboard press, so a second Enter cannot land in an idle box and send the draft', () => {
    const { box, stop } = setUp();
    handFocusBack(box, { pointer: false });
    expect(document.activeElement).toBe(stop);
    expect(document.activeElement).not.toBe(box);
  });

  it('focuses the box after a keyboard press when the caller says it is safe (Send: the box is busy afterwards)', () => {
    const { box } = setUp();
    handFocusBack(box, { pointer: false, keyboardToo: true });
    expect(document.activeElement).toBe(box);
  });

  it('leaves a text selection alone, so the user can still copy it', () => {
    const { box, stop } = setUp();
    const range = document.createRange();
    range.selectNodeContents(document.getElementById('answer')!);
    window.getSelection()!.addRange(range);
    handFocusBack(box, { pointer: true });
    expect(document.activeElement).toBe(stop);
    expect(window.getSelection()!.toString()).toBe('Alpha bravo charlie');
  });

  it('does nothing without a box', () => {
    const { stop } = setUp();
    handFocusBack(null, { pointer: true });
    expect(document.activeElement).toBe(stop);
  });
});
