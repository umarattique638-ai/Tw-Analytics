'use client';
/**
 * Next.js adapter (App Router and Pages Router). Same component as @tailwatch/react, marked as a
 * client module so it can sit in a server `app/layout.tsx`:
 *
 *   import { TailwatchProvider } from '@tailwatch/next';
 *   <body>
 *     <TailwatchProvider siteKey={process.env.NEXT_PUBLIC_TW_KEY!} api={process.env.NEXT_PUBLIC_TW_API!}>
 *       {children}
 *     </TailwatchProvider>
 *   </body>
 *
 * Client navigations (next/link, router.push) are history pushes, which core already sees through the
 * Navigation API (or the pushState patch). Nothing Next-specific is needed for exactly-one-per-navigation.
 */
export { TailwatchProvider, useTailwatch } from '@tailwatch/react';
export type { Api, Consent, Options, PageOptions, Props, TailwatchProps } from '@tailwatch/react';
