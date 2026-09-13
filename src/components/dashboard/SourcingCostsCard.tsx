'use client';

/**
 * Carte « Recherche de profils » du tableau de bord d'administration.
 *
 * Nombre de recherches, coût du moteur de profils, coût de rédaction des
 * requêtes — par mois, pour ce cabinet. Coût d'exploitation inclus dans
 * l'abonnement : cette carte est le SEUL endroit où il s'affiche. Masquée si la
 * route ne répond pas (utilisateur non admin, base absente) ou si aucune
 * recherche n'a jamais eu lieu sur la fenêtre.
 */

import { useEffect, useState } from 'react';

import type { SourcingCostSummary } from '@/lib/sourcing/costs';

type Payload = SourcingCostSummary & { cabinet: string | null };

const usd = (v: number): string => `${v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;

const monthLabel = (m: string): string => {
  const [y, mm] = m.split('-');
  return new Date(Number(y), Number(mm) - 1, 1).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
};

export function SourcingCostsCard() {
  const [data, setData] = useState<Payload | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/admin/sourcing-costs', { cache: 'no-store' });
        if (!res.ok) return;
        const json = (await res.json()) as Payload;
        if (!cancelled) setData(json);
      } catch {
        // silencieux : carte d'exploitation, jamais bloquante
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!data || data.total.searches === 0) return null;
  const active = data.months.filter((m) => m.searches > 0 || m.generations > 0);

  return (
    <section
      style={{
        background: 'var(--dash-surface)',
        border: '1px solid var(--dash-border)',
        borderRadius: 16,
        padding: 22,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <h3 className="font-display" style={{ fontSize: 17, fontWeight: 800, margin: 0, color: 'var(--dash-text)' }}>
          Recherche de profils{data.cabinet ? ` — ${data.cabinet}` : ''}
        </h3>
        <span className="font-data" style={{ fontSize: 12, color: 'var(--dash-text-muted, #78716c)' }}>
          12 mois · {data.total.searches} recherche{data.total.searches > 1 ? 's' : ''} · {usd(data.total.exaCostUsd + data.total.llmCostUsd)}
        </span>
      </div>
      <table className="font-data" style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', color: 'var(--dash-text-muted, #78716c)' }}>
            <th style={{ padding: '4px 0' }}>Mois</th>
            <th>Recherches</th>
            <th>Moteur de profils</th>
            <th>Rédaction des requêtes</th>
          </tr>
        </thead>
        <tbody>
          {active.map((m) => (
            <tr key={m.month} style={{ borderTop: '1px solid var(--dash-border)' }}>
              <td style={{ padding: '4px 0' }}>{monthLabel(m.month)}</td>
              <td>{m.searches}</td>
              <td>
                {usd(m.exaCostUsd)}
                {m.searchesWithoutCost > 0 ? ` (+${m.searchesWithoutCost} sans coût communiqué)` : ''}
              </td>
              <td>
                {usd(m.llmCostUsd)} ({m.generations})
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
