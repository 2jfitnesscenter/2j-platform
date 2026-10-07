import React from 'react';
import { createRoot } from 'react-dom/client';
import '@2j/design-tokens/tokens.css';
import './styles.css';
import { ServicesPage } from './services-page.js';

createRoot(document.getElementById('root')!).render(<React.StrictMode><ServicesPage /></React.StrictMode>);
