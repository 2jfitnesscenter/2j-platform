import React from 'react';

const api = import.meta.env?.VITE_API_URL ?? 'http://127.0.0.1:3100';
export type CommandCenterModel = {
  timezone: string;
  permissions: { calendar:boolean; clients:boolean; communications:boolean; documents:boolean; sensitiveReview:boolean; followup:boolean; billing:boolean; cash:boolean; transfers:boolean; staff:boolean; absences:boolean; timeclock:boolean };
  today: { sessionCount:number; upcomingCount:number; capacity:number; occupied:number; waitlistCount:number; unassignedCount:number; nextSession:{id:string;serviceName:string;startsAt:string;professionalName:string|null}|null };
  clients: { active:number; recentSignups:number }|null;
  attention: Array<{id:string;kind:string;title:string;summary:string;href:string;ageAt:string|null}>;
  economics: {pendingCents:number;overdueCount:number;collectedTodayCents:number;cashSession:{status:string;openingCents:number;expectedCents:number;countedCents:number|null;differenceCents:number|null}|null}|null;
  team: {active:number;workingNow:number;activeAbsences:number;substitutions:number}|null;
  unread: number;
  quickActions: Array<{id:string;label:string;href:string}>;
};
const CommandContext = React.createContext<{data:CommandCenterModel|null;state:'loading'|'ready'|'error';error:string;reload:()=>void}>({data:null,state:'loading',error:'',reload:()=>{}});
export const useCommandCenter = () => React.useContext(CommandContext);

const nav = [
  {id:'home',label:'Inicio',href:'#home',permission:null,group:'OPERACIÓN'},
  {id:'calendar',label:'Agenda',href:'#calendar',permission:'calendar',group:'OPERACIÓN'},
  {id:'clients',label:'Clientes',href:'#clients',permission:'clients',group:'RELACIÓN'},
  {id:'staff',label:'Equipo',href:'#staff',permission:'staff',group:'RELACIÓN'},
  {id:'communications',label:'Comunicación',href:'#communications',permission:'communications',group:'RELACIÓN'},
  {id:'economics',label:'Economía',href:'#economics',permission:'billing',group:'GESTIÓN'},
  {id:'services',label:'Servicios',href:'#services',permission:'calendar',group:'GESTIÓN'},
] as const;
const routeId = () => window.location.hash.slice(1).split('?')[0] || 'home';

export function AppShell({children}:{children:React.ReactNode}) {
  const [route,setRoute] = React.useState(routeId);
  const [data,setData] = React.useState<CommandCenterModel|null>(null);
  const [state,setState] = React.useState<'loading'|'ready'|'error'>('loading');
  const [error,setError] = React.useState('');
  const [query,setQuery] = React.useState('');
  const [searchOpen,setSearchOpen] = React.useState(false);
  const [results,setResults] = React.useState<Array<{type:string;label:string;items:Array<{id:string;label:string}>}>>([]);
  const [searchBusy,setSearchBusy] = React.useState(false);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const reload = React.useCallback(async()=>{
    setState('loading');setError('');
    try { const response=await fetch(`${api}/api/dashboard/command-center`); if(!response.ok)throw new Error(response.status===401?'Inicia la vista local con un perfil demo.':'No se pudo cargar el Command Center.'); setData(await response.json() as CommandCenterModel);setState('ready'); }
    catch(cause){setData(null);setError(cause instanceof Error?cause.message:'No se pudo cargar el inicio.');setState('error');}
  },[]);
  React.useEffect(()=>{ void reload();const change=()=>setRoute(routeId());window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change);},[reload]);
  React.useEffect(()=>{if(!searchOpen)return;searchRef.current?.focus();},[searchOpen]);
  React.useEffect(()=>{const key=(event:KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();setSearchOpen(true);}if(event.key==='Escape'){setSearchOpen(false);setQuery('');}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
  React.useEffect(()=>{if(!searchOpen||query.trim().length<2){setResults([]);return;}const controller=new AbortController();const timer=window.setTimeout(async()=>{setSearchBusy(true);try{const response=await fetch(`${api}/api/search?q=${encodeURIComponent(query.trim())}`,{signal:controller.signal});if(!response.ok)throw new Error();const body=await response.json();setResults(body.groups??[]);}catch{if(!controller.signal.aborted)setResults([]);}finally{if(!controller.signal.aborted)setSearchBusy(false);}},220);return()=>{window.clearTimeout(timer);controller.abort();};},[searchOpen,query]);
  const permissions=data?.permissions;
  const groups=[...new Set(nav.map(item=>item.group))];
  return <CommandContext.Provider value={{data,state,error,reload}}><div className="app-frame">
    <aside className="app-sidebar" aria-label="Navegación principal">
      <a className="brand" href="#home" aria-label="2J Platform, inicio"><span className="brand-mark">2J</span><span className="brand-copy">FITNESS CENTER<small>OPERACIONES</small></span></a>
      <nav className="app-navigation" aria-label="Secciones">
        {groups.map(group=><div className="app-nav-group" key={group}><span className="app-nav-label">{group}</span>{nav.filter(item=>item.group===group).filter(item=>item.permission===null||permissions?.[item.permission]===true).map(item=><a key={item.id} className={`app-nav-item ${route===item.id?'active':''}`} href={item.href} aria-current={route===item.id?'page':undefined}>{item.label}{item.id==='communications'&&data?.unread? <span className="nav-count">{data.unread>99?'99+':data.unread}</span>:null}</a>)}</div>)}
      </nav>
      <div className="app-sidebar-foot"><span className="status-dot"/> Datos protegidos por permisos</div>
    </aside>
    <div className="app-content"><header className="app-topbar"><div className="app-brand-mobile"><span className="brand-mark">2J</span><strong>{nav.find(item=>item.id===route)?.label??'2J Platform'}</strong></div><button className="global-search-trigger" onClick={()=>setSearchOpen(true)} aria-label="Buscar en 2J"><span aria-hidden="true">⌕</span><span>Buscar clientes, equipo o servicios</span><kbd>Ctrl K</kbd></button><span className="local-pill"><span className="status-dot"/> Entorno local</span></header>
      <div className="app-page">{children}</div>
    </div>
    {searchOpen&&<div className="search-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setSearchOpen(false);}}><section className="global-search-dialog" role="dialog" aria-modal="true" aria-label="Búsqueda global"><label htmlFor="global-search-input">Buscar en 2J</label><input ref={searchRef} id="global-search-input" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Nombre de cliente, profesional o servicio"/><div className="global-search-results" aria-live="polite">{searchBusy?<p role="status">Buscando…</p>:query.trim().length<2?<p>Escribe al menos dos caracteres.</p>:results.length===0?<p>No hay resultados accesibles.</p>:results.filter(group=>group.items.length>0).map(group=><section key={group.type}><h2>{group.label}</h2>{group.items.map(item=><a key={item.id} href={group.type==='clients'?`#clients?clientId=${item.id}`:group.type==='team'?'#staff':'#services'} onClick={()=>setSearchOpen(false)}>{item.label}</a>)}</section>)}</div><button className="button secondary" onClick={()=>setSearchOpen(false)}>Cerrar · Esc</button></section></div>}
  </div></CommandContext.Provider>;
}
