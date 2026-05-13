'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { selectAgents, useAgentsStore } from '@/stores/agents-store';
import type { AgentContractData } from '@/types/agent';

import { AgentCard } from './AgentCard';
import { FlowLines } from './FlowLines';

const MANAGER_ID = 'agent.manager-rh';
const UNIT_MIN = 80;
const UNIT_MAX = 170;
const UNIT_FALLBACK = 130;

// Étendue des positions agents : x ∈ [-3,3] (6 unités), z ∈ [-3,2] (5 unités).
// On veille à ce que les cartes en bord rentrent entièrement dans le cadre.
const X_SPREAD = 6;
const Z_SPREAD = 5;
const LARGEST_CARD = 180; // diamètre du manager (cf. AgentCard)
const SAFETY_MARGIN = 16;

/**
 * Calcule l'unité pixel pour qu'aucun agent ne déborde du cadre, quel
 * que soit le ratio largeur/hauteur du conteneur (workspace partagé
 * avec le chat à droite, donc plus large que haut ou l'inverse selon
 * la fenêtre). On dérive l'unité maximale qui garantit que le centre
 * du dernier agent ne dépasse pas la zone disponible (= cadre moins
 * un demi-diamètre de carte de chaque côté + petite marge).
 */
function clampUnit(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return UNIT_FALLBACK;
  }
  if (width <= 0 || height <= 0) return UNIT_FALLBACK;
  const usableW = Math.max(0, width - LARGEST_CARD - SAFETY_MARGIN * 2);
  const usableH = Math.max(0, height - LARGEST_CARD - SAFETY_MARGIN * 2);
  const fitW = usableW / X_SPREAD;
  const fitH = usableH / Z_SPREAD;
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
