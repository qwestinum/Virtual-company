/**
 * `/jobs/[id]` — l'annonce complète et son formulaire de candidature.
 *
 * `id` EST l'identifiant de campagne. La référence affichée sous le titre est
 * donc littéralement la même chaîne que celle de la campagne dans ORQA : c'est
 * le fil de traçabilité de la démonstration, et il ne tiendrait pas si on
 * fabriquait ici un second identifiant d'affichage.
 *
 * Seule une annonce VISIBLE se rend : une offre dépubliée doit disparaître, pas
 * rester accessible à qui a gardé l'adresse.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getVisibleJobPost } from '@/lib/db/repos/demo-job-posts';
import { renderAdBlocks } from '@/lib/jobboard/ad-render';
import { isDemoJobboardEnabled } from '@/lib/jobboard/flag';
import type { AdSegment } from '@/lib/jobboard/ad-render';

import { ApplyForm } from './ApplyForm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function Segments({ segments }: { segments: AdSegment[] }) {
  return (
    <>
      {segments.map((seg, i) =>
        seg.strong ? <strong key={i}>{seg.text}</strong> : <span key={i}>{seg.text}</span>,
      )}
    </>
  );
}

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!isDemoJobboardEnabled()) notFound();
  const { id } = await params;

  const post = await getVisibleJobPost(id).catch(() => null);
  if (!post) notFound();

  const blocks = renderAdBlocks(post.body);
  const meta = [post.location, post.contract]
    .filter((v): v is string => Boolean(v && v.length > 0))
    .join(' · ');

  return (
    <main className="jb-main">
      <Link className="jb-back" href="/jobs">
        ← Toutes les offres
      </Link>

      <h1 className="jb-offer-title">{post.title}</h1>
      <p className="jb-offer-ref">Réf. {post.campaignId}</p>
      {meta.length > 0 && <p className="jb-meta">{meta}</p>}

      <section className="jb-panel jb-body">
        {blocks.map((block, i) => {
          if (block.kind === 'heading') {
            return block.level === 2 ? (
              <h2 key={i}>
                <Segments segments={block.segments} />
              </h2>
            ) : (
              <h3 key={i}>
                <Segments segments={block.segments} />
              </h3>
            );
          }
          if (block.kind === 'list') {
            return (
              <ul key={i}>
                {block.items.map((item, j) => (
                  <li key={j}>
                    <Segments segments={item} />
                  </li>
                ))}
              </ul>
            );
          }
          return (
            <p key={i}>
              <Segments segments={block.segments} />
            </p>
          );
        })}
      </section>

      <ApplyForm campaignId={post.campaignId} />
    </main>
  );
}
