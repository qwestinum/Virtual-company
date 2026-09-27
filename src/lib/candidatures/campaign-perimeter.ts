/**
 * PÉRIMÈTRE DE CAMPAGNES d'une requête de candidatures — l'intersection du
 * sélecteur de campagne et du filtre par référent.
 *
 * ⚠️ Pourquoi ce n'est pas un filtre de lignes. Le menu Candidatures pagine
 * CÔTÉ SERVEUR : filtrer les lignes reçues ne filtrerait qu'une page, et le
 * total comme le ruban mentiraient. Le filtre par référent restreint donc le
 * PÉRIMÈTRE envoyé à la requête, par le paramètre `campaignIds` qui existait
 * déjà pour « Campagnes actives ».
 *
 * ⚠️ Les deux réglages se COMBINENT. « Campagnes actives » + « Mes
 * campagnes » = mes campagnes actives, jamais l'un des deux qui écrase
 * l'autre. C'est une intersection, et elle peut être vide.
 *
 * ⚠️ UNE INTERSECTION VIDE N'EST PAS « TOUTES ». Un paramètre absent vaut
 * « toutes les campagnes » côté serveur : rendre une liste vide afficherait
 * donc TOUT à quelqu'un qui a demandé un sous-ensemble sans résultat. D'où la
 * sentinelle — un identifiant qui ne peut appartenir à aucune campagne (le
 * format métier est `CAMP-YYYY-NNN`), qui rend franchement zéro ligne.
 */

export const AUCUNE_CAMPAGNE = '__aucune-campagne__';

export type PerimetreEntree = {
  /** Campagne unique choisie au sélecteur ('' = aucune). */
  campaignId: string;
  /** Ensemble choisi au sélecteur (« Campagnes actives »), sinon vide. */
  campaignIds: readonly string[];
  /** Campagnes du référent sélectionné — `null` quand le filtre est « Tous ». */
  referentCampaignIds: readonly string[] | null;
};

export type PerimetreSortie = {
  campaignId: string;
  /** Valeur du paramètre `campaignIds` — `undefined` = aucune restriction. */
  campaignIdsParam: string | undefined;
};

export function perimetreCampagnes(entree: PerimetreEntree): PerimetreSortie {
  const { campaignId, campaignIds, referentCampaignIds } = entree;

  // Filtre « Tous » : rien ne change, le sélecteur décide seul.
  if (referentCampaignIds === null) {
    return {
      campaignId,
      campaignIdsParam: campaignIds.length > 0 ? campaignIds.join(',') : undefined,
    };
  }

  const duReferent = new Set(referentCampaignIds);

  // Une campagne unique : elle passe, ou le périmètre est vide.
  if (campaignId) {
    return duReferent.has(campaignId)
      ? { campaignId, campaignIdsParam: undefined }
      : { campaignId: '', campaignIdsParam: AUCUNE_CAMPAGNE };
  }

  const retenues =
    campaignIds.length > 0
      ? campaignIds.filter((id) => duReferent.has(id))
      : [...duReferent];

  return {
    campaignId: '',
    campaignIdsParam: retenues.length > 0 ? retenues.join(',') : AUCUNE_CAMPAGNE,
  };
}
