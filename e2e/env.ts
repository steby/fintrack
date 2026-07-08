export function requireEnv(name: string): string {
  // `name` is always a literal string constant at every call site (e.g.
  // 'SEED_OWNER_EMAIL'), never untrusted input reading arbitrary process.env keys.
  // eslint-disable-next-line security/detect-object-injection
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set to run this E2E spec (see .env.example)`);
  }
  return value;
}
