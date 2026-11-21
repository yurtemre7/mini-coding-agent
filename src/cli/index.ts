import { parseArgs } from 'node:util'
import pkg from '../../package.json'

const USAGE = `Usage: mca [options]

Options:
  -h, --help     Show this help
  -v, --version  Print the version`

function parse(): { help?: boolean; version?: boolean } {
  try {
    return parseArgs({
      args: process.argv.slice(2),
      options: {
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' }
      },
      strict: true
    }).values
  } catch (error) {
    console.error(`${(error as Error).message}\n\n${USAGE}`)
    process.exit(2)
  }
}

const values = parse()
console.log(values.version ? pkg.version : USAGE)
