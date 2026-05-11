'use client';

import { Download, ExternalLink, FileText } from 'lucide-react';

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
  // S'abonne au store par id pour re-render quand `publicUrl` arrive
  // après l'upload Supabase Storage (round 3).
  const artifact = useArtifactsStore((s) => s.byId[attachment.artifactId]);
  const publicUrl = artifact?.publicUrl ?? null;
  const hasContent = Boolean(artifact?.content);

  function handleOpen() {
    if (!publicUrl) return;
    window.open(publicUrl, '_blank', 'noopener,noreferrer');
  }

  function handleDownload() {
    if (!artifact) return;
    downloadArtifact(artifact);
  }

  // Action principale = ouvrir le fichier hébergé si dispo (effet
  // « livrable client visible côté Storage »), sinon download local.
  const primaryAction = publicUrl ? handleOpen : handleDownload;
  const showSecondaryDownload = Boolean(publicUrl && hasContent);

  return (
    <div
      className={cn(
        'mt-2 inline-flex items-center gap-1.5 max-w-full',
        'rounded-xl border border-stone-200 bg-white pl-2.5 pr-1.5 py-2',
        'transition-all hover:border-stone-400 hover:shadow-sm',
        disabled && 'opacity-50 pointer-events-none',
      )}
    >
      <button
        type="button"
        onClick={primaryAction}
        disabled={disabled || (!publicUrl && !hasContent)}
        className="flex items-center gap-2.5 min-w-0 flex-1 text-left disabled:cursor-not-allowed"
        title={publicUrl ? 'Ouvrir le fichier' : 'Télécharger le fichier'}
      >
        <span className="h-8 w-8 grid place-items-center rounded-lg bg-amber-100 text-amber-700 shrink-0">
          <FileText className="h-4 w-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="font-display font-semibold text-[12px] text-stone-900 block truncate">
            {attachment.label}
          </span>
          <span className="font-body text-[10.5px] text-stone-500 block truncate">
            {attachment.fileName}
            {publicUrl ? (
              <span className="ml-1.5 text-stone-400">· hébergé</span>
            ) : null}
          </span>
        </span>
        <span className="h-7 w-7 grid place-items-center rounded-lg bg-stone-100 text-stone-600 shrink-0">
          {publicUrl ? (
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Download className="h-3.5 w-3.5" aria-hidden />
          )}
        </span>
      </button>
      {showSecondaryDownload ? (
        <button
          type="button"
          onClick={handleDownload}
          disabled={disabled}
          title="Télécharger une copie locale"
          className={cn(
            'h-7 w-7 grid place-items-center rounded-lg shrink-0',
            'text-stone-500 hover:text-stone-900 hover:bg-stone-100',
            'transition-colors',
          )}
        >
          <Download className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
