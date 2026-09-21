/**
 * Relocalisation des propositions vivier en attente — la « conversion » du
 * lot 4, et ce qu'elle N'EST PAS.
 *
 * La file « Validations vivier » disparaît. Les propositions qui y attendaient
 * ne sont PAS perdues : elles se retrouvent dans la recherche vivier de leur
 * campagne, là où l'inclusion se décide désormais sur place.
 *
 * ⚠️ AUCUNE DONNÉE NE CHANGE. Les lignes restent `identified`, avec leurs
 * dates et leur rang. Ce n'est pas une migration : c'est un DÉMÉNAGEMENT
 * D'ÉCRAN, et le seul écrit est une note au journal qui en garde la trace.
 * Changer leur état reviendrait à décider à la place de l'humain — or elles
 * attendent précisément sa décision.
 *
 * ⚠️ RIEN N'EST ENVOYÉ. La suite d'une proposition acceptée est une invitation
 * à candidater ; la déplacer d'un écran à l'autre ne doit en déclencher
 * aucune. Garde structurelle : ce module n'importe aucun émetteur.
 *
 * ⚠️ UNE CAMPAGNE CLÔTURÉE N'A PAS DE DESTINATION. Sa recherche vivier ne
 * s'ouvre pas : une proposition qui y attend n'a nulle part où réapparaître.
 * On ne la déclare donc PAS relocalisée — on la SIGNALE, et un humain tranche.
 * Écrire « déplacée » sur un dossier qu'on vient de rendre inatteignable
 * serait exactement le mensonge que ce lot doit supprimer.
 */

export type PendingProposal = {
  campaignId: string;
  candidateId: string;
  /** Date de génération de la proposition. */
  generatedAt: string;
};

export type CampaignStatusLookup = (
  campaignId: string,
) => 'active' | 'paused' | 'draft' | 'in_progress' | 'closed' | 'unknown';

/** Une campagne dont la recherche vivier peut s'ouvrir. */
function aUneDestination(statut: ReturnType<CampaignStatusLookup>): boolean {
  return statut !== 'closed' && statut !== 'unknown';
}

export type RelocationGroup = {
  campaignId: string;
  count: number;
  /** La plus ancienne des propositions du groupe. */
  oldestGeneratedAt: string;
};

export type RelocationPlan = {
  /** Groupes à noter : leur campagne peut les rouvrir. */
  toNote: RelocationGroup[];
  /** Déjà notés lors d'un passage précédent — on ne renote pas. */
  alreadyNoted: RelocationGroup[];
  /**
   * Sans destination (campagne clôturée ou introuvable). JAMAIS notés comme
   * relocalisés : ils attendent un arbitrage humain.
   */
  stranded: RelocationGroup[];
};

/**
 * Le plan, PUR : on décide avant d'écrire, et on peut le regarder sans base.
 *
 * Idempotent par construction : un groupe déjà noté ressort dans
 * `alreadyNoted`, jamais dans `toNote`. Rejouer ne produit aucune seconde
 * note — une trace en double ferait croire à deux déménagements.
 */
export function planRelocation(
  pending: readonly PendingProposal[],
  statusOf: CampaignStatusLookup,
  /** Campagnes déjà notées (lecture du journal). */
  noted: ReadonlySet<string>,
): RelocationPlan {
  const groupes = new Map<string, RelocationGroup>();
  for (const p of pending) {
    const g = groupes.get(p.campaignId);
    if (!g) {
      groupes.set(p.campaignId, {
        campaignId: p.campaignId,
        count: 1,
        oldestGeneratedAt: p.generatedAt,
      });
      continue;
    }
    g.count += 1;
    if (p.generatedAt < g.oldestGeneratedAt) g.oldestGeneratedAt = p.generatedAt;
  }

  const plan: RelocationPlan = { toNote: [], alreadyNoted: [], stranded: [] };
  // Ordre STABLE (par campagne) : deux exécutions produisent le même rapport,
  // et une différence se lit alors comme un vrai changement.
  for (const g of [...groupes.values()].sort((a, b) =>
    a.campaignId.localeCompare(b.campaignId),
  )) {
    if (!aUneDestination(statusOf(g.campaignId))) plan.stranded.push(g);
    else if (noted.has(g.campaignId)) plan.alreadyNoted.push(g);
    else plan.toNote.push(g);
  }
  return plan;
}

/** Action de journal de la note de migration. */
export const VIVIER_RELOCATION_ACTION = 'vivier_preselection_relocated';

/**
 * La note, PURE.
 *
 * ⚠️ Elle ne porte AUCUN identifiant de candidat. Le journal est pseudonymisé
 * à la purge RGPD, et une liste d'identifiants de dossiers vivier y créerait
 * une obligation d'effacement pour une information qui n'apprend rien : le
 * détail vit dans `vivier_preselections`, qui n'a pas bougé. La note prouve le
 * déménagement, elle ne le recopie pas.
 */
export function buildRelocationNote(group: RelocationGroup): {
  action: string;
  campaignId: string;
  actor: string;
  payload: Record<string, unknown>;
} {
  return {
    action: VIVIER_RELOCATION_ACTION,
    campaignId: group.campaignId,
    actor: 'system',
    payload: {
      count: group.count,
      oldestGeneratedAt: group.oldestGeneratedAt,
      // D'où elles viennent et où elles vont, en clair : dans six mois, la
      // ligne de journal doit se comprendre sans rouvrir ce fichier.
      from: 'file « Validations vivier » (retirée)',
      to: 'recherche vivier de la campagne',
      note: "Propositions en attente conservées à l'identique : aucun état modifié, aucune invitation envoyée.",
    },
  };
}

// ── Exécution ───────────────────────────────────────────────────────────────

/**
 * Lit, planifie, et n'écrit QUE si on le lui demande.
 *
 * Le défaut est le CONSTAT : `execute: false` rend le plan sans toucher à
 * rien. C'est la même règle que la purge RGPD — on regarde ce qui va se passer
 * avant que ça se passe.
 *
 * Les notes sont écrites UNE PAR CAMPAGNE, séquentiellement. Un échec n'arrête
 * pas les suivantes : la campagne reste non notée, donc reprise au prochain
 * passage (l'idempotence est portée par la lecture du journal, pas par un
 * marqueur qu'on poserait ici).
 */
export async function relocateVivierProposals(options: {
  execute: boolean;
}): Promise<{ plan: RelocationPlan; written: number; failed: number }> {
  const [{ listPendingPreselections }, { listCampaignSummaries }, { listJournalEntriesByActions }] =
    await Promise.all([
      import('@/lib/db/repos/vivier-preselection'),
      import('@/lib/db/repos/campaigns'),
      import('@/lib/db/repos/journal'),
    ]);

  const pending = await listPendingPreselections();
  if (pending.length === 0) {
    return { plan: { toNote: [], alreadyNoted: [], stranded: [] }, written: 0, failed: 0 };
  }

  const ids = [...new Set(pending.map((p) => p.campaignId))];
  const [summaries, journal] = await Promise.all([
    listCampaignSummaries(ids),
    listJournalEntriesByActions([VIVIER_RELOCATION_ACTION]),
  ]);

  const noted = new Set(
    journal.map((e) => e.campaignId).filter((id): id is string => id !== null),
  );
  const plan = planRelocation(
    pending,
    (id) => summaries.get(id)?.status ?? 'unknown',
    noted,
  );

  if (!options.execute) return { plan, written: 0, failed: 0 };

  const { appendJournalEntry } = await import('@/lib/db/repos/journal');
  let written = 0;
  let failed = 0;
  for (const group of plan.toNote) {
    try {
      await appendJournalEntry(buildRelocationNote(group));
      written += 1;
    } catch {
      failed += 1;
    }
  }
  return { plan, written, failed };
}
