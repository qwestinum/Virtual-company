'use client';

/**
 * Saisie du lien : TESTER d'abord, ENREGISTRER ensuite. Le bouton
 * « Enregistrer » ne s'active que pour le lien qui vient d'être lu avec
 * succès — modifier le champ le désarme.
 */
import { useState } from 'react';

export function BusyCalendarForm({
  busy,
  testedUrl,
  replacing,
  onTest,
  onSave,
  onEdit,
  onCancel,
}: {
  busy: 'test' | 'save' | 'clear' | null;
  testedUrl: string | null;
  replacing: boolean;
  onTest: (url: string) => void;
  onSave: (url: string) => Promise<boolean>;
  onEdit: () => void;
  onCancel?: () => void;
}) {
  const [url, setUrl] = useState('');
  const trimmed = url.trim();
  const canSave = trimmed !== '' && testedUrl === trimmed && busy === null;

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="busy-ics-url" className="font-body text-[12.5px] font-semibold text-stone-600">
        {replacing ? 'Nouveau lien de ton agenda publié' : 'Lien de ton agenda publié (ICS)'}
      </label>
      <input
        id="busy-ics-url"
        type="url"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        placeholder="https://outlook.live.com/owa/calendar/…/calendar.ics"
        value={url}
        onChange={(e) => {
          setUrl(e.currentTarget.value);
          onEdit();
        }}
        className="rounded-md border border-stone-300 bg-white px-2 py-1.5 font-mono text-[12.5px] text-stone-800 outline-none focus:border-blue-400"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-md border border-stone-300 bg-white px-3 py-1.5 font-body text-[13px] font-semibold text-stone-800 hover:bg-stone-50 disabled:opacity-50"
          disabled={trimmed === '' || busy !== null}
          onClick={() => onTest(trimmed)}
        >
          {busy === 'test' ? 'Lecture…' : 'Tester le lien'}
        </button>
        <button
          type="button"
          className="rounded-md bg-stone-800 px-3 py-1.5 font-body text-[13px] font-semibold text-white hover:bg-stone-700 disabled:opacity-50"
          disabled={!canSave}
          title={canSave ? undefined : 'Teste d’abord le lien : seul un agenda lu avec succès s’enregistre.'}
          onClick={() => void onSave(trimmed).then((saved) => saved && setUrl(''))}
        >
          {busy === 'save' ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        {onCancel ? (
          <button
            type="button"
            className="font-body text-[12.5px] text-stone-500 underline hover:text-stone-700"
            onClick={onCancel}
          >
            Annuler
          </button>
        ) : null}
      </div>
    </div>
  );
}
