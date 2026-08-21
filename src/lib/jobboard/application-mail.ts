/**
 * Composition du mail de candidature émis par le jobboard de démonstration.
 * Pur, testé — aucun accès réseau, aucune lecture d'environnement.
 *
 * CHOIX STRUCTURANT : le jobboard n'injecte RIEN dans le pipeline. Il envoie un
 * vrai mail à la boîte associée à la campagne, et la relève IMAP fait le reste.
 * La démonstration emprunte donc EXACTEMENT le chemin de production — c'est ce
 * qui la rend probante. (L'injection directe reste analysée dans
 * `docs/specs/demo-jobboard.md` §6 pour un éventuel mode instantané.)
 *
 * Conséquence sur l'objet du mail : il DOIT porter l'identifiant de campagne.
 * C'est le signal FORT du rapprochement (`resolveCampaignMatch`, priorité
 * sujet > corps) — sans lui, le CV part dans la file des non rattachés.
 */

import { isSupportedCvAttachment } from '@/lib/imap/cv-attachment';

/**
 * 10 Mo. Plus bas que les 15 Mo de `/api/cv-analyzer` : ici la pièce jointe
 * traverse en plus un fournisseur d'envoi, dont les limites sont plus basses
 * que celles d'un upload direct. Mieux vaut un refus net à la saisie qu'un
 * envoi accepté puis rejeté silencieusement par le transporteur.
 */
export const MAX_CV_BYTES = 10 * 1024 * 1024;

export type ApplicationFormInput = {
  fullName: string;
  email: string;
  phone: string | null;
  fileName: string;
  mime: string;
  size: number;
};

export type ApplicationValidation =
  | { ok: true; value: { fullName: string; email: string; phone: string | null } }
  | { ok: false; code: string; message: string };

/**
 * Permissif à dessein : on vérifie qu'une adresse est plausible, pas qu'elle
 * existe. Un formulaire public qui refuse une adresse valide est un défaut plus
 * grave qu'un formulaire qui accepte une adresse morte — celle-ci se verra au
 * premier envoi, l'autre fait perdre un candidat sans trace.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateApplication(
  input: ApplicationFormInput,
): ApplicationValidation {
  const fullName = input.fullName.trim();
  if (fullName.length < 2 || fullName.length > 120) {
    return {
      ok: false,
      code: 'invalid_name',
      message: 'Merci d’indiquer votre nom complet.',
    };
  }

  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 200) {
    return {
      ok: false,
      code: 'invalid_email',
      message: 'Cette adresse email ne semble pas valide.',
    };
  }

  const phoneRaw = (input.phone ?? '').trim();
  if (phoneRaw.length > 40) {
    return {
      ok: false,
      code: 'invalid_phone',
      message: 'Ce numéro de téléphone est trop long.',
    };
  }

  if (input.size === 0) {
    return {
      ok: false,
      code: 'empty_cv',
      message: 'Le fichier envoyé est vide.',
    };
  }
  if (input.size > MAX_CV_BYTES) {
    return {
      ok: false,
      code: 'cv_too_large',
      message: `Votre CV dépasse la taille maximale de ${Math.round(
        MAX_CV_BYTES / (1024 * 1024),
      )} Mo.`,
    };
  }
  // Même porte que le chemin IMAP (`isSupportedCvAttachment`, MIME OU
  // extension) : accepter ici un format que l'analyse ne saura pas lire
  // reviendrait à confirmer une candidature qui n'arrivera jamais nulle part.
  if (!isSupportedCvAttachment(input.mime, input.fileName)) {
    return {
      ok: false,
      code: 'unsupported_format',
      message: 'Formats acceptés : PDF ou DOCX.',
    };
  }

  return {
    ok: true,
    value: { fullName, email, phone: phoneRaw.length > 0 ? phoneRaw : null },
  };
}

/**
 * Objet du mail. L'identifiant de campagne y est mis entre parenthèses en fin
 * de ligne : lisible pour un humain, et trouvé tel quel par le rapprochement
 * (recherche de sous-chaîne insensible à la casse, pas d'expression rationnelle
 * à satisfaire).
 */
export function buildApplicationSubject(args: {
  campaignId: string;
  jobTitle: string;
}): string {
  return `Candidature — ${args.jobTitle.trim()} (${args.campaignId})`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Corps du mail : court, factuel, et il REDIT l'identifiant de campagne. Le
 * corps n'est qu'un repli du sujet dans le rapprochement, mais ce repli est ce
 * qui sauve la candidature si un client de messagerie réécrit l'objet.
 *
 * Les coordonnées saisies au formulaire y figurent parce que l'analyse, elle,
 * lit l'adresse DANS LE CV : si les deux diffèrent, le recruteur doit pouvoir
 * s'en apercevoir sans ouvrir la pièce jointe.
 */
export function buildApplicationHtml(args: {
  campaignId: string;
  jobTitle: string;
  fullName: string;
  email: string;
  phone: string | null;
}): string {
  const phoneLine = args.phone
    ? `<p style="margin:0 0 4px"><strong>Téléphone :</strong> ${escapeHtml(args.phone)}</p>`
    : '';
  return [
    '<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;color:#1f2937;line-height:1.6">',
    `<p style="margin:0 0 12px">Bonjour,</p>`,
    `<p style="margin:0 0 12px">Je souhaite candidater au poste de <strong>${escapeHtml(
      args.jobTitle,
    )}</strong> (référence ${escapeHtml(args.campaignId)}).</p>`,
    `<p style="margin:0 0 4px"><strong>Nom :</strong> ${escapeHtml(args.fullName)}</p>`,
    `<p style="margin:0 0 4px"><strong>Email :</strong> ${escapeHtml(args.email)}</p>`,
    phoneLine,
    `<p style="margin:12px 0 0">Vous trouverez mon CV en pièce jointe.</p>`,
    `<p style="margin:12px 0 0">Cordialement,<br/>${escapeHtml(args.fullName)}</p>`,
    '</div>',
  ]
    .filter(Boolean)
    .join('');
}
