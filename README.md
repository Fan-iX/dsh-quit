# dsh-hub-utils

One **dsh-hub** button at the sidebar foot opens a small control panel for the
current instance:

- **Keep this instance running** — asks
  [dsh-hub](https://github.com/Fan-iX/dsh-hub) not to reap the instance when idle,
  so closing the page no longer ends it.
- **Quit this instance** — asks the launcher for a bounded exit (`appExit`, the
  same path `dsh web` takes on `SIGTERM`), so the tree is disposed and the
  session log is flushed. Under dsh-hub, the next request spawns a fresh
  instance.

The panel replaces the separate `dsh-quit` button for the quit function: install
this package and remove `dsh-quit` if it was installed before, so the sidebar
shows one entry rather than two.

## Install

```sh
dsh plugin --profile web add /path/to/dsh-hub-utils
```

Restart the instance once by hand, so the host row and the browser bundle load.
From then on the panel is how the instance is pinned or restarted.

## Use

The sidebar foot gains a sliders button labelled **dsh-hub**. It opens a dialog:

1. **Keep running when idle** — a switch, with a `?` icon beside the title whose
   tooltip carries the full explanation (portaled, so it renders above the
   dialog); the on/off caption stays under the switch. The panel reads the real
   state from the hub when it opens, so a reload shows the truth rather than a
   guessed default. The switch resets to off when the instance is replaced.
2. **Quit** — a filled red footer button with white text, taking the seat the old
   Close button used (the header close button is now the only close). It opens a
   **second dialog on top of the panel** (Cancel / a red Quit) whose title is
   bold. Escape, the mask, or five seconds without an answer dismiss it;
   confirming posts the quit request, and the page reloads into a fresh instance
   after a short delay. dsh's modal layer stacks dialogs and gives the top one
   Escape and focus, so the panel underneath stays put.

Keep-alive only appears under dsh-hub: a bare `dsh web` answers the hub route
with a non-JSON response, and the panel says so. Quit works under any launcher
that provides `appExit`; without one it fails loudly instead of pretending to
stop.

## Contracts

The browser half talks to two routes over same-origin `fetch`, with the browser's
cookies attached automatically:

| Route | Owner | Request | Response |
|---|---|---|---|
| `GET /hub/api/keepalive` | dsh-hub | — | `{"keepAlive":boolean,"running":boolean}` |
| `POST /hub/api/keepalive` | dsh-hub | `{"keepAlive":boolean}`, `content-type: application/json` | the same JSON |
| `POST /dsh-hub-utils/quit` | this package | header `x-dsh-hub-utils: quit` | `{"ok":true}` |

The keep-alive route requires an authenticated hub session; the JSON content
type is the CSRF guard (the session cookie is `SameSite=Lax`, and a cross-site
form cannot send `application/json` without a preflight). The flag lives on the
hub's per-user backend object, so it applies to the current instance only.

The quit route applies dsh's own browser fence through `ctx.connection.admit`
(plugin routes are not fenced automatically), requires a `POST` carrying the
custom header (which a cross-site form cannot set), and hands the exit to the
launcher's `appExit` after the response has flushed.

## What the browser half needs

The bundle is hand-written in the runtime's dynamic-bundle format
(`window.__ModuleLoader__.load`) and requires only baseline modules: `react`,
`react/jsx-runtime`, and `@deepseek-ai/dsh-client-ui-primitives`. It registers
one `sidebar.footer.action` entry with its own locale namespace, so the panel
follows the app's language and the host row only exists so the package resolves
in the loader.

The plugin mounts only under dsh-hub: the hub injects `window.__DSH_HUB__` into
the page it serves and sets `DSH_HUB=1` in the spawned backend's environment.
Without those markers (a bare `dsh web`) the browser half contributes nothing and
the host half registers no quit route.

## Development

```sh
npm test        # quit route gates, bundle format, panel registration, and both exchanges
```
