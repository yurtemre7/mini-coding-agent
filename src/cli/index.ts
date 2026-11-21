import { parseArgs } from 'node:util'
import pkg from '../../package.json'
import { getKey, type ProviderId } from '../core/credentials'
import { DEFAULT_MODELS } from '../core/provider/models'
import { PROVIDER_IDS, providerFromCredentials } from '../core/provider/factory'
import { MODES, parseMode, splitRules } from '../core/permissions'
import { EFFORT_LEVELS, parseEffort } from '../shared/types'
import { runHeadless } from './headless'
import { runInteractive } from './ui'

const USAGE = `Usage: mca [options]            Interactive session
       mca -p "<prompt>" [options]

Options:
  -p, --print            Run one prompt non-interactively; answer on stdout, tool activity on stderr
      --provider <id>    anthropic | openrouter (default: first one with a key)
      --model <id>       Model id (default: the provider's main model)
      --effort <level>   low | medium | high | xhigh | max (default: medium)
      --permission-mode <mode>
                         default | acceptEdits | plan | bypassPermissions
      --allowed-tools <rules>
                         Rules that run without asking, e.g. "Bash(npm run test:*) Edit"
      --continue         Resume the most recent saved session for this directory
      --resume <id>      Resume a saved session by id
      --trust            Apply this workspace's project allow rules (headless is untrusted by default)
  -h, --help             Show this help
  -v, --version          Print the version

Piped stdin is appended to the prompt. Exit codes: 0 ok, 1 runtime error, 2 usage or missing key.`

const fail = (msg: string): never => {
  console.error(`${msg}\n\n${USAGE}`)
  process.exit(2)
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return ''
  let s = ''
  for await (const chunk of process.stdin) s += chunk
  return s
}

async function main(): Promise<void> {
  let parsed
  try {
    parsed = parseArgs({
      args: process.argv.slice(2),
      options: {
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
        print: { type: 'boolean', short: 'p' },
        provider: { type: 'string' },
        model: { type: 'string' },
        effort: { type: 'string' },
        'permission-mode': { type: 'string' },
        'allowed-tools': { type: 'string', multiple: true },
        trust: { type: 'boolean' },
        continue: { type: 'boolean' },
        resume: { type: 'string' }
      },
      allowPositionals: true,
      strict: true
    })
  } catch (error) {
    return fail((error as Error).message)
  }
  const { values, positionals } = parsed
  if (values.version) return console.log(pkg.version)
  if (values.help) return console.log(USAGE)

  const effort = parseEffort(values.effort)
  if (!effort) return fail(`Unknown effort "${values.effort}". Use ${EFFORT_LEVELS.join(', ')}.`)
  const modeArg = values['permission-mode']
  const permissionMode = modeArg === undefined ? undefined : parseMode(modeArg)
  if (modeArg !== undefined && !permissionMode) return fail(`Unknown permission mode "${modeArg}". Use ${MODES.join(', ')}.`)
  if (values.continue && values.resume !== undefined) return fail('Use either --continue or --resume <id>, not both.')
  const allowedTools = splitRules(values['allowed-tools'] ?? [])

  let prompt = ''
  if (values.print) {
    prompt = [positionals.join(' '), await readStdin()].filter((s) => s.trim()).join('\n\n')
    if (!prompt) return fail('No prompt given.')
  } else if (!process.stdin.isTTY) return fail('Interactive mode needs a terminal. Use -p "<prompt>" for non-interactive runs.')

  let id = values.provider as ProviderId | undefined
  if (id && !PROVIDER_IDS.includes(id)) return fail(`Unknown provider "${id}". Use anthropic or openrouter.`)
  if (!id) {
    for (const p of PROVIDER_IDS) if (!id && (await getKey(p))) id = p
    id ??= 'anthropic'
  }
  let provider
  try {
    provider = await providerFromCredentials(id)
  } catch (e) {
    return fail((e as Error).message)
  }

  const model = values.model ?? DEFAULT_MODELS[id].main
  if (!values.print) return runInteractive({ provider, model, effort, cwd: process.cwd(), mode: permissionMode, allowedTools, trust: values.trust, continue: values.continue, resume: values.resume })

  const code = await runHeadless({
    prompt,
    provider,
    model,
    effort,
    cwd: process.cwd(),
    permissionMode,
    allowedTools,
    trust: values.trust,
    continue: values.continue,
    resume: values.resume,
    io: { out: (s) => void process.stdout.write(s), err: (s) => void process.stderr.write(s) }
  })
  process.exitCode = code
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
