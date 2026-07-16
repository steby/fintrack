import { Upload } from 'lucide-react';
import { requireUser } from '../../../lib/auth/guards';
import { can } from '../../../lib/auth/rbac';
import { isEnabled } from '../../../lib/flags';
import { InlineNote } from '@/components/ui/inline-note';
import { ImportForm } from './import-form';
import { CsvImportToggle } from './csv-import-toggle';

export default async function ImportPage() {
  const user = await requireUser();
  const enabled = await isEnabled(user.householdId, 'csv_import');

  // csv_import is a kill-switch (runtime-toggleable per household, default off) —
  // unlike Phase 4's env-var flags, this can be turned on without a redeploy, so the
  // nav link always shows (see app/(app)/layout.tsx) and this page is where a member
  // discovers the feature exists and an owner can enable it right here, rather than a
  // separate settings detour.
  if (!enabled) {
    return (
      <div className="flex max-w-lg flex-col gap-3">
        <h1 className="text-2xl font-semibold">Import</h1>
        <InlineNote icon={Upload}>
          CSV import is not enabled for this household.
          {can(user.role, 'manage_settings')
            ? ' Enabling it lets any member with edit access upload a CSV and reconcile it against existing entries.'
            : ' Ask an owner to enable it in order to import transactions from a CSV file.'}
        </InlineNote>
        {can(user.role, 'manage_settings') && <CsvImportToggle enabled={false} />}
      </div>
    );
  }

  // Viewers are read-only everywhere (spec.md: "Primary usage: owner does all data
  // entry; family mostly views") — previewImportAction/commitImportAction already
  // reject a viewer server-side via requireRole('write'), but showing the full upload
  // form only to have "Confirm import" fail with an uncaught ForbiddenError (Next's
  // generic error boundary, not a friendly message) is the wrong UX. Same pattern as
  // goals/page.tsx and settings/categories/page.tsx: hide the write-only form itself.
  if (!can(user.role, 'write')) {
    return (
      <div className="flex max-w-lg flex-col gap-3">
        <h1 className="text-2xl font-semibold">Import</h1>
        <p className="text-sm text-muted-foreground">
          You have read-only access. Ask a household member with edit access to import a CSV file.
        </p>
      </div>
    );
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Import</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload a CSV, map its columns, and review matches before anything is saved.
          </p>
        </div>
        {/* Owners get the off-switch right where the feature lives, so turning CSV import
            back off never requires hunting through settings. */}
        {can(user.role, 'manage_settings') && <CsvImportToggle enabled={true} />}
      </div>
      <ImportForm />
    </div>
  );
}
