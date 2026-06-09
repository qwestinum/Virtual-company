import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SITE_ID,
  DonneurOrdreCreateSchema,
  SiteCreateSchema,
  SitePatchSchema,
} from '@/types/organisation';

describe('organisation — schémas & constantes', () => {
  it('DEFAULT_SITE_ID est le site par défaut seedé', () => {
    expect(DEFAULT_SITE_ID).toBe('SITE-DEFAULT');
  });

  describe('SiteCreateSchema', () => {
    it('exige un nom non vide', () => {
      expect(SiteCreateSchema.safeParse({ name: 'Siège Paris' }).success).toBe(true);
      expect(SiteCreateSchema.safeParse({ name: '' }).success).toBe(false);
      expect(SiteCreateSchema.safeParse({}).success).toBe(false);
    });
    it('accepte type / ville / code postal optionnels ou null', () => {
      expect(
        SiteCreateSchema.safeParse({
          name: 'X',
          type: null,
          city: null,
          postalCode: null,
        }).success,
      ).toBe(true);
      expect(SiteCreateSchema.safeParse({ name: 'X', city: 'Lyon' }).success).toBe(true);
    });
  });

  it('SitePatchSchema est entièrement optionnel', () => {
    expect(SitePatchSchema.safeParse({}).success).toBe(true);
    expect(SitePatchSchema.safeParse({ name: 'Renommé' }).success).toBe(true);
  });

  describe('DonneurOrdreCreateSchema', () => {
    it('exige lastName et valide l’email s’il est fourni', () => {
      expect(DonneurOrdreCreateSchema.safeParse({ lastName: 'Durand' }).success).toBe(true);
      expect(DonneurOrdreCreateSchema.safeParse({ lastName: '' }).success).toBe(false);
      expect(
        DonneurOrdreCreateSchema.safeParse({ lastName: 'D', email: 'pas-un-email' })
          .success,
      ).toBe(false);
      expect(
        DonneurOrdreCreateSchema.safeParse({
          lastName: 'Durand',
          firstName: 'Marie',
          email: 'marie@exemple.fr',
          role: 'DRH adjoint',
        }).success,
      ).toBe(true);
    });
  });
});
