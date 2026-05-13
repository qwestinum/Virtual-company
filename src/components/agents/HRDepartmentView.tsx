'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { selectAgents, useAgentsStore } from '@/stores/agents-store';
import type { AgentContractData } from '@/types/agent';

import { AgentCard } from './AgentCard';
import { FlowLines } from './FlowLines';

const MANAGER_ID = 'agent.manager-rh';
const UNIT_MIN = 45;
const UNIT_MAX = 130;
const UNIT_FALLBACK = 95;

// Positions des agents : pentagone régulier autour du manager,
// décalé de +0.5 en z pour pousser la composition vers le bas et
// dégager le haut pour le publisher. Bornes effectives :
//   x ∈ [-2.85, 2.85]  → |x|max = 2.85
//   z ∈ [-2.5, 2.93]   → |z|max = 2.93 (la contrainte basse domine)
// Empreinte d'une carte de bord (cercle 150 + label ≈ 50px) → 150 × 200.
const ABS_X_MAX = 2.85;
const ABS_Z_MAX = 2.93;
const WRAPPER_HALF_W = 75;
const WRAPPER_HALF_H = 100;
const SAFETY_MARGIN = 8;

/**
 * Calcule l'unité pixel maximale telle que la carte la plus éloignée
 * du centre rentre entièrement dans le cadre. On raisonne en demi-cadre
 * autour du centre (qui sert d'ancre commune à toutes les cartes via
 * `cardStyleFor`) ; la dimension critique est presque toujours la
 * hauteur car le workspace partage la largeur avec le chat.
 */
function clampUnit(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return UNIT_FALLBACK;
  }
  if (width <= 0 || height <= 0) return UNIT_FALLBACK;
  const halfW = width / 2 - WRAPPER_HALF_W - SAFETY_MARGIN;
  const halfH = height / 2 - WRAPPER_HALF_H - SAFETY_MARGIN;
  const fitW = Math.max(0, halfW) / ABS_X_MAX;
  const fitH = Math.max(0, halfH) / ABS_Z_MAX;
  return Math.max(UNIT_MIN, Math.min(UNIT_MAX, Math.min(fitW, fitH)));
}

function cardStyleFor(
  agent: AgentContractData,
  unit: number,
): CSSProperties {
  const [x, , z] = agent.avatar.position;
  return {
    position: 'absolute',
    left: '50%',
    top: '50%',
    transform: `translate(calc(-50% + ${x * unit}px), calc(-50% + ${z * unit}px))`,
  };
}

export function HRDepartmentView() {
  const agents = useAgentsStore(useShallow(selectAgents));
  const selectedAgentId = useAgentsStore((s) => s.selectedAgentId);
  const activeTaskByAgent = useAgentsStore(
    useShallow((s) => s.activeTaskByAgent),
  );
  const selectAgent = useAgentsStore((s) => s.selectAgent);

  const manager = agents.find((a) => a.id === MANAGER_ID) ?? null;
  const others = agents.filter((a) => a.id !== MANAGER_ID);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState<{
    width: number;
    height: number;
    unit: number;
  }>({ width: 0, height: 0, unit: UNIT_FALLBACK });

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const update = (w: number, h: number) =>
      setLayout({ width: w, height: h, unit: clampUnit(w, h) });
    update(el.clientWidth, el.clientHeight);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      update(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { unit } = layout;

  return (
    <div
      ref={wrapperRef}
      className="relative w-full h-full overflow-hidden"
      onPointerDown={() => selectAgent(null)}
    >
      <div
        className="bg-blob bg-blob-1"
        style={{
          width: 480,
          height: 480,
          top: '8%',
          left: '5%',
          backgroundColor: '#fde68a',
          opacity: 0.5,
        }}
        aria-hidden
      />
      <div
        className="bg-blob bg-blob-2"
        style={{
          width: 380,
          height: 380,
          bottom: '10%',
          right: '8%',
          backgroundColor: '#fde047',
          opacity: 0.35,
        }}
        aria-hidden
      />
      <div
        className="bg-blob bg-blob-3"
        style={{
          width: 440,
          height: 440,
          top: '38%',
          right: '32%',
          backgroundColor: '#cbd5e1',
          opacity: 0.45,
        }}
        aria-hidden
      />

      <div
        className="absolute inset-0 bg-grid-dots pointer-events-none"
        aria-hidden
      />

      <FlowLines
        manager={manager}
        others={others}
        unit={unit}
        width={layout.width}
        height={layout.height}
      />

      {agents.map((agent) => (
        <div key={agent.id} style={cardStyleFor(agent, unit)}>
          <AgentCard
            agent={agent}
            isSelected={selectedAgentId === agent.id}
            isManager={agent.id === MANAGER_ID}
            isWorking={Boolean(activeTaskByAgent[agent.id])}
            onSelect={selectAgent}
          />
        </div>
      ))}
    </div>
  );
}
