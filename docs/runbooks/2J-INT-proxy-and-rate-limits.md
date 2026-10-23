# 2J-INT — Client IP, rate limits and Caddy (configuration guidance, nothing applied)

Status: **documentation only.** No Caddy, DNS, Contabo or production change was made. Apply it only when a later, explicitly approved phase exposes these services.

## What the code does today

| Service | Where the client IP comes from | Effect behind a proxy |
|---|---|---|
| Platform API (`apps/api`) | Fastify `request.ip`. By default **no proxy is trusted** (`trustProxy: false`), so `request.ip` is the socket peer and `X-Forwarded-*` is ignored. | Every request that arrives through Caddy shares one rate-limit bucket (the proxy's address). Spoofing cannot evade a limit, but real clients share it. |
| Platform API, with `PLATFORM_TRUSTED_PROXIES` | The rightmost `X-Forwarded-For` entry that is **not** a trusted proxy. `X-Forwarded-Proto` is honoured only from a trusted peer (so the session cookie is `Secure` behind TLS termination). | Each real client gets its own bucket; a forged leftmost entry changes nothing; a peer that is not listed cannot make the server believe its headers. |
| Búnker API (`api/bunker/rate-limit.js` → `bunkerClientIp`) | If the direct peer is a private address (the compose network), the **first** `X-Forwarded-For` hop; otherwise the peer address, ignoring the header. | Correct only if the public edge **overwrites** `X-Forwarded-For`. If it forwards a client-supplied value, an attacker can pick the leftmost entry and evade the PIN/auth limiters. |

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

## How to verify (staging, after an approved change)

1. `curl -H 'X-Forwarded-For: 1.2.3.4' https://<host>/api/health` from a known address; the application log / limiter key must show **your** address, not `1.2.3.4`.
2. Send more than the limit of failed attempts while rotating a forged `X-Forwarded-For`; the limiter must still block.
3. After a passkey/SSO sign-in the `Set-Cookie` header must contain `Secure; HttpOnly; SameSite=Lax`.

## Test evidence

`apps/api/test/platform-passkeys.test.mjs` — trusted-proxy parsing (wide/ambiguous values rejected), forged `X-Forwarded-For` ignored by default and behind a trusted hop, an untrusted peer not believed, `Secure` cookie only via a trusted proxy.
Búnker `api/test/bunker-rate-limit.test.js` — first forwarded hop honoured only from a private peer.
