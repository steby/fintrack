import { Progress as ProgressPrimitive } from '@base-ui/react/progress';

import { cn } from '@/lib/utils';

// `value` is required by Base UI's Progress.Root (null = indeterminate) — callers pass
// a clamped 0-100 number; this wrapper doesn't clamp for them, matching the primitive's
// own contract (goal/budget progress math lives in lib/domain, not here).
function Progress({
  className,
  value,
  indicatorClassName,
  ...props
}: ProgressPrimitive.Root.Props & { indicatorClassName?: string }) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      className={cn('w-full', className)}
      {...props}
    >
      <ProgressPrimitive.Track
        data-slot="progress-track"
        className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <ProgressPrimitive.Indicator
          data-slot="progress-indicator"
          className={cn(
            'h-full rounded-full bg-primary transition-[width] duration-300 data-indeterminate:animate-pulse',
            indicatorClassName,
          )}
        />
      </ProgressPrimitive.Track>
    </ProgressPrimitive.Root>
  );
}

export { Progress };
