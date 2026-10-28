import { randomUUID } from 'node:crypto';

const keys=['coin_0_01','coin_0_02','coin_0_05','coin_0_10','coin_0_20','coin_0_50','coin_1','coin_2','bill_5','bill_10','bill_20','bill_50','bill_100','bill_200','bill_500'];
const zeroCount=Object.fromEntries(keys.map(key=>[key,0]));

/** Synthetic session/custody fixture for legacy API tests; dedicated cash-flow tests use the public clock/open APIs. */
export async function ensureCashSessionForActor(sql, actorId) {
  return sql.begin(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(hashtext('2j-economic-register-operations'))`;
    let [professional]=await tx`SELECT id FROM staff_professionals WHERE auth_actor_id=${actorId} AND status='active'`;
    if(!professional) [professional]=await tx`INSERT INTO staff_professionals(first_name,last_name,display_name,base_role,auth_actor_id,created_by) VALUES ('QA','Caja',${`QA caja ${randomUUID()}`},'admin',${actorId},'test-fixture') RETURNING id`;
    const [lastClockEvent]=await tx`SELECT event_type FROM staff_timeclock_events WHERE professional_id=${professional.id} ORDER BY occurred_at DESC,id DESC LIMIT 1`;
    if(lastClockEvent?.event_type!=='clock_in') await tx`INSERT INTO staff_timeclock_events(professional_id,event_type,origin,actor_id) VALUES (${professional.id},'clock_in','web',${actorId})`;
    await tx`UPDATE economic_cash_custodies SET ended_at=now(),ended_reason='owner_resolution',ended_by=${actorId}
      WHERE actor_id=${actorId} AND ended_at IS NULL`;
    let [session]=await tx`SELECT id FROM economic_cash_sessions WHERE status='open' AND register_id IS NOT NULL
      AND local_date=(now() AT TIME ZONE 'Atlantic/Canary')::date ORDER BY opened_at LIMIT 1`;
    if(!session){
      [session]=await tx`SELECT id,status,register_id AS "registerId",local_date::text AS "localDate" FROM economic_cash_sessions WHERE register_id IS NOT NULL
        AND local_date=(now() AT TIME ZONE 'Atlantic/Canary')::date ORDER BY opened_at DESC LIMIT 1 FOR UPDATE`;
      if(session){
        if(!['closed','late_close'].includes(session.status)) throw new Error('unexpected current-day cash session state in test fixture');
        await tx`SELECT set_config('twoj.cash_reopen_actor','test-fixture-owner',true)`;
        await tx`INSERT INTO economic_audit_events(actor_id,action,resource_type,resource_id,details)
          VALUES ('test-fixture-owner','cash.reopened','cash_session',${session.id},${tx.json({registerId:session.registerId,localDate:session.localDate,custodianActorId:actorId,openingCents:0,openingDenominations:zeroCount,reason:'Synthetic test fixture reset'})})`;
        await tx`UPDATE economic_cash_sessions SET status='open',closed_at=NULL,closed_by=NULL,expected_cents=NULL,counted_cents=NULL,counted_denominations=NULL,difference_cents=NULL,close_kind=NULL WHERE id=${session.id}`;
      }else{
        const [register]=await tx`SELECT id FROM economic_cash_registers WHERE code='bunker'`;
        [session]=await tx`INSERT INTO economic_cash_sessions(register_id,local_date,opening_cents,opening_denominations,opened_by)
          VALUES (${register.id},(now() AT TIME ZONE 'Atlantic/Canary')::date,0,${tx.json(zeroCount)},${actorId}) RETURNING id`;
      }
    }
    await tx`UPDATE economic_cash_custodies SET ended_at=now(),ended_reason='owner_resolution',ended_by=${actorId}
      WHERE cash_session_id=${session.id} AND ended_at IS NULL AND actor_id<>${actorId}`;
    const [active]=await tx`SELECT id FROM economic_cash_custodies WHERE cash_session_id=${session.id} AND actor_id=${actorId} AND ended_at IS NULL`;
    if(!active) await tx`INSERT INTO economic_cash_custodies(cash_session_id,professional_id,actor_id) VALUES (${session.id},${professional.id},${actorId})`;
    return session;
  });
}
