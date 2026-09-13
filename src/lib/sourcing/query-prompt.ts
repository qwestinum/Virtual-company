/**
 * Générateur de requête (b) — prompt, exemples, validation. PUR.
 * Spec : docs/specs/sourcing.md §3.4 (prompt et exemples retenus).
 *
 * Le prompt et ses cinq exemples sont ceux de l'étude du 13/09/2026, à la
 * langue près : la bascule FR/EN demande la requête dans la langue choisie.
 * Toute retouche se mesure (protocole §3.1) avant de s'appliquer.
 */
import { z } from 'zod';

import type { QueryFicheInput, SourcingLanguage } from '@/types/sourcing';

export const GeneratedQuerySchema = z.object({
  query: z.string(),
  encoded: z.array(z.string()),
  notEncoded: z.array(z.object({ label: z.string(), reason: z.string() })),
});
export type GeneratedQueryOutput = z.infer<typeof GeneratedQuerySchema>;

const LANGUAGE_RULE: Record<SourcingLanguage, string> = {
  fr: 'en français',
  en: 'en anglais (intitulés et compétences dans le vocabulaire des profils anglophones)',
};

export function buildSystemPrompt(language: SourcingLanguage): string {
  return `Tu rédiges UNE requête pour un moteur de recherche sémantique de profils professionnels (type LinkedIn).

La requête décrit la PERSONNE idéale, comme la première ligne de son profil — jamais le poste ni l'entreprise qui recrute.

Règles, toutes obligatoires :
1. Une seule phrase, 15 à 30 mots, ${LANGUAGE_RULE[language]}, sans guillemets, sans opérateurs (AND, OR, -, parenthèses).
2. Ordre : séniorité → intitulé → 2 à 4 compétences distinctives → secteur → localisation.
3. Intitulé : le vocabulaire que les professionnels écrivent sur LEUR profil, pas l'intitulé de l'annonce. Retire « (H/F) », les codes internes, les sigles propres au client. Tu peux donner DEUX variantes courantes séparées par « / » (ex. « Consultant AMOA / Business Analyst »), jamais trois.
4. Années d'expérience : écris-les UNIQUEMENT si la fiche les porte (ex. « 10 à 15 ans d'expérience »). N'en invente jamais.
5. Compétences : uniquement des savoir-faire DISTINCTIFS du métier, pris dans les critères critiques et très importants. Exclus : savoir-être (leadership, rigueur, relationnel…), compétences génériques (pack Office, anglais, Git pour un développeur…), administratif (contrat, salaire, disponibilité, autorisation de travail, télétravail), toute négation.
6. Secteur : seulement s'il est explicite dans la fiche ou déductible sans doute d'un sigle métier expliqué dans la fiche.
7. Localisation : la ville ou la région en clair (« basé à Lyon », « région de Belfort »). Si la fiche ne donne que « télétravail » ou rien, écris « basé en France ».
8. Tu n'inventes RIEN qui ne soit dans la fiche : ni technologie, ni secteur, ni ville.

Rends un JSON : { "query": string, "encoded": [libellés EXACTS des critères encodés], "notEncoded": [{ "label": libellé EXACT, "reason": raison courte en français }] }. Chaque critère de la fiche apparaît dans encoded OU notEncoded.`;
}

export function ficheToPromptText(fiche: QueryFicheInput): string {
  return `Intitulé : ${fiche.jobTitle} | Séniorité : ${fiche.seniority ?? 'non précisée'} | Localisation : ${fiche.location ?? 'non précisée'}
Critères :
${fiche.criteria.map((c) => `- ${c.level} | ${c.label}`).join('\n')}`;
}

/** Les cinq exemples de l'étude (§3.4). Aucune des fiches mesurées n'y figure. */
export const FEW_SHOTS: { fiche: string; out: GeneratedQueryOutput }[] = [
  {
    fiche: `Intitulé : Consultant AMOA Trade Finance (H/F) | Séniorité : senior | Localisation : Paris La Défense
Critères :
- critique | Expérience de 8 ans minimum en AMOA sur les métiers de financement du commerce international
- critique | Maîtrise des crédits documentaires et garanties internationales
- tres_important | Connaissance des messages SWIFT MT7xx
- important | Anglais courant
- souhaitable | Esprit d'équipe`,
    out: {
      query: "Consultant AMOA / Business Analyst senior, 8 ans d'expérience en Trade Finance, crédits documentaires et garanties internationales, SWIFT MT7xx, banque, basé à Paris",
      encoded: [
        'Expérience de 8 ans minimum en AMOA sur les métiers de financement du commerce international',
        'Maîtrise des crédits documentaires et garanties internationales',
        'Connaissance des messages SWIFT MT7xx',
      ],
      notEncoded: [
        { label: 'Anglais courant', reason: 'compétence générique, niveau important' },
        { label: "Esprit d'équipe", reason: 'savoir-être' },
      ],
    },
  },
  {
    fiche: `Intitulé : Développeur Full Stack JS – Pôle Assurance Vie | Séniorité : confirmé | Localisation : Lyon (69)
Critères :
- critique | Maîtrise de TypeScript, React et Node.js
- critique | Expérience dans le secteur de l'assurance
- tres_important | Conception d'API REST
- tres_important | Utilisation de Git
- important | Autonomie et rigueur`,
    out: {
      query: "Développeur full-stack confirmé TypeScript, React et Node.js, conception d'API REST, secteur assurance, basé à Lyon",
      encoded: ['Maîtrise de TypeScript, React et Node.js', "Expérience dans le secteur de l'assurance", "Conception d'API REST"],
      notEncoded: [
        { label: 'Utilisation de Git', reason: 'compétence générique du métier' },
        { label: 'Autonomie et rigueur', reason: 'savoir-être' },
      ],
    },
  },
  {
    fiche: `Intitulé : Responsable Paie & ADP | Séniorité : confirmé | Localisation : Boulogne-Billancourt
Critères :
- redhibitoire | Autorisation de travail en France
- critique | 5 ans d'expérience minimum en gestion de la paie multi-conventions
- critique | Maîtrise de la convention collective Syntec
- tres_important | Pratique d'un logiciel de paie (ADP, Silae ou SAP HR)
- important | Management d'une équipe de 3 gestionnaires`,
    out: {
      query: "Responsable paie et administration du personnel confirmé, 5 ans d'expérience, paie multi-conventions, convention Syntec, ADP ou Silae, basé en Île-de-France à Boulogne-Billancourt",
      encoded: [
        "5 ans d'expérience minimum en gestion de la paie multi-conventions",
        'Maîtrise de la convention collective Syntec',
        "Pratique d'un logiciel de paie (ADP, Silae ou SAP HR)",
      ],
      notEncoded: [
        { label: 'Autorisation de travail en France', reason: 'administratif' },
        { label: "Management d'une équipe de 3 gestionnaires", reason: 'niveau important' },
      ],
    },
  },
  {
    fiche: `Intitulé : Project Manager – Data Protection | Séniorité : confirmé | Localisation : Nanterre
Critères :
- critique | Piloter le programme Data Protection
- critique | Structurer, cadrer et mettre en œuvre les initiatives visant à protéger les données critiques
- tres_important | Élaborer le business case, ROI, plan de ressources, risques, budget et planning
- important | Cadrage et déploiement des technologies (chiffrement, DLP, IAM, etc.)`,
    out: {
      query: 'Chef de projet / Program Manager confirmé en protection des données, pilotage de programme data protection, business case et budget, basé en Île-de-France à Nanterre',
      encoded: [
        'Piloter le programme Data Protection',
        'Structurer, cadrer et mettre en œuvre les initiatives visant à protéger les données critiques',
        'Élaborer le business case, ROI, plan de ressources, risques, budget et planning',
      ],
      notEncoded: [{ label: 'Cadrage et déploiement des technologies (chiffrement, DLP, IAM, etc.)', reason: 'niveau important' }],
    },
  },
  {
    fiche: `Intitulé : Chargé(e) de recrutement IT – CDD 6 mois | Séniorité : junior | Localisation : Télétravail 100 %
Critères :
- critique | Sourcing de profils techniques (développeurs, DevOps)
- tres_important | Expérience en cabinet de recrutement
- tres_important | Disponibilité immédiate
- important | Excellent relationnel`,
    out: {
      query: 'Chargé de recrutement IT / Talent Acquisition junior, sourcing de profils techniques développeurs et DevOps, expérience en cabinet de recrutement, basé en France',
      encoded: ['Sourcing de profils techniques (développeurs, DevOps)', 'Expérience en cabinet de recrutement'],
      notEncoded: [
        { label: 'Disponibilité immédiate', reason: 'administratif' },
        { label: 'Excellent relationnel', reason: 'savoir-être' },
      ],
    },
  },
];

export type QueryValidation = { ok: true } | { ok: false; reason: string };

const OPERATORS = /\b(?:AND|OR|NOT)\b|["()]/;

/**
 * Bornes d'ACCEPTATION, plus larges que la consigne (15 à 30 mots) : la
 * validation écarte ce qui est manifestement hors règle, elle ne chipote pas.
 * Constaté en dev le 13/09 : une requête (b) de 14 mots, conforme sur le fond,
 * était rejetée au profit du repli (a)… de 13 mots. Un garde-fou qui remplace
 * une bonne requête par une moins bonne n'en est pas un. Ce que la mesure a
 * montré nuisible, ce sont les requêtes de 3-4 mots (§3.2, R7).
 */
export const QUERY_WORDS_MIN = 10;
export const QUERY_WORDS_MAX = 35;

/**
 * La sortie (b) n'est acceptée que si elle respecte ce que le recruteur va
 * relire : une phrase de longueur raisonnable, sans opérateur, et un sort donné
 * à CHAQUE critère — sinon la ligne « critères encodés / non encodés » mentirait
 * par omission. Sinon : repli (a), et l'écran dit pourquoi.
 */
export function validateGeneratedQuery(out: GeneratedQueryOutput, fiche: QueryFicheInput): QueryValidation {
  const words = out.query.trim().split(/\s+/).filter(Boolean).length;
  if (words < QUERY_WORDS_MIN || words > QUERY_WORDS_MAX) {
    return { ok: false, reason: `requête de ${words} mots (attendu ${QUERY_WORDS_MIN} à ${QUERY_WORDS_MAX})` };
  }
  if (OPERATORS.test(out.query)) return { ok: false, reason: 'requête avec opérateurs ou guillemets' };
  const covered = new Set([...out.encoded, ...out.notEncoded.map((n) => n.label)].map((l) => l.trim()));
  const missing = fiche.criteria.filter((c) => !covered.has(c.label.trim()));
  if (missing.length > 0) return { ok: false, reason: `${missing.length} critère(s) sans sort` };
  const known = new Set(fiche.criteria.map((c) => c.label.trim()));
  if ([...covered].some((l) => !known.has(l))) return { ok: false, reason: 'critère inventé' };
  return { ok: true };
}
