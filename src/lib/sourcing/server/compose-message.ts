/**
 * Rédaction du message d'approche — le SEUL appel au modèle par profil, au
 * clic du recruteur sur un profil qu'il a choisi (spec §1.2, §8.1).
 *
 * Le modèle propose ; le code vérifie (lien présent une fois, longueur une fois
 * le vrai lien inséré, aucune évaluation citée). Un dépassement déclenche UNE
 * seconde tentative plus courte, puis le gabarit déterministe. Le recruteur
 * relit et peut modifier avant de copier.
 */
import { z } from 'zod';

import { chatCompleteJson } from '@/lib/ai/provider';
import {
  checkMessage,
  LINK_PLACEHOLDER,
  MESSAGE_LIMITS,
  templateMessage,
  type ComposedMessage,
  type MessageContext,
  type MessageFormat,
} from '@/lib/sourcing/message';

const OutputSchema = z.object({ subject: z.string().nullable().optional(), body: z.string() });

const FORMAT_RULE: Record<MessageFormat, string> = {
  connection_note: `une NOTE D'INVITATION LinkedIn : 300 caractères MAXIMUM au total, emplacement ${LINK_PLACEHOLDER} compris compté pour 60 caractères ; deux phrases au plus ; pas d'objet`,
  inmail: 'un InMail LinkedIn : 5 à 8 lignes, pas d’objet',
  email: 'un email : un objet court (moins de 70 caractères) et un corps de 5 à 8 lignes',
};

function systemPrompt(format: MessageFormat): string {
  return `Tu rédiges, pour un recruteur, ${FORMAT_RULE[format]}, adressé à une personne dont le profil professionnel public correspond à un poste.

Règles, toutes obligatoires :
1. Français, vouvoiement, ton humain et sobre ; commence par « Bonjour <prénom>, » si le prénom est connu.
2. Dis pourquoi son parcours a retenu l'attention, en citant UN élément réel de son parcours fourni ci-dessous — rien d'autre.
3. Nomme le poste et, s'il est fourni, le lieu.
4. Insère l'emplacement ${LINK_PLACEHOLDER} EXACTEMENT une fois, là où la personne doit cliquer pour en savoir plus et répondre.
5. N'invente RIEN : ni salaire, ni entreprise, ni avantage, ni détail absent des données.
6. Ne cite JAMAIS de score, d'évaluation, de critère, ni la façon dont le profil a été trouvé.
7. Signe du prénom du recruteur s'il est fourni.

Rends un JSON : { "subject": string ou null, "body": string }.`;
}

function userPrompt(ctx: MessageContext): string {
  return [
    `Prénom de la personne : ${ctx.firstName ?? 'inconnu'}`,
    `Poste actuel : ${[ctx.currentTitle, ctx.currentCompany].filter(Boolean).join(' — ') || 'non renseigné'}`,
    `Parcours récent : ${ctx.highlights.join(' ; ') || 'non renseigné'}`,
    `Poste proposé : ${ctx.jobTitle}${ctx.location ? `, ${ctx.location}` : ''}`,
    `Recruteur : ${ctx.recruiterFirstName ?? 'non renseigné'}${ctx.organisation ? `, ${ctx.organisation}` : ''}`,
  ].join('\n');
}

export async function composeApproachMessage(
  format: MessageFormat,
  ctx: MessageContext,
  url: string,
): Promise<ComposedMessage & { method: 'llm' | 'template' }> {
  for (const attempt of [0, 1]) {
    try {
      const shorter =
        attempt === 1
          ? `\nLa version précédente était trop longue : vise ${Math.round(MESSAGE_LIMITS[format] * 0.75)} caractères au plus.`
          : '';
      const r = await chatCompleteJson(
        [
          { role: 'system', content: systemPrompt(format) + shorter },
          { role: 'user', content: userPrompt(ctx) },
        ],
        OutputSchema,
        { temperature: 0.3, maxTokens: 600 },
      );
      const composed: ComposedMessage = {
        subject: format === 'email' ? (r.data.subject?.trim() || null) : null,
        body: r.data.body.trim(),
      };
      if (checkMessage(composed.body, format, url).ok) return { ...composed, method: 'llm' };
    } catch {
      break; // panne du fournisseur : pas de seconde tentative, le gabarit prend le relais
    }
  }
  return { ...templateMessage(format, ctx), method: 'template' };
}
