import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { can, type AuthorizationContext } from "@2j/permissions";
import type { createDatabase } from "./db.js";

type SqlClient = ReturnType<typeof createDatabase>["client"];
export type ClientAuthorizationContext = { readonly clientId: string };
const uuid = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
const safeText = (max: number) =>
  z
    .string()
    .max(max * 2)
    .transform((value) => value.normalize("NFKC").trim())
    .pipe(z.string().min(1).max(max));
const answerValue = z.union([
  z.string().max(5000),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(500)).max(100),
]);
const fields = z
  .array(
    z
      .object({
        id: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
        label: safeText(160),
        type: z.enum([
          "short_text",
          "long_text",
          "number",
          "date",
          "yes_no",
          "single_choice",
          "multiple_choice",
          "acceptance",
          "scale",
        ]),
        required: z.boolean().default(false),
        options: z.array(safeText(120)).max(50).optional(),
      })
      .strict()
      .superRefine((field, ctx) => {
        if (
          ["single_choice", "multiple_choice"].includes(field.type) &&
          !field.options?.length
        )
          ctx.addIssue({
            code: "custom",
            message: "Las opciones son obligatorias.",
          });
        if (field.type === "scale" && field.options?.length)
          ctx.addIssue({
            code: "custom",
            message: "La escala no admite opciones.",
          });
      }),
  )
  .min(1)
  .max(100);
const createForm = z
  .object({
    name: safeText(160),
    category: z.enum([
      "general",
      "onboarding",
      "par_q",
      "check_in",
      "consent_support",
    ]),
    sensitivity: z.enum(["operational", "health"]).default("operational"),
    description: z.string().max(2000).default(""),
    fields,
  })
  .strict();
const createConsent = z
  .object({
    name: safeText(160),
    consentType: z.enum([
      "data_processing",
      "center_rules",
      "image_use",
      "physical_activity",
      "health_data",
      "other",
    ]),
    required: z.boolean(),
    title: safeText(200),
    body: safeText(30000),
    effectiveAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict();

export function registerCommunicationRoutes(
  app: FastifyInstance,
  db: SqlClient,
  resolveStaff: (
    request: FastifyRequest,
  ) => Promise<AuthorizationContext | null>,
  resolveClient?: (
    request: FastifyRequest,
  ) => Promise<ClientAuthorizationContext | null>,
) {
  async function staff(
    request: FastifyRequest,
    reply: any,
    permission: string,
  ) {
    const actor = await resolveStaff(request);
    if (!actor) {
      reply.code(401).send({ error: "authentication_required" });
      return null;
    }
    if (!can(actor, permission)) {
      reply.code(403).send({ error: "permission_denied" });
      return null;
    }
    return actor;
  }
  async function client(request: FastifyRequest, reply: any) {
    const actor = await resolveClient?.(request);
    if (!actor) {
      reply.code(401).send({ error: "client_authentication_required" });
      return null;
    }
    return actor;
  }
  const audit = async (
    tx: any,
    actorId: string,
    action: string,
    type: string,
    id: string,
    clientId: string | null,
    details: Record<string, unknown> = {},
  ) =>
    tx`INSERT INTO communication_audit_events(actor_id,action,resource_type,resource_id,client_id,details) VALUES(${actorId},${action},${type},${id},${clientId},${JSON.stringify(details)}::jsonb)`;
  app.get("/api/communications/inbox", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const actor = await staff(req, reply, "communication.read");
    if (!actor) return;
    try {
      return await db`SELECT * FROM (SELECT c.id AS "clientId",c.first_name AS "firstName",c.last_name AS "lastName",co.id AS "conversationId",co.last_message_at AS "lastMessageAt",COALESCE((SELECT count(*)::int FROM communication_messages m LEFT JOIN communication_message_reads r ON r.message_id=m.id AND r.reader_kind='center' WHERE m.conversation_id=co.id AND m.sender_kind='client' AND COALESCE(r.is_read,false)=false),0) AS "unreadCount",(SELECT count(*)::int FROM client_form_assignments a WHERE a.client_id=c.id AND a.required AND a.status IN ('assigned','review_required','rejected')) AS "pendingDocuments",(SELECT count(*)::int FROM client_consent_versions v JOIN client_consents d ON d.id=v.consent_id WHERE d.status='active' AND d.required AND NOT EXISTS(SELECT 1 FROM client_consent_acceptances ac WHERE ac.client_id=c.id AND ac.consent_version_id=v.id)) AS "pendingConsents",(SELECT min(a.due_at) FROM client_form_assignments a JOIN client_form_versions v ON v.id=a.form_version_id JOIN client_forms f ON f.id=v.form_id WHERE a.client_id=c.id AND f.category='check_in' AND a.status='assigned' AND a.due_at<=now()) AS "overdueCheckinDue" FROM clients c LEFT JOIN communication_conversations co ON co.client_id=c.id AND co.center_key='2j' AND co.status='active' WHERE c.status='active') inbox WHERE "conversationId" IS NOT NULL OR "pendingDocuments">0 OR "pendingConsents">0 OR "overdueCheckinDue" IS NOT NULL ORDER BY "unreadCount" DESC,"lastMessageAt" DESC NULLS LAST,"clientId" LIMIT 100`;
    } catch {
      req.log.error(
        { route: "GET /api/communications/inbox" },
        "inbox query failed",
      );
      return reply.code(500).send({ error: "internal_error" });
    }
  });
  app.get("/api/clients/:clientId/conversation", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const actor = await staff(req, reply, "communication.read");
    if (!actor) return;
    const p = z.object({ clientId: uuid }).safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: "invalid_client_id" });
    try {
      const [conversation]: any[] =
        await db`SELECT id,client_id AS "clientId",status,created_at AS "createdAt",last_message_at AS "lastMessageAt" FROM communication_conversations WHERE client_id=${p.data.clientId} AND center_key='2j'`;
      if (!conversation)
        return { conversation: null, messages: [], internalNotes: [] };
      const messages =
        await db`SELECT id,sender_kind AS "senderKind",COALESCE((SELECT display_name FROM staff_professionals sp WHERE sp.id::text=m.sender_actor_id),'Personal del centro') AS "senderLabel",body,template_id AS "templateId",created_at AS "createdAt",(SELECT is_read FROM communication_message_reads r WHERE r.message_id=m.id AND r.reader_kind='center') AS "readByCenter" FROM communication_messages m WHERE conversation_id=${conversation.id} ORDER BY created_at,id LIMIT 200`;
      let internalNotes: readonly unknown[] = [];
      if (can(actor, "communication.internal_notes.read"))
        internalNotes =
          await db`SELECT id,COALESCE((SELECT display_name FROM staff_professionals sp WHERE sp.id::text=n.actor_id),'Personal del centro') AS "actorLabel",body,created_at AS "createdAt" FROM communication_internal_notes n WHERE conversation_id=${conversation.id} ORDER BY created_at DESC,id DESC LIMIT 100`;
      return { conversation, messages, internalNotes };
    } catch {
      req.log.error(
        { route: "GET /api/clients/:clientId/conversation" },
        "conversation query failed",
      );
      return reply.code(500).send({ error: "internal_error" });
    }
  });
  app.post("/api/clients/:clientId/messages", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const actor = await staff(req, reply, "communication.send");
    if (!actor) return;
    const p = z.object({ clientId: uuid }).safeParse(req.params),
      b = z
        .object({ body: safeText(5000), templateId: uuid.nullable().optional() })
        .strict()
        .safeParse(req.body),
      key = uuid.safeParse(req.headers["idempotency-key"]);
    if (!p.success || !b.success)
      return reply.code(400).send({ error: "validation_error" });
    if (!key.success)
      return reply.code(400).send({ error: "idempotency_key_required" });
    try {
      const result = await db.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${key.data},0))`;
        const [clientRow]: any[] =
          await tx`SELECT id FROM clients WHERE id=${p.data.clientId} AND status='active' FOR SHARE`;
        if (!clientRow) return { error: "client_not_found" as const };
        const [conversation]: any[] =
          await tx`INSERT INTO communication_conversations(client_id) VALUES(${p.data.clientId}) ON CONFLICT(center_key,client_id) DO UPDATE SET updated_at=now() RETURNING id`;
        const [prior]: any[] =
          await tx`SELECT id,body,template_id AS "templateId",created_at AS "createdAt" FROM communication_messages WHERE conversation_id=${conversation.id} AND sender_kind='staff' AND idempotency_key=${key.data}`;
        if (prior)
          return prior!.body === b.data.body && (prior!.templateId ?? null) === (b.data.templateId ?? null)
            ? { message: prior, replay: true }
            : { error: "idempotency_conflict" as const };
        if (b.data.templateId) {
          const [template]: any[] = await tx`SELECT id FROM communication_templates WHERE id=${b.data.templateId} AND status='active' FOR SHARE`;
          if (!template) return { error: 'template_not_found' as const };
        }
        const [message]: any[] =
          await tx`INSERT INTO communication_messages(conversation_id,sender_kind,sender_actor_id,body,template_id,idempotency_key) VALUES(${conversation.id},'staff',${actor.actorId},${b.data.body},${b.data.templateId ?? null},${key.data}) RETURNING id,body,template_id AS "templateId",created_at AS "createdAt"`;
        await tx`UPDATE communication_conversations SET updated_at=now(),last_message_at=${message.createdAt} WHERE id=${conversation.id}`;
        await audit(
          tx,
          actor.actorId,
          "message.sent",
          "communication_message",
          message!.id,
          p.data.clientId,
        );
        return { message, replay: false };
      });
      if ("error" in result)
        return reply.code(404).send({ error: result.error });
      return reply.code(result.replay ? 200 : 201).send(result.message);
    } catch {
      req.log.error(
        { route: "POST /api/clients/:clientId/messages" },
        "message send failed",
      );
      return reply.code(500).send({ error: "internal_error" });
    }
  });
  app.post("/api/clients/:clientId/internal-notes", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const actor = await staff(req, reply, "communication.internal_notes.write");
    if (!actor) return;
    const p = z.object({ clientId: uuid }).safeParse(req.params),
      b = z
        .object({ body: safeText(3000) })
        .strict()
        .safeParse(req.body);
    if (!p.success || !b.success)
      return reply.code(400).send({ error: "validation_error" });
    try {
      const result = await db.begin(async (tx) => {
        const [c]: any[] =
          await tx`SELECT id FROM clients WHERE id=${p.data.clientId} FOR SHARE`;
        if (!c) return null;
        const [co]: any[] =
          await tx`INSERT INTO communication_conversations(client_id) VALUES(${p.data.clientId}) ON CONFLICT(center_key,client_id) DO UPDATE SET updated_at=now() RETURNING id`;
        const [note]: any[] =
          await tx`INSERT INTO communication_internal_notes(conversation_id,actor_id,body) VALUES(${co.id},${actor.actorId},${b.data.body}) RETURNING id,created_at AS "createdAt"`;
        await audit(
          tx,
          actor.actorId,
          "internal_note.created",
          "communication_internal_note",
          note!.id,
          p.data.clientId,
        );
        return note;
      });
      if (!result) return reply.code(404).send({ error: "client_not_found" });
      return reply.code(201).send(result);
    } catch {
      req.log.error(
        { route: "POST /api/clients/:clientId/internal-notes" },
        "internal note failed",
      );
      return reply.code(500).send({ error: "internal_error" });
    }
  });
  app.post(
    "/api/client-portal/conversations/:conversationId/messages",
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const actor = await client(req, reply);
      if (!actor) return;
      const p = z.object({ conversationId: uuid }).safeParse(req.params),
        b = z
          .object({ body: safeText(5000) })
          .strict()
          .safeParse(req.body),
        key = uuid.safeParse(req.headers["idempotency-key"]);
      if (!p.success || !b.success || !key.success)
        return reply.code(400).send({ error: "validation_error" });
      try {
        const result = await db.begin(async (tx) => {
          await tx`SELECT pg_advisory_xact_lock(hashtextextended(${key.data},0))`;
          const [co]: any[] =
            await tx`SELECT id,client_id AS "clientId" FROM communication_conversations WHERE id=${p.data.conversationId} AND status='active' AND client_id=${actor.clientId} FOR SHARE`;
          if (!co) return { error: "conversation_not_found" as const };
          const [prior]: any[] =
            await tx`SELECT id,body,created_at AS "createdAt" FROM communication_messages WHERE conversation_id=${co.id} AND sender_kind='client' AND idempotency_key=${key.data}`;
          if (prior)
            return prior!.body === b.data.body
              ? { message: prior, replay: true }
              : { error: "idempotency_conflict" as const };
          const [message]: any[] =
            await tx`INSERT INTO communication_messages(conversation_id,sender_kind,sender_actor_id,body,idempotency_key) VALUES(${co.id},'client',${actor.clientId},${b.data.body},${key.data}) RETURNING id,body,created_at AS "createdAt"`;
          await tx`UPDATE communication_conversations SET last_message_at=${message.createdAt},updated_at=now() WHERE id=${co.id}`;
          await audit(
            tx,
            actor.clientId,
            "message.sent",
            "communication_message",
            message!.id,
            actor.clientId,
          );
          return { message, replay: false };
        });
        if ("error" in result)
          return reply.code(409).send({ error: result.error });
        return reply.code(result.replay ? 200 : 201).send(result.message);
      } catch {
        req.log.error(
          {
            route:
              "POST /api/client-portal/conversations/:conversationId/messages",
          },
          "client message failed",
        );
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );
  app.post("/api/client-portal/conversations", async (req, reply) => {
    const actor = await client(req, reply);
    if (!actor) return;
    try {
      const [row]: any[] =
        await db`INSERT INTO communication_conversations(client_id) VALUES(${actor.clientId}) ON CONFLICT(center_key,client_id) DO UPDATE SET updated_at=now() RETURNING id,status,created_at AS "createdAt"`;
      return reply.code(201).send(row);
    } catch {
      req.log.error(
        { route: "POST /api/client-portal/conversations" },
        "client conversation create failed",
      );
      return reply.code(500).send({ error: "internal_error" });
    }
  });
  app.get("/api/client-portal/conversation", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const actor = await client(req, reply);
    if (!actor) return;
    try {
      const [co]: any[] =
        await db`SELECT id,status,last_message_at AS "lastMessageAt" FROM communication_conversations WHERE client_id=${actor.clientId} AND center_key='2j'`;
      if (!co) return { conversation: null, messages: [] };
      const messages =
        await db`SELECT id,sender_kind AS "senderKind",body,created_at AS "createdAt",(SELECT is_read FROM communication_message_reads r WHERE r.message_id=m.id AND r.reader_kind='client') AS "readByClient" FROM communication_messages m WHERE conversation_id=${co.id} ORDER BY created_at,id LIMIT 200`;
      return { conversation: co, messages };
    } catch {
      req.log.error(
        { route: "GET /api/client-portal/conversation" },
        "client conversation read failed",
      );
      return reply.code(500).send({ error: "internal_error" });
    }
  });
  app.post(
    "/api/client-portal/messages/:messageId/read",
    async (req, reply) => {
      const actor = await client(req, reply);
      if (!actor) return;
      const p = z.object({ messageId: uuid }).safeParse(req.params);
      if (!p.success)
        return reply.code(400).send({ error: "invalid_message_id" });
      try {
        const found = await db.begin(async (tx) => {
          const [row]: any[] =
            await tx`INSERT INTO communication_message_reads(message_id,reader_kind,is_read,actor_id) SELECT m.id,'client',true,${actor.clientId} FROM communication_messages m JOIN communication_conversations c ON c.id=m.conversation_id WHERE m.id=${p.data.messageId} AND m.sender_kind='staff' AND c.client_id=${actor.clientId} ON CONFLICT(message_id,reader_kind) DO UPDATE SET is_read=true,actor_id=excluded.actor_id,updated_at=now() RETURNING message_id`;
          if (!row) return false;
          await audit(
            tx,
            actor.clientId,
            "message.read",
            "communication_message",
            p.data.messageId,
            actor.clientId,
          );
          return true;
        });
        if (!found) return reply.code(404).send({ error: "message_not_found" });
        return { read: true };
      } catch {
        req.log.error(
          { route: "POST /api/client-portal/messages/:messageId/read" },
          "client mark read failed",
        );
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );
  app.post(
    "/api/communications/messages/:messageId/read",
    async (req, reply) => {
      const actor = await staff(req, reply, "communication.read");
      if (!actor) return;
      const p = z.object({ messageId: uuid }).safeParse(req.params);
      if (!p.success)
        return reply.code(400).send({ error: "invalid_message_id" });
      try {
        const found = await db.begin(async (tx) => {
          const [row]: any[] =
            await tx`INSERT INTO communication_message_reads(message_id,reader_kind,is_read,actor_id) SELECT m.id,'center',true,${actor.actorId} FROM communication_messages m WHERE m.id=${p.data.messageId} AND m.sender_kind='client' ON CONFLICT(message_id,reader_kind) DO UPDATE SET is_read=true,actor_id=excluded.actor_id,updated_at=now() RETURNING message_id`;
          if (!row) return false;
          const [event]: any[] =
            await tx`SELECT c.client_id AS id FROM communication_messages m JOIN communication_conversations c ON c.id=m.conversation_id WHERE m.id=${p.data.messageId}`;
          await audit(
            tx,
            actor.actorId,
            "message.read",
            "communication_message",
            p.data.messageId,
            event?.id ?? null,
          );
          return true;
        });
        if (!found) return reply.code(404).send({ error: "message_not_found" });
        return { read: true };
      } catch {
        req.log.error(
          { route: "POST /api/communications/messages/:messageId/read" },
          "mark read failed",
        );
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );
  app.post("/api/communications/templates", async (req, reply) => {
    const actor = await staff(req, reply, "communication.manage_templates");
    if (!actor) return;
    const b = z
      .object({
        name: safeText(120),
        category: z.enum([
          "welcome",
          "documents",
          "payment",
          "reservation",
          "followup",
          "general",
        ]),
        body: safeText(5000),
      })
      .strict()
      .safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "validation_error" });
    try {
      const row = await db.begin(async (tx) => {
        const [created]: any[] =
          await tx`INSERT INTO communication_templates(name,category,body,created_by,updated_by) VALUES(${b.data.name},${b.data.category},${b.data.body},${actor.actorId},${actor.actorId}) RETURNING id,name,category,body,status,created_at AS "createdAt"`;
        await audit(
          tx,
          actor.actorId,
          "template.created",
          "communication_template",
          created.id,
          null,
        );
        return created;
      });
      return reply.code(201).send(row);
    } catch {
      req.log.error(
        { route: "POST /api/communications/templates" },
        "template create failed",
      );
      return reply.code(500).send({ error: "internal_error" });
    }
  });
  app.get("/api/communications/templates", async (req, reply) => {
    const actor = await staff(req, reply, "communication.read");
    if (!actor) return;
    return db`SELECT id,name,category,body,status,updated_at AS "updatedAt" FROM communication_templates ORDER BY lower(name),id`;
  });
  app.post(
    "/api/communications/templates/:templateId/send",
    async (req, reply) => {
      const actor = await staff(req, reply, "communication.send");
      if (!actor) return;
      const p = z.object({ templateId: uuid }).safeParse(req.params),
        b = z
          .object({
            clientId: uuid,
            variables: z.record(z.string(), z.string().max(300)).default({}),
          })
          .strict()
          .safeParse(req.body),
        key = uuid.safeParse(req.headers["idempotency-key"]);
      if (!p.success || !b.success || !key.success)
        return reply.code(400).send({ error: "validation_error" });
      try {
        const result = await db.begin(async (tx) => {
          await tx`SELECT pg_advisory_xact_lock(hashtextextended(${key.data},0))`;
          const [tpl]: any[] =
            await tx`SELECT id,body FROM communication_templates WHERE id=${p.data.templateId} AND status='active' FOR SHARE`;
          if (!tpl) return { error: "template_not_found" as const };
          let body = tpl.body;
          for (const [name, value] of Object.entries(b.data.variables))
            body = body.replaceAll(`{{${name}}}`, value);
          if (/\{\{[^}]+\}\}/.test(body))
            return { error: "template_variable_missing" as const };
          const [co]: any[] =
            await tx`INSERT INTO communication_conversations(client_id) SELECT id FROM clients WHERE id=${b.data.clientId} AND status='active' ON CONFLICT(center_key,client_id) DO UPDATE SET updated_at=now() RETURNING id`;
          if (!co) return { error: "client_not_found" as const };
          const [prior]: any[] =
            await tx`SELECT m.id,m.body,m.template_id AS "templateId",m.created_at AS "createdAt",m.conversation_id AS "conversationId" FROM communication_messages m WHERE m.sender_kind='staff' AND m.idempotency_key=${key.data}`;
          if (prior)
            return prior.conversationId === co.id &&
              prior.body === body &&
              prior.templateId === tpl.id
              ? { message: prior, replay: true }
              : { error: "idempotency_conflict" as const };
          const [msg]: any[] =
            await tx`INSERT INTO communication_messages(conversation_id,sender_kind,sender_actor_id,body,template_id,idempotency_key) VALUES(${co.id},'staff',${actor.actorId},${body},${tpl.id},${key.data}) RETURNING id,body,template_id AS "templateId",created_at AS "createdAt"`;
          await tx`UPDATE communication_conversations SET updated_at=now(),last_message_at=${msg.createdAt} WHERE id=${co.id}`;
          await audit(
            tx,
            actor.actorId,
            "template.sent",
            "communication_message",
            msg!.id,
            b.data.clientId,
            { templateId: tpl.id },
          );
          return { message: msg, replay: false };
        });
        if ("error" in result)
          return reply
            .code(result.error === "client_not_found" ? 404 : 409)
            .send({ error: result.error });
        return reply.code(result.replay ? 200 : 201).send(result.message);
      } catch {
        req.log.error(
          { route: "POST /api/communications/templates/:templateId/send" },
          "template send failed",
        );
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );
  app.post("/api/forms", async (req, reply) => {
    const actor = await staff(req, reply, "forms.manage");
    if (!actor) return;
    const b = createForm.safeParse(req.body);
    if (!b.success)
      return reply
        .code(400)
        .send({ error: "validation_error", details: b.error.flatten() });
    if (b.data.category === "par_q" || b.data.category === "check_in")
      b.data.sensitivity = "health";
    try {
      const row = await db.begin(async (tx) => {
        const [f]: any[] =
          await tx`INSERT INTO client_forms(name,category,sensitivity,created_by) VALUES(${b.data.name},${b.data.category},${b.data.sensitivity},${actor.actorId}) RETURNING id`;
        const [v]: any[] =
          await tx`INSERT INTO client_form_versions(form_id,version,description,fields,created_by) VALUES(${f.id},1,${b.data.description},${JSON.stringify(b.data.fields)}::jsonb,${actor.actorId}) RETURNING id,version,status`;
        await audit(
          tx,
          actor.actorId,
          "form.created",
          "client_form",
          f!.id,
          null,
        );
        await audit(
          tx,
          actor.actorId,
          "form.version_created",
          "client_form_version",
          v!.id,
          null,
        );
        return { id: f!.id, version: v };
      });
      return reply.code(201).send(row);
    } catch {
      req.log.error({ route: "POST /api/forms" }, "form create failed");
      return reply.code(500).send({ error: "internal_error" });
    }
  });
  app.post("/api/forms/:formId/versions", async (req, reply) => {
    const actor = await staff(req, reply, "forms.manage");
    if (!actor) return;
    const p = z.object({ formId: uuid }).safeParse(req.params),
      b = z
        .object({ description: z.string().max(2000).default(""), fields })
        .strict()
        .safeParse(req.body);
    if (!p.success || !b.success)
      return reply.code(400).send({ error: "validation_error" });
    try {
      const result = await db.begin(async (tx) => {
        const [form]: any[] =
          await tx`SELECT id,status FROM client_forms WHERE id=${p.data.formId} FOR UPDATE`;
        if (!form || form!.status === "archived") return null;
        const [version]: any[] =
          await tx`INSERT INTO client_form_versions(form_id,version,description,fields,created_by) SELECT ${form.id},COALESCE(max(version),0)+1,${b.data.description},${JSON.stringify(b.data.fields)}::jsonb,${actor.actorId} FROM client_form_versions WHERE form_id=${form.id} RETURNING id,version,status`;
        await audit(
          tx,
          actor.actorId,
          "form.version_created",
          "client_form_version",
          version!.id,
          null,
        );
        return version;
      });
      if (!result) return reply.code(404).send({ error: "form_not_found" });
      return reply.code(201).send(result);
    } catch {
      req.log.error(
        { route: "POST /api/forms/:formId/versions" },
        "form version create failed",
      );
      return reply.code(409).send({ error: "version_conflict" });
    }
  });
  app.get("/api/forms", async (req, reply) => {
    const actor = await staff(req, reply, "forms.read");
    if (!actor) return;
    return db`SELECT f.id,f.name,f.category,f.sensitivity,f.status,f.active_version_id AS "activeVersionId",v.version,v.description,v.fields FROM client_forms f LEFT JOIN client_form_versions v ON v.id=f.active_version_id WHERE f.status<>'archived' ORDER BY lower(f.name),f.id`;
  });
  app.post("/api/forms/:formId/activate", async (req, reply) => {
    const actor = await staff(req, reply, "forms.manage");
    if (!actor) return;
    const p = z.object({ formId: uuid }).safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: "invalid_form_id" });
    try {
      const result = await db.begin(async (tx) => {
        const [f]: any[] =
          await tx`SELECT id,status FROM client_forms WHERE id=${p.data.formId} FOR UPDATE`;
        if (!f || f!.status === "archived") return null;
        const [v]: any[] =
          await tx`SELECT id,version FROM client_form_versions WHERE form_id=${f.id} AND status='draft' ORDER BY version DESC LIMIT 1 FOR UPDATE`;
        if (!v) return null;
        await tx`UPDATE client_form_versions SET status='active' WHERE id=${v.id}`;
        await tx`UPDATE client_forms SET status='active',active_version_id=${v.id},updated_at=now() WHERE id=${f.id}`;
        await audit(
          tx,
          actor.actorId,
          "form.activated",
          "client_form_version",
          v!.id,
          null,
          { version: v!.version },
        );
        return { id: f!.id, version: v!.version };
      });
      if (!result)
        return reply.code(409).send({ error: "draft_version_unavailable" });
      return result;
    } catch {
      req.log.error(
        { route: "POST /api/forms/:formId/activate" },
        "form activation failed",
      );
      return reply.code(500).send({ error: "internal_error" });
    }
  });
  app.post("/api/clients/:clientId/form-assignments", async (req, reply) => {
    const actor = await staff(req, reply, "forms.assign");
    if (!actor) return;
    const p = z.object({ clientId: uuid }).safeParse(req.params),
      b = z
        .object({
          formId: uuid,
          required: z.boolean().default(false),
          dueAt: z.string().datetime({ offset: true }).nullable().optional(),
        })
        .strict()
        .safeParse(req.body),
      key = uuid.safeParse(req.headers["idempotency-key"]);
    if (!p.success || !b.success || !key.success)
      return reply.code(400).send({ error: "validation_error" });
    try {
      const result = await db.begin(async (tx) => {
        const [v]: any[] =
          await tx`SELECT f.id,v.id AS "versionId" FROM client_forms f JOIN client_form_versions v ON v.id=f.active_version_id WHERE f.id=${b.data.formId} AND f.status='active' AND v.status='active' FOR SHARE OF f,v`;
        if (!v) return { error: "form_unavailable" as const };
        const [a]: any[] =
          await tx`INSERT INTO client_form_assignments(client_id,form_version_id,required,due_at,idempotency_key,assigned_by) SELECT c.id,${v.versionId},${b.data.required},${b.data.dueAt ?? null},${key.data},${actor.actorId} FROM clients c WHERE c.id=${p.data.clientId} AND c.status='active' ON CONFLICT(client_id,idempotency_key) DO NOTHING RETURNING id,status,due_at AS "dueAt"`;
        if (!a) {
          const [prior]: any[] =
            await tx`SELECT id,status,due_at AS "dueAt",form_version_id AS "versionId",required FROM client_form_assignments WHERE client_id=${p.data.clientId} AND idempotency_key=${key.data}`;
          if (prior) {
            const priorDue = prior.dueAt
              ? new Date(prior.dueAt).getTime()
              : null;
            const requestedDue = b.data.dueAt
              ? new Date(b.data.dueAt).getTime()
              : null;
            const sameRequest =
              prior.versionId === v.versionId &&
              prior.required === b.data.required &&
              priorDue === requestedDue;
            return sameRequest
              ? { assignment: prior, replay: true }
              : { error: "idempotency_conflict" as const };
          }
          const [clientExists]: any[] =
            await tx`SELECT id FROM clients WHERE id=${p.data.clientId} AND status='active'`;
          if (!clientExists) return { error: "client_not_found" as const };
          return { error: "assignment_conflict" as const };
        }
        await audit(
          tx,
          actor.actorId,
          "form.assigned",
          "client_form_assignment",
          a.id,
          p.data.clientId,
        );
        return { assignment: a, replay: false };
      });
      if ("error" in result)
        return reply
          .code(result.error === "client_not_found" ? 404 : 409)
          .send({ error: result.error });
      return reply.code(201).send(result.assignment);
    } catch (error) {
      req.log.error(
        {
          route: "POST /api/clients/:clientId/form-assignments",
          databaseCode:
            typeof error === "object" && error && "code" in error
              ? String(error.code)
              : "unknown",
          constraint:
            typeof error === "object" && error && "constraint_name" in error
              ? String(error.constraint_name)
              : undefined,
        },
        "form assignment failed",
      );
      return reply.code(409).send({ error: "assignment_conflict" });
    }
  });
  app.post(
    "/api/client-portal/form-assignments/:assignmentId/respond",
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const actor = await client(req, reply);
      if (!actor) return;
      const p = z.object({ assignmentId: uuid }).safeParse(req.params),
        b = z
          .object({ answers: z.record(z.string(), answerValue) })
          .strict()
          .safeParse(req.body),
        key = uuid.safeParse(req.headers["idempotency-key"]);
      if (!p.success || !b.success || !key.success)
        return reply.code(400).send({ error: "validation_error" });
      try {
        const result = await db.begin(async (tx) => {
          const hash = createHash("sha256")
            .update(
              JSON.stringify(
                Object.entries(b.data.answers).sort(([a], [b]) =>
                  a.localeCompare(b),
                ),
              ),
            )
            .digest("hex");
          const [a]: any[] =
            await tx`SELECT a.id,a.form_version_id AS "versionId",a.status,v.fields,f.category,f.sensitivity FROM client_form_assignments a JOIN client_form_versions v ON v.id=a.form_version_id JOIN client_forms f ON f.id=v.form_id WHERE a.id=${p.data.assignmentId} AND a.client_id=${actor.clientId} FOR UPDATE OF a`;
          if (!a) return { error: "assignment_unavailable" as const };
          const [prior]: any[] =
            await tx`SELECT id,request_hash AS "requestHash",submitted_at AS "submittedAt" FROM client_form_responses WHERE client_id=${actor.clientId} AND idempotency_key=${key.data}`;
          if (prior)
            return prior!.requestHash === hash
              ? {
                  id: prior!.id,
                  status: a.status,
                  submittedAt: prior!.submittedAt,
                  replay: true,
                }
              : { error: "idempotency_conflict" as const };
          if (a.status !== "assigned")
            return { error: "assignment_unavailable" as const };
          if (a.sensitivity === "health" && a.category === "par_q") {
            /* health answer is intentionally reviewed by staff */
          }
          const formFields = a.fields as Array<{
            id: string;
            type: string;
            required: boolean;
            options?: string[];
          }>;
          if (
            Object.keys(b.data.answers).some(
              (key) => !formFields.some((field) => field.id === key),
            )
          )
            return { error: "invalid_answer" as const };
          for (const field of formFields) {
            const answer = b.data.answers[field.id];
            if (field.required && answer === undefined)
              return { error: "required_answer_missing" as const };
            if (answer !== undefined) {
              if (
                (field.type === "number" && typeof answer !== "number") ||
                (["short_text", "long_text", "date"].includes(field.type) &&
                  typeof answer !== "string") ||
                (field.type === "yes_no" && typeof answer !== "boolean") ||
                (field.type === "single_choice" &&
                  !field.options?.includes(String(answer))) ||
                (field.type === "multiple_choice" &&
                  (!Array.isArray(answer) ||
                    answer.some(
                      (value) => !field.options?.includes(String(value)),
                    ))) ||
                (field.type === "scale" &&
                  (typeof answer !== "number" || answer < 1 || answer > 10)) ||
                (field.type === "acceptance" && answer !== true)
              )
                return { error: "invalid_answer" as const };
            }
          }
          const [r]: any[] =
            await tx`INSERT INTO client_form_responses(assignment_id,client_id,form_version_id,answers,idempotency_key,request_hash) VALUES(${a.id},${actor.clientId},${a.versionId},${JSON.stringify(b.data.answers)}::jsonb,${key.data},${hash}) RETURNING id,submitted_at AS "submittedAt"`;
          const review =
            a.category === "par_q" || a.sensitivity === "health"
              ? "review_required"
              : "submitted";
          await tx`UPDATE client_form_assignments SET status=${review},updated_at=now() WHERE id=${a.id}`;
          await audit(
            tx,
            actor.clientId,
            "form.responded",
            "client_form_response",
            r!.id,
            actor.clientId,
            { requiresReview: review === "review_required" },
          );
          return {
            id: r!.id,
            status: review,
            submittedAt: r!.submittedAt,
            replay: false,
          };
        });
        if ("error" in result)
          return reply
            .code(result.error === "assignment_unavailable" ? 404 : 409)
            .send({ error: result.error });
        return reply
          .code("replay" in result && result.replay ? 200 : 201)
          .send(result);
      } catch {
        req.log.error(
          {
            route:
              "POST /api/client-portal/form-assignments/:assignmentId/respond",
          },
          "form response failed",
        );
        return reply.code(409).send({ error: "response_conflict" });
      }
    },
  );
  app.get(
    "/api/client-portal/form-assignments/:assignmentId",
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const actor = await client(req, reply);
      if (!actor) return;
      const p = z.object({ assignmentId: uuid }).safeParse(req.params);
      if (!p.success)
        return reply.code(400).send({ error: "invalid_assignment_id" });
      try {
        const [row]: any[] =
          await db`SELECT a.id,a.status,a.required,a.due_at AS "dueAt",f.name,f.category,f.sensitivity,v.version,v.description,v.fields FROM client_form_assignments a JOIN client_form_versions v ON v.id=a.form_version_id JOIN client_forms f ON f.id=v.form_id WHERE a.id=${p.data.assignmentId} AND a.client_id=${actor.clientId}`;
        if (!row)
          return reply.code(404).send({ error: "assignment_not_found" });
        return row;
      } catch {
        req.log.error(
          { route: "GET /api/client-portal/form-assignments/:assignmentId" },
          "client form read failed",
        );
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );
  app.get("/api/clients/:clientId/forms", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const actor = await staff(req, reply, "forms.read");
    if (!actor) return;
    const p = z.object({ clientId: uuid }).safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: "invalid_client_id" });
    const sensitive =
      can(actor, "health.read") && can(actor, "forms.responses.sensitive.read");
    try {
      return await db`SELECT a.id,a.status,a.required,a.due_at AS "dueAt",a.assigned_at AS "assignedAt",f.id AS "formId",f.name,f.category,f.sensitivity,v.version,CASE WHEN (f.sensitivity='health' OR f.category='par_q') AND NOT ${sensitive} THEN NULL ELSE r.answers END AS answers,r.submitted_at AS "submittedAt",(${can(actor,'forms.review')} AND (f.sensitivity<>'health' AND f.category<>'par_q' OR ${sensitive})) AS "canReview",((${sensitive}) AND (f.sensitivity='health' OR f.category='par_q')) AS "sensitiveReadable",CASE WHEN (f.sensitivity='health' OR f.category='par_q') AND NOT ${sensitive} THEN '[]'::jsonb ELSE COALESCE((SELECT jsonb_agg(jsonb_build_object('decision',h.decision,'note',h.note,'actorLabel',COALESCE((SELECT display_name FROM staff_professionals sp WHERE sp.id::text=h.actor_id),'Personal del centro'),'reviewedAt',h.reviewed_at) ORDER BY h.reviewed_at,h.id) FROM client_form_reviews h WHERE h.assignment_id=a.id),'[]'::jsonb) END AS reviews FROM client_form_assignments a JOIN client_form_versions v ON v.id=a.form_version_id JOIN client_forms f ON f.id=v.form_id LEFT JOIN client_form_responses r ON r.assignment_id=a.id WHERE a.client_id=${p.data.clientId} ORDER BY a.assigned_at DESC,a.id DESC LIMIT 100`;
    } catch {
      req.log.error(
        { route: "GET /api/clients/:clientId/forms" },
        "client forms failed",
      );
      return reply.code(500).send({ error: "internal_error" });
    }
  });
  app.get("/api/clients/:clientId/consents", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const actor = await staff(req, reply, "documents.read");
    if (!actor) return;
    const p = z.object({ clientId: uuid }).safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: "invalid_client_id" });
    try {
      return await db`SELECT c.id AS "consentId",c.name,c.required,v.id AS "versionId",v.version,v.title,v.body,v.effective_at AS "effectiveAt",(a.id IS NOT NULL) AS accepted,a.accepted_at AS "acceptedAt",a.method,${can(actor,'consents.accept.assisted') && can(actor,'consents.read')} AS "canAcceptAssisted" FROM client_consents c JOIN client_consent_versions v ON v.id=c.active_version_id LEFT JOIN client_consent_acceptances a ON a.client_id=${p.data.clientId} AND a.consent_version_id=v.id WHERE c.status='active' ORDER BY c.required DESC,c.name`;
    } catch {
      req.log.error({ route: "GET /api/clients/:clientId/consents" }, "client consents failed");
      return reply.code(500).send({ error: "internal_error" });
    }
  });
  app.post(
    "/api/clients/:clientId/forms/:formId/review",
    async (req, reply) => {
      const actor = await staff(req, reply, "forms.review");
      if (!actor) return;
      const p = z
          .object({ clientId: uuid, formId: uuid })
          .safeParse(req.params),
        b = z
          .object({
            assignmentId: uuid,
            decision: z.enum(["approved", "rejected"]),
            note: z.string().max(1000).default(""),
          })
          .strict()
          .safeParse(req.body);
      if (!p.success || !b.success)
        return reply.code(400).send({ error: "validation_error" });
      try {
        const r = await db.begin(async (tx) => {
          const [row]: any[] = await tx`SELECT a.id,a.form_version_id AS "formVersionId",r.id AS "responseId",f.category,f.sensitivity FROM client_form_assignments a JOIN client_form_versions v ON v.id=a.form_version_id JOIN client_forms f ON f.id=v.form_id JOIN client_form_responses r ON r.assignment_id=a.id WHERE a.id=${b.data.assignmentId} AND a.client_id=${p.data.clientId} AND f.id=${p.data.formId} AND a.status='review_required' FOR UPDATE OF a`;
          if (!row) return null;
          const sensitiveReview = row.category === 'par_q' || row.sensitivity === 'health';
          if (sensitiveReview && !(can(actor, 'health.read') && can(actor, 'forms.responses.sensitive.read'))) return { forbidden: true as const };
          await tx`INSERT INTO client_form_reviews(assignment_id,response_id,client_id,form_version_id,decision,note,actor_id) VALUES(${row.id},${row.responseId},${p.data.clientId},${row.formVersionId},${b.data.decision},${b.data.note},${actor.actorId})`;
          await tx`UPDATE client_form_assignments SET status=${b.data.decision},updated_at=now() WHERE id=${row.id}`;
          await audit(
            tx,
            actor.actorId,
            "form.reviewed",
            "client_form_assignment",
            row.id,
            p.data.clientId,
            { decision: b.data.decision },
          );
          return { id: row.id };
        });
        if (!r)
          return reply.code(404).send({ error: "review_target_not_found" });
        if ('forbidden' in r) return reply.code(403).send({ error: 'permission_denied' });
        return { status: b.data.decision };
      } catch {
        req.log.error(
          { route: "POST /api/clients/:clientId/forms/:formId/review" },
          "form review failed",
        );
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );
  app.post("/api/consents", async (req, reply) => {
    const actor = await staff(req, reply, "consents.manage");
    if (!actor) return;
    const b = createConsent.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "validation_error" });
    const hash = createHash("sha256").update(b.data.body).digest("hex");
    try {
      const result = await db.begin(async (tx) => {
        const [c]: any[] =
          await tx`INSERT INTO client_consents(name,consent_type,required,created_by) VALUES(${b.data.name},${b.data.consentType},${b.data.required},${actor.actorId}) RETURNING id`;
        const [v]: any[] =
          await tx`INSERT INTO client_consent_versions(consent_id,version,title,body,content_sha256,effective_at,created_by) VALUES(${c.id},1,${b.data.title},${b.data.body},${hash},${b.data.effectiveAt ?? null},${actor.actorId}) RETURNING id,version`;
        await audit(
          tx,
          actor.actorId,
          "consent.created",
          "client_consent",
          c!.id,
          null,
        );
        await audit(
          tx,
          actor.actorId,
          "consent.version_created",
          "client_consent_version",
          v!.id,
          null,
        );
        return { id: c!.id, version: v!.version };
      });
      return reply.code(201).send(result);
    } catch {
      req.log.error({ route: "POST /api/consents" }, "consent create failed");
      return reply.code(500).send({ error: "internal_error" });
    }
  });
  app.post("/api/consents/:consentId/versions", async (req, reply) => {
    const actor = await staff(req, reply, "consents.manage");
    if (!actor) return;
    const p = z.object({ consentId: uuid }).safeParse(req.params),
      b = z
        .object({
          title: safeText(200),
          body: safeText(30000),
          effectiveAt: z
            .string()
            .datetime({ offset: true })
            .nullable()
            .optional(),
        })
        .strict()
        .safeParse(req.body);
    if (!p.success || !b.success)
      return reply.code(400).send({ error: "validation_error" });
    const hash = createHash("sha256").update(b.data.body).digest("hex");
    try {
      const result = await db.begin(async (tx) => {
        const [c]: any[] =
          await tx`SELECT id,status FROM client_consents WHERE id=${p.data.consentId} FOR UPDATE`;
        if (!c || c!.status === "archived") return null;
        const [v]: any[] =
          await tx`INSERT INTO client_consent_versions(consent_id,version,title,body,content_sha256,effective_at,created_by) SELECT ${c.id},COALESCE(max(version),0)+1,${b.data.title},${b.data.body},${hash},${b.data.effectiveAt ?? null},${actor.actorId} FROM client_consent_versions WHERE consent_id=${c.id} RETURNING id,version,status`;
        await audit(
          tx,
          actor.actorId,
          "consent.version_created",
          "client_consent_version",
          v!.id,
          null,
        );
        return v;
      });
      if (!result) return reply.code(404).send({ error: "consent_not_found" });
      return reply.code(201).send(result);
    } catch {
      req.log.error(
        { route: "POST /api/consents/:consentId/versions" },
        "consent version create failed",
      );
      return reply.code(409).send({ error: "version_conflict" });
    }
  });
  app.post("/api/consents/:consentId/activate", async (req, reply) => {
    const actor = await staff(req, reply, "consents.manage");
    if (!actor) return;
    const p = z.object({ consentId: uuid }).safeParse(req.params);
    if (!p.success)
      return reply.code(400).send({ error: "invalid_consent_id" });
    try {
      const result = await db.begin(async (tx) => {
        const [v]: any[] =
          await tx`SELECT id,version FROM client_consent_versions WHERE consent_id=${p.data.consentId} AND status='draft' ORDER BY version DESC LIMIT 1 FOR UPDATE`;
        if (!v) return null;
        await tx`UPDATE client_consent_versions SET status='active' WHERE id=${v.id}`;
        await tx`UPDATE client_consent_versions SET status='archived' WHERE consent_id=${p.data.consentId} AND id<>${v.id} AND status='active'`;
        await tx`UPDATE client_consents SET status='active',active_version_id=${v.id},updated_at=now() WHERE id=${p.data.consentId} AND status<>'archived'`;
        await audit(
          tx,
          actor.actorId,
          "consent.activated",
          "client_consent_version",
          v!.id,
          null,
          { version: v!.version },
        );
        return { version: v!.version };
      });
      if (!result)
        return reply.code(409).send({ error: "draft_version_unavailable" });
      return result;
    } catch {
      req.log.error(
        { route: "POST /api/consents/:consentId/activate" },
        "consent activation failed",
      );
      return reply.code(500).send({ error: "internal_error" });
    }
  });
  app.get("/api/client-portal/consents", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const actor = await client(req, reply);
    if (!actor) return;
    try {
      return await db`SELECT c.id AS "consentId",v.id AS "versionId",v.title,v.body,v.version,v.content_sha256 AS "contentHash",v.effective_at AS "effectiveAt",c.required,(a.id IS NOT NULL) AS accepted FROM client_consents c JOIN client_consent_versions v ON v.id=c.active_version_id LEFT JOIN client_consent_acceptances a ON a.client_id=${actor.clientId} AND a.consent_version_id=v.id WHERE c.status='active' ORDER BY c.required DESC,c.name`;
    } catch (error) {
      req.log.error(
        {
          route: "GET /api/client-portal/consents",
          databaseCode:
            typeof error === "object" && error && "code" in error
              ? String(error.code)
              : "unknown",
          constraint:
            typeof error === "object" && error && "constraint_name" in error
              ? String(error.constraint_name)
              : undefined,
        },
        "consent list failed",
      );
      return reply.code(500).send({ error: "internal_error" });
    }
  });
  app.post(
    "/api/client-portal/consents/:versionId/accept",
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const actor = await client(req, reply);
      if (!actor) return;
      const p = z.object({ versionId: uuid }).safeParse(req.params),
        b = z
          .object({ typedName: safeText(160), accepted: z.literal(true) })
          .strict()
          .safeParse(req.body),
        key = uuid.safeParse(req.headers["idempotency-key"]);
      if (!p.success || !b.success || !key.success)
        return reply.code(400).send({ error: "validation_error" });
      try {
        const result = await db.begin(async (tx) => {
          const [v]: any[] =
            await tx`SELECT v.id,v.body,v.content_sha256 AS hash FROM client_consent_versions v JOIN client_consents c ON c.active_version_id=v.id AND c.status='active' WHERE v.id=${p.data.versionId} AND v.status='active' FOR SHARE`;
          if (!v) return { error: "consent_version_unavailable" as const };
          const [a]: any[] =
            await tx`INSERT INTO client_consent_acceptances(client_id,consent_version_id,method,typed_name,accepted_by,accepted_content_sha256,accepted_content_snapshot,idempotency_key) VALUES(${actor.clientId},${v.id},'checkbox_typed_name',${b.data.typedName},${actor.clientId},${v.hash},${v.body},${key.data}) ON CONFLICT(client_id,consent_version_id) DO NOTHING RETURNING id,accepted_at AS "acceptedAt"`;
          if (!a) {
            const [prior]: any[] =
              await tx`SELECT id,accepted_at AS "acceptedAt" FROM client_consent_acceptances WHERE client_id=${actor.clientId} AND consent_version_id=${v.id}`;
            return prior
              ? { acceptance: prior, replay: true }
              : { error: "consent_already_accepted" as const };
          }
          await audit(
            tx,
            actor.clientId,
            "consent.accepted",
            "client_consent_acceptance",
            a.id,
            actor.clientId,
            { versionId: v!.id, contentHash: v!.hash },
          );
          return { acceptance: a, replay: false };
        });
        if ("error" in result)
          return reply.code(409).send({ error: result.error });
        return reply.code(result.replay ? 200 : 201).send(result.acceptance);
      } catch {
        req.log.error(
          { route: "POST /api/client-portal/consents/:versionId/accept" },
          "consent acceptance failed",
        );
        return reply.code(409).send({ error: "acceptance_conflict" });
      }
    },
  );
  app.post(
    "/api/clients/:clientId/consents/:versionId/accept-assisted",
    async (req, reply) => {
      const actor = await staff(req, reply, "consents.accept.assisted");
      if (!actor) return;
      if (!can(actor, "consents.read"))
        return reply.code(403).send({ error: "permission_denied" });
      const p = z
          .object({ clientId: uuid, versionId: uuid })
          .safeParse(req.params),
        b = z
          .object({ typedName: safeText(160), accepted: z.literal(true) })
          .strict()
          .safeParse(req.body),
        key = uuid.safeParse(req.headers["idempotency-key"]);
      if (!p.success || !b.success || !key.success)
        return reply.code(400).send({ error: "validation_error" });
      try {
        const result = await db.begin(async (tx) => {
          await tx`SELECT pg_advisory_xact_lock(hashtextextended(${key.data},0))`;
          const [v]: any[] =
            await tx`SELECT v.id,v.body,v.content_sha256 AS hash FROM client_consent_versions v JOIN client_consents c ON c.active_version_id=v.id AND c.status='active' WHERE v.id=${p.data.versionId} AND v.status='active' FOR SHARE`;
          if (!v) return { error: "consent_version_unavailable" as const };
          const [clientRow]: any[] =
            await tx`SELECT id FROM clients WHERE id=${p.data.clientId} AND status='active' FOR SHARE`;
          if (!clientRow) return { error: "client_not_found" as const };
          const [a]: any[] =
            await tx`INSERT INTO client_consent_acceptances(client_id,consent_version_id,method,typed_name,accepted_by,accepted_content_sha256,accepted_content_snapshot,idempotency_key) VALUES(${p.data.clientId},${v.id},'staff_assisted',${b.data.typedName},${actor.actorId},${v.hash},${v.body},${key.data}) ON CONFLICT(client_id,consent_version_id) DO NOTHING RETURNING id,accepted_at AS "acceptedAt"`;
          if (!a) {
            const [prior]: any[] =
              await tx`SELECT id,accepted_at AS "acceptedAt" FROM client_consent_acceptances WHERE client_id=${p.data.clientId} AND consent_version_id=${v.id}`;
            return prior
              ? { acceptance: prior, replay: true }
              : { error: "consent_already_accepted" as const };
          }
          await audit(
            tx,
            actor.actorId,
            "consent.accepted",
            "client_consent_acceptance",
            a.id,
            p.data.clientId,
            { versionId: v.id, contentHash: v.hash, method: "staff_assisted" },
          );
          return { acceptance: a, replay: false };
        });
        if ("error" in result)
          return reply
            .code(result.error === "client_not_found" ? 404 : 409)
            .send({ error: result.error });
        return reply.code(result.replay ? 200 : 201).send(result.acceptance);
      } catch {
        req.log.error(
          {
            route:
              "POST /api/clients/:clientId/consents/:versionId/accept-assisted",
          },
          "assisted consent acceptance failed",
        );
        return reply.code(409).send({ error: "acceptance_conflict" });
      }
    },
  );
  app.post("/api/document-requirements", async (req, reply) => {
    const actor = await staff(req, reply, "documents.manage");
    if (!actor) return;
    const b = z
      .object({
        scopeType: z.enum(["center", "client", "service", "plan"]),
        scopeId: uuid.nullable().optional(),
        requirementType: z.enum(["form", "consent"]),
        formId: uuid.nullable().optional(),
        consentId: uuid.nullable().optional(),
        required: z.boolean().default(true),
        retentionPolicyKey: z.string().max(80).nullable().optional(),
      })
      .strict()
      .superRefine((x, c) => {
        if ((x.scopeType === "center") !== (x.scopeId == null))
          c.addIssue({
            code: "custom",
            message: "El ámbito debe tener un identificador coherente.",
          });
        if (
          x.requirementType === "form"
            ? !x.formId || x.consentId != null
            : !x.consentId || x.formId != null
        )
          c.addIssue({
            code: "custom",
            message: "Indica exactamente el formulario o consentimiento.",
          });
      })
      .safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "validation_error" });
    try {
      const result = await db.begin(async (tx) => {
        let scopeExists = true;
        if (b.data.scopeType === "client") {
          const [r]: any[] =
            await tx`SELECT id FROM clients WHERE id=${b.data.scopeId!} AND status='active'`;
          scopeExists = Boolean(r);
        } else if (b.data.scopeType === "service") {
          const [r]: any[] =
            await tx`SELECT id FROM services WHERE id=${b.data.scopeId!} AND status='active'`;
          scopeExists = Boolean(r);
        } else if (b.data.scopeType === "plan") {
          const [r]: any[] =
            await tx`SELECT id FROM plans WHERE id=${b.data.scopeId!} AND status<>'archived'`;
          scopeExists = Boolean(r);
        }
        if (!scopeExists) return { error: "scope_not_found" as const };
        let targetExists: boolean;
        if (b.data.requirementType === "form") {
          const [r]: any[] =
            await tx`SELECT id FROM client_forms WHERE id=${b.data.formId!} AND status='active' AND active_version_id IS NOT NULL`;
          targetExists = Boolean(r);
        } else {
          const [r]: any[] =
            await tx`SELECT id FROM client_consents WHERE id=${b.data.consentId!} AND status='active' AND active_version_id IS NOT NULL`;
          targetExists = Boolean(r);
        }
        if (!targetExists) return { error: "document_not_active" as const };
        const [row]: any[] =
          await tx`INSERT INTO document_requirements(scope_type,scope_id,requirement_type,form_id,consent_id,required,retention_policy_key,created_by) VALUES(${b.data.scopeType},${b.data.scopeId ?? null},${b.data.requirementType},${b.data.formId ?? null},${b.data.consentId ?? null},${b.data.required},${b.data.retentionPolicyKey ?? null},${actor.actorId}) RETURNING id,scope_type AS "scopeType",scope_id AS "scopeId",requirement_type AS "requirementType",form_id AS "formId",consent_id AS "consentId",required,active`;
        await audit(
          tx,
          actor.actorId,
          "requirement.created",
          "document_requirement",
          row.id,
          b.data.scopeType === "client" ? (b.data.scopeId ?? null) : null,
          { scopeType: b.data.scopeType },
        );
        return row;
      });
      if ("error" in result)
        return reply
          .code(result.error === "scope_not_found" ? 404 : 409)
          .send({ error: result.error });
      return reply.code(201).send(result);
    } catch {
      req.log.error(
        { route: "POST /api/document-requirements" },
        "requirement create failed",
      );
      return reply.code(409).send({ error: "requirement_conflict" });
    }
  });
  app.post("/api/clients/:clientId/checkins", async (req, reply) => {
    const actor = await staff(req, reply, "followup.manage");
    if (!actor) return;
    const p = z.object({ clientId: uuid }).safeParse(req.params),
      b = z
        .object({
          formId: uuid,
          dueAt: z.string().datetime({ offset: true }).nullable().optional(),
        })
        .strict()
        .safeParse(req.body),
      key = uuid.safeParse(req.headers["idempotency-key"]);
    if (!p.success || !b.success || !key.success)
      return reply.code(400).send({ error: "validation_error" });
    try {
      const result = await db.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${key.data},0))`;
        const [v]: any[] =
          await tx`SELECT v.id FROM client_forms f JOIN client_form_versions v ON v.id=f.active_version_id WHERE f.id=${b.data.formId} AND f.category='check_in' AND f.status='active' FOR SHARE OF f,v`;
        if (!v) return { error: "checkin_form_unavailable" as const };
        const [prior]: any[] =
          await tx`SELECT a.id,a.status,a.due_at AS "dueAt",a.form_version_id AS "versionId",a.required FROM client_form_assignments a WHERE a.client_id=${p.data.clientId} AND a.idempotency_key=${key.data}`;
        if (prior) {
          const priorDue = prior.dueAt ? new Date(prior.dueAt).getTime() : null;
          const requestedDue = b.data.dueAt
            ? new Date(b.data.dueAt).getTime()
            : null;
          const sameRequest =
            prior.versionId === v.id &&
            !prior.required &&
            priorDue === requestedDue;
          return sameRequest
            ? { assignment: prior, replay: true }
            : { error: "idempotency_conflict" as const };
        }
        const [a]: any[] =
          await tx`INSERT INTO client_form_assignments(client_id,form_version_id,required,due_at,idempotency_key,assigned_by) SELECT c.id,${v.id},false,${b.data.dueAt ?? null},${key.data},${actor.actorId} FROM clients c WHERE c.id=${p.data.clientId} AND c.status='active' ON CONFLICT(client_id,idempotency_key) DO NOTHING RETURNING id,status,due_at AS "dueAt"`;
        if (!a) return { error: "client_not_found" as const };
        await audit(
          tx,
          actor.actorId,
          "form.assigned",
          "client_form_assignment",
          a.id,
          p.data.clientId,
          { kind: "check_in" },
        );
        return { assignment: a, replay: false };
      });
      if ("error" in result)
        return reply.code(409).send({ error: result.error });
      return reply.code(result.replay ? 200 : 201).send(result.assignment);
    } catch {
      req.log.error(
        { route: "POST /api/clients/:clientId/checkins" },
        "check-in assign failed",
      );
      return reply.code(409).send({ error: "checkin_conflict" });
    }
  });
  app.get("/api/clients/:clientId/followup", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const actor = await staff(req, reply, "followup.read");
    if (!actor) return;
    const p = z.object({ clientId: uuid }).safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: "invalid_client_id" });
    const sensitive =
      can(actor, "health.read") && can(actor, "forms.responses.sensitive.read");
    try {
      return await db`SELECT a.id,a.status,a.due_at AS "dueAt",a.assigned_at AS "assignedAt",f.name,f.category,v.version,CASE WHEN f.sensitivity='health' AND NOT ${sensitive} THEN NULL ELSE r.answers END AS answers,r.submitted_at AS "submittedAt" FROM client_form_assignments a JOIN client_form_versions v ON v.id=a.form_version_id JOIN client_forms f ON f.id=v.form_id LEFT JOIN client_form_responses r ON r.assignment_id=a.id WHERE a.client_id=${p.data.clientId} AND f.category='check_in' ORDER BY a.assigned_at DESC LIMIT 100`;
    } catch {
      req.log.error(
        { route: "GET /api/clients/:clientId/followup" },
        "follow-up history failed",
      );
      return reply.code(500).send({ error: "internal_error" });
    }
  });

  app.post(
    "/api/communications/messages/:messageId/unread",
    async (req, reply) => {
      const actor = await staff(req, reply, "communication.read");
      if (!actor) return;
      const p = z.object({ messageId: uuid }).safeParse(req.params);
      if (!p.success)
        return reply.code(400).send({ error: "invalid_message_id" });
      try {
        await db.begin(async (tx) => {
          const [row]: any[] =
            await tx`INSERT INTO communication_message_reads(message_id,reader_kind,is_read,actor_id) SELECT m.id,'center',false,${actor.actorId} FROM communication_messages m WHERE m.id=${p.data.messageId} AND m.sender_kind='client' ON CONFLICT(message_id,reader_kind) DO UPDATE SET is_read=false,actor_id=excluded.actor_id,updated_at=now() RETURNING message_id`;
          if (!row) throw new Error("message_not_found");
          const [event]: any[] =
            await tx`SELECT c.client_id AS id FROM communication_messages m JOIN communication_conversations c ON c.id=m.conversation_id WHERE m.id=${p.data.messageId}`;
          await audit(
            tx,
            actor.actorId,
            "message.unread",
            "communication_message",
            p.data.messageId,
            event?.id ?? null,
          );
        });
        return { unread: true };
      } catch (error) {
        if (error instanceof Error && error.message === "message_not_found")
          return reply.code(404).send({ error: "message_not_found" });
        req.log.error(
          { route: "POST /api/communications/messages/:messageId/unread" },
          "mark unread failed",
        );
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );

  app.post(
    "/api/communications/templates/:templateId/archive",
    async (req, reply) => {
      const actor = await staff(req, reply, "communication.manage_templates");
      if (!actor) return;
      const p = z.object({ templateId: uuid }).safeParse(req.params);
      if (!p.success)
        return reply.code(400).send({ error: "invalid_template_id" });
      try {
        const result = await db.begin(async (tx) => {
          const [row]: any[] =
            await tx`UPDATE communication_templates SET status='archived',archived_at=now(),updated_at=now(),updated_by=${actor.actorId} WHERE id=${p.data.templateId} AND status='active' RETURNING id`;
          if (row)
            await audit(
              tx,
              actor.actorId,
              "template.archived",
              "communication_template",
              row.id,
              null,
            );
          return row;
        });
        if (!result)
          return reply.code(404).send({ error: "template_not_found" });
        return { id: result.id, status: "archived" };
      } catch {
        req.log.error(
          { route: "POST /api/communications/templates/:templateId/archive" },
          "template archive failed",
        );
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );

  app.patch("/api/communications/templates/:templateId", async (req, reply) => {
    const actor = await staff(req, reply, "communication.manage_templates");
    if (!actor) return;
    const p = z.object({ templateId: uuid }).safeParse(req.params),
      b = z
        .object({
          name: safeText(120),
          category: z.enum([
            "welcome",
            "documents",
            "payment",
            "reservation",
            "followup",
            "general",
          ]),
          body: safeText(5000),
        })
        .strict()
        .safeParse(req.body);
    if (!p.success || !b.success)
      return reply.code(400).send({ error: "validation_error" });
    try {
      const row = await db.begin(async (tx) => {
        const [updated]: any[] =
          await tx`UPDATE communication_templates SET name=${b.data.name},category=${b.data.category},body=${b.data.body},updated_by=${actor.actorId},updated_at=now() WHERE id=${p.data.templateId} AND status='active' RETURNING id,name,category,body,status,updated_at AS "updatedAt"`;
        if (updated)
          await audit(
            tx,
            actor.actorId,
            "template.updated",
            "communication_template",
            updated.id,
            null,
          );
        return updated;
      });
      if (!row)
        return reply.code(404).send({ error: "active_template_not_found" });
      return row;
    } catch {
      req.log.error(
        { route: "PATCH /api/communications/templates/:templateId" },
        "template update failed",
      );
      return reply.code(500).send({ error: "internal_error" });
    }
  });

  app.post("/api/forms/:formId/archive", async (req, reply) => {
    const actor = await staff(req, reply, "forms.manage");
    if (!actor) return;
    const p = z.object({ formId: uuid }).safeParse(req.params);
    if (!p.success) return reply.code(400).send({ error: "invalid_form_id" });
    try {
      const result = await db.begin(async (tx) => {
        const [row]: any[] =
          await tx`UPDATE client_forms SET status='archived',archived_at=now(),updated_at=now() WHERE id=${p.data.formId} AND status<>'archived' RETURNING id`;
        if (row) {
          await tx`UPDATE client_form_versions SET status='archived' WHERE form_id=${row.id} AND status='active'`;
          await tx`UPDATE client_form_assignments SET status='cancelled',updated_at=now() WHERE form_version_id IN(SELECT id FROM client_form_versions WHERE form_id=${row.id}) AND status='assigned'`;
          const requirements =
            await tx`UPDATE document_requirements SET active=false,archived_at=now(),updated_at=now() WHERE form_id=${row.id} AND active RETURNING id,scope_type AS "scopeType",scope_id AS "scopeId"`;
          for (const requirement of requirements)
            await audit(
              tx,
              actor.actorId,
              "requirement.archived",
              "document_requirement",
              requirement.id,
              requirement.scopeType === "client" ? requirement.scopeId : null,
              { scopeType: requirement.scopeType, reason: "form_archived" },
            );
          await audit(
            tx,
            actor.actorId,
            "form.archived",
            "client_form",
            row.id,
            null,
          );
        }
        return row;
      });
      if (!result) return reply.code(404).send({ error: "form_not_found" });
      return { id: result.id, status: "archived" };
    } catch {
      req.log.error(
        { route: "POST /api/forms/:formId/archive" },
        "form archive failed",
      );
      return reply.code(500).send({ error: "internal_error" });
    }
  });

  app.post("/api/consents/:consentId/archive", async (req, reply) => {
    const actor = await staff(req, reply, "consents.manage");
    if (!actor) return;
    const p = z.object({ consentId: uuid }).safeParse(req.params);
    if (!p.success)
      return reply.code(400).send({ error: "invalid_consent_id" });
    try {
      const result = await db.begin(async (tx) => {
        const [row]: any[] =
          await tx`UPDATE client_consents SET status='archived',archived_at=now(),updated_at=now() WHERE id=${p.data.consentId} AND status<>'archived' RETURNING id`;
        if (row) {
          await tx`UPDATE client_consent_versions SET status='archived' WHERE consent_id=${row.id} AND status='active'`;
          const requirements =
            await tx`UPDATE document_requirements SET active=false,archived_at=now(),updated_at=now() WHERE consent_id=${row.id} AND active RETURNING id,scope_type AS "scopeType",scope_id AS "scopeId"`;
          for (const requirement of requirements)
            await audit(
              tx,
              actor.actorId,
              "requirement.archived",
              "document_requirement",
              requirement.id,
              requirement.scopeType === "client" ? requirement.scopeId : null,
              { scopeType: requirement.scopeType, reason: "consent_archived" },
            );
          await audit(
            tx,
            actor.actorId,
            "consent.archived",
            "client_consent",
            row.id,
            null,
          );
        }
        return row;
      });
      if (!result) return reply.code(404).send({ error: "consent_not_found" });
      return { id: result.id, status: "archived" };
    } catch {
      req.log.error(
        { route: "POST /api/consents/:consentId/archive" },
        "consent archive failed",
      );
      return reply.code(500).send({ error: "internal_error" });
    }
  });

  app.post(
    "/api/document-requirements/:requirementId/archive",
    async (req, reply) => {
      const actor = await staff(req, reply, "documents.manage");
      if (!actor) return;
      const p = z.object({ requirementId: uuid }).safeParse(req.params);
      if (!p.success)
        return reply.code(400).send({ error: "invalid_requirement_id" });
      try {
        const result = await db.begin(async (tx) => {
          const [row]: any[] =
            await tx`UPDATE document_requirements SET active=false,archived_at=now(),updated_at=now() WHERE id=${p.data.requirementId} AND active RETURNING id,scope_type AS "scopeType",scope_id AS "scopeId"`;
          if (row)
            await audit(
              tx,
              actor.actorId,
              "requirement.archived",
              "document_requirement",
              row.id,
              row.scopeType === "client" ? row.scopeId : null,
              { scopeType: row.scopeType },
            );
          return row;
        });
        if (!result)
          return reply.code(404).send({ error: "requirement_not_found" });
        return { id: result.id, active: false };
      } catch {
        req.log.error(
          { route: "POST /api/document-requirements/:requirementId/archive" },
          "requirement archive failed",
        );
        return reply.code(500).send({ error: "internal_error" });
      }
    },
  );

  app.get("/api/client-portal/form-assignments", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const actor = await client(req, reply);
    if (!actor) return;
    try {
      return await db`SELECT a.id,a.status,a.required,a.due_at AS "dueAt",a.assigned_at AS "assignedAt",f.name,f.category,v.version FROM client_form_assignments a JOIN client_form_versions v ON v.id=a.form_version_id JOIN client_forms f ON f.id=v.form_id WHERE a.client_id=${actor.clientId} AND a.status IN ('assigned','review_required','rejected') ORDER BY a.required DESC,a.due_at NULLS LAST,a.assigned_at DESC LIMIT 100`;
    } catch {
      req.log.error(
        { route: "GET /api/client-portal/form-assignments" },
        "client assignments failed",
      );
      return reply.code(500).send({ error: "internal_error" });
    }
  });
}
