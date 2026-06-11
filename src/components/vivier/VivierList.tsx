'use client';

/**
 * Liste paginée du vivier : recherche (nom/email), statut d'indexation, tags
 * éditables, suppression. Rafraîchit automatiquement tant que des dossiers sont
 * en cours d'indexation (poll léger), pour refléter le passage pending →
 * indexed/failed (indexation asynchrone côté serveur).
 */

import { Loader2, Search } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { VivierDeleteDialog } from './VivierDeleteDialog';
import { VivierListRow } from './VivierListRow';
import type { VivierCandidate } from '@/types/vivier';

const PAGE_SIZE = 20;

export function VivierList({ refreshKey }: { refreshKey: number }) {
  const [items, setItems] = useState<VivierCandidate[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [toDelete, setToDelete] = useState<VivierCandidate | null>(null);
  const firstLoad = useRef(true);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      });
      if (query) params.set('search', query);
      const res = await fetch(`/api/vivier?${params.toString()}`);
      if (res.status === 503) {
        setOffline(true);
        setItems([]);
        return;
      }
      const data = await res.json();
      setItems((data.items as VivierCandidate[]) ?? []);
      setTotal((data.total as number) ?? 0);
      setOffline(false);
    } catch (err) {
      console.error('[vivier] load failed', err);
    } finally {
      setLoading(false);
    }
  }, [page, query]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load, refreshKey]);

  // Poll tant qu'au moins un dossier est en cours d'indexation.
  const hasPending = items.some((i) => i.indexingStatus === 'pending');
  useEffect(() => {
    if (!hasPending) return;
    const id = setInterval(() => void load(), 5000);
    return () => clearInterval(id);
  }, [hasPending, load]);

  function submitSearch() {
    setPage(0);
    setQuery(search.trim());
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (offline) {
    return (
      <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 font-body text-[13px] text-amber-800">
        Supabase non configuré — le vivier n&apos;est pas persisté. Configurez la
        connexion DB pour activer cette section.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400"
            aria-hidden
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitSearch();
            }}
            placeholder="Rechercher par nom ou email…"
            className="w-full rounded-lg border border-stone-300 bg-white py-1.5 pl-8 pr-3 font-body text-[13px] text-stone-800 outline-none focus:border-blue-400"
          />
        </div>
        <button
          type="button"
          onClick={submitSearch}
          className="rounded-lg border border-stone-300 px-3 py-1.5 font-body text-[12px] font-semibold text-stone-700 hover:bg-stone-100"
        >
          Rechercher
        </button>
      </div>

      {loading && firstLoad.current ? (
        <p className="font-body text-[13px] text-stone-500">Chargement…</p>
      ) : items.length === 0 ? (
        <p className="font-body text-[13px] text-stone-500">
          {query
            ? 'Aucun dossier ne correspond à cette recherche.'
            : 'Le vivier est vide — déposez des CV pour commencer.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((c) => (
            <VivierListRow
              key={c.id}
              candidate={c}
              onChanged={load}
              onDelete={setToDelete}
            />
          ))}
        </ul>
      )}

      {totalPages > 1 ? (
        <div className="flex items-center justify-center gap-3 pt-1">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="rounded-md px-2 py-1 font-body text-[12px] text-stone-600 hover:bg-stone-100 disabled:opacity-40"
          >
            Précédent
          </button>
          <span className="font-body text-[12px] text-stone-500">
            Page {page + 1} / {totalPages} · {total} dossier
            {total > 1 ? 's' : ''}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="rounded-md px-2 py-1 font-body text-[12px] text-stone-600 hover:bg-stone-100 disabled:opacity-40"
          >
            Suivant
          </button>
        </div>
      ) : null}

      {toDelete ? (
        <VivierDeleteDialog
          candidate={toDelete}
          onClose={() => setToDelete(null)}
          onDeleted={() => {
            setToDelete(null);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}
