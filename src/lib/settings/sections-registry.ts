/**
 * Registre des SECTIONS de Paramètres et de leurs FAMILLES — PUR.
 *
 * ⚠️ SOURCE UNIQUE. Titre, icône, description et mots-clés d'une section y
 * sont déclarés une fois ; l'écran, la recherche et la liste des réglages
 * manquants les lisent ici. Le titre affiché et le titre cherché ne peuvent
 * donc pas diverger.
 *
 * Les mots-clés existent parce qu'une section repliée ne MONTE pas son
 * contenu : chercher « cooldown » ou « NAF » doit trouver la section sans que
 * le champ soit à l'écran. Ils nomment ce qu'on y règle, avec les mots qu'on
 * tape.
 */
import { MESSAGE_TEMPLATES } from './message-templates';

export type SettingsSectionMeta = {
  id: string;
  icon: string;
  title: string;
  description: string;
  keywords: string[];
  /** Section réservée aux administrateurs. */
  adminOnly?: boolean;
};

export type SettingsFamily = {
  label: string;
  sections: SettingsSectionMeta[];
};

export const TEMPLATES_FAMILY_LABEL = 'Modèles de messages';
export const CABINET_FAMILY_LABEL = 'Cabinet et DPO';

const FAMILIES: SettingsFamily[] = [
  {
    label: CABINET_FAMILY_LABEL,
    sections: [
      {
        id: 'identite',
        icon: '🎨',
        title: 'Identité du cabinet',
        description:
          'Nom de l’organisation et signataire des messages au candidat, logo et couleur d’accent des pages de réservation et des messages — ce que voit le candidat.',
        keywords: [
          'organisation',
          'nom',
          'signataire',
          'signature',
          'recruteur',
          'logo',
          'couleur',
          'marque',
          'apparence',
          'branding',
        ],
      },
      {
        id: 'sourcing',
        icon: '🔎',
        title: 'Recherche de profils',
        description:
          'Module Sourcing : rechercher des profils professionnels publics pour une campagne active. Section réservée aux administrateurs.',
        keywords: ['sourcing', 'profils', 'linkedin', 'exa', 'approche'],
        adminOnly: true,
      },
      {
        id: 'vivier',
        icon: '🗂️',
        title: 'Vivier de candidats',
        description:
          'Mode de contact (validation manuelle ou automatique), cooldown anti-sollicitation, exclusion des recrutés, plafond de short-list et seuil de pertinence.',
        keywords: [
          'vivier',
          'cooldown',
          'plafond',
          'short-list',
          'pertinence',
          'similarité',
          'contact automatique',
          'recrutés',
        ],
      },
      {
        id: 'comptes-rendus',
        icon: '📝',
        title: 'Comptes rendus d’entretien',
        description:
          'Import de transcription d’entretien pour proposer un compte rendu (administrateurs). Le texte transite par le fournisseur de modèle : à valider avec le DPO.',
        keywords: ['compte rendu', 'transcription', 'dpo', 'entretien'],
        adminOnly: true,
      },
      {
        id: 'entretiens',
        icon: '📅',
        title: 'Agenda des entretiens',
        description:
          'Agenda sur lequel le candidat choisit son créneau : l’agenda interne ORQA par défaut, ou un lien d’agenda externe pour les campagnes encore sur Cal.com.',
        keywords: ['agenda', 'lien d’agenda', 'cal.com', 'calendly', 'entretien', 'créneau'],
      },
    ],
  },
  {
    label: TEMPLATES_FAMILY_LABEL,
    sections: MESSAGE_TEMPLATES.map((t) => ({
      id: t.id,
      icon: '✉️',
      title: t.title,
      description: t.when,
      keywords: ['modèle', 'template', 'message', 'mail', ...t.keywords],
    })),
  },
  {
    label: 'Équipe et disponibilité',
    sections: [
      {
        id: 'agendas',
        icon: '🗓️',
        title: 'Agendas & disponibilités',
        description:
          'Tes plages d’entretien, tes absences et ton lieu de rencontre — ce sur quoi les candidats réservent quand la campagne est en réservation native. Un administrateur peut ouvrir l’agenda d’un autre recruteur.',
        keywords: [
          'disponibilités',
          'plages',
          'absences',
          'jours fériés',
          'congés',
          'lieu',
          'réservation',
          'créneaux',
        ],
      },
      {
        id: 'recruteurs',
        icon: '🧑‍💼',
        title: 'Recruteurs',
        description:
          'Les utilisateurs de l’espace (multi-utilisateur) : nom, lien Cal.com personnel, rôle et désactivation. Les disponibilités se règlent dans « Agendas & disponibilités ». Section réservée aux administrateurs.',
        keywords: ['utilisateurs', 'rôle', 'admin', 'désactiver', 'équipe', 'cal.com'],
        adminOnly: true,
      },
      {
        id: 'donneurs',
        icon: '🏢',
        title: 'Donneurs d’ordre',
        description:
          'Les personnes (côté client) qui initient les campagnes — distinctes de l’utilisateur ORQA. Une campagne a un seul donneur d’ordre. Dimension consommée par le module Reporting.',
        keywords: ['client', 'donneur', 'reporting'],
      },
      {
        id: 'sites',
        icon: '📍',
        title: 'Sites',
        description:
          'Les implantations géographiques ou organisationnelles de rattachement des campagnes (multi-sites). Une campagne a un seul site. Un site « par défaut » existe pour les organisations mono-site.',
        keywords: ['site', 'implantation', 'ville', 'multi-sites'],
      },
    ],
  },
  {
    label: 'Réception & envoi des mails',
    sections: [
      {
        id: 'boites',
        icon: '📥',
        title: 'Boîtes de réception des CV',
        description:
          'Les boîtes mail IMAP surveillées par le poller. Quand un email arrive avec l’ID de campagne dans l’objet et un CV en pièce jointe, l’agent CV Analyzer s’exécute automatiquement.',
        keywords: ['imap', 'boîte', 'réception', 'relève', 'dossier', 'gmail', 'outlook'],
      },
      {
        id: 'synthese',
        icon: '📝',
        title: 'Adresses de synthèse',
        description:
          'Destinataires des briefings d’entretien. Cochez chaque adresse qui doit recevoir les briefings — le mail ne part qu’aux adresses cochées. Le recruteur référent d’une campagne reçoit TOUJOURS les briefings de ses campagnes en plus de cette liste (jamais en double s’il y figure déjà).',
        keywords: ['briefing', 'destinataires', 'synthèse', 'adresse'],
      },
      {
        id: 'expediteur',
        icon: '📤',
        title: 'Adresses expéditeur',
        description:
          'Adresses depuis lesquelles les mails (invitations, refus) sont envoyés. Doivent appartenir à un domaine vérifié côté Resend.',
        keywords: ['expéditeur', 'from', 'envoi', 'domaine', 'adresse'],
      },
      {
        id: 'resend',
        icon: '📧',
        title: 'Service email (Resend)',
        description:
          'Clé API Resend utilisée pour l’envoi des mails (invitations, refus, briefs). Pilotable ici — plus besoin de toucher au .env.local ni de redémarrer le serveur. La clé est stockée côté serveur et n’est jamais réaffichée.',
        keywords: ['resend', 'clé', 'api', 'envoi', 'email'],
      },
    ],
  },
  {
    label: 'Intégrations',
    sections: [
      {
        id: 'flux',
        icon: '🔌',
        title: 'Intégrations — Flux d’arrivée',
        description:
          'Identifiants d’API pour les canaux de réception automatique de CV. Configurez celles dont vous avez besoin ; les autres restent en mode manuel.',
        keywords: ['flux', 'api', 'réception', 'jobboard', 'indeed', 'welcome'],
      },
      {
        id: 'canaux',
        icon: '📢',
        title: 'Intégrations — Canaux de diffusion',
        description:
          'Credentials pour publier les annonces sur les jobboards. Sans configuration, la diffusion reste en mode trace (l’annonce est rédigée mais pas publiée).',
        keywords: ['apec', 'naf', 'convention', 'diffusion', 'publication', 'annonce', 'jobboard'],
      },
    ],
  },
];

/** Les familles visibles pour ce profil — une famille vide disparaît. */
export function settingsFamilies(isAdmin: boolean): SettingsFamily[] {
  return FAMILIES.map((f) => ({
    label: f.label,
    sections: f.sections.filter((s) => isAdmin || !s.adminOnly),
  })).filter((f) => f.sections.length > 0);
}

export function findSection(
  families: SettingsFamily[],
  id: string,
): { family: SettingsFamily; section: SettingsSectionMeta } | null {
  for (const family of families) {
    const section = family.sections.find((s) => s.id === id);
    if (section) return { family, section };
  }
  return null;
}

/** Minuscules, sans accents, apostrophes unifiées. */
export function normalizeSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[’‘`]/g, "'")
    .toLowerCase()
    .trim();
}

/**
 * Sections qui répondent à la recherche, dans l'ordre de la page.
 *
 * Chaque MOT tapé doit se retrouver quelque part (titre, description,
 * mots-clés, nom de la famille) : « refus cv » trouve « Refus sur CV » sans
 * exiger l'expression exacte. Requête vide ⇒ `null` (pas de filtre), jamais
 * « aucun résultat ».
 */
export function searchSettings(families: SettingsFamily[], query: string): string[] | null {
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const hits: string[] = [];
  for (const family of families) {
    for (const s of family.sections) {
      const haystack = normalizeSearch(
        [family.label, s.title, s.description, ...s.keywords].join(' '),
      );
      if (words.every((w) => haystack.includes(w))) hits.push(s.id);
    }
  }
  return hits;
}
