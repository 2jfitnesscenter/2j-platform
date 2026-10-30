# Handoff — contratos de Evolución Platform / Home / Búnker

- **PR:** #135, Draft y sin merge.
- **Base integrada:** `e33113c311171fb7d63da9964774db39eaca4630`.
- **Delta:** solo documentos y esquemas JSON; no cambia código, permisos, DB, migraciones, Home ni Búnker.
- **Contrato Búnker:** se corrigió la propuesta anterior que duplicaba una ruta person-scoped. La integración existente es `POST /api/platform/v1/training-summary` (Búnker→Platform) y `GET /api/me/training-summary` (Platform→cliente); la ficha/schema ahora describen ese DTO real. No se implementa una ruta de gráficas ni se copia historial.
- **Contrato Home:** se propone API versionada de medidas/evaluaciones/consentimientos, con autoalcance por sesión, historial para gráficas, descarga protegida y permisos server-side. La API de mediciones no existe en la base revisada.
- **Decisiones aplicadas:** cliente escribe medidas solo con cuota vigente; personal con perfil autorizado puede escribir sin cuota. Corrección conserva auditoría de valor anterior/nuevo; borrado definitivo purga datos e historial de edición y conserva solo actor/instante/tipo/identificador de medida.
- **Salud:** requiere consentimiento previo, versión publicada por propietario, revocación efectiva inmediata, permiso específico y auditoría de lectura. Sin texto legal publicado, endpoint cerrado. No se incluye salud en push ni notas.
- **Validación documental:** parseo JSON de ambos esquemas PASS; `git diff --check` PASS (Git informa conversión CRLF automática en dos archivos, sin errores de whitespace). No se ejecutaron tests de código porque no hay delta funcional.
- **CI y revisión:** pendientes sobre el nuevo head. Solicitar revisión del delta a Home y Búnker; no mergear antes de esa revisión.
- **Siguientes pasos:** implementación en PRs separados; comprobar numeración contra todas las ramas abiertas antes de escoger migración; solo datos sintéticos en tests.
