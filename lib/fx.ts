import 'server-only';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { fxRates } from './db/schema';
import { logger } from './log';
import { isFxRateStale, SUPPORTED_FX_CURRENCIES, type FxCurrency } from './domain/fx-rules';

// frankfurter.app: ECB reference rates, no API key, no signup — matches the user's
// spec ("refreshed whenever, no need to be exact rates"). The converted figure is a
// pre-fill the user can overwrite, never an authority.
const FRANKFURTER_URL = 'https://api.frankfurter.app/latest';
const FETCH_TIMEOUT_MS = 4000;

const frankfurterSchema = z.object({
  rates: z.object({ SGD: z.number().positive() }),
});

export interface FxRateResult {
  rate: number; // 1 unit of `currency` = `rate` SGD
  asOf: Date;
}

// Cache-or-fetch: serve the cached row while fresh; on a stale/missing row try one
// network fetch and fall back to the stale row (better an old estimate than nothing)
// or null (UI: "enter the SGD amount manually"). Never throws — an FX hiccup must
// never break entry logging.
export async function getRateToSgd(currency: FxCurrency): Promise<FxRateResult | null> {
  const [cached] = await db.select().from(fxRates).where(eq(fxRates.currency, currency)).limit(1);
  if (cached && !isFxRateStale(cached.fetchedAt)) {
    return { rate: Number(cached.rateToSgd), asOf: cached.fetchedAt };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const response = await fetch(`${FRANKFURTER_URL}?from=${currency}&to=SGD`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) throw new Error(`frankfurter ${response.status}`);
    const parsed = frankfurterSchema.parse(await response.json());
    const rate = parsed.rates.SGD;

    const fetchedAt = new Date();
    await db
      .insert(fxRates)
      .values({ currency, rateToSgd: rate.toFixed(6), fetchedAt })
      .onConflictDoUpdate({
        target: fxRates.currency,
        set: { rateToSgd: rate.toFixed(6), fetchedAt },
      });
    return { rate, asOf: fetchedAt };
  } catch (err) {
    logger.warn({ err, currency }, 'FX rate fetch failed');
    if (cached) {
      // Stale beats nothing for an explicitly-estimated pre-fill.
      return { rate: Number(cached.rateToSgd), asOf: cached.fetchedAt };
    }
    return null;
  }
}

export { SUPPORTED_FX_CURRENCIES, type FxCurrency };
