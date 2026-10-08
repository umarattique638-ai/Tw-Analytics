import Link from 'next/link';
import type { ReactNode } from 'react';
import { TailwatchProvider } from '@tailwatch/next';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TailwatchProvider siteKey={process.env.NEXT_PUBLIC_TW_KEY ?? ''} api={process.env.NEXT_PUBLIC_TW_API ?? ''}
          allowLocal={process.env.NEXT_PUBLIC_TW_ALLOW_LOCAL === '1'}
        >
          <nav>
            <Link href="/">Home</Link> <Link href="/about">About</Link> <Link href="/blog/hello">Blog</Link>
          </nav>
          {children}
        </TailwatchProvider>
      </body>
    </html>
  );
}
