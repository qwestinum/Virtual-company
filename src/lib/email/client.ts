/**
 * Service email — wrapper Resend (Session 5 round 4).
 *
 * Le service account Resend permet de tester immédiatement avec
 * `onboarding@resend.dev` comme expéditeur (utilisateur destinataire =
 * adresse vérifiée du compte Resend uniquement). Pour envoyer à
 * n'importe qui, configurer un domaine vérifié (DNS records).
 *
 * Mode dégradé : si `RESEND_API_KEY` manque, `getEmailClient` retourne
 * null. Les appelants doivent traduire en no-op silencieux (mail
 * marqué comme « non envoyé — config absente » dans l'artefact, le
 * workflow continue).
 *
 * Config :
 *   RESEND_API_KEY  — clé Resend (re_…).
 *   EMAIL_FROM      — expéditeur. Défaut « onboarding@resend.dev ».
 *   EMAIL_DRH       — destinataire des briefs entretien.
 */

import { Resend } from 'resend';

export type EmailClient = {
  resend: Resend;
  from: string;
  drhAddress: string | null;
};

let cached: EmailClient | null | undefined;

export function getEmailClient(): EmailClient | null {
  if (cached !== undefined) return cached;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    cached = null;
    return null;
  }
  cached = {
    resend: new Resend(apiKey),
    from: process.env.EMAIL_FROM ?? 'onboarding@resend.dev',
    drhAddress: process.env.EMAIL_DRH ?? null,
  };
  return cached;
}

export class EmailNotConfiguredError extends Error {
  constructor() {
    super('email_not_configured');
    this.name = 'EmailNotConfiguredError';
  }
}

export function requireEmailClient(): EmailClient {
  const c = getEmailClient();
  if (!c) throw new EmailNotConfiguredError();
  return c;
}

export type SendEmailInput = {
  to: string;
  subject: string;
  /** Contenu HTML. Le texte brut est dérivé automatiquement. */
  html: string;
  /** Adresse de réponse (optionnel) — typiquement EMAIL_DRH. */
  replyTo?: string;
};

export type SendEmailResult = {
  ok: boolean;
  messageId: string | null;
  error?: string;
};

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const client = getEmailClient();
  if (!client) {
    return { ok: false, messageId: null, error: 'email_not_configured' };
  }
  // Session 6 v4 — l'expéditeur dynamique vient de /settings s'il y est
  // configuré, sinon on retombe sur la valeur instance par défaut.
  let fromOverride: string | null = null;
  try {
    const { getSenderEmail } = await import('@/lib/email/addresses');
    fromOverride = await getSenderEmail();
  } catch {
    // ignore — on garde le default Resend
  }
  try {
    const { data, error } = await client.resend.emails.send({
      from: fromOverride ?? client.from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    });
    if (error) {
      return { ok: false, messageId: null, error: error.message };
    }
    return { ok: true, messageId: data?.id ?? null };
  } catch (err) {
    return {
      ok: false,
      messageId: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export type EmailDeliveryStatus = {
  ok: boolean;
  id: string;
  /**
   * Dernier évènement Resend connu : 'sent', 'delivered', 'bounced',
   * 'complained', 'delivery_delayed', 'queued'… ou null si inconnu.
   * 'delivered' = arrivé ; 'bounced' = rejeté ; un statut bloqué sur
   * 'sent'/'queued' alors que le destinataire ne reçoit rien pointe
   * vers un classement spam côté destinataire.
   */
  lastEvent: string | null;
  error?: string;
};

/**
 * Interroge Resend pour le statut de livraison d'un email déjà envoyé,
 * via son message-id (stocké dans le journal `imap_outreach_*`). Permet
 * de distinguer « livré », « bounce » et « accepté mais jamais livré »
 * (spam) sans webhook.
 */
export async function getEmailDeliveryStatus(
  id: string,
): Promise<EmailDeliveryStatus> {
  const client = getEmailClient();
  if (!client) {
    return { ok: false, id, lastEvent: null, error: 'email_not_configured' };
  }
  try {
    const { data, error } = await client.resend.emails.get(id);
    if (error) {
      return { ok: false, id, lastEvent: null, error: error.message };
    }
    const lastEvent =
      (data as { last_event?: string } | null)?.last_event ?? null;
    return { ok: true, id, lastEvent };
  } catch (err) {
    return {
      ok: false,
      id,
      lastEvent: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Exposé pour les tests — réinitialise le cache du module.
 */
export function _resetEmailClientForTests(): void {
  cached = undefined;
}
