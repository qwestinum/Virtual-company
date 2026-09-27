'use client';

/**
 * Panneau d'approche (spec §8.3, §14.4).
 *
 * Le message est PRÊT quand le panneau s'ouvre. Le bouton principal fait, dans
 * le MÊME clic, ce que le navigateur n'autorise qu'au geste de l'utilisateur :
 * LinkedIn — ouvrir le profil ET copier le message ; email — ouvrir la
 * messagerie du recruteur. Puis il confirme l'approche au serveur. Si la copie
 * est refusée, le texte reste sélectionnable : jamais d'échec muet.
 *
 * Il vit DANS `SourcingApproachDialog` (fenêtre centrée). Pendant une
 * nouvelle rédaction (changement de format), il reste affiché : le format
 * choisi est coché TOUT DE SUITE, le texte est grisé et l'attente est dite.
 */

import { Loader2 } from 'lucide-react';
import { useRef, useState } from 'react';

export type PreparedApproach = {
  approachId: string;
  channel: 'linkedin' | 'email';
  format: 'connection_note' | 'inmail' | 'email';
  limit: number;
  url: string;
  profileUrl: string;
  subject: string | null;
  message: string;
  mailto: { href: string; bodyInHref: boolean } | null;
  email: string | null;
};

export function SourcingApproachPanel({
  prepared,
  formatShown,
  redrafting,
  onConfirm,
  onCancel,
  onFormatChange,
}: {
  prepared: PreparedApproach;
  /** Le format COCHÉ — celui demandé, sans attendre la nouvelle rédaction. */
  formatShown: PreparedApproach['format'];
  /** Une nouvelle rédaction est en cours (changement de format). */
  redrafting: boolean;
  onConfirm: (message: string) => Promise<string | null>;
  onCancel: () => void;
  onFormatChange: (format: 'connection_note' | 'inmail') => void;
}) {
  const [text, setText] = useState(prepared.message);
  const [done, setDone] = useState<null | 'copied' | 'not_copied' | 'mail'>(null);
  const [error, setError] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const tooLong = prepared.format === 'connection_note' && text.length > prepared.limit;
  const linkMissing = !text.includes(prepared.url);

  const act = async () => {
    setError(null);
    if (prepared.channel === 'linkedin') {
      // La copie est LANCÉE avant l'ouverture : le nouvel onglet prend le focus,
      // et le navigateur refuse d'écrire le presse-papier d'une page sans focus.
      const copy = navigator.clipboard.writeText(text);
      window.open(prepared.profileUrl, '_blank', 'noopener,noreferrer');
      try {
        await copy;
        setDone('copied');
      } catch {
        area.current?.select();
        setDone('not_copied');
      }
    } else if (prepared.mailto) {
      if (!prepared.mailto.bodyInHref) void navigator.clipboard.writeText(text).catch(() => area.current?.select());
      window.location.href = prepared.mailto.href;
      setDone('mail');
    }
    const failure = await onConfirm(text);
    if (failure) setError(failure);
  };

  const recopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone('copied');
    } catch {
      area.current?.select();
      setDone('not_copied');
    }
  };

  return (
    <>
      <p className="font-body text-[13px] font-semibold text-stone-800">
        {prepared.channel === 'linkedin' ? 'Message pour l’invitation LinkedIn' : `Email à ${prepared.email ?? ''}`}
      </p>
      {prepared.subject ? <p className="font-body text-[12.5px] text-stone-600">Objet : {prepared.subject}</p> : null}
      {redrafting ? (
        <p data-approach-redrafting className="flex items-center gap-2 font-body text-[12.5px] text-stone-600">
          <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
          Rédaction au format {formatShown === 'inmail' ? 'InMail' : 'note de connexion'}…
        </p>
      ) : null}
      <textarea
        ref={area}
        rows={formatShown === 'connection_note' ? 5 : 9}
        value={text}
        disabled={done !== null || redrafting}
        onChange={(e) => setText(e.target.value)}
        className="w-full resize-y rounded-md border border-stone-300 px-3 py-2 font-body text-[13px] text-stone-800"
      />
      <div className="flex flex-wrap items-center justify-between gap-2 font-body text-[12px] text-stone-500">
        <span className={tooLong ? 'font-semibold text-rose-700' : ''}>
          {text.length} / {prepared.limit} caractères
        </span>
        {prepared.channel === 'linkedin' && done === null ? (
          <span className="flex items-center gap-2">
            Format
            {(['connection_note', 'inmail'] as const).map((f) => (
              <label key={f} className="flex items-center gap-1">
                <input type="radio" name="approach-format" data-approach-format={f} checked={formatShown === f} onChange={() => onFormatChange(f)} />
                {f === 'connection_note' ? 'Note de connexion' : 'InMail'}
              </label>
            ))}
          </span>
        ) : null}
      </div>
      {linkMissing ? <p className="font-body text-[12px] text-rose-700">Le lien a été retiré : la personne ne pourrait pas répondre.</p> : null}
      {done === 'copied' ? <p className="font-body text-[12.5px] text-emerald-800">Message copié. Le profil s’est ouvert dans un nouvel onglet : collez-le dans l’invitation.</p> : null}
      {done === 'not_copied' ? <p className="font-body text-[12.5px] text-amber-800">Copie refusée par le navigateur : le texte est sélectionné, faites Ctrl+C.</p> : null}
      {done === 'mail' ? <p className="font-body text-[12.5px] text-emerald-800">Votre messagerie s’est ouverte{prepared.mailto?.bodyInHref ? '' : ' ; le corps du message a été copié, collez-le'}.</p> : null}
      {error ? <p className="font-body text-[12.5px] text-rose-700">{error}</p> : null}
      <div className="flex flex-wrap justify-end gap-2">
        {done === null ? (
          <>
            <button type="button" onClick={onCancel} className="rounded-md border border-stone-300 px-3 py-1.5 font-body text-[12.5px] font-semibold text-stone-600 hover:bg-stone-50">
              Annuler
            </button>
            <button
              type="button"
              disabled={tooLong || linkMissing || redrafting}
              onClick={() => void act()}
              className="rounded-md border border-stone-800 bg-stone-900 px-3 py-1.5 font-body text-[12.5px] font-semibold text-white hover:bg-stone-800 disabled:opacity-40"
            >
              {prepared.channel === 'linkedin' ? 'Ouvrir le profil et copier le message' : 'Ouvrir ma messagerie'}
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => void recopy()} className="rounded-md border border-stone-300 px-3 py-1.5 font-body text-[12.5px] font-semibold text-stone-600 hover:bg-stone-50">
              Recopier
            </button>
            <button type="button" onClick={onCancel} className="rounded-md border border-stone-800 bg-stone-900 px-3 py-1.5 font-body text-[12.5px] font-semibold text-white">
              Fermer
            </button>
          </>
        )}
      </div>
    </>
  );
}
