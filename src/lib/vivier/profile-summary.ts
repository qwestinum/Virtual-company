/**
 * Synthèse et historique d'un profil du vivier, vus depuis une campagne —
 * PUR (28/09/2026). Ce que le recruteur doit lire AVANT d'inviter ou
 * d'écarter : qui c'est (synthèse), et ce qui s'est déjà passé avec lui
 * (candidatures reçues, sollicitations depuis le vivier).
 */
import type { TitleAnchor } from '@/lib/vivier/title-anchors';
import type { VivierEntities } from '@/types/vivier';

export type VivierProfileApplication = {
  analysisId: string;
  campaignId: string | null;
  jobTitle: string;
  receivedAt: string;
  score: number;
  /** Étape courante, en mots de l'écran (« Invité », « Non retenu »…). */
  stageLabel: string;
  /** La candidature porte sur la campagne qu'on regarde. */
  current: boolean;
};

export type VivierProfileSolicitation = {
  campaignId: string;
  jobTitle: string;
  /** « Proposé », « Invité le … », « Écarté le … ». */
  state: 'identified' | 'contacted' | 'rejected';
  at: string | null;
};

export type VivierProfile = {
  synthesis: {
    title: string | null;
    /** Derniers postes (ancres de titre au-delà du titre déclaré), récents d'abord. */
    positions: string[];
    experienceYears: number | null;
    localisation: string | null;
    skills: string[];
    diplomes: string[];
    langues: string[];
    secteurs: string[];
  };
  applications: VivierProfileApplication[];
  /** Sollicitations depuis le vivier sur les AUTRES campagnes. */
  solicitations: VivierProfileSolicitation[];
};

/** Au-delà, la synthèse redevient un CV : on s'arrête à l'essentiel. */
export const PROFILE_SKILLS_MAX = 12;

export function buildVivierProfile(input: {
  title: string | null;
  titleAnchors: readonly TitleAnchor[];
  skills: readonly string[];
  entities: VivierEntities | null;
  applications: readonly Omit<VivierProfileApplication, 'current'>[];
  proposals: readonly { campaignId: string; state: VivierProfileSolicitation['state']; contactedAt: string | null; rejectedAt: string | null }[];
  jobTitleOf: (campaignId: string) => string;
  currentCampaignId: string;
}): VivierProfile {
  const positions = [...input.titleAnchors]
    .filter((a) => a.depth >= 1 && a.text.trim())
    .sort((a, b) => a.depth - b.depth)
    .map((a) => a.text.trim());
  const e = input.entities;
  return {
    synthesis: {
      title: input.title?.trim() || null,
      positions,
      experienceYears: e?.experienceYears ?? null,
      localisation: e?.localisation ?? null,
      skills: [...new Set(input.skills.map((s) => s.trim()).filter(Boolean))].slice(0, PROFILE_SKILLS_MAX),
      diplomes: e?.diplomes ?? [],
      langues: e?.langues ?? [],
      secteurs: e?.secteurs ?? [],
    },
    applications: input.applications.map((a) => ({ ...a, current: a.campaignId === input.currentCampaignId })),
    solicitations: input.proposals
      .filter((p) => p.campaignId !== input.currentCampaignId)
      .map((p) => ({
        campaignId: p.campaignId,
        jobTitle: input.jobTitleOf(p.campaignId),
        state: p.state,
        at: p.state === 'contacted' ? p.contactedAt : p.state === 'rejected' ? p.rejectedAt : null,
      })),
  };
}
