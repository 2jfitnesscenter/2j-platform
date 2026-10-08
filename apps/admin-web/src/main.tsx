import React from 'react';
import { createRoot } from 'react-dom/client';
import '@2j/design-tokens/tokens.css';
import './styles.css';
import { ServicesPage } from './services-page.js';
import { ClientsPage } from './clients-page.js';

function App() {
  const [route, setRoute] = React.useState(() => window.location.hash === '#clients' ? 'clients' : 'services');
  React.useEffect(() => {
    const onHashChange = () => setRoute(window.location.hash === '#clients' ? 'clients' : 'services');
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  return route === 'clients' ? <ClientsPage/> : <ServicesPage/>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
