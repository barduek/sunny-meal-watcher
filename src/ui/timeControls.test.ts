import { describe, expect, it } from 'vitest';
import { snapToSlider } from './timeControls';

describe('snapToSlider', () => {
  it('redondea al paso de 5 minutos más cercano', () => {
    expect(snapToSlider({ date: '2026-09-26', minutes: 16 * 60 + 47 })).toEqual({ date: '2026-09-26', minutes: 1005 });
    expect(snapToSlider({ date: '2026-09-26', minutes: 16 * 60 + 48 })).toEqual({ date: '2026-09-26', minutes: 1010 });
  });

  it('no se pasa del máximo del slider (23:55)', () => {
    expect(snapToSlider({ date: '2026-09-26', minutes: 23 * 60 + 58 }).minutes).toBe(23 * 60 + 55);
  });
});
