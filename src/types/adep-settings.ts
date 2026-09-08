/**
 * Réglages APEC du cabinet — saisis une fois, dans `/settings`.
 *
 * La ligne de partage avec le formulaire de publication : **ici, ce qui ne
 * change jamais d'une offre à l'autre**. Le code NAF du cabinet, sa description,
 * sa politique de logo, son mode de convention. Tout ce qui dépend du poste —
 * contrat, lieu, salaire, expérience, nombre de postes — se décide PAR OFFRE.
 *
 * Y figer une valeur « par poste » ferait publier la mauvaise à la première
 * offre qui sort de l'ordinaire, et personne ne s'en apercevrait avant qu'un
 * candidat postule à un CDI annoncé comme un CDD.
 *
 * Les *valeurs par défaut* sont l'exception assumée : elles ne décident rien,
 * elles pré-remplissent un champ que l'humain voit et peut changer.
 *
 * ⚠️ Aucun secret ici. `ADEP_ATS_ID` et la clé Argon2 sont des variables
 * d'environnement ; le `numeroDossier` est chiffré sur la fiche recruteur.
 */

import { z } from 'zod';

import {
  SALAIRE_TEXTE_CODES,
  STATUT_POSTE_CODES,
  ZONE_DEPLACEMENT_CODES,
} from '@/lib/jobboards/adep/domains';

export const AdepConfigSchema = z.object({
  /**
   * Mode de convention Apec. `self` = le cabinet recrute pour lui-même,
   * `broker` = il recrute pour un client réel. Le mode indirect n'est ouvert
   * qu'aux conventions Cabinets / ETT / PRISME (API_330 sinon) : ce n'est pas
   * un choix esthétique, c'est ce que le contrat Apec autorise.
   */
  clientMode: z.enum(['self', 'broker']).default('self'),

  /** Code NAF du cabinet, format `0000X`. Obligatoire pour publier. */
  nafCode: z.string().max(5).default(''),

  /**
   * Description de l'entreprise, 100 à 3000 caractères (API_407). Texte de
   * marque, réécrit rarement — d'où sa place ici plutôt que par offre.
   */
  organizationDescription: z.string().max(3000).default(''),

  /** Afficher le logo du cabinet sur l'annonce (API_366/369). */
  displayLogo: z.boolean().default(true),

  // ── Valeurs par défaut du formulaire ────────────────────────────────
  defaultTravelZone: z.enum(ZONE_DEPLACEMENT_CODES).default('AUCUN'),
  defaultStatusJob: z.enum(STATUT_POSTE_CODES).default('CADRE_PRIVE'),
  defaultDisplayedPay: z.enum(SALAIRE_TEXTE_CODES).default('2'),

  /** Conseils aux candidats, ≤ 500 caractères. Facultatif (API_409). */
  presentationDescription: z.string().max(500).default(''),
  /** Processus de recrutement, ≤ 500 caractères. Facultatif (API_410). */
  recruitmentDescription: z.string().max(500).default(''),
});

export type AdepConfig = z.infer<typeof AdepConfigSchema>;

export const DEFAULT_ADEP_CONFIG: AdepConfig = AdepConfigSchema.parse({});

/**
 * Ce qui manque pour pouvoir publier, en français.
 *
 * Rendu par l'écran AVANT le bouton, jamais au moment de l'envoi : découvrir
 * qu'un code NAF manque après avoir rempli douze champs est le genre de
 * parcours qu'on n'inflige pas.
 */
export function missingAdepSettings(config: AdepConfig): string[] {
  const missing: string[] = [];
  if (!config.nafCode.trim()) {
    missing.push('le code NAF du cabinet');
  }
  if (config.organizationDescription.trim().length < 100) {
    missing.push("la description de l'entreprise (100 caractères minimum)");
  }
  return missing;
}
