import { useState } from 'react'
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


function PermissionBody({ request, onDecision }: { request: PermissionRequest; onDecision: (d: Decision) => void }) {
  const [feedback, setFeedback] = useState('')
  const text = feedback.trim()
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle className="flex items-center gap-2">
          <ShieldQuestion className="h-4 w-4" aria-hidden />
          Allow {request.toolName}?
        </AlertDialogTitle>
        <AlertDialogDescription className="[overflow-wrap:anywhere]">{request.reason ? `Needs approval: ${request.reason}.` : 'Do you want to proceed?'}</AlertDialogDescription>
      </AlertDialogHeader>
      <pre data-testid="subject" className="max-h-48 overflow-auto rounded-md border bg-muted p-3 font-mono text-xs whitespace-pre-wrap break-all">{(toolSubject(request.input) || JSON.stringify(request.input) || '').slice(0, 2000)}</pre>
      <Textarea placeholder="Optional: tell the model what to do instead (sent with Deny)" value={feedback} onChange={(e) => setFeedback(e.target.value)} />
      {request.suggestion && (
        <p className="text-xs text-muted-foreground">
          &quot;Allow for this session&quot; allows: <code data-testid="suggestion" className="block max-h-20 overflow-auto font-mono break-all">{request.suggestion.length > 300 ? `${request.suggestion.slice(0, 300)}…` : request.suggestion}</code>
        </p>
      )}
      <AlertDialogFooter className="flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button variant="outline" onClick={() => onDecision({ allow: false, ...(text && { feedback: text }) })}>
          Deny
        </Button>
        <Button variant="secondary" onClick={() => onDecision({ allow: true, scope: 'session' })} title={request.suggestion}>
          Allow for this session
        </Button>
        <Button onClick={() => onDecision({ allow: true, scope: 'once' })}>Allow once</Button>
      </AlertDialogFooter>
    </>
  )
}

function PlanBody({ plan, onDecision }: { plan: string; onDecision: (d: Decision) => void }) {
  const [feedback, setFeedback] = useState('')
  const text = feedback.trim()
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
        <Button variant="outline" onClick={() => onDecision({ allow: false, ...(text && { feedback: text }) })}>
          Reject plan
        </Button>
        <Button onClick={() => onDecision({ allow: true })}>Approve plan</Button>
      </AlertDialogFooter>
    </>
  )
}

/** Permission, trust and plan prompts. Not dismissable: every prompt needs an explicit answer. */
export function PromptDialog({ request, onDecision }: { request: PromptRequest | null; onDecision: (d: Decision) => void }) {
  return (
    <AlertDialog open={!!request}>
      <AlertDialogContent className="max-h-[90vh] overflow-y-auto [&>*]:min-w-0" onEscapeKeyDown={(e) => e.preventDefault()}>
        {request?.kind === 'permission' && <PermissionBody key={JSON.stringify(request)} request={request} onDecision={onDecision} />}
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
              </Button>
              <Button onClick={() => onDecision({ allow: true })}>Trust workspace</Button>
            </AlertDialogFooter>
          </>
        )}
        {request?.kind === 'plan' && <PlanBody key={request.plan} plan={request.plan} onDecision={onDecision} />}
      </AlertDialogContent>
    </AlertDialog>
  )
}
