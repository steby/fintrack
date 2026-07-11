'use client';

import { Info } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ResponsiveSheet } from '@/components/ui/responsive-sheet';

// Real Phase 8 exercise of Dialog + Drawer + ResponsiveSheet together (a centered Dialog
// at >= md, a bottom Drawer below it — same trigger, same content either way): the
// Tooltip next to the page heading is a quick hover-only hint (desktop pointer only, per
// Base UI's own touch-disabled design), so this tap-friendly sheet is the one place on
// this page that actually explains the net-worth calculation on a phone.
export function NetWorthAboutSheet() {
  return (
    <ResponsiveSheet
      title="About net worth"
      description="How the total above and the chart below are calculated."
      trigger={
        <Button type="button" variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
          <Info className="size-4" />
          Learn more
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">
        Each bank account starts from its opening balance, then every entry recorded against it
        (actual amount if entered, budgeted amount otherwise) is added or subtracted as it happens.
        A linked credit card has no balance of its own here — its spend rolls up into whichever bank
        account it&apos;s linked to, since that&apos;s the account that will eventually cover it.
      </p>
    </ResponsiveSheet>
  );
}
