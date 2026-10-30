# Handoff — Configuración del centro

- **PR:** #158, Draft, dirigida a `main`; la rama incorpora `main` en `16602f10fdffc6e83af1bb03a7f770855dafd757` (incluye #89, #153, #154 y #155).
- Centro lee y guarda mediante la API existente `GET/PUT /api/admin/center-profile`; el servidor exige `settings.manage`, registra auditoría y devuelve `no-store`.
- Apariencia conserva tokens globales oficiales de 2J (`#A4D65E`); no permite cambiar identidad visual por centro ni persistir URLs externas.
- Reservas dirige a la configuración por servicio existente; no crea reglas globales duplicadas.
- Tienda dirige al catálogo/variantes/inventario existentes; no inventa un umbral de stock ni una preferencia no aprobada.
- Facturación no se añade a esta pestaña; su configuración y puerta fiscal siguen en el módulo fiscal separado.
- Prueba de ajustes: 7/7 PASS. Admin Web completa sobre la pila: 367/367 PASS. Typecheck y build PASS; `git diff --check` PASS.
- El primer CI sobre `main` falló en el fixture TIMP existente (`699 !== 700`); sin cambio en esta PR. Se retargeteó sobre el head #153 `1c8a109` que contiene la corrección canónica.
- La API de centro ya existía; esta rama conecta su pantalla de edición, sus pruebas y el handoff. No añade migraciones, secretos ni datos de negocio.
- Al integrar #154 se resolvió el solapamiento de `settings-page.tsx`: se conservaron el editor conectado de Centro de #158 y Facturación de #154; la prueba cubre ambas pestañas y su respuesta sintética.
- Revisión independiente de la actualización: un P2 por límites del formulario mayores que el servidor. Corregido alineando teléfono/dirección/ciudad/código postal con los máximos validados por API (40/200/100/20) y añadiendo aserciones.
- Apariencia conserva la identidad global 2J; Reservas y Tienda enlazan a sus módulos propietarios. No se inventan ajustes globales que dupliquen reglas por servicio ni catálogo.
- Validación tras el conflicto: test de Configuración 7/7; Admin Web 374/375 (único fallo intermitente preexistente `deep-link.test.mjs`, 3/3 pasa aislado); typecheck y build PASS; `git diff --check` PASS. CI/E2E del head actualizado pendientes.
- **Pendiente:** CI/E2E del nuevo head y conclusión del PR. No se fusiona ni despliega.
