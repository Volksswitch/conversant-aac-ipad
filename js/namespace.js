/*
 * namespace.js — keeps two deployments on the same origin out of each other's data.
 *
 * GitHub Pages serves every project of an account from ONE origin
 * (volksswitch.github.io), separated only by path. But localStorage, IndexedDB,
 * OPFS, Cache Storage and the storage-persistence grant are all scoped to the
 * ORIGIN, not the path. So two Conversant deployments sitting side by side —
 * /conversant-aac/ (what testers use) and /conversant-aac-ipad/ (the trial) —
 * would silently share one set of settings, one worldview profile, and one data
 * folder. An experimental branch build could then corrupt the data behind the
 * app people are evaluating, which is the one outcome worth engineering against.
 *
 * The fix is to give the trial deployment its own key prefix and its own data
 * subdirectory. It is DERIVED FROM THE URL rather than set by a build flag, for
 * two reasons: nothing has to be configured or remembered, and merging this
 * branch into main is harmless — the code is inert unless it is actually being
 * served from the trial path.
 *
 * Production and local development are deliberately left UNPREFIXED, so existing
 * users' data keeps working exactly as before. This must stay true: prefixing the
 * production path would orphan every current tester's profile.
 *
 * This is a temporary measure. Once iPad support merges into the single shipping
 * app there is only one deployment and nothing to separate; at that point delete
 * TRIAL_PATHS and this whole module folds away.
 */

// Path segments that identify a side-by-side trial deployment. Anything not
// listed here gets no prefix.
const TRIAL_PATHS = {
    'conversant-aac-ipad': 'ipad',
};

// Pure and exported so the mapping can be unit-tested without a browser — the
// consequence of getting it wrong (prefixing production) is orphaning every
// existing tester's profile, which is worth a test rather than an inspection.
export function namespaceForPath(pathname) {
    const first = String(pathname || '').split('/').filter(Boolean)[0] || '';
    return TRIAL_PATHS[first] || '';
}

function detect() {
    try {
        return namespaceForPath(location.pathname);
    } catch {
        return '';     // no location (unit tests / workers) → production behavior
    }
}

export const NAMESPACE = detect();

// Prefix a storage key. Unprefixed (identical to before) in production.
export function key(base) {
    return NAMESPACE ? `${NAMESPACE}:${base}` : base;
}

// Subdirectory the data folder should live in, or null for the root. Keeps the
// trial's worldview.json / conversations / settings out of the real data folder
// on desktop, and out of the production app's OPFS on a tablet.
export function dataSubdir() {
    return NAMESPACE || null;
}

export function isTrial() {
    return NAMESPACE !== '';
}
