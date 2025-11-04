export function idFromString(name: string): string {
  // Replace any invalid run with '-'
  let cleaned = name.replace(/[^A-Za-z0-9_-]+/g, '-');
  // Trim to max length and remove leading/trailing hyphens produced by cleaning
  return cleaned.replace(/^-+|-+$/g, '').slice(0, 64);
}