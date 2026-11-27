import { describe, it, expect } from 'vitest';
import { translations, createTranslator } from '../index';

describe('i18n', () => {
  it('defines every key in both languages', () => {
    const en = Object.keys(translations.en).sort();
    const fr = Object.keys(translations.fr).sort();

    expect(fr).toEqual(en);
  });

  it('has no empty text', () => {
    for (const locale of ['en', 'fr'] as const) {
      for (const [key, text] of Object.entries(translations[locale])) {
        expect(text.trim(), `${locale}:${key}`).not.toBe('');
      }
    }
  });

  it('translates the messages for content the SDK does not handle', () => {
    const en = createTranslator('en');
    const fr = createTranslator('fr');

    expect(en('verification.unsupportedChecker', { type: 'HYPERCORE' })).toBe(
      'This verification type (HYPERCORE) is not supported in this SDK version.'
    );
    expect(fr('verification.unsupportedChecker', { type: 'HYPERCORE' })).toBe(
      "Ce type de vérification (HYPERCORE) n'est pas pris en charge dans cette version du SDK."
    );
    expect(en('stepContent.unsupportedStepType')).toBe(
      'This step type is not supported in this SDK version.'
    );
    expect(fr('stepContent.unsupportedStepType')).toBe(
      "Ce type d'étape n'est pas pris en charge dans cette version du SDK."
    );
    expect(fr('stepContent.certificateMessage')).toBe(
      'Vous êtes arrivé au bout de ce cours. Complétez cette étape pour le terminer.'
    );
  });

  it('names the two mint follow-up actions differently', () => {
    const en = createTranslator('en');
    const fr = createTranslator('fr');

    // Recording a confirmed mint is not the step verification
    expect(en('nft.retryRecord')).toBe('Record mint again');
    expect(fr('nft.retryRecord')).toBe('Enregistrer le mint à nouveau');
    for (const translate of [en, fr]) {
      expect(translate('nft.retryRecord')).not.toBe(translate('verification.verifyComplete'));
      expect(translate('nft.retryRecord').toLowerCase()).not.toMatch(/verif|vérif/);
    }
  });

  it('contains no em dash', () => {
    for (const locale of ['en', 'fr'] as const) {
      for (const text of Object.values(translations[locale])) {
        expect(text).not.toContain(String.fromCharCode(0x2014));
      }
    }
  });
});
