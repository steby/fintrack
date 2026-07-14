// Theme preference cycling for the shell's single-button toggle. Kept as a pure
// module (not inline in components/theme-toggle.tsx) so the cycle order — the actual
// behavior users step through — is unit-testable without a DOM.
export const THEME_CYCLE = ['light', 'dark', 'system'] as const;

export type ThemePreference = (typeof THEME_CYCLE)[number];

export function isThemePreference(raw: string | undefined | null): raw is ThemePreference {
  return raw === 'light' || raw === 'dark' || raw === 'system';
}

// Advances light → dark → system → light. Unknown/absent input (next-themes hasn't
// hydrated yet, or a tampered localStorage value) starts the cycle at 'light' so a
// click always lands on a valid preference.
export function nextTheme(current: string | undefined | null): ThemePreference {
  if (!isThemePreference(current)) return 'light';
  const idx = THEME_CYCLE.indexOf(current);
  return THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
}
