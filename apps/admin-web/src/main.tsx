import React from 'react';
import { createRoot } from 'react-dom/client';
import '@2j/design-tokens/tokens.css';
import '@2j/design-tokens/fonts.css';
import '@2j/ui/ui.css';
import './styles.css';
import './shell-v2.css';
import './summary-v2.css';
import './clients-v2.css';
import './agenda-v2.css';
import './services-v2.css';
import './store-v2.css';
import { ServicesPage } from './services-page.js';
import { ClientsPage } from './clients-page.js';
import { CalendarPage } from './calendar-page.js';
import { EconomicsPage } from './economics-page.js';
import { StaffPage } from './staff-page.js';
import { MyGymPage } from './my-gym-page.js';
import { ReportsPage } from './reports-page.js';
import { MonitoringPage } from './monitoring-page.js';
import { TimeClockPage } from './timeclock-page.js';
import { CommunicationsPage } from './communications-page.js';
import { AppShell, getProfessionalPageContext } from './app-shell.js';
import { CommandCenter } from './command-center.js';
import { ActivityPage } from './activity-page.js';
import { NotificationSettings } from './notification-settings.js';
import { SettingsPage } from './settings-page.js';
import { NewsPage } from './news-page.js';
import { StorePage } from './store-page.js';
import { usePageResetOnModuleChange } from './route-focus.js';

function App() {
  const [route, setRoute] = React.useState(() => window.location.hash.slice(1).split('?')[0] || 'home');
  React.useEffect(() => {
    const onHashChange = () => setRoute(window.location.hash.slice(1).split('?')[0] || 'home');
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  React.useEffect(() => { document.title = `${getProfessionalPageContext(route).page} · 2J Platform`; }, [route]);
  usePageResetOnModuleChange(route);
  const page = route === 'store' ? <StorePage/> : route === 'activity' ? <ActivityPage/> : route === 'news' ? <NewsPage/> : route === 'settings' ? <SettingsPage/> : route === 'notification-settings' ? <NotificationSettings/> : route === 'clients' ? <ClientsPage/> : route === 'calendar' ? <CalendarPage/> : route === 'economics' ? <EconomicsPage/> : route === 'staff' ? <StaffPage/> : route === 'my-gym' ? <MyGymPage/> : route === 'reports' ? <ReportsPage/> : route === 'timeclock' ? <TimeClockPage/> : route === 'communications' ? <CommunicationsPage/> : route === 'spaces' ? <ServicesPage section="areas"/> : route === 'services' ? <ServicesPage section="services"/> : route === 'monitoring' ? <MonitoringPage/> : route === 'plans' ? <ServicesPage section="plans"/> : <CommandCenter/>;
  return <AppShell>{page}</AppShell>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
