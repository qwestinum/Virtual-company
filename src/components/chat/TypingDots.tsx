'use client';

import type { CSSProperties } from 'react';

import { cn } from '@/lib/utils';

export type TypingDotsProps = {
  className?: string;
  /** Couleur des points (override le bg par défaut). */
  color?: string;
};

export function TypingDots({ className, color }: TypingDotsProps) {
  const dotStyle: CSSProperties | undefined = color
    ? { backgroundColor: color }
    : undefined;
  const dotClass = color ? '' : 'bg-stone-500';

  return (
    <span
      role="status"
      aria-label="Manager en train d’écrire"
      className={cn('inline-flex items-end gap-1 leading-none', className)}
    >
      <span
        className={cn('typing-dot h-1.5 w-1.5 rounded-full', dotClass)}
        style={dotStyle}
      />
      <span
        className={cn('typing-dot h-1.5 w-1.5 rounded-full', dotClass)}
        style={dotStyle}
      />
      <span
        className={cn('typing-dot h-1.5 w-1.5 rounded-full', dotClass)}
        style={dotStyle}
      />
    </span>
  );
}
