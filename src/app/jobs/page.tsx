/**
 * `/jobs` — la liste des offres publiées.
 *
 * Le flag est vérifié ICI, pas seulement dans le layout : une page qui se
 * garde elle-même reste fermée quel que soit le chemin par lequel on l'atteint,
 * et le test peut l'attester sans monter tout l'arbre de rendu.
 *
 * Lecture serveur directe (aucun aller-retour d'API) : la page est publique et
 * n'a rien à négocier — la requête de rendu EST la requête de données.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { listVisibleJobPosts } from '@/lib/db/repos/demo-job-posts';
import { isDemoJobboardEnabled } from '@/lib/jobboard/flag';
import type { DemoJobPost } from '@/types/job-post';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** « Publiée aujourd'hui » / « il y a 3 jours » — sans dépendance de dates. */
function publishedLabel(iso: string | null): string {
  if (!iso) return 'Publiée récemment';
  const days = Math.floor(
    (Date.now() - new Date(iso).getTime()) / 86_400_000,
  );
  if (days <= 0) return 'Publiée aujourd’hui';
  if (days === 1) return 'Publiée hier';
  return `Publiée il y a ${days} jours`;
}

function metaLine(post: DemoJobPost): string {
  return [post.location, post.contract, publishedLabel(post.publishedAt)]
    .filter((v): v is string => Boolean(v && v.length > 0))
    .join(' · ');
}

export default async function JobsListPage() {
  if (!isDemoJobboardEnabled()) notFound();

  // Base injoignable ⇒ liste vide plutôt qu'écran d'erreur : en rendez-vous,
  // une page sobre « aucune offre » se rattrape, une trace de pile ne se
  // rattrape pas.
  const posts = await listVisibleJobPosts().catch(() => [] as DemoJobPost[]);

  return (
    <main className="jb-main">
      <h1 className="jb-title">Trouvez votre prochain poste</h1>
      <p className="jb-count">
        {posts.length === 0
          ? 'Aucune offre publiée'
          : `${posts.length} offre${posts.length > 1 ? 's' : ''} publiée${posts.length > 1 ? 's' : ''}`}
      </p>

      {posts.length === 0 ? (
        <p className="jb-empty">
          Aucune offre n’est publiée pour le moment. Revenez bientôt.
        </p>
      ) : (
        posts.map((post) => (
          <Link
            key={post.campaignId}
            className="jb-card"
            href={`/jobs/${encodeURIComponent(post.campaignId)}`}
          >
            <p className="jb-card-title">{post.title}</p>
            <p className="jb-meta">{metaLine(post)}</p>
            {post.tags.length > 0 && (
              <div className="jb-tags">
                {post.tags.slice(0, 5).map((tag) => (
                  <span key={tag} className="jb-tag">
                    {tag}
                  </span>
                ))}
              </div>
            )}
            {/* La référence EST l'identifiant de campagne : c'est cette chaîne
                que le recruteur retrouvera dans ORQA, mot pour mot. */}
            <span className="jb-ref">Réf. {post.campaignId}</span>
          </Link>
        ))
      )}
    </main>
  );
}
