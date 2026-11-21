import { isExternalUrl } from './urls'

export interface NotifierDeps {
  /** Show a desktop notification; only called while the app is not the focused window. */
  desktop(title: string, body: string): void
  focused(): boolean
  /** Opt-in push endpoint (for example an ntfy.sh topic URL). Only the short generic message is sent: never code, paths or prompts. */
  url?: string
  fetch?: typeof fetch
}

/** Desktop notification when the window is in the background, plus an optional POST to the user's own push URL (phone). Failures never throw. */
export function createNotifier(d: NotifierDeps): (message: string) => void {
  const endpoint = d.url && isExternalUrl(d.url) ? d.url : undefined
  const doFetch = d.fetch ?? globalThis.fetch
  return (message) => {
    try {
      if (!d.focused()) d.desktop('MCA', message)
    } catch {
      // a missing notification service is not an error worth surfacing
    }
    if (endpoint) void doFetch(endpoint, { method: 'POST', body: message, headers: { Title: 'MCA' }, signal: AbortSignal.timeout(10_000) }).catch(() => {})
  }
}
