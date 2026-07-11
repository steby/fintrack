import Link from 'next/link';
import type { ComponentType } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type EmptyStateAction = { label: string } & (
  { href: string; onClick?: never } | { onClick: () => void; href?: never }
);

interface EmptyStateProps {
  icon?: ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: EmptyStateAction;
  className?: string;
}

// Shared "nothing here yet" surface — icon + title + optional description + optional
// single CTA (a Link for navigation, or a click handler for an in-place action, never
// both). Phase 8 gives this its first real use on /accounts (FEATURE_NET_WORTH off);
// spec.md Phase 11 adopts it on every other list surface (recurring, goals, categories,
// members-invites, monthly) — not done yet here, deliberately, per that phase's own scope.
function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        'flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border py-12 text-center',
        className,
      )}
    >
      {Icon && <Icon className="size-8 text-muted-foreground" aria-hidden />}
      <div className="text-sm font-semibold">{title}</div>
      {description && (
        <p className="max-w-sm text-sm text-balance text-muted-foreground">{description}</p>
      )}
      {action &&
        (action.href ? (
          // nativeButton={false}: the render element is an <a> (next/link), not a real
          // <button> — Base UI's Button warns (and, in dev, trips the dev overlay) if
          // nativeButton stays true while rendering a non-button element.
          <Button
            size="sm"
            className="mt-2"
            nativeButton={false}
            render={<Link href={action.href} />}
          >
            {action.label}
          </Button>
        ) : (
          <Button type="button" size="sm" className="mt-2" onClick={action.onClick}>
            {action.label}
          </Button>
        ))}
    </div>
  );
}

export { EmptyState };
