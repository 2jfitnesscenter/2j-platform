# 2J-HOME-MEASUREMENTS-CLIENT — dependencias Platform

## Estado

- Repositorio: `2jfitnesscenter/2j-platform`.
- Rama local: `agent/codex/2J-HOME-MEASUREMENTS-CLIENT`.
- Base: `8de8cb193395ef4817138cf00616d29fa80565d0` (incluye D185–D198, D31 y push cliente).
- Estado: bloqueado para interfaz real hasta que Platform publique un contrato de mediciones propio.
- Código funcional de mediciones, API, migración y datos: ninguno añadido.
- Push, merge y despliegue: ninguno.

## Hallazgo verificado

En el código Platform de esta base no hay rutas ni modelo de mediciones. La búsqueda de rutas `/api/me/measurements` y `/api/me/health` no encontró una API de cliente. `GET /api/client-portal/form-assignments` lista formularios asignados y `GET /api/client-portal/form-assignments/:assignmentId` devuelve la definición del formulario, pero no devuelve el historial de respuestas del cliente. El POST de respuesta sirve para formularios asignados; no proporciona catálogo de mediciones, historial, gráficas ni correcciones de medición. No se reutilizará ese contrato para fingir un historial de medidas.

La limitación coincide con el conflicto #19 de `REGISTRO-DECISIONES-2J.md`: Platform carece del dominio de mediciones, salud, consentimientos y evaluaciones. El estado del registro distingue decisión aprobada de implementación verificada.

## Decisiones de producto aplicables

- D05/D47: «Mi evolución» vive dentro de Perfil; contiene accesos a Mediciones, Gráficos, Evaluaciones y Mi salud. Salud queda fuera del resumen.
- D01: clientes con cuota vigente registran y consultan medidas/pliegues.
- D08: sin cuota pueden consultar historial, pero no registrar.
- D28: clientes sin cuota pueden consultar, registrar y corregir mediciones/evaluaciones; contradice D01/D08 y el registro no contiene una resolución A para esta diferencia.
- D10/D43: Home/Platform es la vista de medidas y salud; Búnker conserva su sistema durante la transición. No borrar orígenes hasta verificar la unificación.
- D11/D13/D14: catálogo configurable, mediciones individuales/plantillas y comparación gráfica por fechas.
- D12/D35: corrección controlada auditada frente a eliminación definitiva del dato erróneo; el registro marca esta tensión como conflicto #8 y no contiene una resolución A específica. No se propone una mutación cliente hasta que el contrato Platform concrete corrección, eliminación y auditoría.
- D16/D17/D18/D23: salud es voluntaria, consentimiento expreso y revocable; permisos y autorización se verifican en servidor y el retiro bloquea el acceso de inmediato.
- D33: la conservación de datos tras retirar consentimiento necesita validación jurídica antes de implementarse.

No hay una recomendación de conflicto registrada para el acceso de escritura D01/D08/D28, ni una resolución para #8/#19. Por tanto Home no inventa una regla local ni simula el resultado.

## Contratos que Platform debe proporcionar antes de la UI real

1. Un modelo versionado de catálogo/definición de mediciones, incluyendo claves estables, etiqueta, tipo, unidad, precisión y si el dato es corporal o de salud. Los nombres concretos de rutas y objetos los debe decidir Platform.
2. Lectura autenticada por sesión y siempre autoalcanzada: catálogo visible, última medición, historial paginado y datos aptos para gráfico. No aceptar `clientId` elegido por Home.
3. Alta de una sesión de medición con fecha, valores tipados y origen (cliente/personal/dispositivo, si el registro lo permite). Validación, vigencia de cuota y permisos decididos en el servidor.
4. Reglas explícitas para corrección/eliminación: D12 exige autor y auditoría de valor anterior/nuevo; D35 exige eliminar definitivamente valores erróneos de los datos operativos sin conservar innecesariamente el dato. Hace falta resolver qué operación aplica a cada caso, qué eventos quedan en auditoría y quién puede ejecutarlos.
5. Separación de campos corporales y de salud, consentimiento actual, capacidad para registrar/leer/revocar, `no-store`, filtrado de campos en respuestas y registros de acceso a salud según E15.
6. Estados vacíos, fecha de medición, unidades y datos históricos suficientes para gráfico; ninguna regla de cuotas, conversión de unidades o tendencia debe inferirse en Home si afecta a su interpretación.
7. Resolución Platform de la elegibilidad de registro sin cuota entre D01, D08 y D28. Hasta entonces, cualquier write gate debe vivir y fallar cerrado en servidor.

## Próximo paso coordinado

Platform/Claude: publicar contrato y dominio de mediciones/consentimiento con tests de autoacceso, permisos, consentimiento revocado, historial, idempotencia, corrección/eliminación, auditabilidad y acceso sin cuota resuelto.

Home/Codex: en una rama cliente posterior, consumir ese contrato con pantallas reales de Perfil → Mi evolución → Mediciones; luego gráficos, evaluaciones y salud en PRs separados. Esta rama no sustituye el trabajo Platform ni llama a Búnker.

## Alcance y verificación

- Solo se añade este handoff a la rama cliente.
- No se tocan API/DB Platform, Búnker, autenticación, capacidades, datos, producción, infraestructura ni la rama de capacidades.
- No se ejecutan pruebas: no hay cambios ejecutables en esta rama. La calidad de la implementación Push sigue verificada en su commit anterior; este handoff no altera esos archivos.

## Coordinación de ramas Push

La referencia `origin/agent/claude/2J-PUSH-INFRA` (`fc3b3ae51f3e03f7df977a10690ef8b6b940a27f`) y Home parten de bases distintas; su merge-base actual es `f87818afe474176c6e6ae77cb4d62a7e73fc1adf`. Ambas líneas incluyen los mismos nombres de archivos de cliente Push. Antes de publicar/combinar, Claude debe publicar primero su Draft y la rama Home debe apilarse o rebasarse contra ese head, conservando solo la diferencia Home y resolviendo esos archivos una sola vez. No combinar ambos heads directamente contra main.
