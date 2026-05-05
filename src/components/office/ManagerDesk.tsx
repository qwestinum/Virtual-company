'use client';

type ManagerDeskProps = {
  position: [number, number, number];
};

export function ManagerDesk({ position }: ManagerDeskProps) {
  const [x, y, z] = position;
  const podiumHeight = 0.08;
  const topY = y + podiumHeight + 0.85;
  const legHalf = 1.0;
  const depthHalf = 0.45;

  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, podiumHeight / 2, 0]} receiveShadow>
        <cylinderGeometry args={[1.7, 1.7, podiumHeight, 32]} />
        <meshStandardMaterial color="#cbd5e1" roughness={0.85} />
      </mesh>

      <mesh position={[0, topY, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.2, 0.08, 1.0]} />
        <meshStandardMaterial color="#64748b" roughness={0.55} metalness={0.1} />
      </mesh>

      {[
        [-legHalf, -depthHalf],
        [legHalf, -depthHalf],
        [-legHalf, depthHalf],
        [legHalf, depthHalf],
      ].map(([lx, lz], i) => (
        <mesh
          key={i}
          position={[lx, podiumHeight + (topY - podiumHeight) / 2, lz]}
          castShadow
        >
          <boxGeometry args={[0.08, topY - podiumHeight, 0.08]} />
          <meshStandardMaterial color="#334155" roughness={0.5} />
        </mesh>
      ))}
    </group>
  );
}
