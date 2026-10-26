import React from 'react';
import { ConfirmDialog, SaveState } from '@2j/ui';

const api = import.meta.env?.VITE_API_URL ?? 'http://127.0.0.1:3100';
type NewsStatus = 'draft' | 'published' | 'withdrawn';
type NewsItem = { id:string; title:string; body:string; status:NewsStatus; featured:boolean; publishedAt:string|null; updatedAt:string; createdAt:string };
type AuditEvent = { id:string; action:string; actorId:string; occurredAt:string; details:Record<string,unknown> };
const statusLabel:Record<NewsStatus,string> = {draft:'Borrador',published:'Publicada',withdrawn:'Retirada'};
const actionLabel:Record<string,string> = {'news.created':'Creada','news.updated':'Editada','news.published':'Publicada','news.withdrawn':'Retirada','news.featured':'Destacada','news.unfeatured':'Ya no destacada'};
const dateLabel=(value:string|null)=>value?new Intl.DateTimeFormat('es-ES',{timeZone:'Atlantic/Canary',dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'Sin publicar';

export function NewsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const [items,setItems]=React.useState<NewsItem[]>([]);
  const [loading,setLoading]=React.useState(true);
  const [saving,setSaving]=React.useState(false);
  const [withdrawTarget,setWithdrawTarget]=React.useState<NewsItem|null>(null);
  const [withdrawBusy,setWithdrawBusy]=React.useState(false);
  const [error,setError]=React.useState('');
  const [message,setMessage]=React.useState('');
  const [editing,setEditing]=React.useState<NewsItem|null>(null);
  const [title,setTitle]=React.useState('');
  const [body,setBody]=React.useState('');
  const [auditFor,setAuditFor]=React.useState<string|null>(null);
  const [audit,setAudit]=React.useState<AuditEvent[]>([]);

  const load=React.useCallback(async()=>{
    setLoading(true);setError('');
    try{const response=await fetch(`${api}/api/admin/news`,{credentials:'include',cache:'no-store'});if(!response.ok)throw new Error();const result=await response.json() as {items:NewsItem[]};setItems(result.items);}
    catch{setError('No se han podido cargar las noticias del centro. Comprueba tus permisos e inténtalo de nuevo.');}
    finally{setLoading(false);}
  },[]);
  React.useEffect(()=>{void load();},[load]);

  const reset=()=>{setEditing(null);setTitle('');setBody('');};
  const startEdit=(item:NewsItem)=>{setEditing(item);setTitle(item.title);setBody(item.body);setMessage('');setError('');document.getElementById('center-news-title')?.focus();};
  const save=async(event:React.FormEvent)=>{
    event.preventDefault();setSaving(true);setError('');setMessage('');
    try{
      const response=await fetch(editing?`${api}/api/admin/news/${editing.id}`:`${api}/api/admin/news`,{method:editing?'PATCH':'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({title,body})});
      if(!response.ok){const result=await response.json().catch(()=>({}));throw new Error(result.error==='validation_error'?'Revisa el título y el texto.':'No se ha podido guardar la noticia.');}
      reset();setMessage(editing?'Cambios guardados.':'Borrador creado.');await load();
    }catch(cause){setError(cause instanceof Error?cause.message:'No se ha podido guardar la noticia.');}
    finally{setSaving(false);}
  };

  const mutate=async(item:NewsItem,action:'publish'|'withdraw'|'feature'|'unfeature')=>{
    setError('');setMessage('');
    try{const response=await fetch(`${api}/api/admin/news/${item.id}/${action}`,{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:'{}'});if(!response.ok)throw new Error();setMessage(action==='publish'?'Noticia publicada.':action==='withdraw'?'Noticia retirada.':action==='feature'?'Noticia destacada.':'Se quitó de destacadas.');await load();}
    catch{setError('No se pudo actualizar el estado de la noticia.');}
  };

  const toggleAudit=async(item:NewsItem)=>{
    if(auditFor===item.id){setAuditFor(null);return;}
    setAuditFor(item.id);setAudit([]);setError('');
    try{const response=await fetch(`${api}/api/admin/news/${item.id}/audit`,{credentials:'include',cache:'no-store'});if(!response.ok)throw new Error();const result=await response.json() as {events:AuditEvent[]};setAudit(result.events);}
    catch{setError('No se pudo cargar el historial de esta noticia.');}
  };

  const Root = embedded ? 'div' : 'main';
  return <Root className="page-content center-news-page">
    <div className="page-heading"><div><p className="eyebrow">CONTENIDO DEL CENTRO</p>{embedded ? <h2>Noticias</h2> : <h1>Noticias</h1>}<p>Publica información útil para los miembros desde Inicio.</p></div><button type="button" className="button primary" onClick={()=>{reset();setMessage('');setError('');document.getElementById('center-news-title')?.focus();}}>Nueva noticia</button></div>
    <div className="center-news-layout">
      <form className="panel center-news-editor" onSubmit={event=>void save(event)} aria-label={editing?'Editar noticia':'Nueva noticia'}>
        <div className="panel-heading"><div><h2>{editing?'Editar noticia':'Crear borrador'}</h2><p>Texto sencillo, sin imágenes ni formato enriquecido.</p></div></div>
        <label htmlFor="center-news-title">Título</label><input id="center-news-title" value={title} onChange={event=>setTitle(event.target.value)} required maxLength={120} />
        <label htmlFor="center-news-body">Texto</label><textarea id="center-news-body" value={body} onChange={event=>setBody(event.target.value)} required maxLength={5000} rows={7} />
        <p className="center-news-helper">El título admite 120 caracteres y el texto 5.000. El contenido se muestra como texto seguro.</p>
        {error&&<p className="inline-error" role="alert">{error}</p>}<SaveState className="center-news-saved" status={saving?'saving':message?'saved':'idle'} savedLabel={message} />
        <div className="center-news-actions"><button className="button primary" disabled={saving||!title.trim()||!body.trim()}>{saving?'Guardando…':editing?'Guardar cambios':'Guardar borrador'}</button>{editing&&<button type="button" className="button secondary" onClick={reset}>Cancelar edición</button>}</div>
      </form>
      <section className="panel center-news-list" aria-labelledby="center-news-list-title">
        <div className="panel-heading"><div><h2 id="center-news-list-title">Contenido y estado</h2><p>Las noticias retiradas se conservan en el historial.</p></div><button type="button" className="text-button" onClick={()=>void load()}>Actualizar</button></div>
        {loading?<p role="status">Cargando noticias…</p>:items.length===0?<div className="center-news-empty"><h3>Aún no hay noticias</h3><p>Crea un borrador para empezar.</p></div>:<div className="center-news-items">{items.map(item=><article className="center-news-item" key={item.id}>
          <div className="center-news-item-heading"><div><span className={`center-news-status status-${item.status}`}>{statusLabel[item.status]}</span>{item.featured&&<span className="center-news-featured">Destacada</span>}<h3>{item.title}</h3></div><small>{item.status==='published'?`Publicada ${dateLabel(item.publishedAt)}`:`Actualizada ${dateLabel(item.updatedAt)}`}</small></div>
          <p>{item.body}</p>
          <div className="center-news-actions">
            {item.status!=='withdrawn'&&<button type="button" className="button secondary" onClick={()=>startEdit(item)}>Editar</button>}
            {(item.status==='draft'||item.status==='withdrawn')&&<button type="button" className="button primary" onClick={()=>void mutate(item,'publish')}>Publicar</button>}
            {item.status==='published'&&<><button type="button" className="button secondary" onClick={()=>void mutate(item,item.featured?'unfeature':'feature')}>{item.featured?'Quitar destacada':'Destacar'}</button><button type="button" className="button secondary" onClick={()=>setWithdrawTarget(item)}>Retirar</button></>}
            <button type="button" className="text-button" aria-expanded={auditFor===item.id} onClick={()=>void toggleAudit(item)}>Historial</button>
          </div>
          {auditFor===item.id&&<ol className="center-news-audit" aria-label={`Historial de ${item.title}`}>{audit.map(event=><li key={event.id}><strong>{actionLabel[event.action]??'Actualización'}</strong><span>{dateLabel(event.occurredAt)} · {event.actorId}</span></li>)}</ol>}
        </article>)}</div>}
      </section>
    </div>
  <ConfirmDialog open={withdrawTarget!==null} title={withdrawTarget?`Retirar «${withdrawTarget.title}»`:'Retirar noticia'} description="Dejará de aparecer a los miembros y se conservará en el historial." confirmLabel="Retirar noticia" busy={withdrawBusy} onCancel={()=>setWithdrawTarget(null)} onConfirm={()=>{const item=withdrawTarget;if(!item)return;setWithdrawBusy(true);void mutate(item,'withdraw').finally(()=>{setWithdrawBusy(false);setWithdrawTarget(null);});}}/>
  </Root>;
}
