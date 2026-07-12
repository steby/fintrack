// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { useAction } from './use-action';

// This is the only test.tsx file in the repo (see vitest.config.ts's "unit" project,
// which otherwise runs entirely in the 'node' environment for pure lib/** logic) — the
// `@vitest-environment jsdom` docblock above scopes a DOM environment to just this
// file, via @testing-library/react + jsdom (added as devDependencies for this test),
// rather than switching the whole "unit" project's environment.
type TestState = { value: string } | undefined;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// A minimal harness component — useAction is a hook, so it needs a component to run
// inside. Exposes `pending` as text (readable without extra matcher libraries) and a
// button that calls `run` with a fixed FormData, handing whatever `onSettled` the test
// provided down to the hook untouched.
function Harness({
  action,
  onSettled,
}: {
  action: (prevState: TestState, formData: FormData) => Promise<TestState>;
  onSettled: (result: TestState) => void;
}) {
  const { pending, run } = useAction(action);
  return (
    <div>
      <span data-testid="pending">{pending ? 'pending' : 'idle'}</span>
      <button
        onClick={() => {
          const formData = new FormData();
          formData.set('trigger', 'yes');
          run(formData, onSettled);
        }}
      >
        Go
      </button>
    </div>
  );
}

afterEach(() => {
  cleanup();
});

describe('useAction', () => {
  it('calls the action with the FormData passed to run', async () => {
    const action = vi.fn<(prevState: TestState, formData: FormData) => Promise<TestState>>(
      async () => ({ value: 'ok' }) as TestState,
    );
    render(<Harness action={action} onSettled={vi.fn()} />);

    await act(async () => {
      screen.getByText('Go').click();
    });

    expect(action).toHaveBeenCalledTimes(1);
    const [prevState, formData] = action.mock.calls[0];
    expect(prevState).toBeUndefined();
    expect(formData.get('trigger')).toBe('yes');
  });

  it('hands onSettled the actual result the action resolved with', async () => {
    const action = vi.fn(async () => ({ value: 'settled-result' }) as TestState);
    const onSettled = vi.fn();
    render(<Harness action={action} onSettled={onSettled} />);

    await act(async () => {
      screen.getByText('Go').click();
    });

    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledWith({ value: 'settled-result' });
  });

  it('is pending while the action is in flight and settles back to false once it resolves', async () => {
    const { promise, resolve } = deferred<TestState>();
    const action = vi.fn(() => promise);
    const onSettled = vi.fn();
    render(<Harness action={action} onSettled={onSettled} />);

    expect(screen.getByTestId('pending').textContent).toBe('idle');

    // Not wrapped in `act(async ...)` — the action's promise is still unsettled at
    // this point, so awaiting the click itself would hang. A plain (sync) act() only
    // flushes the synchronous "transition started" state update.
    act(() => {
      screen.getByText('Go').click();
    });
    expect(screen.getByTestId('pending').textContent).toBe('pending');
    expect(onSettled).not.toHaveBeenCalled();

    await act(async () => {
      resolve({ value: 'done' });
      await promise;
    });

    expect(screen.getByTestId('pending').textContent).toBe('idle');
    expect(onSettled).toHaveBeenCalledWith({ value: 'done' });
  });

  it('supports calling run again after a prior call has already settled', async () => {
    const action = vi.fn(
      async (_prev: TestState, formData: FormData) =>
        ({ value: String(formData.get('trigger')) }) as TestState,
    );
    const onSettled = vi.fn();
    render(<Harness action={action} onSettled={onSettled} />);

    await act(async () => {
      screen.getByText('Go').click();
    });
    expect(screen.getByTestId('pending').textContent).toBe('idle');

    await act(async () => {
      screen.getByText('Go').click();
    });

    expect(action).toHaveBeenCalledTimes(2);
    expect(onSettled).toHaveBeenCalledTimes(2);
    expect(onSettled).toHaveBeenNthCalledWith(1, { value: 'yes' });
    expect(onSettled).toHaveBeenNthCalledWith(2, { value: 'yes' });
    expect(screen.getByTestId('pending').textContent).toBe('idle');
  });
});
