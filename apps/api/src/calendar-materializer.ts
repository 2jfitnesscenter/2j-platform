import type { TransactionSql } from 'postgres';

type MaterializationTransaction = TransactionSql<Record<string, unknown>>;

/** Insert missing concrete occurrences in the next 90 Canary calendar dates. */
export async function materializeCalendarTemplates(tx: MaterializationTransaction, now = new Date()) {
  await tx`SELECT pg_advisory_xact_lock(710030080)`;
  const [window] = await tx`SELECT
    to_char((${now.toISOString()}::timestamptz AT TIME ZONE 'Atlantic/Canary')::date,'YYYY-MM-DD') AS today,
    to_char(((${now.toISOString()}::timestamptz AT TIME ZONE 'Atlantic/Canary')::date) + 90,'YYYY-MM-DD') AS horizon_end`;
  if (!window) throw new Error('Calendar materialization date window could not be computed.');

  const inserted = await tx`
    WITH active_templates AS (
      SELECT t.id,t.service_id,t.area_id,t.professional_id,t.weekday,t.local_start_time,
        t.duration_minutes,t.capacity,t.starts_on,t.ends_on
      FROM recurring_session_templates t
      JOIN services s ON s.id=t.service_id AND s.status='active'
      JOIN areas a ON a.id=t.area_id AND a.status='active'
      LEFT JOIN staff_professionals p ON p.id=t.professional_id
      WHERE t.status='active'
        AND (t.professional_id IS NULL OR p.status='active')
      FOR SHARE OF t
    ), occurrences AS (
      SELECT t.*, dates.local_day::date AS session_date
      FROM active_templates t
      CROSS JOIN LATERAL generate_series(
        GREATEST(t.starts_on,${window.today}::date)::timestamp,
        LEAST(COALESCE(t.ends_on,${window.horizon_end}::date-1),${window.horizon_end}::date-1)::timestamp,
        interval '1 day'
      ) AS dates(local_day)
      WHERE extract(dow FROM dates.local_day)::int=t.weekday
        AND NOT EXISTS (
          SELECT 1 FROM calendar_sessions existing
          WHERE existing.template_id=t.id
            AND (existing.template_occurrence_date=dates.local_day::date
              OR (existing.starts_at AT TIME ZONE 'Atlantic/Canary')::date=dates.local_day::date)
        )
    )
    INSERT INTO calendar_sessions(service_id,area_id,professional_id,template_id,template_occurrence_date,source,starts_at,duration_minutes,capacity,created_by)
    SELECT service_id,area_id,professional_id,id,session_date,'template',
      (session_date+local_start_time) AT TIME ZONE 'Atlantic/Canary',duration_minutes,capacity,'system:calendar-materializer'
    FROM occurrences
    ON CONFLICT DO NOTHING
    RETURNING id,template_id,starts_at
  `;

  for (const session of inserted) {
    const startsAtIso = session.starts_at instanceof Date ? session.starts_at.toISOString() : String(session.starts_at);
    const localDate = await tx`SELECT to_char(${startsAtIso}::timestamptz AT TIME ZONE 'Atlantic/Canary','YYYY-MM-DD') AS value`;
    await tx.unsafe(
      "INSERT INTO calendar_audit_events(actor_id,action,resource_type,resource_id,session_id,details) VALUES ($1,'session.generated','calendar_session',$2,$2,($3::text)::jsonb)",
      ['system:calendar-materializer', session.id, JSON.stringify({ templateId: session.template_id, sessionDate: localDate[0]!.value, source: 'rolling_horizon' })],
    );
  }
  return { created: inserted.length, today: window.today, horizonEndExclusive: window.horizon_end };
}
