/**
 * En-tête `Cc` du wrapper d'envoi.
 *
 * Le destinataire principal est celui à qui le message s'adresse ; la copie
 * sert à tenir informé. Un `cc` vide ne doit poser AUCUN en-tête : un `Cc:`
 * vide transmis au fournisseur est un motif de rejet du message entier.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: sendMock };
  },
}));
vi.mock('@/lib/email/addresses', () => ({
  getResendApiKey: async () => 're_test_key',
  getSenderEmail: async () => 'orqa@corp.fr',
}));

import { sendEmail } from '@/lib/email/client';

beforeEach(() => {
  vi.clearAllMocks();
  sendMock.mockResolvedValue({ data: { id: 'm-1' }, error: null });
});

describe('sendEmail — copie', () => {
  it('transmet les destinataires en copie tels quels', async () => {
    await sendEmail({
      to: ['jane@corp.fr'],
      cc: ['drh@corp.fr', 'dir@corp.fr'],
      subject: 'Briefing',
      html: '<p>x</p>',
    });
    const payload = sendMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.to).toEqual(['jane@corp.fr']);
    expect(payload.cc).toEqual(['drh@corp.fr', 'dir@corp.fr']);
  });

  it('aucun en-tête Cc quand la copie est vide ou absente', async () => {
    await sendEmail({ to: 'jane@corp.fr', cc: [], subject: 'x', html: '<p>x</p>' });
    expect(sendMock.mock.calls[0]![0]).not.toHaveProperty('cc');

    await sendEmail({ to: 'jane@corp.fr', subject: 'x', html: '<p>x</p>' });
    expect(sendMock.mock.calls[1]![0]).not.toHaveProperty('cc');
  });
});
