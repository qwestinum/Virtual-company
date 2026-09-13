/**
 * Message d'approche — règles, gabarit de repli, finalisation. PUR.
 * Spec : docs/specs/sourcing.md §8.1.
 *
 * ─── LE LIEN N'EST JAMAIS STOCKÉ ─────────────────────────────────────────
 * Le message est rédigé et CONSERVÉ avec l'emplacement `[lien]`. L'URL, qui
 * porte le jeton en clair, n'existe que dans la réponse faite au recruteur au
 * moment où il copie. Stocker le texte final reviendrait à stocker le jeton en
 * clair à côté de son empreinte — et l'empreinte ne protégerait plus rien.
 * ─────────────────────────────────────────────────────────────────────────
 */
import type { ExaSnapshot } from '@/types/sourcing';

export const LINK_PLACEHOLDER = '[lien]';

export type MessageFormat = 'connection_note' | 'inmail' | 'email';

export const MESSAGE_LIMITS: Record<MessageFormat, number> = {
  connection_note: 300,
  inmail: 1200,
  email: 1200,
};

/** Ajoutée par le CODE à tout email — jamais laissée au modèle (§8.1). */
export const EMAIL_INFORMATION_LINE =
  'Vos données proviennent de votre profil professionnel public ; le lien ci-dessous explique leur usage et comment vous y opposer.';

export type MessageContext = {
  firstName: string | null;
  currentTitle: string | null;
  currentCompany: string | null;
  /** 1 à 2 lignes de parcours qui justifient l'approche. */
  highlights: string[];
  jobTitle: string;
  location: string | null;
  recruiterFirstName: string | null;
  organisation: string | null;
};

export type ComposedMessage = { subject: string | null; body: string };

export function messageContextFrom(
  snapshot: ExaSnapshot,
  campaign: { jobTitle: string; location: string | null },
  recruiter: { displayName: string | null; organisation: string | null },
): MessageContext {
  return {
    firstName: snapshot.firstName ?? snapshot.name.split(/\s+/)[0] ?? null,
    currentTitle: snapshot.current?.title ?? null,
    currentCompany: snapshot.current?.company ?? null,
    highlights: snapshot.workHistory.slice(0, 2).map((w) => [w.title, w.company].filter(Boolean).join(' — ')),
    jobTitle: campaign.jobTitle,
    location: campaign.location,
    recruiterFirstName: recruiter.displayName?.trim().split(/\s+/)[0] ?? null,
    organisation: recruiter.organisation,
  };
}

/** Gabarit déterministe — repli quand le modèle échoue ou dépasse. */
export function templateMessage(format: MessageFormat, ctx: MessageContext): ComposedMessage {
  const hello = ctx.firstName ? `Bonjour ${ctx.firstName},` : 'Bonjour,';
  const where = ctx.location ? ` à ${ctx.location}` : '';
  const sign = ctx.recruiterFirstName ? ` — ${ctx.recruiterFirstName}` : '';
  if (format === 'connection_note') {
    const title = ctx.currentTitle ? `votre parcours de ${ctx.currentTitle}` : 'votre parcours';
    const body = `${hello} ${title} a retenu mon attention pour un poste de ${ctx.jobTitle}${where}. Si le sujet vous intéresse : ${LINK_PLACEHOLDER}${sign}`;
    return { subject: null, body: fitNote(body, ctx) };
  }
  const org = ctx.organisation ? ` chez ${ctx.organisation}` : '';
  const body = [
    hello,
    '',
    `Votre parcours${ctx.currentTitle ? ` de ${ctx.currentTitle}` : ''} a retenu mon attention : je recrute un·e ${ctx.jobTitle}${where}${org}.`,
    '',
    `Si le sujet vous intéresse, vous trouverez le détail du poste et pourrez me répondre ici : ${LINK_PLACEHOLDER}`,
    '',
    'Bien cordialement,',
    ctx.recruiterFirstName ?? '',
  ].join('\n');
  return { subject: format === 'email' ? `Poste de ${ctx.jobTitle}${where}` : null, body: body.trim() };
}

/** Note de connexion : on raccourcit l'intitulé cité avant de dépasser. */
function fitNote(body: string, ctx: MessageContext): string {
  if (renderedLength(body, 'x'.repeat(60)) <= MESSAGE_LIMITS.connection_note) return body;
  const hello = ctx.firstName ? `Bonjour ${ctx.firstName},` : 'Bonjour,';
  return `${hello} votre parcours a retenu mon attention pour un poste de ${ctx.jobTitle}. Intéressé·e ? ${LINK_PLACEHOLDER}`;
}

/** Longueur du texte ENVOYÉ : emplacement remplacé par l'URL réelle. */
export function renderedLength(body: string, url: string): number {
  return body.split(LINK_PLACEHOLDER).join(url).length;
}

export type MessageCheck = { ok: true } | { ok: false; reason: string };

/**
 * Un message n'est acceptable que s'il porte le lien EXACTEMENT une fois et
 * tient dans la limite du format UNE FOIS le lien réel inséré.
 */
export function checkMessage(body: string, format: MessageFormat, url: string): MessageCheck {
  const occurrences = body.split(LINK_PLACEHOLDER).length - 1;
  if (occurrences !== 1) return { ok: false, reason: occurrences === 0 ? 'lien absent' : 'lien présent plusieurs fois' };
  const length = renderedLength(format === 'email' ? withInformationLine(body) : body, url);
  if (length > MESSAGE_LIMITS[format]) return { ok: false, reason: `${length} caractères pour ${MESSAGE_LIMITS[format]}` };
  if (/\d{2,3}\s?\/\s?100|score|mention|critère/i.test(body)) return { ok: false, reason: 'le message cite une évaluation' };
  return { ok: true };
}

export function withInformationLine(body: string): string {
  return body.includes(EMAIL_INFORMATION_LINE) ? body : `${body}\n\n${EMAIL_INFORMATION_LINE}`;
}

/** Texte final remis au recruteur — le seul endroit où l'URL apparaît. */
export function renderMessage(body: string, format: MessageFormat, url: string): string {
  const full = format === 'email' ? withInformationLine(body) : body;
  return full.split(LINK_PLACEHOLDER).join(url);
}

/**
 * Remet l'emplacement à la place de l'URL dans un message édité par le
 * recruteur, avant stockage. `null` si l'URL a été retirée du texte.
 */
export function restorePlaceholder(edited: string, url: string): string | null {
  if (!edited.includes(url)) return null;
  return edited.split(url).join(LINK_PLACEHOLDER).replace(`\n\n${EMAIL_INFORMATION_LINE}`, '');
}

/** `mailto:` — au-delà d'une longueur sûre, le corps est copié et l'URL ne porte que l'objet. */
export const MAILTO_SAFE_LENGTH = 1800;

export function mailtoHref(to: string, subject: string | null, body: string): { href: string; bodyInHref: boolean } {
  const base = `mailto:${encodeURIComponent(to)}`;
  const withBody = `${base}?${subject ? `subject=${encodeURIComponent(subject)}&` : ''}body=${encodeURIComponent(body)}`;
  if (withBody.length <= MAILTO_SAFE_LENGTH) return { href: withBody, bodyInHref: true };
  return { href: subject ? `${base}?subject=${encodeURIComponent(subject)}` : base, bodyInHref: false };
}
