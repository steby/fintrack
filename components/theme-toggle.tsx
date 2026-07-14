'use client';

import { useSyncExternalStore } from 'react';
import { useTheme } from 'next-themes';
import { Moon, Sun, Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToastManager } from '@/components/ui/toast';
import { nextTheme } from '@/lib/theme';

// Never fires — this only exists to give useSyncExternalStore a snapshot that differs
// between server (false) and client (true) render, the standard hydration-safe way to
// know "has this component mounted on the client yet" without calling setState inside
// an effect (which react-hooks/set-state-in-effect correctly flags as cascading-render-prone).
function subscribeNever() {
  return () => {};
}

function useHasMounted(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

// Cycles light → dark → system (lib/theme.ts). Icon shows the CURRENT preference —
// Monitor for "system" rather than the resolved sun/moon, so following the OS is
// visually distinct from an explicit choice.
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  // next-themes can't know the persisted/system theme until after hydration — rendering
  // a theme-dependent icon before then would mismatch the server-rendered markup.
  // Rendering a stable placeholder until mounted avoids that hydration warning class.
  const mounted = useHasMounted();
  const toastManager = useToastManager();

  function toggle() {
    const next = nextTheme(theme);
    setTheme(next);
    toastManager.add({
      title: next === 'system' ? 'Theme: follow system' : `Theme: ${next}`,
      timeout: 2000,
    });
  }

  const icon = !mounted || theme === 'dark' ? <Moon /> : theme === 'system' ? <Monitor /> : <Sun />;

  return (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      aria-label="Toggle theme"
      data-testid="theme-toggle"
      onClick={toggle}
    >
      {icon}
    </Button>
  );
}
