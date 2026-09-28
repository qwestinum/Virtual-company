'use client';

/**
 * Le vivier d'une campagne (docs/specs/vivier.md §4, §6, §16). Ouvrir l'écran
 * LANCE la recherche (28/09/2026) : la liste enregistrée s'affiche, la
 * présélection la rafraîchit, et chaque profil — proposé ou trouvé par
 * mot-clé — porte ses gestes sur place : « CV », « Inviter », « Écarter ».
 *
 * ⚠️ LA DÉCISION SE PREND ICI (refonte, lot 4) : la file différée
 * « Validations vivier » n'était pas visitée (8 propositions sur 12 jamais
 * tranchées en production). Une file qu'on ne visite pas est un oubli organisé.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { ShortlistEntry } from '@/types/vivier-preselection';

import { VivierKeywordSearch } from './VivierKeywordSearch';
import { useVivierInvite, type VivierNotice, type VivierTarget } from './useVivierInvite';
import { VivierCvPreviewDrawer } from './VivierCvPreviewDrawer';
import { rejectProposals, VivierNoticeLine, VivierValidationList } from './VivierValidationList';
import { targetFromEntry } from './vivier-targets';
import { VivierDecidedTable } from './VivierDecidedTable';
import { VivierRunMeta, type VivierRunMetaData as Meta } from './VivierRunMeta';


export function VivierPreselectionPanel({ campaignId }: { campaignId: string }) {
  const [entries, setEntries] = useState<ShortlistEntry[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<VivierNotice | null>(null);
  const [preview, setPreview] = useState<VivierTarget | null>(null);
  // Décidés pendant la visite : les résultats par mot-clé suivent leur état.
  const [decided, setDecided] = useState<ReadonlyMap<string, 'contacted' | 'rejected'>>(new Map());
  const mark = (id: string, state: 'contacted' | 'rejected') => setDecided((prev) => new Map(prev).set(id, state));

  const base = `/api/campaigns/${campaignId}/vivier-preselection`;

  // Seule la DERNIÈRE lecture pose la liste : la lecture d'ouverture ne doit
  // pas repasser par-dessus le résultat de la recherche lancée juste après.
  const lecture = useRef(0);
  const loadPersisted = useCallback(async () => {
    const seq = ++lecture.current;
    try {
      const res = await fetch(base);
      if (!res.ok) return;
      const data = (await res.json()) as { entries: ShortlistEntry[] };
      if (seq === lecture.current) setEntries(data.entries);
    } catch {
      /* silencieux : l'affichage garde la liste précédente */
    }
  }, [base]);

  async function post(body?: object): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(base, {
        method: 'POST',
        ...(body
          ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
          : {}),
      });
      const data = (await res.json()) as {
        entries?: ShortlistEntry[];
        meta?: Meta;
        message?: string;
      };
      if (!res.ok) {
        setError(data.message ?? 'La présélection a échoué.');
        return;
      }
      setMeta(data.meta ?? null);
      // La liste AFFICHÉE est celle de la base : la réponse ne porte que le
      // calcul, pas les profils ajoutés à la main ni ceux déjà tranchés.
      await loadPersisted();
    } catch {
      setError('La présélection a échoué (réseau).');
    } finally {
      setBusy(false);
    }
  }

  async function relaunch() {
    await post();
  }

  // Ouvrir l'écran, c'est LANCER la recherche : les profils arrivent avec
  // leurs gestes, sans « Relancer » à cliquer d'abord. `onOpen` : regarder le
  // vivier ne déclenche jamais le contact automatique.
  useEffect(() => {
    // Chargement RÉSEAU : l'état n'est posé qu'après la réponse. La liste
    // enregistrée s'affiche tout de suite ; la recherche la rafraîchit.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadPersisted();
    void post({ onOpen: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  // Un geste à la fois sur tout l'écran : l'invitation lance une analyse.
  const { busyId, invite } = useVivierInvite(campaignId, setNotice, () => void loadPersisted());
  async function inviteAndClose(target: VivierTarget): Promise<boolean> {
    const ok = await invite(target);
    if (ok) {
      setPreview(null);
      mark(target.candidateId, 'contacted');
    }
    return ok;
  }
  async function reject(target: VivierTarget) {
    const ok = await rejectProposals(campaignId, [target.candidateId], target.matchTerm).catch(() => false);
    if (!ok) {
      setNotice({ tone: 'error', text: `${target.nom} n’a pas pu être écarté. Réessayez.` });
      return;
    }
    mark(target.candidateId, 'rejected');
    setPreview(null);
    await loadPersisted();
  }

  // Une proposition `identified` attend une décision ; les autres l'ont déjà
  // reçue. Les mélanger obligerait à lire l'état de chaque ligne pour savoir
  // laquelle appelle un geste.
  const aDecider = entries.filter((e) => e.state === 'identified');
  const tranches = entries.filter((e) => e.state !== 'identified');

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={relaunch}
          disabled={busy}
          className="rounded-md bg-emerald-600 px-3 py-1.5 font-body text-[12px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          Relancer la recherche vivier
        </button>
      </div>

      {error ? (
        <p className="font-body text-[12px] text-rose-600">{error}</p>
      ) : null}

      {notice ? <VivierNoticeLine notice={notice} /> : null}

      {/* Transparence du run : origine des matchs + écartés sous le seuil. */}
      {meta ? <VivierRunMeta meta={meta} /> : null}

      {/* ① CE QUI ATTEND UNE DÉCISION, en premier et décidable sur place. */}
      {aDecider.length > 0 ? (
        <section className="flex flex-col gap-2">
          <p className="font-body text-[12px] font-semibold text-stone-700">
            {aDecider.length} profil{aDecider.length > 1 ? 's' : ''} à examiner
            {' '}— « Inviter » crée la candidature et envoie l’invitation à un entretien.
          </p>
          <VivierValidationList
            campaignId={campaignId}
            entries={aDecider}
            onDecided={() => void loadPersisted()}
            onPreview={(e) => setPreview(targetFromEntry(e))}
            onInvite={(e) => void inviteAndClose(targetFromEntry(e))}
            invitingId={busyId}
          />
        </section>
      ) : null}

      {/* ② Le reste de la short-list : déjà tranché, donc en lecture. */}
      {entries.length === 0 ? (
        <p className="font-body text-[12px] text-stone-400">
          {busy
            ? 'Recherche dans le vivier…'
            : 'Aucune proposition pour le moment. Relancez la recherche après avoir enrichi le vivier.'}
        </p>
      ) : tranches.length === 0 ? null : (
        <VivierDecidedTable entries={tranches} />
      )}

      <VivierKeywordSearch
        campaignId={campaignId}
        invitingId={busyId}
        decided={decided}
        onPreview={setPreview}
        onReject={(t) => void reject(t)}
        onInvite={(t) => void inviteAndClose(t)}
      />

      {preview ? (
        <VivierCvPreviewDrawer
          key={preview.candidateId}
          entry={preview}
          busy={busyId === preview.candidateId}
          onInvite={() => void inviteAndClose(preview)}
          onReject={preview.canReject ? () => void reject(preview) : undefined}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </div>
  );
}
