# Member sessions eligibility contract v1

`GET /api/me/sessions?from=YYYY-MM-DD&to=YYYY-MM-DD` continues to return the existing `timezone` and `sessions` fields. Each session now also includes:

```ts
type AvailabilityStatus =
  | 'available'
  | 'full'
  | 'booked'
  | 'not_allowed_by_plan'
  | 'waitlisted'
  | 'waitlist_suspended';

type SessionAvailability = {
  status: AvailabilityStatus;
  reason: string | null;
  canJoinWaitlist: boolean;
};
```

The field is additive so older clients can ignore it. The server computes it for the authenticated client in the list response; clients do not need a session-detail request per card. Each session's `availability` is a `SessionAvailability` object. `reason` is `null` for `available`, `full`, `booked`, and `waitlisted`. For `not_allowed_by_plan` and non-payment `waitlist_suspended`, it contains the existing booking-eligibility reason code, such as `service_not_allowed`, `no_entitlement`, or `entitlement_exhausted`. A suspended waitlist caused only by a payment restriction keeps `reason: null`, so session availability does not expose the member's payment state.

State precedence is: an existing active reservation is `booked`; an active waitlist entry is `waitlisted` while eligibility remains valid and `waitlist_suspended` when it does not; otherwise a session at capacity is `full`; remaining sessions are `available` or `not_allowed_by_plan` according to the authoritative eligibility resolver. Waitlist suspension is derived for this response and does not mutate the waitlist entry.

The response does not expose internal waitlist-entry IDs or client PII. The session-detail endpoint and booking mutation authorization remain unchanged.
