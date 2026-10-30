import { apiFetch } from './api-fetch.js';
import React from 'react';
import { GlobalSearchDialog } from './global-search.js';
import { Icon, IconButton, icons, type LucideIcon } from '@2j/ui';
import { StaffLogin } from './staff-login.js';

const api = import.meta.env?.VITE_API_URL ?? 'http://localhost:3100';
export type CommandCenterModel = {
  timezone: string;
  permissions: { calendar:boolean; clients:boolean; communications:boolean; documents:boolean; sensitiveReview:boolean; followup:boolean; billing:boolean; invoices?:boolean; cash:boolean; transfers:boolean; staff:boolean; absences:boolean; timeclock:boolean };
  today: { sessionCount:number; upcomingCount:number; capacity:number; occupied:number; waitlistCount:number; unassignedCount:number; sessions:Array<{id:string;serviceName:string;professionalName:string|null;startsAt:string;occupied:number;capacity:number;free:number;waitlistCount:number;isNow:boolean;state:'upcoming'|'in_progress'|'finished'}>; nextSession:{id:string;serviceName:string;startsAt:string;professionalName:string|null}|null };
  clients: { active:number; recentSignups:number }|null;
  attention: Array<{id:string;kind:string;title:string;summary:string;href:string;ageAt:string|null}>;
  economics: {pendingCents:number;overdueCount:number;collectedTodayCents:number|null;cashSession:{status:string;openingCents?:number;expectedCents?:number;countedCents:number|null;differenceCents?:number|null;registers?:Array<{registerCode:string;registerName:string;status:string;openingCents:number;expectedCents:number;countedCents:number|null;differenceCents:number|null}>}|null}|null;
  team: {active:number;workingNow:number;activeAbsences:number;substitutions:number}|null;
  unread: number;
  quickActions: Array<{id:string;label:string;href:string}>;
  commercial?: { plans:{activeCount:number;expiringSoonCount:number}|null; transfers:{pendingCount:number}|null; storeSales:{monthCount:number;monthTotalCents:number}|null; lowStock:{count:number}|null; expiringPlans?:Array<{assignmentId:string;clientId:string;clientName:string;planName:string;endsOn:string}>|null; recentMovements?:Array<{id:string;chargeId?:string;kind:'payment'|'refund';amountCents:number;concept:string;clientName:string;occurredAt:string}>|null };
};
const CommandContext = React.createContext<{data:CommandCenterModel|null;state:'loading'|'ready'|'error';error:string;reload:()=>void;capabilities:NavigationCapabilities|null}>({data:null,state:'loading',error:'',reload:()=>{},capabilities:null});
export const useCommandCenter = () => React.useContext(CommandContext);
export const useProfessionalCapabilities = () => React.useContext(CommandContext).capabilities;
export type NavigationCapabilities = Pick<CommandCenterModel['permissions'],'calendar'|'clients'|'communications'|'billing'|'staff'> & {notificationSettings?:boolean;ownerPanel?:boolean;news?:boolean;store?:boolean;cash?:boolean;catalogPricingManage?:boolean;linkReviewManage?:boolean};
export function ProfessionalCapabilitiesProvider({capabilities,children}:{capabilities:NavigationCapabilities|null;children:React.ReactNode}) {
  return <CommandContext.Provider value={{data:null,state:'loading',error:'',reload:()=>{},capabilities}}>{children}</CommandContext.Provider>;
}
type NavRoute = {id:string;label:string;href:string;permission:keyof NavigationCapabilities|null;icon:LucideIcon};
type NavSection = {id:string;label:string;icon:LucideIcon;route?:NavRoute;children?:NavRoute[]};
const routes={
  home:{id:'home',label:'Resumen',href:'#home',permission:null,icon:icons.LayoutDashboard},
  activity:{id:'activity',label:'Avisos y auditoría',href:'#activity',permission:'calendar',icon:icons.Activity},
  communications:{id:'communications',label:'Mensajes',href:'#communications',permission:'communications',icon:icons.MessageSquare},
  clients:{id:'clients',label:'Clientes',href:'#clients',permission:'clients',icon:icons.Users},
  'my-gym':{id:'my-gym',label:'Mi gimnasio',href:'#my-gym',permission:'ownerPanel',icon:icons.Dumbbell},
  calendar:{id:'calendar',label:'Agenda',href:'#calendar',permission:'calendar',icon:icons.CalendarDays},
  spaces:{id:'spaces',label:'Espacios',href:'#spaces',permission:'calendar',icon:icons.DoorOpen},
  services:{id:'services',label:'Servicios',href:'#services',permission:'calendar',icon:icons.LayoutGrid},
  contracts:{id:'contracts',label:'Contratos',href:'#contracts',permission:'billing',icon:icons.FileText},
  plans:{id:'plans',label:'Planes y cuotas',href:'#plans',permission:'catalogPricingManage',icon:icons.Ticket},
  timeclock:{id:'timeclock',label:'Fichaje',href:'#timeclock',permission:'staff',icon:icons.Clock},
  staff:{id:'staff',label:'Equipo',href:'#staff',permission:'staff',icon:icons.UserCog},
  caja:{id:'caja',label:'Caja',href:'#caja',permission:'cash',icon:icons.Wallet},
  economics:{id:'economics',label:'Economía',href:'#economics',permission:'billing',icon:icons.Wallet},
  reports:{id:'reports',label:'Informes',href:'#reports',permission:'billing',icon:icons.ReceiptText},
  promotions:{id:'promotions',label:'Promociones',href:'#promotions',permission:'catalogPricingManage',icon:icons.BadgePercent},
  monitoring:{id:'monitoring',label:'Monitorización',href:'#monitoring',permission:'ownerPanel',icon:icons.Activity},
  management:{id:'management',label:'Panel de gestión',href:'#management',permission:'ownerPanel',icon:icons.ShieldCheck},
  store:{id:'store',label:'Tienda',href:'#store',permission:'store',icon:icons.ShoppingBag},
  news:{id:'news',label:'Noticias',href:'#news',permission:'news',icon:icons.Newspaper},
  import:{id:'import',label:'Importar clientes',href:'#import',permission:'notificationSettings',icon:icons.Users},
  invitations:{id:'invitations',label:'Invitaciones',href:'#invitations',permission:'linkReviewManage',icon:icons.UserRound},
  settings:{id:'settings',label:'Configuración',href:'#settings',permission:'notificationSettings',icon:icons.Settings},
  'notification-settings':{id:'notification-settings',label:'Ajustes de avisos',href:'#notification-settings',permission:'notificationSettings',icon:icons.BellRing},
} satisfies Record<string,NavRoute>;
const navSections:NavSection[]=[
  {id:'operation',label:'Operación',icon:icons.LayoutDashboard,children:[routes.home,routes.activity,routes.timeclock,routes.calendar,routes.clients]},
  {id:'commercial',label:'Comercial',icon:icons.ShoppingBag,children:[routes.services,routes.spaces,routes.contracts,routes.plans,routes.economics,routes.caja,routes.store,routes.promotions]},
  {id:'management',label:'Gestión',icon:icons.Briefcase,children:[routes.communications,routes.staff,routes.reports,routes['my-gym'],routes.news,routes.invitations,routes.import,routes.settings,routes['notification-settings']]},
  {id:'administration',label:'Administración',icon:icons.ShieldCheck,children:[routes.management,routes.monitoring]},
];
/** Groups that start open on a wide sidebar. */
const defaultOpenGroups=['operation','commercial','management','administration'];
/** True when the professional shell has a screen for this route (used to show links to screens that another PR may add, e.g. #reports). */
export const hasProfessionalRoute = (id: string) => Object.hasOwn(routes, id);
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

/**
 * Responsive behaviour of the professional shell (Design System V2 section 13):
 * >=1280 expanded sidebar (264 px; the user may fold it to the 72 px rail), 1024-1279 rail,
 * <1024 off-canvas drawer opened from a top bar. There is no professional bottom navigation:
 * the mobile professional experience is staff-app (DD-08).
 */
export type ShellMode = 'expanded' | 'rail' | 'drawer';
const DRAWER_QUERY = '(max-width: 1023.98px)';
const RAIL_QUERY = '(max-width: 1279.98px)';
function readShellMode():ShellMode{
  if(typeof window==='undefined'||typeof window.matchMedia!=='function')return 'expanded';
  if(window.matchMedia(DRAWER_QUERY).matches)return 'drawer';
  return window.matchMedia(RAIL_QUERY).matches?'rail':'expanded';
}
function useShellMode():ShellMode{
  const [mode,setMode]=React.useState<ShellMode>(readShellMode);
  React.useEffect(()=>{
    if(typeof window.matchMedia!=='function')return;
    const queries=[window.matchMedia(DRAWER_QUERY),window.matchMedia(RAIL_QUERY)];
    const update=()=>setMode(readShellMode());
    queries.forEach(query=>query.addEventListener('change',update));update();
    return()=>queries.forEach(query=>query.removeEventListener('change',update));
  },[]);
  return mode;
}

export function AppShell({children}:{children:React.ReactNode}) {
  const [route,setRoute] = React.useState(routeId);
  const [data,setData] = React.useState<CommandCenterModel|null>(null);
  const [capabilities,setCapabilities] = React.useState<NavigationCapabilities|null>(null);
  const [authRequired,setAuthRequired] = React.useState(false);
  const [state,setState] = React.useState<'loading'|'ready'|'error'>('loading');
  const [error,setError] = React.useState('');
  const [searchOpen,setSearchOpen] = React.useState(false);
  const [folded,setFolded] = React.useState(()=>{try{return localStorage.getItem('2j.nav.compact.v1')==='true';}catch{return false;}});
  const mode=useShellMode();
  const isDrawer=mode==='drawer';
  const isRail=mode==='rail'||(mode==='expanded'&&folded);
  const [drawerOpen,setDrawerOpen]=React.useState(false);
  const [expandedGroups,setExpandedGroups]=React.useState(()=>new Set(isRail?[]:defaultOpenGroups));
  React.useEffect(()=>{try{localStorage.setItem('2j.nav.compact.v1',String(folded));}catch{}},[folded]);
  React.useEffect(()=>{setExpandedGroups(new Set(isRail?[]:defaultOpenGroups));},[isRail]);
  React.useEffect(()=>{if(!isDrawer)setDrawerOpen(false);},[isDrawer]);
  React.useEffect(()=>{setDrawerOpen(false);},[route]);
  const sidebarRef = React.useRef<HTMLElement>(null);
  const menuButtonRef = React.useRef<HTMLButtonElement>(null);
  const reload = React.useCallback(async()=>{
    setState('loading');setError('');
    try { const response=await apiFetch(`${api}/api/dashboard/command-center`,{credentials:'include',cache:'no-store'}); if(response.status===401){setAuthRequired(true);throw new Error('authentication_required');} if(!response.ok)throw new Error('No se pudo cargar el Command Center.'); setData(await response.json() as CommandCenterModel);setState('ready'); }
    catch(cause){setData(null);setError(cause instanceof Error?cause.message:'No se pudo cargar el inicio.');setState('error');}
  },[]);
  React.useEffect(()=>{ void reload();const change=()=>setRoute(routeId());window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change);},[reload]);
  React.useEffect(()=>{let current=true;void apiFetch(`${api}/api/session/capabilities`,{credentials:'include',cache:'no-store'}).then(async response=>{if(response.status===401){if(current)setAuthRequired(true);throw new Error();}if(!response.ok)throw new Error();const body=await response.json() as NavigationCapabilities;if(current)setCapabilities(body);}).catch(()=>{if(current)setCapabilities(null);});return()=>{current=false;};},[]);
  React.useEffect(()=>{const key=(event:KeyboardEvent)=>{const target=event.target as HTMLElement|null;const typing=!!target&&(target.isContentEditable||['INPUT','TEXTAREA','SELECT'].includes(target.tagName));if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();setSearchOpen(true);}else if(event.key==='/'&&!typing&&!event.ctrlKey&&!event.metaKey&&!event.altKey){event.preventDefault();setSearchOpen(true);}if(event.key==='Escape'){setSearchOpen(false);setDrawerOpen(false);}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
  // Drawer a11y: focus moves inside when it opens, returns to the menu button when it closes, and Tab stays inside while open.
  const drawerWasOpen=React.useRef(false);
  React.useEffect(()=>{
    if(drawerOpen){drawerWasOpen.current=true;sidebarRef.current?.querySelector<HTMLElement>('a[href],button:not([disabled])')?.focus();}
    else if(drawerWasOpen.current){drawerWasOpen.current=false;menuButtonRef.current?.focus();}
  },[drawerOpen]);
  const trapTab=(event:React.KeyboardEvent<HTMLElement>)=>{
    if(!isDrawer||!drawerOpen||event.key!=='Tab')return;
    const focusable=Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>('a[href],button:not([disabled])')??[]);
    const first=focusable[0],last=focusable[focusable.length-1];
    if(!first||!last)return;
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  };
  // The hash carries the route, so the skip link must not navigate: it only moves focus (and scroll) to the page content.
  const skipToContent=(event:React.MouseEvent<HTMLAnchorElement>)=>{event.preventDefault();document.getElementById('main-content')?.focus();};
  const permissions=capabilities;
  const navigation=getProfessionalNavigation(permissions,route);
  const pageContext=getProfessionalPageContext(route);
  const toggleGroup=(groupId:string)=>setExpandedGroups(current=>{const next=new Set(current);if(next.has(groupId))next.delete(groupId);else next.add(groupId);return next;});
  const logout=async()=>{try{const response=await apiFetch(`${api}/api/staff/auth/logout`,{method:'POST',credentials:'include',cache:'no-store'});if(!response.ok)throw new Error();setAuthRequired(true);setCapabilities(null);setData(null);}catch{setError('No se pudo cerrar la sesión. Inténtalo de nuevo.');}};
  const sidebarHidden=isDrawer&&!drawerOpen;
  const sidebarProps=isDrawer?{role:'dialog' as const,'aria-modal':drawerOpen||undefined,'aria-label':'Navegación principal'}:{'aria-label':'Navegación principal'};
  if(authRequired)return <StaffLogin/>;
  return <CommandContext.Provider value={{data,state,error,reload,capabilities}}><div className={`app-frame ${isRail?'is-rail':''} ${isDrawer?'is-drawer':''} ${drawerOpen?'drawer-open':''}`}>
    <a className="skip-link" href="#main-content" onClick={skipToContent}>Saltar al contenido</a>
    {isDrawer&&drawerOpen&&<div className="app-scrim" data-2j-design="v2" role="presentation" onClick={()=>setDrawerOpen(false)}/>}
    <aside id="app-sidebar" ref={sidebarRef} className="app-sidebar" data-2j-design="v2" {...sidebarProps} aria-hidden={sidebarHidden||undefined} onKeyDown={trapTab}>
      <div className="app-sidebar-brand"><a className="app-brand" href="#home" aria-label="2J Platform, Resumen"><span className="app-brand-mark">2J</span><span className="app-brand-copy">FITNESS CENTER<small>OPERACIONES</small></span></a>
        {isDrawer?<IconButton className="app-sidebar-close" icon={icons.X} label="Cerrar navegación" onClick={()=>setDrawerOpen(false)}/>:mode==='expanded'?<IconButton className="app-sidebar-toggle" size="sm" icon={folded?icons.PanelLeftOpen:icons.PanelLeftClose} label={folded?'Expandir menú':'Compactar menú'} onClick={()=>setFolded(value=>!value)}/>:null}</div>
      <nav className="app-navigation" aria-label="Secciones">
        {navigation.map(section=>{
          const isOpen=expandedGroups.has(section.id);
          if(section.route){const item=section.route;return <a key={section.id} className={`app-nav-item app-nav-top ${route===item.id?'active':''}`} href={item.href} aria-label={section.label} title={isRail?section.label:undefined} aria-current={route===item.id?'page':undefined}><Icon icon={section.icon} size={20} className="app-nav-icon"/><span className="nav-item-label">{section.label}</span></a>;}
          return <div className={`app-nav-group ${section.active?'is-active':''} ${isOpen?'is-open':''}`} key={section.id}>
            <button className="app-nav-item app-nav-top app-nav-group-trigger" type="button" aria-expanded={isOpen} aria-controls={`nav-subnav-${section.id}`} aria-label={section.label} title={isRail?section.label:undefined} onClick={()=>toggleGroup(section.id)}><Icon icon={section.icon} size={20} className="app-nav-icon"/><span className="nav-item-label">{section.label}</span><Icon icon={icons.ChevronDown} size={16} className="nav-chevron"/></button>
            {isOpen&&<div className="app-subnav" id={`nav-subnav-${section.id}`} role="group" aria-label={`${section.label} subsecciones`}>{section.children!.map(item=><a key={item.id} className={`app-nav-item app-subnav-item ${route===item.id?'active':''}`} href={item.href} aria-current={route===item.id?'page':undefined} title={isRail?item.label:undefined}><Icon icon={item.icon} size={16} className="app-nav-icon"/><span className="nav-item-label">{item.label}</span>{item.id==='communications'&&data?.unread? <span className="nav-count">{data.unread>99?'99+':data.unread}</span>:null}</a>)}</div>}
          </div>;
        })}
      </nav>
      <div className="app-sidebar-foot" title="Datos protegidos por permisos"><Icon icon={icons.ShieldCheck} size={16}/><span>Datos protegidos por permisos</span></div>
    </aside>
    <div className="app-content"><header className="app-topbar" data-2j-design="v2">
      {isDrawer&&<IconButton ref={menuButtonRef} className="app-menu-button" icon={icons.Menu} label="Abrir navegación" aria-expanded={drawerOpen} aria-controls="app-sidebar" onClick={()=>setDrawerOpen(true)}/>}
      <div className="app-location" aria-label="Ubicación actual">{pageContext.section!==pageContext.page&&<><span>{pageContext.section}</span><span className="app-location-divider" aria-hidden="true">/</span></>}<strong>{pageContext.page}</strong></div>
      <button className="global-search-trigger" type="button" onClick={()=>setSearchOpen(true)} aria-label="Buscar en 2J"><Icon icon={icons.Search} size={20}/><span>Buscar clientes, equipo, servicios o pantallas</span><kbd>Ctrl K</kbd></button>
      <div className="app-topbar-actions"><span className="local-pill"><span className="status-dot"/> {environmentLabelForHost(window.location.hostname)}</span><button type="button" className="staff-logout" onClick={()=>void logout()}>Salir</button></div></header>
      <div className="app-page" id="main-content" tabIndex={-1}>{children}</div>
    </div>
    <GlobalSearchDialog open={searchOpen} onClose={()=>setSearchOpen(false)} api={api} screens={navigation.flatMap(section=>(section.children??(section.route?[section.route]:[])).map(route=>({id:route.id,label:route.label,href:route.href,section:section.label})))}/>
  </div></CommandContext.Provider>;
}
export function environmentLabelForHost(hostname: string): string {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') return 'Entorno local';
  if (host === '2jfit.com' || host.endsWith('.2jfit.com')) return 'Staging';
  if (host === 'admin.2jfitnesscenter.com') return 'Producción';
  return 'Entorno';
}
