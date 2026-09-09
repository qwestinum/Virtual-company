/**
 * Pré-remplissage de l'offre APEC depuis l'annonce déjà rédigée. PUR.
 *
 * ── LE PRINCIPE ─────────────────────────────────────────────────────────────
 *
 * Ce que le recruteur a validé ne se ressaisit pas. Une campagne dont l'annonce
 * générique est publiée porte déjà un titre et un corps RELUS par un humain :
 * ouvrir le panneau APEC devant deux zones de texte vides lui demanderait de
 * réécrire ce qu'il vient d'écrire, et deux textes rédigés séparément finissent
 * toujours par diverger.
 *
 * ── CE QUE CE MODULE NE FAIT PAS ────────────────────────────────────────────
 *
 * Il ne TRONQUE jamais. Le descriptif APEC est plafonné à 3 000 caractères et
 * une annonce générique peut les dépasser : couper au caractère 3 000 rendrait
 * une offre amputée en plein mot, et — plus grave — personne ne le saurait. Le
 * texte est recopié TEL QUEL et l'écart est DIT (`prefillIssues`), à charge du
 * recruteur de raccourcir. C'est la règle « zéro troncature silencieuse »
 * appliquée à un formulaire.
 *
 * Il ne REFORMATE pas non plus. Le corps générique est du Markdown ; l'Apec
 * affiche du texte. Retirer les `##` et les `**` serait réécrire un texte
 * validé sur une supposition de mise en forme — on le SIGNALE et l'humain
 * tranche, comme partout ailleurs dans ce projet.
 *
 * Il ne re-synchronise rien. Le pré-remplissage a lieu à l'OUVERTURE du
 * panneau ; ce qui part chez l'Apec est figé à SA publication. Modifier
 * l'annonce générique ensuite ne touche pas une offre déjà publiée — le
 * panneau le dit plutôt que de laisser croire à un lien vivant.
 */

import type { DemoJobPost } from '@/types/job-post';

import { withGenderMention } from './build-open-position';
import { ADEP_LIMITS, type AdepIssue } from './validate';

/**
 * D'où vient le texte proposé.
 *
 *   · `generic_published`   — l'annonce générique en ligne. Relue ET publiée
 *                             par un humain : c'est la source la plus sûre ;
 *   · `generic_unpublished` — la même, dépubliée depuis. Le texte reste celui
 *                             qu'un humain a relu, et c'est ce qui compte ici ;
 *   · `job_writer`          — pré-rédigé à la demande, jamais relu par
 *                             personne. Se présente comme un brouillon.
 */
export type AdepPrefillSource = 'generic_published' | 'generic_unpublished' | 'job_writer';

export type AdepPrefill = {
  source: AdepPrefillSource;
  positionTitle: string;
  positionDescription: string;
  /** Date du texte d'origine, ISO. `null` quand la source n'en porte pas. */
  at: string | null;
  /** Provenance en français, affichée sous le champ. */
  label: string;
  /** Le corps porte des marques Markdown que l'Apec affichera telles quelles. */
  hasMarkup: boolean;
};

/** Date en clair, fuseau France — les dates affichées sont civiles. */
function frenchDate(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

/**
 * Marques de mise en forme que l'Apec ne rendra pas.
 *
 * Volontairement CONSERVATRICE : on ne cherche que les marques qui sautent aux
 * yeux dans un texte publié (titres `##`, gras `**`, listes à puces, liens
 * Markdown). Un tiret en début de ligne compte — c'est la forme la plus
 * courante d'une liste de missions, et la plus visible une fois brute.
 */
export function hasMarkdownMarkup(body: string): boolean {
  return (
    /^\s{0,3}#{1,6}\s/m.test(body) ||
    /\*\*[^\n*]+\*\*/.test(body) ||
    /^\s*[-*+]\s+\S/m.test(body) ||
    /\[[^\]\n]+\]\([^)\n]+\)/.test(body)
  );
}

/** « annonce générique publiée le 12/08/2026 » — la phrase affichée. */
export function describePrefillSource(
  source: AdepPrefillSource,
  at: string | null,
): string {
  const date = at ? frenchDate(at) : null;
  const on = date ? ` du ${date}` : '';
  switch (source) {
    case 'generic_published':
      return `annonce générique publiée${on}`;
    case 'generic_unpublished':
      return `annonce générique${on} (dépubliée)`;
    case 'job_writer':
      return 'brouillon pré-rédigé, à relire';
  }
}

/**
 * Le pré-remplissage tiré de l'annonce générique, ou `null` s'il n'y en a pas.
 *
 * Une annonce DÉPUBLIÉE sert quand même de source : `unpublishJobPost` ne
 * supprime pas le texte, il retire l'annonce de la vitrine. Ce que le recruteur
 * a relu reste ce qu'il a relu — et c'est dit, pour qu'il sache sur quoi il
 * s'appuie.
 */
export function prefillFromJobPost(post: DemoJobPost | null): AdepPrefill | null {
  if (!post) return null;
  const title = post.title.trim();
  const body = post.body.trim();
  if (!title && !body) return null;

  const source: AdepPrefillSource = post.isVisible
    ? 'generic_published'
    : 'generic_unpublished';
  const at = post.isVisible ? (post.publishedAt ?? post.updatedAt) : post.updatedAt;
  return {
    source,
    positionTitle: title,
    positionDescription: body,
    at,
    label: describePrefillSource(source, at),
    hasMarkup: hasMarkdownMarkup(body),
  };
}

/** Le pré-remplissage tiré d'une pré-rédaction — jamais relue, et ça se dit. */
export function prefillFromGeneration(input: {
  title: string;
  body: string;
}): AdepPrefill | null {
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title && !body) return null;
  return {
    source: 'job_writer',
    positionTitle: title,
    positionDescription: body,
    at: null,
    label: describePrefillSource('job_writer', null),
    hasMarkup: hasMarkdownMarkup(body),
  };
}

/**
 * Les écarts du texte pré-rempli, dits À L'OUVERTURE plutôt qu'au clic Publier.
 *
 * ⚠️ Bornés aux DEUX champs pré-remplis. Faire tourner le rapport complet ici
 * afficherait aussi le code INSEE manquant et le statut du poste à trancher —
 * des champs que le recruteur n'a pas encore eu l'occasion de remplir. Un écran
 * qui crie avant qu'on ait touché à quoi que ce soit finit par ne plus être lu.
 *
 * Aucun de ces écarts ne bloque l'édition : ce sont des constats sur un texte
 * proposé, et le recruteur les corrige dans le formulaire.
 */
export function prefillIssues(
  prefill: AdepPrefill,
  offer: { positionTitle: string; positionDescription: string },
): AdepIssue[] {
  const issues: AdepIssue[] = [];
  const title = offer.positionTitle.trim();
  const body = offer.positionDescription.trim();

  // Le titre part avec « H/F » : on mesure ce qui sera ENVOYÉ, comme le
  // validateur et le compteur du formulaire. Mesurer la saisie laisserait
  // passer un intitulé qui déborde une fois la mention ajoutée.
  const sentTitle = title ? withGenderMention(title) : '';
  if (sentTitle.length > ADEP_LIMITS.positionTitleWithMention) {
    issues.push({
      level: 'error',
      field: 'positionTitle',
      message: `L’intitulé fait ${sentTitle.length} caractères avec la mention H/F ; l’Apec en accepte ${ADEP_LIMITS.positionTitleWithMention}. À raccourcir.`,
      preventsCode: '316',
    });
  }

  if (body.length > ADEP_LIMITS.positionDescriptionMax) {
    issues.push({
      level: 'error',
      field: 'positionDescription',
      message: `Le descriptif repris (${prefill.label}) fait ${body.length} caractères ; l’Apec en accepte ${ADEP_LIMITS.positionDescriptionMax}. À raccourcir avant publication.`,
      preventsCode: '318',
    });
  } else if (body.length > 0 && body.length < ADEP_LIMITS.positionDescriptionMin) {
    issues.push({
      level: 'error',
      field: 'positionDescription',
      message: `Le descriptif fait ${body.length} caractères ; l’Apec en exige ${ADEP_LIMITS.positionDescriptionMin} au minimum.`,
      preventsCode: '318',
    });
  }

  if (prefill.hasMarkup) {
    issues.push({
      level: 'warning',
      field: 'positionDescription',
      message:
        'Le texte repris contient des marques de mise en forme (##, **, listes) que l’Apec affichera telles quelles. Rien n’a été retiré automatiquement : à vous de voir.',
      preventsCode: '—',
    });
  }

  return issues;
}
