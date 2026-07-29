'use client';

import Image from 'next/image';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';

/** Cache-bust so deploys replace previously cached opaque logo assets. */
const LIGHT_SRC = '/branding/logo-horizontal.png?v=20260730';
const DARK_SRC = '/branding/logo-horizontal-dark.png?v=20260730';

/**
 * Light theme → current horizontal logo.
 * Dark theme / always-on-dark surfaces (sidebar) → yellow mark + white wordmark on transparent canvas.
 */
export function BrandLogo({
  variant = 'theme',
  className = 'h-8 w-auto',
  priority = false,
}: {
  /** `theme` follows next-themes; `dark` always uses the on-dark asset. */
  variant?: 'theme' | 'dark' | 'light';
  className?: string;
  priority?: boolean;
}) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  let src = LIGHT_SRC;
  if (variant === 'dark') {
    src = DARK_SRC;
  } else if (variant === 'light') {
    src = LIGHT_SRC;
  } else if (mounted && resolvedTheme === 'dark') {
    src = DARK_SRC;
  }

  return (
    <Image
      src={src}
      alt="fine numbers"
      width={160}
      height={36}
      className={cn('bg-transparent', className)}
      priority={priority}
      unoptimized
    />
  );
}
