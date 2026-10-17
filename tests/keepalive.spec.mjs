// Tests for dsh-hub-utils: the host row, the browser bundle's registration, and
// the section's read/toggle exchange. The host half imports nothing, so this
// suite needs no SDK link.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { apply as hostApply, id as pluginId } from '../src/index.js'

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

const stubRequire = (specifier) => {
  if (specifier === 'react') {
    return {
      useState: (initial) => [initial, () => {}],
      useEffect: () => {},
      useRef: (value) => ({ current: value }),
    }
  }
  if (specifier === 'react/jsx-runtime') {
    return {
      jsx: (type, props) => ({ type, props }),
      jsxs: (type, props) => ({ type, props }),
      Fragment: 'Fragment',
    }
  }
  if (specifier === '@deepseek-ai/dsh-client-ui-primitives') {
    return { Switch: 'Switch', Button: 'Button' }
  }
  throw new Error(`the bundle required an undeclared external: ${specifier}`)
}

/**
 * A hook stub whose `useState` reports a preset state, so one render models one
 * phase, and records the transitions for assertion.
 * @param state - the state object this render should see.
 */
const makeHooks = (state) => {
  const seen = { state, transitions: [] }
  return {
    seen,
    react: {
      useState: () => [seen.state, (next) => {
        seen.transitions.push(next)
        seen.state = typeof next === 'function' ? next(seen.state) : next
      }],
      useEffect: () => {},
      useRef: (value) => ({ current: value }),
    },
  }
}

/** Install the plugin with controllable hooks and hand back the section. */
const mountSection = (state) => {
  const hooks = makeHooks(state)
  let component
  registration.factory((specifier) => (specifier === 'react' ? hooks.react : stubRequire(specifier))).apply({
    locale: { register: () => () => {}, bind: () => (key) => key },
    effect: (register) => { register(); return () => {} },
    slots: {
      inject: (name, contribute) => contribute(),
      register: (options, value) => { component = value; return () => {} },
    },
  })
  return { component, hooks, render: (props = {}) => component({ t: (key) => key, ...props }) }
}

/** Visit every element node in a render tree. */
const walk = (node, visit) => {
  if (node === null || node === undefined) return
  if (typeof node !== 'object') return
  visit(node)
  const children = node.props?.children
  if (Array.isArray(children)) children.forEach((child) => walk(child, visit))
  else walk(children, visit)
}

/** The single element of a type in a render tree, or undefined. */
const find = (tree, type) => {
  let found
  walk(tree, (node) => { if (node.type === type) found = node })
  return found
}

/** Every text leaf, joined, for copy assertions. */
const text = (tree) => {
  const parts = []
  walk(tree, (node) => {
    const children = node.props?.children
    if (typeof children === 'string') parts.push(children)
  })
  return parts.join(' ')
}

test('the host row resolves and exports an id and an apply', () => {
  assert.equal(pluginId, 'dsh-hub-utils')
  assert.equal(typeof hostApply, 'function')
})

test('the manifest declares a web client half alongside the host half', () => {
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.equal(pkg.exports['.'].default, './src/index.js')
  assert.equal(pkg.exports['./client'].default, './client/index.js')
  assert.ok(pkg.files.includes('client'))
  assert.deepEqual(pkg.dsh.client.inject, [
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-ui-settings',
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

test('the browser half mounts one settings section', () => {
  const registrations = []
  const face = registration.factory(stubRequire)
  face.apply({
    locale: { register: () => () => {}, bind: () => (key) => key },
    effect: (register) => { register(); return () => {} },
    slots: {
      inject: (name, contribute) => contribute(),
      register: (options, component) => { registrations.push({ options, component }); return () => {} },
    },
  })
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].options.name, 'settings.section')
  assert.equal(registrations[0].options.id, 'dsh-hub')
  assert.equal(registrations[0].options.order, 90)
  assert.equal(registrations[0].options.locale, 'settings.dshHubUtils')
  assert.equal(registrations[0].options.label(), 'nav')
  assert.deepEqual(face.inject, ['slots', 'locale'])
})

test('the section reads the hub state and exposes one switch', () => {
  const { render } = mountSection({ phase: 'ready', keepAlive: true, running: true, busy: false, failed: false })
  const tree = render()
  const toggle = find(tree, 'Switch')
  assert.ok(toggle, 'the ready phase must render the switch')
  assert.equal(toggle.props.checked, true)
  assert.equal(toggle.props.disabled, false)
  assert.equal(toggle.props.label, 'title')
  assert.match(text(tree), /on/, 'the caption states the pinned behaviour')
})

test('the switch asks for the opposite state and posts it as JSON', async () => {
  const calls = []
  globalThis.fetch = (url, init) => {
    calls.push({ url, init })
    return Promise.resolve({
      ok: true,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ keepAlive: true, running: true }),
    })
  }
  const { render, hooks } = mountSection({ phase: 'ready', keepAlive: false, running: true, busy: false, failed: false })
  find(render(), 'Switch').props.onChange(true)
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, '/hub/api/keepalive')
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.headers['content-type'], 'application/json')
  assert.equal(calls[0].init.body, '{"keepAlive":true}')
  assert.equal(hooks.seen.state.keepAlive, true)
})

test('a store failure keeps the toggle usable and says so', async () => {
  globalThis.fetch = () => Promise.resolve({ ok: false, status: 500 })
  const { render } = mountSection({ phase: 'ready', keepAlive: false, running: true, busy: false, failed: false })
  find(render(), 'Switch').props.onChange(true)
  await new Promise((resolve) => setTimeout(resolve, 0))
  const tree = render()
  assert.match(text(tree), /saveFailed/)
  assert.equal(find(tree, 'Switch').props.disabled, false, 'a failed write must not lock the control')
})

test('outside dsh-hub the section says so and offers no switch', () => {
  const { render } = mountSection({ phase: 'unsupported', keepAlive: false, running: false, busy: false, failed: false })
  const tree = render()
  assert.equal(find(tree, 'Switch'), undefined)
  assert.match(text(tree), /unsupported/)
})

test('a failed read offers a retry', () => {
  const { render } = mountSection({ phase: 'error', keepAlive: false, running: false, busy: false, failed: false })
  const tree = render()
  assert.match(text(tree), /failed/)
  assert.equal(find(tree, 'Button').props.children, 'retry')
})
