'use client';

/**
 * Carte d'intégration (flux ou canal de diffusion) (Session 6 v4).
 *
 * Affiche le statut courant (configuré / non), un champ pour saisir le
 * credential (clé API, token, etc.) et un champ optionnel pour des
 * notes libres. Le credential est saisi en clair pour le MVP démo —
 * un cycle ultérieur basculera sur du chiffrement application-level.
 */

import { useState } from 'react';

import type { IntegrationConfig } from './SettingsHub';

export type IntegrationCardProps = {
  label: string;
  hint: string;
  config: IntegrationConfig;
  onSave: (next: IntegrationConfig) => void;
};

export function IntegrationCard({
  label,
  hint,
  config,
  onSave,
}: IntegrationCardProps) {
  const [open, setOpen] = useState(false);
  const [credential, setCredential] = useState(config.credential ?? '');
  const [notes, setNotes] = useState(config.notes ?? '');

  const configured = config.status === 'configured';
  const dirty =
    credential !== (config.credential ?? '') ||
    notes !== (config.notes ?? '');

  const onSubmit = () => {
    const trimmed = credential.trim();
    const next: IntegrationConfig = {
      status: trimmed === '' ? 'unconfigured' : 'configured',
      credential: trimmed === '' ? undefined : trimmed,
      notes: notes.trim() === '' ? undefined : notes.trim(),
    };
    onSave(next);
    setOpen(false);
  };

  const onClear = () => {
    setCredential('');
    setNotes('');
    onSave({ status: 'unconfigured' });
    setOpen(false);
  };

  return (
    <div className="rounded-xl border border-stone-200 bg-stone-50 p-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-[13.5px] font-bold text-stone-900">
            {label}
          </p>
          <p className="font-body text-[11.5px] text-stone-500 truncate">
            {hint}
          </p>
        </div>
        <StatusBadge configured={configured} />
      </div>
      <div className="mt-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-[12px] font-body font-semibold text-blue-600 hover:underline"
        >
          {open
            ? 'Fermer'
            : configured
              ? 'Modifier les identifiants'
              : 'Configurer'}
        </button>
      </div>
      {open ? (
        <div className="mt-3 flex flex-col gap-2">
          <input
            type="text"
            value={credential}
            onChange={(e) => setCredential(e.currentTarget.value)}
            placeholder="API key / token"
            className="px-3 py-2 rounded-lg border border-stone-300 bg-white text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <textarea
            value={notes}
            rows={2}
            onChange={(e) => setNotes(e.currentTarget.value)}
            placeholder="Notes (optionnel)"
            className="px-3 py-2 rounded-lg border border-stone-300 bg-white text-[13px] font-body resize-y focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <div className="flex gap-2 justify-end">
            {configured ? (
              <button
                type="button"
                onClick={onClear}
                className="px-3 py-1.5 rounded-lg text-[12px] font-body font-semibold border border-stone-300 text-stone-600 hover:bg-stone-100"
              >
                Désactiver
              </button>
            ) : null}
            <button
              type="button"
              disabled={!dirty}
              onClick={onSubmit}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-body font-semibold transition ${
                dirty
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-stone-200 text-stone-400 cursor-not-allowed'
              }`}
            >
              Enregistrer
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StatusBadge({ configured }: { configured: boolean }) {
  if (configured) {
    return (
      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[11px] font-body font-semibold">
        <span
          aria-hidden
          className="w-1.5 h-1.5 rounded-full bg-emerald-600"
        />
        Configuré
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-stone-200 text-stone-500 text-[11px] font-body font-semibold">
      <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-stone-400" />
      Non configuré
    </span>
  );
}
