/**
 * Un profil du vivier, vu depuis l'écran de la campagne — PUR. Deux origines,
 * une seule forme pour l'aperçu et l'invitation : la présélection (proposé,
 * donc écartable) et la recherche par mot-clé (trouvé, pas encore proposé).
 */
import type { VivierKeywordResult } from '@/types/vivier-keyword-search';
import type { ShortlistEntry } from '@/types/vivier-preselection';

import type { VivierTarget } from './useVivierInvite';

export function targetFromEntry(entry: ShortlistEntry): VivierTarget {
  const match =
    entry.matchKind === 'title_exact'
      ? `Correspondance de titre${entry.matchTerm ? ` : ${entry.matchTerm}` : ''}`
      : `Titre proche : ${Math.round(entry.similarity * 100)} %`;
  const covered = entry.skillMatches.filter((m) => m.covered);
  return {
    candidateId: entry.candidateId,
    nom: entry.nom,
    subtitle: entry.email,
    lines: [
      `${match} · pertinence ${Math.round(entry.relevanceScore * 100)} %`,
      ...(covered.length > 0 ? [`Compétences retrouvées : ${covered.map((m) => m.candidateSkill ?? m.jobSkill).join(', ')}`] : []),
    ],
    canReject: true,
  };
}

export function targetFromKeyword(r: VivierKeywordResult, query: string): VivierTarget {
  const nom = [r.prenom, r.nom].filter(Boolean).join(' ') || r.nom;
  return {
    candidateId: r.candidateId,
    nom,
    subtitle: r.title ?? 'Poste non précisé',
    lines: [`Trouvé par la recherche « ${query} » — hors présélection.`],
    matchTerm: query,
    // Déjà écarté pour cette campagne : on peut encore l'inviter, pas le
    // ré-écarter.
    canReject: r.membership === 'none',
  };
}
