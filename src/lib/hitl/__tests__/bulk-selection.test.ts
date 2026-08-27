/**
 * Sélection multiple du refus groupé, sous filtre.
 *
 * Enjeu : une fournée de refus part sur ce que la sélection désigne. Une
 * sélection qui survit à un changement de filtre, ou qui déborde de ce que
 * l'écran montre, serait un envoi que personne n'a relu.
 */

import { describe, expect, it } from 'vitest';

import {
  emptySelection,
  isAllSelected,
  selectedAmong,
  setAllSelected,
  syncSelectionToFilter,
  toggleSelection,
} from '@/lib/hitl/bulk-selection';

const item = (id: string) => ({ id });
const SARAH_KEY = 'recruiter:u-sarah';
const MARC_KEY = 'recruiter:u-marc';

describe('syncSelectionToFilter', () => {
  it('VIDE la sélection dès que le filtre change', () => {
    let sel = emptySelection(SARAH_KEY);
    sel = toggleSelection(sel, 'val-1');
    sel = toggleSelection(sel, 'val-2');
    expect(sel.ids.size).toBe(2);

    const after = syncSelectionToFilter(sel, MARC_KEY);
    expect(after.ids.size).toBe(0);
    expect(after.filterKey).toBe(MARC_KEY);
  });

  it('conserve la sélection à l’IDENTIQUE tant que le filtre ne bouge pas', () => {
    const sel = toggleSelection(emptySelection(SARAH_KEY), 'val-1');
    // Identité stable : l'appelant compare par référence pour ne pas
    // re-rendre inutilement (et pour ne pas boucler à l'infini au rendu).
    expect(syncSelectionToFilter(sel, SARAH_KEY)).toBe(sel);
  });

  it('GÈLE la sélection pendant une fournée en vol, la recale au dégel', () => {
    let sel = toggleSelection(emptySelection(SARAH_KEY), 'val-1');
    // Le filtre bouge alors que le refus groupé s'exécute : la liste
    // nominative affichée ne doit pas se vider sous les yeux de l'opérateur.
    sel = syncSelectionToFilter(sel, MARC_KEY, true);
    expect(sel.ids.has('val-1')).toBe(true);
    expect(sel.filterKey).toBe(SARAH_KEY);
    // Fournée terminée : la sélection se recale sur le filtre courant.
    expect(syncSelectionToFilter(sel, MARC_KEY, false).ids.size).toBe(0);
  });

  it('vide aussi au retour à « Tous »', () => {
    const sel = toggleSelection(emptySelection(SARAH_KEY), 'val-1');
    expect(syncSelectionToFilter(sel, 'all').ids.size).toBe(0);
  });
});

describe('selectedAmong', () => {
  it('ne rend QUE des dossiers visibles — jamais une sélection fantôme', () => {
    // val-9 a été cochée sous un autre filtre : elle n'est plus affichée.
    let sel = emptySelection(SARAH_KEY);
    sel = toggleSelection(sel, 'val-1');
    sel = toggleSelection(sel, 'val-9');
    const visible = [item('val-1'), item('val-2')];
    expect(selectedAmong(visible, sel).map((v) => v.id)).toEqual(['val-1']);
  });

  it('rend la liste vide quand plus rien de sélectionné n’est visible', () => {
    const sel = toggleSelection(emptySelection(SARAH_KEY), 'val-9');
    expect(selectedAmong([item('val-1')], sel)).toEqual([]);
  });

  it('préserve l’ordre d’AFFICHAGE (score décroissant), pas l’ordre de clic', () => {
    let sel = emptySelection(SARAH_KEY);
    sel = toggleSelection(sel, 'val-3');
    sel = toggleSelection(sel, 'val-1');
    const visible = [item('val-1'), item('val-2'), item('val-3')];
    expect(selectedAmong(visible, sel).map((v) => v.id)).toEqual([
      'val-1',
      'val-3',
    ]);
  });
});

describe('toggleSelection', () => {
  it('coche puis décoche, sans muter l’état précédent', () => {
    const empty = emptySelection(SARAH_KEY);
    const one = toggleSelection(empty, 'val-1');
    const none = toggleSelection(one, 'val-1');
    expect(empty.ids.size).toBe(0);
    expect(one.ids.has('val-1')).toBe(true);
    expect(none.ids.has('val-1')).toBe(false);
  });

  it('conserve la clé de filtre courante', () => {
    expect(toggleSelection(emptySelection(MARC_KEY), 'val-1').filterKey).toBe(
      MARC_KEY,
    );
  });
});

describe('setAllSelected / isAllSelected', () => {
  it('« tout sélectionner » se borne aux dossiers VISIBLES', () => {
    const visible = [item('val-1'), item('val-2')];
    const sel = setAllSelected(
      emptySelection(SARAH_KEY),
      visible.map((v) => v.id),
      true,
    );
    expect([...sel.ids].sort()).toEqual(['val-1', 'val-2']);
    expect(isAllSelected(visible, sel)).toBe(true);
  });

  it('« tout désélectionner » repart à zéro', () => {
    const visible = [item('val-1')];
    const all = setAllSelected(emptySelection(SARAH_KEY), ['val-1'], true);
    expect(setAllSelected(all, ['val-1'], false).ids.size).toBe(0);
    expect(isAllSelected(visible, emptySelection(SARAH_KEY))).toBe(false);
  });

  it('une liste visible VIDE n’est jamais « tout sélectionné »', () => {
    expect(isAllSelected([], emptySelection(SARAH_KEY))).toBe(false);
  });

  it('scénario complet : tout cocher sous un filtre, puis changer de filtre', () => {
    const sarahItems = [item('val-1'), item('val-2')];
    let sel = setAllSelected(
      emptySelection(SARAH_KEY),
      sarahItems.map((v) => v.id),
      true,
    );
    expect(selectedAmong(sarahItems, sel)).toHaveLength(2);

    // Bascule sur Marc : d'autres dossiers, ardoise propre.
    const marcItems = [item('val-3')];
    sel = syncSelectionToFilter(sel, MARC_KEY);
    expect(selectedAmong(marcItems, sel)).toEqual([]);
    expect(isAllSelected(marcItems, sel)).toBe(false);
  });
});
