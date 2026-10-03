/**
 * Messages du formulaire « Boîtes de réception des CV » — PURS (03/10/2026).
 *
 * Défaut signalé : enregistrer une boîte sans intitulé affichait le message
 * BRUT du validateur (un tableau JSON en anglais, `too_small`, `path`…). Les
 * routes rendent désormais une phrase qui nomme le champ avec le LIBELLÉ DE
 * L'ÉCRAN, et le formulaire vérifie l'essentiel avant même d'envoyer.
 *
 * Client-safe : aucune dépendance serveur, les libellés sont partagés par les
 * routes et par le formulaire — un champ renommé à l'écran l'est partout.
 */

/** Libellés EXACTS des champs du formulaire. */
export const MAILBOX_FIELD_LABELS: Record<string, string> = {
  label: 'Intitulé',
  imapHost: 'Serveur IMAP',
  imapPort: 'Port',
  imapSsl: 'SSL/TLS',
  userEmail: 'Adresse email',
  password: 'Mot de passe',
  folder: 'Dossier relevé',
};

/** Le strict nécessaire d'un défaut de validation (forme commune des validateurs). */
export type FieldIssue = {
  path: ReadonlyArray<PropertyKey>;
  code: string;
  maximum?: number | bigint;
  format?: string;
  validation?: string;
  input?: unknown;
};

function fieldName(issue: FieldIssue): string {
  const key = String(issue.path[0] ?? '');
  return MAILBOX_FIELD_LABELS[key] ?? key;
}

/** Une phrase par défaut — jamais le code du validateur. */
function describeIssue(issue: FieldIssue): string {
  const name = `« ${fieldName(issue)} »`;
  const empty =
    issue.input === undefined || issue.input === null || issue.input === '';
  if (issue.code === 'too_big') {
    return `${name} est trop long${issue.maximum !== undefined ? ` (${String(issue.maximum)} caractères maximum)` : ''}`;
  }
  if (issue.format === 'email' || issue.validation === 'email') {
    return `${name} n’est pas une adresse valide`;
  }
  if (issue.code === 'too_small' || issue.code === 'invalid_type' || empty) {
    return `${name} est à renseigner`;
  }
  return `${name} n’est pas valide`;
}

/**
 * La phrase rendue à l'écran pour une saisie refusée. Un même champ n'est
 * nommé qu'une fois, dans l'ordre du formulaire.
 */
export function describeMailboxIssues(
  issues: ReadonlyArray<FieldIssue>,
  /** Le geste refusé : enregistrer la boîte, ou tester la connexion. */
  action: 'save' | 'test' = 'save',
): string {
  const order = Object.keys(MAILBOX_FIELD_LABELS);
  const seen = new Set<string>();
  const sorted = [...issues].sort(
    (a, b) => order.indexOf(String(a.path[0])) - order.indexOf(String(b.path[0])),
  );
  const parts: string[] = [];
  for (const issue of sorted) {
    const key = String(issue.path[0] ?? '');
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(describeIssue(issue));
  }
  if (parts.length === 0) return 'Le formulaire est incomplet.';
  const lead = action === 'test' ? 'Impossible de tester la connexion' : 'Impossible d’enregistrer la boîte';
  return `${lead} : ${parts.join(' ; ')}.`;
}

/**
 * Les champs OBLIGATOIRES encore vides, nommés — vérifiés AVANT l'envoi. En
 * modification, le mot de passe peut rester vide (il n'est pas réaffiché, et
 * vide veut dire « inchangé »).
 */
export function missingMailboxFields(
  form: { label: string; imapHost: string; imapPort: string; userEmail: string; password: string },
  editing: boolean,
): string[] {
  const missing: string[] = [];
  if (!form.label.trim()) missing.push(MAILBOX_FIELD_LABELS.label!);
  if (!form.imapHost.trim()) missing.push(MAILBOX_FIELD_LABELS.imapHost!);
  if (!form.imapPort.trim()) missing.push(MAILBOX_FIELD_LABELS.imapPort!);
  if (!form.userEmail.trim()) missing.push(MAILBOX_FIELD_LABELS.userEmail!);
  if (!editing && !form.password) missing.push(MAILBOX_FIELD_LABELS.password!);
  return missing;
}

export function describeMissingFields(missing: string[]): string {
  return missing.length === 1
    ? `Renseignez le champ « ${missing[0]} » pour continuer.`
    : `Renseignez les champs ${missing.map((m) => `« ${m} »`).join(', ')} pour continuer.`;
}

/** Panne d'enregistrement : la cause part aux journaux du serveur, pas à l'écran. */
export const MAILBOX_SAVE_FAILED =
  'La boîte n’a pas pu être enregistrée. Réessayez dans un instant ; la cause est consignée côté serveur.';

/** Chiffrement des mots de passe non configuré : un réglage du serveur. */
export const MAILBOX_CRYPTO_UNAVAILABLE =
  'Les mots de passe des boîtes ne peuvent pas être protégés sur ce serveur. ' +
  'À transmettre à l’administrateur de la plateforme : poser MAILBOX_ENCRYPTION_KEY ' +
  '(openssl rand -hex 32), puis redéployer.';
