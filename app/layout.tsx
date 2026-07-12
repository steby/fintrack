import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { ThemeProvider } from '../components/theme-provider';
import { RegisterServiceWorker } from '../components/register-service-worker';
import { ToastProvider } from '../components/ui/toast';
import { TooltipProvider } from '../components/ui/tooltip';
import { env } from '../lib/env';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'FinTrack',
  description: 'Household budget and finance tracker',
  appleWebApp: { title: 'FinTrack', statusBarStyle: 'black-translucent' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Phase 11 PWA refresh: light/dark `media` variants (verified against
  // node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-viewport.md
  // before using this shape — themeColor lives on `viewport`, not `metadata`, and this
  // array form is how it expresses per-scheme colors) replacing the single flat
  // '#000000' left over from spec.md Phase 3's OLED identity. Values are the sRGB
  // rendering of app/globals.css's own `--background` token in each theme (light:
  // oklch(0.975 0.005 90), dark: oklch(0.155 0.012 285)) — this only tracks the OS's
  // `prefers-color-scheme`, not next-themes' own class-driven state (a `meta` tag can't
  // react to that), so a user who overrides the theme via the in-app toggle sees the
  // browser chrome color settle back to whichever the OS prefers on the next paint that
  // re-reads it — a known, harmless mismatch, not a bug to chase further here.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f8f7f3' },
    { media: '(prefers-color-scheme: dark)', color: '#0c0c11' },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
          <TooltipProvider>
            <ToastProvider>{children}</ToastProvider>
          </TooltipProvider>
        </ThemeProvider>
        {env.FEATURE_PWA && <RegisterServiceWorker />}
      </body>
    </html>
  );
}
