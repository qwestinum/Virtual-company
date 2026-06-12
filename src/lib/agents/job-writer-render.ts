import { buildVivierRgpdMention } from '@/lib/vivier/rgpd-mention';
import type { JobAdResult } from '@/types/job-writer';

/**
 * Appose la mention RGPD vivier (§7/§8.1) à la fin du corps de l'annonce, de
 * façon DÉTERMINISTE (jamais soumise au LLM ⇒ toujours présente). `contact` est
 * l'adresse à laquelle demander la suppression. Pur.
 */
export function withVivierRgpdMention(
  ad: JobAdResult,
  contact: string,
): JobAdResult {
  return {
    ...ad,
    body: `${ad.body.trim()}\n\n${buildVivierRgpdMention(contact)}`,
  };
}

/**
 * Sérialise une annonce générée en Markdown téléchargeable.
 * Le titre devient un # de niveau 1, suivi du body brut produit par le
 * LLM (qui contient déjà ses sections ##), et d'un footer Tags.
 */
export function renderJobAdMarkdown(ad: JobAdResult): string {
  const lines: string[] = [`# ${ad.title}`, '', ad.body.trim(), ''];
  if (ad.tags.length > 0) {
    lines.push('---', '', `**Tags** : ${ad.tags.join(' · ')}`, '');
  }
  return lines.join('\n');
}

/**
 * Suggère un nom de fichier propre à partir du titre.
 */
export function suggestJobAdFileName(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `annonce-${slug || 'poste'}.md`;
}
