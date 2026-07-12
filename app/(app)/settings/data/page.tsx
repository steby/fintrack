import Link from 'next/link';
import { requireUser } from '../../../../lib/auth/guards';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';

// Export is mandatory (spec.md Feature Matrix), not behind csv_import's kill-switch —
// that flag gates the bulk-write side of Phase 5, export is read-only and every role
// already has read access to this same data everywhere else in the app.
export default async function DataSettingsPage() {
  await requireUser();

  return (
    <div className="flex max-w-lg flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Data</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Export every entry in this household as a CSV file, or import one.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Export</CardTitle>
        </CardHeader>
        <CardContent>
          <a
            href="/api/export"
            data-testid="export-csv-link"
            className={buttonVariants({ size: 'sm' })}
          >
            Export CSV
          </a>
        </CardContent>
      </Card>
      {/* Import CSV entry (spec.md Phase 11 task 3: "Data page gains an Import entry
          link") — /import itself owns the kill-switch check, the upload/preview/commit
          flow, and its own friendly off/read-only states; this is just the discoverable
          link into it from the page a household is most likely to look for it on. */}
      <Card>
        <CardHeader>
          <CardTitle>Import</CardTitle>
          <CardDescription>
            Upload a bank statement CSV and reconcile it against existing entries.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/import" className={buttonVariants({ size: 'sm', variant: 'outline' })}>
            Import CSV
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
