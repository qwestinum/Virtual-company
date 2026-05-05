'use client';

import { Capsule, Sphere } from '@react-three/drei';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useRef } from 'react';
import type { Group } from 'three';

import { getAvatarColor, getAvatarPhase } from './avatar-colors';
import type { AgentContractData } from '@/types/agent';

type AgentAvatarProps = {
  agent: AgentContractData;
  isSelected: boolean;
  isManager?: boolean;
  onSelect: (id: string) => void;
};

const BASE_BODY_Y = 1.05;
const BASE_HEAD_Y = 2.0;

export function AgentAvatar({
  agent,
  isSelected,
  isManager = false,
  onSelect,
}: AgentAvatarProps) {
  const groupRef = useRef<Group | null>(null);
  const phase = getAvatarPhase(agent.id);
  const color = getAvatarColor(agent.id);
  const scale = isManager ? 1.35 : 1;
  const opacity = agent.enabled ? 1 : 0.4;
  const transparent = !agent.enabled;
  const isActive = agent.status === 'active';

  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group) return;
    const t = clock.elapsedTime;
    const amplitude = isActive ? 0.08 : 0.04;
    const speed = isActive ? 2.4 : 1.2;
    group.position.y = Math.sin(t * speed + phase) * amplitude;
    if (isActive) {
      group.rotation.y = Math.sin(t * 1.6 + phase) * 0.25;
    } else {
      group.rotation.y = 0;
    }
  });

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onSelect(agent.id);
  };

  return (
    <group
      position={agent.avatar.position}
      scale={scale}
      onPointerDown={handleClick}
    >
      <group ref={groupRef}>
        <Capsule args={[0.35, 0.9, 4, 8]} position={[0, BASE_BODY_Y, 0]} castShadow>
          <meshStandardMaterial
            color={color}
            roughness={0.6}
            metalness={0.05}
            transparent={transparent}
            opacity={opacity}
          />
        </Capsule>

        <Sphere args={[0.3, 16, 16]} position={[0, BASE_HEAD_Y, 0]} castShadow>
          <meshStandardMaterial
            color="#f5deb3"
            roughness={0.7}
            transparent={transparent}
            opacity={opacity}
          />
        </Sphere>

        {isActive ? (
          <Sphere args={[0.45, 16, 16]} position={[0, BASE_HEAD_Y, 0]}>
            <meshBasicMaterial color={color} transparent opacity={0.18} />
          </Sphere>
        ) : null}
      </group>

      {isSelected ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <ringGeometry args={[0.7, 0.85, 32]} />
          <meshBasicMaterial color="#06b6d4" transparent opacity={0.9} />
        </mesh>
      ) : null}
    </group>
  );
}
