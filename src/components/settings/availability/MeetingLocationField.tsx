'use client';

/**
 * Lieu de rencontre par défaut d'un recruteur.
 *
 * Trois formes, un seul champ à remplir à la fois. Le mini-guide de la visio
 * n'est pas de la décoration : « colle ton lien de salle personnelle » est la
 * consigne que personne ne donne, et sans elle on récupère un lien de réunion
 * ponctuelle qui expire — le candidat arrive devant une porte fermée.
 */

import type { MeetingLocation } from '@/lib/scheduling';

const INPUT =
  'w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 font-body text-[13px] text-stone-800 outline-none focus:border-blue-400';

const HINTS: Record<MeetingLocation['type'], string> = {
  video:
    'Colle ici le lien de ta salle PERSONNELLE (Meet : « Nouvelle réunion » → « Créer une réunion pour plus tard » ; Teams : lien de réunion permanent ; Zoom : Personal Meeting Room). Un lien de réunion ponctuelle expire.',
  in_person: 'Adresse complète, telle que tu l’écrirais à quelqu’un qui vient.',
  phone: 'Qui appelle qui, et sur quel numéro. Le candidat doit le savoir avant.',
};

export function MeetingLocationField({
  value,
  onChange,
}: {
  value: MeetingLocation | null;
  onChange: (next: MeetingLocation | null) => void;
}) {
  const type = value?.type ?? 'none';

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
      </label>
      <select
        className={INPUT}
        value={type}
        onChange={(e) => setType(e.currentTarget.value)}
      >
        <option value="none">Non précisé</option>
        <option value="video">Visioconférence</option>
        <option value="in_person">Sur place</option>
        <option value="phone">Par téléphone</option>
      </select>
      {value ? (
        <>
          <input
            className={INPUT}
            value={detail}
            placeholder={
              value.type === 'video'
                ? 'https://meet.google.com/…'
                : value.type === 'in_person'
                  ? '12 rue de la Paix, 75002 Paris'
                  : 'Nous vous appelons au numéro indiqué à la réservation.'
            }
            onChange={(e) => setDetail(e.currentTarget.value)}
          />
          <p className="font-body text-[11.5px] leading-relaxed text-stone-500">
            {HINTS[value.type]}
          </p>
        </>
      ) : (
        <p className="font-body text-[11.5px] text-stone-500">
          Sans lieu, la confirmation candidat n’en mentionne aucun — à préciser
          avant d’inviter qui que ce soit.
        </p>
      )}
    </div>
  );
}
