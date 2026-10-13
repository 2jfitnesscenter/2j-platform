import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { buildServer } from '../src/server.ts';
import { migrateDatabase } from '../src/migrate.ts';

process.env.NODE_ENV ??= 'test';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required: Center News PostgreSQL tests cannot be skipped.');

const sql=postgres(process.env.DATABASE_URL,{max:8,connect_timeout:5});
await migrateDatabase(sql);
const admin=buildServer(process.env.DATABASE_URL,{logger:false,authorizationResolver:async()=>({actorId:'center-news-admin',role:'admin'})});
const readOnlyAdmin=buildServer(process.env.DATABASE_URL,{logger:false,authorizationResolver:async()=>({actorId:'center-news-read-only',role:'admin',deniedPermissions:['news.manage']})});
const trainer=buildServer(process.env.DATABASE_URL,{logger:false,authorizationResolver:async()=>({actorId:'center-news-trainer',role:'trainer'})});
const reception=buildServer(process.env.DATABASE_URL,{logger:false,authorizationResolver:async()=>({actorId:'center-news-reception',role:'reception-management'})});
const anonymous=buildServer(process.env.DATABASE_URL,{logger:false});
let memberClientId;
const member=buildServer(process.env.DATABASE_URL,{logger:false,clientAuthorizationResolver:async()=>memberClientId?{clientId:memberClientId}:null});

const runId=randomUUID().slice(0,8);
const news=(title)=>({title:`${runId}: ${title} ${randomUUID().slice(0,8)}`,body:'Texto informativo para los miembros del centro.'});
const createDraft=async(content)=>{
  const result=await admin.inject({method:'POST',url:'/api/admin/news',payload:content});
  assert.equal(result.statusCode,201,result.body);return result.json();
};

test('Center News separates editorial content, enforces Admin-only mutations, visibility and immutable audit',async()=>{
  const [client]=await sql`INSERT INTO clients(first_name,last_name,status) VALUES ('Noticias','Miembro prueba','active') RETURNING id`;
  memberClientId=client.id;

  // Isolate repeated test runs without deleting historical rows: withdraw prior synthetic news through the audited API.
  const priorPublished=await sql`SELECT id,featured FROM center_news WHERE center_key='2j' AND status='published'`;
  for(const item of priorPublished){
    if(item.featured) assert.equal((await admin.inject({method:'POST',url:`/api/admin/news/${item.id}/unfeature`,payload:{}})).statusCode,200);
    assert.equal((await admin.inject({method:'POST',url:`/api/admin/news/${item.id}/withdraw`,payload:{}})).statusCode,200);
  }

  assert.equal((await anonymous.inject({method:'GET',url:'/api/admin/news'})).statusCode,401);
  assert.equal((await anonymous.inject({method:'GET',url:'/api/me/news'})).statusCode,401);
  assert.equal((await trainer.inject({method:'GET',url:'/api/admin/news'})).statusCode,403);
  assert.equal((await trainer.inject({method:'POST',url:'/api/admin/news',payload:news('Denegada')})).statusCode,403);
  assert.equal((await reception.inject({method:'POST',url:'/api/admin/news',payload:news('Denegada')})).statusCode,403);
  assert.equal((await readOnlyAdmin.inject({method:'POST',url:'/api/admin/news',payload:news('Denegada')})).statusCode,403);
  assert.equal((await readOnlyAdmin.inject({method:'GET',url:'/api/admin/news'})).statusCode,200);
  assert.equal((await admin.inject({method:'POST',url:'/api/admin/news',payload:{title:'   ',body:'Texto'}})).statusCode,400);
  assert.equal((await admin.inject({method:'POST',url:'/api/admin/news',payload:{title:'XSS',body:'<script>alert(1)</script>'}})).statusCode,400);

  const first=await createDraft(news('Aviso de apertura'));
  assert.equal(first.status,'draft');assert.equal(first.createdBy,'center-news-admin');
  assert.equal((await member.inject({method:'GET',url:'/api/me/news'})).json().items.some(item=>item.id===first.id),false);
  assert.equal((await admin.inject({method:'POST',url:`/api/admin/news/${first.id}/feature`,payload:{}})).statusCode,409);
  const updated=await admin.inject({method:'PATCH',url:`/api/admin/news/${first.id}`,payload:{title:`${runId}: Horario de verano`,body:'El centro amplía el horario del sábado.'}});
  assert.equal(updated.statusCode,200,updated.body);assert.equal(updated.json().title,`${runId}: Horario de verano`);assert.equal(updated.json().updatedBy,'center-news-admin');
  assert.equal((await admin.inject({method:'PATCH',url:`/api/admin/news/${first.id}`,payload:{body:'<b>HTML</b>'}})).statusCode,400);
  assert.equal((await admin.inject({method:'POST',url:`/api/admin/news/${first.id}/publish`,payload:{}})).statusCode,200);

  const second=await createDraft(news('Cierre temporal'));
  assert.equal((await admin.inject({method:'POST',url:`/api/admin/news/${second.id}/publish`,payload:{}})).statusCode,200);
  await sql`UPDATE center_news SET published_at=GREATEST(now()-interval '10 seconds',COALESCE((SELECT max(published_at)+interval '1 millisecond' FROM center_news WHERE center_key='2j' AND status='published' AND published_at<=now() AND id<>${first.id}),now()-interval '10 seconds')) WHERE id=${first.id}`;
  await sql`UPDATE center_news SET published_at=GREATEST(now()-interval '10 seconds',COALESCE((SELECT max(published_at)+interval '1 millisecond' FROM center_news WHERE center_key='2j' AND status='published' AND published_at<=now() AND id<>${second.id}),now()-interval '10 seconds')) WHERE id=${second.id}`;
  assert.equal((await admin.inject({method:'POST',url:`/api/admin/news/${first.id}/feature`,payload:{}})).statusCode,200);
  assert.equal((await admin.inject({method:'POST',url:`/api/admin/news/${second.id}/feature`,payload:{}})).statusCode,200);

  await sql`INSERT INTO center_news(center_key,title,body,status,featured,published_at,created_by,updated_by) VALUES ('other-center','Otro centro','No visible a este miembro','published',true,now(),'test','test')`;
  const memberResult=await member.inject({method:'GET',url:'/api/me/news'});
  assert.equal(memberResult.statusCode,200,memberResult.body);
  const visible=memberResult.json();
  assert.equal(visible.featured.id,second.id,'newest currently-visible featured item wins');
  const runItems=visible.items.filter(item=>item.title.startsWith(`${runId}:`));
  assert.deepEqual(runItems.slice(0,2).map(item=>item.id),[second.id,first.id],'Member list remains newest-first');
  assert.equal(visible.items.some(item=>item.id===first.id),true);
  assert.equal(visible.items.some(item=>item.id===second.id),true);
  assert.equal(visible.items.some(item=>item.title==='Otro centro'),false,'center scope is enforced');

  const third=await createDraft(news('Actualización de clases'));
  await admin.inject({method:'POST',url:`/api/admin/news/${third.id}/publish`,payload:{}});
  await sql`UPDATE center_news SET published_at=GREATEST(now()-interval '10 seconds',COALESCE((SELECT max(published_at)+interval '1 millisecond' FROM center_news WHERE center_key='2j' AND status='published' AND published_at<=now() AND id<>${third.id}),now()-interval '10 seconds')) WHERE id=${third.id}`;
  assert.equal((await member.inject({method:'GET',url:'/api/me/news'})).json().featured.id,second.id,'featured news takes precedence over a newer unfeatured item');
  await admin.inject({method:'POST',url:`/api/admin/news/${second.id}/unfeature`,payload:{}});
  assert.equal((await member.inject({method:'GET',url:'/api/me/news'})).json().featured.id,first.id,'newest remaining featured item is deterministic');

  assert.equal((await admin.inject({method:'POST',url:`/api/admin/news/${first.id}/withdraw`,payload:{}})).statusCode,200);
  const afterWithdraw=(await member.inject({method:'GET',url:'/api/me/news'})).json();
  assert.equal(afterWithdraw.items.some(item=>item.id===first.id),false);
  assert.equal(afterWithdraw.featured.id,third.id,'fallback is newest visible published item when there is no featured item');
  assert.equal((await admin.inject({method:'POST',url:`/api/admin/news/${first.id}/publish`,payload:{}})).statusCode,200,'withdrawn item can be republished with a new publication timestamp');
  assert.equal((await admin.inject({method:'POST',url:`/api/admin/news/${first.id}/publish`,payload:{}})).statusCode,409,'publishing an already-published item is rejected');
  assert.equal((await admin.inject({method:'POST',url:`/api/admin/news/${first.id}/withdraw`,payload:{}})).statusCode,200);
  assert.equal((await admin.inject({method:'PATCH',url:`/api/admin/news/${first.id}`,payload:{title:'No se edita retirada'}})).statusCode,409);

  const audit=(await admin.inject({method:'GET',url:`/api/admin/news/${first.id}/audit`})).json().events;
  assert.ok(audit.some(event=>event.action==='news.created'&&event.actorId==='center-news-admin'));
  assert.ok(audit.some(event=>event.action==='news.updated'&&event.details.fields.includes('title')));
  assert.ok(audit.some(event=>event.action==='news.published'));
  assert.ok(audit.some(event=>event.action==='news.featured'));
  assert.ok(audit.some(event=>event.action==='news.withdrawn'));
  assert.equal((await trainer.inject({method:'GET',url:`/api/admin/news/${first.id}/audit`})).statusCode,403);
  const notifications=await member.inject({method:'GET',url:'/api/me/notifications'});
  assert.equal(notifications.statusCode,200,'news does not replace or change the notification API');

  const otherMember=buildServer(process.env.DATABASE_URL,{logger:false,clientAuthorizationResolver:async()=>({clientId:'ffffffff-ffff-4fff-8fff-ffffffffffff'})});
  assert.equal((await otherMember.inject({method:'GET',url:'/api/me/news'})).statusCode,401);
  await otherMember.close();
});

after(async()=>{memberClientId=undefined;await Promise.all([admin.close(),readOnlyAdmin.close(),trainer.close(),reception.close(),anonymous.close(),member.close()]);await sql.end();});
