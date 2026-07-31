/**
 * S11 — « Un mail = une candidature » (incident Malaka 30/07/2026).
 *
 * L'id d'analyse `can_imap_<mailbox>_<uid>` est unique par MAIL (insert-only) :
 * avant le fix, chaque PJ était analysée comme une candidature et la PREMIÈRE
 * gagnait la ligne — sur les mails APEC (lettre `candidature.pdf` + vrai CV),
 * la lettre classée `isCv:false` persistait « Candidat anonyme » score 0 et
 * l'analyse du vrai CV partait en `already_exists`.
 *
 * Parcours réels (cœur partagé `processEmailAttachment`, celui du poller ET
 * du rejeu — seuls LLM/email sont mockés, DB + storage réels) :
 *   1. PJ lettre + skipIfNotCv → not_a_cv : RIEN persisté, trace journal ;
 *   2. le vrai CV du même mail porte LA candidature (une seule ligne) ;
 *   3. une re-passe de la lettre n'écrase JAMAIS la ligne (insert-only) ;
 *   4. dernier recours (mail sans aucun vrai CV) → voie « Candidat anonyme »
 *      conservée, AUCUN mail (skipped_no_email) ;
 *   5. drain `pending_sheet` GROUPÉ par (mailbox, uid) : le vrai CV gagne,
 *      la lettre sœur est consommée TRACÉE — le bug ne se rejoue pas au drain.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GET as getCampaigns, PUT as putCampaign } from '@/app/api/campaigns/route';
import { POST as createMailbox } from '@/app/api/mailboxes/route';
import { getMailboxWithSecrets, type MailboxRow } from '@/lib/db/repos/mailboxes';
import { processEmailAttachment } from '@/lib/imap/poller';
import { drainPendingSheetCvs } from '@/lib/imap/unmatched-replay';
import type { ActiveCampaign } from '@/stores/campaigns-store';

import { call, testCampaignPayload } from './helpers/api';
import { cleanAll, newTestCampaignId, readRows } from './helpers/db';
import { resetSentEmails, sentEmails } from './helpers/mocks';
import { LETTER_MARKER } from './fixtures/llm-fixtures';

const camp = newTestCampaignId('s11');
const campDrain = newTestCampaignId('s11d');

let mailbox: MailboxRow;

/** Lettre de motivation (non-CV pour l'extracteur mocké) — .txt extractible. */
function letterBuffer(): Buffer {
  return Buffer.from(
    `Madame, Monsieur,\n${LETTER_MARKER}\nJe vous propose ma candidature au poste. ` +
      `Veuillez trouver mon dossier en pièce jointe.\nBien cordialement.`,
    'utf8',
  );
}

/** Vrai CV (PDF fixture profil moyen — zone grise attendue). */
function cvBuffer(): Buffer {
  return readFileSync(resolve(process.cwd(), 'tests/regression/fixtures/cv-moyen.pdf'));
}

function processArgs(overrides: {
  campaign: ActiveCampaign;
  uid: string;
  file: 'letter' | 'cv';
  skipIfNotCv?: boolean;
}) {
  const isLetter = overrides.file === 'letter';
  return {
    mailbox,
    campaign: overrides.campaign,
    fileName: isLetter ? 'candidature.txt' : 'CV_Marc_Moyen.pdf',
    mime: isLetter ? 'text/plain' : 'application/pdf',
    buffer: isLetter ? letterBuffer() : cvBuffer(),
    uid: overrides.uid,
    subject: `[TREG] Candidature ${camp}`,
    from: '"Marc Moyen" <relay-treg@candidature.apec.fr>',
    matchSource: 'subject' as const,
    skipIfNotCv: overrides.skipIfNotCv ?? false,
  };
}

/** Recharge la campagne côté serveur (forme ActiveCampaign de la route). */
async function loadCampaign(id: string): Promise<ActiveCampaign> {
  const res = await call(getCampaigns);
  expect(res.status).toBe(200);
  const found = (res.json.campaigns as ActiveCampaign[]).find((c) => c.id === id);
  expect(found).toBeDefined();
  return found as ActiveCampaign;
}

beforeAll(async () => {
  await cleanAll();
  resetSentEmails();

  const created = await call(putCampaign, {
    method: 'PUT',
    body: testCampaignPayload({ id: camp, status: 'active' }),
  });
  expect(created.status).toBe(200);

  const mb = await call(createMailbox, {
    method: 'POST',
    body: {
      label: '[TREG] boite s11',
      imapHost: 'imap.test.local',
      imapPort: 993,
      imapSsl: true,
      userEmail: 'boite-s11@test.local',
      password: 'motdepasse-factice',
      isEnabled: false,
    },
  });
  expect(mb.status).toBe(200);
  const mailboxId = (mb.json.mailbox as { id: string }).id;
  const withSecrets = await getMailboxWithSecrets(mailboxId);
  expect(withSecrets).not.toBeNull();
  mailbox = withSecrets as MailboxRow;
});
afterAll(async () => {
  await cleanAll();
});

describe('S11 — un mail = une candidature', () => {
  const uid = `treg_s11_mail1_${Date.now().toString(36)}`;

  it('PJ lettre + skipIfNotCv → not_a_cv : rien persisté, trace explicite, aucun mail', async () => {
    const campaign = await loadCampaign(camp);
    const outcome = await processEmailAttachment(
      processArgs({ campaign, uid, file: 'letter', skipIfNotCv: true }),
    );
    expect(outcome).toBe('not_a_cv');

    const rows = await readRows('candidate_analyses', {
      id: `can_imap_${mailbox.id}_${uid}`,
    });
    expect(rows).toHaveLength(0);

    const traces = await readRows<{ payload: { uid?: string; fileName?: string } }>(
      'journal',
      { campaign_id: camp, action: 'imap_attachment_skipped_non_cv' },
    );
    expect(traces.some((t) => t.payload.uid === uid)).toBe(true);
    expect(sentEmails).toHaveLength(0);
  });

  it('le vrai CV du même mail porte LA candidature (gris → validation en file)', async () => {
    const campaign = await loadCampaign(camp);
    const outcome = await processEmailAttachment(
      processArgs({ campaign, uid, file: 'cv', skipIfNotCv: true }),
    );
    expect(outcome).toBe('processed');

    const rows = await readRows<{
      candidate_name: string;
      candidate_email: string | null;
      decision_zone: string;
      file_name: string;
    }>('candidate_analyses', { id: `can_imap_${mailbox.id}_${uid}` });
    expect(rows).toHaveLength(1);
    expect(rows[0].candidate_name).toBe('Marc Moyen');
    expect(rows[0].candidate_email).toBe('moyen@test.local');
    expect(rows[0].decision_zone).toBe('gray');
    expect(rows[0].file_name).toBe('CV_Marc_Moyen.pdf');

    // Gris → validation HITL en file, aucun mail auto.
    const vals = await readRows<{ status: string }>('pending_validations', {
      id: `val_imap_${mailbox.id}_${uid}_reject`,
    });
    expect(vals).toHaveLength(1);
    expect(vals[0].status).toBe('pending');
    expect(sentEmails).toHaveLength(0);
  });

  it('une re-passe de la lettre (sans skip) n’écrase JAMAIS la ligne du vrai CV', async () => {
    const campaign = await loadCampaign(camp);
    const outcome = await processEmailAttachment(
      processArgs({ campaign, uid, file: 'letter', skipIfNotCv: false }),
    );
    // Doublon d'insert = succès (idempotence), la ligne d'origine reste.
    expect(outcome).toBe('processed');
    const rows = await readRows<{ candidate_name: string; file_name: string }>(
      'candidate_analyses',
      { id: `can_imap_${mailbox.id}_${uid}` },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].candidate_name).toBe('Marc Moyen');
    expect(rows[0].file_name).toBe('CV_Marc_Moyen.pdf');
  });

  it('dernier recours (mail sans aucun vrai CV) → candidat anonyme, AUCUN mail', async () => {
    const uidAlone = `treg_s11_seule_${Date.now().toString(36)}`;
    const campaign = await loadCampaign(camp);
    const outcome = await processEmailAttachment(
      processArgs({ campaign, uid: uidAlone, file: 'letter', skipIfNotCv: false }),
    );
    expect(outcome).toBe('processed');

    const rows = await readRows<{
      candidate_name: string;
      candidate_email: string | null;
      decision_zone: string;
    }>('candidate_analyses', { id: `can_imap_${mailbox.id}_${uidAlone}` });
    expect(rows).toHaveLength(1);
    expect(rows[0].candidate_name).toBe('Candidat anonyme');
    expect(rows[0].candidate_email).toBeNull();
    expect(rows[0].decision_zone).toBe('auto_reject');
    // Refus auto SKIPPÉ faute d'email — jamais un mail vers un anonyme.
    expect(sentEmails).toHaveLength(0);
  });

  it('drain pending_sheet GROUPÉ : le vrai CV gagne, la lettre sœur est consommée tracée', async () => {
    const created = await call(putCampaign, {
      method: 'PUT',
      body: testCampaignPayload({ id: campDrain, status: 'active' }),
    });
    expect(created.status).toBe(200);

    const uidDrain = `treg_s11_drain_${Date.now().toString(36)}`;
    const campaign = await loadCampaign(campDrain);
    // État C4 (mail reçu AVANT validation de la fiche) : le branchement lit
    // `campaign.scoringSheet.isValidated` — on présente la campagne telle que
    // le poller la voyait à ce moment-là (fiche pas encore validée).
    const campaignSheetPending = {
      ...campaign,
      scoringSheet: campaign.scoringSheet
        ? { ...campaign.scoringSheet, isValidated: false }
        : null,
    } as ActiveCampaign;
    const o1 = await processEmailAttachment(
      processArgs({
        campaign: campaignSheetPending,
        uid: uidDrain,
        file: 'letter',
        skipIfNotCv: true,
      }),
    );
    const o2 = await processEmailAttachment(
      processArgs({
        campaign: campaignSheetPending,
        uid: uidDrain,
        file: 'cv',
        skipIfNotCv: true,
      }),
    );
    // Fiche non validée : TOUTES les PJ sont stockées (le drain choisira).
    expect(o1).toBe('pending_sheet');
    expect(o2).toBe('pending_sheet');
    const queued = await readRows<{ status: string; storage_path: string | null }>(
      'imap_unmatched_cvs',
      { campaign_id: campDrain, uid: uidDrain },
    );
    expect(queued).toHaveLength(2);
    expect(queued.every((r) => r.status === 'pending' && r.storage_path)).toBe(true);

    // Fiche validée (état réel de la campagne) → drain (cœur appelé par le
    // hook after() des routes campagnes).
    await drainPendingSheetCvs(campaign);

    // UNE candidature : le vrai CV (priorité de nom + isCv), jamais l'anonyme.
    const rows = await readRows<{ candidate_name: string; file_name: string }>(
      'candidate_analyses',
      { id: `can_imap_${mailbox.id}_${uidDrain}` },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].candidate_name).toBe('Marc Moyen');
    expect(rows[0].file_name).toBe('CV_Marc_Moyen.pdf');

    // Les deux lignes de file sont consommées (plus de backlog fantôme)…
    const after = await readRows<{ status: string; file_name: string }>(
      'imap_unmatched_cvs',
      { campaign_id: campDrain, uid: uidDrain },
    );
    expect(after.every((r) => r.status === 'replayed')).toBe(true);
    // … et la lettre sœur est TRACÉE, jamais un skip muet.
    const siblingTraces = await readRows<{ payload: { uid?: string } }>(
      'journal',
      { campaign_id: campDrain, action: 'imap_unmatched_sibling_skipped' },
    );
    expect(siblingTraces.some((t) => t.payload.uid === uidDrain)).toBe(true);
  });
});
