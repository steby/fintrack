import type { ReactElement } from 'react';

// Glyph fills ~62.5% of the icon's pixel size — derived here, once, rather than
// hand-computed per call site (four call sites previously each typed their own
// fontSize literal, and one had silently drifted off this ratio).
const GLYPH_SIZE_RATIO = 0.625;

/** Shared glyph for every generated app icon (favicon, apple-icon, manifest icons) —
 *  one definition so the four routes that render it can never visually drift apart.
 *  Phase 11 PWA refresh: a solid violet background (the SAME hex as globals.css's
 *  `--chart-1` light slot / the app's `--primary` hue — already CVD-validated as part
 *  of that palette, not a freshly-invented color) with a near-white glyph, replacing
 *  the pure-black OLED-era icon (spec.md Phase 3's identity, superseded by Phase 8's
 *  layered warm dark theme). One fixed color regardless of the OS's light/dark
 *  preference — an installed app icon renders on the home screen/app switcher, outside
 *  any page's own light/dark theme context, so there's no "current theme" to match the
 *  way the in-app UI does. `size` is the icon's pixel width/height (assumed square);
 *  fontSize is derived from it, not passed separately, so every icon stays in
 *  proportion by construction. */
export function appIconGlyph(size: number): ReactElement {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#7c3aed',
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
