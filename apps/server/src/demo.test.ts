import { describe, expect, it } from 'vitest';
import { decideDemo, resolveDemoMode } from './demo.js';

describe('resolveDemoMode', () => {
  it('распознаёт явные значения', () => {
    expect(resolveDemoMode('auto')).toBe('auto');
    expect(resolveDemoMode(undefined)).toBe('auto');
    expect(resolveDemoMode('1')).toBe('on');
    expect(resolveDemoMode('on')).toBe('on');
    expect(resolveDemoMode('true')).toBe('on');
    expect(resolveDemoMode('0')).toBe('off');
    expect(resolveDemoMode('off')).toBe('off');
    expect(resolveDemoMode('false')).toBe('off');
  });
});

describe('decideDemo', () => {
  it('on — демо всегда, даже если есть живые форматы', () => {
    expect(decideDemo('on', true, false)).toEqual({ useDemo: true, reason: 'forced' });
    expect(decideDemo('on', false, false)).toEqual({ useDemo: true, reason: 'forced' });
  });

  it('off — никогда демо', () => {
    expect(decideDemo('off', false, true)).toEqual({ useDemo: false, reason: 'none' });
    expect(decideDemo('off', true, false)).toEqual({ useDemo: false, reason: 'none' });
  });

  it('auto — демо при бот-гейте или недоступности YouTube', () => {
    expect(decideDemo('auto', false, false)).toEqual({ useDemo: true, reason: 'botgate' });
    expect(decideDemo('auto', true, true)).toEqual({ useDemo: true, reason: 'unreachable' });
    expect(decideDemo('auto', true, false)).toEqual({ useDemo: false, reason: 'none' });
  });
});