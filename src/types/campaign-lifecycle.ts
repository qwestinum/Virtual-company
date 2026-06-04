/**
 * Machine à états du cycle de vie d'une campagne — SOURCE DE VÉRITÉ UNIQUE.
 *
 * Remplace (à terme) les deux représentations divergentes actuelles :
 *   - `recomputeStatus` (3 booléens) dans campaigns-store ;
 *   - `computeProgressSnapshot` (4 étages) dans ManagerChat.
 *
 * Principe directeur : TOUT ce qui touche au déroulé d'une campagne est
 * DÉTERMINISTE et vérifiable. Le LLM ne possède pas le flux ; il ne fait
 * que collecter le contenu de la FDP (R1). Les entrées/sorties qui
 * franchissent la frontière (storage, LLM) sont validées par les schémas
 * Zod de ce module avant d'entrer dans la machine.
 *
 * Modèle fonctionnel validé (cf. memory project_campaign_lifecycle) :
 *   FDP → Scoring → Flux → Rédaction annonce → Publication
 *   obligatoires : fdp, scoring, intake
 *   optionnelles : announcement, publication (sautables = « à remettre à
 *                  plus tard » → statut `postponed`)
 *   « lancée » (active) = toutes les obligatoires `done` ET chaque
 *                  optionnelle `done` ou `postponed`.
 */

import { z } from 'zod';

/** Ordre canonique des phases (figé — l'engine le parcourt dans cet ordre). */
export const PHASE_IDS = [
  'fdp',
  'scoring',
  'intake',
  'announcement',
  'publication',
] as const;

export const PhaseIdSchema = z.enum(PHASE_IDS);
export type PhaseId = z.infer<typeof PhaseIdSchema>;

/** Ordre de parcours (= PHASE_IDS, exposé nommément pour l'intention). */
export const PHASE_ORDER: readonly PhaseId[] = PHASE_IDS;

/**
 * Statut d'une phase.
 *   - pending     : pas encore abordée.
 *   - in_progress : configuration en cours (picker/éditeur ouvert).
 *   - done        : validée, son artefact existe.
 *   - postponed   : « à remettre à plus tard » — choix EXPLICITE du DRH sur
 *                   une phase optionnelle. Distinct d'un skip définitif :
 *                   la phase reste reprenable. Compte comme « réglée » pour
 *                   l'activation, mais pas comme « faite ».
 */
export const PHASE_STATUSES = [
  'pending',
  'in_progress',
  'done',
  'postponed',
] as const;

export const PhaseStatusSchema = z.enum(PHASE_STATUSES);
export type PhaseStatus = z.infer<typeof PhaseStatusSchema>;

/** Phases obligatoires (non sautables). */
export const REQUIRED_PHASE_IDS: readonly PhaseId[] = [
  'fdp',
  'scoring',
  'intake',
];

/** Phases optionnelles (sautables via « à remettre à plus tard »). */
export const OPTIONAL_PHASE_IDS: readonly PhaseId[] = [
  'announcement',
  'publication',
];

export function isRequiredPhase(id: PhaseId): boolean {
  return REQUIRED_PHASE_IDS.includes(id);
}

/**
 * Dépendances DURES (prérequis de données), distinctes de l'ordre de
 * parcours. Une phase ne peut passer `in_progress`/`done` que si TOUTES
 * ses dépendances (transitives) sont `done`.
 *
 *   - scoring/intake/announcement dérivent de la FDP → dépendent de `fdp` ;
 *     rouvrir la FDP redescend donc tout l'aval (source de vérité).
 *   - publication exige une annonce rédigée → dépend de `announcement`.
 */
export const PHASE_DEPENDENCIES: Record<PhaseId, readonly PhaseId[]> = {
  fdp: [],
  scoring: ['fdp'],
  intake: ['fdp'],
  announcement: ['fdp'],
  publication: ['announcement'],
};

export const PhaseSchema = z.object({
  id: PhaseIdSchema,
  status: PhaseStatusSchema,
  required: z.boolean(),
});
export type Phase = z.infer<typeof PhaseSchema>;

/**
 * Machine d'états complète d'une campagne : un statut par phase. Le schéma
 * garantit que LES 5 phases sont présentes et que `required` est cohérent
 * avec REQUIRED_PHASE_IDS — toute donnée externe (storage, futur LLM) est
 * rejetée si elle ne respecte pas l'invariant.
 */
export const CampaignLifecycleSchema = z
  .object({
    phases: z.record(PhaseIdSchema, PhaseSchema),
  })
  .superRefine((value, ctx) => {
    for (const id of PHASE_IDS) {
      const phase = value.phases[id];
      if (!phase) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `phase manquante : ${id}`,
        });
        continue;
      }
      if (phase.id !== id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `clé ${id} mais phase.id = ${phase.id}`,
        });
      }
      if (phase.required !== isRequiredPhase(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `required incohérent pour ${id}`,
        });
      }
    }
  });

export type CampaignLifecycle = {
  phases: Record<PhaseId, Phase>;
};

/** Transitions légales — seuls mutateurs autorisés de la machine. */
export const TRANSITION_KINDS = [
  'start',
  'complete',
  'postpone',
  'reopen',
] as const;
export type TransitionKind = (typeof TRANSITION_KINDS)[number];

export type LifecycleTransition = {
  kind: TransitionKind;
  phaseId: PhaseId;
};

/** Actions proposables au DRH pour une phase, dérivées de son état. */
export const PHASE_ACTIONS = [
  'configure',
  'validate',
  'postpone',
  'adjust',
  'reopen',
] as const;
export type PhaseAction = (typeof PHASE_ACTIONS)[number];

/**
 * Erreurs de transition — discriminées par `code`. La machine ne mute
 * JAMAIS dans un état illégal en silence : toute transition refusée
 * renvoie une de ces erreurs (cf. applyTransition → LifecycleResult).
 */
export type LifecycleError =
  | { code: 'unknown_phase'; phaseId: string }
  | { code: 'dependency_not_met'; phaseId: PhaseId; missing: PhaseId[] }
  | { code: 'cannot_postpone_required'; phaseId: PhaseId }
  | {
      code: 'illegal_transition';
      phaseId: PhaseId;
      from: PhaseStatus;
      kind: TransitionKind;
    };

export type LifecycleResult =
  | { ok: true; lifecycle: CampaignLifecycle }
  | { ok: false; error: LifecycleError };
