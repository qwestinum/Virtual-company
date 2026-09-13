'use client';

/**
 * Une ligne par profil (spec §14.3, ajustement du 14/09/2026).
 *
 * REPLIÉE, elle porte l'essentiel pour balayer vite : intitulé actuel —
 * entreprise — localisation — ancienneté dans le poste. `slot` accueille les
 * repères du lot 3 (en recherche, mentions, vivier) sans déplacer le reste.
 * DÉPLIÉE, elle montre la matière pour décider : parcours daté, formation,
 * extrait, résumé. Pas de carte pleine hauteur.
 */

import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';

import { indexedAgeLabel, periodLabel, tenureLabel } from '@/lib/sourcing/display';
import type { SourcingProfileView } from '@/types/sourcing';

export function SourcingProfileRow({
  profile,
  expanded,
  onToggle,
  slot,
  actions,
}: {
  profile: SourcingProfileView;
  expanded: boolean;
  onToggle: (id: string) => void;
  slot?: ReactNode;
  actions?: ReactNode;
}) {
  const s = profile.snapshot;
  const tenure = s.current ? tenureLabel(s.current.since) : null;
  const outOfZone = profile.inZone === false;
  const summary = [
    s.current?.title ?? s.headline ?? 'Poste actuel non renseigné',
    s.current?.company ?? null,
  ].filter(Boolean);

  return (
    <li data-profile-row={profile.id} className="rounded-md border border-stone-200 bg-white">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={`profile-detail-${profile.id}`}
          onClick={() => onToggle(profile.id)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-stone-400" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-stone-400" />
          )}
          <span className="min-w-0 truncate font-body text-[13px] text-stone-800">
            <span className="font-semibold">{summary.join(' — ')}</span>
            <span className={outOfZone ? 'font-semibold text-amber-800' : 'text-stone-500'}>
              {' — '}
              {s.location ?? 'localisation non renseignée'}
              {outOfZone ? ' (hors zone)' : ''}
            </span>
            {tenure ? <span className="text-stone-500"> — {tenure}</span> : null}
          </span>
        </button>
        {slot ? <span className="flex shrink-0 items-center gap-1.5">{slot}</span> : null}
        {actions ? <span className="flex shrink-0 items-center gap-1.5">{actions}</span> : null}
      </div>

      {expanded ? <ProfileDetail profile={profile} /> : null}
    </li>
  );
}

function ProfileDetail({ profile }: { profile: SourcingProfileView }) {
  const s = profile.snapshot;
  const age = indexedAgeLabel(s.indexedAt);
  return (
    <div id={`profile-detail-${profile.id}`} className="flex flex-col gap-2 border-t border-stone-100 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-body text-[13px] font-semibold text-stone-900">
          {s.name}
          {age ? <span className="font-normal text-stone-400"> · {age}</span> : null}
        </p>
        <a
          href={s.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-md border border-stone-300 px-2 py-0.5 font-body text-[12px] font-semibold text-stone-600 hover:bg-stone-50"
        >
          Ouvrir le profil <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {s.workHistory.length > 0 ? (
        <Block title="Parcours">
          {s.workHistory.map((w, i) => (
            <Dated key={`w-${i}`} period={periodLabel(w.from, w.to)}>
              {w.title}
              {w.company ? <span className="text-stone-500"> — {w.company}</span> : null}
            </Dated>
          ))}
        </Block>
      ) : null}

      {s.education.length > 0 ? (
        <Block title="Formation">
          {s.education.map((e, i) => (
            <Dated key={`e-${i}`} period={periodLabel(e.from, e.to)}>
              {[e.degree, e.institution].filter(Boolean).join(' — ')}
            </Dated>
          ))}
        </Block>
      ) : null}

      {s.highlight ? <p className="font-body text-[12.5px] italic text-stone-600">« {s.highlight} »</p> : null}

      {s.contacts?.emails.length ? (
        <Block title="Contact">
          <p className="font-body text-[12.5px] text-stone-700">
            {s.contacts.emails[0]} <span className="text-stone-400">(indiqué par la personne sur son profil)</span>
          </p>
        </Block>
      ) : null}

      {profile.mentions && profile.mentions.length > 0 ? (
        <Block title="Mots de la fiche retrouvés">
          {profile.mentions.map((m) => (
            <p key={m.criterionId} className="font-body text-[12.5px] text-stone-700">
              <span className="text-stone-500">{m.label} : </span>
              {m.terms.length === 0 ? (
                <span className="italic text-stone-400">pas de mention (critère rédigé en phrase)</span>
              ) : m.found.length > 0 ? (
                m.found.map((t) => `✓ ${t}`).join(' · ')
              ) : (
                '—'
              )}
            </p>
          ))}
          <p className="font-body text-[11.5px] text-stone-400">Indice de lecture, pas une évaluation.</p>
        </Block>
      ) : null}

      {s.about ? (
        <Block title="Résumé">
          <p className="whitespace-pre-line font-body text-[12.5px] text-stone-700">{s.about}</p>
        </Block>
      ) : null}
      {s.skills || s.languages || s.certifications ? (
        <Block title="Compétences">
          {s.skills ? <p className="font-body text-[12.5px] text-stone-700">{s.skills}</p> : null}
          {s.languages ? <p className="font-body text-[12.5px] text-stone-700">Langues : {s.languages}</p> : null}
          {s.certifications ? <p className="font-body text-[12.5px] text-stone-700">Certifications : {s.certifications}</p> : null}
        </Block>
      ) : null}
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="font-body text-[11px] font-semibold uppercase tracking-wide text-stone-400">{title}</p>
      {children}
    </div>
  );
}

function Dated({ period, children }: { period: string | null; children: ReactNode }) {
  return (
    <p className="font-body text-[12.5px] text-stone-700">
      <span className="inline-block w-36 font-data text-[11.5px] text-stone-500">{period ?? '—'}</span>
      {children}
    </p>
  );
}
