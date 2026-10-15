// email-worker (design 07 section 1.4 / 1.6, migration m62): delivers the rows of app_private.email_outbox through the Gmail API, one message per recipient,
// as the acting PM's connected account (fallback: the startups@ system sender). Scheduled by pg_cron + pg_net (every minute) and kicked by "Send now".
//
// Deploy WITHOUT the gateway JWT check (`--no-verify-jwt`, or `[functions.email-worker] verify_jwt = false`): the caller is the database, not a user. The
// function checks its own secret (EMAIL_WORKER_SECRET, header `x-worker-secret`; or the service role key as a Bearer token) before it does anything and is
// closed when none is configured. README.md next to this file: env names, scheduling, the local run, what each outcome means.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { createEdgeRuntime } from '../_shared/google-edge.js'
import { createEmailWorkerHandler } from '../_shared/email-worker-edge.js'

const handle = createEmailWorkerHandler({ env: Deno.env, createClient, createEdgeRuntime })
Deno.serve((req: Request) => handle(req))
