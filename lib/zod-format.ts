import { z } from 'zod';

// Pure and side-effect-free (no process.env access, no schema definitions) so any
// one-off validation script can import these without triggering lib/env.ts's eager
// `loadEnv()` call at that module's top level — importing anything from lib/env.ts,
// even a single named export, evaluates the whole module.

// A required field's `undefined` case can come from either a genuinely missing key OR
// (after a caller's own blank-to-undefined normalization) a blank `KEY=` line — either
// way, zod's default "invalid_type" message ("received undefined") is generic. This
// gives required fields their own specific "is required" message for that case, while
// leaving their other validators (`.min()`, `.url()`, ...) untouched for the
// present-but-invalid case.
export const required = (message: string) => ({
  error: (issue: { input: unknown }) => (issue.input === undefined ? message : undefined),
});

/** Formats a ZodError as the multi-line, human-readable list every error in this app
 *  uses. */
export function formatZodIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
}
