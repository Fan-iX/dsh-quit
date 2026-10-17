# dsh-hub-utils

A **Settings → dsh-hub** section that pins the current dsh instance, so
[dsh-hub](https://github.com/Fan-iX/dsh-hub) keeps it running after the browser
page closes.

dsh-hub reaps an instance once it has been idle for `IDLE_CULL_MS` (four hours by
default). An attached event stream already counts as activity, so a browser that
is watching keeps the instance alive — but closing the page ends that. With this
switch on, the hub exempts the instance from the culler until you switch it off
or the instance is replaced.

## Install

```sh
dsh plugin --profile web add /path/to/dsh-hub-utils
```

Restart the instance once by hand (or use the dsh-quit button), so the host row
and the browser bundle load. From then on the section appears in the settings
panel.

## Use

Open **Settings → dsh-hub** and turn on **Keep this instance running**. The
section reads the current state from the hub when it opens, so a reload shows
the truth rather than a guessed default.

| | |
| --- | --- |
| Does | tell dsh-hub that this instance must not be reaped while idle (`POST /hub/api/keepalive`) |
| Does | reset to off when the instance is replaced (a new process, a restart, a hub restart) |
| Does not | keep the *session* itself alive; it only stops dsh-hub from stopping an idle process |
| Does not | work without dsh-hub: a bare `dsh web` answers the route with a non-JSON response and the section says the control is unavailable |

## Hub contract

The section talks to the hub over same-origin `fetch`, with the hub session
cookie attached automatically:

- `GET /hub/api/keepalive` → `{ "keepAlive": boolean, "running": boolean }`
- `POST /hub/api/keepalive` with `content-type: application/json` and
  `{ "keepAlive": boolean }` → the same JSON

The route is only registered by dsh-hub. It requires an authenticated hub
session, and the JSON content type is the CSRF guard (the session cookie is
`SameSite=Lax`, and a cross-site form cannot send `application/json` without a
preflight). The flag lives on the hub's per-user backend object, so it applies to
the current instance only.

## What the browser half needs

The bundle is hand-written in the runtime's dynamic-bundle format
(`window.__ModuleLoader__.load`) and requires only baseline modules: `react`,
`react/jsx-runtime`, and `@deepseek-ai/dsh-client-ui-primitives`. It registers
one `settings.section` entry (`id: dsh-hub`, order 90) with its own locale
namespace, so the copy follows the app's language.

## Development

```sh
npm test        # bundle format, registration, and the read/toggle exchange
```
