import Link from 'next/link';
import { CalendarClock, CheckCircle2, Circle, ArrowRight } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';

interface Step {
  label: string;
  detail: string;
  href: string;
  done: boolean;
}

// Guided first-run checklist (full app review finding #9: a brand-new household got a
// single "Set up your plan" CTA and was dropped cold onto the full Plan page). Each
// step reflects REAL state — the checkmarks come from row counts, not a stored
// "wizard progress" flag, so it can never disagree with the data or nag after manual
// setup. Only rendered by Home's zero-candidates branch (an in-use household never
// sees it), so the extra count queries never run on the hot path.
export function OnboardingChecklist({
  accountCount,
  categoryCount,
  recurringCount,
  canManage,
}: {
  accountCount: number;
  categoryCount: number;
  recurringCount: number;
  canManage: boolean;
}) {
  const steps: Step[] = [
    {
      label: 'Add your bank accounts',
      detail: 'Balances make the cash forecast and net worth real.',
      href: '/settings/categories',
      done: accountCount > 0,
    },
    {
      label: 'Review spending categories',
      detail: 'A starter set is included — rename or trim to fit.',
      href: '/settings/categories',
      done: categoryCount > 0,
    },
    {
      label: 'Add recurring bills & income',
      detail: 'Salary, rent, subscriptions — the backbone of the forecast.',
      href: '/recurring',
      done: recurringCount > 0,
    },
    {
      label: 'Generate your first forecast',
      detail: 'Turns the plan into monthly entries Home can work with.',
      href: '/recurring',
      // This card only renders when there are zero entries, so this step is by
      // definition the one still open once the others are done.
      done: false,
    },
  ];

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="size-5 text-muted-foreground" aria-hidden />
          Nothing on the books yet
        </CardTitle>
        <CardDescription>
          {canManage
            ? 'Four short steps and Home can start answering "can I cover what\'s coming?"'
            : 'Ask someone with edit access to finish setting up the household.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col gap-2">
          {steps.map((step) => (
            <li key={step.label}>
              {canManage && !step.done ? (
                <Link
                  href={step.href}
                  className="group flex items-start gap-2.5 rounded-lg border border-border/60 px-3 py-2 hover:bg-muted/50"
                >
                  <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{step.label}</span>
                    <span className="block text-xs text-muted-foreground">{step.detail}</span>
                  </span>
                  <ArrowRight
                    className="mt-1 size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                    aria-hidden
                  />
                </Link>
              ) : (
                <div className="flex items-start gap-2.5 rounded-lg border border-border/40 px-3 py-2 opacity-70">
                  {step.done ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-income" aria-hidden />
                  ) : (
                    <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{step.label}</span>
                    <span className="block text-xs text-muted-foreground">{step.detail}</span>
                  </span>
                </div>
              )}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
