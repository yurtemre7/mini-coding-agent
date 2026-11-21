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
          {request.toolName} wants to run
        </AlertDialogTitle>
        <AlertDialogDescription>{request.reason ? `Needs approval: ${request.reason}.` : 'Do you want to proceed?'}</AlertDialogDescription>
      </AlertDialogHeader>
      <pre className="max-h-48 overflow-auto rounded-md border bg-muted p-3 font-mono text-xs whitespace-pre-wrap break-all">{(toolSubject(request.input) || JSON.stringify(request.input) || '').slice(0, 2000)}</pre>
      <Textarea placeholder="Optional: tell the model what to do instead (sent with No)" value={feedback} onChange={(e) => setFeedback(e.target.value)} />
      {request.suggestion && (
        <p className="text-xs text-muted-foreground">
          &quot;Yes, for this session&quot; allows: <code className="font-mono break-all">{request.suggestion}</code>
        </p>
      )}
      <AlertDialogFooter className="flex-wrap">
        <Button variant="outline" onClick={() => onDecision({ allow: false, ...(text && { feedback: text }) })}>
          No
        </Button>
        <Button variant="secondary" onClick={() => onDecision({ allow: true, scope: 'session' })} title={request.suggestion}>
          Yes, for this session
        </Button>
        <Button onClick={() => onDecision({ allow: true, scope: 'once' })}>Yes</Button>
      </AlertDialogFooter>
    </>
  )
}

/** Permission, trust and plan prompts. Not dismissable: every prompt needs an explicit answer. */
export function PromptDialog({ request, onDecision }: { request: PromptRequest | null; onDecision: (d: Decision) => void }) {
  return (
    <AlertDialog open={!!request}>
      <AlertDialogContent className="[&>*]:min-w-0" onEscapeKeyDown={(e) => e.preventDefault()}>
        {request?.kind === 'permission' && <PermissionBody key={JSON.stringify(request)} request={request} onDecision={onDecision} />}
        {request?.kind === 'trust' && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4" aria-hidden />
                Trust this workspace?
              </AlertDialogTitle>
              <AlertDialogDescription className="break-all">
                {request.workspace} defines {[request.rules?.length ? 'allow rules that run without asking' : '', request.hooks?.length ? 'hooks that run shell commands' : ''].filter(Boolean).join(' and ')}. Only trust projects you wrote or reviewed.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <pre className="max-h-48 overflow-auto rounded-md border bg-muted p-3 font-mono text-xs whitespace-pre-wrap break-all">{[...(request.rules ?? []), ...(request.hooks ?? [])].join('\n')}</pre>
            <AlertDialogFooter>
              <Button variant="outline" onClick={() => onDecision({ allow: false })}>
                Don&apos;t trust
              </Button>
              <Button onClick={() => onDecision({ allow: true })}>Trust workspace</Button>
            </AlertDialogFooter>
          </>
        )}
        {request?.kind === 'plan' && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <ShieldQuestion className="h-4 w-4" aria-hidden />
                Approve this plan?
              </AlertDialogTitle>
            </AlertDialogHeader>
            <pre className="max-h-72 overflow-auto rounded-md border bg-muted p-3 text-xs whitespace-pre-wrap break-words">{request.plan}</pre>
            <AlertDialogFooter>
              <Button variant="outline" onClick={() => onDecision({ allow: false })}>
                Reject
              </Button>
              <Button onClick={() => onDecision({ allow: true })}>Approve</Button>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  )
}
