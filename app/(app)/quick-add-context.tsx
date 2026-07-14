'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface CategoryOption {
  id: string;
  name: string;
  direction: 'income' | 'expense';
  isSystem: boolean;
}

// Shared state for the global entry UI: the quick-add sheet's open flag (its desktop
// trigger lives INSIDE the sidebar — a server subtree in app/(app)/layout.tsx — while
// the sheet + mobile Fab are mounted outside it), plus the household's category list,
// which the per-row edit-entry sheets (entry-edit-button.tsx) need on EVERY page
// without each page's server component re-fetching and re-threading it.
const QuickAddOpenContext = createContext<{
  open: boolean;
  setOpen: (open: boolean) => void;
  categories: CategoryOption[];
} | null>(null);

export function QuickAddProvider({
  categories,
  children,
}: {
  categories: CategoryOption[];
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <QuickAddOpenContext.Provider value={{ open, setOpen, categories }}>
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
