'use client';

/**
 * Carte de profil — LECTURE SEULE au lot 2 (spec §14.3). La matière pour
 * décider : poste actuel, ancienneté, parcours daté, formation, résumé.
 * Les gestes (décliner, se connecter, contacter par email), le badge « en
 * recherche » et les mentions arrivent au lot 3.
 */

import { ExternalLink, MapPin } from 'lucide-react';
import { useState } from 'react';

import { indexedAgeLabel, periodLabel, tenureLabel } from '@/lib/sourcing/display';
import type { SourcingProfileView } from '@/types/sourcing';

const VISIBLE_JOBS = 3;

export function SourcingProfileCard({ profile }: { profile: SourcingProfileView }) {
  const s = profile.snapshot;
  const [allJobs, setAllJobs] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const jobs = allJobs ? s.workHistory : s.workHistory.slice(0, VISIBLE_JOBS);
  const tenure = s.current ? tenureLabel(s.current.since) : null;
  const age = indexedAgeLabel(s.indexedAt);
  const outOfZone = profile.inZone === false;

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-stone-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-body text-[14px] font-semibold text-stone-900">{s.name}</p>
          <p className="font-body text-[12.5px] text-stone-700">
            {s.current ? `${s.current.title}${s.current.company ? ` — ${s.current.company}` : ''}` : s.headline ?? 'Poste actuel non renseigné'}
            {tenure ? <span className="text-stone-500"> · {tenure}</span> : null}
          </p>
          <p className={`font-body text-[12px] ${outOfZone ? 'font-semibold text-amber-800' : 'text-stone-500'}`}>
            <MapPin className="mr-0.5 inline h-3 w-3" />
            {s.location ?? 'localisation non renseignée'}
            {outOfZone ? ' · hors zone' : ''}
            {age ? <span className="font-normal text-stone-400"> · {age}</span> : null}
          </p>
        </div>
        <a
          href={s.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-md border border-stone-300 px-2.5 py-1 font-body text-[12px] font-semibold text-stone-600 hover:bg-stone-50"
        >
          Ouvrir le profil <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {jobs.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          <p className="font-body text-[11px] font-semibold uppercase tracking-wide text-stone-400">Parcours</p>
          {jobs.map((w, i) => (
            <p key={`${w.title}-${i}`} className="font-body text-[12.5px] text-stone-700">
              <span className="inline-block w-36 font-data text-[11.5px] text-stone-500">{periodLabel(w.from, w.to) ?? '—'}</span>
              {w.title}
              {w.company ? <span className="text-stone-500"> — {w.company}</span> : null}
            </p>
          ))}
          {s.workHistory.length > VISIBLE_JOBS && !allJobs ? (
            <button type="button" onClick={() => setAllJobs(true)} className="w-fit font-body text-[12px] font-semibold text-stone-600 hover:text-stone-900">
              ▾ {s.workHistory.length - VISIBLE_JOBS} poste{s.workHistory.length - VISIBLE_JOBS > 1 ? 's' : ''} de plus
            </button>
          ) : null}
        </div>
      ) : null}

      {s.education.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          <p className="font-body text-[11px] font-semibold uppercase tracking-wide text-stone-400">Formation</p>
          {s.education.map((e, i) => (
            <p key={`${e.degree}-${i}`} className="font-body text-[12.5px] text-stone-700">
              <span className="inline-block w-36 font-data text-[11.5px] text-stone-500">{periodLabel(e.from, e.to) ?? '—'}</span>
              {[e.degree, e.institution].filter(Boolean).join(' — ')}
            </p>
          ))}
        </div>
      ) : null}

      {s.highlight ? <p className="font-body text-[12.5px] italic text-stone-600">« {s.highlight} »</p> : null}

      {s.about || s.skills || s.languages || s.certifications ? (
        <div>
          <button type="button" onClick={() => setAboutOpen((v) => !v)} className="font-body text-[12px] font-semibold text-stone-600 hover:text-stone-900">
            {aboutOpen ? '▴' : '▸'} Résumé et compétences
          </button>
          {aboutOpen ? (
            <div className="mt-1 flex flex-col gap-1.5 whitespace-pre-line font-body text-[12.5px] text-stone-700">
              {s.about ? <p>{s.about}</p> : null}
              {s.skills ? <p><span className="font-semibold">Compétences : </span>{s.skills}</p> : null}
              {s.languages ? <p><span className="font-semibold">Langues : </span>{s.languages}</p> : null}
              {s.certifications ? <p><span className="font-semibold">Certifications : </span>{s.certifications}</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
