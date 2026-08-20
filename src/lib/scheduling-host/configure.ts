/**
 * Adaptateur : branche le module de réservation sur cette application.
 *
 * C'est le SEUL endroit où les deux mondes se touchent. Le module ne connaît
 * rien d'ici ; ce fichier lui fournit ses ports (base, transport d'email,
 * URL publique, identité visuelle) et rien d'autre. Il vit délibérément HORS
 * de `src/lib/scheduling/` : la frontière d'autonomie interdirait ces imports.
 *
 * Appelé au début de chaque route et de chaque page publique plutôt qu'au
 * démarrage : sur une plateforme où chaque requête peut réveiller une instance
 * neuve, un branchement « une fois au boot » ne tient pas.
 *
 * DEUX branchements, volontairement distincts (lot 3) :
 *   - `ensureSchedulingConfigured()` — les ports. Appelé partout, y compris
 *     sur les surfaces candidat ;
 *   - `ensureSchedulingConsumer()`   — le consommateur d'événements, qui
 *     déclenche la livraison des briefings. Appelé UNIQUEMENT par le rail de
 *     drain. Le module dispatche l'événement EN LIGNE juste après l'avoir
 *     écrit : enregistrer le consommateur sur la route publique ferait
 *     attendre le candidat pendant qu'ORQA télécharge un CV et envoie un mail.
 *     Sans consommateur, la ligne d'outbox reste simplement en attente (ce
 *     n'est pas un échec) et le drain la livre dans la minute.
 */
import { getAppSettings } from '@/lib/db/repos/app-settings';
import { requireServerSupabase } from '@/lib/db/supabase-server';
import { sendEmail } from '@/lib/email/client';
import {
  configureScheduling,
  isSchedulingConfigured,
  registerEventConsumer,
  updateSchedulingIdentity,
} from '@/lib/scheduling';
import {
  DEFAULT_BRANDING_CONFIG,
  resolveOrganizationName,
  type BrandingConfig,
} from '@/types/branding';

/**
 * Première valeur réellement renseignée. Une variable DÉFINIE MAIS VIDE ne
 * compte pas : sur Vercel on crée volontiers l'entrée avant d'avoir la valeur,
 * et un `??` s'y arrêterait (`'' ?? x` vaut `''`) en sautant le repli suivant.
 */
function firstConfigured(...values: (string | undefined)[]): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

/** Les variables Vercel ne portent pas de schéma ; un opérateur peut l'oublier. */
function withScheme(base: string): string {
  return /^https?:\/\//i.test(base) ? base : `https://${base}`;
}

/**
 * URL publique du service — sans elle, aucun lien de réservation n'est complet.
 *
 * Repli, du plus explicite au plus désespéré :
 *
 *  1. `NEXT_PUBLIC_APP_URL` / `NEXT_PUBLIC_SITE_URL` — la réponse VOULUE, la
 *     seule qu'on maîtrise. C'est elle qu'on pose en production.
 *  2. `VERCEL_PROJECT_PRODUCTION_URL` — l'ALIAS DE PRODUCTION du projet
 *     (domaine personnalisé s'il en existe un, sinon `<projet>.vercel.app`).
 *     STABLE d'un déploiement à l'autre : c'est le seul repli Vercel qui
 *     produise des liens survivant au déploiement suivant.
 *  3. `VERCEL_URL` — l'URL du DÉPLOIEMENT (`<projet>-<hash>-<équipe>`), NEUVE
 *     à chaque déploiement. Gardée en dernier recours parce qu'un lien
 *     joignable vaut mieux qu'un lien vers `localhost`, mais elle est un
 *     PIÈGE : le lien meurt au déploiement suivant, et le domaine de l'UID
 *     d'agenda qui en dérive (`icsDomain`) change avec lui — un déplacement
 *     duplique le rendez-vous au lieu de le bouger, une annulation est
 *     ignorée et le créneau reste dans l'agenda du candidat.
 *  4. `localhost` — développement.
 */
export function schedulingBaseUrl(): string {
  const explicit = firstConfigured(
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_SITE_URL,
  );
  const vercel = firstConfigured(
    // L'alias de production AVANT l'URL de déploiement : voir ci-dessus.
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_URL,
  );
  const base = explicit ?? vercel;
  if (!base) return 'http://localhost:3000';
  return withScheme(base).replace(/\/+$/, '');
}

/**
 * Mention de traitement des données servie aux candidats. Le libellé par
 * défaut du module reste le repli : il est correct, simplement générique.
 */
const CANDIDATE_PRIVACY_NOTICE =
  'Vos coordonnées servent uniquement à organiser cet entretien. Elles sont ' +
  'conservées le temps du processus de recrutement, puis dans notre vivier de ' +
  'candidatures si vous ne vous y opposez pas. Vous pouvez demander leur ' +
  'rectification ou leur suppression à tout moment.';

/**
 * Réglages relus au plus une fois par minute. L'identité du cabinet change
 * quelques fois par an ; la relire à chaque ouverture de page ajouterait un
 * aller-retour de base sur le chemin critique d'un lien ouvert depuis un mail.
 */
const SETTINGS_TTL_MS = 60_000;
let configuredAt = 0;

type Identity = { organizationName: string | null; branding: BrandingConfig };

async function loadIdentity(): Promise<Identity> {
  try {
    const settings = await getAppSettings();
    return {
      organizationName: resolveOrganizationName(settings),
      branding: settings?.brandingConfig ?? DEFAULT_BRANDING_CONFIG,
    };
  } catch {
    // Base injoignable : les surfaces restent utilisables, simplement sobres.
    return {
      organizationName: process.env.NEXT_PUBLIC_ORGANIZATION_NAME?.trim() || null,
      branding: DEFAULT_BRANDING_CONFIG,
    };
  }
}

export async function ensureSchedulingConfigured(): Promise<void> {
  if (isSchedulingConfigured() && Date.now() - configuredAt < SETTINGS_TTL_MS) {
    return;
  }

  const identity = await loadIdentity();
  // Déjà branché : on ne REMPLACE pas la configuration, on rafraîchit
  // seulement l'identité. Écraser reposerait les ports — et emporterait au
  // passage tout transport que l'hôte aurait installé lui-même.
  if (isSchedulingConfigured()) {
    updateSchedulingIdentity({
      organizationName: identity.organizationName,
      branding: identity.branding,
      labels: { privacyNotice: CANDIDATE_PRIVACY_NOTICE },
    });
    configuredAt = Date.now();
    return;
  }

  configureScheduling({
    // Résolution PARESSEUSE : le client n'est créé qu'au premier accès, et
    // une configuration Supabase absente échoue là où c'est diagnosticable.
    supabase: () => requireServerSupabase(),
    publicBaseUrl: schedulingBaseUrl(),
    organizationName: identity.organizationName ?? undefined,
    branding: identity.branding,
    // ORQA prévient LUI-MÊME le recruteur, et bien plus complètement : CV en
    // pièce jointe, synthèse, verdict, trame d'entretien, lieu, invitation
    // d'agenda. Laisser le module envoyer son message générique en plus, c'est
    // recevoir deux mails pour un rendez-vous — le pauvre arrivant le premier.
    // L'invité, lui, reste notifié par le module.
    notifyOrganizer: false,
    labels: { privacyNotice: CANDIDATE_PRIVACY_NOTICE },
    mailer: {
      async send(message) {
        const result = await sendEmail({
          to: message.to,
          subject: message.subject,
          html: message.html,
          ...(message.attachments && message.attachments.length > 0
            ? {
                attachments: message.attachments.map((attachment) => ({
                  filename: attachment.filename,
                  content: attachment.contentBase64,
                  ...(attachment.contentType
                    ? { contentType: attachment.contentType }
                    : {}),
                })),
              }
            : {}),
        });
        return {
          ok: result.ok,
          messageId: result.messageId,
          ...(result.error ? { error: result.error } : {}),
        };
      },
    },
  });
  configuredAt = Date.now();
}

/**
 * Branchement COMPLET : ports + consommateur d'événements. Réservé au rail de
 * drain (cron) et aux actions de pilotage internes — jamais aux surfaces
 * candidat (cf. en-tête).
 */
export async function ensureSchedulingConsumer(): Promise<void> {
  await ensureSchedulingConfigured();
  // Import différé : le consommateur tire tout le métier (briefings, CV,
  // journal). Une page publique qui appelle `ensureSchedulingConfigured` ne
  // doit pas charger ce graphe pour rien.
  const { handleSchedulingEvent } = await import('./consumer');
  registerEventConsumer(handleSchedulingEvent);
}

/** Force la relecture des réglages au prochain appel (tests, sauvegarde UI). */
export function invalidateSchedulingConfig(): void {
  configuredAt = 0;
}
