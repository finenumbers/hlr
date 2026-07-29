import type { Metadata } from 'next';
import { IBM_Plex_Sans, Source_Serif_4 } from 'next/font/google';
import type { ReactElement, ReactNode } from 'react';

import { Providers } from '@/app/providers';
import { getPublicRuntimeEnv } from '@/lib/public-env';

import './globals.css';

export const dynamic = 'force-dynamic';

const sans = IBM_Plex_Sans({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
});

const display = Source_Serif_4({
  subsets: ['latin', 'cyrillic'],
  weight: ['500', '600', '700'],
  variable: '--font-display',
});

export const metadata: Metadata = {
  title: 'Finenumbers HLR Lookup Service',
  description: 'Admin panel and client cabinet for HLR / Ping-SMS checks',
  icons: {
    icon: '/favicon.png',
  },
};

export default function RootLayout({ children }: { children: ReactNode }): ReactElement {
  const publicEnv = getPublicRuntimeEnv();

  return (
    <html lang="en" suppressHydrationWarning className={`${sans.variable} ${display.variable}`}>
      <body className="font-sans antialiased">
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__FN_PUBLIC__=${JSON.stringify(publicEnv)};`,
          }}
        />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
