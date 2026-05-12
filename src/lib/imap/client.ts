/**
 * Client IMAP — connexion et test (Session 5 round 5).
 *
 * Wrapper minimal autour d'imapflow pour deux opérations :
 *   - testConnection : authentifie puis logout. Sert au formulaire
 *     settings pour valider les credentials avant sauvegarde.
 *   - openConnection : retourne un client connecté à INBOX, utilisé
 *     par le poller. L'appelant DOIT appeler `client.logout()` quand
 *     il a fini (pattern try/finally).
 *
 * Pas de pooling, pas de keep-alive : à chaque poll on ouvre une
 * connexion fraîche puis on la ferme. Le coût est négligeable et on
 * évite les fuites de file descriptors si le poller meurt en route.
 */

import { ImapFlow } from 'imapflow';

export type ImapCredentials = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
};

export type TestConnectionResult =
  | { ok: true; mailboxName: string; messageCount: number }
  | { ok: false; error: string };

/**
 * Tente une connexion + ouverture d'INBOX puis logout. Utilisé par
 * le formulaire settings pour valider les credentials avant
 * sauvegarde. Le timeout protège contre un serveur lent.
 */
export async function testConnection(
  creds: ImapCredentials,
): Promise<TestConnectionResult> {
  const client = new ImapFlow({
    host: creds.host,
    port: creds.port,
    secure: creds.secure,
    auth: { user: creds.user, pass: creds.password },
    logger: false,
    socketTimeout: 15_000,
  });
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const status = await client.status('INBOX', { messages: true });
      return {
        ok: true,
        mailboxName: 'INBOX',
        messageCount: status.messages ?? 0,
      };
    } finally {
      lock.release();
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    try {
      await client.logout();
    } catch {
      // logout peut échouer si la connexion a déjà été coupée — on
      // ignore, l'erreur principale (si elle existait) a déjà été
      // retournée.
    }
  }
}

/**
 * Ouvre une connexion prête pour le polling. L'appelant gère le
 * cycle de vie : try { use } finally { logout }.
 */
export async function openConnection(
  creds: ImapCredentials,
): Promise<ImapFlow> {
  const client = new ImapFlow({
    host: creds.host,
    port: creds.port,
    secure: creds.secure,
    auth: { user: creds.user, pass: creds.password },
    logger: false,
    socketTimeout: 30_000,
  });
  await client.connect();
  return client;
}
