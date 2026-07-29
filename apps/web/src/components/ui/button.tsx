import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition disabled:pointer-events-none disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]',
  {
    variants: {
      variant: {
        default: 'bg-[var(--color-accent)] text-white hover:opacity-90',
        secondary:
          'bg-[var(--color-panel-elevated)] border border-[var(--color-line)] text-[var(--color-ink)] hover:bg-[var(--color-accent-soft)]',
        danger: 'bg-[var(--color-danger)] text-white hover:opacity-90',
        ghost: 'hover:bg-[var(--color-accent-soft)] text-[var(--color-ink)]',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-8 px-3 text-xs',
        lg: 'h-11 px-6',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export function Button({
  className,
  variant,
  size,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
