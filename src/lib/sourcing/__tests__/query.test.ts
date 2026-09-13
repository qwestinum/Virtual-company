/**
 * Génération de requête — les cinq fiches types de l'étude (spec §3.4) et les
 * trois fiches mesurées (§3.3). Aucun appel LLM : le générateur (b) est
 * remplacé par un faux fournisseur, et c'est la décision (accepter / replier)
 * qui est testée, pas la prose d'un modèle.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ai/provider', () => ({ chatCompleteJson: vi.fn() }));

import { chatCompleteJson } from '@/lib/ai/provider';
import { deterministicQuery, stripAmorces } from '@/lib/sourcing/query-deterministic';
import { FEW_SHOTS, validateGeneratedQuery } from '@/lib/sourcing/query-prompt';
import { generateSourcingQuery } from '@/lib/sourcing/server/generate-query';
import type { QueryFicheInput } from '@/types/sourcing';

const crit = (level: string, label: string, keywords?: string[]) => ({
  id: label.slice(0, 12),
  level,
  label,
  ...(keywords ? { keywords } : {}),
});

/** Les cinq fiches types — mêmes libellés que les exemples du prompt. */
const TYPES: Record<string, QueryFicheInput> = {
  amoa: {
    jobTitle: 'Consultant AMOA Trade Finance (H/F)',
    seniority: 'senior',
    location: 'Paris La Défense',
    criteria: [
      crit('critique', 'Expérience de 8 ans minimum en AMOA sur les métiers de financement du commerce international'),
      crit('critique', 'Maîtrise des crédits documentaires et garanties internationales'),
      crit('tres_important', 'Connaissance des messages SWIFT MT7xx'),
      crit('important', 'Anglais courant'),
      crit('souhaitable', "Esprit d'équipe"),
    ],
  },
  fullstack: {
    jobTitle: 'Développeur Full Stack JS – Pôle Assurance Vie',
    seniority: 'confirmé',
    location: 'Lyon (69)',
    criteria: [
      crit('critique', 'Maîtrise de TypeScript, React et Node.js'),
      crit('critique', "Expérience dans le secteur de l'assurance"),
      crit('tres_important', "Conception d'API REST"),
      crit('tres_important', 'Utilisation de Git'),
      crit('important', 'Autonomie et rigueur'),
    ],
  },
  paie: {
    jobTitle: 'Responsable Paie & ADP',
    seniority: 'confirmé',
    location: 'Boulogne-Billancourt',
    criteria: [
      crit('redhibitoire', 'Autorisation de travail en France'),
      crit('critique', "5 ans d'expérience minimum en gestion de la paie multi-conventions"),
      crit('critique', 'Maîtrise de la convention collective Syntec'),
      crit('tres_important', "Pratique d'un logiciel de paie (ADP, Silae ou SAP HR)"),
      crit('important', "Management d'une équipe de 3 gestionnaires"),
    ],
  },
  dataProtection: {
    jobTitle: 'Project Manager – Data Protection',
    seniority: 'confirmé',
    location: 'Nanterre',
    criteria: [
      crit('critique', 'Piloter le programme Data Protection'),
      crit('critique', 'Structurer, cadrer et mettre en œuvre les initiatives visant à protéger les données critiques'),
      crit('tres_important', 'Élaborer le business case, ROI, plan de ressources, risques, budget et planning'),
      crit('important', 'Cadrage et déploiement des technologies (chiffrement, DLP, IAM, etc.)'),
    ],
  },
  recrutement: {
    jobTitle: 'Chargé(e) de recrutement IT – CDD 6 mois',
    seniority: 'junior',
    location: 'Télétravail 100 %',
    criteria: [
      crit('critique', 'Sourcing de profils techniques (développeurs, DevOps)'),
      crit('tres_important', 'Expérience en cabinet de recrutement'),
      crit('tres_important', 'Disponibilité immédiate'),
      crit('important', 'Excellent relationnel'),
    ],
  },
};

const covered = (fiche: QueryFicheInput, out: { encoded: string[]; notEncoded: { label: string }[] }) =>
  new Set([...out.encoded, ...out.notEncoded.map((n) => n.label)]).size === fiche.criteria.length;

describe('repli (a) — les cinq fiches types', () => {
  for (const [name, fiche] of Object.entries(TYPES)) {
    it(`${name} : chaque critère a un sort, rien d'administratif ni de savoir-être n'est cherché`, () => {
      const out = deterministicQuery(fiche);
      expect(covered(fiche, out)).toBe(true);
      expect(out.query).not.toMatch(/\(h\/f\)|autorisation|disponibilit|rigueur|relationnel|esprit d'équipe|anglais/i);
      expect(out.query).toMatch(/basé (?:à|en) /);
      expect(out.encoded.length).toBeLessThanOrEqual(5);
    });
  }

  it('écrit les années quand la fiche les porte, jamais sinon', () => {
    expect(deterministicQuery(TYPES.amoa!).query).toContain("8 ans d'expérience");
    expect(deterministicQuery(TYPES.paie!).query).toContain("5 ans d'expérience");
    expect(deterministicQuery(TYPES.fullstack!).query).not.toMatch(/\bans\b/);
  });

  it('une fiche sans ville (« Télétravail ») cherche « basé en France »', () => {
    expect(deterministicQuery(TYPES.recrutement!).query).toMatch(/basé en France$/);
  });

  it('le lieu est nettoyé (« Lyon (69) » → « Lyon »)', () => {
    expect(deterministicQuery(TYPES.fullstack!).query).toMatch(/basé à Lyon$/);
  });
});

describe('repli (a) — les défauts observés sur les fiches mesurées sont corrigés (§3.3)', () => {
  const directeur: QueryFicheInput = {
    jobTitle: 'Directeur de Département Opérations Industrielles (H/F)',
    seniority: 'confirmé',
    location: 'Site principal de Belfort (90)',
    criteria: [
      crit('critique', 'Expérience confirmée de 10 à 15 ans'),
      crit('critique', 'Expérience d’une transformation industrielle ou d’un projet d’automatisation majeur'),
      crit('tres_important', 'Solide culture de l’excellence opérationnelle'),
      crit('tres_important', 'Maîtrise du pilotage de la performance industrielle'),
      crit('important', 'Leadership et capacité à fédérer'),
    ],
  };
  const backend: QueryFicheInput = {
    jobTitle: 'développeur back end',
    seniority: 'confirmé',
    location: 'Télétravail partiel',
    criteria: [
      crit('critique', 'Maîtrise de Node.js ou Python', ['Node.js', 'Node', 'Python']),
      crit('critique', "Expérience en développement d'API RESTful", ['API RESTful', 'REST API', 'API']),
      crit('tres_important', 'Utilisation de Git', ['Git']),
    ],
  };

  it('intitulé débarrassé de « (H/F) » et de « de Département », années et lieu en clair', () => {
    const q = deterministicQuery(directeur).query;
    expect(q).toMatch(/^Directeur Opérations Industrielles confirmé, 10 à 15 ans d'expérience/);
    expect(q).not.toMatch(/l[’']excellence|Département|\(H\/F\)/);
    expect(q).toMatch(/basé à Belfort$/);
  });

  it('pas de mot-clé redondant (« Node.js ou Node »), Git écarté comme générique', () => {
    const out = deterministicQuery(backend);
    expect(out.query).toContain('Node.js ou Python');
    expect(out.query).not.toContain('Node.js ou Node');
    expect(out.notEncoded.map((n) => n.label)).toContain('Utilisation de Git');
    expect(out.query).toMatch(/basé en France$/);
  });

  it('les amorces tombent, le sens reste', () => {
    expect(stripAmorces('Solide culture de l’excellence opérationnelle')).toBe('excellence opérationnelle');
    expect(stripAmorces('Maîtrise de SQL (exigée)')).toBe('SQL');
  });
});

describe('générateur (b) — validation de sortie', () => {
  it('les cinq exemples du prompt respectent les règles qu’on impose au modèle', () => {
    const fiches = [TYPES.amoa!, TYPES.fullstack!, TYPES.paie!, TYPES.dataProtection!, TYPES.recrutement!];
    FEW_SHOTS.forEach((shot, i) => {
      expect(validateGeneratedQuery(shot.out, fiches[i]!)).toEqual({ ok: true });
    });
  });

  it('accepte une requête de 14 mots conforme (cas constaté en dev : elle était remplacée par un repli plus court)', () => {
    const fiche = TYPES.fullstack!;
    const ok = FEW_SHOTS[1]!.out;
    const fourteen = 'Développeur full-stack confirmé TypeScript React et Node.js, API REST, secteur assurance, basé à Lyon';
    expect(fourteen.split(/\s+/)).toHaveLength(14);
    expect(validateGeneratedQuery({ ...ok, query: fourteen }, fiche)).toEqual({ ok: true });
  });

  it('refuse une requête trop courte, un critère oublié, un critère inventé, un opérateur', () => {
    const fiche = TYPES.fullstack!;
    const ok = FEW_SHOTS[1]!.out;
    expect(validateGeneratedQuery({ ...ok, query: 'Développeur React Lyon' }, fiche).ok).toBe(false);
    expect(validateGeneratedQuery({ ...ok, notEncoded: ok.notEncoded.slice(1) }, fiche).ok).toBe(false);
    expect(validateGeneratedQuery({ ...ok, encoded: [...ok.encoded, 'Kubernetes'] }, fiche).ok).toBe(false);
    expect(validateGeneratedQuery({ ...ok, query: `${ok.query} AND Vue.js` }, fiche).ok).toBe(false);
  });
});

describe('generateSourcingQuery — (b) accepté, ou repli (a) dit à l’écran', () => {
  const mocked = vi.mocked(chatCompleteJson);
  const raw = { model: 'gpt-4o-mini-2024-07-18', costEstimate: 0, usage: { promptTokens: 1500, completionTokens: 120, totalTokens: 1620 }, content: '', durationMs: 900 };

  // Aucun `beforeEach(mockReset | mockClear)` : constaté sous vitest 4.1, une
  // réinitialisation suivie d'un rejet du mock fait échouer le test alors que
  // le code sous test l'attrape (vérifié : repli rendu, aucune exception). Chaque
  // test pose donc sa propre implémentation « Once ».

  it('sortie valide ⇒ méthode llm, coût calculé malgré le nom de modèle daté', async () => {
    mocked.mockResolvedValueOnce({ data: FEW_SHOTS[1]!.out, raw, attempts: 1 } as never);
    const g = await generateSourcingQuery(TYPES.fullstack!, 'fr');
    expect(g.method).toBe('llm');
    expect(g.fallbackReason).toBeNull();
    expect(g.llmCostUsd).toBeGreaterThan(0);
  });

  it('sortie invalide ⇒ repli déterministe, avec la raison', async () => {
    mocked.mockResolvedValueOnce({ data: { ...FEW_SHOTS[1]!.out, query: 'Dev Lyon' }, raw, attempts: 1 } as never);
    const g = await generateSourcingQuery(TYPES.fullstack!, 'fr');
    expect(g.method).toBe('deterministic');
    expect(g.fallbackReason).toMatch(/mots/);
    expect(g.query).toBe(deterministicQuery(TYPES.fullstack!).query);
  });

  it('panne du fournisseur ⇒ repli ; en anglais, le repli DIT qu’il est resté en français', async () => {
    mocked.mockRejectedValueOnce(new Error('transport'));
    const g = await generateSourcingQuery(TYPES.fullstack!, 'en');
    expect(g.method).toBe('deterministic');
    expect(g.language).toBe('fr');
    expect(g.fallbackReason).toMatch(/français/);
  });

  it('fiche sans critère ⇒ aucun appel au modèle', async () => {
    const before = mocked.mock.calls.length;
    const g = await generateSourcingQuery({ ...TYPES.fullstack!, criteria: [] }, 'fr');
    expect(mocked.mock.calls.length).toBe(before);
    expect(g.method).toBe('deterministic');
  });
});
