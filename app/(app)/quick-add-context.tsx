'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Shared open-state for the global quick-add sheet: the desktop trigger lives INSIDE
// the sidebar (a server component subtree in app/(app)/layout.tsx) while the sheet +
// mobile Fab (quick-add.tsx) are mounted outside it, so the two sides meet through
// context instead of prop-threading through a server boundary.
const QuickAddOpenContext = createContext<{
  open: boolean;
  setOpen: (open: boolean) => void;
} | null>(null);

export function QuickAddProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <QuickAddOpenContext.Provider value={{ open, setOpen }}>
      {children}
    </QuickAddOpenContext.Provider>
  );
}

export function useQuickAddOpen() {
  const ctx = useContext(QuickAddOpenContext);
  if (!ctx) throw new Error('useQuickAddOpen must be used within QuickAddProvider');
  return ctx;
}

// Desktop sidebar trigger. Label "New entry" deliberately shares no substring with the
// many pre-existing "Add"/"Add item"/"Add goal" submit buttons — Playwright's role-name
// matching is substring-based, and several E2E specs disambiguate those positionally.
export function NewEntryButton() {
  const { setOpen } = useQuickAddOpen();
  return (
    <Button type="button" size="sm" className="w-full gap-1.5" onClick={() => setOpen(true)}>
      <Plus className="size-4" />
      New entry
    </Button>
  );
}
