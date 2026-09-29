import type { MessageKey } from './i18n';

/** The fragment parser's messages are internal diagnostics, not reader copy. */
const fragmentErrorKeys: Record<string, MessageKey> = {
  'This reader link has an invalid PDF source fragment.': 'reader.fragment.invalid',
  'This reader link needs an HTTPS PDF URL.': 'reader.fragment.missingPdf',
  'This reader link needs a complete HTTPS PDF URL.': 'reader.fragment.incompleteUrl',
  'This reader link accepts only HTTPS PDF URLs without embedded credentials.': 'reader.fragment.httpsOnly',
  'This reader link has an invalid page number.': 'reader.fragment.invalidPage',
};

export function readerFragmentErrorKey(diagnostic: string): MessageKey {
  return fragmentErrorKeys[diagnostic] ?? 'reader.fragment.invalid';
}

/** Never render provider/model parser exception text (which may include input). */
export function readerModelErrorKey(error: unknown, subject: 'translation' | 'overview'): MessageKey {
  if (error instanceof Error && (
    error.message.startsWith('The model response ') || error.message.startsWith('A model source alias ')
  )) return subject === 'translation' ? 'reader.error.translationInvalidOutput' : 'reader.error.overviewInvalidOutput';
  return subject === 'translation' ? 'reader.error.translationFailed' : 'reader.error.overviewFailed';
}
