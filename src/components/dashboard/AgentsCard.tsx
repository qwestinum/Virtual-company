'use client';

/**
 * Carte « Agents IA » avec totaux et lignes par agent (Session 6).
 *
 * Chaque ligne montre nom + statut (dot coloré) + nombre de tâches +
 * délai moyen (tiret pour l'instant — pas instrumenté) + taux de
 * succès + coût estimé, et une progress bar largeur ∝ tâches.
 * On affiche tous les agents du registry, même ceux à 0 tâche, pour
 * que la carte reste lisible quand peu d'activité s'est accumulée.
 */

import { useShallow } from 'zustand/react/shallow';

import type { AgentMetric } from '@/lib/dashboard/derive-metrics';
import { selectAgents, useAgentsStore } from '@/stores/agents-store';

import { DASH_COLORS, type DashColor } from './tokens';

export type AgentsCardProps = {
  agents: AgentMetric[];
};

// Mapping ID → couleur de la ligne agent. Reste stable pour que le DRH
// reconnaisse rapidement chaque agent à sa couleur.
const AGENT_COLOR: Record<string, DashColor> = {
  'agent.manager-rh': 'indigo',
  'agent.cv-analyzer': 'blue',
  'agent.mail-composer': 'purple',
  'agent.job-writer': 'orange',
  'agent.publisher': 'teal',
  'agent.scheduler': 'pink',
};

export function AgentsCard({ agents }: AgentsCardProps) {
  const registry = useAgentsStore(useShallow(selectAgents));
  const metricsById = new Map(agents.map((a) => [a.agentId, a]));

  const totalTasks = agents.reduce((sum, a) => sum + a.taskCount, 0);
  const totalCost = agents.reduce((sum, a) => sum + a.costEstimate, 0);
  const maxTasks = Math.max(1, ...agents.map((a) => a.taskCount));

  return (
    <section
      style={{
        background: 'var(--dash-surface)',
        border: '1px solid var(--dash-border)',
        borderRadius: 16,
        padding: 22,
        boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <h3
          className="font-display"
          style={{
            fontSize: 17,
            fontWeight: 800,
            margin: 0,
            color: 'var(--dash-text)',
          }}
        >
          Agents IA
        </h3>
        <div
          className="font-data"
          style={{ display: 'flex', gap: 12, fontSize: 12 }}
        >
          <span style={{ color: 'var(--dash-blue)' }}>
            {totalTasks} tâche{totalTasks > 1 ? 's' : ''}
          </span>
          <span style={{ color: 'var(--dash-pink)' }}>
            {totalCost.toFixed(2)}€
          </span>
        </div>
      </div>
      {registry.map((agent) => {
        const metric =
          metricsById.get(agent.id) ?? {
            agentId: agent.id,
            taskCount: 0,
            avgDurationMs: null,
            successRate: 100,
            costEstimate: 0,
          };
        const color = DASH_COLORS[AGENT_COLOR[agent.id] ?? 'blue'];
        const widthPct = Math.round((metric.taskCount / maxTasks) * 100);
        return (
          <AgentLine
            key={agent.id}
            name={agent.name}
            color={color.solid}
            metric={metric}
            widthPct={widthPct}
          />
        );
      })}
    </section>
  );
}

function AgentLine({
  name,
  color,
  metric,
  widthPct,
}: {
  name: string;
  color: string;
  metric: AgentMetric;
  widthPct: number;
}) {
  const durationLabel =
    metric.avgDurationMs != null
      ? `⚡${(metric.avgDurationMs / 1000).toFixed(1)}s`
      : '⚡—';
  return (
    <div
      style={{
        padding: '12px 14px',
        borderRadius: 12,
        background: 'var(--dash-warm)',
        border: '1px solid var(--dash-border)',
        marginBottom: 8,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 7,
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 9 }}
        >
          <span
            aria-hidden
            style={{
              width: 9,
              height: 9,
              borderRadius: 3,
              background: color,
              boxShadow: `0 0 6px ${color}66`,
            }}
          />
          <span
            className="font-display"
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: 'var(--dash-text)',
            }}
          >
            {name}
          </span>
        </div>
        <div
          className="font-data"
          style={{ display: 'flex', gap: 14, fontSize: 11 }}
        >
          <span
            style={{ color: 'var(--dash-text)', fontWeight: 600 }}
          >
            {metric.taskCount}
          </span>
          <span style={{ color: 'var(--dash-text-secondary)' }}>
            {durationLabel}
          </span>
          <span style={{ color: 'var(--dash-green)' }}>
            {metric.successRate}%
          </span>
          <span style={{ color: 'var(--dash-text-tertiary)' }}>
            {metric.costEstimate.toFixed(2)}€
          </span>
        </div>
      </div>
      <div
        style={{
          height: 5,
          background: 'var(--dash-border)',
          borderRadius: 5,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            borderRadius: 5,
            transition: 'width 0.8s ease',
            width: `${widthPct}%`,
            background: `linear-gradient(90deg, ${color}, ${color}bb)`,
          }}
        />
      </div>
    </div>
  );
}
