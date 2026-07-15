'use client';

// A full-page load back to Home — client-side routing can't recover while offline;
// assigning location.href forces the real network navigation "try again" means.
export function OfflineRetryButton() {
  return (
    <button
      type="button"
      onClick={() => {
        window.location.href = '/';
      }}
      className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
    >
      Try again
    </button>
  );
}
