export interface NotifierDeps {
  /** Show a desktop notification; only called while the app is not the focused window. */
  desktop(title: string, body: string): void
  focused(): boolean
}

/** Desktop notification while the window is in the background. A missing notification service never throws. */
export function createNotifier(d: NotifierDeps): (message: string) => void {
  return (message) => {
    try {
      if (!d.focused()) d.desktop('MCA', message)
    } catch {
      // not worth surfacing
    }
  }
}
