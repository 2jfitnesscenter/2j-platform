import React from 'react';

const api = import.meta.env?.VITE_API_URL ?? 'http://127.0.0.1:3100';
export type CommandCenterModel = {
  timezone: string;
  permissions: { calendar:boolean; clients:boolean; communications:boolean; documents:boolean; sensitiveReview:boolean; followup:boolean; billing:boolean; cash:boolean; transfers:boolean; staff:boolean; absences:boolean; timeclock:boolean };
  today: { sessionCount:number; upcomingCount:number; capacity:number; occupied:number; waitlistCount:number; unassignedCount:number; sessions:Array<{id:string;serviceName:string;professionalName:string|null;startsAt:string;occupied:number;capacity:number;free:number;waitlistCount:number;isNow:boolean;state:'upcoming'|'in_progress'|'finished'}>; nextSession:{id:string;serviceName:string;startsAt:string;professionalName:string|null}|null };
  clients: { active:number; recentSignups:number }|null;
  attention: Array<{id:string;kind:string;title:string;summary:string;href:string;ageAt:string|null}>;
  economics: {pendingCents:number;overdueCount:number;collectedTodayCents:number;cashSession:{status:string;openingCents:number;expectedCents:number;countedCents:number|null;differenceCents:number|null}|null}|null;
  team: {active:number;workingNow:number;activeAbsences:number;substitutions:number}|null;
  unread: number;
  quickActions: Array<{id:string;label:string;href:string}>;
};
const CommandContext = React.createContext<{data:CommandCenterModel|null;state:'loading'|'ready'|'error';error:string;reload:()=>void}>({data:null,state:'loading',error:'',reload:()=>{}});
export const useCommandCenter = () => React.useContext(CommandContext);
export type NavigationCapabilities = Pick<CommandCenterModel['permissions'],'calendar'|'clients'|'communications'|'billing'|'staff'> & {notificationSettings?:boolean;news?:boolean;store?:boolean};
type NavRoute = {id:string;label:string;href:string;permission:keyof NavigationCapabilities|null};
type NavSection = {id:string;label:string;icon:string;route?:NavRoute;children?:NavRoute[]};
const routes={
  home:{id:'home',label:'Resumen',href:'#home',permission:null},
  communications:{id:'communications',label:'Comunicación',href:'#communications',permission:'communications'},
  clients:{id:'clients',label:'Clientes',href:'#clients',permission:'clients'},
  calendar:{id:'calendar',label:'Agenda',href:'#calendar',permission:'calendar'},
  services:{id:'services',label:'Servicios y cuotas',href:'#services',permission:'calendar'},
  staff:{id:'staff',label:'Equipo',href:'#staff',permission:'staff'},
  economics:{id:'economics',label:'Economía',href:'#economics',permission:'billing'},
  store:{id:'store',label:'Tienda',href:'#store',permission:'store'},
  news:{id:'news',label:'Noticias',href:'#news',permission:'news'},
  'notification-settings':{id:'notification-settings',label:'Ajustes de avisos',href:'#notification-settings',permission:'notificationSettings'},
} satisfies Record<string,NavRoute>;
const navSections:NavSection[]=[
  {id:'home',label:'Resumen',icon:'home',route:routes.home},
  {id:'activity',label:'Actividad',icon:'communications',children:[routes.communications]},
  {id:'clients',label:'Clientes',icon:'clients',route:routes.clients},
  {id:'gym',label:'Mi gimnasio',icon:'calendar',children:[routes.calendar,routes.services]},
  {id:'staff',label:'Equipo',icon:'staff',route:routes.staff},
  {id:'business',label:'Negocio',icon:'economics',children:[routes.economics,routes.store,routes.news,routes['notification-settings']]},
];
const navGlyph:Record<string,React.ReactNode>={home:'⌂',calendar:'▦',clients:'◉',staff:'♙',communications:'✉',economics:'€',services:'◇',store:'▣','notification-settings':<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>};
const routeId = () => window.location.hash.slice(1).split('?')[0] || 'home';
function hasNavigationCapability(route:NavRoute,capabilities:NavigationCapabilities|null){return route.permission===null||capabilities?.[route.permission]===true;}
export function getProfessionalNavigation(capabilities:NavigationCapabilities|null,activeRoute=routeId()){
  return navSections.flatMap(section=>{
    if(section.route)return hasNavigationCapability(section.route,capabilities)?[{...section,active:section.route.id===activeRoute}]:[];
    const children=(section.children??[]).filter(route=>hasNavigationCapability(route,capabilities));
    return children.length?[{...section,children,active:children.some(route=>route.id===activeRoute)}]:[];
  });
}
export function getProfessionalPageContext(route:string){
  for(const section of navSections){
    const match=(section.route?[section.route]:section.children??[]).find(item=>item.id===route);
    if(match)return {section:section.label,page:match.label};
  }
  return {section:'Resumen',page:'Resumen'};
}

export function AppShell({children}:{children:React.ReactNode}) {
  const [route,setRoute] = React.useState(routeId);
  const [data,setData] = React.useState<CommandCenterModel|null>(null);
  const [capabilities,setCapabilities] = React.useState<NavigationCapabilities|null>(null);
  const [state,setState] = React.useState<'loading'|'ready'|'error'>('loading');
  const [error,setError] = React.useState('');
  const [query,setQuery] = React.useState('');
  const [searchOpen,setSearchOpen] = React.useState(false);
  const [results,setResults] = React.useState<Array<{type:string;label:string;items:Array<{id:string;label:string}>}>>([]);
  const [searchBusy,setSearchBusy] = React.useState(false);
  const [compact,setCompact] = React.useState(()=>{try{return localStorage.getItem('2j.nav.compact.v1')==='true';}catch{return false;}});
  const [expandedGroups,setExpandedGroups]=React.useState(()=>new Set(window.innerWidth<=1120||!compact?['activity','gym','business']:[]));
  React.useEffect(()=>{try{localStorage.setItem('2j.nav.compact.v1',String(compact));}catch{}},[compact]);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const reload = React.useCallback(async()=>{
    setState('loading');setError('');
    try { const response=await fetch(`${api}/api/dashboard/command-center`); if(!response.ok)throw new Error(response.status===401?'Inicia la vista local con un perfil demo.':'No se pudo cargar el Command Center.'); setData(await response.json() as CommandCenterModel);setState('ready'); }
    catch(cause){setData(null);setError(cause instanceof Error?cause.message:'No se pudo cargar el inicio.');setState('error');}
  },[]);
  React.useEffect(()=>{ void reload();const change=()=>setRoute(routeId());window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change);},[reload]);
  React.useEffect(()=>{let current=true;void fetch(`${api}/api/session/capabilities`).then(async response=>{if(!response.ok)throw new Error();const body=await response.json() as NavigationCapabilities;if(current)setCapabilities(body);}).catch(()=>{if(current)setCapabilities(null);});return()=>{current=false;};},[]);
  React.useEffect(()=>{if(!searchOpen)return;searchRef.current?.focus();},[searchOpen]);
  React.useEffect(()=>{const key=(event:KeyboardEvent)=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();setSearchOpen(true);}if(event.key==='Escape'){setSearchOpen(false);setQuery('');}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
  React.useEffect(()=>{if(!searchOpen||query.trim().length<2){setResults([]);return;}const controller=new AbortController();const timer=window.setTimeout(async()=>{setSearchBusy(true);try{const response=await fetch(`${api}/api/search?q=${encodeURIComponent(query.trim())}`,{signal:controller.signal});if(!response.ok)throw new Error();const body=await response.json();setResults(body.groups??[]);}catch{if(!controller.signal.aborted)setResults([]);}finally{if(!controller.signal.aborted)setSearchBusy(false);}},220);return()=>{window.clearTimeout(timer);controller.abort();};},[searchOpen,query]);
  const permissions=capabilities;
  const navigation=getProfessionalNavigation(permissions,route);
  const pageContext=getProfessionalPageContext(route);
  const toggleGroup=(groupId:string)=>setExpandedGroups(current=>{const next=new Set(current);if(next.has(groupId))next.delete(groupId);else next.add(groupId);return next;});
  const toggleCompact=()=>setCompact(value=>{const next=!value;if(next)setExpandedGroups(new Set());else setExpandedGroups(new Set(['activity','gym','business']));return next;});
  return <CommandContext.Provider value={{data,state,error,reload}}><div className={`app-frame ${compact?'is-compact':''}`}>
    <aside className="app-sidebar" aria-label="Navegación principal">
      <div className="app-sidebar-brand"><a className="brand" href="#home" aria-label="2J Platform, Resumen"><span className="brand-mark">2J</span><span className="brand-copy">FITNESS CENTER<small>OPERACIONES</small></span></a><button className="sidebar-toggle" type="button" onClick={toggleCompact} aria-label={compact?'Expandir menú':'Compactar menú'} title={compact?'Expandir menú':'Compactar menú'}>{compact?'»':'«'}</button></div>
      <nav className="app-navigation" aria-label="Secciones">
        {navigation.map(section=>{
          const isOpen=expandedGroups.has(section.id);
          if(section.route){const item=section.route;return <a key={section.id} className={`app-nav-item app-nav-top ${route===item.id?'active':''}`} href={item.href} aria-label={section.label} title={compact?section.label:undefined} aria-current={route===item.id?'page':undefined}><span className="nav-glyph" aria-hidden="true">{navGlyph[section.icon]}</span><span className="nav-item-label">{section.label}</span></a>;}
          return <div className={`app-nav-group ${section.active?'is-active':''} ${isOpen?'is-open':''}`} key={section.id}>
            <button className="app-nav-item app-nav-top app-nav-group-trigger" type="button" aria-expanded={isOpen} aria-controls={`nav-subnav-${section.id}`} aria-label={section.label} title={compact?section.label:undefined} onClick={()=>toggleGroup(section.id)}><span className="nav-glyph" aria-hidden="true">{navGlyph[section.icon]}</span><span className="nav-item-label">{section.label}</span><span className="nav-chevron" aria-hidden="true">⌄</span></button>
            {isOpen&&<div className="app-subnav" id={`nav-subnav-${section.id}`} role="group" aria-label={`${section.label} subsecciones`}>{section.children!.map(item=><a key={item.id} className={`app-nav-item app-subnav-item ${route===item.id?'active':''}`} href={item.href} aria-current={route===item.id?'page':undefined} title={compact?item.label:undefined}><span className="nav-glyph" aria-hidden="true">{navGlyph[item.id]}</span><span className="nav-item-label">{item.label}</span>{item.id==='communications'&&data?.unread? <span className="nav-count">{data.unread>99?'99+':data.unread}</span>:null}</a>)}</div>}
          </div>;
        })}
      </nav>
      <div className="app-sidebar-foot" title="Datos protegidos por permisos"><span className="status-dot"/><span>Datos protegidos por permisos</span></div>
    </aside>
    <div className="app-content"><header className="app-topbar"><div className="app-location" aria-label="Ubicación actual"><span>{pageContext.section}</span><span className="app-location-divider" aria-hidden="true">/</span><strong>{pageContext.page}</strong></div><button className="global-search-trigger" onClick={()=>setSearchOpen(true)} aria-label="Buscar en 2J"><span aria-hidden="true">⌕</span><span>Buscar clientes, equipo o servicios</span><kbd>Ctrl K</kbd></button><span className="local-pill"><span className="status-dot"/> Entorno local</span></header>
      <div className="app-page">{children}</div>
    </div>
    {searchOpen&&<div className="search-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setSearchOpen(false);}}><section className="global-search-dialog" role="dialog" aria-modal="true" aria-label="Búsqueda global"><label htmlFor="global-search-input">Buscar en 2J</label><input ref={searchRef} id="global-search-input" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Nombre de cliente, profesional o servicio"/><div className="global-search-results" aria-live="polite">{searchBusy?<p role="status">Buscando…</p>:query.trim().length<2?<p>Escribe al menos dos caracteres.</p>:results.length===0?<p>No hay resultados accesibles.</p>:results.filter(group=>group.items.length>0).map(group=><section key={group.type}><h2>{group.label}</h2>{group.items.map(item=><a key={item.id} href={group.type==='clients'?`#clients?clientId=${item.id}`:group.type==='team'?'#staff':'#services'} onClick={()=>setSearchOpen(false)}>{item.label}</a>)}</section>)}</div><button className="button secondary" onClick={()=>setSearchOpen(false)}>Cerrar · Esc</button></section></div>}
  </div></CommandContext.Provider>;
}
