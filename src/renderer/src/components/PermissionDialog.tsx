import { useState } from 'react'
import type { Decision, PermissionRequest, PromptRequest } from '../../../shared/types'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

const subject = (input: any): string => String(input?.command ?? input?.file_path ?? input?.pattern ?? input?.url ?? input?.path ?? JSON.stringify(input) ?? '')

function PermissionBody({ request, onDecision }: { request: PermissionRequest; onDecision: (d: Decision) => void }) {
  const [feedback, setFeedback] = useState('')
  const text = feedback.trim()
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>{request.toolName} wants to run</AlertDialogTitle>
        <AlertDialogDescription>{request.reason ? `Needs approval: ${request.reason}.` : 'Do you want to proceed?'}</AlertDialogDescription>
      </AlertDialogHeader>
      <pre className="max-h-48 overflow-auto rounded-md border bg-muted p-3 font-mono text-xs whitespace-pre-wrap">{subject(request.input).slice(0, 2000)}</pre>
      <Textarea placeholder="Optional: tell the model what to do instead (sent with No)" value={feedback} onChange={(e) => setFeedback(e.target.value)} />
      <AlertDialogFooter>
        <Button variant="outline" onClick={() => onDecision({ allow: false, ...(text && { feedback: text }) })}>
          No
        </Button>
        <Button variant="secondary" onClick={() => onDecision({ allow: true, scope: 'session' })} title={request.suggestion}>
          Yes, for this session{request.suggestion ? ` (${request.suggestion})` : ''}
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
      <AlertDialogContent onEscapeKeyDown={(e) => e.preventDefault()}>
        {request?.kind === 'permission' && <PermissionBody key={JSON.stringify(request)} request={request} onDecision={onDecision} />}
        {request?.kind === 'trust' && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>Trust this workspace?</AlertDialogTitle>
              <AlertDialogDescription>
                {request.workspace} defines allow rules that run without asking. Only trust projects you wrote or reviewed.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <pre className="max-h-48 overflow-auto rounded-md border bg-muted p-3 font-mono text-xs">{(request.rules ?? []).join('\n')}</pre>
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
              <AlertDialogTitle>Approve this plan?</AlertDialogTitle>
            </AlertDialogHeader>
            <pre className="max-h-72 overflow-auto rounded-md border bg-muted p-3 text-xs whitespace-pre-wrap">{request.plan}</pre>
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
