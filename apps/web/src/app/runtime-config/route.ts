import { NextResponse } from 'next/server';

import { getPublicApiUrl } from '@/lib/public-env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Runtime PUBLIC_API_URL for the browser (not baked at next build). */
export function GET(): NextResponse {
  return NextResponse.json(
    { apiUrl: getPublicApiUrl() },
    {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    },
  );
}
