import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import { buildServer } from "../src/server.ts";
import { migrateDatabase } from "../src/migrate.ts";

if (!process.env.DATABASE_URL)
  throw new Error(
    "DATABASE_URL is required: PostgreSQL integration tests cannot be skipped.",
  );
const sql = postgres(process.env.DATABASE_URL, { max: 8, connect_timeout: 5 });
await migrateDatabase(sql);
let clientId = "";
const testOwnedRequirementIds = new Set();
const admin = buildServer(process.env.DATABASE_URL, {
  authorizationResolver: async () => ({ actorId: "comm-admin", role: "admin" }),
});
const trainer = buildServer(process.env.DATABASE_URL, {
  authorizationResolver: async () => ({
    actorId: "comm-trainer",
    role: "trainer",
  }),
});
const reception = buildServer(process.env.DATABASE_URL, {
  authorizationResolver: async () => ({
    actorId: "comm-reception",
    role: "reception-management",
  }),
});
const accountant = buildServer(process.env.DATABASE_URL, {
  authorizationResolver: async () => ({
    actorId: "comm-accountant",
    role: "accountant",
  }),
});
const portal = buildServer(process.env.DATABASE_URL, {
  clientAuthorizationResolver: async () => (clientId ? { clientId } : null),
});
const bookingAdmin = buildServer(process.env.DATABASE_URL, {
  authorizationResolver: async () => ({
    actorId: "comm-booking-admin",
    role: "admin",
  }),
  bookingEligibilityResolver: async () => ({
    eligible: true,
    entitlementId: "qa-entitlement",
  }),
});
const bookingTrainer = buildServer(process.env.DATABASE_URL, {
  authorizationResolver: async () => ({
    actorId: "comm-booking-trainer",
    role: "trainer",
  }),
  bookingEligibilityResolver: async () => ({
    eligible: true,
    entitlementId: "qa-entitlement",
  }),
});
after(async () => {
  try {
    if (testOwnedRequirementIds.size) {
      await sql`UPDATE document_requirements
        SET active=false, archived_at=COALESCE(archived_at,now()), updated_at=now()
        WHERE id IN ${sql([...testOwnedRequirementIds])} AND active=true`;
    }
  } finally {
    await Promise.all([
      admin.close(),
      trainer.close(),
      reception.close(),
      accountant.close(),
      portal.close(),
      bookingAdmin.close(),
      bookingTrainer.close(),
      sql.end(),
    ]);
  }
});
async function createClient() {
  const response = await admin.inject({
    method: "POST",
    url: "/api/clients",
    headers: { "idempotency-key": randomUUID() },
    payload: {
      firstName: "Cliente",
      lastName: `Comunicaciones ${randomUUID()}`,
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  clientId = response.json().id;
  return clientId;
}

test("center conversation is shared, internal notes stay staff-only and duplicate sends are idempotent", async () => {
  const id = await createClient();
  assert.equal(
    (
      await accountant.inject({
        method: "GET",
        url: "/api/communications/inbox",
      })
    ).statusCode,
    403,
  );
  const start = await portal.inject({
    method: "POST",
    url: "/api/client-portal/conversations",
  });
  assert.equal(start.statusCode, 201, start.body);
  const conversationId = start.json().id;
  const key = randomUUID(),
    body = { body: "¿A qué hora abre el centro?" };
  const [first, retry] = await Promise.all([
    trainer.inject({
      method: "POST",
      url: `/api/clients/${id}/messages`,
      headers: { "idempotency-key": key },
      payload: body,
    }),
    trainer.inject({
      method: "POST",
      url: `/api/clients/${id}/messages`,
      headers: { "idempotency-key": key },
      payload: body,
    }),
  ]);
  assert.ok([200, 201].includes(first.statusCode), first.body);
  assert.ok([200, 201].includes(retry.statusCode), retry.body);
  assert.equal(first.json().id, retry.json().id);
  const [staffMessageEvent]=await sql`SELECT payload FROM domain_events_outbox WHERE dedupe_key=${`message:${first.json().id}`}`;assert.ok(staffMessageEvent);assert.deepEqual(staffMessageEvent.payload,{senderKind:'staff'});assert.equal(JSON.stringify(staffMessageEvent.payload).includes(body.body),false);
  const note = await trainer.inject({
    method: "POST",
    url: `/api/clients/${id}/internal-notes`,
    payload: { body: "Nota operativa privada" },
  });
  assert.equal(note.statusCode, 201, note.body);
  const clientThread = await portal.inject({
    method: "GET",
    url: "/api/client-portal/conversation",
  });
  assert.equal(clientThread.statusCode, 200);
  assert.equal(clientThread.json().messages.length, 1);
  assert.equal(
    JSON.stringify(clientThread.json()).includes("Nota operativa privada"),
    false,
  );
  const staffThread = await trainer.inject({
    method: "GET",
    url: `/api/clients/${id}/conversation`,
  });
  assert.equal(staffThread.statusCode, 200);
  assert.equal(staffThread.json().internalNotes.length, 1);
  const receptionThread = await reception.inject({
    method: "GET",
    url: `/api/clients/${id}/conversation`,
  });
  assert.equal(receptionThread.statusCode, 200);
  assert.deepEqual(receptionThread.json().internalNotes, []);
  const clientMessageKey = randomUUID();
  const sent = await portal.inject({
    method: "POST",
    url: `/api/client-portal/conversations/${conversationId}/messages`,
    headers: { "idempotency-key": clientMessageKey },
    payload: { body: "Gracias" },
  });
  assert.equal(sent.statusCode, 201, sent.body);
  const [clientMessageEvent]=await sql`SELECT payload FROM domain_events_outbox WHERE dedupe_key=${`message:${sent.json().id}`}`;assert.ok(clientMessageEvent);assert.deepEqual(clientMessageEvent.payload,{senderKind:'client'});
  assert.equal(
    (await admin.inject({ method: "GET", url: `/api/clients/${id}` })).json()
      .summary.messages.data.unreadCount,
    1,
  );
  assert.equal(
    (
      await portal.inject({
        method: "POST",
        url: `/api/client-portal/messages/${first.json().id}/read`,
      })
    ).statusCode,
    200,
  );
  await trainer.inject({
    method: "POST",
    url: `/api/communications/messages/${sent.json().id}/read`,
  });
  assert.equal(
    (await admin.inject({ method: "GET", url: `/api/clients/${id}` })).json()
      .summary.messages.data.unreadCount,
    0,
  );
});

test("versioned forms preserve old responses, require PAR-Q review and deduplicate retries", async () => {
  const id = await createClient();
  const form = await admin.inject({
    method: "POST",
    url: "/api/forms",
    payload: {
      name: "Check-in energía",
      category: "check_in",
      description: "Seguimiento no clínico",
      fields: [
        { id: "energy", label: "Energía", type: "scale", required: true },
      ],
    },
  });
  assert.equal(form.statusCode, 201, form.body);
  const active = await admin.inject({
    method: "POST",
    url: `/api/forms/${form.json().id}/activate`,
  });
  assert.equal(active.statusCode, 200, active.body);
  const assignmentKey = randomUUID();
  const assignmentRequest = {
    method: "POST",
    url: `/api/clients/${id}/form-assignments`,
    headers: { "idempotency-key": assignmentKey },
    payload: { formId: form.json().id, required: true },
  };
  const [assigned, assignmentRetry] = await Promise.all([
    reception.inject(assignmentRequest),
    reception.inject(assignmentRequest),
  ]);
  assert.ok([200, 201].includes(assigned.statusCode), assigned.body);
  assert.equal(assignmentRetry.json().id, assigned.json().id);
  const assignmentMismatch = await reception.inject({
    ...assignmentRequest,
    payload: { formId: form.json().id, required: false },
  });
  assert.equal(assignmentMismatch.statusCode, 409);
  const key = randomUUID(),
    response = await portal.inject({
      method: "POST",
      url: `/api/client-portal/form-assignments/${assigned.json().id}/respond`,
      headers: { "idempotency-key": key },
      payload: { answers: { energy: 7 } },
    });
  assert.equal(response.statusCode, 201, response.body);
  const replay = await portal.inject({
    method: "POST",
    url: `/api/client-portal/form-assignments/${assigned.json().id}/respond`,
    headers: { "idempotency-key": key },
    payload: { answers: { energy: 7 } },
  });
  assert.equal(replay.statusCode, 200, replay.body);
  assert.equal(replay.json().id, response.json().id);
  const mismatch = await portal.inject({
    method: "POST",
    url: `/api/client-portal/form-assignments/${assigned.json().id}/respond`,
    headers: { "idempotency-key": key },
    payload: { answers: { energy: 8 } },
  });
  assert.equal(mismatch.statusCode, 409);
  const version = await admin.inject({
    method: "POST",
    url: `/api/forms/${form.json().id}/versions`,
    payload: {
      description: "Nueva estructura",
      fields: [
        { id: "energy", label: "Energía", type: "scale", required: true },
        { id: "sleep", label: "Sueño", type: "scale", required: false },
      ],
    },
  });
  assert.equal(version.statusCode, 201, version.body);
  assert.equal(version.json().version, 2);
  const draftVersions = await admin.inject({ method: "GET", url: `/api/forms/${form.json().id}/versions?limit=1` });
  assert.equal(draftVersions.statusCode, 200, draftVersions.body);
  assert.equal(draftVersions.json().items[0].status, "draft");
  assert.deepEqual(draftVersions.json().items[0].fields, [
    { id: "energy", label: "Energía", type: "scale", required: true },
    { id: "sleep", label: "Sueño", type: "scale", required: false },
  ]);
  assert.equal("createdBy" in draftVersions.json().items[0], false, "history exposes schema metadata only, not staff identity or responses");
  assert.equal((await trainer.inject({ method: "GET", url: `/api/forms/${form.json().id}/versions` })).statusCode, 403);
  assert.equal((await reception.inject({ method: "GET", url: `/api/forms/${form.json().id}/versions` })).statusCode, 403);
  assert.equal((await portal.inject({ method: "GET", url: `/api/forms/${form.json().id}/versions` })).statusCode, 401);
  const parq = await admin.inject({
    method: "POST",
    url: "/api/forms",
    payload: {
      name: "PAR-Q centro",
      category: "par_q",
      fields: [
        {
          id: "review",
          label: "¿Necesita revisión?",
          type: "yes_no",
          required: true,
        },
      ],
    },
  });
  assert.equal(parq.statusCode, 201, parq.body);
  assert.equal(
    (
      await admin.inject({
        method: "POST",
        url: `/api/forms/${parq.json().id}/activate`,
      })
    ).statusCode,
    200,
  );
  const pa = await trainer.inject({
    method: "POST",
    url: `/api/clients/${id}/form-assignments`,
    headers: { "idempotency-key": randomUUID() },
    payload: { formId: parq.json().id, required: true },
  });
  assert.equal(pa.statusCode, 201, pa.body);
  const pr = await portal.inject({
    method: "POST",
    url: `/api/client-portal/form-assignments/${pa.json().id}/respond`,
    headers: { "idempotency-key": randomUUID() },
    payload: { answers: { review: true } },
  });
  assert.equal(pr.statusCode, 201, pr.body);
  assert.equal(pr.json().status, "review_required");
  const deniedParqReview = await trainer.inject({
    method: "POST",
    url: `/api/clients/${id}/forms/${parq.json().id}/review`,
    payload: { assignmentId: pa.json().id, decision: "rejected", note: "No mostrar sin permiso" },
  });
  assert.equal(deniedParqReview.statusCode, 403);
  const trainerForms = await trainer.inject({ method: "GET", url: `/api/clients/${id}/forms` });
  const protectedParq = trainerForms.json().find((row) => row.id === pa.json().id);
  assert.equal(protectedParq.answers, null);
  assert.equal(protectedParq.canReview, false);
  const parqReviewed = await admin.inject({
    method: "POST",
    url: `/api/clients/${id}/forms/${parq.json().id}/review`,
    payload: { assignmentId: pa.json().id, decision: "approved", note: "Revisión administrativa documentada" },
  });
  assert.equal(parqReviewed.statusCode, 200, parqReviewed.body);
  const reviewHistory = await sql`SELECT decision,note,actor_id FROM client_form_reviews WHERE assignment_id=${pa.json().id}`;
  assert.equal(reviewHistory.length, 1);
  assert.equal(reviewHistory[0].note, "Revisión administrativa documentada");
  assert.equal(reviewHistory[0].actor_id, "comm-admin");
  assert.equal((await trainer.inject({method:"GET",url:`/api/clients/${id}/forms`})).json().find((row)=>row.id===pa.json().id).reviews.length,0);
  assert.equal((await admin.inject({method:"GET",url:`/api/clients/${id}/forms`})).json().find((row)=>row.id===pa.json().id).reviews[0].note,"Revisión administrativa documentada");
  const reviewedCheckin = await admin.inject({
    method: "POST",
    url: `/api/clients/${id}/forms/${form.json().id}/review`,
    payload: { assignmentId: assigned.json().id, decision: "approved" },
  });
  assert.equal(reviewedCheckin.statusCode, 200, reviewedCheckin.body);
  const receptionAnswers = await reception.inject({
    method: "GET",
    url: `/api/clients/${id}/forms`,
  });
  assert.equal(receptionAnswers.statusCode, 200);
  assert.equal(
    receptionAnswers.json().find((x) => x.id === pa.json().id).answers,
    null,
  );
  const checkinKey = randomUUID(),
    dueAt = new Date(Date.now() + 86_400_000).toISOString();
  const checkinRequest = {
    method: "POST",
    url: `/api/clients/${id}/checkins`,
    headers: { "idempotency-key": checkinKey },
    payload: { formId: form.json().id, dueAt },
  };
  const [checkin, checkinRetry] = await Promise.all([
    trainer.inject(checkinRequest),
    trainer.inject(checkinRequest),
  ]);
  assert.ok([200, 201].includes(checkin.statusCode), checkin.body);
  assert.equal(checkinRetry.json().id, checkin.json().id);
  const checkinMismatch = await trainer.inject({
    ...checkinRequest,
    payload: {
      formId: form.json().id,
      dueAt: new Date(Date.now() + 172_800_000).toISOString(),
    },
  });
  assert.equal(checkinMismatch.statusCode, 409);
});

test("consent acceptance snapshots exact content, is idempotent and cannot be altered", async () => {
  const id = await createClient();
  const consentName = `Normas internas ${randomUUID()}`;
  const consent = await admin.inject({
    method: "POST",
    url: "/api/consents",
    payload: {
      name: consentName,
      consentType: "center_rules",
      required: true,
      title: "Normas del centro",
      body: "Texto aprobado por el centro",
      effectiveAt: null,
    },
  });
  assert.equal(consent.statusCode, 201, consent.body);
  const draftTemplates = await admin.inject({
    method: "GET",
    url: `/api/consents?status=draft&q=${encodeURIComponent(consentName)}&required=true&limit=1`,
  });
  assert.equal(draftTemplates.statusCode, 200, draftTemplates.body);
  assert.equal(draftTemplates.json().page.totalCount, 1);
  assert.equal(draftTemplates.json().items[0].id, consent.json().id);
  assert.equal(draftTemplates.json().items[0].latestVersion, 1);
  assert.equal(draftTemplates.headers["cache-control"], "no-store");
  assert.equal((await trainer.inject({ method: "GET", url: "/api/consents" })).statusCode, 200);
  assert.equal((await accountant.inject({ method: "GET", url: "/api/consents" })).statusCode, 403);
  assert.equal((await portal.inject({ method: "GET", url: "/api/consents" })).statusCode, 401);
  assert.equal((await admin.inject({ method: "GET", url: "/api/consents?status=invalid" })).statusCode, 400);
  const draftVersions = await trainer.inject({
    method: "GET",
    url: `/api/consents/${consent.json().id}/versions?status=draft`,
  });
  assert.equal(draftVersions.statusCode, 200, draftVersions.body);
  assert.equal(draftVersions.json().items.length, 1);
  assert.equal(draftVersions.json().items[0].title, "Normas del centro");
  assert.equal((await admin.inject({ method: "GET", url: `/api/consents/${randomUUID()}/versions` })).statusCode, 404);
  assert.equal(
    (
      await admin.inject({
        method: "POST",
        url: `/api/consents/${consent.json().id}/activate`,
      })
    ).statusCode,
    200,
  );
  const listed = await portal.inject({
    method: "GET",
    url: "/api/client-portal/consents",
  });
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.json()[0].accepted, false);
  const versionId = (
      await sql`SELECT active_version_id AS id FROM client_consents WHERE id=${consent.json().id}`
    )[0].id,
    key = randomUUID();
  const accepted = await portal.inject({
    method: "POST",
    url: `/api/client-portal/consents/${versionId}/accept`,
    headers: { "idempotency-key": key },
    payload: { typedName: "Cliente Prueba", accepted: true },
  });
  assert.equal(accepted.statusCode, 201, accepted.body);
  const duplicate = await portal.inject({
    method: "POST",
    url: `/api/client-portal/consents/${versionId}/accept`,
    headers: { "idempotency-key": randomUUID() },
    payload: { typedName: "Cliente Prueba", accepted: true },
  });
  assert.equal(duplicate.statusCode, 200, duplicate.body);
  const row = (
    await sql`SELECT accepted_content_snapshot AS body,accepted_content_sha256 AS hash FROM client_consent_acceptances WHERE client_id=${id} AND consent_version_id=${versionId}`
  )[0];
  assert.equal(row.body, "Texto aprobado por el centro");
  assert.equal(row.hash, createHash("sha256").update(row.body).digest("hex"));
  const assistedClient = await createClient();
  assert.equal(
    (
      await trainer.inject({
        method: "POST",
        url: `/api/clients/${assistedClient}/consents/${versionId}/accept-assisted`,
        headers: { "idempotency-key": randomUUID() },
        payload: { typedName: "Cliente con apoyo", accepted: true },
      })
    ).statusCode,
    403,
  );
  const assisted = await admin.inject({
    method: "POST",
    url: `/api/clients/${assistedClient}/consents/${versionId}/accept-assisted`,
    headers: { "idempotency-key": randomUUID() },
    payload: { typedName: "Cliente con apoyo", accepted: true },
  });
  assert.equal(assisted.statusCode, 201, assisted.body);
  assert.equal(
    (
      await sql`SELECT method,accepted_by FROM client_consent_acceptances WHERE id=${assisted.json().id}`
    )[0].method,
    "staff_assisted",
  );
  assert.equal(
    (
      await sql`SELECT accepted_by FROM client_consent_acceptances WHERE id=${assisted.json().id}`
    )[0].accepted_by,
    "comm-admin",
  );
  const nextVersion = await admin.inject({method:"POST",url:`/api/consents/${consent.json().id}/versions`,payload:{title:"Normas actualizadas",body:"Nuevo texto vigente",effectiveAt:null}});
  assert.equal(nextVersion.statusCode,201,nextVersion.body);
  assert.equal((await admin.inject({method:"POST",url:`/api/consents/${consent.json().id}/activate`})).statusCode,200);
  clientId=id;
  const renewedPortalConsents=await portal.inject({method:"GET",url:"/api/client-portal/consents"});
  assert.equal(renewedPortalConsents.json().find(item=>item.consentId===consent.json().id).accepted,false);
  const staffConsents=await admin.inject({method:"GET",url:`/api/clients/${id}/consents`});
  assert.equal(staffConsents.statusCode,200);
  assert.equal(staffConsents.json().find(item=>item.consentId===consent.json().id).accepted,false);
  const area=await admin.inject({method:"POST",url:"/api/areas",payload:{name:`Revisión de versión ${randomUUID()}`}});
  const service=await admin.inject({method:"POST",url:"/api/services",payload:{name:`Reserva consentida ${randomUUID()}`,areaId:area.json().id,status:"active"}});
  const requirement=await admin.inject({method:"POST",url:"/api/document-requirements",payload:{scopeType:"service",scopeId:service.json().id,requirementType:"consent",consentId:consent.json().id,required:true}});
  assert.equal(requirement.statusCode,201,requirement.body);
  testOwnedRequirementIds.add(requirement.json().id);
  const session=await bookingAdmin.inject({method:"POST",url:"/api/calendar/sessions",payload:{serviceId:service.json().id,areaId:area.json().id,startsAt:new Date(Date.now()+3*86400000).toISOString(),durationMinutes:45,capacity:2}});
  assert.equal(session.statusCode,201,session.body);
  const blockedByNewVersion=await bookingAdmin.inject({method:"POST",url:`/api/calendar/sessions/${session.json().id}/reservations`,payload:{clientId:id}});
  assert.equal(blockedByNewVersion.json().error,"required_documents_pending");
  await assert.rejects(
    sql`UPDATE client_consent_acceptances SET typed_name='Changed' WHERE client_id=${id}`,
    { code: "55000" },
  );

  const archivedConsent = await admin.inject({ method: "POST", url: "/api/consents", payload: {
    name: `Consentimiento archivado ${randomUUID()}`, consentType: "other", required: false,
    title: "Versión conservada", body: "Historial que debe permanecer visible",
  } });
  assert.equal(archivedConsent.statusCode, 201, archivedConsent.body);
  assert.equal((await admin.inject({ method: "POST", url: `/api/consents/${archivedConsent.json().id}/archive` })).statusCode, 200);
  const activation = await admin.inject({ method: "POST", url: `/api/consents/${archivedConsent.json().id}/activate` });
  assert.equal(activation.statusCode, 409, activation.body);
  assert.equal(activation.json().error, "consent_archived");
  const archivedState = await sql`SELECT c.status,c.active_version_id,v.status AS version_status FROM client_consents c JOIN client_consent_versions v ON v.consent_id=c.id WHERE c.id=${archivedConsent.json().id}`;
  assert.equal(archivedState[0].status, "archived");
  assert.equal(archivedState[0].active_version_id, null);
  assert.equal(archivedState[0].version_status, "draft", "archiving preserves the draft history without publishing it");
  const archivedHistory = await admin.inject({ method: "GET", url: `/api/consents/${archivedConsent.json().id}/versions` });
  assert.equal(archivedHistory.statusCode, 200);
  assert.equal(archivedHistory.json().items[0].title, "Versión conservada");
});

test("sensitive review content is not written to server logs",async()=>{
  const chunks=[];
  const isolated=buildServer("postgres://2j_local:2j_local_dev_only@127.0.0.1:1/unavailable",{authorizationResolver:async()=>({actorId:"log-reviewer",role:"admin"}),logger:{level:"error",stream:{write(chunk){chunks.push(String(chunk));}}}});
  try {
    const response=await isolated.inject({method:"POST",url:`/api/clients/${randomUUID()}/forms/${randomUUID()}/review`,payload:{assignmentId:randomUUID(),decision:"rejected",note:"PRIVATE_REVIEW_NOTE_2J060"}});
    assert.equal(response.statusCode,500);
    assert.equal(chunks.join("").includes("PRIVATE_REVIEW_NOTE_2J060"),false);
  } finally { await isolated.close(); }
});

test("concurrent identical form responses replay the committed submission",async()=>{
  const id=await createClient();
  const form=await admin.inject({method:"POST",url:"/api/forms",payload:{name:`Respuesta idempotente ${randomUUID()}`,category:"general",fields:[{id:"answer",label:"Respuesta",type:"short_text",required:true}]}});
  assert.equal(form.statusCode,201,form.body);
  await admin.inject({method:"POST",url:`/api/forms/${form.json().id}/activate`});
  const assignment=await trainer.inject({method:"POST",url:`/api/clients/${id}/form-assignments`,headers:{"idempotency-key":randomUUID()},payload:{formId:form.json().id,required:true}});
  assert.equal(assignment.statusCode,201,assignment.body);
  const headers={"idempotency-key":randomUUID()},payload={answers:{answer:"confirmado"}};
  const results=await Promise.all([portal.inject({method:"POST",url:`/api/client-portal/form-assignments/${assignment.json().id}/respond`,headers,payload}),portal.inject({method:"POST",url:`/api/client-portal/form-assignments/${assignment.json().id}/respond`,headers,payload})]);
  assert.deepEqual(results.map(result=>result.statusCode).sort(),[200,201]);
  assert.equal(results[0].json().id,results[1].json().id);
  const count=await sql`SELECT count(*)::int AS count FROM client_form_responses WHERE assignment_id=${assignment.json().id}`;
  assert.equal(count[0].count,1);
  const profileDocuments=await portal.inject({method:"GET",url:"/api/client-portal/form-assignments"});
  assert.equal(profileDocuments.statusCode,200,profileDocuments.body);
  assert.equal(profileDocuments.json().some(item=>item.id===assignment.json().id&&item.status==='submitted'),true);
});

test("client portal has no session without identity and cannot read another client's assignment", async()=>{
  const anonymous=buildServer(process.env.DATABASE_URL);
  try { assert.equal((await anonymous.inject({method:"GET",url:"/api/client-portal/consents"})).statusCode,401); }
  finally { await anonymous.close(); }
  const first=await createClient();
  const form=await admin.inject({method:"POST",url:"/api/forms",payload:{name:`Privado ${randomUUID()}`,category:"general",fields:[{id:"answer",label:"Respuesta",type:"short_text",required:true}]}});
  await admin.inject({method:"POST",url:`/api/forms/${form.json().id}/activate`});
  const assignment=await trainer.inject({method:"POST",url:`/api/clients/${first}/form-assignments`,headers:{"idempotency-key":randomUUID()},payload:{formId:form.json().id,required:true}});
  assert.equal(assignment.statusCode,201,assignment.body);
  clientId=await createClient();
  const isolated=await portal.inject({method:"GET",url:`/api/client-portal/form-assignments/${assignment.json().id}`});
  assert.equal(isolated.statusCode,404);
});

test("required service documents block only new reservations, with audited admin override", async () => {
  const id = await createClient(),
    second = await createClient();
  const area = await admin.inject({
    method: "POST",
    url: "/api/areas",
    payload: { name: `Área comunicación ${randomUUID()}` },
  });
  assert.equal(area.statusCode, 201, area.body);
  const service = await admin.inject({
    method: "POST",
    url: "/api/services",
    payload: {
      name: `Servicio documental ${randomUUID()}`,
      areaId: area.json().id,
      status: "active",
    },
  });
  assert.equal(service.statusCode, 201, service.body);
  const form = await admin.inject({
    method: "POST",
    url: "/api/forms",
    payload: {
      name: "Consentimiento operativo",
      category: "general",
      fields: [
        {
          id: "confirmed",
          label: "Confirmo",
          type: "acceptance",
          required: true,
        },
      ],
    },
  });
  assert.equal(form.statusCode, 201, form.body);
  assert.equal(
    (
      await admin.inject({
        method: "POST",
        url: `/api/forms/${form.json().id}/activate`,
      })
    ).statusCode,
    200,
  );
  const requirement = await admin.inject({
    method: "POST",
    url: "/api/document-requirements",
    payload: {
      scopeType: "service",
      scopeId: service.json().id,
      requirementType: "form",
      formId: form.json().id,
      required: true,
    },
  });
  assert.equal(requirement.statusCode, 201, requirement.body);
  testOwnedRequirementIds.add(requirement.json().id);
  const start = new Date(Date.now() + 3 * 86400000).toISOString();
  const session = await bookingAdmin.inject({
    method: "POST",
    url: "/api/calendar/sessions",
    payload: {
      serviceId: service.json().id,
      areaId: area.json().id,
      startsAt: start,
      durationMinutes: 45,
      capacity: 1,
    },
  });
  assert.equal(session.statusCode, 201, session.body);
  const blocked = await bookingTrainer.inject({
    method: "POST",
    url: `/api/calendar/sessions/${session.json().id}/reservations`,
    payload: { clientId: id },
  });
  assert.equal(blocked.statusCode, 409);
  assert.equal(blocked.json().error, "required_documents_pending");
  assert.equal(blocked.json().missing[0].label, "Consentimiento operativo");
  const noOverridePermission = await bookingTrainer.inject({ method:"POST", url:`/api/calendar/sessions/${session.json().id}/reservations`, payload:{clientId:id,overrideDocuments:true,documentOverrideReason:"Motivo de prueba"} });
  assert.equal(noOverridePermission.statusCode,403);
  const noReason = await bookingAdmin.inject({ method:"POST", url:`/api/calendar/sessions/${session.json().id}/reservations`, payload:{clientId:id,overrideDocuments:true} });
  assert.equal(noReason.statusCode,400);
  const override = await bookingAdmin.inject({
    method: "POST",
    url: `/api/calendar/sessions/${session.json().id}/reservations`,
    payload: {
      clientId: id,
      overrideDocuments: true,
      documentOverrideReason: "Revisión presencial completada",
    },
  });
  assert.equal(override.statusCode, 201, override.body);
  const audit = (
    await sql`SELECT action,details FROM calendar_audit_events WHERE session_id=${session.json().id} AND action='reservation.document_override'`
  )[0];
  assert.ok(audit);
  assert.match(audit.details.reason, /Revisión presencial/);
  const waiting = await bookingTrainer.inject({
    method: "POST",
    url: `/api/calendar/sessions/${session.json().id}/waitlist`,
    payload: { clientId: second },
  });
  assert.equal(waiting.statusCode, 201, waiting.body);
});

test("message unread state is reversible, audited and template archival blocks future sends", async () => {
  const id = await createClient();
  const co = await portal.inject({
    method: "POST",
    url: "/api/client-portal/conversations",
  });
  assert.equal(co.statusCode, 201);
  const clientMessage = await portal.inject({
    method: "POST",
    url: `/api/client-portal/conversations/${co.json().id}/messages`,
    headers: { "idempotency-key": randomUUID() },
    payload: { body: "¿Puedo cambiar mi cita?" },
  });
  assert.equal(clientMessage.statusCode, 201, clientMessage.body);
  await assert.rejects(
    sql`UPDATE communication_messages SET body='Edited' WHERE id=${clientMessage.json().id}`,
    { code: "55000" },
  );
  assert.equal(
    (
      await trainer.inject({
        method: "POST",
        url: `/api/communications/messages/${clientMessage.json().id}/read`,
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await trainer.inject({
        method: "POST",
        url: `/api/communications/messages/${clientMessage.json().id}/unread`,
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await trainer.inject({ method: "GET", url: "/api/communications/inbox" }))
      .json()
      .find((row) => row.clientId === id).unreadCount,
    1,
  );
  const template = await admin.inject({
    method: "POST",
    url: "/api/communications/templates",
    payload: {
      name: "Recordatorio de bienvenida",
      category: "welcome",
      body: "Hola {{nombre}}",
    },
  });
  assert.equal(template.statusCode, 201, template.body);
  assert.equal(
    (
      await admin.inject({
        method: "PATCH",
        url: `/api/communications/templates/${template.json().id}`,
        payload: {
          name: "Bienvenida",
          category: "welcome",
          body: "Hola {{nombre}}, bienvenida",
        },
      })
    ).statusCode,
    200,
  );
  const sendKey = randomUUID(),
    sendBody = { clientId: id, variables: { nombre: "Cliente" } };
  const [templateSend, templateReplay] = await Promise.all([
    admin.inject({
      method: "POST",
      url: `/api/communications/templates/${template.json().id}/send`,
      headers: { "idempotency-key": sendKey },
      payload: sendBody,
    }),
    admin.inject({
      method: "POST",
      url: `/api/communications/templates/${template.json().id}/send`,
      headers: { "idempotency-key": sendKey },
      payload: sendBody,
    }),
  ]);
  assert.ok([200, 201].includes(templateSend.statusCode), templateSend.body);
  assert.equal(templateReplay.json().id, templateSend.json().id);
  assert.equal(templateSend.json().templateId, template.json().id);
  assert.equal(
    (
      await admin.inject({
        method: "POST",
        url: `/api/communications/templates/${template.json().id}/archive`,
      })
    ).statusCode,
    200,
  );
  const sent = await admin.inject({
    method: "POST",
    url: `/api/communications/templates/${template.json().id}/send`,
    headers: { "idempotency-key": randomUUID() },
    payload: { clientId: id, variables: { nombre: "Cliente" } },
  });
  assert.equal(sent.statusCode, 409);
  assert.ok(
    (
      await sql`SELECT id FROM communication_audit_events WHERE client_id=${id} AND action='message.unread'`
    ).length > 0,
  );
});

test("form, consent and document requirement archiving preserves history and is audited", async () => {
  const id = await createClient();
  const form = await admin.inject({
    method: "POST",
    url: "/api/forms",
    payload: {
      name: "Ficha archivado",
      category: "general",
      fields: [{ id: "ok", label: "Confirmación", type: "yes_no" }],
    },
  });
  assert.equal(form.statusCode, 201, form.body);
  await admin.inject({
    method: "POST",
    url: `/api/forms/${form.json().id}/activate`,
  });
  const assignment = await reception.inject({
    method: "POST",
    url: `/api/clients/${id}/form-assignments`,
    headers: { "idempotency-key": randomUUID() },
    payload: { formId: form.json().id },
  });
  assert.equal(assignment.statusCode, 201, assignment.body);
  const requirement = await admin.inject({
    method: "POST",
    url: "/api/document-requirements",
    payload: {
      scopeType: "client",
      scopeId: id,
      requirementType: "form",
      formId: form.json().id,
      required: true,
    },
  });
  assert.equal(requirement.statusCode, 201, requirement.body);
  testOwnedRequirementIds.add(requirement.json().id);
  assert.equal(
    (
      await admin.inject({
        method: "POST",
        url: `/api/forms/${form.json().id}/archive`,
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await reception.inject({
        method: "POST",
        url: `/api/clients/${id}/form-assignments`,
        headers: { "idempotency-key": randomUUID() },
        payload: { formId: form.json().id },
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await sql`SELECT active FROM document_requirements WHERE id=${requirement.json().id}`
    )[0].active,
    false,
  );
  const consent = await admin.inject({
    method: "POST",
    url: "/api/consents",
    payload: {
      name: "Consentimiento archivado",
      consentType: "other",
      required: true,
      title: "Condiciones",
      body: "Texto legal configurado por el centro",
    },
  });
  assert.equal(consent.statusCode, 201, consent.body);
  await admin.inject({
    method: "POST",
    url: `/api/consents/${consent.json().id}/activate`,
  });
  const consentRequirement = await admin.inject({
    method: "POST",
    url: "/api/document-requirements",
    payload: {
      scopeType: "center",
      requirementType: "consent",
      consentId: consent.json().id,
      required: true,
    },
  });
  assert.equal(consentRequirement.statusCode, 201, consentRequirement.body);
  testOwnedRequirementIds.add(consentRequirement.json().id);
  assert.equal(
    (
      await admin.inject({
        method: "POST",
        url: `/api/consents/${consent.json().id}/archive`,
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await sql`SELECT active FROM document_requirements WHERE id=${consentRequirement.json().id}`
    )[0].active,
    false,
  );
  assert.ok(
    (
      await sql`SELECT id FROM communication_audit_events WHERE resource_id IN (${form.json().id},${consent.json().id},${requirement.json().id}) AND action IN ('form.archived','consent.archived','requirement.archived')`
    ).length >= 3,
  );
  assert.equal(
    (
      await sql`SELECT id FROM client_form_assignments WHERE id=${assignment.json().id}`
    ).length,
    1,
  );
});

test("a staff member writes first to a client with no conversation: it reaches the member, the rejections are exact, and nothing leaks", async () => {
  const id = await createClient();
  const send = (server, key, payload, clientRef = id) => server.inject({ method: "POST", url: `/api/clients/${clientRef}/messages`, headers: key === null ? {} : { "idempotency-key": key }, payload });
  assert.equal((await portal.inject({ method: "GET", url: "/api/client-portal/conversation" })).json().conversation, null, "no conversation before the first message");
  assert.equal((await send(accountant, randomUUID(), { body: "No debería" })).statusCode, 403, "a profile without communication.send cannot write");
  assert.equal((await send(trainer, null, { body: "Sin clave" })).statusCode, 400);
  assert.equal((await send(trainer, randomUUID(), { body: "   " })).statusCode, 400, "an empty message is refused");
  assert.equal((await send(trainer, randomUUID(), { body: "x".repeat(5001) })).statusCode, 400, "the 5000 character limit holds");
  assert.equal((await send(trainer, randomUUID(), { body: "Hola", extra: 1 })).statusCode, 400, "unknown fields are refused");
  assert.equal((await send(trainer, randomUUID(), { body: "Hola" }, randomUUID())).statusCode, 404, "an unknown client is not found");
  assert.equal((await send(trainer, randomUUID(), { body: "Hola", templateId: randomUUID() })).statusCode, 404, "an unknown template is refused");
  assert.equal((await sql`SELECT id FROM communication_conversations WHERE client_id=${id}`).length, 0, "every refused attempt left nothing behind");
  const key = randomUUID();
  const first = await send(trainer, key, { body: "Bienvenida a 2J. Tu primera clase es el lunes." });
  assert.equal(first.statusCode, 201, first.body);
  const replay = await send(trainer, key, { body: "Bienvenida a 2J. Tu primera clase es el lunes." });
  assert.equal(replay.statusCode, 200); assert.equal(replay.json().id, first.json().id, "a retry with the same key never duplicates");
  const conflict = await send(trainer, key, { body: "Texto distinto con la misma clave" });
  assert.equal(conflict.statusCode, 409); assert.equal(conflict.json().error, "idempotency_conflict");
  const inbox = (await admin.inject({ method: "GET", url: "/api/communications/inbox" })).json();
  assert.ok(inbox.some((row) => row.clientId === id), "the new conversation appears in the staff inbox");
  const memberView = await portal.inject({ method: "GET", url: "/api/client-portal/conversation" });
  assert.equal(memberView.statusCode, 200);
  assert.deepEqual(memberView.json().messages.map((m) => [m.senderKind, m.body]), [["staff", "Bienvenida a 2J. Tu primera clase es el lunes."]], "the member sees exactly one staff message");
  assert.equal(JSON.stringify(memberView.json()).includes("senderActorId"), false, "no staff identity reaches the member");
  const reply = await portal.inject({ method: "POST", url: `/api/client-portal/conversations/${memberView.json().conversation.id}/messages`, headers: { "idempotency-key": randomUUID() }, payload: { body: "Perfecto, gracias" } });
  assert.equal(reply.statusCode, 201, reply.body);
  const row = (await admin.inject({ method: "GET", url: "/api/communications/inbox" })).json().find((entry) => entry.clientId === id);
  assert.equal(row.unreadCount, 1, "the member's answer is unread for the center");
  const thread = (await trainer.inject({ method: "GET", url: `/api/clients/${id}/conversation` })).json();
  assert.deepEqual(thread.messages.map((m) => m.senderKind), ["staff", "client"]);
  await sql`UPDATE clients SET status='archived' WHERE id=${id}`;
  assert.equal((await send(trainer, randomUUID(), { body: "A un archivado" })).statusCode, 404, "an archived client cannot be written to");
});
