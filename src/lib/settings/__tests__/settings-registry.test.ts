import { describe, expect, it } from 'vitest';

import { DEFAULT_INTERVIEW_CONFIG } from '@/types/interview-settings';
import { DEFAULT_VIVIER_CONFIG } from '@/types/vivier-settings';
import {
  MESSAGE_TEMPLATES,
  currentTemplateText,
  defaultTemplateText,
  templateSummary,
} from '@/lib/settings/message-templates';
import {
  TEMPLATES_FAMILY_LABEL,
  findSection,
  normalizeSearch,
  searchSettings,
  settingsFamilies,
} from '@/lib/settings/sections-registry';
import { listMissingSettings, type SectionState } from '@/lib/settings/section-summary';
import { pickInterviewAgendaFields } from '@/components/settings/InterviewConfigManager';
import { pickCabinetSignatureFields } from '@/components/settings/CabinetSignatureManager';
import { pickVivierOwnFields } from '@/components/settings/VivierConfigManager';

const sources = { interviewConfig: DEFAULT_INTERVIEW_CONFIG, vivierConfig: DEFAULT_VIVIER_CONFIG };

describe('catalogue des modèles de messages', () => {
  it('couvre TOUS les textes éditables, ni plus ni moins', () => {
    // Anti-divergence : un modèle ajouté au réglage sans entrée au catalogue
    // n'aurait ni titre, ni place dans la famille, ni recherche.
    const interviewKeys = Object.keys(DEFAULT_INTERVIEW_CONFIG)
      .filter((k) => k.endsWith('Template'))
      .sort();
    const catalogInterview = MESSAGE_TEMPLATES.filter((t) => t.ref.scope === 'interview')
      .map((t) => t.ref.key)
      .sort();
    expect(catalogInterview).toEqual(interviewKeys);
    const vivierKeys = Object.keys(DEFAULT_VIVIER_CONFIG).filter((k) => k.endsWith('Template'));
    expect(MESSAGE_TEMPLATES.filter((t) => t.ref.scope === 'vivier').map((t) => t.ref.key)).toEqual(
      vivierKeys,
    );
  });

  it('des titres et des identifiants uniques', () => {
    expect(new Set(MESSAGE_TEMPLATES.map((t) => t.title)).size).toBe(MESSAGE_TEMPLATES.length);
    expect(new Set(MESSAGE_TEMPLATES.map((t) => t.id)).size).toBe(MESSAGE_TEMPLATES.length);
  });

  it('dit si le texte a été personnalisé', () => {
    const t = MESSAGE_TEMPLATES.find((x) => x.ref.key === 'rejectionTemplate')!;
    expect(templateSummary(t, sources)).toMatch(/^Texte proposé · /);
    const custom = {
      ...sources,
      interviewConfig: { ...DEFAULT_INTERVIEW_CONFIG, rejectionTemplate: 'Autre texte' },
    };
    expect(templateSummary(t, custom)).toMatch(/^Texte personnalisé · /);
    expect(currentTemplateText(t.ref, custom)).toBe('Autre texte');
  });

  it('un modèle absent d’une ancienne configuration vaut le texte proposé', () => {
    const t = MESSAGE_TEMPLATES.find((x) => x.ref.key === 'rescheduleTemplate')!;
    const legacy = {
      ...sources,
      interviewConfig: { ...DEFAULT_INTERVIEW_CONFIG, rescheduleTemplate: undefined as unknown as string },
    };
    expect(currentTemplateText(t.ref, legacy)).toBe(defaultTemplateText(t.ref));
  });
});

describe('registre des sections', () => {
  it('une famille « Modèles de messages » avec une entrée par modèle', () => {
    const fam = settingsFamilies(false).find((f) => f.label === TEMPLATES_FAMILY_LABEL)!;
    expect(fam.sections.map((s) => s.title)).toEqual(MESSAGE_TEMPLATES.map((t) => t.title));
  });

  it('familles dans l’ordre, « Cabinet et DPO » en tête, plus de validation humaine', () => {
    const families = settingsFamilies(true);
    expect(families.map((f) => f.label)).toEqual([
      'Cabinet et DPO',
      'Modèles de messages',
      'Équipe et disponibilité',
      'Réception & envoi des mails',
      'Intégrations',
    ]);
    expect(families[0]!.sections.map((s) => s.id)).toEqual([
      'identite',
      'sourcing',
      'vivier',
      'comptes-rendus',
      'entretiens',
    ]);
    expect(families.flatMap((f) => f.sections.map((s) => s.id))).not.toContain('hitl');
  });

  it('le nom de l’organisation se trouve dans « Identité du cabinet »', () => {
    expect(searchSettings(settingsFamilies(false), 'signataire')).toEqual(['identite']);
  });

  it('les sections réservées n’apparaissent qu’aux administrateurs', () => {
    const ids = (admin: boolean) =>
      settingsFamilies(admin).flatMap((f) => f.sections.map((s) => s.id));
    expect(ids(false)).not.toContain('sourcing');
    expect(ids(false)).not.toContain('recruteurs');
    expect(ids(true)).toEqual(expect.arrayContaining(['sourcing', 'recruteurs', 'comptes-rendus']));
  });

  it('identifiants de section uniques', () => {
    const ids = settingsFamilies(true).flatMap((f) => f.sections.map((s) => s.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('recherche', () => {
  const families = settingsFamilies(true);

  it('requête vide ⇒ aucun filtre (null), jamais « aucun résultat »', () => {
    expect(searchSettings(families, '')).toBeNull();
    expect(searchSettings(families, '   ')).toBeNull();
  });

  it('ignore casse et accents', () => {
    expect(normalizeSearch('Créneau')).toBe('creneau');
    expect(searchSettings(families, 'CRENEAU')).toContain('modele-nouveau-creneau');
  });

  it('trouve une section par un mot de son CONTENU (mot-clé)', () => {
    expect(searchSettings(families, 'cooldown')).toEqual(['vivier']);
    expect(searchSettings(families, 'resend')).toContain('resend');
    expect(searchSettings(families, 'naf')).toEqual(['canaux']);
  });

  it('chaque mot doit se retrouver, dans n’importe quel ordre', () => {
    expect(searchSettings(families, 'cv refus')).toContain('modele-refus-cv');
    expect(searchSettings(families, 'absent entretien')).toContain('modele-absent');
    expect(searchSettings(families, 'zzz-introuvable')).toEqual([]);
  });

  it('distingue les deux invitations du vivier', () => {
    expect(searchSettings(families, 'candidater')).toEqual(['modele-invitation-candidater']);
    expect(searchSettings(families, 'opportunité')).toEqual(['modele-opportunite-vivier']);
  });
});

describe('réglages manquants', () => {
  const families = settingsFamilies(false);

  it('nomme le manque et le SITUE (famille › section), dans l’ordre de la page', () => {
    const states: Record<string, SectionState> = {
      resend: { summary: 'x', status: 'warn', missing: 'Clé absente' },
      synthese: { summary: 'Aucune adresse', status: 'warn' },
      expediteur: { summary: 'ok', status: 'ok' },
    };
    expect(listMissingSettings(states, families)).toEqual([
      {
        sectionId: 'synthese',
        sectionTitle: 'Adresses de synthèse',
        familyLabel: 'Réception & envoi des mails',
        message: 'Aucune adresse',
      },
      {
        sectionId: 'resend',
        sectionTitle: 'Service email (Resend)',
        familyLabel: 'Réception & envoi des mails',
        message: 'Clé absente',
      },
    ]);
  });

  it('ignore une section en alerte que ce profil ne voit pas', () => {
    const states: Record<string, SectionState> = {
      sourcing: { summary: 'x', status: 'warn' },
    };
    expect(listMissingSettings(states, families)).toEqual([]);
    expect(findSection(families, 'sourcing')).toBeNull();
  });
});

describe('chaque section n’écrit que ses champs', () => {
  it('Agenda des entretiens ne rend que le lien, Identité que le nom et le signataire', () => {
    expect(Object.keys(pickInterviewAgendaFields(DEFAULT_INTERVIEW_CONFIG))).toEqual(['agendaLink']);
    expect(Object.keys(pickCabinetSignatureFields(DEFAULT_INTERVIEW_CONFIG)).sort()).toEqual([
      'organisationName',
      'recruiterName',
    ]);
  });

  it('Vivier ne rend pas le texte d’invitation', () => {
    expect(pickVivierOwnFields(DEFAULT_VIVIER_CONFIG)).not.toHaveProperty('invitationTemplate');
  });

  it('enregistrer l’agenda après un modèle ne remet pas l’ancien texte', () => {
    // Le geste du hub : fusion des champs de la section dans la config COURANTE.
    const afterTemplateSave = { ...DEFAULT_INTERVIEW_CONFIG, rejectionTemplate: 'Nouveau refus' };
    const staleMountedConfig = DEFAULT_INTERVIEW_CONFIG;
    const fields = { ...pickInterviewAgendaFields(staleMountedConfig), agendaLink: 'https://x' };
    const merged = { ...afterTemplateSave, ...fields };
    expect(merged.rejectionTemplate).toBe('Nouveau refus');
    expect(merged.agendaLink).toBe('https://x');
  });
});
