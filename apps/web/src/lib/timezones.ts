/** Every IANA timezone the browser knows (the API validates the choice again). Browser's own first. */
export function timezoneOptions(): { list: string[]; local: string } {
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  let all: string[] = [];
  try {
    all = (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone');
  } catch {
    all = [];
  }
  const list = Array.from(new Set([local, 'UTC', ...all]));
  return { list, local };
}
