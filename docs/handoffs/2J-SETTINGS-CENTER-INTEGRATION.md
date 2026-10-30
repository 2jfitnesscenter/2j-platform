# Handoff — Configuración del centro

- **PR:** #158, Draft, apilada sobre #153 hasta que se integre el arreglo de fixture TIMP.
- Centro lee y guarda mediante la API existente `GET/PUT /api/admin/center-profile`; el servidor exige `settings.manage`, registra auditoría y devuelve `no-store`.
- Apariencia conserva tokens globales oficiales de 2J (`#A4D65E`); no permite cambiar identidad visual por centro ni persistir URLs externas.
- Reservas dirige a la configuración por servicio existente; no crea reglas globales duplicadas.
- Tienda dirige al catálogo/variantes/inventario existentes; no inventa un umbral de stock ni una preferencia no aprobada.
- Facturación no se añade a esta pestaña; su configuración y puerta fiscal siguen en el módulo fiscal separado.
- Prueba de ajustes: 7/7 PASS. Admin Web completa sobre la pila: 367/367 PASS. Typecheck y build PASS; `git diff --check` PASS.
- El primer CI sobre `main` falló en el fixture TIMP existente (`699 !== 700`); sin cambio en esta PR. Se retargeteó sobre el head #153 `1c8a109` que contiene la corrección canónica.
- La rama cambia solo UI/tests/handoff de Configuración; no añade API, migración, secretos ni datos.
- **Pendiente:** CI del nuevo head y revisión independiente antes de cualquier merge. No se fusiona ni despliega.
