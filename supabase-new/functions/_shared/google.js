// The Google integration library (design 07). ONE import for the functions that come after this one (the e-mail worker, the
// calendar sync): `import { ... } from '../_shared/google.js'`. All of it is pure ESM without Deno-only APIs.
//
//   google-core.js           errors, config (env only), signed OAuth state, PKCE, auth URL, token calls, ID token, AES-256-GCM, token store
//   google-mime.js           makeMimeMessage (RFC 5322 / 2045 / 2047, Arabic subjects, header-injection safe)
//   google-calendar.js       event id (hex of the booking uuid), project-zone times, attendees, insert / patch bodies, Meet modes
//   google-api.js            Gmail send + Calendar insert (adopt on 409) / get / patch / delete / wait-for-Meet
//   google-sender.js         resolveSender (acting PM -> system -> nobody)
//   google-oauth-handlers.js the three OAuth endpoints as testable handlers
//   google-edge.js           service-role RPC adapter + runtime wiring for the Edge Runtime

export * from './google-core.js'
export * from './google-mime.js'
export * from './google-calendar.js'
export * from './google-api.js'
export * from './google-sender.js'
export * from './google-oauth-handlers.js'
export * from './google-edge.js'
