'use client';

/**
 * Liste éditable d'adresses email avec sélection du défaut
 * (Session 6 v5).
 *
 * Pattern :
 *   - liste des adresses enregistrées, chacune avec radio « par défaut »
 *     et bouton de suppression ;
 *   - input + bouton « Ajouter » en bas pour saisir une nouvelle adresse ;
 *   - chaque action écrit immédiatement la nouvelle liste via le parent
 *     (qui PUT vers /api/settings), avec un feedback inline (ligne
 *     surlignée brièvement après l'opération).
 *
 * Sémantique du « défaut » : la valeur de `selected` est l'adresse que
 * le pipeline IMAP / Resend utilise. Si elle n'est plus dans la liste
 * (suppression), le parent doit la basculer vers la première restante
 * ou null — c'est fait dans `SettingsHub`.
 */

import { useState } from 'react';

export type EmailListFieldProps = {
  /** Toutes les adresses enregistrées. */
  addresses: string[];
  /** Adresse marquée comme défaut (utilisée par le pipeline). */
  selected: string | null;
  /** Sauvegarde la nouvelle liste + le nouveau défaut. */
  onChange: (next: { addresses: string[]; selected: string | null }) => void;
  /** Texte d'aide indicatif sous le titre de section. */
  emptyHint: string;
  /** Placeholder du champ d'ajout. */
  inputPlaceholder: string;
};

export function EmailListField({
  addresses: rawAddresses,
  selected,
  onChange,
  emptyHint,
  inputPlaceholder,
}: EmailListFieldProps) {
  // Défense en profondeur : si un payload legacy n'inclut pas la liste,
  // on tombe sur un tableau vide plutôt qu'un crash `.length on undefined`.
  const addresses = Array.isArray(rawAddresses) ? rawAddresses : [];
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
    const next = [...addresses, trimmed];
    // Première adresse ajoutée → devient défaut automatiquement.
    const nextSelected = selected ?? trimmed;
    onChange({ addresses: next, selected: nextSelected });
    setDraft('');
    flash(trimmed);
  };

  const removeAddress = (email: string) => {
    const next = addresses.filter((a) => a !== email);
    const nextSelected =
      selected === email ? (next[0] ?? null) : selected;
    onChange({ addresses: next, selected: nextSelected });
  };

  const setDefault = (email: string) => {
    if (email === selected) return;
    onChange({ addresses, selected: email });
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
            const isDefault = email === selected;
            const isRecent = email === recentRow;
            return (
              <li
                key={email}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition ${
                  isDefault
                    ? 'border-emerald-300 bg-emerald-50'
                    : 'border-stone-200 bg-stone-50'
                } ${isRecent ? 'ring-2 ring-blue-400 ring-offset-1' : ''}`}
              >
                <button
                  type="button"
                  onClick={() => setDefault(email)}
                  aria-pressed={isDefault}
                  className="flex items-center gap-2 flex-1 text-left"
                >
                  <span
                    aria-hidden
                    className={`inline-flex items-center justify-center w-4 h-4 rounded-full border-2 ${
                      isDefault
                        ? 'border-emerald-600 bg-emerald-600'
                        : 'border-stone-400 bg-white'
                    }`}
                  >
                    {isDefault ? (
                      <span className="w-1.5 h-1.5 rounded-full bg-white" />
                    ) : null}
                  </span>
                  <span className="font-body text-[14px] text-stone-900">
                    {email}
                  </span>
                  {isDefault ? (
                    <span className="font-body text-[10px] uppercase tracking-wider font-semibold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">
                      Par défaut
                    </span>
                  ) : null}
                </button>
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
      {selected ? (
        <p className="font-body text-[11.5px] text-stone-500">
          Adresse active utilisée par le pipeline : <strong>{selected}</strong>
        </p>
      ) : null}
    </div>
  );
}
