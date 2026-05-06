'use client';

import { ChevronRight, Sparkles } from 'lucide-react';
import { useState } from 'react';

import { ChatPanel } from '@/components/chat/ChatPanel';
import { cn } from '@/lib/utils';

const PANEL_WIDTH = 'w-[440px] max-w-[92vw]';
const RAIL_WIDTH = 'w-14';

export function ChatDock() {
  const [open, setOpen] = useState(true);

  return (
    <aside
      className={cn(
        'relative h-full shrink-0 overflow-hidden transition-[width] duration-300 ease-out',
        open ? PANEL_WIDTH : RAIL_WIDTH,
      )}
    >
      <div
        className={cn(
          'h-full transition-opacity duration-200',
          open ? 'opacity-100' : 'opacity-0 pointer-events-none',
        )}
      >
        <ChatPanel open={open} onClose={() => setOpen(false)} />
      </div>

      {!open ? <RailToggle onOpen={() => setOpen(true)} /> : null}
    </aside>
  );
}

function RailToggle({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center gap-3 py-4 border-l border-stone-200 bg-stone-50/80 backdrop-blur">
      <button
        type="button"
        onClick={onOpen}
        aria-label="Ouvrir la conversation avec le Manager RH"
        className={cn(
          'group relative h-10 w-10 grid place-items-center rounded-full',
          'bg-stone-900 text-stone-50 shadow-md',
          'hover:scale-105 hover:shadow-lg transition-all',
        )}
      >
        <Sparkles className="h-4 w-4" aria-hidden />
        <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-400 ring-2 ring-stone-50" />
      </button>
      <div className="font-display text-[10px] uppercase tracking-[0.2em] text-stone-500 [writing-mode:vertical-rl] rotate-180">
        Manager&nbsp;RH
      </div>
      <button
        type="button"
        onClick={onOpen}
        aria-hidden
        tabIndex={-1}
        className="mt-auto h-7 w-7 grid place-items-center rounded-full bg-white border border-stone-200 text-stone-500 hover:text-stone-900 hover:border-stone-300"
      >
        <ChevronRight className="h-3.5 w-3.5 rotate-180" />
      </button>
    </div>
  );
}
