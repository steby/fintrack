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

  it('leaves a key=value DSN with sslmode untouched (space-separated, not query-string)', () => {
    const dsn = 'host=localhost port=5432 dbname=fintrack sslmode=require';
    expect(pinStrictSslMode(dsn)).toBe(dsn);
  });

  it('still upgrades when the password contains an un-percent-encoded # (review finding)', () => {
    // new URL() parses everything after '#' as the fragment, hiding sslmode from
    // searchParams — the old implementation silently skipped the upgrade here.
    const out = pinStrictSslMode('postgresql://user:p@ss#word@host/db?sslmode=require');
    expect(out).toBe('postgresql://user:p@ss#word@host/db?sslmode=verify-full');
  });

  it('leaves a #-password DSN with explicit disable untouched', () => {
    const raw = 'postgresql://user:p#word@host/db?sslmode=disable';
    expect(pinStrictSslMode(raw)).toBe(raw);
  });

  it('does not touch a lookalike param that merely ends in "sslmode"', () => {
    const raw = 'postgresql://h/db?fake_sslmode=require';
    expect(pinStrictSslMode(raw)).toBe(raw);
  });

  it('does not touch a value that merely starts with an upgradeable mode', () => {
    const raw = 'postgresql://h/db?sslmode=requires-thought';
    expect(pinStrictSslMode(raw)).toBe(raw);
  });

  it('is byte-identical everywhere except the sslmode value (no URL re-serialization)', () => {
    const out = pinStrictSslMode(
      'postgresql://user:pa%40ss@ep-x.neon.tech/db?channel_binding=require&sslmode=prefer#frag',
    );
    expect(out).toBe(
      'postgresql://user:pa%40ss@ep-x.neon.tech/db?channel_binding=require&sslmode=verify-full#frag',
    );
  });
});
