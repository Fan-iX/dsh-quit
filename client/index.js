// Browser half of dsh-hub-utils: one settings section that pins this dsh
// instance so dsh-hub does not reap it while the page is closed.
//
// Hand-written rather than built — the `clientBundle` tsdown preset is not part
// of the published SDK, so this file is already in the runtime's dynamic-bundle
// format (`window.__ModuleLoader__.load`). It requires only the shell's baseline
// modules and holds no relative `require`, because the runtime hands a factory
// one synchronous chunk and does not resolve siblings. There is no JSX, because
// nothing compiles it.
//
// The exchange is deliberately a plain same-origin fetch: the page is served by
// dsh-hub, so a relative path reaches the hub's keep-alive route with the hub
// session cookie attached. That route answers JSON only when the instance really
// runs under dsh-hub, which is how this section tells a bare `dsh web` apart.
window.__ModuleLoader__.load({
  id: 'dsh-hub-utils',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    var react = require('react')
    var jsxRuntime = require('react/jsx-runtime')
    var primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    var jsx = jsxRuntime.jsx
    var jsxs = jsxRuntime.jsxs

    /** Dictionary namespace owned by this browser half. */
    var NS = 'settings.dshHubUtils'

    /** The hub route behind the toggle; see dsh-hub's src/keepalive.mjs. */
    var API_PATH = '/hub/api/keepalive'

    /** Stack used by every phase, so the section keeps one width. */
    var stack = { display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '560px' }
    var row = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }
    var titleStyle = { color: 'var(--dsw-alias-label-primary, #0f1115)', fontSize: '15px', fontWeight: 600 }
    var bodyStyle = { color: 'var(--dsw-alias-label-tertiary, #81858c)', fontSize: '13px', lineHeight: 1.6 }

    /** English copy. */
    var en = {
      nav: 'dsh-hub',
      title: 'Keep this instance running',
      body: 'When enabled, dsh-hub keeps this instance running after you close the page. When disabled, an idle instance is stopped and a fresh one starts on your next visit.',
      loading: 'Reading the current setting…',
      on: 'This instance keeps running after the page closes.',
      off: 'An idle instance is stopped after the page closes.',
      unsupported: 'This control is only available when the instance runs under dsh-hub.',
      failed: 'Could not read the setting.',
      retry: 'Retry',
      saveFailed: 'Could not save the setting. Try again.',
    }

    /** Simplified Chinese copy. */
    var zh = {
      nav: 'dsh-hub',
      title: '保持实例运行',
      body: '开启后，即使关闭页面，dsh-hub 也会维持这个实例的运行。关闭时，空闲实例会被回收，下次访问时再启动一个新实例。',
      loading: '正在读取当前设置…',
      on: '关闭页面后，这个实例会继续运行。',
      off: '关闭页面后，空闲实例会被回收。',
      unsupported: '此控件仅在实例运行于 dsh-hub 之下时可用。',
      failed: '无法读取设置。',
      retry: '重试',
      saveFailed: '无法保存设置，请重试。',
    }

    /**
     * Read the hub's current keep-alive state.
     * @returns a promise of `{ supported: false }` outside dsh-hub, or the state.
     */
    function readState() {
      return fetch(API_PATH, {
        method: 'GET',
        headers: { accept: 'application/json' },
        cache: 'no-store',
      }).then(function (response) {
        var json = /application\/json/i.test(response.headers.get('content-type') || '')
        if (!response.ok || !json) return { supported: false }
        return response.json().then(function (body) {
          return { supported: true, keepAlive: body.keepAlive === true, running: body.running === true }
        })
      })
    }

    /**
     * The settings section.
     * @param props - the section's render props, carrying the `t` seat.
     * @returns the section content for the current phase.
     */
    function HubSection(props) {
      var t = props.t
      var state = react.useState({ phase: 'loading', keepAlive: false, running: false, busy: false, failed: false })
      var current = state[0]
      var setCurrent = state[1]
      var alive = react.useRef(true)
      react.useEffect(function () {
        alive.current = true
        return function () { alive.current = false }
      }, [])

      var load = function () {
        setCurrent(function (prev) { return Object.assign({}, prev, { phase: 'loading', failed: false }) })
        readState().then(function (next) {
          if (!alive.current) return
          if (!next.supported) {
            setCurrent({ phase: 'unsupported', keepAlive: false, running: false, busy: false, failed: false })
            return
          }
          setCurrent({ phase: 'ready', keepAlive: next.keepAlive, running: next.running, busy: false, failed: false })
        }).catch(function () {
          if (alive.current) setCurrent({ phase: 'error', keepAlive: false, running: false, busy: false, failed: false })
        })
      }
      react.useEffect(load, [])

      var toggle = function (next) {
        setCurrent(function (prev) { return Object.assign({}, prev, { busy: true, failed: false }) })
        fetch(API_PATH, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ keepAlive: next }),
          cache: 'no-store',
        }).then(function (response) {
          if (!response.ok) throw new Error('HTTP ' + String(response.status))
          return response.json()
        }).then(function (body) {
          if (!alive.current) return
          setCurrent({ phase: 'ready', keepAlive: body.keepAlive === true, running: body.running === true, busy: false, failed: false })
        }).catch(function () {
          if (alive.current) setCurrent(function (prev) { return Object.assign({}, prev, { busy: false, failed: true }) })
        })
      }

      var heading = jsxs('div', { style: row, children: [
        jsx('div', { style: titleStyle, children: t('title') }),
        current.phase === 'ready'
          ? jsx(primitives.Switch, {
            checked: current.keepAlive,
            disabled: current.busy,
            label: t('title'),
            onChange: toggle,
          })
          : null,
      ] })
      var description = jsx('div', { style: bodyStyle, children: t('body') })

      if (current.phase === 'loading' || current.phase === 'unsupported' || current.phase === 'error') {
        var message = current.phase === 'loading' ? t('loading')
          : current.phase === 'unsupported' ? t('unsupported')
            : t('failed')
        var retry = current.phase === 'error'
          ? jsx(primitives.Button, { variant: 'ghost', size: 'sm', onClick: load, children: t('retry') })
          : null
        return jsxs('div', { style: stack, children: [heading, description, jsx('div', { style: bodyStyle, children: message }), retry] })
      }

      var caption = current.failed ? t('saveFailed') : (current.keepAlive ? t('on') : t('off'))
      return jsxs('div', { style: stack, children: [heading, description, jsx('div', { style: bodyStyle, children: caption })] })
    }

    /**
     * Mount the settings section and its dictionaries.
     * @param ctx - the browser plugin context.
     */
    function apply(ctx) {
      ctx.effect(function () { return ctx.locale.register(NS, { en: en, zh: zh }) }, 'dsh-hub-utils: dictionaries')
      var t = ctx.locale.bind(NS)
      ctx.effect(function () {
        return ctx.slots.inject('settings.section', function () {
          return ctx.slots.register({
            name: 'settings.section',
            id: 'dsh-hub',
            order: 90,
            label: function () { return t('nav') },
            locale: NS,
          }, HubSection)
        })
      }, 'dsh-hub-utils: settings section')
    }

    exports.NS = NS
    exports.API_PATH = API_PATH
    exports.apply = apply
    exports.inject = ['slots', 'locale']
    return module.exports
  },
})
