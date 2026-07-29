import type { Metadata } from 'next';
import { IBM_Plex_Sans, Source_Serif_4 } from 'next/font/google';
import type { ReactElement, ReactNode } from 'react';

import { Providers } from '@/app/providers';

import './globals.css';

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
  return (
    <html lang="en" suppressHydrationWarning className={`${sans.variable} ${display.variable}`}>
      <body className="font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
