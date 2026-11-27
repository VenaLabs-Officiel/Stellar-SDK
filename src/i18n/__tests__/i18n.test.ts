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

  it('contains no em dash', () => {
    for (const locale of ['en', 'fr'] as const) {
      for (const text of Object.values(translations[locale])) {
        expect(text).not.toContain('—');
      }
    }
  });
});
