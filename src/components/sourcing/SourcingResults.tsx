'use client';

/**
 * Liste des profils — conteneur : chargement, « 50 de plus », lignes dépliées,
 * arbitrage (décliner) et approche (préparer → geste du recruteur → confirmer).
 * Le rendu vit dans `SourcingResultsList`, `SourcingRowMarks`, `SourcingApproachPanel`.
 */

import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { INITIAL_EXPANSION, setSingle, toggleRow, type ExpansionState } from '@/lib/sourcing/expansion';
import type { ProfilesView } from '@/lib/sourcing/profiles-view';
import type { SourcingProfileView } from '@/types/sourcing';

import { ApproachPreparing, SourcingApproachDialog } from './SourcingApproachDialog';
import { SourcingApproachPanel } from './SourcingApproachPanel';
import { SourcingResultsList } from './SourcingResultsList';
import { SourcingRowActions, SourcingRowMarks } from './SourcingRowMarks';
import { useSourcingApproach } from './useSourcingApproach';

type Prefs = { messageFormat: 'connection_note' | 'inmail'; availableFirst: boolean };
type Payload = ProfilesView & { preferences: Prefs; myApproaches: number };

const post = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export function SourcingResults({ campaignId, version }: { campaignId: string; version: number }) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expansion, setExpansion] = useState<ExpansionState>(INITIAL_EXPANSION);
  const { approche, preparer, changerFormat, fermer, confirmer } = useSourcingApproach();
  const url = `/api/sourcing/campaigns/${encodeURIComponent(campaignId)}/profiles`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as Payload);
      setNotice(null);
    } catch {
      setNotice('La liste n’a pas pu être chargée.');
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, version]);

  const more = async () => {
    setBusy('more');
    const res = await fetch(url, { method: 'POST' }).catch(() => null);
    if (res?.ok) setData((await res.json()) as Payload);
    setBusy(null);
  };

  const decline = async (p: SourcingProfileView) => {
    setBusy(p.id);
    const res = await post(`/api/sourcing/profiles/${p.id}/decline`, {}).catch(() => null);
    setBusy(null);
    if (res?.ok) await load();
    else setNotice('Le profil n’a pas pu être décliné.');
  };

  // Fermer recharge la liste : une approche confirmée change l'état du profil.
  const closeApproach = () => {
    fermer();
    void load();
  };

  const savePrefs = (patch: Partial<Prefs>) => {
    setData((d) => (d ? { ...d, preferences: { ...d.preferences, ...patch } } : d));
    void fetch('/api/sourcing/preferences', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) }).catch(() => {});
  };

  if (loading && !data) {
    return (
      <p className="font-body text-[13px] text-stone-500">
        <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> Chargement des profils…
      </p>
    );
  }
  if (!data || data.groups.length === 0) {
    return <p className="font-body text-[13px] italic text-stone-400">{notice ?? 'Aucune recherche pour cette campagne. Relisez la requête, puis lancez-la.'}</p>;
  }

  const profileOf = (id: string) => data.groups.flatMap((g) => g.profiles).find((p) => p.id === id);

  return (
    <>
      {notice ? <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 font-body text-[12.5px] text-rose-800">{notice}</p> : null}
      <SourcingResultsList
        view={data}
        expansion={expansion}
        onToggle={(id) => setExpansion((s) => toggleRow(s, id))}
        onSingleChange={(single) => setExpansion((s) => setSingle(s, single))}
        onMore={() => void more()}
        promoting={busy === 'more'}
        availableFirst={data.preferences.availableFirst}
        onAvailableFirstChange={(availableFirst) => savePrefs({ availableFirst })}
        myApproaches={data.myApproaches}
        extras={{
          slot: (p) => <SourcingRowMarks profile={p} />,
          actions: (p) => (
            <SourcingRowActions profile={p} busy={busy !== null || approche !== null} onDecline={(x) => void decline(x)} onApproach={(x, c) => void preparer(x, c)} />
          ),
        }}
      />
      {approche ? (
        <SourcingApproachDialog
          titre={approche.channel === 'linkedin' ? 'Message pour l’invitation LinkedIn' : 'Email d’approche'}
          onClose={closeApproach}
        >
          {approche.prepared ? (
            <SourcingApproachPanel
              // Remonté à CHAQUE nouveau message : le texte édité suit la
              // nouvelle rédaction. La FENÊTRE, elle, reste montée.
              key={approche.prepared.approachId}
              prepared={approche.prepared}
              formatShown={approche.format ?? approche.prepared.format}
              redrafting={approche.attente}
              onConfirm={confirmer}
              onCancel={closeApproach}
              onFormatChange={(format) => {
                const p = profileOf(approche.profileId);
                savePrefs({ messageFormat: format });
                if (p) changerFormat(p, format);
              }}
            />
          ) : (
            <ApproachPreparing onCancel={closeApproach} error={approche.erreur} />
          )}
        </SourcingApproachDialog>
      ) : null}
    </>
  );
}
