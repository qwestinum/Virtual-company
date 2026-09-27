import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildRelocationNote,
  planRelocation,
  VIVIER_RELOCATION_ACTION,
  type CampaignStatusLookup,
  type PendingProposal,
} from '@/lib/vivier/relocation';

const p = (
  campaignId: string,
  candidateId: string,
  generatedAt: string,
): PendingProposal => ({ campaignId, candidateId, generatedAt });

const statuts =
  (map: Record<string, ReturnType<CampaignStatusLookup>>): CampaignStatusLookup =>
  (id) =>
    map[id] ?? 'unknown';

describe('le plan groupe par campagne et date le plus ancien', () => {
  it('un groupe par campagne, la plus ancienne date retenue', () => {
    const plan = planRelocation(
      [
        p('CAMP-A', 'c1', '2026-09-10T08:00:00.000Z'),
        p('CAMP-A', 'c2', '2026-09-02T08:00:00.000Z'),
        p('CAMP-B', 'c3', '2026-09-05T08:00:00.000Z'),
      ],
      statuts({ 'CAMP-A': 'active', 'CAMP-B': 'paused' }),
      new Set(),
    );
    expect(plan.toNote).toHaveLength(2);
    const a = plan.toNote.find((g) => g.campaignId === 'CAMP-A')!;
    expect(a.count).toBe(2);
    expect(a.oldestGeneratedAt).toBe('2026-09-02T08:00:00.000Z');
  });

  it('ordre STABLE : deux exécutions rendent le même rapport', () => {
    const entree = [p('CAMP-Z', 'c1', '2026-09-01T00:00:00.000Z'), p('CAMP-A', 'c2', '2026-09-01T00:00:00.000Z')];
    const faire = () =>
      planRelocation(entree, statuts({ 'CAMP-A': 'active', 'CAMP-Z': 'active' }), new Set())
        .toNote.map((g) => g.campaignId);
    expect(faire()).toEqual(['CAMP-A', 'CAMP-Z']);
    expect(faire()).toEqual(faire());
  });

  it('rien en attente ⇒ plan vide, aucune écriture', () => {
    const plan = planRelocation([], statuts({}), new Set());
    expect(plan.toNote).toEqual([]);
    expect(plan.alreadyNoted).toEqual([]);
    expect(plan.stranded).toEqual([]);
  });
});

describe('idempotence — rejouer ne renote jamais', () => {
  it('une campagne déjà notée sort en « déjà noté »', () => {
    // Une trace en double ferait croire à deux déménagements.
    const entree = [p('CAMP-A', 'c1', '2026-09-01T00:00:00.000Z')];
    const plan = planRelocation(
      entree,
      statuts({ 'CAMP-A': 'active' }),
      new Set(['CAMP-A']),
    );
    expect(plan.toNote).toEqual([]);
    expect(plan.alreadyNoted).toHaveLength(1);
  });

  it('le second passage suivant le premier n’écrit plus rien', () => {
    const entree = [p('CAMP-A', 'c1', '2026-09-01T00:00:00.000Z')];
    const premier = planRelocation(entree, statuts({ 'CAMP-A': 'active' }), new Set());
    const notees = new Set(premier.toNote.map((g) => g.campaignId));
    const second = planRelocation(entree, statuts({ 'CAMP-A': 'active' }), notees);
    expect(second.toNote).toEqual([]);
  });
});

describe('une campagne sans destination n’est JAMAIS déclarée relocalisée', () => {
  it('campagne CLÔTURÉE : signalée, pas notée', () => {
    // Sa recherche vivier ne s'ouvre pas : la proposition n'a nulle part où
    // réapparaître. Écrire « déplacée » sur un dossier qu'on vient de rendre
    // inatteignable serait le mensonge que ce lot doit supprimer.
    const plan = planRelocation(
      [p('CAMP-CLOSED', 'c1', '2026-09-01T00:00:00.000Z')],
      statuts({ 'CAMP-CLOSED': 'closed' }),
      new Set(),
    );
    expect(plan.toNote).toEqual([]);
    expect(plan.stranded).toHaveLength(1);
    expect(plan.stranded[0]!.campaignId).toBe('CAMP-CLOSED');
  });

  it('campagne INTROUVABLE : même traitement — on ne devine pas', () => {
    const plan = planRelocation(
      [p('CAMP-FANTOME', 'c1', '2026-09-01T00:00:00.000Z')],
      statuts({}),
      new Set(),
    );
    expect(plan.stranded).toHaveLength(1);
  });

  it('une campagne clôturée DÉJÀ notée reste signalée', () => {
    // La note d'un passage antérieur ne rend pas sa destination valide.
    const plan = planRelocation(
      [p('CAMP-CLOSED', 'c1', '2026-09-01T00:00:00.000Z')],
      statuts({ 'CAMP-CLOSED': 'closed' }),
      new Set(['CAMP-CLOSED']),
    );
    expect(plan.stranded).toHaveLength(1);
    expect(plan.alreadyNoted).toEqual([]);
  });

  it('brouillon, suspendue, en cours : destinations VALIDES', () => {
    // Leur recherche vivier s'ouvre. Seule la clôture ferme la porte.
    for (const statut of ['draft', 'in_progress', 'paused', 'active'] as const) {
      const plan = planRelocation(
        [p('CAMP-X', 'c1', '2026-09-01T00:00:00.000Z')],
        statuts({ 'CAMP-X': statut }),
        new Set(),
      );
      expect(plan.toNote, statut).toHaveLength(1);
    }
  });
});

describe('la note dit ce qui s’est passé, sans nommer personne', () => {
  const note = buildRelocationNote({
    campaignId: 'CAMP-A',
    count: 3,
    oldestGeneratedAt: '2026-09-02T08:00:00.000Z',
  });

  it('porte l’action, la campagne et le compte', () => {
    expect(note.action).toBe(VIVIER_RELOCATION_ACTION);
    expect(note.campaignId).toBe('CAMP-A');
    expect(note.payload.count).toBe(3);
    expect(note.payload.oldestGeneratedAt).toBe('2026-09-02T08:00:00.000Z');
  });

  it('ne porte AUCUN identifiant de candidat', () => {
    // Le journal est pseudonymisé à la purge RGPD : une liste d'identifiants
    // de dossiers vivier y créerait une obligation d'effacement pour une
    // information qui n'apprend rien — le détail vit dans la table, qui n'a
    // pas bougé.
    const brut = JSON.stringify(note.payload);
    expect(brut).not.toContain('candidateId');
    expect(brut).not.toContain('candidate_id');
    expect(brut).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });

  it('se comprend dans six mois sans rouvrir le code', () => {
    expect(String(note.payload.from)).toContain('Validations vivier');
    expect(String(note.payload.to)).toContain('recherche vivier');
    expect(String(note.payload.note)).toContain('aucun état modifié');
  });
});

// ── Gardes STRUCTURELLES ────────────────────────────────────────────────────

const lire = (chemin: string): string =>
  readFileSync(resolve(process.cwd(), chemin), 'utf-8');

describe('le déménagement n’envoie rien et ne change rien', () => {
  const SRC = 'src/lib/vivier/relocation.ts';

  it('aucun émetteur importé', () => {
    // La suite d'une proposition acceptée est une invitation à candidater.
    // La déplacer d'un écran à l'autre ne doit en déclencher aucune.
    for (const emetteur of [
      'sendEmail',
      'autoContactIfEnabled',
      'invitation-send',
      'markContacted',
      'lib/email',
    ]) {
      expect(lire(SRC), emetteur).not.toContain(emetteur);
    }
  });

  it('aucune écriture d’état de proposition', () => {
    // Les lignes restent `identified` : elles attendent une décision humaine,
    // et la prendre à sa place est exactement ce qu'on s'interdit.
    const src = lire(SRC);
    expect(src).not.toContain("'contacted'");
    expect(src).not.toContain("'rejected'");
    expect(src).not.toContain('update(');
    expect(src).not.toContain('upsert(');
  });
});
