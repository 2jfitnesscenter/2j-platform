# Evidencia 2J-071

## Comprobación funcional

- PostgreSQL 17 recién creado + 15 migraciones: cero clientes, profesionales, sesiones, reservas, entradas de espera, mensajes y cargos.
- Suite total: 175/175 tests; typecheck y build en 7 paquetes; auditoría sin vulnerabilidades.
- Navegador real: Inicio muestra la agenda vacía y métricas en cero; Calendario muestra la semana vacía y el CTA «Crear tu primer horario»; el configurador presenta L/M/V × 07:00/08:00/09:00 (9 plantillas); Comunicación sigue visible al entrar en Agenda.
- Inspeccionado visualmente en escritorio. No se guardó una captura como artefacto; revisión visual independiente y comprobación específica de 768/390 px quedan pendientes.

La comprobación de datos limpios se realiza en una base `2j_platform_local` recién creada con migraciones únicamente: contiene el catálogo estructural de áreas, pero cero clientes, profesionales, sesiones, reservas, entradas de espera, mensajes y cargos. La semilla sintética requiere una base separada llamada `2j_demo` y ejecución explícita de `pnpm seed:demo`.
