// Single source of truth for "static, deploy-scoped PWA asset paths that must never
// require a session and are always safe to cache-first" — consumed by BOTH proxy.ts
// (via buildPwaMatcherAlternatives(), see that file's own comment for why it can't
// import this reactively) and app/sw.js/route.ts (a real import, no such restriction
// for a Route Handler's body). Previously these were two hand-typed, independently
// maintained lists (one a regex string, one plain JS checks) that could silently
// drift; now there's exactly one array each file derives its logic from.
export const STATIC_PWA_EXACT_PATHS = [
  '/icon',
  '/apple-icon',
  '/favicon.ico',
  '/manifest.webmanifest',
  '/sw.js',
] as const;

export const STATIC_PWA_PREFIX_PATHS = ['/icons/'] as const;

// Escapes regex metacharacters so a literal path segment (e.g. the `.` in
// favicon.ico) can never be misread as "any character" — a real bug a prior version
// of proxy.ts's matcher shipped with (see PROGRESS.md's Phase 7 code-review entries:
// an unescaped `.` meant `/swXjs` and `/faviconXico` both silently bypassed the
// session check).
export function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The `(?!...)` alternatives proxy.ts's matcher needs for these paths. Next.js
// statically parses `config.matcher` at build time (AST analysis, not execution — a
// real build confirmed a computed value there is rejected outright: "Entry
// matcher[0] need to be static strings"), so proxy.ts can't call this function and
// use its result directly. Instead, proxy.ts hardcodes the literal string this
// function produces, and lib/pwa/static-paths.test.ts asserts the two stay identical
// — any edit to the paths above that isn't mirrored into proxy.ts's literal fails
// that test, instead of silently drifting.
export function buildPwaMatcherAlternatives(): string {
  return [
    ...STATIC_PWA_EXACT_PATHS.map((path) => `${escapeRegExp(path.slice(1))}$`),
    ...STATIC_PWA_PREFIX_PATHS.map((path) => escapeRegExp(path.slice(1))),
  ].join('|');
}
