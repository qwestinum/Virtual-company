import { describe, expect, it } from 'vitest';

import { documentNatureNotice } from '@/lib/chat/document-nature-notice';

describe('documentNatureNotice', () => {
  it('appel d’offres → oriente vers Campagnes / Nouvelle campagne, n’analyse pas', () => {
    const msg = documentNatureNotice('appel_offres', 'AO-data-engineer.pdf');
    expect(msg).toContain('AO-data-engineer.pdf');
    expect(msg).toMatch(/ne ressemble pas à un CV/i);
    expect(msg).toContain('Campagnes');
    expect(msg).toContain('Nouvelle campagne');
    expect(msg).toMatch(/analyse/i);
  });

  it('illisible → invite à redéposer un PDF texte, n’a pas analysé', () => {
    const msg = documentNatureNotice('illisible', 'scan.pdf');
    expect(msg).toContain('scan.pdf');
    expect(msg).toMatch(/PDF texte|\.docx/i);
    expect(msg).toMatch(/analys/i);
  });

  it('autre → avertit que ce n’est pas un CV', () => {
    const msg = documentNatureNotice('autre', 'facture.pdf');
    expect(msg).toContain('facture.pdf');
    expect(msg).toMatch(/ne ressemble pas à un CV/i);
  });
});
