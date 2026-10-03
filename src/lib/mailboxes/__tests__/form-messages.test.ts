/**
 * Formulaire « Boîtes de réception » : une saisie refusée se dit en français,
 * en nommant le champ comme l'écran (03/10/2026 — l'écran affichait le message
 * brut du validateur, un tableau JSON en anglais).
 */
import { describe, expect, it } from 'vitest';

import {
  describeMailboxIssues,
  describeMissingFields,
  missingMailboxFields,
} from '../form-messages';
import { POST as createMailbox } from '@/app/api/mailboxes/route';
import { POST as testCredentials } from '@/app/api/mailboxes/test-credentials/route';

const VALID = {
  label: 'Recrutement',
  imapHost: 'imap.exemple.fr',
  imapPort: 993,
  imapSsl: true,
  userEmail: 'recrutement@exemple.fr',
  password: 'secret',
};

const post = (body: unknown) =>
  new Request('http://x/api/mailboxes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('la route refuse une boîte sans intitulé — avec une phrase', () => {
  it('nomme « Intitulé », sans rien de technique', async () => {
    const res = await createMailbox(post({ ...VALID, label: '' }));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { message: string };
    expect(json.message).toBe('Impossible d’enregistrer la boîte : « Intitulé » est à renseigner.');
    expect(json.message).not.toMatch(/too_small|path|expected|\[/);
  });

  it('plusieurs défauts : chacun nommé, dans l’ordre du formulaire', async () => {
    const res = await createMailbox(post({ ...VALID, label: '', userEmail: 'pas-une-adresse' }));
    const json = (await res.json()) as { message: string };
    expect(json.message).toBe(
      'Impossible d’enregistrer la boîte : « Intitulé » est à renseigner ; « Adresse email » n’est pas une adresse valide.',
    );
  });

  it('un champ absent du corps est « à renseigner », pas « invalid_type »', async () => {
    const { password: _omis, ...sansMotDePasse } = VALID;
    const res = await createMailbox(post(sansMotDePasse));
    const json = (await res.json()) as { message: string };
    expect(json.message).toContain('« Mot de passe » est à renseigner');
  });

  it('« Tester » rend la même phrase, dans la forme que l’écran affiche', async () => {
    const res = await testCredentials(post({ ...VALID, imapHost: '' }));
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json.ok).toBe(false);
    expect(json.error).toBe('Impossible de tester la connexion : « Serveur IMAP » est à renseigner.');
  });
});

describe('vérification avant l’envoi', () => {
  const vide = { label: '', imapHost: '', imapPort: '', userEmail: '', password: '' };

  it('nomme chaque champ obligatoire vide', () => {
    expect(missingMailboxFields(vide, false)).toEqual([
      'Intitulé',
      'Serveur IMAP',
      'Port',
      'Adresse email',
      'Mot de passe',
    ]);
  });

  it('en modification, le mot de passe vide veut dire « inchangé »', () => {
    expect(missingMailboxFields({ ...vide, label: 'x', imapHost: 'h', imapPort: '993', userEmail: 'a@b.fr' }, true)).toEqual([]);
  });

  it('une phrase au singulier comme au pluriel', () => {
    expect(describeMissingFields(['Intitulé'])).toBe('Renseignez le champ « Intitulé » pour continuer.');
    expect(describeMissingFields(['Intitulé', 'Port'])).toBe(
      'Renseignez les champs « Intitulé », « Port » pour continuer.',
    );
  });

  it('trop long : la borne est dite', () => {
    expect(describeMailboxIssues([{ path: ['label'], code: 'too_big', maximum: 120 }])).toBe(
      'Impossible d’enregistrer la boîte : « Intitulé » est trop long (120 caractères maximum).',
    );
  });
});
