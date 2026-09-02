/**
 * Rapport de confirmation d'effacement — PUR.
 * Procédure : docs/ops/purge-rgpd-candidat.md §10.
 *
 * C'est le LIVRABLE. Il se transmet tel quel au responsable de traitement, qui
 * le relaie au candidat. Il est donc écrit en français, sans jargon, et il ne
 * contient NI le nom NI l'adresse de la personne : elle y est désignée par la
 * référence de sa demande, et c'est le responsable de traitement qui, chez lui,
 * fait le lien.
 *
 * Il dit aussi ce qui n'a PAS été fait, et par qui ça doit l'être. Un rapport
 * d'effacement qui laisse croire à une couverture complète alors que le message
 * d'origine dort encore dans une boîte de réception ne vaut rien.
 *
 * ─── IL NE PORTE QUE DES COMPTEURS (incident du 02/09/2026) ──────────────
 * `ReportInput` n'accepte AUCUN constat du contrôle : ni résidu, ni homonyme,
 * ni extrait. C'est structurel, et c'est la première des deux ceintures — un
 * livrable qui ne reçoit pas la donnée ne peut pas la publier.
 *
 * La seconde est `assertNoLeakedIdentity`, à appeler AVANT d'écrire le
 * fichier : elle relit le texte rendu et refuse tout net s'il porte une
 * identité. Deux ceintures parce que la faute a réellement eu lieu — un
 * rejeu a rendu 6525 « résidus » nommant tous les autres candidats de la
 * base, et il ne s'en est fallu que d'un `--report` pour que ces noms
 * partent chez le responsable de traitement.
 */

import type { ErasureCounts, StorageTarget, VerificationStatus } from '@/types/gdpr';

export type ReportInput = {
  requestRef: string;
  receivedAt: string | null;
  executedAt: string;
  environmentLabel: string;
  counts: ErasureCounts;
  alreadyErased: ErasureCounts;
  storage: StorageTarget[];
  /** Les analyses ont-elles été supprimées plutôt que vidées ? (§6.1) */
  purgedAnalyses: boolean;
  /**
   * Rétention réelle des sauvegardes de l'hébergeur, en jours. `null` ⇒ le
   * rapport dit qu'elle reste à confirmer, plutôt que d'annoncer au candidat
   * un délai supposé.
   */
  backupRetentionDays: number | null;
  /** Constat seulement : aucune écriture n'a eu lieu. */
  dryRun: boolean;
  /**
   * Verdict du contrôle final. `not_run` (périmètre vide) n'est PAS `clean` :
   * annoncer « un contrôle a vérifié » quand il n'y avait rien à contrôler
   * serait une affirmation fausse dans un document qui sert de preuve.
   */
  verification: VerificationStatus;
};

/** Le rapport porte une identité : il ne doit pas être transmis. */
export class ReportLeakError extends Error {
  constructor(readonly fragment: string) {
    super(
      'Le rapport porte une donnée nominative et n’a pas été écrit ' +
        `(fragment reconnu : « ${fragment} »). Un rapport d’effacement ne ` +
        'contient que des compteurs.',
    );
    this.name = 'ReportLeakError';
  }
}

/**
 * GARDE DURE, à appeler avant toute écriture du rapport.
 *
 * `forbidden` reçoit tout ce que l'exécution a manipulé de nominatif : les
 * adresses et noms du sujet, et CHAQUE extrait relevé par le contrôle — donc
 * aussi ceux qui appartiendraient à des tiers. Si l'un d'eux se retrouve dans
 * le texte rendu, on n'écrit rien et on le dit.
 *
 * Ce n'est pas une détection de « données personnelles » en général — c'est
 * impossible. C'est le refus de recopier une valeur qu'on a lue en base :
 * exactement la classe de fuite qui s'est produite.
 */
export function assertNoLeakedIdentity(
  report: string,
  forbidden: string[],
  /**
   * Fragments SOUSTRAITS du texte avant l'examen — en pratique, la référence
   * de la demande. Elle est recopiée telle quelle depuis l'instruction du
   * responsable de traitement, qui l'a souvent formulée avec le nom de la
   * personne (« demande de Jean Dupont du 27/08 »). C'est SA phrase, dans un
   * document qui lui revient : la bloquer ferait échouer la commande sur le
   * cas nominal. L'opérateur en est averti séparément, et reste libre de
   * choisir une référence neutre.
   */
  ignore: string[] = [],
): void {
  let haystack = report.toLowerCase();
  for (const skip of ignore) {
    const s = skip.trim().toLowerCase();
    if (s.length > 0) haystack = haystack.split(s).join(' ');
  }
  for (const raw of forbidden) {
    const needle = raw.trim().toLowerCase();
    // Les fragments trop courts produiraient des collisions avec la prose
    // française du rapport ; ils ne suffisent de toute façon pas à identifier.
    if (needle.length < 5) continue;
    if (haystack.includes(needle)) throw new ReportLeakError(raw.trim().slice(0, 60));
  }
}

export function renderErasureReport(input: ReportInput): string {
  const c = input.counts;
  const total = totalErased(c);
  const L: string[] = [];

  L.push(input.dryRun
    ? '# Constat préalable à un effacement (aucune donnée modifiée)'
    : '# Rapport d’effacement de données personnelles');
  L.push('');
  if (input.verification === 'residues') {
    // Le document reste produit — il sert à l'opérateur — mais il ne peut plus
    // être pris pour une confirmation. Le dire EN TÊTE, pas en annexe.
    L.push(
      '> ⚠️ **NE PAS TRANSMETTRE EN L’ÉTAT.** Le contrôle final a retrouvé des ' +
        'traces de la personne après l’effacement. Ce document n’est pas une ' +
        'confirmation : traitez les constats affichés par la commande, puis ' +
        'relancez-la.',
    );
    L.push('');
  }
  L.push(`**Demande** : ${input.requestRef}`);
  if (input.receivedAt) L.push(`**Reçue le** : ${frDate(input.receivedAt)}`);
  L.push(`**${input.dryRun ? 'Constat établi le' : 'Exécutée le'}** : ${frDate(input.executedAt)}`);
  L.push(`**Périmètre** : ${input.environmentLabel}`);
  L.push('');
  L.push(
    'Ce document est identifié par la référence de la demande. Il ne mentionne ' +
      'ni le nom ni l’adresse de la personne concernée — le lien est établi par ' +
      'le responsable de traitement, qui détient seul cette correspondance.',
  );

  // ── 1. Effacé ────────────────────────────────────────────────────────────
  L.push('', '## 1. Ce qui a été effacé', '');
  if (total === 0) {
    L.push(
      'Aucune donnée n’a été trouvée pour cette personne dans ce périmètre. ' +
        'Si une demande antérieure a déjà été exécutée ici, c’est le résultat attendu.',
    );
    if (input.verification === 'not_run' && !input.dryRun) {
      L.push('');
      L.push(
        'Il n’y avait donc **rien à contrôler** : le contrôle de ré-identification ' +
          'est resté **sans objet**. Ce point est important et il est dit ici plutôt ' +
          'que passé sous silence — l’absence de données trouvées aujourd’hui ne ' +
          'peut pas, à elle seule, démontrer qu’un effacement antérieur a été ' +
          'complet. Cette démonstration-là repose sur le rapport de l’exécution ' +
          'd’origine.',
      );
    }
  } else {
    L.push('| Catégorie | Volume |', '|---|---|');
    for (const line of erasedLines(c, input.purgedAnalyses)) {
      L.push(`| ${line.label} | ${line.value} |`);
    }
  }

  const review = input.storage.filter((s) => s.action === 'review');
  if (review.length > 0) {
    L.push('', `**${review.length} fichier(s) laissé(s) en attente de vérification.** ` +
      'Ils portent le nom de la personne sans son adresse : ils peuvent appartenir ' +
      'à un homonyme. Ils n’ont pas été supprimés — une vérification humaine est ' +
      'nécessaire avant toute décision.');
  }

  // ── 2. Pseudonymisé ──────────────────────────────────────────────────────
  L.push('', '## 2. Ce qui a été pseudonymisé, et pourquoi', '');
  L.push(
    `**Journal d’audit — ${c.journalEntries} entrée(s).** Les événements sont ` +
      'conservés (quelle action, quand, sur quelle campagne, avec quel résultat) ; ' +
      'le nom, l’adresse, le téléphone, l’objet des messages et les noms de ' +
      'fichiers en ont été retirés et remplacés par une mention d’effacement.',
  );
  L.push('');
  L.push(
    'La raison est simple : ce journal est ce qui permet de **démontrer** ce qui ' +
      'a été fait pour cette personne — y compris son effacement. Le supprimer ' +
      'reviendrait à supprimer la preuve de l’effacement lui-même.',
  );

  if (!input.purgedAnalyses && (c.analyses > 0 || input.alreadyErased.analyses > 0)) {
    L.push('');
    L.push(
      `**Candidatures — ${c.analyses} analyse(s).** Elles ont été réduites à une ` +
        'ligne statistique anonyme : date de réception, campagne, score. Le nom, ' +
        'l’adresse, le téléphone, le texte du CV et l’ensemble des appréciations ' +
        'rédigées ont été détruits. Aucune donnée permettant d’identifier la ' +
        'personne n’y subsiste.',
    );
    L.push('');
    L.push(
      'Ce choix évite de fausser rétroactivement les bilans de campagne déjà ' +
        'transmis, dont les totaux auraient sinon changé après coup.',
    );
  }

  if (c.unmatchedRows > 0) {
    L.push('');
    L.push(
      `**File de réception — ${c.unmatchedRows} entrée(s).** Les CV concernés ont ` +
        'été supprimés du stockage. Les entrées correspondantes ont été vidées de ' +
        'toute mention nominative mais conservées : elles empêchent qu’un ancien ' +
        'message, s’il repassait devant le système de réception, recrée la ' +
        'candidature effacée.',
    );
  }

  // ── 3. Conservé ──────────────────────────────────────────────────────────
  L.push('', '## 3. Ce qui est conservé, et sur quelle base', '');
  L.push(
    '- **La trace de la demande** (sa référence, ses dates, les volumes traités) : ' +
      'obligation de démontrer la conformité du traitement (article 5.2 du RGPD). ' +
      'Elle ne contient ni nom ni adresse — l’adresse n’y figure que sous forme ' +
      'd’empreinte, qui ne permet pas de la reconstituer.',
  );
  L.push(
    '- **Les verrous techniques** qui empêchent qu’un ancien message ou une ancienne ' +
      'réservation ne recrée le dossier, ou ne déclenche un nouvel envoi. Ils ne ' +
      'contiennent aucune donnée personnelle.',
  );
  L.push(identifiersLine(input));
  L.push('');
  L.push(
    '**Aucune liste d’opposition n’a été créée.** Si la personne dépose une nouvelle ' +
      'candidature à l’avenir, elle sera traitée normalement : ce qui est bloqué, ' +
      'c’est la réapparition d’un ancien message, jamais la personne.',
  );

  // ── 4. Sauvegardes ───────────────────────────────────────────────────────
  L.push('', '## 4. Sauvegardes', '');
  L.push(
    input.backupRetentionDays === null
      ? 'Des copies de sauvegarde antérieures à cette date peuvent subsister le temps ' +
        'de la rotation de l’hébergeur. **La durée exacte est à confirmer auprès de ' +
        'l’hébergeur avant communication au candidat** — elle dépend du contrat de ' +
        'l’environnement concerné.'
      : `Des copies de sauvegarde antérieures à cette date subsistent le temps de la ` +
        `rotation de l’hébergeur, soit **${input.backupRetentionDays} jours**. Elles ` +
        `sont ensuite écrasées automatiquement. Elles ne sont ni consultées ni ` +
        `exploitées dans l’intervalle.`,
  );

  // ── 5. Hors périmètre ────────────────────────────────────────────────────
  L.push('', '## 5. Ce qui reste à faire, hors de ce système', '');
  L.push(
    'Une partie des données ne se trouve pas dans l’outil et ne peut donc pas y ' +
      'être effacée. Les actions ci-dessous relèvent du responsable de traitement.',
  );
  L.push('');
  L.push('| À faire | Où | Qui |', '|---|---|---|');
  L.push('| Supprimer le message de candidature d’origine et le CV joint | Boîte de réception surveillée | Responsable de traitement |');
  L.push('| Supprimer les briefings d’entretien reçus (le CV y est joint) et les bilans transmis | Boîtes des recruteurs et adresses de synthèse | Responsable de traitement |');
  L.push('| Demander l’effacement des journaux d’envoi et des pièces jointes | Prestataire d’envoi de courriels | Responsable de traitement |');
  L.push('| Vérifier la politique de rétention appliquée au texte des CV transmis pour analyse | Fournisseur du modèle de langage | Responsable de traitement |');
  L.push('| Supprimer les copies locales de CV et leur journal d’import, s’il en existe | Poste de l’opérateur | Opérateur |');

  // ── 6. Rejeu ─────────────────────────────────────────────────────────────
  const already = totalErased(input.alreadyErased);
  if (already > 0) {
    L.push('', '## 6. Éléments déjà traités', '');
    L.push(
      `${already} élément(s) portaient déjà la mention d’effacement d’une exécution ` +
        'antérieure et n’ont pas été modifiés. Le résultat est identique à celui ' +
        'd’une première exécution.',
    );
  }

  if (input.dryRun) {
    L.push('', '---', '');
    L.push(
      '**Ce document est un constat, pas un rapport d’exécution.** Aucune donnée ' +
        'n’a été modifiée. L’effacement doit être lancé explicitement après ' +
        'validation de ce constat.',
    );
  }

  L.push('');
  return L.join('\n');
}

// ─── Détail ────────────────────────────────────────────────────────────────

function erasedLines(
  c: ErasureCounts,
  purgedAnalyses: boolean,
): { label: string; value: number }[] {
  const lines: { label: string; value: number }[] = [];
  const add = (label: string, value: number) => {
    if (value > 0) lines.push({ label, value });
  };
  if (purgedAnalyses) add('Candidatures analysées (supprimées)', c.analyses);
  add('CV, rapports d’analyse et messages (fichiers)', c.storageFilesDeleted);
  add('Rapports groupés réécrits pour retirer la section concernée', c.storageFilesRewritten);
  add('Références de documents', c.artifactRows);
  add('Dossiers en attente de décision', c.validations);
  add('Briefings d’entretien', c.interviewBriefs);
  add('Dossiers de vivier (CV, index de recherche, propositions)', c.vivierDossiers);
  add('Liens de réservation', c.bookingLinks);
  add('Rendez-vous et leurs événements', c.bookings);
  return lines;
}

/**
 * La phrase sur les identifiants conservés dépend du contrôle : elle AFFIRME
 * qu'une vérification a eu lieu. Ne pas la faire varier reviendrait à
 * affirmer, dans un document de preuve, un contrôle qui n'a pas tourné.
 */
function identifiersLine(input: ReportInput): string {
  const head = '- **Les identifiants internes** (numéros de message, de campagne). ';
  if (input.dryRun) {
    return (
      head +
      'Après effacement, un contrôle automatique vérifie qu’aucun chemin ne ' +
      'permet d’en remonter à une identité.'
    );
  }
  if (input.verification === 'not_run') {
    return (
      head +
      'Aucune donnée n’ayant été trouvée dans ce périmètre, aucun identifiant ' +
      'n’y a été conservé au titre de cette exécution, et le contrôle de ' +
      'ré-identification n’avait pas d’objet.'
    );
  }
  return (
    head +
    'Ils ne désignent plus personne à l’intérieur du système : un contrôle ' +
    'automatique a vérifié qu’aucun chemin ne permet d’en remonter à une identité.'
  );
}

function totalErased(c: ErasureCounts): number {
  return Object.values(c).reduce((a, b) => a + b, 0);
}

function frDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', {
    timeZone: 'Europe/Paris',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}
