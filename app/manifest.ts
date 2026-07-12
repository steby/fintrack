import type { MetadataRoute } from 'next';

// app/icons/{192,512}/route.tsx generate these — see that file for why manifest icons
// can't reuse the app/icon.tsx special-file convention (no stable literal `src` URL).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'FinTrack',
    short_name: 'FinTrack',
    description: 'Household budget and finance tracker',
    start_url: '/',
    display: 'standalone',
    // #0c0c11 is the sRGB rendering of app/globals.css's `.dark { --background:
    // oklch(0.155 0.012 285) }` — Phase 11's PWA refresh, matching the layered warm
    // dark theme Phase 8 introduced (next-themes' defaultTheme is still 'dark') rather
    // than the pure-black OLED identity spec.md Phase 3 originally shipped and Phase 8
    // superseded. A manifest can't express light/dark variants the way the `viewport`
    // export's themeColor media array does (see app/layout.tsx) — one fixed color, so
    // this picks the default theme's own background instead of a compromise value.
    background_color: '#0c0c11',
    theme_color: '#0c0c11',
    icons: [
      { src: '/icons/192', sizes: '192x192', type: 'image/png' },
      { src: '/icons/512', sizes: '512x512', type: 'image/png' },
    ],
  };
}
