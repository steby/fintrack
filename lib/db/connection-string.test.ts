import { describe, it, expect } from 'vitest';
import { pinStrictSslMode } from './connection-string';

describe('pinStrictSslMode', () => {
  it('upgrades sslmode=require to verify-full, preserving everything else', () => {
    const out = pinStrictSslMode(
      'postgresql://user:pass@ep-x.neon.tech/db?sslmode=require&channel_binding=require',
    );
    const url = new URL(out);
    expect(url.searchParams.get('sslmode')).toBe('verify-full');
    expect(url.searchParams.get('channel_binding')).toBe('require');
    expect(url.username).toBe('user');
    expect(url.password).toBe('pass');
    expect(url.hostname).toBe('ep-x.neon.tech');
    expect(url.pathname).toBe('/db');
  });

  it('upgrades the other aliased modes (prefer, verify-ca)', () => {
    expect(pinStrictSslMode('postgresql://h/db?sslmode=prefer')).toContain('sslmode=verify-full');
    expect(pinStrictSslMode('postgresql://h/db?sslmode=verify-ca')).toContain(
      'sslmode=verify-full',
    );
  });

  it('leaves an absent sslmode alone (plain local postgres must keep working)', () => {
    const raw = 'postgresql://localhost:5432/fintrack';
    expect(pinStrictSslMode(raw)).toBe(raw);
  });

  it('leaves explicit disable/allow/verify-full untouched', () => {
    for (const mode of ['disable', 'allow', 'verify-full']) {
      const raw = `postgresql://h/db?sslmode=${mode}`;
      expect(pinStrictSslMode(raw)).toBe(raw);
    }
  });

  it('returns a non-URL-parseable string unchanged', () => {
    const dsn = 'host=localhost port=5432 dbname=fintrack';
    expect(pinStrictSslMode(dsn)).toBe(dsn);
  });
});
