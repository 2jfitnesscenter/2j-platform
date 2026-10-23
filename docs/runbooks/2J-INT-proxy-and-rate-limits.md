# 2J-INT — Client IP, rate limits and Caddy (configuration guidance, nothing applied)

Status: **documentation only.** No Caddy, DNS, Contabo or production change was made. Apply it only when a later, explicitly approved phase exposes these services.

## What the code does today

| Service | Where the client IP comes from | Effect behind a proxy |
|---|---|---|
| Platform API (`apps/api`) | Fastify `request.ip`. By default **no proxy is trusted** (`trustProxy: false`), so `request.ip` is the socket peer and `X-Forwarded-*` is ignored. | Every request that arrives through Caddy shares one rate-limit bucket (the proxy's address). Spoofing cannot evade a limit, but real clients share it. |
| Platform API, with `PLATFORM_TRUSTED_PROXIES` | The rightmost `X-Forwarded-For` entry that is **not** a trusted proxy. `X-Forwarded-Proto` is honoured only from a trusted peer (so the session cookie is `Secure` behind TLS termination). | Each real client gets its own bucket; a forged leftmost entry changes nothing; a peer that is not listed cannot make the server believe its headers. |
| Búnker API (`api/bunker/rate-limit.js` → `bunkerClientIp`) | `TRUSTED_PROXIES` unset (default, legacy): if the direct peer is a private address, the **first** `X-Forwarded-For` hop; otherwise the peer address. `TRUSTED_PROXIES` set: only listed peers are believed and the client is the rightmost non-proxy hop. | Correct only if the public edge **overwrites** `X-Forwarded-For`. If it forwards a client-supplied value, an attacker can pick the leftmost entry and evade the PIN/auth limiters. |

`PLATFORM_TRUSTED_PROXIES` (Platform) accepts a comma-separated list of at most four exact addresses or CIDRs no wider than /16 (IPv4) or /64 (IPv6). `0.0.0.0/0`, `::/0`, `true` and hostnames are rejected at start-up, so a typo can never trust the internet. Leave it empty unless a proxy really sits in front.

## Safe Caddy configuration

The public edge must set the forwarding headers itself instead of passing client-supplied ones.

```caddy
# Platform (loopback-only API behind Caddy on the same host)
platform.example {
    reverse_proxy 127.0.0.1:3100 {
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }
}

# Búnker (Caddy -> web nginx -> api). nginx appends its peer; the FIRST hop is therefore the client Caddy saw.
gym.example {
    reverse_proxy localhost:8080 {
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }
}
```

Rules:
- Do **not** add `servers { trusted_proxies … }` on the public edge. If the site later sits behind another CDN or tunnel, list only that provider's published ranges and switch to its client-IP header; never `0.0.0.0/0`.
- Keep `web/nginx.conf` as is (`X-Forwarded-For $proxy_add_x_forwarded_for`): it only appends. Do not replace it with a pass-through of an untrusted hop.
- Platform: set `PLATFORM_TRUSTED_PROXIES=127.0.0.1` (Caddy on the same host) and keep the API bound to loopback. Never set it to a wide network.
- Do not expose the Platform or Búnker API container ports directly to the internet; only Caddy.

## Búnker: do not infer "Caddy" from "private address"

A private source address proves nothing: another container on the compose network, a host on the gym LAN or a compromised neighbour is private too. The legacy Búnker rule (`TRUSTED_PROXIES` unset) believes **any** private peer and takes the **first** `X-Forwarded-For` hop; it is only correct when every private peer is our nginx and the edge overwrites the header. It is kept as the default so nothing changes by itself.

Required configuration before exposing Búnker (branch `2J-INT-BUNKER-CLOSURE`, `api/bunker/rate-limit.js`):

1. Pin the compose network subnet (for example `172.28.0.0/24`) so the proxy addresses are known and stable.
2. Set `TRUSTED_PROXIES` to exactly the proxies in the chain: the subnet/addresses of the nginx container and the address Caddy connects **from** (the docker gateway if Caddy runs on the host). Example: `TRUSTED_PROXIES=172.28.0.0/24`. IPv4 networks must be /8 to /32; IPv6 only exact addresses; anything else stops the start-up.
3. With the list set, only a direct peer inside it is believed and the client is the **rightmost address that is not a trusted proxy**. A forged leftmost entry is ignored even if Caddy forwarded client-supplied headers; a peer outside the list is keyed by its own address.
4. Keep Caddy's `header_up X-Forwarded-For {remote_host}` anyway (defence in depth) and never `trusted_proxies` on the public edge.
5. Do not publish the API or nginx container ports outside the compose network except through Caddy.

## Tests that must pass before production (staging, from outside the host)

| # | Test | Expected |
|---|---|---|
| 1 | `curl -H 'X-Forwarded-For: 1.2.3.4' https://<host>/api/health` from a known address | limiter/log key is **your** address, never `1.2.3.4` |
| 2 | Repeat failed kiosk-PIN / login attempts while rotating a forged `X-Forwarded-For` | still blocked after the configured limit |
| 3 | Same attempts from a second real address | has its own bucket (not blocked by the first) |
| 4 | From another container on the compose network (not nginx) send a forged header to the API port | keyed by that container's own address |
| 5 | Start the API with `TRUSTED_PROXIES=0.0.0.0/0` or a malformed value | refuses to start |
| 6 | After a passkey/SSO sign-in | `Set-Cookie` has `Secure; HttpOnly; SameSite=Lax` |
| 7 | Platform with `PLATFORM_TRUSTED_PROXIES=127.0.0.1`: forged leftmost entries from the proxy | ignored; untrusted peers' headers ignored |
| 8 | Run `npm test` (Búnker) and the Platform `platform-passkeys` suite | green |

Automated evidence: Búnker `api/test/bunker-rate-limit.test.js` ("TRUSTED_PROXIES: only listed proxies are believed…"), Platform `apps/api/test/platform-passkeys.test.mjs` (trusted proxies). Tests 1–6 are manual staging checks that no automated test can replace.

## How to verify (staging, after an approved change)

1. `curl -H 'X-Forwarded-For: 1.2.3.4' https://<host>/api/health` from a known address; the application log / limiter key must show **your** address, not `1.2.3.4`.
2. Send more than the limit of failed attempts while rotating a forged `X-Forwarded-For`; the limiter must still block.
3. After a passkey/SSO sign-in the `Set-Cookie` header must contain `Secure; HttpOnly; SameSite=Lax`.

## Test evidence

`apps/api/test/platform-passkeys.test.mjs` — trusted-proxy parsing (wide/ambiguous values rejected), forged `X-Forwarded-For` ignored by default and behind a trusted hop, an untrusted peer not believed, `Secure` cookie only via a trusted proxy.
Búnker `api/test/bunker-rate-limit.test.js` — first forwarded hop honoured only from a private peer.
