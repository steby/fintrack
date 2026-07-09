import { ImageResponse } from 'next/og';
import { appIconGlyph } from '../../../lib/pwa/icon';

// Not the `icon.tsx` special-file convention (that's for the <head> favicon link) —
// a plain Route Handler at a stable path, because app/manifest.ts needs a literal
// `src` URL string for its installable-icon entries (192/512px, per the Web Manifest
// spec) and the special-file convention doesn't expose one.
export async function GET() {
  return new ImageResponse(appIconGlyph(120), { width: 192, height: 192 });
}
