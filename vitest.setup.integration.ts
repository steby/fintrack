// Loads .env for local integration test runs (real Neon "dev"/"ci" branch credentials).
// In CI, GitHub Actions injects env vars directly, so a missing .env here is a no-op.
import 'dotenv/config';
