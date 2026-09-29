import { describe, expect, it } from 'vitest';

import { pictureFit } from './diagram-fit';

describe('pictureFit', () => {
  it('a picture whose words stay 11px or larger once shrunk to the panel just fits', () => {
    // The five-box sample: 451px wide at 16px words, 380px panel: words 13.5px.
    expect(pictureFit(451, 380, 16)).toEqual({ kind: 'fits' });
    expect(pictureFit(552, 380, 16)).toEqual({ kind: 'fits' }); // 552 × 11/16 = 379.5: just fits
  });

  it('a wider one keeps its words at 11px and scrolls sideways, up to two and a half panels wide', () => {
    // Thirty-nine alike elements grouped into one box: 796px wide.
    expect(pictureFit(796, 380, 16)).toEqual({ kind: 'scrolls', width: 548 });
    expect(pictureFit(1380, 380, 16)).toEqual({ kind: 'scrolls', width: 949 });
  });

  it('past that, the whole picture shows small: forty boxes in a row, or every element of a 150-element flow', () => {
    expect(pictureFit(11_020, 380, 16)).toEqual({ kind: 'tooBig' });
    expect(pictureFit(10_859, 380, 16)).toEqual({ kind: 'tooBig' });
    expect(pictureFit(1_400, 380, 16)).toEqual({ kind: 'tooBig' }); // 962px at 11px, over 950
  });

  it('words already smaller than 11px are never enlarged, and an unmeasured panel changes nothing', () => {
    expect(pictureFit(800, 380, 10)).toEqual({ kind: 'scrolls', width: 800 });
    expect(pictureFit(800, 0, 16)).toEqual({ kind: 'fits' });
    expect(pictureFit(0, 380, 16)).toEqual({ kind: 'fits' });
    expect(pictureFit(800, 380, Number.NaN)).toEqual({ kind: 'fits' });
  });
});
