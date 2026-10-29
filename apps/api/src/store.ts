import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { can, type AuthorizationContext } from '@2j/permissions';
import { lockOpenCashSession, previousDayCashSessionMessage } from './cash-session.js';
import type { createDatabase } from './db.js';
import type { ClientAuthorizationContext } from './communications.js';

type DB = ReturnType<typeof createDatabase>['client'];
const uuid = z.string().uuid().transform(value => value.toLowerCase());
const text = (max: number) => z.string().max(max * 2).transform(value => value.normalize('NFKC').trim()).pipe(z.string().min(1).max(max));
const productInput = z.object({ category: z.enum(['nutrition','merchandising']), name: text(120), description: z.string().max(2000).default('') }).strict();
const productPatch = z.object({ category: z.enum(['nutrition','merchandising']).optional(), name: text(120).optional(), description: z.string().max(2000).optional(), active: z.boolean().optional() }).strict().refine(value => Object.keys(value).length > 0);
const variantInput = z.object({ sku: z.string().max(80).nullable().optional(), label: text(100), size: z.string().max(40).nullable().optional(), flavor: z.string().max(80).nullable().optional(), priceCents: z.number().int().min(0).max(100_000_000_000), active: z.boolean().default(true), stockTracked: z.boolean().default(true) }).strict();
const variantPatch = z.object({ sku: z.string().max(80).nullable().optional(), label: text(100).optional(), size: z.string().max(40).nullable().optional(), flavor: z.string().max(80).nullable().optional(), priceCents: z.number().int().min(0).max(100_000_000_000).optional(), active: z.boolean().optional(), stockTracked: z.boolean().optional() }).strict().refine(value => Object.keys(value).length > 0);
const movementInput = z.object({ type: z.enum(['opening','restock','adjustment_in','adjustment_out']), quantity: z.number().int().min(1).max(100_000), reason: text(300) }).strict();
const saleInput = z.object({ clientId: uuid, lines: z.array(z.object({ variantId: uuid, quantity: z.number().int().min(1).max(1000) }).strict()).min(1).max(50), paymentState: z.enum(['paid','pending']), paymentMethod: z.enum(['cash','card','transfer','other']).nullable().optional(), note: z.string().max(500).default('') }).strict().superRefine((value, ctx) => { if (new Set(value.lines.map(line => line.variantId)).size !== value.lines.length) ctx.addIssue({ code:'custom', path:['lines'], message:'No se puede repetir una variante.' }); });
const centerKey = '2j';
const money = (value: unknown) => Number(value ?? 0);
function normalizeSale<T extends {totalCents?:unknown;subtotalCents?:unknown;lines?:Array<Record<string,unknown>>}>(sale:T):T {
  return {...sale,...(sale.totalCents!==undefined?{totalCents:money(sale.totalCents)}:{}),...(sale.subtotalCents!==undefined?{subtotalCents:money(sale.subtotalCents)}:{}),...(sale.lines?{lines:sale.lines.map(line=>({...line,...(line.unitPriceCents!==undefined?{unitPriceCents:money(line.unitPriceCents)}:{}),...(line.lineTotalCents!==undefined?{lineTotalCents:money(line.lineTotalCents)}:{})}))}:{})};
}

export async function staffContext(request: FastifyRequest, reply: any, resolve: (request: FastifyRequest) => Promise<AuthorizationContext | null>, permission: string) {
  const actor = await resolve(request);
  if (!actor) { reply.code(401).send({ error: 'authentication_required' }); return null; }
  if (!can(actor, permission)) { reply.code(403).send({ error: 'permission_denied' }); return null; }
  return actor;
}

async function memberContext(request: FastifyRequest, reply: any, db: DB, resolve: (request: FastifyRequest) => Promise<ClientAuthorizationContext | null>) {
  reply.header('Cache-Control','no-store');
  const actor = await resolve(request);
  if (!actor || !uuid.safeParse(actor.clientId).success) { reply.code(401).send({ error:'client_authentication_required' }); return null; }
  const clientId = actor.clientId.toLowerCase();
  const [active] = await db`SELECT id FROM clients WHERE id=${clientId} AND status='active'`;
  if (!active) { reply.code(401).send({ error:'client_authentication_required' }); return null; }
  return clientId;
}

export async function audit(tx: any, actorId: string, action: string, type: string, id: string, details: Record<string, unknown> = {}) {
  await tx`INSERT INTO store_audit_events(actor_id,action,resource_type,resource_id,details) VALUES (${actorId},${action},${type},${id}::uuid,${JSON.stringify(details)}::jsonb)`;
}

async function variantStock(tx: any, variantId: string) {
  const [row] = await tx`SELECT COALESCE(sum(quantity_delta),0)::int AS stock FROM store_inventory_movements WHERE variant_id=${variantId}::uuid`;
  return Number(row?.stock ?? 0);
}

export function registerStoreRoutes(app: FastifyInstance, db: DB, resolveStaff: (request: FastifyRequest) => Promise<AuthorizationContext | null>, resolveMember: (request: FastifyRequest) => Promise<ClientAuthorizationContext | null>) {
  app.get('/api/me/store/catalog', async (request, reply) => {
    if (!await memberContext(request,reply,db,resolveMember)) return;
    const items = await db`SELECT p.id,p.category,p.name,p.description,v.id AS "variantId",v.label AS "variantLabel",v.size,v.flavor,v.price_cents AS "priceCents",CASE WHEN NOT v.stock_tracked THEN 'disponible' WHEN COALESCE(stock.balance,0)<=0 THEN 'agotado' WHEN COALESCE(stock.balance,0)<=3 THEN 'pocas_unidades' ELSE 'disponible' END AS availability
      FROM store_products p JOIN store_product_variants v ON v.product_id=p.id AND v.active LEFT JOIN LATERAL (SELECT sum(m.quantity_delta)::int AS balance FROM store_inventory_movements m WHERE m.variant_id=v.id) stock ON true
      WHERE p.center_key=${centerKey} AND p.active ORDER BY p.category,p.name,v.label,v.id`;
    const products = new Map<string, any>();
    for (const row of items) { const product = products.get(row.id) ?? { id:row.id,category:row.category,name:row.name,description:row.description,variants:[] }; product.variants.push({ id:row.variantId,label:row.variantLabel,size:row.size,flavor:row.flavor,priceCents:money(row.priceCents),availability:row.availability }); products.set(row.id,product); }
    return { items:[...products.values()] };
  });

  app.get('/api/me/store/purchases', async (request, reply) => {
    const clientId = await memberContext(request,reply,db,resolveMember); if (!clientId) return;
    const sales = await db`SELECT s.id,s.status,s.payment_state AS "paymentState",s.total_cents AS "totalCents",s.created_at AS "createdAt",
      COALESCE(jsonb_agg(jsonb_build_object('productName',l.product_name_snapshot,'variantLabel',l.variant_label_snapshot,'quantity',l.quantity,'unitPriceCents',l.unit_price_cents,'lineTotalCents',l.line_total_cents) ORDER BY l.id) FILTER (WHERE l.id IS NOT NULL),'[]'::jsonb) AS lines
      FROM store_sales s LEFT JOIN store_sale_lines l ON l.sale_id=s.id WHERE s.client_id=${clientId}::uuid GROUP BY s.id ORDER BY s.created_at DESC,s.id DESC LIMIT 200`;
    return { items:sales.map(normalizeSale) };
  });

  app.get('/api/admin/store', async (request,reply) => {
    const actor=await staffContext(request,reply,resolveStaff,'store.catalog.read');if(!actor)return;
    const products = await db`SELECT p.id,p.category,p.name,p.description,p.active,p.updated_at AS "updatedAt",COALESCE(jsonb_agg(jsonb_build_object('id',v.id,'sku',v.sku,'label',v.label,'size',v.size,'flavor',v.flavor,'priceCents',v.price_cents,'active',v.active,'stockTracked',v.stock_tracked,'stock',COALESCE(stock.balance,0)) ORDER BY v.label,v.id) FILTER(WHERE v.id IS NOT NULL),'[]'::jsonb) AS variants
      FROM store_products p LEFT JOIN store_product_variants v ON v.product_id=p.id LEFT JOIN LATERAL(SELECT sum(m.quantity_delta)::int AS balance FROM store_inventory_movements m WHERE m.variant_id=v.id) stock ON true WHERE p.center_key=${centerKey} GROUP BY p.id ORDER BY p.updated_at DESC,p.id DESC LIMIT 500`;
    const movements = can(actor,'store.inventory.read') ? await db`SELECT m.id,m.variant_id AS "variantId",m.quantity_delta AS "quantityDelta",m.movement_type AS type,m.reason,m.occurred_at AS "occurredAt",p.name AS "productName",v.label AS "variantLabel" FROM store_inventory_movements m JOIN store_product_variants v ON v.id=m.variant_id JOIN store_products p ON p.id=v.product_id ORDER BY m.occurred_at DESC,m.id DESC LIMIT 100` : [];
    const sales = can(actor,'store.sales.read') ? await db`SELECT s.id,s.client_id AS "clientId",c.first_name AS "firstName",c.last_name AS "lastName",s.status,s.payment_state AS "paymentState",s.payment_method AS "paymentMethod",s.total_cents AS "totalCents",s.created_at AS "createdAt",s.created_by AS "createdBy",COALESCE(jsonb_agg(jsonb_build_object('productName',l.product_name_snapshot,'variantLabel',l.variant_label_snapshot,'quantity',l.quantity,'unitPriceCents',l.unit_price_cents,'lineTotalCents',l.line_total_cents) ORDER BY l.id) FILTER(WHERE l.id IS NOT NULL),'[]'::jsonb) AS lines FROM store_sales s JOIN clients c ON c.id=s.client_id LEFT JOIN store_sale_lines l ON l.sale_id=s.id WHERE s.center_key=${centerKey} GROUP BY s.id,c.first_name,c.last_name ORDER BY s.created_at DESC,s.id DESC LIMIT 200` : [];
    const mediaRows=await db`SELECT id,product_id AS "productId",position,is_primary AS "isPrimary",mime_type AS "mimeType",size_bytes AS "sizeBytes" FROM store_product_media ORDER BY product_id,position`;
    const mediaByProduct=new Map<string,any[]>();for(const row of mediaRows){const list=mediaByProduct.get(row.productId)??[];list.push({id:row.id,position:row.position,isPrimary:row.isPrimary,mimeType:row.mimeType,sizeBytes:row.sizeBytes});mediaByProduct.set(row.productId,list);}
    const visibleProducts=products.map((product:any)=>({...product,media:mediaByProduct.get(product.id)??[],variants:product.variants.map((variant:any)=>can(actor,'store.inventory.read')?variant:{...variant,stock:null})}));
    return { products:visibleProducts, movements, sales:sales.map(normalizeSale), capabilities:{ manageCatalog:can(actor,'store.catalog.manage'),manageInventory:can(actor,'store.inventory.manage'),readInventory:can(actor,'store.inventory.read'),readSales:can(actor,'store.sales.read'),createSales:can(actor,'store.sales.create'),voidSales:can(actor,'store.sales.void') } };
  });

  app.post('/api/admin/store/products', async (request,reply) => {
    const actor=await staffContext(request,reply,resolveStaff,'store.catalog.manage');if(!actor)return;
    const parsed=productInput.safeParse(request.body);if(!parsed.success)return reply.code(400).send({error:'validation_error'});
    const [product]=await db.begin(async tx=>{const rows=await tx`INSERT INTO store_products(center_key,category,name,description,created_by,updated_by) VALUES (${centerKey},${parsed.data.category},${parsed.data.name},${parsed.data.description},${actor.actorId},${actor.actorId}) RETURNING id,category,name,description,active,created_at AS "createdAt"`;if(!rows[0])throw new Error('store_product_insert_missing');await audit(tx,actor.actorId,'product.created','product',rows[0].id,{category:parsed.data.category});return rows;});
    return reply.code(201).send(product);
  });

  app.patch('/api/admin/store/products/:productId', async (request,reply) => {
    const actor=await staffContext(request,reply,resolveStaff,'store.catalog.manage');if(!actor)return;
    const params=z.object({productId:uuid}).safeParse(request.params);const parsed=productPatch.safeParse(request.body);if(!params.success||!parsed.success)return reply.code(400).send({error:'validation_error'});
    const result=await db.begin(async tx=>{const [current]=await tx`SELECT id,category,name,description,active FROM store_products WHERE id=${params.data.productId} AND center_key=${centerKey} FOR UPDATE`;if(!current)return null;const [updated]=await tx`UPDATE store_products SET category=${parsed.data.category??current.category},name=${parsed.data.name??current.name},description=${parsed.data.description??current.description},active=${parsed.data.active??current.active},updated_at=now(),updated_by=${actor.actorId} WHERE id=${params.data.productId} RETURNING id,category,name,description,active,updated_at AS "updatedAt"`;if(!updated)throw new Error('store_product_update_missing');const action=parsed.data.active===undefined?'product.updated':parsed.data.active?'product.activated':'product.deactivated';await audit(tx,actor.actorId,action,'product',updated.id,{changed:Object.keys(parsed.data)});return updated;});
    return result??reply.code(404).send({error:'product_not_found'});
  });

  app.post('/api/admin/store/products/:productId/variants', async (request,reply) => {
    const actor=await staffContext(request,reply,resolveStaff,'store.catalog.manage');if(!actor)return;
    const params=z.object({productId:uuid}).safeParse(request.params);const parsed=variantInput.safeParse(request.body);if(!params.success||!parsed.success)return reply.code(400).send({error:'validation_error'});
    const [product]=await db`SELECT id FROM store_products WHERE id=${params.data.productId} AND center_key=${centerKey}`;if(!product)return reply.code(404).send({error:'product_not_found'});
    try { const rows=await db.begin(async tx=>{const inserted=await tx`INSERT INTO store_product_variants(product_id,sku,label,size,flavor,price_cents,active,stock_tracked,created_by,updated_by) VALUES (${product.id},${parsed.data.sku?.trim()||null},${parsed.data.label},${parsed.data.size??null},${parsed.data.flavor??null},${parsed.data.priceCents},${parsed.data.active},${parsed.data.stockTracked},${actor.actorId},${actor.actorId}) RETURNING id,product_id AS "productId",sku,label,size,flavor,price_cents AS "priceCents",active,stock_tracked AS "stockTracked"`;if(!inserted[0])throw new Error('store_variant_insert_missing');await audit(tx,actor.actorId,'variant.created','variant',inserted[0].id,{priceCents:parsed.data.priceCents});return inserted;});return reply.code(201).send(rows[0]);} catch(error:any){if(error?.code==='23505')return reply.code(409).send({error:'sku_conflict'});return reply.code(500).send({error:'internal_error'});}
  });

  app.patch('/api/admin/store/variants/:variantId', async (request,reply) => {
    const actor=await staffContext(request,reply,resolveStaff,'store.catalog.manage');if(!actor)return;
    const params=z.object({variantId:uuid}).safeParse(request.params);const parsed=variantPatch.safeParse(request.body);if(!params.success||!parsed.success)return reply.code(400).send({error:'validation_error'});
    const current=(await db`SELECT v.* FROM store_product_variants v JOIN store_products p ON p.id=v.product_id WHERE v.id=${params.data.variantId} AND p.center_key=${centerKey}`)[0];if(!current)return reply.code(404).send({error:'variant_not_found'});
    try {const values=parsed.data;const rows=await db.begin(async tx=>{const [locked]=await tx`SELECT id,stock_tracked AS "stockTracked" FROM store_product_variants WHERE id=${current.id} FOR UPDATE`;if(!locked)return null;if(values.stockTracked!==undefined&&values.stockTracked!==locked.stockTracked){const [used]=await tx`SELECT EXISTS(SELECT 1 FROM store_inventory_movements WHERE variant_id=${current.id}) OR EXISTS(SELECT 1 FROM store_sale_lines WHERE variant_id=${current.id}) AS used`;if(used?.used)return {error:'stock_tracking_locked'} as const;}const updated=await tx`UPDATE store_product_variants SET sku=${values.sku===undefined?current.sku:values.sku?.trim()||null},label=${values.label??current.label},size=${values.size===undefined?current.size:values.size},flavor=${values.flavor===undefined?current.flavor:values.flavor},price_cents=${values.priceCents??Number(current.price_cents)},active=${values.active??current.active},stock_tracked=${values.stockTracked??current.stock_tracked},updated_at=now(),updated_by=${actor.actorId} WHERE id=${current.id} RETURNING id,product_id AS "productId",sku,label,size,flavor,price_cents AS "priceCents",active,stock_tracked AS "stockTracked"`;if(!updated[0])throw new Error('store_variant_update_missing');const action=values.priceCents!==undefined&&values.priceCents!==Number(current.price_cents)?'variant.price_changed':values.active===undefined?'variant.updated':values.active?'variant.activated':'variant.deactivated';await audit(tx,actor.actorId,action,'variant',current.id,{changed:Object.keys(values),...(values.priceCents!==undefined?{priceCents:values.priceCents}:{})});return {row:updated[0]} as const;});if(!rows)return reply.code(404).send({error:'variant_not_found'});if('error'in rows)return reply.code(409).send({error:rows.error});return rows.row;}catch(error:any){if(error?.code==='23505')return reply.code(409).send({error:'sku_conflict'});return reply.code(500).send({error:'internal_error'});}
  });

  app.post('/api/admin/store/variants/:variantId/movements', async (request,reply) => {
    const actor=await staffContext(request,reply,resolveStaff,'store.inventory.manage');if(!actor)return;
    const params=z.object({variantId:uuid}).safeParse(request.params);const parsed=movementInput.safeParse(request.body);if(!params.success||!parsed.success)return reply.code(400).send({error:'validation_error'});
    let result;try{result=await db.begin(async tx=>{const [variant]=await tx`SELECT v.id,v.stock_tracked FROM store_product_variants v JOIN store_products p ON p.id=v.product_id WHERE v.id=${params.data.variantId} AND p.center_key=${centerKey} FOR UPDATE OF v`;if(!variant)return {error:'variant_not_found'} as const;if(!variant.stock_tracked)return {error:'stock_tracking_disabled'} as const;const before=await variantStock(tx,variant.id);const delta=parsed.data.type==='adjustment_out'?-parsed.data.quantity:parsed.data.quantity;if(before+delta<0)return {error:'insufficient_stock'} as const;const [movement]=await tx`INSERT INTO store_inventory_movements(variant_id,quantity_delta,movement_type,reason,actor_id) VALUES (${variant.id},${delta},${parsed.data.type},${parsed.data.reason},${actor.actorId}) RETURNING id,quantity_delta AS "quantityDelta",movement_type AS type,reason,occurred_at AS "occurredAt"`;if(!movement)throw new Error('store_movement_insert_missing');const action=parsed.data.type==='opening'?'inventory.opening':parsed.data.type==='restock'?'inventory.restocked':'inventory.adjusted';await audit(tx,actor.actorId,action,'variant',variant.id,{movementId:movement.id,quantityDelta:delta,reason:parsed.data.reason});return {movement,stock:before+delta};});}catch(error:any){if(error?.code==='23505')return reply.code(409).send({error:'opening_stock_already_registered'});return reply.code(500).send({error:'internal_error'});}
    if('error'in result)return reply.code(result.error==='variant_not_found'?404:409).send({error:result.error});return reply.code(201).send(result);
  });

  app.get('/api/admin/store/sales', async (request,reply) => {if(!await staffContext(request,reply,resolveStaff,'store.sales.read'))return;const items=await db`SELECT s.id,s.client_id AS "clientId",s.cash_session_id AS "cashSessionId",c.first_name AS "firstName",c.last_name AS "lastName",s.status,s.payment_state AS "paymentState",s.payment_method AS "paymentMethod",s.total_cents AS "totalCents",s.created_at AS "createdAt",COALESCE(jsonb_agg(jsonb_build_object('productName',l.product_name_snapshot,'variantLabel',l.variant_label_snapshot,'quantity',l.quantity,'unitPriceCents',l.unit_price_cents,'lineTotalCents',l.line_total_cents) ORDER BY l.id) FILTER(WHERE l.id IS NOT NULL),'[]'::jsonb) AS lines FROM store_sales s JOIN clients c ON c.id=s.client_id LEFT JOIN store_sale_lines l ON l.sale_id=s.id WHERE s.center_key=${centerKey} GROUP BY s.id,c.first_name,c.last_name ORDER BY s.created_at DESC,s.id DESC LIMIT 200`;return {items:items.map(normalizeSale)};});

  app.post('/api/admin/store/sales', async (request,reply) => {
    const actor=await staffContext(request,reply,resolveStaff,'store.sales.create');if(!actor)return;
    const key=request.headers['idempotency-key'];if(typeof key!=='string'||!uuid.safeParse(key).success)return reply.code(400).send({error:'idempotency_key_required'});
    const parsed=saleInput.safeParse(request.body);if(!parsed.success)return reply.code(400).send({error:'validation_error'});
    const body={...parsed.data,clientId:parsed.data.clientId.toLowerCase(),lines:[...parsed.data.lines].sort((a,b)=>a.variantId.localeCompare(b.variantId)),paymentMethod:parsed.data.paymentMethod??null,note:parsed.data.note.normalize('NFKC').trim()};const hash=createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const outcome=await db.begin(async tx=>{
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'store:'+centerKey+':'+key.toLowerCase()},0))`;
      const [existing]=await tx`SELECT id,request_hash AS "requestHash" FROM store_sales WHERE center_key=${centerKey} AND idempotency_key=${key}::uuid`;
      if(existing)return existing.requestHash.trim()===hash?{replay:existing.id}:{error:'idempotency_conflict'} as const;
      const cash=body.paymentState==='paid'?await lockOpenCashSession(tx,actor.actorId):null;
      if(cash&&!cash.ok)return {error:cash.error};
      const [member]=await tx`SELECT id FROM clients WHERE id=${body.clientId}::uuid AND status='active'`;if(!member)return {error:'member_not_found'} as const;
      const ids=body.lines.map(line=>line.variantId);
      const variants=await tx`SELECT v.id,v.label,v.sku,v.price_cents AS "priceCents",v.active AS "variantActive",v.stock_tracked AS "stockTracked",p.name AS "productName",p.active AS "productActive" FROM store_product_variants v JOIN store_products p ON p.id=v.product_id WHERE v.id=ANY(${ids}::uuid[]) AND p.center_key=${centerKey} ORDER BY v.id FOR UPDATE OF v,p`;
      if(variants.length!==body.lines.length)return {error:'variant_not_found'} as const;
      const lines=[] as Array<{variant:any;quantity:number;lineTotal:number}>;
      for(const line of body.lines){const variant=variants.find(v=>v.id===line.variantId);if(!variant)return {error:'variant_not_found'} as const;if(!variant.productActive)return {error:'product_inactive'} as const;if(!variant.variantActive)return {error:'variant_inactive'} as const;const stock=variant.stockTracked?await variantStock(tx,variant.id):Number.MAX_SAFE_INTEGER;if(stock<line.quantity)return {error:'insufficient_stock'} as const;lines.push({variant,quantity:line.quantity,lineTotal:money(variant.priceCents)*line.quantity});}
      const total=lines.reduce((sum,line)=>sum+line.lineTotal,0);if(!Number.isSafeInteger(total))return {error:'invalid_total'} as const;
      const [sale]=await tx`INSERT INTO store_sales(center_key,client_id,cash_session_id,payment_state,payment_method,subtotal_cents,total_cents,note,idempotency_key,request_hash,created_by) VALUES (${centerKey},${body.clientId}::uuid,${cash?.id??null},${body.paymentState},${body.paymentMethod},${total},${total},${body.note},${key}::uuid,${hash},${actor.actorId}) ON CONFLICT(center_key,idempotency_key) DO NOTHING RETURNING id`;
      if(!sale){const [race]=await tx`SELECT id,request_hash AS "requestHash" FROM store_sales WHERE center_key=${centerKey} AND idempotency_key=${key}::uuid`;return race?.requestHash?.trim()===hash?{replay:race.id}:{error:'idempotency_conflict'} as const;}
      for(const line of lines){await tx`INSERT INTO store_sale_lines(sale_id,variant_id,product_name_snapshot,variant_label_snapshot,sku_snapshot,unit_price_cents,quantity,line_total_cents) VALUES (${sale.id},${line.variant.id},${line.variant.productName},${line.variant.label},${line.variant.sku},${money(line.variant.priceCents)},${line.quantity},${line.lineTotal})`;if(line.variant.stockTracked)await tx`INSERT INTO store_inventory_movements(variant_id,quantity_delta,movement_type,reason,actor_id,sale_id) VALUES (${line.variant.id},${-line.quantity},'sale',${`Venta ${sale.id}`},${actor.actorId},${sale.id})`;}
      await audit(tx,actor.actorId,'sale.created','sale',sale.id,{lineCount:lines.length,totalCents:total,paymentState:body.paymentState});return {created:sale.id};
    });
      if('error'in outcome){const status=outcome.error==='member_not_found'||outcome.error==='variant_not_found'?404:outcome.error==='idempotency_conflict'||outcome.error==='cash_session_required'||outcome.error==='cash_session_previous_day_requires_owner_resolution'?409:outcome.error==='product_inactive'||outcome.error==='variant_inactive'||outcome.error==='insufficient_stock'?409:400;return reply.code(status).send({error:outcome.error,...(outcome.error==='cash_session_previous_day_requires_owner_resolution'?{message:previousDayCashSessionMessage}:{})});}
    if('replay'in outcome)return reply.send(await saleDetail(db,outcome.replay));
    return reply.code(201).send(await saleDetail(db,outcome.created));
  });

  app.post('/api/admin/store/sales/:saleId/void', async (request,reply) => {
    const actor=await staffContext(request,reply,resolveStaff,'store.sales.void');if(!actor)return;
    const params=z.object({saleId:uuid}).safeParse(request.params);if(!params.success)return reply.code(400).send({error:'invalid_sale_id'});
    const result=await db.begin(async tx=>{const [sale]=await tx`SELECT id,status,payment_state AS "paymentState",payment_method AS "paymentMethod",total_cents AS "totalCents" FROM store_sales WHERE id=${params.data.saleId} AND center_key=${centerKey} FOR UPDATE`;if(!sale)return {error:'sale_not_found'} as const;if(sale.status==='voided')return {error:'sale_already_voided'} as const;const cash=await lockOpenCashSession(tx,actor.actorId);if(!cash.ok)return {error:cash.error};const lines=await tx`SELECT variant_id AS "variantId",quantity FROM store_sale_lines WHERE sale_id=${sale.id} ORDER BY variant_id`;for(const line of lines){await tx`SELECT id FROM store_product_variants WHERE id=${line.variantId} FOR UPDATE`;const [variant]=await tx`SELECT stock_tracked AS "stockTracked" FROM store_product_variants WHERE id=${line.variantId}`;if(variant?.stockTracked)await tx`INSERT INTO store_inventory_movements(variant_id,quantity_delta,movement_type,reason,actor_id,sale_id) VALUES (${line.variantId},${line.quantity},'sale_reversal',${`Anulación ${sale.id}`},${actor.actorId},${sale.id})`;}
      await tx`INSERT INTO store_sale_cash_movements(sale_id,cash_session_id,movement_type,payment_method,amount_cents,reason,actor_id) VALUES (${sale.id},${cash.id},'annulment',${sale.paymentState==='paid'?sale.paymentMethod:null},${sale.paymentState==='paid'?sale.totalCents:0},'Anulación de venta',${actor.actorId})`;
      const [updated]=await tx`UPDATE store_sales SET status='voided',voided_at=now(),voided_by=${actor.actorId} WHERE id=${sale.id} AND status='completed' RETURNING id,status`;if(!updated)return {error:'sale_already_voided'} as const;await audit(tx,actor.actorId,'sale.voided','sale',sale.id,{lineCount:lines.length,cashSessionId:cash.id,amountCents:sale.paymentState==='paid'?Number(sale.totalCents):0,paymentMethod:sale.paymentState==='paid'?sale.paymentMethod:null});return {sale:updated};});
    if('error'in result)return reply.code(result.error==='sale_not_found'?404:409).send({error:result.error,...(result.error==='cash_session_previous_day_requires_owner_resolution'?{message:previousDayCashSessionMessage}:{})});return result.sale;
  });
}

async function saleDetail(db: DB,id: string) {
  const [sale]=await db`SELECT s.id,s.client_id AS "clientId",s.cash_session_id AS "cashSessionId",s.status,s.payment_state AS "paymentState",s.payment_method AS "paymentMethod",s.subtotal_cents AS "subtotalCents",s.total_cents AS "totalCents",s.created_at AS "createdAt",s.created_by AS "createdBy",COALESCE(jsonb_agg(jsonb_build_object('productName',l.product_name_snapshot,'variantLabel',l.variant_label_snapshot,'quantity',l.quantity,'unitPriceCents',l.unit_price_cents,'lineTotalCents',l.line_total_cents) ORDER BY l.id) FILTER(WHERE l.id IS NOT NULL),'[]'::jsonb) AS lines FROM store_sales s LEFT JOIN store_sale_lines l ON l.sale_id=s.id WHERE s.id=${id}::uuid GROUP BY s.id`;
  return sale ? normalizeSale(sale) : null;
}
