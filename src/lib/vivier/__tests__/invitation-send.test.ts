import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildEmptyFDP } from '@/types/field-collection';

const candidatesRepo = { getVivierCandidate: vi.fn() };
const campaignsRepo = { getCampaign: vi.fn() };
const preselRepo = { markContacted: vi.fn() };
const settingsRepo = { getAppSettings: vi.fn() };
const addresses = { getSenderEmail: vi.fn() };
const emailClient = { sendEmail: vi.fn() };
const journal = { appendJournalEntry: vi.fn() };

vi.mock('@/lib/db/repos/vivier', () => candidatesRepo);
vi.mock('@/lib/db/repos/campaigns', () => campaignsRepo);
vi.mock('@/lib/db/repos/vivier-preselection', () => preselRepo);
vi.mock('@/lib/db/repos/app-settings', () => settingsRepo);
vi.mock('@/lib/email/addresses', () => addresses);
vi.mock('@/lib/email/client', () => emailClient);
vi.mock('@/lib/db/repos/journal', () => journal);

function fdp() {
  const f = buildEmptyFDP('CAMP-1');
  f.fields.job_title = { ...f.fields.job_title, value: 'Dev backend' };
  return f;
}

beforeEach(() => {
  [candidatesRepo, campaignsRepo, preselRepo, settingsRepo, addresses, emailClient, journal].forEach(
    (m) => Object.values(m).forEach((f) => f.mockReset()),
  );
  candidatesRepo.getVivierCandidate.mockResolvedValue({
    id: 'cand-1',
    email: 'jane@doe.com',
    nom: 'Jane Doe',
    prenom: null,
  });
  campaignsRepo.getCampaign.mockResolvedValue({ id: 'CAMP-1', name: 'Backend', fdp: fdp() });
  settingsRepo.getAppSettings.mockResolvedValue({
    intakeEmail: 'jobs@acme.com',
    vivierConfig: {
      contactMode: 'manual',
      invitationTemplate: 'Bonjour [prénom], poste [intitulé du poste] à [adresse de réception]. [Organisation]',
      cooldownDays: 90,
      shortlistCap: 50,
      organisationName: 'ACME',
    },
  });
  addresses.getSenderEmail.mockResolvedValue('from@acme.com');
  preselRepo.markContacted.mockResolvedValue(['cand-1']);
});
afterEach(() => vi.restoreAllMocks());

describe('sendVivierInvitation', () => {
  it('envoi réussi ⇒ email envoyé, proposition marquée contacted, journal', async () => {
    emailClient.sendEmail.mockResolvedValueOnce({ ok: true, messageId: 'm1' });
    const { sendVivierInvitation } = await import('@/lib/vivier/invitation-send');

    const res = await sendVivierInvitation('CAMP-1', 'cand-1', 'user');

    expect(res).toEqual({ contacted: true, status: 'sent' });
    const mail = emailClient.sendEmail.mock.calls[0][0];
    expect(mail.to).toBe('jane@doe.com');
    // La référence campagne est dans l'objet (réponse ⇒ Re: conserve le rattachement).
    expect(mail.subject).toContain('CAMP-1');
    expect(mail.replyTo).toBe('jobs@acme.com'); // réponse routée vers la réception
    expect(mail.html).toContain('Jane'); // [prénom] résolu depuis le nom
    expect(mail.html).toContain('vivier de candidatures'); // mention RGPD
    expect(preselRepo.markContacted).toHaveBeenCalledWith('CAMP-1', ['cand-1'], 'user');
    expect(journal.appendJournalEntry.mock.calls[0][0].action).toBe('vivier_invitation_sent');
  });

  it('email non configuré (démo) ⇒ marqué contacted quand même (best-effort)', async () => {
    emailClient.sendEmail.mockResolvedValueOnce({
      ok: false,
      messageId: null,
      error: 'email_not_configured',
    });
    const { sendVivierInvitation } = await import('@/lib/vivier/invitation-send');

    const res = await sendVivierInvitation('CAMP-1', 'cand-1', 'user');
    expect(res.status).toBe('skipped_no_config');
    expect(res.contacted).toBe(true);
    expect(preselRepo.markContacted).toHaveBeenCalled();
  });

  it('échec dur d’envoi ⇒ PAS marqué contacted (re-tentable)', async () => {
    emailClient.sendEmail.mockResolvedValueOnce({
      ok: false,
      messageId: null,
      error: 'rate_limited',
    });
    const { sendVivierInvitation } = await import('@/lib/vivier/invitation-send');

    const res = await sendVivierInvitation('CAMP-1', 'cand-1', 'user');
    expect(res.status).toBe('send_failed');
    expect(res.contacted).toBe(false);
    expect(preselRepo.markContacted).not.toHaveBeenCalled();
  });
});

describe('autoContactIfEnabled', () => {
  const entries = [
    { candidateId: 'cand-1', state: 'identified' },
    { candidateId: 'cand-2', state: 'identified' },
  ] as never;

  it('mode manuel ⇒ aucun envoi', async () => {
    const { autoContactIfEnabled } = await import('@/lib/vivier/invitation-send');
    await autoContactIfEnabled('CAMP-1', entries);
    expect(emailClient.sendEmail).not.toHaveBeenCalled();
  });

  it('mode auto ⇒ envoi à toute la short-list identified', async () => {
    settingsRepo.getAppSettings.mockResolvedValue({
      intakeEmail: 'jobs@acme.com',
      vivierConfig: {
        contactMode: 'auto',
        invitationTemplate: 'Bonjour [prénom]',
        cooldownDays: 90,
        shortlistCap: 50,
        organisationName: 'ACME',
      },
    });
    emailClient.sendEmail.mockResolvedValue({ ok: true, messageId: 'm' });
    const { autoContactIfEnabled } = await import('@/lib/vivier/invitation-send');

    await autoContactIfEnabled('CAMP-1', entries);
    expect(emailClient.sendEmail).toHaveBeenCalledTimes(2);
  });
});
