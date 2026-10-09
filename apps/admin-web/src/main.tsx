import React from 'react';
import { createRoot } from 'react-dom/client';
import '@2j/design-tokens/tokens.css';
import './styles.css';
import { ServicesPage } from './services-page.js';
import { ClientsPage } from './clients-page.js';
import { CalendarPage } from './calendar-page.js';
import { EconomicsPage } from './economics-page.js';
import { StaffPage } from './staff-page.js';

function App() {
  const [route, setRoute] = React.useState(() => window.location.hash.slice(1) || 'services');
  React.useEffect(() => {
    const onHashChange = () => setRoute(window.location.hash.slice(1) || 'services');
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  return route === 'clients' ? <ClientsPage/> : route === 'calendar' ? <CalendarPage/> : route === 'economics' ? <EconomicsPage/> : route === 'staff' ? <StaffPage/> : <ServicesPage/>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
