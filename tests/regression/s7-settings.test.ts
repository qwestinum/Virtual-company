/**
 * S7 — Settings : un paramètre modifié est persisté, relu ET appliqué.
 * `app_settings` est GLOBAL (single-row) : snapshot + restauration en afterAll.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { POST as composeMail } from '@/app/api/mail-composer/route';
import { GET as getSettings, PUT as putSettings } from '@/app/api/settings/route';

import { call } from './helpers/api';
import { cleanAll } from './helpers/db';

type SettingsJson = {
  settings: {
    vivierConfig: Record<string, unknown> & { invitationTemplate: string };
    interviewConfig: Record<string, unknown> & { agendaLink: string };
  };
};

let saved: SettingsJson['settings'] | null = null;

beforeAll(async () => {
  await cleanAll();
  const res = await call(getSettings);
  expect(res.status).toBe(200);
  saved = (res.json as unknown as SettingsJson).settings;
});

afterAll(async () => {
  if (saved) {
    await call(putSettings, {
      method: 'PUT',
      body: {
        vivierConfig: saved.vivierConfig,
        interviewConfig: saved.interviewConfig,
      },
    });
  }
  await cleanAll();
});

describe('S7 — settings', () => {
  it('modifier le template d’invitation vivier → persisté et relu', async () => {
    const customTemplate =
      'Bonjour [prénom], le poste [intitulé du poste] ([référence]) est ouvert — MARQUEUR-TREG-S7. [Organisation]';
    const put = await call(putSettings, {
      method: 'PUT',
      body: {
        vivierConfig: { ...saved!.vivierConfig, invitationTemplate: customTemplate },
      },
    });
    expect(put.status).toBe(200);

    const reread = await call(getSettings);
    const config = (reread.json as unknown as SettingsJson).settings.vivierConfig;
    expect(config.invitationTemplate).toBe(customTemplate);
  });

  it('modifier le lien d’agenda → persisté, relu, APPLIQUÉ au mail d’invitation', async () => {
    const put = await call(putSettings, {
      method: 'PUT',
      body: {
        interviewConfig: {
          ...saved!.interviewConfig,
          agendaLink: 'https://agenda.test.local/s7-treg',
        },
      },
    });
    expect(put.status).toBe(200);

    const reread = await call(getSettings);
    expect(
      (reread.json as unknown as SettingsJson).settings.interviewConfig.agendaLink,
    ).toBe('https://agenda.test.local/s7-treg');

    // APPLIQUÉ : le brouillon d'invitation (preview, aucun envoi) résout
    // [lien d'agenda] avec la valeur fraîchement configurée.
    const preview = await call(composeMail, {
      method: 'POST',
      body: {
        artifactId: 'preview',
        campaignId: 'CAMP-TREG-s7-preview',
        jobTitle: 'Testeur Logiciel TREG',
        mode: 'invite',
        candidate: {
          candidateName: 'Marc Moyen',
          email: 'moyen@test.local',
          phone: null,
          score: 60,
          aboveThreshold: true,
          summary: 'Synthese de test.',
          strengths: ['Point fort.'],
          weaknesses: [],
          justification: 'Justification de test.',
        },
        preview: true,
      },
    });
    expect(preview.status).toBe(200);
    expect(preview.json.status).toBe('preview');
    expect(String(preview.json.html)).toContain('https://agenda.test.local/s7-treg');
  });
});
