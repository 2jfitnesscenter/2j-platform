# 2J-060 — evidencia de interfaz

La interfaz operativa de esta pasada incluye la bandeja de Comunicación, selección de plantillas activas, mensajes al cliente, notas internas visualmente separadas, autor del mensaje, busy/feedback accesibles y estados de carga/error/vacío. Clientes 360 carga listas reales de formularios, consentimientos y check-ins; permite revisión autorizada y aceptación asistida.

## Responsive

La captura disponible de 1440 px, [communications-1440.png](./communications-1440.png), pertenece al head anterior a esta corrección y se conserva solo como referencia histórica. No se han generado capturas actuales a 1440, 768 ni 390 px en esta pasada. La inspección responsive real de estas vistas queda pendiente de QA independiente; no se presentan renders estáticos como capturas reales.

La hoja de estilos conserva breakpoints para tablet y móvil. Los tests de Admin Web verifican interacciones, estados y permisos; el build de Vite comprueba el bundle. Esto no sustituye la inspección visual en navegador a 1440, 768 y 390 px, pendiente antes del merge.

## Límites visibles de producto

- La interfaz Admin implementa la bandeja y opera documentos existentes desde Clientes 360: estado, fechas, respuestas cuando hay permiso, revisión de PAR-Q, aceptación asistida de la versión activa y lista de seguimiento.
- El versionado/configuración de formularios, consentimientos y requisitos, y la asignación de check-ins, siguen en API autenticada; no se crea constructor visual ni editor drag-and-drop. La respuesta/autocompletado por el cliente queda en portal.
- No se habilitan adjuntos porque aún no existe almacenamiento de objetos seguro configurado.
