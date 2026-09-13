/**
 * Inventaire RGPD — UN verdict par table du schéma. PUR.
 *
 * Source de vérité CODE de la procédure `docs/ops/purge-rgpd-candidat.md` §4.1
 * (qui en est la version lisible par un DPO). Trois verdicts, pas de quatrième,
 * et aucune table sans verdict :
 *   - EFFACER       — la ligne disparaît ;
 *   - PSEUDONYMISER — la ligne reste, l'identité en sort ;
 *   - CONSERVER     — aucune donnée de candidat, ou un identifiant technique
 *                     non rattachable.
 *
 * Pourquoi un registre et pas seulement le document : le document avait déjà
 * dérivé. `job_postings` (connecteur Apec, 09/09/2026) n'y figurait pas, et
 * rien ne pouvait le signaler — les listes de tables de `execute.ts` et
 * `verify.ts` sont tenues à la main. Le test `table-inventory.test.ts` lit les
 * tables RÉELLES dans `scripts/migrate.sql` et échoue :
 *   - sur une table créée sans verdict ici ;
 *   - sur un verdict dont la table n'existe plus ;
 *   - sur un verdict qui diffère de celui du document ;
 *   - sur un traitement déclaré que le code ou le schéma ne tient pas.
 *
 * AJOUTER UNE TABLE : lui donner une entrée ici ET une ligne au §4.1 du
 * document, dans le même commit. Pour EFFACER/PSEUDONYMISER, dire COMMENT :
 * `step` (le code d'effacement la nomme) ou `cascade` (la base la vide quand
 * son parent est effacé — le test vérifie la clé étrangère).
 */

export type TableVerdict = 'EFFACER' | 'PSEUDONYMISER' | 'CONSERVER';

export type TableInventoryEntry =
  | {
      verdict: 'EFFACER' | 'PSEUDONYMISER';
      /**
       * `step` : nommée par `executeErasure` (`src/lib/gdpr/execute.ts`) et
       * relue par le contrôle final (`verify.ts` ou `journal-scope.ts`).
       * `cascade` : supprimée par `on delete cascade` depuis `parent`, lui-même
       * EFFACER.
       */
      treatment: { kind: 'step' } | { kind: 'cascade'; parent: string };
      holds: string;
    }
  | {
      verdict: 'CONSERVER';
      holds: string;
    };

export const TABLE_INVENTORY = {
  // ── Données de candidat ────────────────────────────────────────────────
  candidate_analyses: {
    verdict: 'PSEUDONYMISER',
    treatment: { kind: 'step' },
    holds: 'Identité, nom du CV et analyse complète avec citations — squelette conservé (§6.1).',
  },
  pending_validations: {
    verdict: 'EFFACER',
    treatment: { kind: 'step' },
    holds: 'File de décision humaine : identité et synthèse.',
  },
  interview_briefs: {
    verdict: 'EFFACER',
    treatment: { kind: 'step' },
    holds: 'Trame d’entretien, identité, instantané de candidature.',
  },
  vivier_candidates: {
    verdict: 'EFFACER',
    treatment: { kind: 'step' },
    holds: 'Dossier de vivier : identité et texte intégral du CV.',
  },
  vivier_embeddings: {
    verdict: 'EFFACER',
    treatment: { kind: 'cascade', parent: 'vivier_candidates' },
    holds: 'Vecteurs dérivés du CV.',
  },
  vivier_entities: {
    verdict: 'EFFACER',
    treatment: { kind: 'cascade', parent: 'vivier_candidates' },
    holds: 'Entités extraites du CV.',
  },
  vivier_skill_embeddings: {
    verdict: 'EFFACER',
    treatment: { kind: 'cascade', parent: 'vivier_candidates' },
    holds: 'Compétences du CV et leurs vecteurs.',
  },
  vivier_anchor_embeddings: {
    verdict: 'EFFACER',
    treatment: { kind: 'cascade', parent: 'vivier_candidates' },
    holds: 'Intitulés de postes du CV et leurs vecteurs.',
  },
  vivier_preselections: {
    verdict: 'EFFACER',
    treatment: { kind: 'cascade', parent: 'vivier_candidates' },
    holds: 'Présélections du dossier de vivier.',
  },
  imap_unmatched_cvs: {
    verdict: 'PSEUDONYMISER',
    treatment: { kind: 'step' },
    holds: 'Expéditeur, objet, nom du fichier — ligne gardée, garde-fou anti-résurrection (§6.3).',
  },
  artifacts_meta: {
    verdict: 'EFFACER',
    treatment: { kind: 'step' },
    holds: 'Noms de fichiers nominatifs et métadonnées d’envoi.',
  },
  sched_booking_links: {
    verdict: 'EFFACER',
    treatment: { kind: 'step' },
    holds: 'Prénom et adresse affichés sur la page de réservation.',
  },
  sched_bookings: {
    verdict: 'EFFACER',
    treatment: { kind: 'step' },
    holds: 'Identité du participant, jeton de gestion.',
  },
  sched_events: {
    verdict: 'EFFACER',
    treatment: { kind: 'cascade', parent: 'sched_bookings' },
    holds: 'Copie du participant dans la charge utile.',
  },
  journal: {
    verdict: 'PSEUDONYMISER',
    treatment: { kind: 'step' },
    holds: 'Identité dans les charges utiles de 28 actions — l’événement reste (§5.2).',
  },
  imap_cv_retries: {
    verdict: 'PSEUDONYMISER',
    treatment: { kind: 'step' },
    holds: 'Message d’erreur pouvant citer un nom de fichier.',
  },
  // Module Sourcing (docs/specs/sourcing.md §7, §12). Pas de parent effacé dont
  // elles descendraient : l'outil doit les NOMMER (option --linkedin-url pour un
  // profil non manifesté, identifiant d'analyse can_src_ pour un manifesté).
  sourcing_profiles: {
    verdict: 'EFFACER',
    treatment: { kind: 'step' },
    holds: 'Instantané d’un profil public (nom, parcours, email du titulaire) jusqu’au déclin, à la manifestation ou à la clôture.',
  },
  sourcing_approaches: {
    verdict: 'PSEUDONYMISER',
    treatment: { kind: 'step' },
    holds: 'Message d’approche (prénom) et saisie en cours d’admission — recruteur, dates et jeton haché restent.',
  },

  // ── Aucune donnée de candidat, ou identifiant technique ────────────────
  imap_outreach_claims: { verdict: 'CONSERVER', holds: 'Boîte, identifiant de message, type d’envoi (§6.4).' },
  calcom_webhook_events: { verdict: 'CONSERVER', holds: 'Identifiants techniques d’événements.' },
  interview_booking_events: { verdict: 'CONSERVER', holds: 'Identifiants techniques d’événements.' },
  sched_rate_limits: { verdict: 'CONSERVER', holds: 'Clé opaque de débit, purgée en moins d’une heure.' },
  gdpr_erasure_requests: { verdict: 'CONSERVER', holds: 'Trace de la demande : empreinte salée, jamais l’adresse (§5.1).' },
  sourcing_searches: { verdict: 'CONSERVER', holds: 'Appels au moteur de profils : la requête décrit un poste, compteurs et coûts.' },
  sourcing_exclusions: { verdict: 'CONSERVER', holds: 'Empreinte salée d’URL de profil et raison — garantit le déclin et l’opposition.' },
  campaigns: { verdict: 'CONSERVER', holds: 'Campagnes.' },
  fdps_archived: { verdict: 'CONSERVER', holds: 'Fiches de poste archivées.' },
  scoring_sheets_archived: { verdict: 'CONSERVER', holds: 'Fiches de scoring archivées.' },
  tasks_archived: { verdict: 'CONSERVER', holds: 'Sollicitations hors campagne archivées.' },
  sites: { verdict: 'CONSERVER', holds: 'Sites.' },
  donneurs_ordre: { verdict: 'CONSERVER', holds: 'Donneurs d’ordre (personnel du client).' },
  recruiters: { verdict: 'CONSERVER', holds: 'Recruteurs (agents du responsable de traitement).' },
  mailboxes: { verdict: 'CONSERVER', holds: 'Boîtes relevées.' },
  campaign_mailboxes: { verdict: 'CONSERVER', holds: 'Association boîte ↔ campagne.' },
  app_settings: { verdict: 'CONSERVER', holds: 'Réglages.' },
  demo_job_posts: { verdict: 'CONSERVER', holds: 'Annonces du jobboard de démonstration.' },
  job_postings: {
    verdict: 'CONSERVER',
    holds: 'Publications d’offres (Apec) : offre telle qu’envoyée, accusés, statut distant — aucune donnée de candidat.',
  },
  sched_resources: { verdict: 'CONSERVER', holds: 'Ressources réservables (recruteurs).' },
  sched_targets: { verdict: 'CONSERVER', holds: 'Cibles re-pointables.' },
  sched_availability_rules: { verdict: 'CONSERVER', holds: 'Règles de disponibilité.' },
  sched_availability_exceptions: { verdict: 'CONSERVER', holds: 'Exceptions de disponibilité.' },
} as const satisfies Record<string, TableInventoryEntry>;

export type InventoriedTable = keyof typeof TABLE_INVENTORY;

export const INVENTORIED_TABLES = Object.keys(TABLE_INVENTORY) as InventoriedTable[];
