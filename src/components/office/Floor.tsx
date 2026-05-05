'use client';

import { Grid } from '@react-three/drei';

type FloorProps = {
  onPointerDown?: () => void;
};

export function Floor({ onPointerDown }: FloorProps) {
  return (
    <group>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, 0]}
        receiveShadow
        onPointerDown={(event) => {
          event.stopPropagation();
          onPointerDown?.();
        }}
      >
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial color="#f1f5f9" roughness={0.95} />
      </mesh>

      <Grid
        args={[40, 40]}
        position={[0, 0.001, 0]}
        cellColor="#cbd5e1"
        sectionColor="#94a3b8"
        cellSize={1}
        cellThickness={0.6}
        sectionSize={5}
        sectionThickness={1}
        fadeDistance={28}
        fadeStrength={1.5}
        infiniteGrid
        followCamera={false}
      />
    </group>
  );
}
