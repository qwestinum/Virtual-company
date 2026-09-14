/**
 * Détail d'un profil, ligne dépliée (retouche du 14/09/2026).
 *
 * Des SECTIONS, pas un bloc : poste actuel (lu en premier), parcours en frise,
 * formation, résumé, repères regroupés, puis les actions en pied. Le parcours
 * est rendu par les MÊMES composants que la page d'atterrissage.
 */
import { ExternalLink, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';

import { indexedAgeLabel } from '@/lib/sourcing/display';
import type { SourcingProfileView } from '@/types/sourcing';

import { AboutSection, CareerTimelineSection, CurrentPositionSection, EducationSection, SkillsSection } from './profile/CareerSections';
import { ProfileSection } from './profile/ProfileSection';
import { SourcingRowMarks } from './SourcingRowMarks';

const text = 'font-body text-[13px]';

export function SourcingProfileDetail({ profile, actions }: { profile: SourcingProfileView; actions?: ReactNode }) {
  const s = profile.snapshot;
  const age = indexedAgeLabel(s.indexedAt);
  return (
    // Décalé à droite et encadré à part : on voit d'un coup d'œil où finit la
    // ligne et où commence son détail.
    <div
      id={`profile-detail-${profile.id}`}
      data-profile-detail
      className="mb-3 ml-9 mr-3 flex flex-col gap-3 rounded-lg px-4 py-4"
      style={{ backgroundColor: 'var(--dash-bg)' }}
    >
      <CurrentPositionSection items={s.workHistory} fallback={s.current} />
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <CareerTimelineSection items={s.workHistory} />
          <EducationSection items={s.education} />
        </div>
        <div className="flex flex-col gap-3">
          <MarksSection profile={profile} />
          <AboutSection text={s.about} />
          <SkillsSection value={{ skills: s.skills, languages: s.languages, certifications: s.certifications }} />
        </div>
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t pt-3" style={{ borderColor: 'var(--dash-border)' }} data-detail-actions>
        {actions}
        <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-body text-[12px] font-semibold hover:bg-white" style={{ borderColor: 'var(--dash-border-strong)', color: 'var(--dash-text-secondary)' }}>
          Ouvrir le profil <ExternalLink className="h-3 w-3" />
        </a>
        {age ? <span className="ml-auto font-body text-[11.5px]" style={{ color: 'var(--dash-text-tertiary)' }}>{age}</span> : null}
      </footer>
    </div>
  );
}

function MarksSection({ profile }: { profile: SourcingProfileView }) {
  const s = profile.snapshot;
  const mentions = profile.mentions ?? [];
  const hasBadges = profile.state === 'contacted' || Boolean(s.availability) || Boolean(profile.vivierCandidateId);
  if (!hasBadges && mentions.length === 0 && !s.contacts?.emails.length && !s.highlight) return null;
  return (
    <ProfileSection title="Repères" icon={Sparkles} accent="green" testId="marks">
      <div className="flex flex-col gap-2">
        {hasBadges ? <div className="flex flex-wrap items-center gap-1.5"><SourcingRowMarks profile={{ ...profile, mentions: [] }} /></div> : null}
        {s.contacts?.emails.length ? (
          <p className={text} style={{ color: 'var(--dash-text)' }}>
            {s.contacts.emails[0]} <span style={{ color: 'var(--dash-text-tertiary)' }}>(indiqué par la personne sur son profil)</span>
          </p>
        ) : null}
        {mentions.length > 0 ? (
          <div className="flex flex-col gap-0.5">
            <p className="font-body text-[11px] font-semibold" style={{ color: 'var(--dash-text-tertiary)' }}>Mots de la fiche retrouvés</p>
            {mentions.map((m) => (
              <p key={m.criterionId} className={text} style={{ color: 'var(--dash-text)' }}>
                <span style={{ color: 'var(--dash-text-secondary)' }}>{m.label} : </span>
                {m.terms.length === 0 ? (
                  <span className="italic" style={{ color: 'var(--dash-text-tertiary)' }}>pas de mention (critère rédigé en phrase)</span>
                ) : m.found.length > 0 ? (
                  <span style={{ color: 'var(--dash-green)' }}>{m.found.map((t) => `✓ ${t}`).join(' · ')}</span>
                ) : (
                  '—'
                )}
              </p>
            ))}
            <p className="font-body text-[11.5px]" style={{ color: 'var(--dash-text-tertiary)' }}>Indice de lecture, pas une évaluation.</p>
          </div>
        ) : null}
        {s.highlight ? <p className={`${text} italic`} style={{ color: 'var(--dash-text-secondary)' }}>Extrait : « {s.highlight} »</p> : null}
      </div>
    </ProfileSection>
  );
}
