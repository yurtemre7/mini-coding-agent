import { useEffect, useState } from 'react'
import { Terminal, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import type { AppInfo } from '../../shared/types'

export default function App() {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [statusMessage, setStatusMessage] = useState<string>('Ready')

  useEffect(() => {
    window.mca?.getAppInfo().then(setAppInfo).catch(() => {
      setStatusMessage('Running outside Electron IPC')
    })
  }, [])

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background p-8 text-foreground">
      <div
        className="fixed inset-x-0 top-0 h-10"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />
      <Card className="w-full max-w-lg shadow-sm">
        <CardHeader className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Terminal className="h-5 w-5 text-primary" />
              <CardTitle className="text-xl">mini-coding-agent</CardTitle>
            </div>
            <Badge variant="secondary">MCA</Badge>
          </div>
          <CardDescription>
            Electron + TypeScript + Tailwind CSS + shadcn/ui starter workspace
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2 rounded-md border bg-muted/40 p-3">
            <span className="text-muted-foreground">Platform</span>
            <span className="font-mono font-medium">
              {appInfo?.platform ?? 'darwin'}
            </span>
            <span className="text-muted-foreground">Version</span>
            <span className="font-mono font-medium">
              {appInfo?.version ?? '0.1.0'}
            </span>
            <span className="text-muted-foreground">Electron</span>
            <span className="font-mono font-medium">
              {appInfo?.electronVersion ?? 'dev'}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">Status: {statusMessage}</p>
        </CardContent>
        <CardFooter className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => setStatusMessage('Workspace initialized')}
          >
            Check Status
          </Button>
          <Button onClick={() => setStatusMessage('Agent ready')}>
            <Sparkles className="mr-2 h-4 w-4" />
            Start MCA
          </Button>
        </CardFooter>
      </Card>
    </main>
  )
}
