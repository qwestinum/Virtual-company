'use client';

/**
 * « Comment publier mon agenda » — replié par défaut. Libellés des menus
 * Outlook tels qu'à la date de l'écran : ils bougent, la cartographie du
 * Manager et ce guide se mettent à jour ensemble.
 */

export function BusyCalendarGuide() {
  return (
    <details className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2 font-body text-[12.5px] text-stone-700">
      <summary className="cursor-pointer font-semibold text-stone-800">Comment publier mon agenda ?</summary>
      <div className="mt-2 flex flex-col gap-3">
        <div>
          <p className="font-semibold">Outlook.com (compte personnel)</p>
          <ol className="ml-4 list-decimal">
            <li>Outlook sur le web › Paramètres › Calendrier › Calendriers partagés.</li>
            <li>« Publier un calendrier » : choisis ton calendrier et « Peut voir quand je suis occupé ».</li>
            <li>Publier, puis copie le lien <strong>ICS</strong> (pas le lien HTML) et colle-le ci-dessous.</li>
          </ol>
        </div>
        <div>
          <p className="font-semibold">Microsoft 365 (compte professionnel)</p>
          <p>
            Même chemin dans Outlook sur le web. Si « Publier un calendrier » est absent ou grisé, la
            publication est désactivée par l’administrateur de ton organisation : c’est à lui qu’il faut
            la demander.
          </p>
        </div>
        <div>
          <p className="font-semibold">Google Agenda</p>
          <p>Pas encore pris en charge.</p>
        </div>
        <p className="text-stone-600">
          ORQA sait quand tu es pris, pas pourquoi : seuls les horaires occupés sont lus, jamais les
          titres, les participants ni les lieux. Ce lien donne accès à tes disponibilités — ne le partage
          pas ailleurs. Pour couper l’accès, retire-le ici <strong>et</strong> réinitialise la
          publication dans Outlook.
        </p>
      </div>
    </details>
  );
}
