'use client';

/**
 * Champ « write-only » de la clé API Resend.
 *
 * La valeur n'est JAMAIS chargée depuis le serveur (le GET /api/settings ne
 * renvoie qu'un booléen `resendApiKeyConfigured`). On affiche donc un statut
 * (« configurée » / « absente ») + une saisie pour POSER une nouvelle clé ou
 * la RETIRER. La saisie part en PUT { resendApiKey } et n'est jamais réaffichée.
 */

import { useState } from 'react';

export type ResendKeyManagerProps = {
  configured: boolean;
  /** Pose (`key`) ou efface (`''`) la clé. */
  onSave: (key: string) => void;
};

export function ResendKeyManager({ configured, onSave }: ResendKeyManagerProps) {
  // En saisie d'emblée si aucune clé n'est encore posée.
  const [editing, setEditing] = useState(!configured);
  const [value, setValue] = useState('');

  const submit = () => {
    const trimmed = value.trim();
    if (trimmed.length === 0) return;
    onSave(trimmed);
    setValue('');
    setEditing(false);
  };

  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-4 rounded-lg border border-stone-200 bg-white px-4 py-3">
        <p className="font-body text-[13px] text-stone-700">
          {configured ? (
            <>
              <span className="font-semibold text-emerald-700">
                ✓ Clé configurée
              </span>{' '}
              — masquée pour sécurité (jamais réaffichée).
            </>
          ) : (
            <span className="font-semibold text-stone-500">
              Aucune clé enregistrée.
            </span>
          )}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="px-3 py-1.5 rounded-lg text-[12px] font-body font-semibold border border-stone-300 bg-white text-stone-700 hover:bg-stone-50"
          >
            {configured ? 'Remplacer' : 'Ajouter une clé'}
          </button>
          {configured ? (
            <button
              type="button"
              onClick={() => onSave('')}
              className="px-3 py-1.5 rounded-lg text-[12px] font-body font-semibold border border-rose-300 bg-white text-rose-700 hover:bg-rose-50"
            >
              Retirer
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-stone-200 bg-white px-4 py-3">
      <label className="font-body text-[12px] font-semibold text-stone-600">
        Clé API Resend (commence par <code className="font-mono">re_</code>)
      </label>
      <div className="flex gap-2">
        <input
          type="password"
          value={value}
          autoComplete="off"
          placeholder="re_xxxxxxxxxxxxxxxx"
          onChange={(e) => setValue(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          className="flex-1 min-w-0 rounded-lg border border-stone-300 px-3 py-2 font-mono text-[13px] outline-none focus:border-blue-400"
        />
        <button
          type="button"
          onClick={submit}
          disabled={value.trim().length === 0}
          className="px-3 py-2 rounded-lg text-[12px] font-body font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Enregistrer la clé
        </button>
        {configured ? (
          <button
            type="button"
            onClick={() => {
              setValue('');
              setEditing(false);
            }}
            className="px-3 py-2 rounded-lg text-[12px] font-body font-semibold border border-stone-300 bg-white text-stone-600 hover:bg-stone-50"
          >
            Annuler
          </button>
        ) : null}
      </div>
      <p className="font-body text-[11px] text-stone-500">
        Stockée côté serveur, jamais renvoyée au navigateur. Repli sur la
        variable d&apos;env <code className="font-mono">RESEND_API_KEY</code> si
        vide. L&apos;expéditeur doit appartenir à un domaine vérifié chez Resend.
      </p>
    </div>
  );
}
