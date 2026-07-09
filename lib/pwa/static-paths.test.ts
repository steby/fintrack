import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { escapeRegExp, buildPwaMatcherAlternatives } from './static-paths';

describe('escapeRegExp', () => {
  it('escapes every regex metacharacter, not just dots', () => {
    expect(escapeRegExp('favicon.ico')).toBe('favicon\\.ico');
    expect(escapeRegExp('a+b')).toBe('a\\+b');
    expect(escapeRegExp('a(b)c')).toBe('a\\(b\\)c');
  });

  it('leaves ordinary characters untouched', () => {
    expect(escapeRegExp('apple-icon')).toBe('apple-icon');
  });
});

describe('buildPwaMatcherAlternatives', () => {
  it('produces the exact known-correct alternatives string', () => {
    // Locked to the concrete, live-tested value — a change here is a deliberate,
    // reviewed edit, not silent drift.
    expect(buildPwaMatcherAlternatives()).toBe(
      'icon$|apple-icon$|favicon\\.ico$|manifest\\.webmanifest$|sw\\.js$|icons/',
    );
  });

  it("proxy.ts's hardcoded matcher literal contains this exact string", () => {
    // proxy.ts can't import and use buildPwaMatcherAlternatives() directly — Next.js
    // statically parses `config.matcher` at build time and rejects a computed value
    // (confirmed by a real build: "Entry matcher[0] need to be static strings"). This
    // is the safety net instead: if lib/pwa/static-paths.ts's paths change without
    // proxy.ts's literal being updated to match, this test fails.
    //
    // readFileSync gives the raw TS SOURCE text, where a literal backslash is written
    // as two characters (\\); buildPwaMatcherAlternatives() returns the already-
    // parsed RUNTIME string (one backslash). Un-escaping the source's `\\` back to a
    // single `\` puts both sides in the same representation before comparing —
    // comparing them as-is would never match whenever a path contains a dot.
    const proxySource = readFileSync(join(__dirname, '../../proxy.ts'), 'utf8');
    const unescaped = proxySource.replace(/\\\\/g, '\\');
    expect(unescaped).toContain(buildPwaMatcherAlternatives());
  });
});
