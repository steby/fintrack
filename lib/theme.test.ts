import { describe, it, expect } from 'vitest';
import { THEME_CYCLE, nextTheme, isThemePreference } from './theme';

describe('nextTheme', () => {
  it('cycles light → dark → system → light', () => {
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('system');
    expect(nextTheme('system')).toBe('light');
  });

  it('visits every preference exactly once per full cycle', () => {
    const seen = new Set<string>();
    let current: string = 'light';
    for (let i = 0; i < THEME_CYCLE.length; i++) {
      current = nextTheme(current);
      seen.add(current);
    }
    expect(seen.size).toBe(THEME_CYCLE.length);
  });

  it('falls back to light for unknown, empty, or absent input', () => {
    expect(nextTheme(undefined)).toBe('light');
    expect(nextTheme(null)).toBe('light');
    expect(nextTheme('')).toBe('light');
    expect(nextTheme('oled')).toBe('light');
    expect(nextTheme('<script>')).toBe('light');
  });
});

describe('isThemePreference', () => {
  it('accepts exactly the three cycle values', () => {
    expect(isThemePreference('light')).toBe(true);
    expect(isThemePreference('dark')).toBe(true);
    expect(isThemePreference('system')).toBe(true);
    expect(isThemePreference('auto')).toBe(false);
    expect(isThemePreference(undefined)).toBe(false);
  });
});
