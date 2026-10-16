/**
 * `dashboard.html` and `options.html` were separate pages until v7.2.0; both are now views of
 * `app.html`. They stay as one-line redirects so a pinned tab, a bookmark or a link from an older
 * release still lands in the right place. `location.replace` keeps them out of the back history.
 */
const settings = window.location.pathname.endsWith('options.html');
const target = settings ? 'app.html#settings' : `app.html${window.location.hash}`;
window.location.replace(chrome.runtime.getURL(target));
