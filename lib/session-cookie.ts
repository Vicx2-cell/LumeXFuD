// Single source of truth for the session cookie NAME. Every reader and writer
// (proxy, getCurrentUser, login, logout, OTP/social/google/webauthn, account)
// imports this — no copied ternaries, so the mint/read/clear names can never
// drift out of sync.
//
// Production uses the `__Host-` prefix. A `__Host-` cookie is only accepted by
// the browser when it is Secure, Path=/, and has NO Domain attribute — which
// blocks a sibling subdomain or a network MITM from fixating/overwriting the
// session cookie. The prefix REQUIRES HTTPS, so local/dev http falls back to a
// bare name. (One-time effect on deploy: existing `session` cookies stop being
// read, so everyone re-logs in once — accepted trade-off.)
export function sessionCookieName(): string {
  return process.env.NODE_ENV === 'production' ? '__Host-session' : 'session'
}
