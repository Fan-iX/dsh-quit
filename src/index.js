/**
 * dsh-hub-utils: host half.
 *
 * The panel itself lives in the browser half. This half provides the one action
 * that needs the host process: a bounded exit (`appExit`), the same path
 * `dsh web` takes on SIGTERM, so the tree is disposed and the session log is
 * flushed rather than dropped.
 *
 * A plugin route is not covered by the browser fence automatically — the web
 * server hands registered routes the raw request — so the handler applies it
 * through `ctx.connection.admit` itself. Network position is not treated as
 * authority: the backend port is reachable by root, by its own user, and
 * (without the supervisor's iptables guard) by every other local user.
 */

/** Unique across the profile: the loader rejects two rows with one id. */
export const id = 'dsh-hub-utils'

/** The web server the quit route is registered on, and the browser auth service. */
export const inject = ['webServer', 'connection']

/** Where the browser half posts, and the header it must carry. */
export const QUIT_PATH = '/dsh-hub-utils/quit'

/** The request header the quit route requires, which a cross-site form cannot set. */
export const QUIT_HEADER = 'x-dsh-hub-utils'

/** How long the process waits after replying, so the browser reads the answer first. */
const QUIT_DELAY_MS = 100

/**
 * Register the quit route.
 * @param ctx - the plugin context, carrying the web server.
 */
export function apply(ctx) {
  // Only a hub-spawned instance exposes the quit route; a bare `dsh web` keeps
  // its original surface. The hub sets this marker in the spawned environment.
  if (process.env.DSH_HUB !== '1') return
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: QUIT_PATH,
    handler: (req, res) => { handleQuit(ctx, req, res) },
  }), 'dsh-hub-utils: quit route')
}

/**
 * Answer one request to the quit route, asking the launcher to exit on success.
 * @param ctx - the plugin context.
 * @param req - the incoming request.
 * @param res - the response the handler owns.
 */
function handleQuit(ctx, req, res) {
  // The same gate the index and every `/api` channel pass: the Host/Origin fence
  // first, then the authority-bound `dsh-auth-*` browser cookie.
  const admission = ctx.connection.admit(req)
  if (admission.rejection !== undefined) {
    respond(res, admission.rejection, admission.rejection === 401
      ? 'dsh web authentication required; reopen the URL printed by dsh web.'
      : 'request rejected by the Host/Origin fence')
    return
  }
  if (req.method !== 'POST') {
    respond(res, 405, 'POST only', { allow: 'POST' })
    return
  }
  // A cross-site form can send a POST but cannot attach a custom header, so it
  // cannot reach the exit even if it ever obtained a session cookie.
  if (req.headers[QUIT_HEADER] !== 'quit') {
    respond(res, 403, `missing the ${QUIT_HEADER}: quit header`)
    return
  }
  const exit = ctx.get('appExit')
  if (exit === undefined) {
    respond(res, 500, 'this host provides no appExit: the quit action needs a launcher that owns shutdown')
    return
  }
  ctx.logger.info('dsh-hub-utils: quit requested; closing this instance')
  respond(res, 200, '{"ok":true}', { 'content-type': 'application/json', 'cache-control': 'no-store' })
  // `finish` means the response reached the socket; the short delay above all
  // gives the browser time to read it before this process starts going away.
  res.once('finish', () => {
    setTimeout(() => { exit(0) }, QUIT_DELAY_MS)
  })
}

/**
 * Write one small plain response.
 * @param res - the response to write.
 * @param status - the status code.
 * @param body - the body text.
 * @param headers - extra headers; a text content type is supplied when absent.
 */
function respond(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers })
  res.end(body + '\n')
}
