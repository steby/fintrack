import { NextResponse } from 'next/server';
import { pingDb } from '@/lib/db';
import pkg from '../../../package.json';

export async function GET() {
  const dbUp = await pingDb(2000);

  return NextResponse.json(
    { ok: dbUp, db: dbUp ? 'up' : 'down', version: pkg.version },
    { status: dbUp ? 200 : 503 },
  );
}
