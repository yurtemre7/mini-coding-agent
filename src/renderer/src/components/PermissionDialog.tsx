import { useEffect, useState } from 'react'
import { ShieldAlert, ShieldQuestion } from 'lucide-react'
import type { Decision, PermissionRequest, PromptRequest } from '../../../shared/types'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { toolSubject } from '../../../shared/guards'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { comboOf, DEFAULT_KEYS, formatCombo, type KeyMap } from '@/lib/keybindings'

/** Runs the handler of the combo that was pressed; the dialog is modal, so a window listener is enough. Omitted handlers leave their combo unbound. */
function useDialogKeys(handlers: Record<string, (() => void) | undefined>) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.repeat) return
      const combo = comboOf(e)
      const run = combo ? handlers[combo] : undefined
      if (!run) return
      e.preventDefault()
      run()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })
}

const Kbd = ({ combo }: { combo: string }) => <kbd aria-hidden className="ml-2 rounded border bg-background/40 px-1 font-sans text-[10px] font-normal opacity-80">{formatCombo(combo)}</kbd>


function PermissionBody({ request, keys, onDecision }: { request: PermissionRequest; keys: KeyMap; onDecision: (d: Decision) => void }) {
  const [feedback, setFeedback] = useState('')
  const text = feedback.trim()
  const deny = () => onDecision({ allow: false, ...(text && { feedback: text }) })
  // a dangerous command has no allow shortcut: it must be clicked, every time
  useDialogKeys({
    [keys.permDeny]: deny,
    ...(!request.danger && { [keys.permAllowSession]: request.suggestion ? () => onDecision({ allow: true, scope: 'session' }) : undefined, [keys.permAllowOnce]: () => onDecision({ allow: true, scope: 'once' }) })
  })
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle className="flex items-center gap-2">
          {request.danger ? <ShieldAlert className="h-4 w-4 text-destructive" aria-hidden /> : <ShieldQuestion className="h-4 w-4" aria-hidden />}
          {request.danger ? 'Dangerous command' : `Allow ${request.toolName}?`}
        </AlertDialogTitle>
        <AlertDialogDescription className="[overflow-wrap:anywhere]">{request.reason ? `Needs approval: ${request.reason}.` : 'Do you want to proceed?'}</AlertDialogDescription>
      </AlertDialogHeader>
      {request.danger && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          This can cause damage that cannot be undone. Check the command carefully. It is asked every time and is never remembered.
        </p>
      )}
      <pre data-testid="subject" className="max-h-48 overflow-auto rounded-md border bg-muted p-3 font-mono text-xs whitespace-pre-wrap break-all">{(toolSubject(request.input) || JSON.stringify(request.input) || '').slice(0, 2000)}</pre>
      <Textarea placeholder="Optional: tell the model what to do instead (sent with Deny)" value={feedback} onChange={(e) => setFeedback(e.target.value)} />
      {request.suggestion && (
        <p className="text-xs text-muted-foreground">
          &quot;Allow for this session&quot; allows: <code data-testid="suggestion" className="block max-h-20 overflow-auto font-mono break-all">{request.suggestion.length > 300 ? `${request.suggestion.slice(0, 300)}…` : request.suggestion}</code>
        </p>
      )}
      <AlertDialogFooter className="flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button variant="outline" onClick={deny}>
          Deny
          <Kbd combo={keys.permDeny} />
        </Button>
        {!request.danger && (
          <Button variant="secondary" onClick={() => onDecision({ allow: true, scope: 'session' })} title={request.suggestion}>
            Allow for this session
            {request.suggestion && <Kbd combo={keys.permAllowSession} />}
          </Button>
        )}
        <Button variant={request.danger ? 'destructive' : 'default'} onClick={() => onDecision({ allow: true, scope: 'once' })}>
          {request.danger ? 'Run anyway' : 'Allow once'}
          {!request.danger && <Kbd combo={keys.permAllowOnce} />}
        </Button>
      </AlertDialogFooter>
    </>
  )
}

function PlanBody({ plan, keys, onDecision }: { plan: string; keys: KeyMap; onDecision: (d: Decision) => void }) {
  const [feedback, setFeedback] = useState('')
  const text = feedback.trim()
  const reject = () => onDecision({ allow: false, ...(text && { feedback: text }) })
  useDialogKeys({ [keys.planReject]: reject, [keys.planApprove]: () => onDecision({ allow: true }) })
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle className="flex items-center gap-2">
          <ShieldQuestion className="h-4 w-4" aria-hidden />
          Approve this plan?
        </AlertDialogTitle>
        <AlertDialogDescription>Approving leaves plan mode so the agent can make changes.</AlertDialogDescription>
      </AlertDialogHeader>
      <pre className="max-h-72 overflow-auto rounded-md border bg-muted p-3 text-xs whitespace-pre-wrap break-words">{plan}</pre>
      <Textarea placeholder="Optional: what should change in the plan (sent with Reject)" value={feedback} onChange={(e) => setFeedback(e.target.value)} />
      <AlertDialogFooter>
        <Button variant="outline" onClick={reject}>
          Reject plan
          <Kbd combo={keys.planReject} />
        </Button>
        <Button onClick={() => onDecision({ allow: true })}>
          Approve plan
          <Kbd combo={keys.planApprove} />
        </Button>
      </AlertDialogFooter>
    </>
  )
}

/** Permission, trust and plan prompts. Not dismissable: every prompt needs an explicit answer. */
export function PromptDialog({ request, onDecision, keys = DEFAULT_KEYS }: { request: PromptRequest | null; onDecision: (d: Decision) => void; keys?: KeyMap }) {
  // trusting a workspace is never bound to a key; declining is
  useDialogKeys({ [keys.permDeny]: request?.kind === 'trust' ? () => onDecision({ allow: false }) : undefined })
  return (
    <AlertDialog open={!!request}>
      <AlertDialogContent className="max-h-[90vh] overflow-y-auto [&>*]:min-w-0" onEscapeKeyDown={(e) => e.preventDefault()}>
        {request?.kind === 'permission' && <PermissionBody key={JSON.stringify(request)} request={request} keys={keys} onDecision={onDecision} />}
        {request?.kind === 'trust' && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4" aria-hidden />
                Trust this workspace?
              </AlertDialogTitle>
              <AlertDialogDescription className="break-all">
                {request.workspace} defines {[request.rules?.length ? 'allow rules that run without asking' : '', request.hooks?.length ? 'hooks that run shell commands' : '', request.mcp?.length ? 'MCP servers that would be started' : ''].filter(Boolean).join(' and ')}. Only trust projects you wrote or reviewed.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <pre data-testid="subject" className="max-h-48 overflow-auto rounded-md border bg-muted p-3 font-mono text-xs whitespace-pre-wrap break-all">{[...(request.rules ?? []), ...(request.hooks ?? []), ...(request.mcp ?? [])].join('\n')}</pre>
            <AlertDialogFooter>
              <Button variant="outline" onClick={() => onDecision({ allow: false })}>
                Don&apos;t trust
                <Kbd combo={keys.permDeny} />
              </Button>
              <Button onClick={() => onDecision({ allow: true })}>Trust workspace</Button>
            </AlertDialogFooter>
          </>
        )}
        {request?.kind === 'plan' && <PlanBody key={request.plan} plan={request.plan} keys={keys} onDecision={onDecision} />}
      </AlertDialogContent>
    </AlertDialog>
  )
}
