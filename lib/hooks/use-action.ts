'use client';

import { useTransition } from 'react';

// Centralizes the ONE safe way to call a Server Action from a component that might be
// unmounted by that action's own revalidatePath() before a later render/effect could
// observe the result — see app/(app)/home/mark-paid-button.tsx's long comment for the
// full race explanation this hook exists to make structurally impossible to get wrong
// again: a useActionState-bound version of that button was built first and, under real
// E2E verification, its toast never fired, because useActionState's own state update
// and revalidatePath's router refresh can land in the same React commit with no
// intermediate frame where the still-mounted component observes its new state.
//
// Calling the action directly inside startTransition and awaiting it removes the
// dependency on this component surviving to see its own result via a re-render: `run`
// hands the settled result to `onSettled` SYNCHRONOUSLY inside the same awaited
// closure as the action call, regardless of what a subsequent revalidation-driven
// re-render does to this component afterward.
//
// `onSettled`'s logic must never be moved into a useEffect keyed on returned state, and
// this action must never be bound to useActionState instead of called through `run` —
// either change reintroduces the exact race this hook exists to make unreachable.
//
// `action`'s prevState parameter is typed as plain `TState`, not `TState | undefined` —
// every Server Action in this codebase already models its own state type as a union
// that includes `undefined` (e.g. `{ error: string } | { success: true } | undefined`,
// the same shape `useActionState`'s own initial-state convention requires), so TState
// already carries "possibly undefined" itself. Wrapping it in an extra `| undefined`
// here would double up on that and, worse, breaks inference: TypeScript infers TState
// from this parameter by subtracting `undefined` from it, then fails to unify that
// narrower type against the action's actual `Promise<TState>` return (which still
// includes `undefined`). Passing a literal `undefined` as the first argument below is
// exactly what every one of these actions' own state types already allows for.
export function useAction<TState>(
  action: (prevState: TState, formData: FormData) => Promise<TState>,
) {
  const [pending, startTransition] = useTransition();

  function run(formData: FormData, onSettled: (result: TState) => void) {
    startTransition(async () => {
      // Safe: see the comment above — every action passed to this hook models
      // `undefined` as a valid member of its own TState union already.
      const result = await action(undefined as TState, formData);
      onSettled(result);
    });
  }

  return { pending, run } as const;
}
