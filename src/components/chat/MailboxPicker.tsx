'use client';

import { Inbox, Settings, CheckCircle2 } from 'lucide-react';

import { cn } from '@/lib/utils';

export type MailboxPickerProps = {
  campaignId: string;
  mailboxes: ReadonlyArray<{ id: string; label: string; email: string }>;
  selectedMailboxId: string | null;
  disabled?: boolean;
  onPick: (campaignId: string, mailboxId: string) => void;
};

/**
 * Picker de boîte mail à associer à la campagne courante (Session 5
 * round 5). Affiché après que le DRH a activé `email` dans le
 * sources-picker. Single-select : une association par cycle ; le DRH
 * peut en ajouter d'autres via la page settings.
 *
 * Si aucune mailbox n'est configurée, le bloc affiche un CTA vers
 * /settings/mailboxes (ouvert en nouvel onglet pour ne pas casser le
 * fil du chat).
 */
export function MailboxPicker({
  campaignId,
  mailboxes,
  selectedMailboxId,
  disabled = false,
  onPick,
}: MailboxPickerProps) {
  const locked = disabled || selectedMailboxId !== null;

  if (mailboxes.length === 0) {
    return (
      <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
        <div className="flex items-start gap-2.5">
          <span className="h-7 w-7 grid place-items-center rounded-lg bg-amber-100 text-amber-700 shrink-0">
            <Inbox className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display font-semibold text-[13px] text-amber-900">
              Aucune boîte mail configurée
            </p>
            <p className="font-body text-[12px] text-amber-800/80 mt-0.5 leading-snug">
              Pour activer la réception automatique, configure une boîte
              IMAP. L&apos;association à la campagne reste à faire ensuite.
            </p>
            <a
              href="/settings/mailboxes"
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                'mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md',
                'bg-amber-600 text-white font-display text-[12px] font-semibold',
                'hover:bg-amber-700 transition-colors',
              )}
            >
              <Settings className="h-3 w-3" />
              Configurer une boîte mail
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2 grid gap-1.5">
      <p className="font-body text-[11px] text-stone-500 mb-1">
        Choisis la boîte qui recevra les CVs pour {campaignId}. Les
        emails contenant l&apos;ID de campagne dans l&apos;objet seront
        analysés automatiquement.
      </p>
      {mailboxes.map((mb) => {
        const isSelected = selectedMailboxId === mb.id;
        return (
          <button
            key={mb.id}
            type="button"
            disabled={locked}
            onClick={() => !locked && onPick(campaignId, mb.id)}
            className={cn(
              'group w-full flex items-center gap-3 rounded-xl border px-3 py-2.5',
              'transition-all text-left',
              !locked
                ? 'border-stone-200 bg-white hover:border-stone-400 hover:shadow-sm'
                : 'border-stone-200 bg-stone-50/60 cursor-not-allowed',
              isSelected && 'border-emerald-400 bg-emerald-50',
            )}
          >
            <span
              className={cn(
                'h-8 w-8 grid place-items-center rounded-lg shrink-0',
                isSelected
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-stone-100 text-stone-700 group-hover:bg-stone-200',
              )}
            >
              <Inbox className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="font-display font-semibold text-[13px] text-stone-900 block">
                {mb.label}
              </span>
              <span className="font-body text-[11.5px] text-stone-500 block truncate">
                {mb.email}
              </span>
            </span>
            {isSelected ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            ) : null}
          </button>
        );
      })}
      <a
        href="/settings/mailboxes"
        target="_blank"
        rel="noopener noreferrer"
        className="font-body text-[11.5px] text-stone-500 hover:text-stone-900 mt-1 inline-flex items-center gap-1"
      >
        <Settings className="h-3 w-3" />
        Ajouter une nouvelle boîte
      </a>
    </div>
  );
}
