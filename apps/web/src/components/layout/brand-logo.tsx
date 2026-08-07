'use client';

import Image from 'next/image';

import { cn } from '@/lib/utils';

/** Cache-bust so deploys replace previously cached opaque logo assets. */
const LIGHT_SRC = '/branding/logo-horizontal.png?v=20260730';
const DARK_SRC = '/branding/logo-horizontal-dark.png?v=20260730';

/**
 * `light` — horizontal logo for light surfaces (login).
 * `dark` — yellow mark + white wordmark for the always-dark sidebar.
 */
export function BrandLogo({
  variant = 'light',
  className = 'h-[2.16rem] w-auto',
  priority = false,
}: {
  variant?: 'dark' | 'light';
  className?: string;
  priority?: boolean;
}) {
  const src = variant === 'dark' ? DARK_SRC : LIGHT_SRC;

  return (
    <Image
      src={src}
      alt="fine numbers"
      width={192}
      height={43}
      className={cn('bg-transparent', className)}
      priority={priority}
      unoptimized
    />
  );
}
