/**
 * Avertissements déterministes du Manager quand un document déposé n'est PAS un
 * CV (reconnaissance de nature). Pas d'analyse, pas de comptabilisation : on
 * informe et on oriente vers le bon endroit de l'outil (libellés réels de l'UI,
 * cf. cartographie). Tutoiement, chaleureux, lecture seule. PUR — testé.
 */

import type { DocumentNature } from '@/lib/chat/api-client';

export function documentNatureNotice(
  nature: DocumentNature,
  fileName: string,
): string {
  switch (nature) {
    case 'appel_offres':
      return `« ${fileName} » ne ressemble pas à un CV — on dirait plutôt un appel d'offres ou une fiche de poste. Je ne l'analyse donc pas comme un CV. Pour en faire une campagne, va dans l'onglet « Campagnes » → « Nouvelle campagne » : tu pourras même partir de ce document pour pré-remplir la fiche.`;
    case 'illisible':
      return `Je n'ai pas réussi à lire « ${fileName} » — si c'est un CV scanné sous forme d'image, renvoie-le plutôt en PDF texte (ou en .docx). Je ne l'ai pas analysé.`;
    case 'autre':
      return `« ${fileName} » ne ressemble pas à un CV — je ne l'analyse donc pas. Si c'en est bien un, vérifie qu'il est lisible et redépose-le ; sinon, dis-moi ce que tu veux en faire.`;
    case 'cv':
      // Cas non attendu (un CV est routé vers l'analyse) — message neutre.
      return `« ${fileName} » est pris en charge.`;
  }
}
