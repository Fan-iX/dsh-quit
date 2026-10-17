// Tests for dsh-hub-utils: the host half's quit route, the browser half's
// sidebar action, and the panel's keep-alive and quit exchanges (including the
// quit confirmation stacked on top of the panel). The host half imports
// nothing, so this suite needs no SDK link.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  apply as hostApply, id as pluginId, inject as hostInject, QUIT_HEADER, QUIT_PATH,
} from '../src/index.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const BUNDLE = join(root, 'client', 'index.js')
const source = readFileSync(BUNDLE, 'utf8')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

/** The shell's baseline module table; a dynamic bundle may require nothing else. */
const BASELINE = new Set([
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-dockkit',
])

let registration
globalThis.window = { __ModuleLoader__: { load: (value) => { registration = value } } }
await import(pathToFileURL(BUNDLE).href)

// --- the host half ----------------------------------------------------------

/** A response stub recording what the handler wrote, and its `finish` listener. */
const makeRes = () => ({
  status: undefined,
  headers: undefined,
  body: undefined,
  finish: undefined,
  writeHead(status, headers) { this.status = status; this.headers = headers },
  end(body) { this.body = body },
  once(event, listener) { if (event === 'finish') this.finish = listener },
})

/**
 * A context stub that records the route, the log, and every exit request.
 * @param options.appExit - the launcher's exit request, or undefined to model a host without one.
 * @param options.rejection - what `connection.admit` answers; undefined means admitted.
 */
const makeCtx = ({ appExit, rejection } = {}) => {
  const seen = { route: undefined, exits: [], logs: [], admittances: 0 }
  seen.ctx = {
    effect: (register) => { register(); return () => {} },
    get: (name) => name === 'appExit' ? appExit : undefined,
    logger: { info: (...args) => { seen.logs.push(args.join(' ')) } },
    webServer: { register: (route) => { seen.route = route; return () => {} } },
    connection: {
      admit: () => {
        seen.admittances += 1
        return rejection === undefined ? { peer: 'operator' } : { rejection }
      },
    },
  }
  return seen
}

test('the host half declares its route and its gates', () => {
  assert.equal(pluginId, 'dsh-hub-utils')
  assert.deepEqual(hostInject, ['webServer', 'connection'])
  assert.equal(QUIT_PATH, '/dsh-hub-utils/quit')
  assert.equal(QUIT_HEADER, 'x-dsh-hub-utils')
})

test('the host half mounts one exact route at the exported path', () => {
  const seen = makeCtx()
  hostApply(seen.ctx)
  assert.equal(seen.route.kind, 'exact')
  assert.equal(seen.route.path, QUIT_PATH)
  assert.equal(typeof seen.route.handler, 'function')
})

test('an unauthenticated request is refused the way the index and /api refuse it', () => {
  const seen = makeCtx({ appExit: () => {}, rejection: 401 })
  hostApply(seen.ctx)
  const res = makeRes()
  seen.route.handler({ method: 'POST', headers: { [QUIT_HEADER]: 'quit' } }, res)
  assert.equal(res.status, 401)
  assert.match(res.body, /authentication required/)
  assert.deepEqual(seen.exits, [])
})

test('a request the Host/Origin fence rejects never reaches the launcher', () => {
  const seen = makeCtx({ appExit: () => {}, rejection: 403 })
  hostApply(seen.ctx)
  const res = makeRes()
  seen.route.handler({ method: 'POST', headers: { [QUIT_HEADER]: 'quit' } }, res)
  assert.equal(res.status, 403)
  assert.match(res.body, /Host\/Origin fence/)
  assert.deepEqual(seen.exits, [])
})

test('a non-POST is refused without asking the launcher to exit', () => {
  const seen = makeCtx({ appExit: () => {} })
  hostApply(seen.ctx)
  const res = makeRes()
  seen.route.handler({ method: 'GET', headers: {} }, res)
  assert.equal(res.status, 405)
  assert.equal(res.headers.allow, 'POST')
  assert.deepEqual(seen.exits, [])
})

test('a POST without the confirmation header is refused', () => {
  const seen = makeCtx({ appExit: () => {} })
  hostApply(seen.ctx)
  const res = makeRes()
  seen.route.handler({ method: 'POST', headers: {} }, res)
  assert.equal(res.status, 403)
  assert.match(res.body, /x-dsh-hub-utils/)
  assert.deepEqual(seen.exits, [])
})

test('a host without appExit fails loudly instead of pretending to stop', () => {
  const seen = makeCtx({ appExit: undefined })
  hostApply(seen.ctx)
  const res = makeRes()
  seen.route.handler({ method: 'POST', headers: { [QUIT_HEADER]: 'quit' } }, res)
  assert.equal(res.status, 500)
  assert.match(res.body, /appExit/)
  assert.deepEqual(seen.exits, [])
})

test('an accepted request answers first, then asks the launcher to exit', async () => {
  const seen = makeCtx({ appExit: (code) => { seen.exits.push(code) } })
  hostApply(seen.ctx)
  const res = makeRes()
  seen.route.handler({ method: 'POST', headers: { [QUIT_HEADER]: 'quit' } }, res)
  assert.equal(res.status, 200)
  assert.equal(res.body, '{"ok":true}\n')
  assert.deepEqual(seen.exits, [], 'the browser must have its answer before the process leaves')
  assert.equal(typeof res.finish, 'function', 'the exit must wait for the response to flush')

  res.finish()
  await new Promise((resolve) => setTimeout(resolve, 250))
  assert.deepEqual(seen.exits, [0])
})

// --- the browser half -------------------------------------------------------

const stubRequire = (specifier) => {
  if (specifier === 'react') return { useState: (initial) => [initial, () => {}], useEffect: () => {}, useRef: (value) => ({ current: value }) }
  if (specifier === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' }
  if (specifier === '@deepseek-ai/dsh-client-ui-primitives') {
    return {
      Button: 'Button',
      Modal: 'Modal',
      Switch: 'Switch',
      Tooltip: 'Tooltip',
      IconQuestionOutlineRegular: 'IconQuestionOutlineRegular',
      IconSlidersTwoOutlineRegular: 'IconSlidersTwoOutlineRegular',
      IconStopFillRegular: 'IconStopFillRegular',
    }
  }
  throw new Error(`the bundle required an undeclared external: ${specifier}`)
}

const baseState = () => ({
  open: false,
  keep: { phase: 'loading', keepAlive: false, busy: false, failed: false },
  quit: 'idle',
  confirmOpen: false,
})

const readyKeep = (keepAlive) => ({ phase: 'ready', keepAlive, busy: false, failed: false })

/**
 * A hook stub with one `useState` that applies functional updates and records
 * them, so one render models one state and a setter can be inspected.
 * @param initial - the state this mount should start from.
 */
const makeHooks = (initial) => {
  const seen = { state: initial, transitions: [], effects: [] }
  return {
    seen,
    react: {
      useState: () => [seen.state, (next) => {
        seen.state = typeof next === 'function' ? next(seen.state) : next
        seen.transitions.push(seen.state)
      }],
      useEffect: (fn, deps) => { seen.effects.push({ fn, deps }) },
      useRef: (value) => ({ current: value }),
    },
  }
}

/** Install the plugin with controllable hooks and hand back the action. */
const mountAction = (initial) => {
  const hooks = makeHooks(initial)
  let component
  registration.factory((specifier) => (specifier === 'react' ? hooks.react : stubRequire(specifier))).apply({
    locale: { register: () => () => {} },
    effect: (register) => { register(); return () => {} },
    slots: {
      inject: (name, contribute) => contribute(),
      register: (options, value) => { component = value; return () => {} },
    },
  })
  return { component, hooks, render: (props = {}) => component({ t: (key) => key, wide: true, ...props }) }
}

/** Visit every element node in a render tree, including a modal's footer prop. */
const walk = (node, visit) => {
  if (node === null || node === undefined) return
  if (typeof node !== 'object') return
  visit(node)
  const children = node.props?.children
  if (Array.isArray(children)) children.forEach((child) => walk(child, visit))
  else walk(children, visit)
  if (node.props?.footer !== undefined) walk(node.props.footer, visit)
}

const findAll = (tree, type) => {
  const found = []
  walk(tree, (node) => { if (node.type === type) found.push(node) })
  return found
}

const find = (tree, type) => findAll(tree, type)[0]

/** The first Button whose text is `label`. */
const button = (tree, label) => findAll(tree, 'Button').find((node) => node.props?.children === label)

/** Every text leaf, joined, for copy assertions. */
const text = (tree) => {
  const parts = []
  walk(tree, (node) => {
    if (typeof node.props?.children === 'string') parts.push(node.props.children)
  })
  return parts.join(' ')
}

/** The panel dialog and the quit confirmation stacked above it. */
const dialogs = (tree) => findAll(tree, 'Modal')

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

test('the manifest declares a web client half alongside the host half', () => {
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.equal(pkg.exports['.'].default, './src/index.js')
  assert.equal(pkg.exports['./client'].default, './client/index.js')
  assert.ok(pkg.files.includes('client'))
  assert.deepEqual(pkg.dsh.client.inject, [
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-ui-sidebar',
  ])
})

test('the bundle registers its own id and requires only baseline externals', () => {
  assert.equal(registration.id, 'dsh-hub-utils')
  const specifiers = [...source.matchAll(/require\(\s*'([^']+)'\s*\)/g)].map((match) => match[1])
  assert.ok(specifiers.length > 0)
  for (const specifier of specifiers) {
    assert.ok(!specifier.startsWith('.'), `relative require is unsupported by the runtime: ${specifier}`)
    assert.ok(BASELINE.has(specifier), `not a baseline external: ${specifier}`)
  }
})

test('the browser half mounts one action at the sidebar foot', () => {
  const registrations = []
  const face = registration.factory(stubRequire)
  face.apply({
    locale: { register: () => () => {} },
    effect: (register) => { register(); return () => {} },
    slots: {
      inject: (name, contribute) => contribute(),
      register: (options, component) => { registrations.push({ options, component }); return () => {} },
    },
  })
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].options.name, 'sidebar.footer.action')
  assert.equal(registrations[0].options.id, 'dsh-hub-utils')
  assert.equal(registrations[0].options.locale, 'settings.dshHubUtils')
  assert.deepEqual(face.inject, ['slots', 'locale'])
})

test('the action shows the panel icon, its label only when wide, and opens the panel', () => {
  const { render, hooks } = mountAction(baseState())
  const wide = button(render(), 'action')
  assert.equal(wide.type, 'Button')
  assert.equal(wide.props.icon.props.children.type, 'IconSlidersTwoOutlineRegular')
  assert.equal(wide.props['aria-label'], 'action')
  assert.equal(wide.props.children, 'action')

  wide.props.onClick()
  assert.equal(hooks.seen.state.open, true, 'the first press only opens the panel')

  assert.equal(button(render({ wide: false }), 'action'), undefined, 'the 56px rail shows the icon alone')
})

test('the panel carries the keep-alive and quit controls', () => {
  const { render } = mountAction({ ...baseState(), open: true, keep: readyKeep(true) })
  const tree = render()
  const panel = dialogs(tree)[0]
  assert.equal(panel.props.open, true)
  assert.equal(panel.props.title, 'panelTitle')
  assert.equal(find(tree, 'Switch').props.checked, true)
  assert.match(text(tree), /keepTitle/)
  assert.match(text(tree), /keepOn/, 'the on/off caption survives')
  assert.equal(button(tree, 'close'), undefined, 'the footer close button is gone')

  const quit = button(tree, 'quit')
  assert.ok(quit, 'the quit action takes the footer seat')
  assert.equal(quit.props.variant, 'ghost', "the badge geometry stays the primitive's")
  assert.equal(quit.props.className, 'dsh-hub-utils-danger', 'filled red with white text')
  assert.equal(quit.props.icon.props.children.type, 'IconStopFillRegular')
  assert.equal(quit.props.icon.props.style.color, '#fff')

  const help = find(tree, 'Tooltip')
  assert.ok(help, 'the explanation moves into a tooltip')
  assert.equal(help.props.portal, true, 'the bubble must escape the dialog stacking context')
  assert.equal(help.props.label, 'keepBody')
  assert.equal(help.props.children.props.children.type, 'IconQuestionOutlineRegular')
  assert.equal(help.props.children.props['aria-label'], 'keepHelpLabel')
})

test('the keep-alive switch posts the opposite state as JSON', async () => {
  const calls = []
  globalThis.fetch = (url, init) => {
    calls.push({ url, init })
    return Promise.resolve({
      ok: true,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ keepAlive: true, running: true }),
    })
  }
  const { render, hooks } = mountAction({ ...baseState(), open: true, keep: readyKeep(false) })
  find(render(), 'Switch').props.onChange(true)
  await tick()

  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, '/hub/api/keepalive')
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.headers['content-type'], 'application/json')
  assert.equal(calls[0].init.body, '{"keepAlive":true}')
  assert.equal(hooks.seen.state.keep.keepAlive, true)
})

test('opening the panel reads the keep-alive state from the hub', async () => {
  const calls = []
  globalThis.fetch = (url, init) => {
    calls.push({ url, init })
    return Promise.resolve({
      ok: true,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ keepAlive: true, running: true }),
    })
  }
  const { render, hooks } = mountAction({ ...baseState(), open: true })
  render()
  const loads = hooks.seen.effects.filter((entry) => Array.isArray(entry.deps) && entry.deps[0] === true)
  assert.ok(loads.length > 0, 'opening must schedule a read')
  loads[0].fn()
  await tick()

  assert.equal(calls[0].url, '/hub/api/keepalive')
  assert.equal(calls[0].init.method, 'GET')
  assert.equal(hooks.seen.state.keep.phase, 'ready')
  assert.equal(hooks.seen.state.keep.keepAlive, true)
})

test('outside dsh-hub the keep-alive row says so, but the quit action stays', () => {
  const state = { ...baseState(), open: true, keep: { phase: 'unsupported', keepAlive: false, busy: false, failed: false } }
  const { render } = mountAction(state)
  const tree = render()
  assert.equal(find(tree, 'Switch'), undefined)
  assert.match(text(tree), /unsupported/)
  assert.ok(button(tree, 'quit'))
})

test('the quit action opens a second dialog stacked above the panel', () => {
  const { render, hooks } = mountAction({ ...baseState(), open: true, keep: readyKeep(false) })
  button(render(), 'quit').props.onClick()
  assert.equal(hooks.seen.state.confirmOpen, true)

  const stack = dialogs(render())
  assert.equal(stack.length, 2, 'the confirmation is a second dialog, not an inline row')
  assert.equal(stack[0].props.open, true, 'the panel stays open underneath')
  assert.equal(stack[1].props.open, true)
  assert.equal(stack[1].props.className, 'dsh-hub-utils-confirm')
  assert.equal(stack[1].props.title, 'quitDialogTitle')
  assert.equal(stack[1].props.description, 'quitDialogBody')
  const [cancel, confirm] = stack[1].props.footer
  assert.equal(cancel.props.children, 'cancel')
  assert.equal(confirm.props.children, 'quitConfirmAction')
  assert.equal(confirm.props.className, 'dsh-hub-utils-danger', 'both danger buttons share the red fill')
})

test('the confirmation title is bold and the danger buttons are filled red', () => {
  assert.match(source, /\.dsh-hub-utils-confirm h2 \{ font-weight: 700; \}/)
  assert.match(source, /\.dsh-hub-utils-danger\.dsh-hub-utils-danger \{ background: var\(--dsw-static-red-600, #ec1313\); color: #fff; \}/)
  const seen = mountAction(baseState())
  assert.ok(seen.component)
})

test('cancelling or Escape on the confirmation leaves the panel untouched', () => {
  const { render, hooks } = mountAction({ ...baseState(), open: true, keep: readyKeep(false), confirmOpen: true })
  dialogs(render())[1].props.footer[0].props.onClick()
  assert.equal(hooks.seen.state.confirmOpen, false)
  assert.equal(hooks.seen.state.quit, 'idle')
  assert.equal(hooks.seen.state.open, true, 'the panel is still open')

  dialogs(render())[1].props.onClose()
  assert.equal(hooks.seen.state.confirmOpen, false)
})

test('an untouched confirmation dismisses itself after the window', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { render, hooks } = mountAction({ ...baseState(), open: true, keep: readyKeep(false), confirmOpen: true })
  render()
  const opens = hooks.seen.effects.filter((entry) => Array.isArray(entry.deps) && entry.deps[0] === true)
  const dismiss = opens.at(-1)
  assert.ok(dismiss, 'a confirmation must schedule its own dismissal')
  dismiss.fn()
  t.mock.timers.tick(5000)
  assert.equal(hooks.seen.state.confirmOpen, false, 'five idle seconds close it')
})

test('confirming the dialog posts the quit request and keeps the dialog while closing', async () => {
  const calls = []
  const reloads = []
  globalThis.window = {
    __ModuleLoader__: globalThis.window.__ModuleLoader__,
    location: { reload: () => { reloads.push(true) } },
  }
  globalThis.fetch = (url, init) => {
    calls.push({ url, init })
    return Promise.resolve({ ok: true, status: 200 })
  }
  const { render, hooks } = mountAction({ ...baseState(), open: true, keep: readyKeep(false), confirmOpen: true })
  assert.deepEqual(calls, [], 'opening the confirmation sends nothing')
  dialogs(render())[1].props.footer[1].props.onClick()
  await tick()

  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, '/dsh-hub-utils/quit')
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.headers['x-dsh-hub-utils'], 'quit')
  assert.equal(hooks.seen.state.quit, 'closing')
  assert.equal(hooks.seen.state.confirmOpen, true, 'the dialog shows the closing state')
  assert.deepEqual(reloads, [], 'the reload waits for the instance to leave')
})

test('a refused quit closes the dialog and asks for a reload', async () => {
  globalThis.fetch = () => Promise.resolve({ ok: false, status: 401 })
  const { render, hooks } = mountAction({ ...baseState(), open: true, keep: readyKeep(false), confirmOpen: true })
  dialogs(render())[1].props.footer[1].props.onClick()
  await tick()
  assert.equal(hooks.seen.state.quit, 'denied')
  assert.equal(hooks.seen.state.confirmOpen, false)
  assert.ok(button(render(), 'reload'))
})

test('a failed quit closes the dialog and offers retry', async () => {
  globalThis.fetch = () => Promise.resolve({ ok: false, status: 500 })
  const { render, hooks } = mountAction({ ...baseState(), open: true, keep: readyKeep(false), confirmOpen: true })
  dialogs(render())[1].props.footer[1].props.onClick()
  await tick()
  assert.equal(hooks.seen.state.quit, 'failed')
  assert.equal(hooks.seen.state.confirmOpen, false)
  assert.match(text(render()), /quitFailed/)
  assert.ok(button(render(), 'retry'))
})
