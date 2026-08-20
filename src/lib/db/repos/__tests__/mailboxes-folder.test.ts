/**
 * Dossier IMAP relevé.
 *
 * Brancher une messagerie PERSONNELLE fait défiler tout son courrier devant le
 * poller. Constaté le 20/08/2026 : 107 pièces jointes sans rapport (plans
 * d'accès, procédures) accumulées dans la file de rejeu, et autant d'analyses
 * inutiles. Pointer un dossier dédié ne lui présente que ce qui le concerne.
 *
 * Le défaut à ne pas réintroduire est ailleurs : une saisie vide qui serait
 * prise pour un nom de dossier ferait échouer la relève de la boîte.
 */
import { describe, expect, it } from 'vitest';

import { mailboxFolder } from '@/lib/db/repos/mailboxes';

describe('mailboxFolder', () => {
  it('retient le dossier configuré', () => {
    expect(mailboxFolder({ folder: 'ORQA' })).toBe('ORQA');
  });

  it('retombe sur INBOX quand rien n’est configuré', () => {
    // Invariant de non-régression : aucune boîte existante ne change de
    // comportement du seul fait de la migration.
    expect(mailboxFolder({ folder: null })).toBe('INBOX');
    expect(mailboxFolder({})).toBe('INBOX');
    expect(mailboxFolder({ folder: undefined })).toBe('INBOX');
  });

  it('traite une saisie vide comme « non configuré », pas comme un dossier', () => {
    // Un champ effacé dans le formulaire arrive en chaîne vide : le prendre au
    // pied de la lettre ferait sélectionner un dossier nommé « rien », et la
    // relève échouerait sur toutes les boîtes ainsi éditées.
    expect(mailboxFolder({ folder: '' })).toBe('INBOX');
    expect(mailboxFolder({ folder: '   ' })).toBe('INBOX');
  });

  it('rogne les espaces d’un copier-coller', () => {
    expect(mailboxFolder({ folder: '  Candidatures  ' })).toBe('Candidatures');
  });

  it('respecte un chemin hiérarchique tel quel', () => {
    // Gmail expose ses libellés ainsi ; on ne réécrit ni la casse ni le
    // séparateur, seul le serveur sait ce qui est valide.
    expect(mailboxFolder({ folder: '[Gmail]/Tous les messages' })).toBe(
      '[Gmail]/Tous les messages',
    );
  });
});
