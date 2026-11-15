# Public judge sandbox deployment

## Current status

The public judge sandbox is live at
https://junction-repo-production.up.railway.app in Railway project
`truthful-cat`, service `junction-repo`. The deployment uses a 500 MB persistent
volume because that is the current plan's volume limit. The full catalogue is
bundled with the app, so the volume holds the business database and ledger.
Health, catalogue count, public demo sign-in, storefront context, and a read-only
Valio challenge offer lookup were verified on 15 November 2026. The complete
remote purchasing journey was not written to the shared public ledger during
verification.

This Railway profile hosts the complete supplied 17,546-record catalogue and the
webshop, purchasing agent, MCP gateway, approval workspace, and simulated order
ledger in one service. With `MOCK_VALIO=false`, the gateway uses Valio's hosted
Junction challenge API for price and availability lookups. Those upstream values
are challenge data, not commercial supplier data. The repository has no live
supplier order-placement adapter: proposals, approvals, and orders are recorded
only in this application's database and ledger.

## Public access boundary

`PUBLIC_DEMO_MODE=true` is for a shared judge sandbox only. Visitors can enter the
workspace, submit proposals, review approvals, and create simulated orders. The
dataset and purchasing ledger are shared between visitors. The login screen warns
users not to enter confidential information. Rate limits use Railway's
`X-Real-IP` header and cap both individual clients and aggregate routes.

Keep `DEMO_MODE=false` in production. The gateway still requires distinct random
`ADMIN_TOKEN` and `AGENT_TOKEN` values of at least 32 characters. The public
browser never receives either value; server routes use them to call the gateway.
`VALIO_API_KEY` and `GEMINI_API_KEY` are server-side Railway variables only. Do
not place secrets in `.railway/railway.ts`, source control, or browser variables.

This setup is not suitable for real customer purchasing. It has no buyer SSO,
tenant separation for public visitors, production support controls, supplier
order writes, or customer notification integration. Disable public access and
configure buyer identity, access scopes, tenant storage, retention, backups,
monitoring, and a privacy review before connecting real customer workspaces.

## Railway resources

`.railway/railway.ts` defines one service (`junction-repo`) and a 500 MB
persistent volume mounted at `/data`. The existing PGlite business database and
signing keys persist there. Keep one app replica: the embedded store and demo
ledger are single-instance. The public judge sandbox uses the bounded
full-catalogue search path with advisory Gemini intent; it does not start the
optional PGlite full-text/vector index. That index remains lazy for local
environments. The optional embedding cache is not required for the public
catalogue search.

The service receives HTTP on port 4000. Hono serves the gateway APIs and forwards
page requests to the private Next.js listener on 3100. HTTPS terminates at
Railway. `RAILWAY_PUBLIC_DOMAIN` supplies the public origin for browser origin
checks and agent discovery.

## Deploy/update

1. Push the reviewed source to the configured GitHub branch (`main`).
2. Link Railway project `truthful-cat`, service `junction-repo`, then preview
   `.railway/railway.ts` with `railway config plan` before applying updates.
3. Set `ADMIN_TOKEN` and `AGENT_TOKEN` to different random values of at least 32
   characters. Set `VALIO_API_KEY` from the Junction platform and optionally
   `GEMINI_API_KEY` for structured request interpretation. Set secrets through
   Railway variables or `railway variable set NAME --stdin`; never print secret
   variable output.
4. The public service domain is already generated on port 4000. Railway builds
   deploy automatically from the configured GitHub branch.
5. Verify `/health`, the catalogue count, the storefront search, the
   `/operations` public-sandbox sign-in, a Valio challenge offer lookup, one
   proposal, a human review, and a simulated order. Check that an unknown Valio
   lookup fails visibly and never silently switches to fixture prices.

Railway Hobby is currently $5/month with $5 of monthly usage included; resource
usage above that amount is billed separately ([Railway pricing](https://docs.railway.com/pricing/plans)). A persistent volume and a
continuously running service add usage. Review Railway's usage page after the
first day and before leaving the demo online long term.
