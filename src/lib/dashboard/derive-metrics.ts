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
};

// ─── Mapping action → agent ────────────────────────────────────────────

const ACTION_TO_AGENT: Record<string, string> = {
  imap_cv_analyzed: 'agent.cv-analyzer',
  imap_outreach_mail: 'agent.mail-composer',
  imap_outreach_brief: 'agent.mail-composer',
  job_writer_rendered: 'agent.job-writer',
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

export type ActivityIconKey =
  | 'cv'
  | 'mail'
  | 'calendar'
  | 'interview'
  | 'announce'
  | 'rocket'
  | 'pause'
  | 'play'
  | 'edit';

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
export function journalToGlobalKPIs(rows: JournalEntry[]): GlobalKPIs {
  let cvReceived = 0;
  let cost = 0;

  for (const row of rows) {
    const c = COST_PER_ACTION[row.action];
    if (c) cost += c;
    if (row.action === 'imap_cv_received') cvReceived += 1;
  }

  // Dérive l'état candidat depuis le journal (pass complet pour
  // capturer les boutons « réalisé/validé »).
  const candidates = journalToCandidatesList(rows);
  let shortlisted = 0;
  let interviews = 0;
  let go = 0;
  for (const c of candidates) {
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
 */
export function journalToCandidatesList(
  rows: JournalEntry[],
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
    interviewMarked: 'realized' | 'missed' | null;
    interviewMarkedAt: string | null;
    validationMarked: 'validated' | 'rejected' | null;
    validationMarkedAt: string | null;
  };

  const byUid = new Map<string, Acc>();

  // Pass 1 — créer une entrée par analyse.
  for (const row of rows) {
    if (row.action !== 'imap_cv_analyzed') continue;
    const uid = String(row.payload?.uid ?? '');
    if (!uid) continue;
    const name = String(row.payload?.candidate ?? 'Candidat');
    const score = Number(row.payload?.score ?? 0);
    const aboveThreshold = row.payload?.aboveThreshold === true;
    byUid.set(uid, {
      uid,
      name,
      score,
      aboveThreshold,
      campaignId: row.campaignId,
      receivedAt: row.createdAt,
      invited: false,
      inviteSent: false,
      briefSent: false,
      rejectSent: false,
      interviewMarked: null,
      interviewMarkedAt: null,
      validationMarked: null,
      validationMarkedAt: null,
    });
  }

  // Pass 2 — enrichir avec les évènements d'outreach et les marquages DRH.
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
      return {
        id: entry.uid,
        name: entry.name,
        initials: initialsOf(entry.name),
        score: entry.score,
        status,
        recommendation: entry.aboveThreshold ? 'go' : null,
        role: null, // remplie côté API en croisant avec campaigns
        campaignId: entry.campaignId,
        receivedAt: entry.receivedAt,
        interviewMarked: entry.interviewMarked,
        validationMarked: entry.validationMarked,
      };
    });
}

// ─── Flux d'activité ───────────────────────────────────────────────────

/**
 * Convertit les entrées du journal en messages métier pour la carte
 * « Activité en direct ». Le but : tout doit pouvoir se lire par un
 * DRH humain — pas d'identifiant technique, pas d'action_code brut.
 *
 * Les types d'évènements jugés trop techniques (échecs IMAP, parses
 * ratés) sont volontairement filtrés. Le bug correspondant remonte
 * dans Sentry / la console, pas dans la timeline visible.
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
  const time = formatClockTime(row.createdAt);
  const base = { id: row.id, time, createdAt: row.createdAt, campaignId: row.campaignId };

  switch (row.action) {
    case 'imap_cv_analyzed': {
      const name = String(row.payload?.candidate ?? 'Candidat');
      const score = Number(row.payload?.score ?? 0);
      const aboveThreshold = row.payload?.aboveThreshold === true;
      return {
        ...base,
        message: `CV analysé — ${name} : ${score}%`,
        iconKey: 'cv',
        colorKey: aboveThreshold ? 'green' : score >= 60 ? 'orange' : 'red',
      };
    }
    case 'imap_outreach_mail': {
      const name = String(row.payload?.candidate ?? 'un candidat');
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
    }
    case 'imap_outreach_brief': {
      const name = String(row.payload?.candidate ?? 'un candidat');
      if (row.payload?.status !== 'sent') return null;
      return {
        ...base,
        message: `Brief entretien préparé pour ${name}`,
        iconKey: 'calendar',
        colorKey: 'purple',
      };
    }
    case 'campaign_paused':
      return {
        ...base,
        message: `Campagne ${row.campaignId ?? ''} suspendue`,
        iconKey: 'pause',
        colorKey: 'yellow',
      };
    case 'campaign_resumed':
      return {
        ...base,
        message: `Campagne ${row.campaignId ?? ''} reprise`,
        iconKey: 'play',
        colorKey: 'green',
      };
    case 'campaign_closed':
      return {
        ...base,
        message: `Campagne ${row.campaignId ?? ''} clôturée`,
        iconKey: 'pause',
        colorKey: 'red',
      };
    case 'campaign_activated':
      return {
        ...base,
        message: `Campagne ${row.campaignId ?? ''} activée`,
        iconKey: 'rocket',
        colorKey: 'indigo',
      };
    case 'threshold_changed': {
      const next = row.payload?.threshold;
      return {
        ...base,
        message: `Seuil ajusté à ${next}%`,
        iconKey: 'edit',
        colorKey: 'orange',
      };
    }
    case 'scoring_updated':
      return {
        ...base,
        message: `Grille de scoring mise à jour`,
        iconKey: 'edit',
        colorKey: 'purple',
      };
    case 'channel_toggled': {
      const ch = String(row.payload?.channel ?? '');
      const enabled = row.payload?.enabled === true;
      return {
        ...base,
        message: `Canal ${ch} ${enabled ? 'activé' : 'désactivé'}`,
        iconKey: 'announce',
        colorKey: 'teal',
      };
    }
    case 'candidate_interview_marked': {
      const name = String(row.payload?.candidate ?? 'Candidat');
      const status = row.payload?.status;
      if (status === 'realized') {
        return {
          ...base,
          message: `Entretien réalisé — ${name}`,
          iconKey: 'interview',
          colorKey: 'teal',
        };
      }
      return {
        ...base,
        message: `Entretien marqué comme non réalisé — ${name}`,
        iconKey: 'interview',
        colorKey: 'orange',
      };
    }
    case 'candidate_validation_marked': {
      const name = String(row.payload?.candidate ?? 'Candidat');
      const status = row.payload?.status;
      if (status === 'validated') {
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
    }
    case 'job_writer_rendered': {
      const title = String(row.payload?.jobTitle ?? '');
      const channel = String(row.payload?.channel ?? '');
      return {
        ...base,
        message: `Annonce rédigée${title ? ' — ' + title : ''}${channel ? ' (' + channel + ')' : ''}`,
        iconKey: 'announce',
        colorKey: 'orange',
      };
    }
    case 'campaign_created':
      return {
        ...base,
        message: `Nouvelle campagne créée${row.payload?.campaignName ? ' — ' + String(row.payload.campaignName) : ''}`,
        iconKey: 'rocket',
        colorKey: 'indigo',
      };
    default:
      return null;
  }
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
