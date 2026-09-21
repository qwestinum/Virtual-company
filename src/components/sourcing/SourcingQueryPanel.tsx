'use client';

/**
 * Écran de requête (spec §14.2). La requête est rédigée depuis la fiche, le
 * recruteur la relit et la corrige : c'est SA version qui part au moteur. La
 * version générée voyage avec elle pour mesurer l'écart (§17.3).
 */

import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import type { PublicGeneratedQuery, SourcingLanguage } from '@/types/sourcing';

import { EncodedCriteria } from './EncodedCriteria';

type SearchSummary = {
  toReview: number;
  reserve: number;
  unusable: number;
  skipped: { alreadySeen: number; excluded: number; opposed: number; duplicates: number };
};

export function SourcingQueryPanel({ campaignId, onSearched }: { campaignId: string; onSearched: () => void }) {
  const [language, setLanguage] = useState<SourcingLanguage>('fr');
  const [generated, setGenerated] = useState<PublicGeneratedQuery | null>(null);
  const [text, setText] = useState('');
  const [generating, setGenerating] = useState(true);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'info' | 'error'; message: string } | null>(null);

  const generate = useCallback(
    async (lang: SourcingLanguage) => {
      setGenerating(true);
      try {
        const res = await fetch(`/api/sourcing/campaigns/${encodeURIComponent(campaignId)}/query`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ language: lang }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const { generated: g } = (await res.json()) as { generated: PublicGeneratedQuery };
        setGenerated(g);
        setText(g.query);
      } catch {
        setNotice({ tone: 'error', message: 'La requête n’a pas pu être rédigée. Vous pouvez l’écrire vous-même.' });
      } finally {
        setGenerating(false);
      }
    },
    [campaignId],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void generate(language);
  }, [generate, language]);

  const launch = async () => {
    setRunning(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/sourcing/campaigns/${encodeURIComponent(campaignId)}/searches`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query: text,
          queryGenerated: generated?.query ?? '',
          queryMethod: generated?.method ?? 'deterministic',
          language: generated?.language ?? language,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { result?: SearchSummary; message?: string };
      if (!res.ok || !json.result) {
        setNotice({ tone: 'error', message: json.message ?? 'La recherche a échoué.' });
        return;
      }
      const r = json.result;
      const hidden = r.skipped.alreadySeen + r.skipped.excluded + r.skipped.opposed + r.skipped.duplicates;
      setNotice({
        tone: 'info',
        message:
          `${r.toReview + r.reserve} nouveau${r.toReview + r.reserve > 1 ? 'x' : ''} profil${r.toReview + r.reserve > 1 ? 's' : ''}` +
          (hidden > 0 ? ` · ${hidden} déjà vu${hidden > 1 ? 's' : ''} ou écarté${hidden > 1 ? 's' : ''}` : ''),
      });
      onSearched();
    } catch {
      setNotice({ tone: 'error', message: 'La recherche a échoué.' });
    } finally {
      setRunning(false);
    }
  };

  const edited = generated !== null && text.trim() !== generated.query.trim();

  return (
    // ⚠️ LE QUADRANT DE LA REQUÊTE EST MIS EN ÉVIDENCE. C'est le seul endroit
    // de l'écran où l'on écrit quelque chose qui part chez un tiers et qui
    // coûte : sur un fond blanc parmi d'autres cadres blancs, rien ne le
    // distinguait d'un bloc de lecture. Beige, comme la surbrillance des
    // campagnes sourcées — une NUANCE (1,22:1 sur le blanc), jamais une
    // couleur d'alerte.
    <section
      className="flex flex-col gap-3 rounded-[14px] border px-4 py-4"
      style={{
        borderColor: 'var(--dash-beige-bord)',
        background: 'var(--dash-beige)',
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor="sourcing-query" className="font-body text-[13px] font-semibold text-stone-800">
          Requête
        </label>
        <div className="flex items-center gap-3 font-body text-[12px] text-stone-600">
          {edited ? (
            <button type="button" onClick={() => setText(generated!.query)} className="font-semibold hover:text-stone-900">
              ↺ Revenir à la requête générée
            </button>
          ) : null}
          <span>Langue</span>
          {(['fr', 'en'] as const).map((lang) => (
            <label key={lang} className="flex items-center gap-1">
              <input type="radio" name="sourcing-lang" checked={language === lang} disabled={generating || running} onChange={() => setLanguage(lang)} />
              {lang === 'fr' ? 'Français' : 'Anglais'}
            </label>
          ))}
        </div>
      </div>

      <textarea
        id="sourcing-query"
        rows={3}
        value={generating ? '' : text}
        placeholder={generating ? 'Rédaction de la requête à partir de la fiche…' : ''}
        disabled={generating}
        onChange={(e) => setText(e.target.value)}
        className="orqa-field w-full resize-y rounded-[10px] border bg-white px-3 py-2 font-body text-[13.5px]"
        style={{ borderColor: 'var(--dash-field-border)', color: 'var(--dash-text)' }}
      />

      {generated?.fallbackReason ? (
        <p className="font-body text-[12px] text-amber-800">
          Requête rédigée par règles, sans assistant ({generated.fallbackReason}). Relisez-la avant de lancer.
        </p>
      ) : null}
      {generated ? <EncodedCriteria encoded={generated.encoded} notEncoded={generated.notEncoded} /> : null}

      <p className="font-body text-[12px] text-stone-500">
        Une localisation et un secteur précis changent nettement les résultats ; une requête courte ramène
        des intitulés justes mais des métiers vagues. Relancer la même requête donne la même liste.
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-body text-[12px] text-stone-500">100 profils par recherche</p>
        <button
          type="button"
          disabled={generating || running || text.trim().length < 3}
          onClick={() => void launch()}
          className="rounded-lg border px-4 py-1.5 font-body text-[12.5px] font-semibold disabled:opacity-40"
          style={{
            borderColor: 'var(--dash-beige-encre)',
            background: 'var(--dash-beige-encre)',
            color: '#fff',
          }}
        >
          {running ? <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> : null}
          {running ? 'Recherche en cours…' : 'Lancer'}
        </button>
      </div>

      {notice ? (
        <p
          className={
            notice.tone === 'error'
              ? 'rounded-md border border-rose-200 bg-rose-50 px-3 py-2 font-body text-[12.5px] text-rose-800'
              : 'rounded-md border border-stone-200 bg-stone-50 px-3 py-2 font-body text-[12.5px] text-stone-700'
          }
        >
          {notice.message}
        </p>
      ) : null}
    </section>
  );
}
