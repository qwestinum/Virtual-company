'use client';

/**
 * Régime de réservation d'entretien sur un brouillon de campagne (création).
 *
 * Le flag `scheduling_native` NE VOYAGE JAMAIS dans le snapshot de campagne
 * (invariant du module de réservation : seul le PATCH ciblé l'écrit). Cet
 * éditeur ne collecte donc qu'une INTENTION, appliquée juste après la création
 * par `applyDraftScheduling` — et si le serveur la refuse, l'écran de succès le
 * dit plutôt que de laisser croire à une campagne en régime natif.
 *
 * La garde d'activation est reprise ici en AVANCE : sans référent bookable, le
 * PATCH répondrait `owner_not_bookable`. Découvrir ce refus après la création
 * serait le pire moment — on désactive la case et on dit le geste à faire.
 *
 * ⚠️ Aucun texte de cet écran ne NOMME le régime historique (Cal.com) : il est
 * en extinction, et l'annoncer à qui crée une campagne aujourd'hui, c'est
 * apprendre un nom qui va disparaître. On parle du « lien d'agenda configuré »,
 * ce qui reste vrai quel que soit le fournisseur. Le code, lui, garde le nom
 * exact — c'est la réalité technique, et elle n'est pas à l'écran.
 */

import { MeetingLocationField } from '@/components/settings/availability/MeetingLocationField';
import type { RecruiterOption } from '@/lib/campaign/use-recruiter-options';
import { type MeetingLocation } from '@/lib/scheduling';

export type SchedulingDraftEditorProps = {
  native: boolean;
  onNativeChange: (next: boolean) => void;
  location: MeetingLocation | null;
  onLocationChange: (next: MeetingLocation | null) => void;
  /** Référent pressenti (null = aucun) — porte les disponibilités. */
  owner: RecruiterOption | null;
};

export function SchedulingDraftEditor({
  native,
  onNativeChange,
  location,
  onLocationChange,
  owner,
}: SchedulingDraftEditorProps) {
  // `hasAvailability === null` = module injoignable : on ne bloque pas sur une
  // information qu'on n'a pas. Le refus éventuel sera dit après la création.
  const blocked = owner === null || owner.hasAvailability === false;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p
        className="font-body"
        style={{ fontSize: 12.5, color: 'var(--dash-text-secondary)' }}
      >
        {native
          ? 'Les candidats retenus recevront un lien de réservation nominatif, à usage unique, sur les disponibilités du référent.'
          : 'Les candidats retenus recevront le lien d’agenda configuré (celui du référent, ou celui des paramètres généraux).'}
      </p>

      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          opacity: blocked && !native ? 0.6 : 1,
        }}
      >
        <input
          type="checkbox"
          data-role="scheduling-native"
          checked={native}
          disabled={blocked && !native}
          onChange={(e) => onNativeChange(e.currentTarget.checked)}
          style={{ width: 16, height: 16 }}
        />
        <span className="font-body" style={{ fontSize: 13, fontWeight: 600 }}>
          Réservation native ORQA
        </span>
      </label>

      {/* ⚠️ L'avertissement se disait UNIQUEMENT quand le natif était éteint —
          c'est-à-dire quand il n'avait aucune conséquence. Avec le natif actif
          et un agenda vide, l'écran se taisait alors que c'est LE cas où
          personne ne pourra réserver. Il parle maintenant dans les deux cas,
          et il dit la conséquence, pas l'empêchement. */}
      {blocked ? (
        <p className="font-body" style={{ fontSize: 12, color: 'var(--dash-yellow)' }}>
          {owner === null
            ? 'Aucun référent choisi (section précédente) : la réservation s’appuiera sur l’agenda général des paramètres.'
            : native
              ? `${owner.displayName} n’a aucune disponibilité déclarée : aucun candidat ne pourra réserver tant que son agenda est vide (Paramètres → Agendas & disponibilités). La campagne, elle, peut être créée.`
              : 'Ce référent n’a aucune disponibilité déclarée — configurez son agenda (Paramètres → Agendas & disponibilités) pour pouvoir activer la réservation native.'}
        </p>
      ) : null}

      {native ? (
        <div style={{ borderTop: '1px solid var(--dash-border)', paddingTop: 10 }}>
          <MeetingLocationField
            value={location}
            onChange={onLocationChange}
            // Ici le neutre est un VRAI choix : hériter du lieu du référent.
            noneOption={{ label: 'Hériter du référent', selectable: true }}
            neutralNote={
              <span
                className="font-body"
                style={{ fontSize: 11.5, color: 'var(--dash-text-secondary)' }}
              >
                Le lieu par défaut du référent s’appliquera.
              </span>
            }
          />
          <p
            className="font-body"
            style={{
              fontSize: 11.5,
              color: 'var(--dash-text-secondary)',
              marginTop: 6,
            }}
          >
            Renseigné, ce lieu remplace celui du référent pour CETTE campagne
            (entretien sur site client, par exemple).
          </p>
        </div>
      ) : null}
    </div>
  );
}
