import { describe, expect, it } from 'vitest';

import { isIdentityKey } from '@/lib/gdpr/identity-keys';

import {
  countBelowBaseline,
  describeMailboxActivity,
  foreignCampaignRefs,
  ignoredMailEntry,
  mailboxActivity,
  unmatchedReason,
} from '../mail-ignored';

const NOW = new Date('2026-10-02T10:00:00Z');

describe('trace d’un mail ignoré', () => {
  it('trois clés, aucune qui porte une identité', () => {
    const e = ignoredMailEntry('mb1', 42, 'no_attachment');
    expect(e.payload).toEqual({ mailboxId: 'mb1', uid: '42', reason: 'no_attachment' });
    for (const key of Object.keys(e.payload!)) expect(isIdentityKey(key)).toBe(false);
  });
});

describe('référence citée mais non associée', () => {
  it('sujet ou corps, sans doublon, casse ignorée, les associées écartées', () => {
    expect(
      foreignCampaignRefs(['Fw: camp-2026-777', 'voir CAMP-2026-777 et CAMP-2026-199'], ['CAMP-2026-199']),
    ).toEqual(['CAMP-2026-777']);
    expect(foreignCampaignRefs(['CAMPING-2026', null], [])).toEqual([]);
  });

  it('le motif distingue les deux cas', () => {
    expect(unmatchedReason(['CAMP-2026-777'])).toBe('campaign_not_associated');
    expect(unmatchedReason([])).toBe('no_campaign_match');
  });
});

describe('ce que la ligne de départ laisse derrière elle', () => {
  it('tout le dossier moins ce qui est au-dessus', () => {
    expect(countBelowBaseline({ exists: 30, baseline: 28, uidsSinceConnection: [29, 30] })).toBe(28);
    expect(countBelowBaseline({ exists: 12, baseline: 12, uidsSinceConnection: [] })).toBe(12);
  });
  it('compte inconnu : on n’invente pas', () => {
    expect(countBelowBaseline({ exists: null, baseline: 5, uidsSinceConnection: [] })).toBeNull();
  });
});

describe('fiche de la boîte', () => {
  const rows = [
    { action: 'imap_cv_analyzed', created_at: '2026-10-02T08:00:00Z', payload: { mailboxId: 'mb1' } },
    { action: 'imap_mail_ignored', created_at: '2026-10-02T09:00:00Z', payload: { mailboxId: 'mb1', reason: 'no_attachment' } },
    { action: 'imap_mail_ignored', created_at: '2026-10-02T07:00:00Z', payload: { mailboxId: 'mb1', reason: 'campaign_inactive' } },
    { action: 'imap_mail_ignored', created_at: '2026-10-02T09:30:00Z', payload: { mailboxId: 'mb2', reason: 'unparseable' } },
  ];

  it('compte par boîte ; le dernier motif est le plus RÉCENT, pas le dernier lu', () => {
    expect(mailboxActivity('mb1', rows)).toEqual({
      seen: 3,
      created: 1,
      ignored: 2,
      lastIgnoredReason: 'no_attachment',
      lastIgnoredAt: '2026-10-02T09:00:00Z',
    });
  });

  it('la ligne lisible, zéro compris', () => {
    expect(describeMailboxActivity(mailboxActivity('mb1', rows), '2026-10-02T09:57:00Z', 7, NOW)).toBe(
      'dernière relève : il y a 3 min · 3 mails vus en 7 j · 1 candidature créée · 2 ignorés (dernier : sans CV en pièce jointe)',
    );
    expect(describeMailboxActivity(mailboxActivity('mb9', rows), null, 7, NOW)).toBe(
      'dernière relève : jamais · 0 mail vu en 7 j · 0 candidature créée · 0 ignoré',
    );
  });
});
