// -------------------------------------------------------------
// Global API configuration + fetch helper.
// This file is loaded FIRST (before auth.js and script.js), which
// both rely on window.API_BASE_URL and window.apiFetch defined here.
// -------------------------------------------------------------

// When the page is opened through VS Code Live Server (:5500 / :5501) the
// Express API is NOT on that port, so talk to the API server directly.
// When the page is served by server.js itself every request is same-origin.
//
// NOTE: this project's API server runs on port 3007 (port 3000 is taken by a
// separate process on this machine). Start it with:  npm start   (or:
// PORT=3007 node server.js). Change API_PORT here if you run it elsewhere.
(function () {
    const API_PORT = '3007';
    const STATIC_DEV_PORTS = ['5500', '5501'];
    window.API_BASE_URL = STATIC_DEV_PORTS.includes(window.location.port)
        ? `${window.location.protocol}//${window.location.hostname}:${API_PORT}`
        : window.location.origin;
})();

/**
 * Thin wrapper around fetch for the Ceekay JSON API.
 *  - prefixes window.API_BASE_URL
 *  - always sends cookies (credentials: 'include')
 *  - JSON-encodes a plain-object body and sets Content-Type
 *  - parses the JSON response and throws Error(payload.error) on non-2xx
 */
window.apiFetch = async function apiFetch(path, options = {}) {
    const opts = { credentials: 'include', ...options };
    opts.headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };

    if (opts.body && typeof opts.body !== 'string') {
        opts.body = JSON.stringify(opts.body);
    }

    const res = await fetch(`${window.API_BASE_URL}${path}`, opts);

    let data = null;
    try { data = await res.json(); } catch (_) { /* empty / non-JSON body */ }

    if (!res.ok) {
        const message = (data && (data.error || data.message)) || `Request failed (${res.status})`;
        throw new Error(message);
    }
    return data;
};
