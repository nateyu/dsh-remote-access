import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { dshHome, ownedCleanupPaths, statePath } from '../lib/home.js'
import { PLUGIN_NAME } from '../lib/config.js'
import { applySshPatch, emptyState, normalizeState } from '../lib/store.js'
import { removeOwnedFiles } from '../lib/uninstall.js'

test('normalizeState splits user@host:port into target and login port', () => {
  const migrated = normalizeState({ sshTarget: 'root@185.238.251.17:2222' })
  assert.equal(migrated.sshTarget, 'root@185.238.251.17')
  assert.equal(migrated.sshUsername, 'root')
  assert.equal(migrated.sshHost, '185.238.251.17')
  assert.equal(migrated.sshLoginPort, 2222)
  const explicit = normalizeState({ sshTarget: 'root@185.238.251.17', sshLoginPort: 2200 })
  assert.equal(explicit.sshTarget, 'root@185.238.251.17')
  assert.equal(explicit.sshLoginPort, 2200)
  assert.equal(normalizeState({}).sshLoginPort, 22)
})

test('applySshPatch keeps a host-only draft without a complete target', () => {
  const draft = applySshPatch(emptyState(), { host: '185.238.251.17', username: '' })
  assert.equal(draft.sshHost, '185.238.251.17')
  assert.equal(draft.sshUsername, '')
  assert.equal(draft.sshTarget, '')
  applySshPatch(draft, { username: 'root', identityFile: '~/.ssh/id_ed25519', password: 'secret' })
  assert.equal(draft.sshTarget, 'root@185.238.251.17')
  assert.equal(draft.sshIdentityFile, '~/.ssh/id_ed25519')
  assert.equal(draft.sshPassword, 'secret')
})

test('state lives as one JSON file under storages', () => {
  const home = '/tmp/dsh-home-fixture'
  assert.equal(statePath(home), join(home, 'storages', `${PLUGIN_NAME}.json`))
  assert.equal(dshHome({ DSH_HOME: '  /custom  ' }), '/custom')
})

test('removeOwnedFiles deletes the storages file and leftover plugin directories', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-ra-'))
  const storages = join(home, 'storages')
  await mkdir(storages, { recursive: true })
  const file = join(storages, `${PLUGIN_NAME}.json`)
  await writeFile(file, '{}\n')
  await mkdir(join(home, 'dsh-gateway'), { recursive: true })
  await writeFile(join(home, 'dsh-gateway', 'state.json'), '{}\n')
  await mkdir(join(home, PLUGIN_NAME), { recursive: true })
  const keep = join(storages, 'workspace.json')
  await writeFile(keep, '{}\n')
  await removeOwnedFiles(home)
  await assert.rejects(() => readFile(file), { code: 'ENOENT' })
  await assert.rejects(() => readFile(join(home, 'dsh-gateway', 'state.json')), { code: 'ENOENT' })
  assert.equal(await readFile(keep, 'utf8'), '{}\n')
  assert.ok(ownedCleanupPaths(home).includes(file))
  assert.ok(ownedCleanupPaths(home).every((path) => !path.includes('cloudflared')))
  await rm(home, { recursive: true, force: true })
})
