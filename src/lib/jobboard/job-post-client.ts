'use client';

/**
 * Accès client à l'annonce d'une campagne, avec issue REMONTÉE.
 *
 * Même parti pris que `mailbox-association.ts` : `fetch` ne rejette pas sur
 * 4xx/5xx, donc chaque helper lève explicitement avec un message lisible. Une
 * publication ratée qui passerait pour un succès laisserait le recruteur
 * annoncer une offre qui n'existe pas.
 *
 * `loadJobPost` distingue trois issues, parce que le panneau en fait trois
 * choses différentes : `unavailable` (404 — la surface n'existe pas sur cette
 * instance, on ne montre rien), `post: null` (rien de publié — on pré-rédige),
 * ou l'annonce existante.
 */
import { readApiError } from '@/components/campagnes/edit/job-ad-panel-styles';
import type { DemoJobPost } from '@/types/job-post';

export type JobAdDraft = { title: string; body: string; tags: string[] };

function base(campaignId: string): string {
  return `/api/campaigns/${encodeURIComponent(campaignId)}/job-post`;
}

export async function loadJobPost(
  campaignId: string,
): Promise<{ unavailable: true } | { unavailable: false; post: DemoJobPost | null }> {
  const res = await fetch(base(campaignId), { cache: 'no-store' }).catch(() => null);
  if (!res || res.status === 404) return { unavailable: true };
  if (!res.ok) throw new Error(await readApiError(res));
  const data = (await res.json()) as { post: DemoJobPost | null };
  return { unavailable: false, post: data.post };
}

/** Pré-rédaction — N'ENREGISTRE RIEN, rend un brouillon à relire. */
export async function generateJobAd(campaignId: string): Promise<JobAdDraft> {
  const res = await fetch(`${base(campaignId)}/generate`, { method: 'POST' });
  if (!res.ok) throw new Error(await readApiError(res));
  return ((await res.json()) as { draft: JobAdDraft }).draft;
}

/** Publication — fige le texte tel qu'il est passé. */
export async function publishJobAd(
  campaignId: string,
  draft: JobAdDraft,
): Promise<DemoJobPost> {
  const res = await fetch(base(campaignId), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(draft),
  });
  if (!res.ok) throw new Error(await readApiError(res));
  return ((await res.json()) as { post: DemoJobPost }).post;
}

/** Dépublication — l'annonce quitte `/jobs`, le texte relu reste. */
export async function unpublishJobAd(
  campaignId: string,
): Promise<DemoJobPost | null> {
  const res = await fetch(base(campaignId), { method: 'DELETE' });
  if (!res.ok) throw new Error(await readApiError(res));
  return ((await res.json()) as { post: DemoJobPost | null }).post;
}
