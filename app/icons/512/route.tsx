import { ImageResponse } from 'next/og';
import { appIconGlyph } from '../../../lib/pwa/icon';

// See app/icons/192/route.tsx for why this is force-static.
export const dynamic = 'force-static';

export async function GET() {
  return new ImageResponse(appIconGlyph(512), { width: 512, height: 512 });
}
