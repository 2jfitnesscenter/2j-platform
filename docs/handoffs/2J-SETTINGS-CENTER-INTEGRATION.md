# Handoff — Configuración del centro

- **PR:** #158, Draft, dirigida a `main`; la rama incorpora `main` en `d69fae4034b41c9b8a7448d19ea6818b4835b957` (incluye #153 y #154).
- Centro lee y guarda mediante la API existente `GET/PUT /api/admin/center-profile`; el servidor exige `settings.manage`, registra auditoría y devuelve `no-store`.
- Apariencia conserva tokens globales oficiales de 2J (`#A4D65E`); no permite cambiar identidad visual por centro ni persistir URLs externas.
- Reservas dirige a la configuración por servicio existente; no crea reglas globales duplicadas.
- Tienda dirige al catálogo/variantes/inventario existentes; no inventa un umbral de stock ni una preferencia no aprobada.
- Facturación no se añade a esta pestaña; su configuración y puerta fiscal siguen en el módulo fiscal separado.
- Prueba de ajustes: 7/7 PASS. Admin Web completa sobre la pila: 367/367 PASS. Typecheck y build PASS; `git diff --check` PASS.
- El primer CI sobre `main` falló en el fixture TIMP existente (`699 !== 700`); sin cambio en esta PR. Se retargeteó sobre el head #153 `1c8a109` que contiene la corrección canónica.
- La API de centro ya existía; esta rama conecta su pantalla de edición, sus pruebas y el handoff. No añade migraciones, secretos ni datos de negocio.
- Al integrar #154 se resolvió el solapamiento de `settings-page.tsx`: se conservaron el editor conectado de Centro de #158 y Facturación de #154; la prueba cubre ambas pestañas y su respuesta sintética.
- Apariencia conserva la identidad global 2J; Reservas y Tienda enlazan a sus módulos propietarios. No se inventan ajustes globales que dupliquen reglas por servicio ni catálogo.
- **Pendiente:** validación del nuevo head, CI/E2E y una revisión independiente de esta actualización antes de cualquier merge. No se fusiona ni despliega.
