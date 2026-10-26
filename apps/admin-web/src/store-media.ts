// Pure helpers for product photos (Tienda). The server enforces the same rules; these run first so the UI can explain
// a problem before anything is uploaded instead of failing halfway through a selection.

export const MAX_PHOTOS_PER_PRODUCT = 6;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const PHOTO_ACCEPT = ALLOWED_PHOTO_TYPES.join(',');

export type PhotoCandidate = { name: string; type: string; size: number };
const extensionType: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const typeOf = (file: PhotoCandidate) => file.type || extensionType[file.name.split('.').pop()?.toLowerCase() ?? ''] || '';

export function remainingPhotoSlots(existing: number) { return Math.max(0, MAX_PHOTOS_PER_PRODUCT - existing); }
export const roomMessage = (remaining: number) => remaining <= 0 ? `Este producto ya tiene ${MAX_PHOTOS_PER_PRODUCT} fotos. Elimina alguna para añadir otra.` : `Puedes añadir ${remaining} ${remaining === 1 ? 'imagen más' : 'imágenes más'}.`;

/** All-or-nothing check of a selection: it either fits entirely and is valid, or nothing is uploaded and the reasons are listed. */
export function validatePhotoSelection(files: PhotoCandidate[], existing: number): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const remaining = remainingPhotoSlots(existing);
  if (files.length === 0) return { ok: false, errors: [] };
  if (remaining === 0) return { ok: false, errors: [roomMessage(0)] };
  if (files.length > remaining) errors.push(roomMessage(remaining));
  for (const file of files) {
    if (!(ALLOWED_PHOTO_TYPES as readonly string[]).includes(typeOf(file))) errors.push(`«${file.name}» no es una imagen JPEG, PNG o WebP.`);
    else if (file.size > MAX_PHOTO_BYTES) errors.push(`«${file.name}» pesa más de ${MAX_PHOTO_BYTES / 1024 / 1024} MB.`);
    else if (file.size === 0) errors.push(`«${file.name}» está vacía.`);
  }
  return { ok: errors.length === 0, errors };
}

/** Moves one photo to the front: the first photo is the primary one, so this is "Hacer principal". */
export function withPrimary(ids: string[], id: string) { return ids.includes(id) ? [id, ...ids.filter((item) => item !== id)] : ids; }
export function moveBy(ids: string[], id: string, delta: -1 | 1) {
  const from = ids.indexOf(id); const to = from + delta;
  if (from < 0 || to < 0 || to >= ids.length) return ids;
  const next = [...ids]; [next[from], next[to]] = [next[to]!, next[from]!]; return next;
}

/** One price when every active variant costs the same, "Desde X" when they differ. */
export function catalogPriceText(prices: number[], format: (cents: number) => string) {
  if (prices.length === 0) return 'Sin variantes activas';
  const min = Math.min(...prices); const max = Math.max(...prices);
  return min === max ? format(min) : `Desde ${format(min)}`;
}

export function formatBytes(bytes: number) { return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`; }
