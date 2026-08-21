/**
 * Repo des annonces du jobboard de démonstration (`demo_job_posts`).
 *
 * Une ligne par campagne, contenu FIGÉ au moment de la publication. Le repo
 * n'appelle jamais le générateur : écrire ici, c'est enregistrer ce qu'un
 * humain a relu.
 *
 * `getVisibleJobPost` / `listVisibleJobPosts` sont les seules lectures servies
 * aux pages PUBLIQUES : elles filtrent sur `is_visible` en SQL, pour qu'une
 * annonce dépubliée ne puisse pas fuiter par un oubli de filtre côté rendu.
 */

import { requireServerSupabase } from '@/lib/db/supabase-server';
import type { DemoJobPost } from '@/types/job-post';

const TABLE = 'demo_job_posts';

type Row = {
  campaign_id: string;
  title: string;
  body: string;
  tags: string[] | null;
  location: string | null;
  contract: string | null;
  is_visible: boolean;
  published_at: string | null;
  updated_at: string;
};

function toPost(row: Row): DemoJobPost {
  return {
    campaignId: row.campaign_id,
    title: row.title,
    body: row.body,
    tags: row.tags ?? [],
    location: row.location,
    contract: row.contract,
    isVisible: row.is_visible,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
  };
}

/** L'annonce d'une campagne, visible ou non (panneau côté ORQA). */
export async function getJobPost(campaignId: string): Promise<DemoJobPost | null> {
  const db = requireServerSupabase();
  const { data, error } = await db
    .from(TABLE)
    .select('*')
    .eq('campaign_id', campaignId)
    .maybeSingle();
  if (error) throw new Error(`demo_job_posts.get: ${error.message}`);
  return data ? toPost(data as Row) : null;
}

/** L'annonce d'une campagne SI elle est publiée (page publique `/jobs/[id]`). */
export async function getVisibleJobPost(
  campaignId: string,
): Promise<DemoJobPost | null> {
  const db = requireServerSupabase();
  const { data, error } = await db
    .from(TABLE)
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('is_visible', true)
    .maybeSingle();
  if (error) throw new Error(`demo_job_posts.getVisible: ${error.message}`);
  return data ? toPost(data as Row) : null;
}

/**
 * Les annonces publiées, plus récentes d'abord.
 *
 * Borne explicite à 200 : un jobboard de démonstration qui dépasserait ce
 * volume signalerait un ménage à faire, pas une pagination à écrire. La limite
 * est POSÉE plutôt que subie — le cap implicite de PostgREST (1000) serait une
 * troncature silencieuse.
 */
export async function listVisibleJobPosts(): Promise<DemoJobPost[]> {
  const db = requireServerSupabase();
  const { data, error } = await db
    .from(TABLE)
    .select('*')
    .eq('is_visible', true)
    .order('published_at', { ascending: false })
    .limit(200);
  if (error) throw new Error(`demo_job_posts.list: ${error.message}`);
  return (data ?? []).map((r) => toPost(r as Row));
}

export type UpsertJobPostInput = {
  campaignId: string;
  title: string;
  body: string;
  tags: string[];
  location: string | null;
  contract: string | null;
};

/**
 * Publie (ou republie) l'annonce d'une campagne. `published_at` n'est posé
 * qu'à la PREMIÈRE publication : republier après une correction de coquille ne
 * doit pas faire remonter l'annonce en tête de liste comme une nouveauté.
 */
export async function publishJobPost(
  input: UpsertJobPostInput,
): Promise<DemoJobPost> {
  const db = requireServerSupabase();
  const existing = await getJobPost(input.campaignId);
  const now = new Date().toISOString();
  const row = {
    campaign_id: input.campaignId,
    title: input.title,
    body: input.body,
    tags: input.tags,
    location: input.location,
    contract: input.contract,
    is_visible: true,
    published_at: existing?.publishedAt ?? now,
    updated_at: now,
  };
  const { data, error } = await db
    .from(TABLE)
    .upsert(row, { onConflict: 'campaign_id' })
    .select('*')
    .single();
  if (error) throw new Error(`demo_job_posts.publish: ${error.message}`);
  return toPost(data as Row);
}

/**
 * Dépublie sans effacer : l'annonce disparaît de `/jobs` mais le texte relu
 * reste disponible pour une republication. Rendre `null` (aucune ligne) plutôt
 * que lever quand il n'y a rien à dépublier — le geste est idempotent.
 */
export async function unpublishJobPost(
  campaignId: string,
): Promise<DemoJobPost | null> {
  const db = requireServerSupabase();
  const { data, error } = await db
    .from(TABLE)
    .update({ is_visible: false, updated_at: new Date().toISOString() })
    .eq('campaign_id', campaignId)
    .select('*')
    .maybeSingle();
  if (error) throw new Error(`demo_job_posts.unpublish: ${error.message}`);
  return data ? toPost(data as Row) : null;
}

/** Nettoyage ciblé (`npm run reset:demo-jobboard`). Rend le nombre supprimé. */
export async function deleteAllJobPosts(): Promise<number> {
  const db = requireServerSupabase();
  const { data, error } = await db
    .from(TABLE)
    .delete()
    .neq('campaign_id', '')
    .select('campaign_id');
  if (error) throw new Error(`demo_job_posts.deleteAll: ${error.message}`);
  return (data ?? []).length;
}
