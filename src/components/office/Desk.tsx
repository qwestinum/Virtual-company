'use client';

type DeskProps = {
  position: [number, number, number];
};

export function Desk({ position }: DeskProps) {
  const [x, y, z] = position;
  const topY = y + 0.7;
  const legHalf = 0.65;
  const depthHalf = 0.3;

  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, topY, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.4, 0.06, 0.7]} />
        <meshStandardMaterial color="#94a3b8" roughness={0.7} />
      </mesh>

      {[
        [-legHalf, -depthHalf],
        [legHalf, -depthHalf],
        [-legHalf, depthHalf],
        [legHalf, depthHalf],
      ].map(([lx, lz], i) => (
        <mesh key={i} position={[lx, topY / 2, lz]} castShadow>
          <boxGeometry args={[0.06, topY, 0.06]} />
          <meshStandardMaterial color="#475569" roughness={0.6} />
        </mesh>
      ))}
    </group>
  );
}
