'use client';

/**
 * Background commun « atelier » (Session 7).
 *
 * Replique l'arrière-plan utilisé sur la vue agents :
 *   - radial-gradient warm light en base (stone/sand),
 *   - trois blobs floutés animés (amber / yellow / slate),
 *   - overlay de dots subtils pour le repère « papier millimétré ».
 *
 * Le composant occupe la totalité de son parent en position fixed via
 * `inset-0` ; ses enfants directs (le contenu de la page) doivent
 * avoir un `position: relative` ou un z-index > 0 pour passer
 * au-dessus.
 */

export function WorkspaceBackground() {
  return (
    <div
      aria-hidden
      className="fixed inset-0 -z-10 overflow-hidden pointer-events-none"
      style={{
        background:
          'radial-gradient(ellipse at top, #fdfcf9 0%, #f3f1ec 70%, #ebe8e1 100%)',
      }}
    >
      <div
        className="bg-blob bg-blob-1"
        style={{
          width: 520,
          height: 520,
          top: '6%',
          left: '4%',
          backgroundColor: '#fde68a',
          opacity: 0.5,
        }}
      />
      <div
        className="bg-blob bg-blob-2"
        style={{
          width: 420,
          height: 420,
          bottom: '8%',
          right: '6%',
          backgroundColor: '#fde047',
          opacity: 0.35,
        }}
      />
      <div
        className="bg-blob bg-blob-3"
        style={{
          width: 480,
          height: 480,
          top: '38%',
          right: '28%',
          backgroundColor: '#cbd5e1',
          opacity: 0.4,
        }}
      />
      <div className="absolute inset-0 bg-grid-dots" />
    </div>
  );
}
