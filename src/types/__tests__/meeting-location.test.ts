/**
 * Le schéma de frontière et la relecture du module doivent dire la MÊME chose.
 *
 * Ils ne le disaient pas : zod acceptait `{ type:'phone', payload:{ instructions:'' } }`
 * et `parseMeetingLocation` le rendait `null`. Le lieu s'écrivait en base, se
 * relisait comme « aucun lieu », et la résolution retombait en silence sur le
 * lieu du référent — un candidat pouvait recevoir un lien de visioconférence
 * pour un entretien qu'on croyait téléphonique, ou un rendez-vous confirmé
 * sans aucune indication de lieu.
 */
import { describe, expect, it } from 'vitest';

import { parseMeetingLocation } from '@/lib/scheduling';
import { MeetingLocationSchema } from '@/types/meeting-location';

const EMPTY_DETAILS = [
  { type: 'video', payload: { url: '' } },
  { type: 'video', payload: { url: '   ' } },
  { type: 'in_person', payload: { address: '' } },
  { type: 'phone', payload: { instructions: '' } },
  { type: 'phone', payload: { instructions: '\t' } },
];

describe('MeetingLocationSchema', () => {
  it('refuse un type sans son détail', () => {
    for (const value of EMPTY_DETAILS) {
      expect(MeetingLocationSchema.safeParse(value).success).toBe(false);
    }
  });

  it('accepte les trois formes renseignées, détail rogné', () => {
    expect(
      MeetingLocationSchema.parse({ type: 'video', payload: { url: ' https://a ' } }),
    ).toEqual({ type: 'video', payload: { url: 'https://a' } });
    expect(
      MeetingLocationSchema.parse({ type: 'in_person', payload: { address: '1 rue A' } }),
    ).toEqual({ type: 'in_person', payload: { address: '1 rue A' } });
    expect(
      MeetingLocationSchema.parse({ type: 'phone', payload: { instructions: 'On appelle.' } }),
    ).toEqual({ type: 'phone', payload: { instructions: 'On appelle.' } });
  });

  it('tout ce que le schéma accepte survit à la relecture', () => {
    // L'invariant : plus rien ne peut s'enregistrer pour disparaître ensuite.
    const accepted = [
      { type: 'video', payload: { url: 'https://visio/1' } },
      { type: 'in_person', payload: { address: '1 rue A' } },
      { type: 'phone', payload: { instructions: 'On vous appelle au 06…' } },
    ];
    for (const value of accepted) {
      const parsedByZod = MeetingLocationSchema.parse(value);
      expect(parseMeetingLocation(parsedByZod)).toEqual(parsedByZod);
    }
  });
});
