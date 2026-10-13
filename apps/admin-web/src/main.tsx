import React from 'react';
import { createRoot } from 'react-dom/client';
import '@2j/design-tokens/tokens.css';
import './styles.css';
import { ServicesPage } from './services-page.js';
import { ClientsPage } from './clients-page.js';
import { CalendarPage } from './calendar-page.js';
import { EconomicsPage } from './economics-page.js';
import { StaffPage } from './staff-page.js';
import { CommunicationsPage } from './communications-page.js';
import { AppShell } from './app-shell.js';
import { CommandCenter } from './command-center.js';
import { NotificationSettings } from './notification-settings.js';
import { NewsPage } from './news-page.js';

function App() {
  const [route, setRoute] = React.useState(() => window.location.hash.slice(1).split('?')[0] || 'home');
  React.useEffect(() => {
    const onHashChange = () => setRoute(window.location.hash.slice(1).split('?')[0] || 'home');
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  React.useEffect(() => { document.title = `${route === 'home' ? 'Inicio' : route === 'clients' ? 'Clientes' : route === 'calendar' ? 'Agenda' : route === 'economics' ? 'Economía' : route === 'staff' ? 'Equipo' : route === 'communications' ? 'Comunicación' : route === 'notification-settings' ? 'Avisos' : route === 'news' ? 'Noticias' : 'Servicios'} · 2J Platform`; }, [route]);
  const page = route === 'news' ? <NewsPage/> : route === 'notification-settings' ? <NotificationSettings/> : route === 'clients' ? <ClientsPage/> : route === 'calendar' ? <CalendarPage/> : route === 'economics' ? <EconomicsPage/> : route === 'staff' ? <StaffPage/> : route === 'communications' ? <CommunicationsPage/> : route === 'services' ? <ServicesPage/> : <CommandCenter/>;
  return <AppShell>{page}</AppShell>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
