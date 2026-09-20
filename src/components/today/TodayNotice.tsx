'use client';

/**
 * Ligne d'une carte qui ne parle PAS d'un candidat : une situation, et ce
 * qu'il faut faire.
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
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--dash-border)] py-2.5 last:border-b-0"
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
