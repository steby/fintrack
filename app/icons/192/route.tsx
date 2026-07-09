import { ImageResponse } from 'next/og';
import { appIconGlyph } from '../../../lib/pwa/icon';

// Not the `icon.tsx` special-file convention (that's for the <head> favicon link) —
// a plain Route Handler at a stable path, because app/manifest.ts needs a literal
// `src` URL string for its installable-icon entries (192/512px, per the Web Manifest
// spec) and the special-file convention doesn't expose one.
//
// `dynamic = 'force-static'`: without it, a plain Route Handler like this one is
// dynamic by default (re-runs the Satori PNG render on every request) — unlike
// icon.tsx/apple-icon.tsx, which Next statically optimizes automatically as part of
// their special-file convention. This output has no per-request input at all, so
// there's no reason to ever re-render it after the first request.
export const dynamic = 'force-static';

export async function GET() {
  return new ImageResponse(appIconGlyph(192), { width: 192, height: 192 });
}
