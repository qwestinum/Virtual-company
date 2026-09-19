'use client';

/**
 * Cadre d'une zone de saisie du bloc de décision. Deux zones, deux teintes,
 * pour qu'on ne confonde jamais ce qui S'EST PASSÉ (le compte rendu, bleu) et
 * POURQUOI on décide (le commentaire, ambre) : liseré de couleur à gauche,
 * fond teinté, titre en gras précédé de son numéro d'étape.
 */

const TONES = {
  report: {
    frame: 'border-sky-200 border-l-sky-500 bg-sky-50/70',
    badge: 'bg-sky-600 text-white',
    title: 'text-sky-950',
  },
  comment: {
    frame: 'border-amber-200 border-l-amber-500 bg-amber-50/70',
    badge: 'bg-amber-600 text-white',
    title: 'text-amber-950',
  },
} as const;

export function ZoneCard({
  tone,
  step,
  title,
  titleFor,
  hint,
  children,
}: {
  tone: keyof typeof TONES;
  /** Numéro affiché dans la pastille (ordre de lecture du bloc). */
  step?: number;
  title: string;
  /** Rattache le titre à un champ (`<label htmlFor>`). */
  titleFor?: string;
  /** Phrase d'aide sous le titre. */
  hint?: string;
  children: React.ReactNode;
}) {
  const t = TONES[tone];
  const Title = titleFor ? 'label' : 'h4';
  return (
    <section className={`flex flex-col gap-2 rounded-xl border border-l-4 p-3 ${t.frame}`}>
      <div className="flex items-baseline gap-2">
        {step !== undefined ? (
          <span
            aria-hidden
            className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-display text-[11px] font-bold ${t.badge}`}
          >
            {step}
          </span>
        ) : null}
        <Title
          {...(titleFor ? { htmlFor: titleFor } : {})}
          className={`font-display text-[14px] font-bold ${t.title}`}
        >
          {title}
        </Title>
        <span className="font-body text-[12px] text-stone-500">(facultatif)</span>
      </div>
      {hint ? <p className="font-body text-[12px] text-stone-600">{hint}</p> : null}
      {children}
    </section>
  );
}
