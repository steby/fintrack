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
    // Matches globals.css's dark theme (pure black) — next-themes' defaultTheme, and
    // the OLED-dark identity this app is built around (spec.md Phase 3).
    background_color: '#000000',
    theme_color: '#000000',
    icons: [
      { src: '/icons/192', sizes: '192x192', type: 'image/png' },
      { src: '/icons/512', sizes: '512x512', type: 'image/png' },
    ],
  };
}
