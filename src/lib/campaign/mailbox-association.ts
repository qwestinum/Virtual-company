'use client';

/**
 * Association / dissociation boîte mail ↔ campagne, avec issue REMONTÉE
 * (anti-perte silencieuse).
 *
 * L'endpoint `/api/mailboxes/[id]/associate` renvoie 204 (ok), 503 (Supabase
 * non configuré — démo), 400/500 (échec). `fetch` ne rejette PAS sur 4xx/5xx :
 * sans vérifier `res.ok`, une association ratée passait pour un succès et le
 * flux email restait muet (aucun CV reçu) sans que personne le sache.
 *
 * Ces helpers ne lèvent jamais : ils rendent `{ ok, demo?, error? }` pour que
 * l'appelant (création de campagne, bloc Flux) décide quoi afficher.
 */

export type MailboxOpResult = { ok: boolean; demo?: boolean; error?: string };

async function readError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { message?: string; error?: string };
    return data.message ?? data.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export async function associateMailbox(
  mailboxId: string,
  campaignId: string,
): Promise<MailboxOpResult> {
  let res: Response;
  try {
    res = await fetch(
      `/api/mailboxes/${encodeURIComponent(mailboxId)}/associate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId }),
      },
    );
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Erreur réseau.' };
  }
  if (res.status === 503) return { ok: true, demo: true };
  if (!res.ok) return { ok: false, error: await readError(res) };
  return { ok: true };
}

export async function dissociateMailbox(
  mailboxId: string,
  campaignId: string,
): Promise<MailboxOpResult> {
  let res: Response;
  try {
    res = await fetch(
      `/api/mailboxes/${encodeURIComponent(mailboxId)}/associate?campaign_id=${encodeURIComponent(campaignId)}`,
      { method: 'DELETE' },
    );
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Erreur réseau.' };
  }
  if (res.status === 503) return { ok: true, demo: true };
  if (!res.ok) return { ok: false, error: await readError(res) };
  return { ok: true };
}
