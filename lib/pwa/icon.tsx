import type { ReactElement } from 'react';

// Glyph fills ~62.5% of the icon's pixel size — derived here, once, rather than
// hand-computed per call site (four call sites previously each typed their own
// fontSize literal, and one had silently drifted off this ratio).
const GLYPH_SIZE_RATIO = 0.625;

/** Shared glyph for every generated app icon (favicon, apple-icon, manifest icons) —
 *  one definition so the four routes that render it can never visually drift apart.
 *  Matches the app's OLED-dark identity (globals.css dark theme: pure black
 *  background) rather than the light theme, since that's next-themes' defaultTheme.
 *  `size` is the icon's pixel width/height (assumed square); fontSize is derived from
 *  it, not passed separately, so every icon stays in proportion by construction. */
export function appIconGlyph(size: number): ReactElement {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#000',
        color: '#fafafa',
        fontSize: Math.round(size * GLYPH_SIZE_RATIO),
        fontWeight: 700,
        fontFamily: 'sans-serif',
      }}
    >
      F
    </div>
  );
}
