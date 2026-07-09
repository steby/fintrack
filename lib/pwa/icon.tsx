import type { ReactElement } from 'react';

/** Shared glyph for every generated app icon (favicon, apple-icon, manifest icons) —
 *  one definition so the four routes that render it can never visually drift apart.
 *  Matches the app's OLED-dark identity (globals.css dark theme: pure black
 *  background) rather than the light theme, since that's next-themes' defaultTheme. */
export function appIconGlyph(fontSize: number): ReactElement {
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
        fontSize,
        fontWeight: 700,
        fontFamily: 'sans-serif',
      }}
    >
      F
    </div>
  );
}
