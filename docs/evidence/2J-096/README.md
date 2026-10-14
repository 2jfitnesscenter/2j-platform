# 2J-096 visual and accessibility evidence

## Capture setup

Captures were made from the running Admin Web app in Chrome against the disposable local PostgreSQL database on loopback, using only the deterministic synthetic `seed:demo` dataset. The local API used the development-only Admin demo role; no real client or production data was used. The existing pilot database/container and `2jfitnessapp` were not touched.

The browser viewport sizes are 1440×900, 768×1024, and 390×844. Screenshots are real browser captures, not mockups.

## Captures

| View | Screenshot |
|---|---|
| Client list, desktop 1440×900 | `admin-clients-1440x900.png` |
| Client list, tablet 768×1024 | `admin-clients-768x1024.png` |
| Client list, mobile 390×844 | `admin-clients-390x844.png` |
| Client 360, desktop 1440×900 | `admin-client-360-1440x900.png` |
| Client 360, mobile 390×844 | `admin-client-360-390x844.png` |

## Observations

- The list presents a clear name-first directory with status filtering, server-backed search, result count, and load-more affordance. Contact values are absent.
- Client 360 uses a distinct profile heading and a horizontally scrollable, keyboard-operable section strip. Only current backed sections are present; no Training, Health, or Progress placeholder is shown.
- The Summary uses current Platform reservation and entitlement data. In the synthetic profile capture, the profile has one reservation and an active session entitlement.
- Tablet/mobile content is stacked; narrow actions are full-width and the profile heading no longer squeezes the client name between controls.
- At all three viewports, document scroll width does not exceed its viewport. The shell navigation and Client 360 section strip use their own intentional horizontal scrolling regions at narrow widths.
- Existing focus-visible treatment is retained. Tabs expose selected state and associated panel semantics; navigation is keyboard supported.
- No personal contact values or economic amounts are included in the screenshot set.
- Dark-mode visual QA is unavailable in the current Admin shell: no existing runtime theme toggle or root dark-theme selector is present in this branch. No theme control or product behavior was added to satisfy a QA-only request.
- These captures cover the main list and profile-summary states. They do not claim visual coverage of every tab, modal, loading/error state, or a Trainer screenshot; those behaviors are covered by targeted tests where applicable.
