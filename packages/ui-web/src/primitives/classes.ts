/** Join the class names that apply. A condition that is false leaves its name out. */
export function classes(...names: (string | false | undefined)[]): string {
  return names.filter(Boolean).join(' ')
}
