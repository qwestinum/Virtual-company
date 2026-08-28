'use client';

/**
 * Ce dont une campagne HÉRITE quand elle ne surcharge pas le lieu.
 *
 * Écrire « héritera du paramétrage du référent » ne suffit pas : c'est
 * précisément quand le recruteur croit « téléphone » et que le référent porte
 * un lien de visioconférence que le malentendu se produit — et il ne se
 * découvre qu'une fois le candidat devant une salle Teams. On affiche donc la
 * valeur RÉELLE, dans le même esprit que le preview HITL qui fait foi sur le
 * lien envoyé.
 *
 * Le cas VIDE est le plus important : personne ne saurait où se tient
 * l'entretien. Il ne doit pas ressembler à un champ simplement non rempli.
 */

import { describeMeetingLocation, type MeetingLocation } from '@/lib/scheduling';

const LOCATION_LABEL: Record<MeetingLocation['type'], string> = {
  video: 'Visioconférence',
  in_person: 'Sur place',
  phone: 'Par téléphone',
};

export function InheritedMeetingLocationNote({
  location,
}: {
  location: MeetingLocation | null;
}) {
  const detail = location ? describeMeetingLocation(location) : null;
  if (!location || !detail) {
    return (
      <p style={{ color: 'var(--dash-yellow)', fontWeight: 600 }}>
        Le référent de cette campagne n’a aucun lieu d’entretien : tant que
        rien n’est renseigné (ici ou dans son agenda), aucune invitation ne
        pourra partir.
      </p>
    );
  }
  return (
    <p>
      Les candidats verront le lieu du référent — actuellement :{' '}
      <strong>{LOCATION_LABEL[location.type]}</strong> — {detail}
    </p>
  );
}
