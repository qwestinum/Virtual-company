/**
 * Page d'atterrissage `/s/<jeton>` — ce qu'elle montre, et ce que la personne
 * renvoie. PUR. Spec : docs/specs/sourcing.md §9-10.
 *
 * ─── JAMAIS 404 SUR UN LIEN REÇU ─────────────────────────────────────────
 * La personne a reçu un message d'un recruteur. Une page d'erreur technique
 * ressemble à une arnaque ; chaque cas a donc sa phrase : invitation plus
 * disponible, offre fermée, recrutement suspendu, candidature déjà reçue.
 * ─────────────────────────────────────────────────────────────────────────
 */
import { z } from 'zod';

import { LINK_PLACEHOLDER } from '@/lib/sourcing/message';
import type { ExaSnapshot } from '@/types/sourcing';

export type LandingState =
  | { kind: 'unavailable' } // jeton inconnu, révoqué, module éteint
  | { kind: 'closed' } // campagne clôturée (ou absente)
  | { kind: 'paused' } // campagne suspendue : le lien reste valable
  | { kind: 'received' } // déjà soumis (en cours de création ou créée)
  | { kind: 'form'; prefilled: boolean };

export function resolveLandingState(input: {
  moduleEnabled: boolean;
  approach: { status: 'active' | 'revoked' | 'admission_pending' | 'submitted' } | null;
  campaignStatus: string | null;
  profileAvailable: boolean;
}): LandingState {
  if (!input.moduleEnabled || !input.approach || input.approach.status === 'revoked') return { kind: 'unavailable' };
  if (input.approach.status === 'submitted' || input.approach.status === 'admission_pending') return { kind: 'received' };
  if (input.campaignStatus === 'paused') return { kind: 'paused' };
  if (input.campaignStatus !== 'active') return { kind: 'closed' };
  return { kind: 'form', prefilled: input.profileAvailable };
}

/** Le message du recruteur, rappelé en tête — sans l'emplacement du lien, qui mène ici. */
export function recruiterMessageForLanding(stored: string | null): string | null {
  if (!stored) return null;
  const text = stored
    .split(LINK_PLACEHOLDER)
    .join('')
    .replace(/\s*:\s*(—|-|\n|$)/g, (_m, tail: string) => (tail ? `. ${tail}` : '.'))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  return text.length > 0 ? text : null;
}

// ─── Ce que la personne renvoie ───────────────────────────────────────────

const Line = z.string().trim().max(300);

export const SubmissionSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  phone: z
    .string()
    .trim()
    .max(40)
    .regex(/^[+\d][\d\s().-]{5,}$/)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  /** UNE case, obligatoire : « Ces informations sont exactes et peuvent être utilisées pour ma candidature ». */
  consent: z.literal(true),
  fullName: z.string().trim().min(2).max(120),
  /** Le parcours tel que la personne l'a relu — corrigé ligne à ligne ou non. */
  workHistory: z
    .array(z.object({ title: Line.min(1), company: Line.nullable(), from: z.string().max(10).nullable(), to: z.string().max(10).nullable() }))
    .max(30),
  education: z
    .array(z.object({ degree: Line.nullable(), institution: Line.nullable(), from: z.string().max(10).nullable(), to: z.string().max(10).nullable() }))
    .max(15),
  about: z.string().trim().max(3000).nullable(),
});
export type Submission = z.infer<typeof SubmissionSchema>;

/** Valeurs initiales du formulaire : ce que le profil public disait, rien de plus. */
export function initialSubmission(snapshot: ExaSnapshot | null): Omit<Submission, 'consent'> & { consent: false } {
  return {
    email: snapshot?.contacts?.emails[0] ?? '',
    phone: undefined,
    consent: false,
    fullName: snapshot?.name ?? '',
    workHistory: (snapshot?.workHistory ?? []).map((w) => ({ title: w.title, company: w.company, from: w.from, to: w.to })),
    education: (snapshot?.education ?? []).map((e) => ({ degree: e.degree, institution: e.institution, from: e.from, to: e.to })),
    about: snapshot?.about ?? null,
  };
}

// ─── CV structuré ─────────────────────────────────────────────────────────

const period = (from: string | null, to: string | null): string => {
  const f = (v: string | null) => (v ? v.slice(0, 7).split('-').reverse().join('/') : null);
  if (!from && !to) return '';
  return `${f(from) ?? '?'} – ${to ? f(to) : 'aujourd’hui'}`;
};

/**
 * Le CV que l'analyse lira quand la personne n'en joint pas. Rendu
 * DÉTERMINISTE de ce qu'elle a confirmé — aucun modèle ne l'écrit, aucune
 * donnée n'y est ajoutée. La mention d'origine y figure en toutes lettres.
 */
export function buildStructuredCvText(submission: Submission, confirmedAtIso: string): string {
  const confirmed = new Date(confirmedAtIso).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'long', year: 'numeric' });
  const lines: string[] = [submission.fullName, submission.email];
  if (submission.phone) lines.push(submission.phone);
  lines.push('', `Profil confirmé par le candidat le ${confirmed} — source initiale : profil professionnel public.`);
  if (submission.about) lines.push('', 'RÉSUMÉ', submission.about);
  if (submission.workHistory.length > 0) {
    lines.push('', 'EXPÉRIENCE PROFESSIONNELLE');
    for (const w of submission.workHistory) {
      lines.push(`${period(w.from, w.to)}  ${w.title}${w.company ? ` — ${w.company}` : ''}`.trim());
    }
  }
  if (submission.education.length > 0) {
    lines.push('', 'FORMATION');
    for (const e of submission.education) {
      lines.push(`${period(e.from, e.to)}  ${[e.degree, e.institution].filter(Boolean).join(' — ')}`.trim());
    }
  }
  return lines.join('\n');
}

// ─── Ouverture ────────────────────────────────────────────────────────────

/**
 * Robots d'aperçu de lien. LinkedIn, les messageries et les clients mail
 * ouvrent l'URL d'un message pour en afficher la vignette : compter ce passage
 * comme une ouverture journaliserait un faux « lien ouvert » et interdirait au
 * recruteur de « Recopier » un message que personne n'a lu.
 */
const PREVIEW_AGENT = /bot\b|crawler|spider|preview|linkedinbot|facebookexternalhit|slackbot|whatsapp|telegrambot|discordbot|skypeuripreview|embedly|outlook-ios|microsoftpreview|google-?safety|headlesschrome/i;

export function isLinkPreviewAgent(userAgent: string | null): boolean {
  if (!userAgent || userAgent.trim() === '') return true;
  return PREVIEW_AGENT.test(userAgent);
}
