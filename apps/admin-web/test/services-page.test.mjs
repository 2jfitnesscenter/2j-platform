import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ServicesPage } from '../src/services-page.tsx';

test('services page exposes the Spanish catalog and accessible create flow', () => {
  const html = renderToStaticMarkup(React.createElement(ServicesPage));
  assert.match(html, /Servicios y planes/);
  assert.match(html, /aria-label="Buscar servicio"/);
  assert.match(html, /Nuevo servicio/);
  assert.match(html, /Catálogo de servicios/);
});
