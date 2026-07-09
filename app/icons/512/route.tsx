import { ImageResponse } from 'next/og';
import { appIconGlyph } from '../../../lib/pwa/icon';

export async function GET() {
  return new ImageResponse(appIconGlyph(320), { width: 512, height: 512 });
}
