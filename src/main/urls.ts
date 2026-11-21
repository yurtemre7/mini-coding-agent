/** Only web links leave the app; everything else (file:, javascript:, custom schemes, mailto:) is dropped. */
export const isExternalUrl = (url: string): boolean => /^https?:\/\//i.test(url)
