/**
 * TOUTES LES ANNONCES PUBLIÉES, tous canaux, toutes campagnes.
 *
 * Vue TRANSVERSE : elle regroupe ce qui vit dans deux tables et ne se voyait
 * jusqu'ici qu'une campagne à la fois — donc jamais « laquelle va basculer ».
 *
 * FAIL-SOFT par source : si l'Apec est injoignable ou sa table absente, on rend
 * les annonces génériques quand même, et on DIT laquelle des deux a manqué.
 * Une page vide qui ne dit pas pourquoi se lit « il n'y a rien à diffuser ».
 */

import { NextResponse } from 'next/server';

import { listVisibleJobPosts } from '@/lib/db/repos/demo-job-posts';
import { listLiveJobPostings } from '@/lib/db/repos/job-postings';
import { listCampaignSummaries } from '@/lib/db/repos/campaigns';
import { ligneApec, ligneGenerique, trierDiffusion } from '@/lib/diffusion/rows';

export const dynamic = 'force-dynamic';

export async function GET() {
  const manquantes: string[] = [];
  const maintenant = new Date();

  const apec = await listLiveJobPostings().catch(() => {
    manquantes.push('apec');
    return [];
  });
  const generiques = await listVisibleJobPosts().catch(() => {
    manquantes.push('generique');
    return [];
  });

  const lignes = trierDiffusion([
    ...apec.map((p) =>
      ligneApec(
        {
          campaignId: p.campaignId,
          channel: p.channel,
          remoteStatus: p.remoteStatus,
          remoteStatusAt: p.remoteStatusAt,
          remoteUrl: p.remoteUrl,
          publishedAt: p.publishedAt,
          suspendedAt: p.suspendedAt,
        },
        maintenant,
      ),
    ),
    ...generiques.map((g) =>
      ligneGenerique({
        campaignId: g.campaignId,
        isVisible: g.isVisible,
        publishedAt: g.publishedAt,
        updatedAt: g.updatedAt,
      }),
    ),
  ]);

  // Le nom de la campagne, en UNE lecture chunkée — jamais une par ligne.
  const noms = await listCampaignSummaries([
    ...new Set(lignes.map((l) => l.campaignId)),
  ]).catch(() => new Map());

  return NextResponse.json({
    lignes: lignes.map((l) => ({
      ...l,
      campaignName: noms.get(l.campaignId)?.name ?? null,
    })),
    sourcesManquantes: manquantes,
  });
}
