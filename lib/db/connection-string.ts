// pg-connection-string currently treats sslmode=require / prefer / verify-ca as
// aliases for verify-full, and warns on every process start that the next pg major
// (v9) will downgrade them to real libpq semantics — weaker cert verification than
// what this app gets today. Pinning the URL to verify-full at the one env choke point
// (lib/env.ts) keeps today's strict behavior across the pg v9 upgrade in EVERY
// environment (local, CI, Vercel) without coordinating edits to three copies of the
// secret, and silences the startup warning for the same reason.
//
// Deliberately a RAW-STRING replacement, not `new URL()` (review finding): an
// un-percent-encoded `#` in a password makes URL() treat everything after it as the
// fragment, so searchParams silently comes back empty and the upgrade is skipped with
// no signal — while pg's own lenient parser still honors the sslmode we failed to see.
// The pattern requires a literal `?` or `&` immediately before `sslmode=`, so
// key=value DSNs (`host=x sslmode=require`, space-separated) stay untouched, same as
// the old URL-based version's "not URL-parseable — leave it for pg" behavior. Only the
// modes pg currently aliases to verify-full are upgraded: an ABSENT sslmode is left
// alone (a plain local postgres without TLS must keep working), and an explicit
// disable/allow/verify-full is someone's deliberate choice either way. Everything else
// in the string is byte-identical on the way out (no URL re-serialization).
const UPGRADEABLE_SSLMODE = /([?&]sslmode=)(require|prefer|verify-ca)(?=&|#|$)/;

export function pinStrictSslMode(connectionString: string): string {
  return connectionString.replace(UPGRADEABLE_SSLMODE, '$1verify-full');
}
