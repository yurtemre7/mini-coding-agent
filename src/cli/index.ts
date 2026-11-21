import { parseArgs } from 'node:util'
import pkg from '../../package.json'
import { getKey, type ProviderId } from '../core/credentials'
import { DEFAULT_MODELS } from '../core/provider/models'
import { PROVIDER_IDS, providerFromCredentials } from '../core/provider/factory'
import { runHeadless } from './headless'

const USAGE = `Usage: mca -p "<prompt>" [options]

Options:
  -p, --print            Run one prompt non-interactively; answer on stdout, tool activity on stderr
      --provider <id>    anthropic | openrouter (default: first one with a key)
      --model <id>       Model id (default: the provider's main model)
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
        model: { type: 'string' }
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
  if (!values.print) return fail('Interactive mode is not available yet. Use -p "<prompt>".')

  const stdin = await readStdin()
  const prompt = [positionals.join(' '), stdin].filter((s) => s.trim()).join('\n\n')
  if (!prompt) return fail('No prompt given.')

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

  const code = await runHeadless({
    prompt,
    provider,
    model: values.model ?? DEFAULT_MODELS[id].main,
    cwd: process.cwd(),
    io: { out: (s) => void process.stdout.write(s), err: (s) => void process.stderr.write(s) }
  })
  process.exitCode = code
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
