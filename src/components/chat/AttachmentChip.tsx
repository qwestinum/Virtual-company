'use client';

import { Download, FileText } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  downloadArtifact,
  useArtifactsStore,
} from '@/stores/artifacts-store';
import type { ChatAttachment } from '@/stores/chat-store';

export type AttachmentChipProps = {
  attachment: ChatAttachment;
  disabled?: boolean;
};

export function AttachmentChip({ attachment, disabled }: AttachmentChipProps) {
  const getArtifact = useArtifactsStore((s) => s.getArtifact);

  function handleDownload() {
    const artifact = getArtifact(attachment.artifactId);
    if (!artifact) return;
    downloadArtifact(artifact);
  }

  return (
    <button
      type="button"
      onClick={handleDownload}
      disabled={disabled}
      className={cn(
        'mt-2 inline-flex items-center gap-2.5 max-w-full',
        'rounded-xl border border-stone-200 bg-white pl-2.5 pr-3 py-2',
        'transition-all hover:border-stone-400 hover:shadow-sm',
        'disabled:opacity-50 disabled:pointer-events-none',
      )}
    >
      <span className="h-8 w-8 grid place-items-center rounded-lg bg-amber-100 text-amber-700 shrink-0">
        <FileText className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="font-display font-semibold text-[12px] text-stone-900 block truncate">
          {attachment.label}
        </span>
        <span className="font-body text-[10.5px] text-stone-500 block truncate">
          {attachment.fileName}
        </span>
      </span>
      <span className="h-7 w-7 grid place-items-center rounded-lg bg-stone-100 text-stone-600 shrink-0">
        <Download className="h-3.5 w-3.5" aria-hidden />
      </span>
    </button>
  );
}
