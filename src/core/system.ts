/** Built-in prompt plus the user's instructions (from Settings), or only those when "replace" is on and they are not empty. */
export function composeSystem(base: string, custom: { systemPrompt?: string; systemReplace?: boolean } = {}): string {
  const text = custom.systemPrompt?.trim()
  if (!text) return base
  return custom.systemReplace ? text : `${base}\n\n${text}`
}
