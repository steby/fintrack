// pg-connection-string currently treats sslmode=require / prefer / verify-ca as
// aliases for verify-full, and warns on every process start that the next pg major
// (v9) will downgrade them to real libpq semantics — weaker cert verification than
// what this app gets today. Pinning the URL to verify-full at the one env choke point
// (lib/env.ts) keeps today's strict behavior across the pg v9 upgrade in EVERY
// environment (local, CI, Vercel) without coordinating edits to three copies of the
// secret, and silences the startup warning for the same reason.
const UPGRADEABLE_SSLMODES = new Set(['require', 'prefer', 'verify-ca']);

export function pinStrictSslMode(connectionString: string): string {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    // Not URL-parseable (e.g. an exotic key=value DSN) — leave it for pg to interpret
    // rather than mangling a format this function doesn't understand.
    return connectionString;
  }

  const sslmode = url.searchParams.get('sslmode');
  // Only upgrade the modes pg currently aliases to verify-full. An ABSENT sslmode is
  // left alone (a plain local postgres without TLS must keep working), and an explicit
  // disable/allow/verify-full is someone's deliberate choice either way.
  if (sslmode !== null && UPGRADEABLE_SSLMODES.has(sslmode)) {
    url.searchParams.set('sslmode', 'verify-full');
    return url.toString();
  }
  return connectionString;
}
