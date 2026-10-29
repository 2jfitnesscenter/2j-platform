/**
 * Novedades de la plataforma de gestión, de la más reciente a la más antigua. Es texto fijo escrito a mano
 * (no viene de la API) y solo recoge entregas ya fusionadas en main. No confundir con Noticias del centro.
 */
export type PlatformChange = { date: string; title: string; items: string[] };

export const PLATFORM_CHANGELOG: PlatformChange[] = [
  { date: '2026-10-28', title: 'Caja con dos registros físicos', items: ['La caja distingue el registro de Búnker y el de Sala, con custodia de quien la tiene a su cargo.'] },
  { date: '2026-10-26', title: 'Paridad visual del panel', items: [
    'Planes y cuotas, Espacios y Servicios en pantallas separadas.',
    'Informes con listado de ventas, Configuración de solo lectura y Mi gimnasio con el panel del propietario.',
    'Resumen con accesos rápidos, Agenda, Fichaje, Clientes, Tienda y Actividad con el nuevo diseño.',
    'Asistencia marcada con ✓/✗ en la sesión.',
  ] },
];
