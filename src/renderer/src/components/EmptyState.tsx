import { FolderOpen, MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** Shown in the transcript area until the first message: tells a new user what to do next. */
export function EmptyState({ workspace, onOpenWorkspace }: { workspace: string | null; onOpenWorkspace: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {workspace ? <MessageSquare className="h-6 w-6" aria-hidden /> : <FolderOpen className="h-6 w-6" aria-hidden />}
      </div>
      {workspace ? (
        <>
          <h2 className="text-lg font-semibold">What should we work on?</h2>
          <p className="max-w-sm text-sm text-muted-foreground">Describe a change, ask a question about the code, or type / for commands. MCA asks before it edits files or runs commands.</p>
        </>
      ) : (
        <>
          <h2 className="text-lg font-semibold">Open a project to get started</h2>
          <p className="max-w-sm text-sm text-muted-foreground">Pick the folder MCA should work in. It can only read and change files inside it.</p>
          <Button onClick={onOpenWorkspace}>
            <FolderOpen className="mr-2 h-4 w-4" />
            Choose a folder
          </Button>
        </>
      )}
    </div>
  )
}
