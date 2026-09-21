'use client';

/**
 * LES CAMPAGNES ACTIVES, et ce que le sourcing y a déjà fait.
 *
 * ⚠️ SURBRILLANCE BEIGE pour les campagnes déjà sourcées. Elles portaient un
 * aplat AMBRE avec un filet de 3 px : l'ambre est la couleur des alertes du
 * produit, et une campagne sourcée n'a rien d'alarmant. Le beige est une
 * NUANCE — 1,22:1 sur le blanc, comme les teintes de registre d'Aujourd'hui :
 * on voit le groupe sans que la ligne crie.
 *
 * ⚠️ Le geste diffère aussi : une campagne déjà sourcée propose « Détail »
 * (on y revient pour voir, pas pour relancer), une campagne vierge propose
 * « Sourcer ».
 *
 * ⚠️ ORDRE CHRONOLOGIQUE, la plus récemment sourcée d'abord. Les campagnes
 * jamais sourcées ferment la liste, par ancienneté de campagne : elles n'ont
 * pas de date de recherche à comparer.
 *
 * ⚠️ AUCUNE INDICATION DE COÛT. Le suivi du budget vit dans l'administration :
 * un recruteur n'a pas à connaître le prix d'une recherche pour décider s'il
 * en a besoin, et l'afficher là transformerait un choix de recrutement en
 * arbitrage comptable.
 */

import { ReferentMention } from '@/components/referent/ReferentMention';
import { CampaignIcon } from '@/components/ui/CampaignIcon';
import { ListRow } from '@/components/ui/ListRow';
import type { SourcingCampaignSummary } from '@/types/sourcing';

function derniereRecherche(iso: string | null): string {
  if (!iso) return 'jamais sourcée';
  const jours = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (jours <= 0) return 'dernière recherche aujourd’hui';
  return `dernière recherche il y a ${jours} j`;
}

/**
 * « 3 vus · 1 approché · 0 manifesté », au singulier près.
 *
 * ⚠️ UN CAS À PART : une campagne qui a une recherche DATÉE et pas un seul
 * profil. « 0 vu · 0 approché · 0 manifesté » s'y lit « la recherche n'a rien
 * trouvé de nouveau » — alors que le moteur a bien répondu et que
 * l'enregistrement a échoué (vu le 17/09/2026 : 100 résultats, zéro profil en
 * base). On le DIT, sinon on cherche le défaut du côté du recrutement.
 */
function volumes(c: SourcingCampaignSummary): string {
  const s = (n: number) => (n > 1 ? 's' : '');
  if (c.lastSearchAt !== null && c.seen + c.approached + c.manifested === 0) {
    return 'recherche effectuée, aucun profil enregistré — à relancer';
  }
  return `${c.seen} vu${s(c.seen)} · ${c.approached} approché${s(c.approached)} · ${c.manifested} manifesté${s(c.manifested)}`;
}

export function SourcingCampaignList({
  campaigns,
  myApproachesThisMonth,
  onSource,
}: {
  campaigns: SourcingCampaignSummary[];
  myApproachesThisMonth: number;
  onSource: (campaignId: string) => void;
}) {
  // CHRONOLOGIE : la dernière recherche d'abord. Les jamais sourcées ferment
  // la liste — elles n'ont pas de date à comparer.
  const ordonnees = [...campaigns].sort((a, b) => {
    const sa = a.lastSearchAt === null ? 1 : 0;
    const sb = b.lastSearchAt === null ? 1 : 0;
    if (sa !== sb) return sa - sb;
    return (b.lastSearchAt ?? '').localeCompare(a.lastSearchAt ?? '');
  });

  return (
    <section className="flex flex-col gap-3">
      <p className="font-body text-[13px]" style={{ color: 'var(--dash-text-secondary)' }}>
        Mes approches ce mois :{' '}
        <span className="font-data font-semibold" style={{ color: 'var(--dash-text)' }}>
          {myApproachesThisMonth}
        </span>
      </p>

      {ordonnees.length === 0 ? (
        <p
          className="rounded-lg border px-4 py-6 text-center font-body text-[13px]"
          style={{ borderColor: 'var(--dash-border)', color: 'var(--dash-text-secondary)' }}
        >
          Aucune campagne active. Le sourcing s’ouvre sur une campagne activée :
          c’est elle qui recevra et traitera les candidatures.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {ordonnees.map((c) => {
            const sourcee = c.lastSearchAt !== null;
            return (
              // ⚠️ `data-sourced` vit sur le <li>, PAS sur `ListRow`. Posé
              // sur le composant, TypeScript l'accepte sans broncher — les
              // attributs à tiret échappent à la vérification des props — et
              // `ListRow`, qui ne diffuse rien, le jetait en silence. Le test
              // qui le lit serait passé au vert sur un attribut absent.
              <li key={c.campaignId} data-sourced={sourcee}>
                <ListRow
                  testId={c.campaignId}
                  // La LIGNE est teintée, pas un liseré autour : posé en
                  // bordure d'un pixel, le beige ne se voyait pas.
                  tint={sourcee ? 'var(--dash-beige)' : undefined}
                  // Une CAMPAGNE : l'icône de campagne, pas un pavé
                  // d'initiales — il n'y a personne sur cette ligne.
                  avatar={<CampaignIcon kind="active" taille={40} />}
                  title={c.name}
                  reference={c.campaignId}
                  meta={`${volumes(c)} · ${derniereRecherche(c.lastSearchAt)}`}
                  right={
                    <>
                      <span
                        className="font-body text-[12px]"
                        style={{ color: 'var(--dash-text-secondary)' }}
                      >
                        <ReferentMention referent={c.referent} />
                      </span>
                      {sourcee ? (
                        <span
                          className="shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 font-body text-[11px] font-semibold"
                          style={{
                            background: 'var(--dash-beige)',
                            color: 'var(--dash-beige-encre)',
                          }}
                        >
                          Sourcée
                        </span>
                      ) : null}
                      <button
                        type="button"
                        data-sourcing-action={sourcee ? 'detail' : 'sourcer'}
                        onClick={() => onSource(c.campaignId)}
                        className="rounded-lg border px-2.5 py-1.5 font-body text-[12px] font-semibold"
                        style={{
                          borderColor: 'var(--dash-beige-bord)',
                          background: 'var(--dash-beige)',
                          color: 'var(--dash-beige-encre)',
                        }}
                      >
                        {sourcee ? 'Détail' : 'Sourcer'}
                      </button>
                    </>
                  }
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
