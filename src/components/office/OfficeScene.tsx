'use client';

import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useShallow } from 'zustand/react/shallow';

import { selectAgents, useAgentsStore } from '@/stores/agents-store';
import type { AgentContractData } from '@/types/agent';

import { AgentAvatar } from './AgentAvatar';
import { Desk } from './Desk';
import { Floor } from './Floor';
import { ManagerDesk } from './ManagerDesk';

const MANAGER_ID = 'agent.manager-rh';

function deskPosition(
  agent: AgentContractData,
): [number, number, number] {
  const [x, , z] = agent.avatar.position;
  const towardCenter = z > 0 ? -1 : 1;
  return [x, 0, z + towardCenter];
}

export function OfficeScene() {
  const agents = useAgentsStore(useShallow(selectAgents));
  const selectedAgentId = useAgentsStore((s) => s.selectedAgentId);
  const selectAgent = useAgentsStore((s) => s.selectAgent);

  return (
    <Canvas
      shadows={false}
      className="absolute inset-0"
      dpr={[1, 2]}
      gl={{ antialias: true }}
    >
      <color attach="background" args={['#e2e8f0']} />
      <fog attach="fog" args={['#e2e8f0', 22, 38]} />

      <PerspectiveCamera makeDefault position={[0, 7, 11]} fov={45} />
      <OrbitControls
        makeDefault
        enablePan={false}
        maxPolarAngle={Math.PI / 2.1}
        minDistance={6}
        maxDistance={20}
        target={[0, 0.5, 0]}
      />

      <ambientLight intensity={0.45} />
      <directionalLight position={[8, 12, 6]} intensity={1.1} />
      <directionalLight position={[-6, 8, -4]} intensity={0.35} />

      <Floor onPointerDown={() => selectAgent(null)} />

      {agents.map((agent) => {
        const isManager = agent.id === MANAGER_ID;
        return (
          <group key={agent.id}>
            {isManager ? (
              <ManagerDesk position={deskPosition(agent)} />
            ) : (
              <Desk position={deskPosition(agent)} />
            )}
            <AgentAvatar
              agent={agent}
              isManager={isManager}
              isSelected={selectedAgentId === agent.id}
              onSelect={selectAgent}
            />
          </group>
        );
      })}
    </Canvas>
  );
}
