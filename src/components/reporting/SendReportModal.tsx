'use client';

import { Loader2, Paperclip, Send, X } from 'lucide-react';
import { useState } from 'react';

/**
 * Modale d'envoi GÉNÉRIQUE — brique mutualisée des sous-onglets Reporting
 * (cf. docs/specs/reporting.md §3.5, §5.2). Champs destinataires / sujet /
 * message pré-remplis modifiables, PDF joint, boutons Envoyer / Annuler.
 *
 * Agnostique du type de rapport : elle POST `{ to, subject, message }` vers
 * `sendEndpoint` ; l'appelant fournit l'endpoint et les valeurs par défaut.
 * Si le PDF n'a pas été généré, le serveur le génère avant l'envoi.
 */
export type SendReportModalProps = {
  open: boolean;
  onClose: () => void;
  /** Endpoint POST qui génère + envoie le rapport. */
  sendEndpoint: string;
  /** Nom du PDF joint, affiché en indication. */
  attachmentName: string;
  defaultSubject: string;
  defaultMessage: string;
  onSent?: () => void;
};

export function SendReportModal({
  open,
  onClose,
  sendEndpoint,
  attachmentName,
  defaultSubject,
  defaultMessage,
  onSent,
}: SendReportModalProps) {
  // État initialisé depuis les props. Le parent remonte la modale via un
  // `key` lié à l'ouverture (cf. CandidateAuditDetail), ce qui garantit des
  // champs frais à chaque ouverture sans effet de reset.
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState(defaultSubject);
  const [message, setMessage] = useState(defaultMessage);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!open) return null;

  async function send() {
    if (to.trim().length === 0) {
      setError('Indiquez au moins un destinataire.');
      return;
    }
    setSending(true);
    setError(null);
    try {
      const res = await fetch(sendEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, subject, message }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const code = data.error as string | undefined;
        setError(
          code === 'email_not_configured' || code === 'supabase_not_configured'
            ? "Service d'envoi non configuré (clé Resend absente)."
            : (data.message ?? `Échec de l'envoi (HTTP ${res.status}).`),
        );
        return;
      }
      setDone(true);
      onSent?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur réseau.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-stone-900/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-stone-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3">
          <p className="font-display text-[15px] font-bold text-stone-900">
            Envoyer le rapport
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-stone-400 hover:bg-stone-100"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {done ? (
          <div className="px-5 py-8 text-center">
            <p className="font-body text-[14px] font-semibold text-emerald-700">
              Rapport envoyé.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-4 rounded-lg bg-stone-800 px-4 py-1.5 font-body text-[13px] font-semibold text-white hover:bg-stone-700"
            >
              Fermer
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 px-5 py-4">
            <Field
              label="Destinataires"
              value={to}
              onChange={setTo}
              placeholder="prenom.nom@client.fr, dpo@client.fr"
            />
            <Field label="Sujet" value={subject} onChange={setSubject} />
            <label className="flex flex-col gap-1">
              <span className="font-body text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                Message
              </span>
              <textarea
                value={message}
                rows={5}
                onChange={(e) => setMessage(e.currentTarget.value)}
                className="resize-none rounded-md border border-stone-300 bg-white px-2.5 py-1.5 font-body text-[13px] text-stone-800 outline-none focus:border-amber-400"
              />
            </label>
            <div className="flex items-center gap-1.5 rounded-md bg-stone-50 px-3 py-2 font-body text-[12px] text-stone-500">
              <Paperclip className="h-3.5 w-3.5" aria-hidden />
              <span className="truncate">{attachmentName}</span>
            </div>
            {error ? (
              <p className="font-body text-[12px] text-rose-600">{error}</p>
            ) : null}
            <div className="mt-1 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-3 py-1.5 font-body text-[13px] font-semibold text-stone-600 hover:bg-stone-100"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={send}
                disabled={sending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-1.5 font-body text-[13px] font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
              >
                {sending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Send className="h-3.5 w-3.5" aria-hidden />
                )}
                Envoyer
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-body text-[11px] font-semibold uppercase tracking-wide text-stone-500">
        {label}
      </span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.currentTarget.value)}
        className="rounded-md border border-stone-300 bg-white px-2.5 py-1.5 font-body text-[13px] text-stone-800 outline-none focus:border-amber-400"
      />
    </label>
  );
}
