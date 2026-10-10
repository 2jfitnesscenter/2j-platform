import { createDatabase } from '../src/db.js';
import { dispatchNotificationBatch, enqueueDueBookingReminders } from '../src/notifications.js';

const { client } = createDatabase();
let stopping = false;
for (const signal of ['SIGINT','SIGTERM'] as const) process.once(signal, () => { stopping = true; });
while (!stopping) {
  try {
    await enqueueDueBookingReminders(client);
    await dispatchNotificationBatch(client, 50);
  } catch (error) {
    // Intentionally log only the failure class: never event payloads or recipient data.
    console.error('notification_worker_cycle_failed', error instanceof Error ? error.name : 'unknown');
  }
  if (!stopping) await new Promise((resolve) => setTimeout(resolve, 15_000));
}
await client.end();
