/**
 * API base URL — always use the HTTP server, never file://
 * Access the app at: http://localhost:3001/
 */
(function () {
    // If opened as file://, redirect to the HTTP server automatically
    if (window.location.protocol === 'file:') {
        const page = window.location.pathname.split('/').pop() || 'dashboard.html';
        window.location.replace('http://127.0.0.1:3001/' + page + window.location.search);
    }
})();

window.PORTAL_API_BASE = 'http://127.0.0.1:3001/api';
// window.PORTAL_API_BASE = 'http://192.168.80.252:3001/api';
