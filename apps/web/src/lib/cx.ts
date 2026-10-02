/** Joins class names, skipping falsy values. Safe to call from server and client components. */
export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}
