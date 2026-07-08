// Deliberately-planted fake credential — proves the CI secret-scan gate (gitleaks) actually
// blocks a build. Random value, never used anywhere, not a real credential for any service.
// Removed in the very next commit. See PROGRESS.md Phase 0 entry.
export const apiKey = 'ec218f2896b1c9892944b8e0f890651da13d709f0a1a57eda39a233e2ff3a21d';
