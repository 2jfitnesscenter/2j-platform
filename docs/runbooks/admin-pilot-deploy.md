# Preparación del piloto de Admin

## Estado comprobado

El piloto local existente (`pnpm pilot`) levanta Admin, Staff, Member y tres procesos API sobre `127.0.0.1`, con PostgreSQL sintético local. El API expone `/health` con disponibilidad de base de datos. El modo `LOCAL_DEMO_ROLE` solo se admite con `NODE_ENV=development`. El servidor rechaza cualquier `HOST` que no sea loopback. Por tanto, esta aplicación todavía no se debe publicar en una URL accesible por Internet: la autenticación actual no sirve para un servidor externo.

La preparación del candidato se ejecuta desde un commit limpio:

```powershell
pnpm pilot
pnpm --filter @2j/admin-web build
pnpm exec powershell.exe -NoProfile -ExecutionPolicy Bypass -File tooling/deploy/prepare-admin-pilot-release.ps1 -PrepareOnly
```

El script crea un ZIP en `%TEMP%\2j-admin-pilot-releases\<commit>.zip`, registra SHA-256 y manifiesta que el artefacto es piloto interno, fiscalidad cerrada y exposición pública desactivada. No se conecta a redes, no migra bases de datos, no toca DNS y no despliega. El staging de aceptación actual es el piloto local con datos sintéticos; se conserva usando `pnpm pilot:stop` y reiniciando `pnpm pilot`.

## Controles que deberá tener el despliegue

Antes de instalar cualquier candidato en un servidor se requiere:

- autenticación de personal apta para servidor, revisada de forma independiente; el rol local de demostración no puede salir de `development`;
- acceso privado al staging (VPN o túnel SSH desde una IP autorizada), API sin puerto público y base de datos solo en loopback/red privada;
- copia de seguridad verificada antes de activar un release; release inmutable identificado por commit; puntero atómico a la versión activa; rollback de código al último release sano sin restaurar ni alterar datos;
- health check de `/health` y carga de Admin, prueba sintética de permisos, supervisión de errores y procedimiento de parada;
- `contract_terms_not_available` y `legal_fiscal_gate_closed` conservados; no emitir documentos fiscales;
- ningún secreto en el repositorio ni en artefactos; se configurarán en el servidor cuando el propietario autorice expresamente ese paso.

El kit de esta iteración solo prepara y verifica artefactos. No ofrece todavía activación remota, backup ni rollback de servidor porque falta elegir y autorizar el destino de staging y falta la autenticación de personal para un runtime remoto.

## Requisitos propuestos para revisión del propietario

Destino separado de Búnker, Ubuntu Server 24.04 LTS, 2 vCPU, 4 GiB RAM y 40 GiB SSD como estimación inicial para un piloto interno pequeño; confirmar capacidad con carga antes de fijarla. Node.js 24 LTS, PostgreSQL 17, proxy TLS mantenido (Caddy o Nginx), firewall con 80/443 solo si se aprueba publicación, SSH restringido a IP autorizada y copias cifradas fuera del servidor. El servidor de staging no debe contener datos reales.

DNS propuesto, todavía sin aplicar: `A admin` → IPv4 del servidor de staging elegido; `AAAA admin` → solo si se configura y prueba IPv6; TTL 300 s durante el piloto. No apuntar el dominio al VPS de Búnker por defecto. No existe una IP aprobada para Platform en las fuentes revisadas.

## Camino de activación

1. Cerrar autenticación de personal y re-review de seguridad.
2. Elegir servidor y definir backup/retención, supervisión y responsable de recuperación.
3. Aprobar por separado acceso al servidor, secretos y DNS.
4. Desplegar primero a staging aislado; verificar backup, health checks, rollback y fiscal gate cerrado.
5. Solicitar una autorización explícita de producción antes de cualquier despliegue público.
