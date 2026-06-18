'use client';

/**
 * Liste éditable d'adresses email avec CHOIX MULTIPLE (cases à cocher).
 * Juin 2026 — pour les adresses de synthèse : le briefing d'entretien ne part
 * qu'aux adresses COCHÉES, pas à toute la liste.
 *
 * Pattern :
 *   - liste des adresses, chacune avec une case à cocher « destinataire » et
 *     un bouton de suppression ;
 *   - input + bouton « Ajouter » en bas ; une adresse ajoutée est cochée
 *     d'office (on l'ajoute pour s'en servir) ;
 *   - chaque action écrit immédiatement via le parent (qui PUT /api/settings).
 *
 * Distinct de `EmailListField` (radio = une seule adresse par défaut), réservé
 * aux cas où une seule valeur a du sens (expéditeur).
 */

import { useState } from 'react';

export type EmailMultiSelectFieldProps = {
  /** Toutes les adresses enregistrées. */
  addresses: string[];
  /** Sous-ensemble coché = destinataires réels. */
  checked: string[];
  /** Sauvegarde la nouvelle liste + le nouveau sous-ensemble coché. */
  onChange: (next: { addresses: string[]; checked: string[] }) => void;
  emptyHint: string;
  inputPlaceholder: string;
};

export function EmailMultiSelectField({
  addresses: rawAddresses,
  checked: rawChecked,
  onChange,
  emptyHint,
  inputPlaceholder,
}: EmailMultiSelectFieldProps) {
  const addresses = Array.isArray(rawAddresses) ? rawAddresses : [];
  const checked = Array.isArray(rawChecked) ? rawChecked : [];
  const [draft, setDraft] = useState('');
  const [recentRow, setRecentRow] = useState<string | null>(null);

  const flash = (email: string) => {
    setRecentRow(email);
    window.setTimeout(() => setRecentRow(null), 1600);
  };

  const isValidEmail = (s: string) => /.+@.+\..+/.test(s);

  const addAddress = () => {
    const trimmed = draft.trim();
    if (!isValidEmail(trimmed)) return;
    if (addresses.includes(trimmed)) {
      flash(trimmed);
      setDraft('');
      return;
    }
    // Ajoutée = cochée d'office (on l'ajoute pour la rendre destinataire).
    onChange({
      addresses: [...addresses, trimmed],
      checked: [...checked, trimmed],
    });
    setDraft('');
    flash(trimmed);
  };

  const removeAddress = (email: string) => {
    onChange({
      addresses: addresses.filter((a) => a !== email),
      checked: checked.filter((a) => a !== email),
    });
  };

  const toggle = (email: string) => {
    const next = checked.includes(email)
      ? checked.filter((a) => a !== email)
      : [...checked, email];
    onChange({ addresses, checked: next });
    flash(email);
  };

  return (
    <div className="flex flex-col gap-3">
      {addresses.length === 0 ? (
        <p className="font-body text-[13px] text-stone-500 italic">
          {emptyHint}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {addresses.map((email) => {
            const isChecked = checked.includes(email);
            const isRecent = email === recentRow;
            return (
              <li
                key={email}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition ${
                  isChecked
                    ? 'border-emerald-300 bg-emerald-50'
                    : 'border-stone-200 bg-stone-50'
                } ${isRecent ? 'ring-2 ring-blue-400 ring-offset-1' : ''}`}
              >
                <label className="flex items-center gap-2 flex-1 text-left cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggle(email)}
                    className="w-4 h-4 rounded border-stone-400 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className="font-body text-[14px] text-stone-900">
                    {email}
                  </span>
                  {isChecked ? (
                    <span className="font-body text-[10px] uppercase tracking-wider font-semibold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">
                      Destinataire
                    </span>
                  ) : null}
                </label>
                <button
                  type="button"
                  onClick={() => removeAddress(email)}
                  aria-label={`Supprimer ${email}`}
                  className="text-stone-400 hover:text-rose-600 text-[18px] leading-none px-1"
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex gap-2 mt-1">
        <input
          type="email"
          value={draft}
          placeholder={inputPlaceholder}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addAddress();
            }
          }}
          className="flex-1 px-3 py-2 rounded-lg border border-stone-300 bg-white text-[14px] font-body focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <button
          type="button"
          onClick={addAddress}
          disabled={!isValidEmail(draft.trim())}
          className={`px-4 py-2 rounded-lg text-[13px] font-body font-semibold transition ${
            isValidEmail(draft.trim())
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'bg-stone-200 text-stone-400 cursor-not-allowed'
          }`}
        >
          + Ajouter
        </button>
      </div>
      <p className="font-body text-[11.5px] text-stone-500">
        {checked.length > 0 ? (
          <>
            Le briefing part à <strong>{checked.length}</strong> adresse
            {checked.length > 1 ? 's' : ''} : {checked.join(', ')}.
          </>
        ) : (
          <span className="text-amber-700">
            Aucune adresse cochée — le briefing ne sera envoyé à personne.
          </span>
        )}
      </p>
    </div>
  );
}
