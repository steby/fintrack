import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';

import { cn } from '@/lib/utils';

const Tabs = TabsPrimitive.Root;

function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        'relative inline-flex h-9 items-center gap-1 rounded-lg bg-muted p-1 text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

function TabsTab({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-tab"
      className={cn(
        'relative z-10 inline-flex h-7 items-center justify-center rounded-md px-3 text-sm font-medium whitespace-nowrap outline-none transition-colors data-active:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50',
        className,
      )}
      {...props}
    />
  );
}

// Animated highlight — lives INSIDE Tabs.List (a Base UI/Radix difference worth
// flagging, per the plan's WISDOM note), positioned via Base UI's own
// --active-tab-width/--active-tab-left CSS variables rather than manual measurement.
function TabsIndicator({ className, ...props }: TabsPrimitive.Indicator.Props) {
  return (
    <TabsPrimitive.Indicator
      data-slot="tabs-indicator"
      className={cn(
        'absolute top-1 left-0 -z-0 h-7 w-(--active-tab-width) translate-x-(--active-tab-left) rounded-md bg-card shadow-sm transition-[translate,width] duration-200',
        className,
      )}
      {...props}
    />
  );
}

function TabsPanel({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-panel"
      className={cn('outline-none', className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTab, TabsIndicator, TabsPanel };
