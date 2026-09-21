'use client';

/**
 * Les écarts d'une offre APEC : erreurs, avertissements, et le feu vert.
 *
 * Sorti du panneau pour tenir la limite des 200 lignes. Le feu vert est
 * conditionné à `verified`, jamais à « la liste est vide » : les écarts du
 * texte pré-rempli s'affichent AVANT toute vérification, et une liste qui ne
 * contient qu'un avertissement de mise en forme ne dit rien du code INSEE ni
 * du statut du poste. Annoncer « prête à partir » là-dessus serait un feu vert
 * sur une offre que personne n'a validée.
 */
import type { AdepIssue } from '@/lib/jobboards/adep/validate';

import { errorStyle } from './job-ad-panel-styles';

export function ApecIssueList({
  issues,
  verified,
}: {
  issues: AdepIssue[] | null;
  verified: boolean;
}) {
  const errors = issues?.filter((i) => i.level === 'error') ?? [];
  const warnings = issues?.filter((i) => i.level === 'warning') ?? [];

  return (
    <>
      {errors.length > 0 ? (
        <ul style={{ ...errorStyle, marginTop: 10, paddingLeft: 18 }}>
          {errors.map((i) => (
            <li key={`${i.field}-${i.preventsCode}-${i.message}`}>{i.message}</li>
          ))}
        </ul>
      ) : null}
      {warnings.length > 0 ? (
        <ul style={{ marginTop: 8, paddingLeft: 18, fontSize: 12, color: 'var(--dash-orange)' }}>
          {warnings.map((i) => (
            <li key={`${i.field}-${i.message}`}>{i.message}</li>
          ))}
        </ul>
      ) : null}
      {verified && errors.length === 0 ? (
        <div style={{ marginTop: 10, fontSize: 13, color: 'var(--dash-green)' }}>
          Aucune erreur — l’offre est prête à partir.
        </div>
      ) : null}
    </>
  );
}
