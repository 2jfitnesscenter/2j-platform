import { createDatabase } from '../src/db.js';
import { dispatchNotificationBatch, enqueueDueBookingReminders, enqueueMembershipPaymentDueNotices } from '../src/notifications.js';
import { materializeRecurringEntitlementPeriods } from '../src/assignment-periods.js';
import { cancelUncoveredPeriodBookings } from '../src/membership-period-enforcement.js';
import { materializeAutomaticRenewals } from '../src/auto-renewal.js';

const { client } = createDatabase();
let stopping = false;
for (const signal of ['SIGINT','SIGTERM'] as const) process.once(signal, () => { stopping = true; });
while (!stopping) {
  try {
    await enqueueDueBookingReminders(client);
    await enqueueMembershipPaymentDueNotices(client);
    await materializeRecurringEntitlementPeriods(client);
    await cancelUncoveredPeriodBookings(client);
    await materializeAutomaticRenewals(client);
    await dispatchNotificationBatch(client, 50);
  } catch (error) {
    // Intentionally log only the failure class: never event payloads or recipient data.
    console.error('notification_worker_cycle_failed', error instanceof Error ? error.name : 'unknown');
  }
  if (!stopping) await new Promise((resolve) => setTimeout(resolve, 15_000));
}
await client.end();
