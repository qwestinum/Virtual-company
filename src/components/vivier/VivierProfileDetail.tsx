'use client';

/**
 * Le détail DÉPLIÉ d'un profil du vivier (28/09/2026) — le même sous les
 * profils proposés et sous les résultats de la recherche par mot-clé. Ce qu'il
 * faut lire avant d'inviter ou d'écarter : pourquoi il est là, qui c'est
 * (synthèse), ce qui s'est déjà passé avec lui (historique), et le CV.
 */

import { useEffect, useState } from 'react';

import { formatFrDate } from '@/lib/reporting/audit-display';
import type { VivierProfile } from '@/lib/vivier/profile-summary';

const STATE_WORDS = { identified: 'Proposé', contacted: 'Contacté', rejected: 'Écarté' } as const;

export function VivierProfileDetail({
  candidateId,
  campaignId,
  why,
  onPreview,
}: {
  candidateId: string;
  campaignId: string;
  why: string[];
  onPreview: () => void;
}) {
  const [profile, setProfile] = useState<VivierProfile | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/vivier/${candidateId}/profile?campaignId=${encodeURIComponent(campaignId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { profile: VivierProfile }) => alive && setProfile(d.profile))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [candidateId, campaignId]);

  const s = profile?.synthesis;
  return (
    <div data-role="vivier-profile-detail" className="flex flex-col gap-3 border-t border-stone-100 px-3 py-3 font-body text-[12px] text-stone-600">
      <Block title="Pourquoi ce profil">
        {why.map((l) => (
          <p key={l}>{l}</p>
        ))}
      </Block>

      {failed ? (
        <p className="text-stone-500">La synthèse n’a pas pu être lue. Le CV reste consultable.</p>
      ) : !profile || !s ? (
        <p className="text-stone-400">Chargement de la synthèse…</p>
      ) : (
        <>
          <Block title="Synthèse">
            <p className="font-semibold text-stone-700">{s.title ?? 'Titre non précisé'}</p>
            {s.positions.length > 0 ? <p>Postes récents : {s.positions.join(' · ')}</p> : null}
            <p>
              {s.experienceYears !== null ? `${s.experienceYears} an${s.experienceYears > 1 ? 's' : ''} d’expérience` : 'Expérience non précisée'}
              {s.localisation ? ` · ${s.localisation}` : ''}
            </p>
            {s.skills.length > 0 ? <p>Compétences : {s.skills.join(', ')}</p> : null}
            {s.diplomes.length > 0 ? <p>Formation : {s.diplomes.join(', ')}</p> : null}
            {s.langues.length > 0 ? <p>Langues : {s.langues.join(', ')}</p> : null}
          </Block>

          <Block title="Historique">
            {profile.applications.length === 0 && profile.solicitations.length === 0 ? (
              <p className="text-stone-500">Aucune candidature ni sollicitation enregistrée.</p>
            ) : null}
            {profile.applications.map((a) => (
              <p key={a.analysisId}>
                Candidature {a.current ? 'à cette campagne' : `au poste de ${a.jobTitle}`} — reçue le {formatFrDate(a.receivedAt)} · score{' '}
                <span className="font-data">{a.score}</span> · {a.stageLabel}
              </p>
            ))}
            {profile.solicitations.map((p) => (
              <p key={p.campaignId}>
                {STATE_WORDS[p.state]} depuis le vivier pour le poste de {p.jobTitle}
                {p.at ? ` le ${formatFrDate(p.at)}` : ''}
              </p>
            ))}
          </Block>
        </>
      )}

      <button
        type="button"
        onClick={onPreview}
        className="self-start rounded-md border border-stone-200 bg-white px-2.5 py-1 font-semibold text-stone-700 hover:bg-stone-50"
      >
        Voir le CV
      </button>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-0.5">
      <p className="font-semibold text-stone-700">{title}</p>
      {children}
    </section>
  );
}
