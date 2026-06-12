/**
 * Calibration du seuil de présélection titre (docs/specs/vivier.md §4.3).
 *
 * Imprime, pour une campagne, la DISTRIBUTION COMPLÈTE des similarités
 * titre-à-titre (intitulé du poste ⇄ titre des candidats indexés), du meilleur
 * au pire, avec marquage des correspondances déterministes (bloc 1). Objectif :
 * repérer le « creux » entre vrais profils et hors-sujet pour fixer le seuil
 * (Settings → Vivier → Seuil de pertinence) sans tâtonner.
 *
 * Usage : npm run vivier:title-distribution -- <campaignId>
 * Pré-requis : .env.local (Supabase + modèle d'embedding courant, le MÊME que
 * celui des dossiers indexés).
 */

import { loadEnvConfig } from '@next/env';

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());

  const campaignId = process.argv[2];
  if (!campaignId) {
    console.error('Usage : npm run vivier:title-distribution -- <campaignId>');
    process.exit(1);
  }

  const { getCampaign } = await import('@/lib/db/repos/campaigns');
  const { embedText } = await import('@/lib/ai/embeddings');
  const { listIndexedVivierTitles, matchVivierTitles } = await import(
    '@/lib/db/repos/vivier'
  );
  const { runKeywordVariantsSuggestion } = await import(
    '@/lib/agents/server/keyword-variants-execute'
  );
  const { campaignTitleTermSet, firstDeterministicMatch } = await import(
    '@/lib/vivier/preselection'
  );

  const campaign = await getCampaign(campaignId);
  if (!campaign) {
    console.error(`Campagne ${campaignId} introuvable.`);
    process.exit(1);
  }
  const jt = campaign.fdp.fields.job_title?.value;
  const jobTitle = typeof jt === 'string' ? jt.trim() : '';
  if (!jobTitle) {
    console.error('Cette campagne n’a pas d’intitulé de poste (fiche).');
    process.exit(1);
  }

  console.log(`Campagne ${campaignId} — intitulé : « ${jobTitle} »`);

  let variants: string[] = [];
  try {
    variants = (
      await runKeywordVariantsSuggestion({
        criterionLabel: jobTitle,
        existingKeywords: [],
        targetMethod: 'keywords_with_variants',
      })
    ).suggestedVariants;
  } catch (err) {
    console.error('[warn] variantes intitulé indisponibles :', err);
  }
  console.log(`Variantes de l’intitulé : ${variants.join(', ') || '(aucune)'}`);
  const campaignSet = campaignTitleTermSet(jobTitle, variants);

  const { vector, provider, model } = await embedText(jobTitle);
  console.log(`Modèle d’embedding requête : ${provider}|${model}`);

  const candidates = await listIndexedVivierTitles();
  const sims = await matchVivierTitles(
    vector,
    candidates.map((c) => c.id),
  );

  const rows = candidates
    .map((c) => ({
      title: c.title ?? '(sans titre)',
      email: c.email,
      exact: firstDeterministicMatch(c.title, c.titleVariants, campaignSet),
      sim: sims.get(c.id) ?? null,
    }))
    .sort((a, b) => (b.sim ?? -1) - (a.sim ?? -1));

  console.log(
    `\n${candidates.length} dossier(s) indexé(s). Distribution titre-à-titre (meilleur → pire) :\n`,
  );
  for (const r of rows) {
    const simStr =
      r.sim === null ? '   —   ' : `${(r.sim * 100).toFixed(1).padStart(5)}%`;
    const tag = r.exact ? ` [EXACT: ${r.exact}]` : '';
    console.log(`  ${simStr}  ${r.title}${tag}  <${r.email}>`);
  }
  console.log(
    '\nFixez le « Seuil de pertinence » (Settings → Vivier) dans le CREUX entre les vrais profils et le hors-sujet.',
  );
  console.log(
    'Les lignes [EXACT] sont prises au bloc 1 (déterministe) quel que soit le seuil.',
  );
}

main().catch((err: unknown) => {
  console.error('[vivier:title-distribution] échec :', err);
  process.exitCode = 1;
});
