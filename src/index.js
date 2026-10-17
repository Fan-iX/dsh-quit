/**
 * dsh-hub-utils: host half.
 *
 * The feature lives in the browser half (`client/index.js`): a settings section
 * that pins the current instance through dsh-hub's keep-alive route. This host
 * entry exists because the client module registry only adds a package to
 * `__DSH_BOOT__` when a patch row names the package root, and a loader row needs
 * a resolvable module with an `apply`.
 */

/** Unique across the profile: the loader rejects two rows with one id. */
export const id = 'dsh-hub-utils';

/** Nothing to register in the host process: the browser half owns the feature. */
export function apply() {}
