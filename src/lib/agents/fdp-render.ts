/**
 * Renderer FDP → Markdown (Session 5 round 3).
 *
 * Génère un fichier `.md` lisible déposable dans Supabase Storage
 * lorsqu'une FDP est validée. Le format est le même que celui que
 * le Manager rend dans le chat (cf. manager-prompts.ts MODE
 * RÉUTILISATION L1) — listes à puces, sous-listes pour missions et
 * compétences. Optimisé pour relecture humaine ; pas un format
 * structuré d'export (le JSON canonique reste dans Supabase).
 */

import {
  FIELD_KEYS,
  FIELD_LABELS,
  type FDPInProgress,
} from '@/types/field-collection';

function fieldValue(fdp: FDPInProgress, key: (typeof FIELD_KEYS)[number]): {
  raw: unknown;
  isList: boolean;
} {
  const v = fdp.fields[key]?.value;
  return { raw: v, isList: Array.isArray(v) };
}

function renderListField(items: unknown[]): string[] {
  return items
    .map((it) => (typeof it === 'string' ? it.trim() : String(it)))
    .filter((s) => s.length > 0)
    .map((s) => `  - ${s}`);
}

function renderScalarField(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return String(value);
}

export function renderFdpMarkdown(fdp: FDPInProgress): string {
  const lines: string[] = [
    `# Fiche de poste — ${fdp.campaignId}`,
    '',
  ];

  for (const key of FIELD_KEYS) {
    const { raw, isList } = fieldValue(fdp, key);
    const label = FIELD_LABELS[key];
    if (isList && Array.isArray(raw) && raw.length > 0) {
      lines.push(`- ${label} :`);
      lines.push(...renderListField(raw));
    } else {
      const scalar = renderScalarField(raw);
      if (scalar) lines.push(`- ${label} : ${scalar}`);
    }
  }

  lines.push('', '---', '', `Statut : ${fdp.isValidated ? 'validée' : 'en cours de cadrage'}.`);
  return lines.join('\n');
}

/**
 * Nom de fichier suggéré pour une FDP. Inclut le campaignId pour la
 * traçabilité lorsque plusieurs FDPs coexistent dans un même dossier
 * (cas marginal mais possible avec les revalidations).
 */
export function suggestFdpFileName(campaignId: string): string {
  return `fdp-${campaignId}.md`;
}
