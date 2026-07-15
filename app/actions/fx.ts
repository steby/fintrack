'use server';

import { z } from 'zod';
import { requireUser } from '../../lib/auth/guards';
import { getRateToSgd } from '../../lib/fx';
import { SUPPORTED_FX_CURRENCIES } from '../../lib/domain/fx-rules';

export type FxRateState = { rate: number; asOf: string } | { error: string } | undefined;

const fxRateSchema = z.object({ currency: z.enum(SUPPORTED_FX_CURRENCIES) });

// Called lazily by the quick-add sheet the moment a foreign currency is picked —
// never on page load (most entries are SGD; no rate needed). Auth'd (any signed-in
// role: it's a read of global, non-tenant data) and enum-validated; getRateToSgd
// itself never throws.
export async function getFxRateAction(currency: string): Promise<FxRateState> {
  await requireUser();
  const parsed = fxRateSchema.safeParse({ currency });
  if (!parsed.success) {
    return { error: 'Unsupported currency.' };
  }
  const result = await getRateToSgd(parsed.data.currency);
  if (!result) {
    return { error: 'Rate unavailable right now — enter the SGD amount manually.' };
  }
  return { rate: result.rate, asOf: result.asOf.toISOString() };
}
