import { NextResponse } from 'next/server';
import { pingDb } from '@/lib/db';

export async function GET() {
  const dbUp = await pingDb(2000);

  // Deliberately NO version/build identifier: this endpoint is unauthenticated (uptime
  // monitors need it), and echoing the deployed version to any anonymous caller is free
  // fingerprinting recon (review finding). Deploy identity lives in Vercel's own
  // dashboard, which is where a human debugging an incident actually looks.
  return NextResponse.json({ ok: dbUp, db: dbUp ? 'up' : 'down' }, { status: dbUp ? 200 : 503 });
}
