# DEMO APP STAFF — TRAINER

Requires a real test Trainer account with `calendar.read`, `clients.read`, `reservations.attendance`, `entitlements.read`, `communication.read`, `communication.send`, and `timeclock.self` as applicable. No fixture role switcher is provided.

1. Sign in through the central staff session on the configured API origin.
2. Home shows today’s next session and compact day list; Agenda selects a day.
3. Open a session; review the roster and waitlist; mark a booking attended/no-show and confirm the refreshed state.
4. Use client search and open the compact client profile; review rights only when server capability allows it.
5. Open Messages, choose the existing conversation and send a text when `communication.send` is granted.
6. Open More → Fichaje and register the server-resolved personal clock-out.

Run evidence: not executed with a real staff login for this PR; do not treat this script as proof of production SSO compatibility.
