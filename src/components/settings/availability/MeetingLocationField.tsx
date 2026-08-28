'use client';

/**
 * Lieu de rencontre — champ partagé par l'agenda d'un recruteur et par la
 * surcharge d'une campagne.
 *
 * Deux règles y sont visibles, et c'est délibéré :
 *
 *  1. **Un type choisi exige son détail.** « Par téléphone » sans consigne ou
 *     « Sur place » sans adresse ne sont pas des lieux : ils s'enregistraient
 *     et se relisaient comme « aucun lieu », en silence. L'écran le dit
 *     maintenant AVANT l'enregistrement, et le serveur le refuse.
 *  2. **Le neutre n'a pas le même sens des deux côtés.** Sur un agenda, il n'y
 *     a rien à hériter : ne rien choisir, c'est empêcher toute invitation —
 *     l'option n'est donc pas sélectionnable, et le champ est marqué requis.
 *     Sur une campagne, le neutre est un vrai choix : hériter du référent. Le
 *     même mot pour deux sens différents était la confusion d'origine.
 *
 * Le mini-guide de la visio n'est pas de la décoration : « colle ton lien de
 * salle personnelle » est la consigne que personne ne donne, et sans elle on
 * récupère un lien de réunion ponctuelle qui expire — le candidat arrive
 * devant une porte fermée.
 */

import type { ReactNode } from 'react';

import { isMeetingLocationComplete, type MeetingLocation } from '@/lib/scheduling';

const INPUT =
  'w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 font-body text-[13px] text-stone-800 outline-none focus:border-blue-400';
const INPUT_ERROR =
  'w-full rounded-md border border-red-400 bg-white px-2.5 py-1.5 font-body text-[13px] text-stone-800 outline-none focus:border-red-500';

const HINTS: Record<MeetingLocation['type'], string> = {
  video:
    'Colle ici le lien de ta salle PERSONNELLE (Meet : « Nouvelle réunion » → « Créer une réunion pour plus tard » ; Teams : lien de réunion permanent ; Zoom : Personal Meeting Room). Un lien de réunion ponctuelle expire.',
  in_person: 'Adresse complète, telle que tu l’écrirais à quelqu’un qui vient.',
  phone: 'Qui appelle qui, et sur quel numéro. Le candidat doit le savoir avant.',
};

const MISSING_DETAIL: Record<MeetingLocation['type'], string> = {
  video: 'Renseigne le lien de visioconférence — sans lui, ce lieu n’en est pas un.',
  in_person: 'Renseigne l’adresse — sans elle, ce lieu n’en est pas un.',
  phone:
    'Précise qui appelle qui, et sur quel numéro — sans cette consigne, ce lieu n’en est pas un.',
};

const PLACEHOLDERS: Record<MeetingLocation['type'], string> = {
  video: 'https://meet.google.com/…',
  in_person: '12 rue de la Paix, 75002 Paris',
  phone: 'Nous vous appelons au numéro indiqué à la réservation.',
};

export type NoneOption = {
  /** Libellé de l'entrée neutre — « à choisir » ou « hériter du référent ». */
  label: string;
  /** Peut-on y REVENIR ? Non sur un agenda, oui sur une campagne. */
  selectable: boolean;
};

export function MeetingLocationField({
  value,
  onChange,
  noneOption = { label: 'Non précisé', selectable: true },
  required = false,
  neutralNote,
}: {
  value: MeetingLocation | null;
  onChange: (next: MeetingLocation | null) => void;
  noneOption?: NoneOption;
  required?: boolean;
  /** Ce qu'implique le neutre ici. Affiché quand aucun type n'est choisi. */
  neutralNote?: ReactNode;
}) {
  const type = value?.type ?? 'none';
  const incomplete = value !== null && !isMeetingLocationComplete(value);

  function setType(next: string) {
    if (next === 'video') onChange({ type: 'video', payload: { url: '' } });
    else if (next === 'in_person')
      onChange({ type: 'in_person', payload: { address: '' } });
    else if (next === 'phone')
      onChange({ type: 'phone', payload: { instructions: '' } });
    else onChange(null);
  }

  const detail =
    value?.type === 'video'
      ? value.payload.url
      : value?.type === 'in_person'
        ? value.payload.address
        : value?.type === 'phone'
          ? value.payload.instructions
          : '';

  function setDetail(next: string) {
    if (!value) return;
    if (value.type === 'video') onChange({ type: 'video', payload: { url: next } });
    else if (value.type === 'in_person')
      onChange({ type: 'in_person', payload: { address: next } });
    else onChange({ type: 'phone', payload: { instructions: next } });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label className="font-body text-[12px] font-semibold text-stone-600">
        Lieu de l’entretien
        {required ? (
          <span className="ml-1.5 rounded bg-red-50 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-red-600">
            requis
          </span>
        ) : null}
      </label>
      <select
        className={INPUT}
        value={type}
        onChange={(e) => setType(e.currentTarget.value)}
      >
        <option value="none" disabled={!noneOption.selectable}>
          {noneOption.label}
        </option>
        <option value="video">Visioconférence</option>
        <option value="in_person">Sur place</option>
        <option value="phone">Par téléphone</option>
      </select>
      {value ? (
        <>
          <input
            className={incomplete ? INPUT_ERROR : INPUT}
            value={detail}
            placeholder={PLACEHOLDERS[value.type]}
            onChange={(e) => setDetail(e.currentTarget.value)}
          />
          <p
            className={`font-body text-[11.5px] leading-relaxed ${
              incomplete ? 'font-semibold text-red-600' : 'text-stone-500'
            }`}
          >
            {incomplete ? MISSING_DETAIL[value.type] : HINTS[value.type]}
          </p>
        </>
      ) : (
        <div className="font-body text-[11.5px] leading-relaxed text-stone-500">
          {neutralNote ?? (
            <p>
              Sans lieu, la confirmation candidat n’en mentionne aucun — à
              préciser avant d’inviter qui que ce soit.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
