import { fork, spawn, spawnSync } from 'node:child_process'
import net from 'node:net'

const HOST = '127.0.0.1'
const PORT = 3187
const BASE_URL = `http://${HOST}:${PORT}`
const READY_URL = `${BASE_URL}/ping`
const READY_TIMEOUT_MS = 60_000
const SUITE_TIMEOUT_MS = 330_000
const SHUTDOWN_TIMEOUT_MS = 10_000

const fixtureEnv = {
  ...process.env,
  PLAYWRIGHT_COMMERCE_FIXTURE: '1',
  JWT_SECRET: 'playwright-commerce-fixture-secret-000000000000000000000000',
  NEXT_PUBLIC_APP_URL: BASE_URL,
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'playwright-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'playwright-service-role-key',
  SENTRY_DSN: '',
  NEXT_PUBLIC_SENTRY_DSN: '',
  TURBOPACK: '1',
}

function portIsOpen() {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: HOST, port: PORT })
    socket.setTimeout(500)
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('timeout', () => { socket.destroy(); resolve(false) })
    socket.once('error', () => resolve(false))
  })
}

async function waitForServer(server) {
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Next.js fixture server exited before readiness (code ${server.exitCode}).`)
    }
    try {
      // Do not repeatedly abort compilation of the first route: Turbopack treats
      // an aborted request as abandoned work and can restart it indefinitely.
      const response = await fetch(READY_URL, { signal: AbortSignal.timeout(30_000), redirect: 'manual' })
      if (response.status >= 200 && response.status < 500) return
    } catch {
      // The server is still starting or compiling.
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`Next.js fixture server did not become ready at ${READY_URL} within ${READY_TIMEOUT_MS / 1_000}s.`)
}

function stopProcessTree(child) {
  if (!child) return
  if (child.exitCode === null && child.kill()) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: SHUTDOWN_TIMEOUT_MS,
    })
  } else if (child.exitCode === null) {
    try { process.kill(-child.pid, 'SIGTERM') } catch { /* already exited */ }
  }
}

function stopWindowsPortOwner() {
  if (process.platform !== 'win32') return
  const result = spawnSync('netstat', ['-ano', '-p', 'tcp'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: SHUTDOWN_TIMEOUT_MS,
  })
  const escapedPort = String(PORT).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = result.stdout?.match(new RegExp(`^\\s*TCP\\s+\\S+:${escapedPort}\\s+\\S+\\s+LISTENING\\s+(\\d+)\\s*$`, 'mi'))
  if (!match) return
  spawnSync('taskkill', ['/pid', match[1], '/T', '/F'], {
    stdio: 'ignore',
    windowsHide: true,
    timeout: SHUTDOWN_TIMEOUT_MS,
  })
}

async function waitForPortClose() {
  const deadline = Date.now() + SHUTDOWN_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (!(await portIsOpen())) return true
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return false
}

function runSuite() {
  return new Promise((resolve, reject) => {
    const cli = process.platform === 'win32'
      ? 'node_modules/playwright/cli.js'
      : 'node_modules/playwright/cli.js'
    const child = spawn(process.execPath, [cli, 'test', ...process.argv.slice(2)], {
      env: fixtureEnv,
      stdio: 'inherit',
      windowsHide: true,
    })
    const timer = setTimeout(() => {
      stopProcessTree(child)
      reject(new Error(`Playwright exceeded the bounded ${SUITE_TIMEOUT_MS / 1_000}s suite timeout.`))
    }, SUITE_TIMEOUT_MS)
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`Playwright exited with code ${code ?? 'null'}${signal ? ` (${signal})` : ''}.`))
    })
  })
}

let server
let exitCode = 0
try {
  if (await portIsOpen()) {
    throw new Error(`Port ${PORT} is already in use. Stop the stale server before running E2E tests.`)
  }
  server = fork('node_modules/next/dist/server/lib/start-server.js', {
    env: {
      ...fixtureEnv,
      __NEXT_DEV_SERVER: '1',
      NEXT_PRIVATE_WORKER: '1',
    },
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    windowsHide: true,
  })
  server.on('message', (message) => {
    if (message?.nextWorkerReady) {
      server.send({
        nextWorkerOptions: {
          dir: process.cwd(),
          hostname: HOST,
          port: PORT,
          isDev: true,
          allowRetry: false,
        },
      })
    }
  })
  await waitForServer(server)
  await runSuite()
} catch (error) {
  exitCode = 1
  console.error(`[playwright-runner] ${error instanceof Error ? error.message : String(error)}`)
} finally {
  stopProcessTree(server)
  stopWindowsPortOwner()
  if (!(await waitForPortClose())) {
    console.error(`[playwright-runner] Port ${PORT} is still open after teardown.`)
    exitCode = 1
  }
}

// Do not let a leaked browser pipe or diagnostic reporter keep CI alive after
// both managed process trees have been terminated and the port is confirmed
// closed.
process.exit(exitCode)
