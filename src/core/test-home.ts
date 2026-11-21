import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Core tests must never write to the real ~/.mca (sessions, state, credentials): every test file gets a throwaway HOME.
process.env.HOME = mkdtempSync(join(tmpdir(), 'mca-test-home-'))
