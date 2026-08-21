/**
 * Dérivation pure des métriques du dashboard à partir du journal d'audit
 * (Session 6).
 *
 * Le journal est notre source de vérité opérationnelle : il enregistre
 * tous les évènements IMAP, scoring, outreach et actions UI. On en
 * dérive ici tous les chiffres affichés sur le dashboard — KPIs
 * globaux, métriques par agent, métriques par campagne, liste des
 * candidats et flux d'activité.
 *
 * Pourquoi un module pur ?
 *   - Testable sans Supabase (snapshots de rows en entrée, valeurs en
 *     sortie).
 *   - Réutilisable côté client si on hydrate des rows brutes via
 *     /api/journal.
 *   - Indépendant du shape exact retourné par Supabase (on travaille
 *     sur le type `JournalEntry` du repo).
 *
 * Coûts d'estimation
 *   On ne mesure pas les tokens en temps réel — on estime à partir du
 *   nombre d'appels et d'un coût moyen par action. Honnête en démo,
 *   sera remplacé par une instrumentation vraie en Session 7.
 */

import type { JournalEntry } from '@/lib/db/repos/journal';

// ─── Coûts moyens estimés par action (en €) ───────────────────────────
// Calibré sur GPT-4o à partir des tailles d'appel typiques observées
// pendant les démos. Ce sont des ordres de grandeur, pas des mesures.

const COST_PER_ACTION: Record<string, number> = {
  imap_cv_analyzed: 0.075, // analyse + scoring d'un CV
  imap_outreach_mail: 0.025, // composition email candidat
  imap_outreach_brief: 0.045, // composition brief DRH
  job_writer_rendered: 0.06, // rédaction d'une annonce
  hitl_validation_sent: 0.025, // envoi d'un mail validé (HITL)
};

// ─── Mapping action → agent ────────────────────────────────────────────

const ACTION_TO_AGENT: Record<string, string> = {
  imap_cv_analyzed: 'agent.cv-analyzer',
  imap_outreach_mail: 'agent.mail-composer',
  imap_outreach_brief: 'agent.mail-composer',
  job_writer_rendered: 'agent.job-writer',
  hitl_validation_sent: 'agent.mail-composer',
  // Actions UI directes (paused, threshold_changed, …) ne sont pas
  // attribuées à un agent — elles peuplent le feed sans alimenter
  // les compteurs de tâches.
};

// ─── Types exposés ─────────────────────────────────────────────────────

export type GlobalKPIs = {
  cvReceived: number;
  shortlisted: number;
  interviews: number;
  go: number;
  conversion: number; // % entier
  costEstimate: number; // €
  /**
   * HITL — validations en attente (mails non encore envoyés). N'est PAS dérivé
   * du journal (c'est l'état de la file `pending_validations`) : défaut 0 ici,
   * renseigné par la route /api/metrics/global.
   */
  awaitingValidation: number;
};

export type AgentMetric = {
  agentId: string;
  taskCount: number;
  avgDurationMs: number | null;
  successRate: number; // 0-100
  costEstimate: number;
};

export type CampaignMetric = {
  candidates: number;
  shortlisted: number;
  invited: number;
  interviews: number;
  goCount: number;
  avgScore: number | null;
};

export type CandidateRow = {
  id: string;
  name: string;
  initials: string;
  score: number;
  status:
    | 'analyzed'
    | 'invited'
    | 'scheduled'
    | 'interview_done'
    | 'rejected';
  recommendation: 'go' | 'no-go' | null;
  role: string | null;
  campaignId: string | null;
  receivedAt: string;
  /**
   * Session 6 v2 — boutons d'action côté DRH.
   *   - interviewMarked  : dernière décision sur le passage en entretien
   *   - validationMarked : dernière décision sur la validation définitive
   * null = pas encore marqué (les boutons sont à proposer).
   */
  interviewMarked: 'realized' | 'missed' | null;
  validationMarked: 'validated' | 'rejected' | null;
  /**
   * HITL — l'analyse est EN FILE de validation (zone grise, mail non envoyé).
   * La ligne reste dans la liste (un CV reçu EST un CV reçu — compteur
   * « CV reçus » des cartes campagne) mais chaque lecteur décide : le
   * dashboard résiduel et les KPIs shortlisté/entretiens/GO l'écartent
   * tant que l'humain n'a pas tranché.
   */
  awaitingValidation: boolean;
};

export type ActivityItem = {
  id: number;
  message: string;
  time: string; // HH:MM
  iconKey: ActivityIconKey;
  colorKey: ActivityColorKey;
  campaignId: string | null;
  createdAt: string;
};

/**
 * Répartition des candidatures par décision (récit « Process First » du Bureau).
 * EXHAUSTIF depuis `candidate_analyses.decision_zone` (pas le journal). Les 5
 * champs sont DISJOINTS et somment à `total` :
 *   - autoReject / autoAccept = zones auto (système)
 *   - humanValidated = gris tranché par un humain (`decided_by='user'`)
 *   - pending = gris pas encore tranché (déféré à l'humain)
 *   - sansSuite = classées sans suite (raison externe, jamais une évaluation)
 */
export type ZoneCounts = {
  autoReject: number;
  autoAccept: number;
  humanValidated: number;
  pending: number;
  sansSuite: number;
  total: number;
};

/** ZoneCounts vide (mode offline / Supabase absent). */
export const EMPTY_ZONE_COUNTS: ZoneCounts = {
  autoReject: 0,
  autoAccept: 0,
  humanValidated: 0,
  pending: 0,
  sansSuite: 0,
  total: 0,
};

export type ActivityIconKey =
  | 'cv'
  | 'mail'
  | 'calendar'
  | 'interview'
  | 'announce'
  | 'rocket'
  | 'pause'
  | 'play'
  | 'edit'
  | 'archive'
  | 'report';

export type ActivityColorKey =
  | 'green'
  | 'blue'
  | 'purple'
  | 'orange'
  | 'teal'
  | 'indigo'
  | 'yellow'
  | 'red'
  | 'pink';

// ─── KPIs globaux ──────────────────────────────────────────────────────

/**
 * Calcule les six KPIs affichés en haut du dashboard.
 *
 * Définitions (Session 6 v2 — alignées sur les boutons d'action UI)
 *   - cvReceived  : entrées `imap_cv_received`
 *   - shortlisted : candidats dont l'analyse a `aboveThreshold=true`. Fait
 *                   figé — ne varie PAS selon les décisions DRH ultérieures.
 *   - interviews  : candidats dont le DRH a cliqué « Entretien réalisé »
 *                   (dernière action wins).
 *   - go          : candidats validés définitivement (« Validation
 *                   définitive » cliqué). Alimente le KPI « GO ».
 *   - conversion  : go / cvReceived en % entier (0 si pas de CV).
 *   - costEstimate: somme des coûts par action (cf. table COST_PER_ACTION).
 */
export function journalToGlobalKPIs(
  rows: JournalEntry[],
  pendingUids: ReadonlySet<string> = new Set(),
): GlobalKPIs {
  let cvReceived = 0;
  let cost = 0;

  for (const row of rows) {
    const c = COST_PER_ACTION[row.action];
    if (c) cost += c;
    if (row.action === 'imap_cv_received') cvReceived += 1;
  }

  // Dérive l'état candidat depuis le journal (HITL-aware : les analyses en
  // attente de validation sont MARQUÉES `awaitingValidation` — on les écarte
  // ici des compteurs shortlisté/entretiens/GO, l'humain n'a pas tranché).
  const candidates = journalToCandidatesList(rows, pendingUids);
  let shortlisted = 0;
  let interviews = 0;
  let go = 0;
  for (const c of candidates) {
    if (c.awaitingValidation) continue;
    // « Shortlisté » est un fait figé à l'analyse (CV au-dessus du seuil) :
    // il ne doit PAS varier selon les décisions DRH ultérieures (entretien,
    // GO, refus). On compte donc tous les candidats recommandés, point.
    if (c.recommendation === 'go') {
      shortlisted += 1;
    }
    if (c.interviewMarked === 'realized') interviews += 1;
    if (c.validationMarked === 'validated') go += 1;
  }
  const conversion = cvReceived > 0 ? Math.round((go / cvReceived) * 100) : 0;

  return {
    cvReceived,
    shortlisted,
    interviews,
    go,
    conversion,
    costEstimate: roundCurrency(cost),
    awaitingValidation: 0, // renseigné par la route depuis la file pending_validations
  };
}

// ─── Métriques par agent ───────────────────────────────────────────────

/**
 * Dérive les métriques par agent à partir du journal.
 *
 * `agentIds` filtre la sortie aux agents du registre — un agent sans
 * activité apparaît avec taskCount=0 (la maquette préfère afficher
 * l'agent en idle que de le cacher).
 *
 * `avgDurationMs` reste null pour cette session : la durée d'exécution
 * n'est pas encore loggée dans le journal. Le composant UI gère ce
 * null en affichant un tiret. La métrique sera réelle en Session 7.
 */
/**
 * Actions dont dérivent les métriques par agent. Dérivée de `ACTION_TO_AGENT` :
 * impossible de la laisser diverger, même raison que `ACTIVITY_FEED_ACTIONS`.
 */
export const AGENT_METRIC_ACTIONS: string[] = Object.keys(ACTION_TO_AGENT);

export function journalToAgentMetrics(
  rows: JournalEntry[],
  agentIds: string[],
): AgentMetric[] {
  type Acc = { count: number; failed: number; cost: number };
  const acc = new Map<string, Acc>();
  for (const id of agentIds) {
    acc.set(id, { count: 0, failed: 0, cost: 0 });
  }

  for (const row of rows) {
    const agentId = ACTION_TO_AGENT[row.action];
    if (!agentId) continue;
    const a = acc.get(agentId);
    if (!a) continue;
    a.count += 1;
    a.cost += COST_PER_ACTION[row.action] ?? 0;
    // Considéré comme un échec si le payload signale un statut d'erreur.
    const status = row.payload?.status;
    if (
      status === 'send_failed' ||
      status === 'skipped_no_email' ||
      status === 'skipped_no_config'
    ) {
      a.failed += 1;
    }
  }

  return agentIds.map((agentId) => {
    const a = acc.get(agentId)!;
    const successRate =
      a.count === 0 ? 100 : Math.round(((a.count - a.failed) / a.count) * 100);
    return {
      agentId,
      taskCount: a.count,
      avgDurationMs: null,
      successRate,
      costEstimate: roundCurrency(a.cost),
    };
  });
}

// ─── Métriques par campagne ────────────────────────────────────────────

export function journalToCampaignMetric(
  rows: JournalEntry[],
  campaignId: string,
): CampaignMetric {
  const scoped = rows.filter((r) => r.campaignId === campaignId);
  let candidates = 0;
  let shortlisted = 0;
  let invited = 0;
  let interviews = 0;
  const scores: number[] = [];

  for (const row of scoped) {
    if (row.action === 'imap_cv_received') candidates += 1;
    else if (row.action === 'imap_cv_analyzed') {
      if (row.payload?.aboveThreshold === true) shortlisted += 1;
      const s = row.payload?.score;
      if (typeof s === 'number') scores.push(s);
    } else if (row.action === 'imap_outreach_mail') {
      if (
        row.payload?.mode === 'invite' &&
        row.payload?.status === 'sent'
      )
        invited += 1;
    } else if (row.action === 'imap_outreach_brief') {
      if (row.payload?.status === 'sent') interviews += 1;
    }
  }

  return {
    candidates,
    shortlisted,
    invited,
    interviews,
    goCount: shortlisted,
    avgScore:
      scores.length > 0
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : null,
  };
}

// ─── Liste des candidats ───────────────────────────────────────────────

/**
 * Reconstruit la liste des candidats vue par le dashboard à partir du
 * journal. Un candidat = un évènement `imap_cv_analyzed` (sa réception
 * sans analyse n'est pas affichée). Le statut est dérivé des évènements
 * `imap_outreach_mail` / `imap_outreach_brief` postérieurs avec le même
 * UID — un message de l'UID donné qui passe `sent` fait avancer le
 * candidat à `invited`, puis à `interview_done` si un brief part.
 *
 * Pour l'instant on n'a pas de signal « réservation Cal.com confirmée »
 * dans le journal, donc on n'expose pas `scheduled` dynamiquement (on
 * réserve la valeur dans le type pour quand le signal arrivera).
 *
 * `pendingUids` (file HITL) ne FILTRE plus la liste : les analyses en attente
 * de validation sont retournées avec `awaitingValidation: true` — c'est le
 * lecteur qui décide (cartes campagne : comptées en « CV reçus » ; dashboard
 * résiduel + compteurs shortlisté/entretiens/GO : écartées jusqu'à l'envoi).
 */
export function journalToCandidatesList(
  rows: JournalEntry[],
  pendingUids: ReadonlySet<string> = new Set(),
): CandidateRow[] {
  type Acc = {
    uid: string;
    name: string;
    score: number;
    aboveThreshold: boolean;
    campaignId: string | null;
    receivedAt: string;
    invited: boolean;
    inviteSent: boolean;
    briefSent: boolean;
    rejectSent: boolean;
    /** Décision HITL ENVOYÉE (override l'issue de l'analyse). null si non gardé/non envoyé. */
    hitlDecision: 'accept' | 'reject' | null;
    interviewMarked: 'realized' | 'missed' | null;
    interviewMarkedAt: string | null;
    validationMarked: 'validated' | 'rejected' | null;
    validationMarkedAt: string | null;
  };

  const byUid = new Map<string, Acc>();

  // Pass 1 — UNE entrée par ANALYSE (uid). Chaque analyse est un traitement
  // DISTINCT : le même CV analysé N fois (même campagne) = N candidats, aucune
  // fusion. Le rapprochement HITL se fait par uid (exact, par traitement).
  for (const row of rows) {
    if (row.action !== 'imap_cv_analyzed') continue;
    const uid = String(row.payload?.uid ?? '');
    if (!uid) continue;
    byUid.set(uid, {
      uid,
      name: String(row.payload?.candidate ?? 'Candidat'),
      score: Number(row.payload?.score ?? 0),
      aboveThreshold: row.payload?.aboveThreshold === true,
      campaignId: row.campaignId,
      receivedAt: row.createdAt,
      invited: false,
      inviteSent: false,
      briefSent: false,
      rejectSent: false,
      hitlDecision: null,
      interviewMarked: null,
      interviewMarkedAt: null,
      validationMarked: null,
      validationMarkedAt: null,
    });
  }

  // Pass 2a — issue HITL ENVOYÉE, rattachée au candidat par UID (l'analyse
  // précise). Override l'analyse : un refus switché en acceptation puis envoyé
  // compte comme invité, et inversement.
  for (const row of rows) {
    if (row.action !== 'hitl_validation_sent') continue;
    const uid =
      typeof row.payload?.uid === 'string' ? row.payload.uid : '';
    if (!uid) continue;
    const entry = byUid.get(uid);
    if (!entry) continue;
    const decision = row.payload?.decision === 'accept' ? 'accept' : 'reject';
    entry.hitlDecision = decision;
    if (decision === 'accept') {
      entry.invited = true;
      entry.inviteSent = true;
    } else {
      entry.rejectSent = true;
    }
  }

  // Pass 2b — outreach + marquages DRH, rapprochés par uid.
  for (const row of rows) {
    const uid = String(row.payload?.uid ?? '');
    if (!uid) continue;
    const entry = byUid.get(uid);
    if (!entry) continue;
    if (row.action === 'imap_outreach_mail') {
      const mode = row.payload?.mode;
      const sent = row.payload?.status === 'sent';
      if (mode === 'invite') {
        entry.invited = true;
        if (sent) entry.inviteSent = true;
      } else if (mode === 'reject' && sent) {
        entry.rejectSent = true;
      }
    } else if (row.action === 'imap_outreach_brief') {
      if (row.payload?.status === 'sent') entry.briefSent = true;
    } else if (row.action === 'candidate_interview_marked') {
      const status = row.payload?.status;
      if (
        (status === 'realized' || status === 'missed') &&
        (entry.interviewMarkedAt == null ||
          row.createdAt > entry.interviewMarkedAt)
      ) {
        entry.interviewMarked = status;
        entry.interviewMarkedAt = row.createdAt;
      }
    } else if (row.action === 'candidate_validation_marked') {
      const status = row.payload?.status;
      if (
        (status === 'validated' || status === 'rejected') &&
        (entry.validationMarkedAt == null ||
          row.createdAt > entry.validationMarkedAt)
      ) {
        entry.validationMarked = status;
        entry.validationMarkedAt = row.createdAt;
      }
    }
  }

  return Array.from(byUid.values())
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
    .map<CandidateRow>((entry) => {
      // Statut affiché — pris dans l'ordre, EXCLUSIVEMENT piloté par
      // les actions explicites du DRH après l'analyse :
      //   1. « Entretien réalisé » → interview_done
      //   2. « Non réalisé »       → rejected
      //   3. Invite envoyée (auto) → invited
      //   4. Refus envoyé (auto)   → rejected
      //   5. sinon                 → analyzed
      //
      // Bug fixé v6 :
      //   - le brief DRH envoyé automatiquement faisait passer le
      //     candidat en « Entretien fait » avant même que le DRH
      //     clique sur « Entretien réalisé ». Plus le cas — seul le
      //     marker DRH déclenche maintenant cet état.
      //   - la validation « Non validé » faisait basculer le statut
      //     en « rejected », ce qui sortait le candidat du compteur
      //     « Entretiens » des candidats alors que la carte campagne
      //     comptait toujours (3 vs 4). Plus le cas — la validation
      //     pilote uniquement le badge GO, pas le statut d'entretien.
      let status: CandidateRow['status'];
      if (entry.interviewMarked === 'realized') {
        status = 'interview_done';
      } else if (entry.interviewMarked === 'missed') {
        status = 'rejected';
      } else if (entry.inviteSent) {
        status = 'invited';
      } else if (entry.rejectSent) {
        status = 'rejected';
      } else {
        status = 'analyzed';
      }
      // Recommandation : si une décision HITL a été ENVOYÉE, elle prime sur
      // l'analyse (un switch refus→accept envoyé = 'go'). Sinon, l'analyse.
      const recommendation: CandidateRow['recommendation'] =
        entry.hitlDecision === 'accept'
          ? 'go'
          : entry.hitlDecision === 'reject'
            ? null
            : entry.aboveThreshold
              ? 'go'
              : null;
      return {
        id: entry.uid,
        name: entry.name,
        initials: initialsOf(entry.name),
        score: entry.score,
        status,
        recommendation,
        role: null, // remplie côté API en croisant avec campaigns
        campaignId: entry.campaignId,
        receivedAt: entry.receivedAt,
        interviewMarked: entry.interviewMarked,
        validationMarked: entry.validationMarked,
        // HITL — en file de validation, mail non envoyé : la ligne n'est plus
        // EXCLUE (un CV reçu doit compter dans « CV reçus » des cartes
        // campagne) mais MARQUÉE — chaque lecteur choisit de l'afficher ou
        // non. Une fois envoyée (hitlDecision ≠ null), le flag retombe.
        awaitingValidation:
          entry.hitlDecision === null && pendingUids.has(entry.uid),
      };
    });
}

// ─── Flux d'activité ───────────────────────────────────────────────────

/**
 * Registre des évènements RENDUS par le fil d'activité.
 *
 * ⚠️ Ce registre est la SOURCE UNIQUE : la liste des actions chargées depuis la
 * base (`ACTIVITY_FEED_ACTIONS`) en dérive par `Object.keys`. C'était le vrai
 * défaut du 21/08/2026 — la route chargeait les 500 dernières lignes BRUTES du
 * journal puis jetait celles qu'elle ne savait pas rendre. Une action technique
 * bavarde (`imap_mailbox_skipped`, écrit à chaque relève sur une boîte en
 * timeout : 1 440 lignes/jour) remplissait la fenêtre et ÉVINÇAIT les
 * évènements métier derrière son bord. Mesuré : 475 lignes sur 500, le fil
 * demandait 50 items et en obtenait 11, et 37 des 50 derniers évènements
 * affichables étaient hors fenêtre. Le fil n'accumule rien côté client
 * (`useDashboardData` remplace l'état à chaque poll) : ce qui sort de la
 * fenêtre disparaît de l'écran.
 *
 * Deux règles qui en découlent, à ne pas défaire :
 *   1. la requête filtre sur CES actions — 50 items demandés, 50 obtenus, quel
 *      que soit le bruit technique du journal ;
 *   2. une entrée ici et un renderer sont la MÊME chose. Une liste maintenue à
 *      côté du `switch` finirait par diverger, et la divergence serait
 *      silencieuse : l'action resterait invisible sans qu'aucun test ne rougisse.
 *
 * Ce qui n'entre PAS dans le fil : les évènements techniques (échecs IMAP,
 * parses ratés, sauts de boîte) — ils vivent dans le journal et les écrans de
 * diagnostic ; et les évènements vivier (`vivier_invitation_sent`,
 * `vivier_application_matched`), dont le payload ne porte qu'un identifiant de
 * candidat : un fil qui annonce « invitation envoyée à 7f3a-… » est pire que
 * le silence. À rouvrir le jour où ces payloads porteront un nom.
 */
type FeedBase = Pick<ActivityItem, 'id' | 'time' | 'createdAt' | 'campaignId'>;
type FeedRenderer = (row: JournalEntry, base: FeedBase) => ActivityItem | null;

/** Nom lisible du candidat, quel que soit le champ utilisé par l'émetteur. */
function candidateNameOf(payload: Record<string, unknown> | undefined): string {
  for (const key of ['candidate', 'candidateName', 'attendeeName'] as const) {
    const value = payload?.[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return 'Candidat';
}

const ACTIVITY_RENDERERS: Record<string, FeedRenderer> = {
  imap_cv_analyzed: (row, base) => {
    const name = candidateNameOf(row.payload);
    const score = Number(row.payload?.score ?? 0);
    const aboveThreshold = row.payload?.aboveThreshold === true;
    return {
      ...base,
      message: `CV analysé — ${name} : ${score}%`,
      iconKey: 'cv',
      colorKey: aboveThreshold ? 'green' : score >= 60 ? 'orange' : 'red',
    };
  },

  demo_jobboard_application_sent: (row, base) => ({
    ...base,
    message: `Candidature déposée depuis l’annonce — ${candidateNameOf(row.payload)}`,
    iconKey: 'announce',
    colorKey: 'blue',
  }),

  imap_outreach_mail: (row, base) => {
    const name = candidateNameOf(row.payload);
    const mode = row.payload?.mode;
    const status = row.payload?.status;
    // Avertissement visible : aucun email exploitable dans le CV →
    // rien n'a été envoyé, le DRH doit reprendre la main.
    if (status === 'skipped_no_email') {
      return {
        ...base,
        message: `${mode === 'invite' ? 'Invitation' : 'Refus'} non envoyé — aucun email dans le CV de ${name}, à traiter manuellement`,
        iconKey: 'mail',
        colorKey: 'red',
      };
    }
    if (status !== 'sent') return null;
    if (mode === 'invite') {
      return {
        ...base,
        message: `Invitation envoyée à ${name}`,
        iconKey: 'mail',
        colorKey: 'blue',
      };
    }
    return {
      ...base,
      message: `Refus envoyé à ${name}`,
      iconKey: 'mail',
      colorKey: 'red',
    };
  },

  // Un dossier entre dans la file de validation humaine : c'est un fait
  // métier, pas une étape technique — c'est même le moment où le DRH a
  // quelque chose à faire.
  imap_outreach_pending: (row, base) => ({
    ...base,
    message: `${candidateNameOf(row.payload)} attend une validation`,
    iconKey: 'interview',
    colorKey: 'yellow',
  }),

  hitl_validation_sent: (row, base) => {
    const name = candidateNameOf(row.payload);
    // Le journal dit la vérité sur l'envoi : une décision prise dont le mail
    // n'est pas parti a son propre évènement (`hitl_mail_not_sent`), on ne
    // l'annonce donc pas comme un envoi réussi ici.
    if (row.payload?.mailSent !== true) return null;
    const accepted = row.payload?.decision === 'accept';
    return {
      ...base,
      message: accepted
        ? `Invitation envoyée à ${name} — après validation`
        : `Refus envoyé à ${name} — après validation`,
      iconKey: 'mail',
      colorKey: accepted ? 'blue' : 'red',
    };
  },

  hitl_mail_not_sent: (row, base) => ({
    ...base,
    message: `Décision prise sans envoi — ${candidateNameOf(row.payload)}${
      row.payload?.cause === 'skipped_by_user' ? ' (choix du recruteur)' : ' (envoi impossible)'
    }`,
    iconKey: 'mail',
    colorKey: 'orange',
  }),

  imap_outreach_brief: (row, base) => {
    if (row.payload?.status !== 'sent') return null;
    return {
      ...base,
      message: `Brief entretien préparé pour ${candidateNameOf(row.payload)}`,
      iconKey: 'calendar',
      colorKey: 'purple',
    };
  },

  interview_brief_queued: (row, base) => ({
    ...base,
    message: `Entretien à programmer — ${candidateNameOf(row.payload)}`,
    iconKey: 'calendar',
    colorKey: 'yellow',
  }),

  // Le candidat a choisi son créneau : c'est le fait le plus attendu du cycle.
  interview_brief_delivered: (row, base) => ({
    ...base,
    message: `Rendez-vous pris avec ${candidateNameOf(row.payload)}${formatSlot(row.payload?.startAt)}`,
    iconKey: 'calendar',
    colorKey: 'green',
  }),

  interview_brief_regenerated: (row, base) => ({
    ...base,
    message: `Rendez-vous pris avec ${candidateNameOf(row.payload)}${formatSlot(row.payload?.startAt)}`,
    iconKey: 'calendar',
    colorKey: 'green',
  }),

  interview_booking_rescheduled: (row, base) => ({
    ...base,
    message: `Rendez-vous déplacé — ${candidateNameOf(row.payload)}${formatSlot(row.payload?.startAt)}`,
    iconKey: 'calendar',
    colorKey: 'orange',
  }),

  interview_booking_cancelled: (row, base) => ({
    ...base,
    message: `Rendez-vous annulé — ${candidateNameOf(row.payload)}`,
    iconKey: 'calendar',
    colorKey: 'red',
  }),

  interview_link_reissued: (row, base) => ({
    ...base,
    message: `Nouveau créneau proposé à ${candidateNameOf(row.payload)}`,
    iconKey: 'calendar',
    colorKey: 'blue',
  }),

  candidate_interview_marked: (row, base) => {
    const name = candidateNameOf(row.payload);
    if (row.payload?.status === 'realized') {
      return {
        ...base,
        message: `Entretien réalisé avec ${name}`,
        iconKey: 'interview',
        colorKey: 'teal',
      };
    }
    return {
      ...base,
      message: `Entretien non réalisé — ${name}`,
      iconKey: 'interview',
      colorKey: 'orange',
    };
  },

  candidate_validation_marked: (row, base) => {
    const name = candidateNameOf(row.payload);
    if (row.payload?.status === 'validated') {
      return {
        ...base,
        message: `Validation définitive — ${name} (GO)`,
        iconKey: 'interview',
        colorKey: 'green',
      };
    }
    return {
      ...base,
      message: `Validation refusée — ${name}`,
      iconKey: 'interview',
      colorKey: 'red',
    };
  },

  candidature_dismissed: (row, base) => ({
    ...base,
    // Ton NEUTRE : « sans suite » n'est pas un refus, et le fil ne doit pas le
    // faire passer pour tel (cf. le 8e stage `sans_suite`).
    message: `Candidature classée sans suite — ${candidateNameOf(row.payload)}`,
    iconKey: 'archive',
    colorKey: 'yellow',
  }),

  campaign_report_sent: (_row, base) => ({
    ...base,
    message: `Rapport de campagne envoyé`,
    iconKey: 'report',
    colorKey: 'indigo',
  }),

  campaign_paused: (row, base) => ({
    ...base,
    message: `Campagne ${row.campaignId ?? ''} suspendue`,
    iconKey: 'pause',
    colorKey: 'yellow',
  }),

  campaign_resumed: (row, base) => ({
    ...base,
    message: `Campagne ${row.campaignId ?? ''} reprise`,
    iconKey: 'play',
    colorKey: 'green',
  }),

  campaign_closed: (row, base) => ({
    ...base,
    message: `Campagne ${row.campaignId ?? ''} clôturée`,
    iconKey: 'pause',
    colorKey: 'red',
  }),

  campaign_activated: (row, base) => ({
    ...base,
    message: `Campagne ${row.campaignId ?? ''} activée`,
    iconKey: 'rocket',
    colorKey: 'indigo',
  }),

  threshold_changed: (row, base) => ({
    ...base,
    message: `Seuil ajusté à ${row.payload?.threshold}%`,
    iconKey: 'edit',
    colorKey: 'orange',
  }),

  scoring_updated: (_row, base) => ({
    ...base,
    message: `Grille de scoring mise à jour`,
    iconKey: 'edit',
    colorKey: 'purple',
  }),

  channel_toggled: (row, base) => ({
    ...base,
    message: `Canal ${String(row.payload?.channel ?? '')} ${
      row.payload?.enabled === true ? 'activé' : 'désactivé'
    }`,
    iconKey: 'announce',
    colorKey: 'teal',
  }),

  job_writer_rendered: (row, base) => {
    const title = String(row.payload?.jobTitle ?? '');
    const channel = String(row.payload?.channel ?? '');
    return {
      ...base,
      message: `Annonce rédigée${title ? ' — ' + title : ''}${channel ? ' (' + channel + ')' : ''}`,
      iconKey: 'announce',
      colorKey: 'orange',
    };
  },

  campaign_created: (row, base) => ({
    ...base,
    message: `Nouvelle campagne créée${
      row.payload?.campaignName ? ' — ' + String(row.payload.campaignName) : ''
    }`,
    iconKey: 'rocket',
    colorKey: 'indigo',
  }),
};

/**
 * Les actions à CHARGER pour alimenter le fil. Dérivée du registre : impossible
 * de la laisser diverger des renderers, puisqu'elle EST leur liste de clés.
 */
export const ACTIVITY_FEED_ACTIONS: string[] = Object.keys(ACTIVITY_RENDERERS);

/** « à 14:30 » — chaîne vide si l'horodatage est absent ou illisible. */
function formatSlot(startAt: unknown): string {
  if (typeof startAt !== 'string') return '';
  const time = formatClockTime(startAt);
  return time === '—' ? '' : ` à ${time}`;
}

/**
 * Convertit les entrées du journal en messages métier pour la carte
 * « Activité en direct ». Le but : tout doit pouvoir se lire par un
 * DRH humain — pas d'identifiant technique, pas d'action_code brut.
 *
 * Un renderer peut encore rendre `null` (un envoi qui n'a pas abouti n'est pas
 * un envoi) : le filtre en base réduit le bruit, il ne remplace pas le jugement
 * sur le contenu de la ligne.
 */
export function journalToActivityFeed(
  rows: JournalEntry[],
  limit = 20,
): ActivityItem[] {
  const visible: ActivityItem[] = [];
  for (const row of rows) {
    const item = activityItemFor(row);
    if (item) visible.push(item);
    if (visible.length >= limit) break;
  }
  return visible;
}

function activityItemFor(row: JournalEntry): ActivityItem | null {
  const render = ACTIVITY_RENDERERS[row.action];
  if (!render) return null;
  return render(row, {
    id: row.id,
    time: formatClockTime(row.createdAt),
    createdAt: row.createdAt,
    campaignId: row.campaignId,
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────

function roundCurrency(amount: number): number {
  return Math.round(amount * 100) / 100;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatClockTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  } catch {
    return '—';
  }
}
