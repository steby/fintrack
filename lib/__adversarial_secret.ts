// Deliberately-planted fake credential — proves the CI secret-scan gate (gitleaks) actually
// blocks a build. Uses AWS's own publicly-documented example key, which AWS explicitly
// guarantees is never a real, functioning credential. Removed in the very next commit.
// See PROGRESS.md Phase 0 entry.
export const FAKE_AWS_KEY_FOR_ADVERSARIAL_CI_TEST = 'AKIAIOSFODNN7EXAMPLE';
