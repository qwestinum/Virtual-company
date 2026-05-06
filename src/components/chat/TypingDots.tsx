'use client';

import { cn } from '@/lib/utils';

export function TypingDots({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Manager en train d’écrire"
      className={cn('inline-flex items-end gap-1 leading-none', className)}
    >
      <span className="typing-dot h-1.5 w-1.5 rounded-full bg-stone-500" />
      <span className="typing-dot h-1.5 w-1.5 rounded-full bg-stone-500" />
      <span className="typing-dot h-1.5 w-1.5 rounded-full bg-stone-500" />
    </span>
  );
}
