/**
 * The key is an item of the person's Keychain, always there. An unsigned build may not be recognised as the same app
 * after an update, and macOS then asks the person to let it use the item; refused, each account asks to sign in again.
 */
export const keyringProblem = (): string | undefined => undefined
