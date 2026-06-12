/**
 * Types de la PRÉSÉLECTION vivier (Session V2, docs/specs/vivier.md §4).
 *
 * La présélection réduit le vivier à une short-list ordonnée pour une campagne,
 * en cascade : filtres durs (entités) → tri sémantique (cosinus) → modulation
 * fraîcheur → exclusions. Chaque entrée porte son explication de pertinence.
 *
 * La short-list issue de la FICHE est persistée (table vivier_preselections),
 * substrat du cycle factuel V3 : un candidat y entre `identified`, la V3 fera
 * évoluer vers `contacted`/`rejected`. La recherche libre est éphémère.
 */

/**
 * Cycle factuel d'un candidat présélectionné (§6.2). En V2 seul `identified`
 * est produit ; `contacted`/`rejected` sont posés en V3 et PRÉSERVÉS par toute
 * relance de présélection (jamais écrasés).
 */
export type VivierPreselectionState = 'identified' | 'contacted' | 'rejected';

/** Un filtre dur satisfait par un candidat, avec les termes de critère trouvés. */
export type HardFilterMatch = {
  criterionId: string;
  label: string;
  /** Termes du critère effectivement trouvés dans les entités du candidat. */
  matchedTerms: string[];
};

/**
 * Origine d'un candidat dans la short-list (présélection titre) :
 *   - `title_exact` : bloc 1, correspondance déterministe de titre (variante) ;
 *   - `title_semantic` : bloc 2, titre proche par similarité d'embedding.
 */
export type PreselectionMatchKind = 'title_exact' | 'title_semantic';

/** Une entrée de la short-list (affichage + persistance). */
export type ShortlistEntry = {
  candidateId: string;
  nom: string;
  email: string;
  /** Origine du match (bloc 1 déterministe / bloc 2 sémantique). */
  matchKind: PreselectionMatchKind;
  /** Terme (titre/variante) qui a matché — bloc 1 ; null en bloc 2. */
  matchTerm: string | null;
  /** Similarité titre-à-titre 0..1 (bloc 2 ; 1.0 pour un match exact bloc 1). */
  similarity: number;
  /** Facteur de fraîcheur 0..1 (dégressif au-delà de 12 mois). */
  freshnessFactor: number;
  /** Score de pertinence = similarity × freshnessFactor (clé de tri). */
  relevanceScore: number;
  /** Date de dernière mise à jour du dossier (source de la fraîcheur). */
  updatedAt: string;
  /** Filtres durs satisfaits, avec les entités correspondantes. */
  passedFilters: HardFilterMatch[];
  /** Rang 1-based dans la short-list. */
  rank: number;
  state: VivierPreselectionState;
  /** Faits datés du cycle (V3, §6) — null tant que non posés. */
  contactedAt: string | null;
  rejectedAt: string | null;
  decidedBy: string | null;
  /** Rapprochement : le candidat a postulé à la campagne (§6.3). */
  appliedAt: string | null;
  /**
   * Intitulé du dernier poste auquel le candidat a postulé (dérivé à la
   * lecture, non persisté ; absent s'il n'a jamais postulé). Affiché en vue
   * compacte de validation.
   */
  lastJobTitle?: string | null;
};
