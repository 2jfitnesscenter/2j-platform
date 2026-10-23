# Member sessions eligibility contract v1

`GET /api/me/sessions?from=YYYY-MM-DD&to=YYYY-MM-DD` continues to return the existing `timezone` and `sessions` fields. Each session now also includes:

```ts
type Availability =
  | 'available'
  | 'full'
  | 'booked'
  | 'not_allowed_by_plan'
  | 'waitlisted'
  | 'waitlist_suspended';

type SessionAvailability = {
  availability?: Availability;
  availabilityReason?: string | null;
};
```

The fields are additive so older clients can ignore them. The server computes them for the authenticated client in the list response; clients do not need a session-detail request per card. `availabilityReason` is `null` for `available`, `full`, `booked`, and `waitlisted`. For `not_allowed_by_plan` and `waitlist_suspended`, it contains the existing booking-eligibility reason code, such as `service_not_allowed`, `no_entitlement`, `debt_restriction`, or `entitlement_exhausted`.

State precedence is: an existing active reservation is `booked`; an active waitlist entry is `waitlisted` while eligibility remains valid and `waitlist_suspended` with its reason if not; otherwise a session at capacity is `full`; remaining sessions are `available` or `not_allowed_by_plan` according to the authoritative eligibility resolver. Waitlist suspension is derived for this response and does not mutate the waitlist entry.

The response does not expose internal waitlist-entry IDs or client PII. The session-detail endpoint and booking mutation authorization remain unchanged.
