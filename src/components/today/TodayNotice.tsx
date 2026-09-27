'use client';

/**
 * RANGÉE d'un point qui ne parle PAS d'un candidat : une situation, et ce
 * qu'il faut faire.
 *
 * Même rangée blanche que les autres — c'est le relief qui dit « une ligne,
 * une décision », pas la nature de ce qu'elle porte.
 *
 * ⚠️ `action` peut valoir `null`, et ce n'est pas un oubli. Un bouton qui mène
 * à un écran où rien n'est possible est pire que pas de bouton : il fait
 * perdre un aller-retour et laisse croire qu'on n'a pas su s'en servir.
 */

export function TodayNotice({
  text,
  action,
}: {
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border bg-white px-3 py-2"
      style={{ borderColor: 'var(--dash-border)' }}
    >
      <p
        className="font-body min-w-0 flex-1 basis-[18rem]"
        style={{ fontSize: 13, color: 'var(--dash-text)', lineHeight: 1.5 }}
      >
        {text}
      </p>
      {action ? <span className="shrink-0">{action}</span> : null}
    </div>
  );
}
