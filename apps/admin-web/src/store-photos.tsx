import { apiFetch } from './api-fetch.js';
import React from 'react';
import { Button, Icon, icons } from '@2j/ui';
import { MAX_PHOTOS_PER_PRODUCT, PHOTO_ACCEPT, moveBy, remainingPhotoSlots, roomMessage, validatePhotoSelection, withPrimary, MAX_PHOTO_BYTES } from './store-media';

const api = import.meta.env?.VITE_API_URL ?? 'http://localhost:3100';
export type Media = { id: string; position: number; isPrimary: boolean; mimeType: string; sizeBytes: number };
export const photoUrl = (mediaId: string) => `${api}/api/admin/store/media/${mediaId}/file`;

const reasons: Record<string, string> = {
  media_limit_reached: 'Este producto ya tiene 6 fotos.', file_too_large: `La foto pesa más de ${MAX_PHOTO_BYTES / 1024 / 1024} MB.`, unsupported_media_type: 'Solo se admiten fotos JPEG, PNG o WebP.',
  storage_unavailable: 'No se pudo guardar la foto. Inténtalo de nuevo.', media_set_mismatch: 'La galería ha cambiado. Actualiza e inténtalo de nuevo.', media_not_found: 'La foto ya no existe.', product_not_found: 'El producto ya no existe.',
  permission_denied: 'No tienes permiso para gestionar el catálogo.', file_required: 'No se recibió ningún archivo.', invalid_upload: 'No se pudo leer el archivo.', internal_error: 'No se pudo guardar. Inténtalo de nuevo.',
};
const reasonOf = (code: unknown) => reasons[typeof code === 'string' ? code : ''] ?? 'No se pudo completar la operación.';
async function call(path: string, init: RequestInit) {
  const response = await apiFetch(`${api}${path}`, { ...init, cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? 'internal_error');
  return body;
}
/** multipart/form-data, one file per request (no base64). The browser sets the boundary header. */
export const uploadPhoto = (productId: string, file: File) => { const form = new FormData(); form.append('file', file); return call(`/api/admin/store/products/${productId}/media`, { method: 'POST', body: form }); };
export const reorderPhotos = (productId: string, mediaIds: string[]) => call(`/api/admin/store/products/${productId}/media/order`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mediaIds }) });
export const deletePhoto = (mediaId: string) => call(`/api/admin/store/media/${mediaId}`, { method: 'DELETE' });

/** Uploads in order and stops at the first failure, reporting exactly what was stored. */
export async function uploadPhotos(productId: string, files: File[], onProgress?: (done: number, total: number) => void) {
  let done = 0;
  for (const file of files) {
    onProgress?.(done, files.length);
    try { await uploadPhoto(productId, file); } catch (cause) { return { done, failed: { name: file.name, reason: reasonOf(cause instanceof Error ? cause.message : '') } }; }
    done += 1;
  }
  onProgress?.(done, files.length);
  return { done, failed: null };
}

function useObjectUrls(files: File[]) {
  const [urls, setUrls] = React.useState<string[]>([]);
  React.useEffect(() => {
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') { setUrls(files.map(() => '')); return; }
    const created = files.map((file) => { try { return URL.createObjectURL(file); } catch { return ''; } }); setUrls(created);
    return () => created.forEach((url) => { if (url) URL.revokeObjectURL?.(url); });
  }, [files]);
  return urls;
}

/** File chooser + drop zone. It validates the whole selection against the room left before handing it over. */
export function PhotoDropzone({ existing, disabled, onFiles, label = "Subir fotos" }: { existing: number; disabled?: boolean | undefined; onFiles: (files: File[]) => void; label?: string }) {
  const input = React.useRef<HTMLInputElement>(null);
  const [errors, setErrors] = React.useState<string[]>([]);
  const [over, setOver] = React.useState(false);
  const remaining = remainingPhotoSlots(existing);
  const take = (list: FileList | File[] | null) => {
    const files = list ? [...list] : [];
    const result = validatePhotoSelection(files, existing);
    if (files.length === 0) return;
    if (!result.ok) { setErrors(result.errors); return; }
    setErrors([]); onFiles(files);
  };
  return <div className="photo-drop-wrap">
    <div className={`photo-drop${over ? ' is-over' : ''}${remaining === 0 ? ' is-full' : ''}`} onDragOver={(event) => { event.preventDefault(); if (!disabled && remaining > 0) setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(event) => { event.preventDefault(); setOver(false); if (!disabled) take(event.dataTransfer?.files ?? null); }}>
      <Icon icon={icons.ImagePlus} size={20} />
      <span>{remaining === 0 ? roomMessage(0) : 'Arrastra tus fotos aquí o elígelas desde tu equipo'}</span>
      <Button onClick={() => input.current?.click()} disabled={disabled || remaining === 0}>{label}</Button>
      <input ref={input} type="file" multiple accept={PHOTO_ACCEPT} aria-label="Elegir fotos" hidden onChange={(event) => { take(event.target.files); event.target.value = ''; }} />
    </div>
    {remaining > 0 && <p className="photo-room" role="status">{roomMessage(remaining)} JPEG, PNG o WebP, hasta {MAX_PHOTO_BYTES / 1024 / 1024} MB cada una.</p>}
    {errors.length > 0 && <ul className="photo-errors" role="alert">{errors.map((message) => <li key={message}>{message}</li>)}</ul>}
  </div>;
}

/** Photos chosen while creating a product: nothing exists on the server yet, so they wait here and are uploaded right after the product is saved. */
export function PendingPhotos({ files, onChange, disabled }: { files: File[]; onChange: (files: File[]) => void; disabled?: boolean }) {
  const urls = useObjectUrls(files);
  return <fieldset className="photo-pending" disabled={disabled}>
    <legend>Fotos (opcional)</legend>
    <PhotoDropzone existing={files.length} disabled={disabled} onFiles={(added) => onChange([...files, ...added])} label="Añadir fotos" />
    {files.length > 0 && <ul className="photo-grid" aria-label="Fotos elegidas">{files.map((file, index) => <li key={`${file.name}-${index}`} className="photo-tile">
      <div className="photo-thumb">{urls[index] ? <img src={urls[index]} alt="" /> : <Icon icon={icons.Image} size={20} />}{index === 0 && files.length > 1 && <span className="photo-badge">Principal</span>}</div>
      <span className="photo-name">{file.name}</span>
      <div className="photo-actions"><Button size="sm" variant="ghost" aria-label={`Quitar ${file.name}`} onClick={() => onChange(files.filter((_, position) => position !== index))}>Quitar</Button></div>
    </li>)}</ul>}
    {files.length > 1 && <p className="photo-room">La primera foto será la principal.</p>}
  </fieldset>;
}

/** Gallery of one product: the primary photo large and the others as thumbnails that swap the preview locally. */
export function ProductGallery({ name, media }: { name: string; media: Media[] }) {
  const [selected, setSelected] = React.useState(media[0]?.id ?? '');
  React.useEffect(() => { if (!media.some((item) => item.id === selected)) setSelected(media[0]?.id ?? ''); }, [media, selected]);
  if (media.length === 0) return null;
  const current = media.find((item) => item.id === selected) ?? media[0]!;
  return <div className="gallery"><div className="gallery-main"><img src={photoUrl(current.id)} alt={name} /></div>
    {media.length > 1 && <ul className="gallery-thumbs" aria-label={`Fotos de ${name}`}>{media.map((item, index) => <li key={item.id}><button type="button" className={item.id === current.id ? 'is-current' : ''} aria-label={`Ver foto ${index + 1} de ${media.length}`} aria-pressed={item.id === current.id} onClick={() => setSelected(item.id)}><img src={photoUrl(item.id)} alt="" /></button></li>)}</ul>}
  </div>;
}

/** Live manager for an existing product: upload several at once, make one primary, reorder and delete. */
export function PhotoManager({ productId, name, media, onChanged, confirmDelete }: { productId: string; name: string; media: Media[]; onChanged: () => Promise<void>; confirmDelete: (message: string) => boolean }) {
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState('');
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const ids = media.map((item) => item.id);
  const run = async (task: () => Promise<void>) => { if (busy) return; setBusy(true); setError(''); setNotice(''); try { await task(); } catch (cause) { setError(reasonOf(cause instanceof Error ? cause.message : '')); } finally { setProgress(''); setBusy(false); } };
  const upload = (files: File[]) => run(async () => {
    const result = await uploadPhotos(productId, files, (done, total) => setProgress(done < total ? `Subiendo ${done + 1} de ${total}…` : ''));
    await onChanged();
    if (result.failed) setError(`Se subieron ${result.done} de ${files.length}. No se pudo subir «${result.failed.name}»: ${result.failed.reason}`);
    else setNotice(files.length === 1 ? 'Foto añadida.' : `${files.length} fotos añadidas.`);
  });
  const reorder = (next: string[]) => run(async () => { await reorderPhotos(productId, next); await onChanged(); });
  const remove = (item: Media) => { if (!confirmDelete('¿Eliminar esta foto?')) return; void run(async () => { const result = await deletePhoto(item.id); await onChanged(); if (result.objectCleanup === 'failed') setNotice('Foto eliminada. El archivo se limpiará más tarde.'); }); };
  return <div className="photo-manager">
    <p className="photo-help">La primera foto es la <strong>principal</strong>: es la que se ve en el catálogo. Las variantes (tallas, formatos, sabores) comparten las fotos del producto.</p>
    {media.length > 0 && <ul className="photo-grid" aria-label={`Fotos de ${name}`}>{media.map((item, index) => <li key={item.id} className="photo-tile">
      <div className="photo-thumb"><img src={photoUrl(item.id)} alt={`Foto ${index + 1} de ${name}`} />{index === 0 && media.length > 1 && <span className="photo-badge">Principal</span>}</div>
      <div className="photo-actions">
        {media.length > 1 && index > 0 && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void reorder(withPrimary(ids, item.id))}>Hacer principal</Button>}
        {media.length > 1 && <Button size="sm" variant="ghost" disabled={busy || index === 0} aria-label={`Mover foto ${index + 1} antes`} onClick={() => void reorder(moveBy(ids, item.id, -1))}>←</Button>}
        {media.length > 1 && <Button size="sm" variant="ghost" disabled={busy || index === media.length - 1} aria-label={`Mover foto ${index + 1} después`} onClick={() => void reorder(moveBy(ids, item.id, 1))}>→</Button>}
        <Button size="sm" variant="danger" disabled={busy} aria-label={`Eliminar foto ${index + 1}`} onClick={() => remove(item)}>Eliminar</Button>
      </div>
    </li>)}</ul>}
    {media.length === 0 && <p className="photo-empty">Este producto aún no tiene fotos. Sin foto se muestra un icono con sus iniciales.</p>}
    <PhotoDropzone existing={media.length} disabled={busy} onFiles={(files) => void upload(files)} />
    {progress && <p className="photo-progress" role="status">{progress}</p>}
    {notice && <p className="photo-notice" role="status">{notice}</p>}
    {error && <p className="ui-form-error" role="alert">{error}</p>}
    <p className="photo-room">{media.length} de {MAX_PHOTOS_PER_PRODUCT} fotos.</p>
  </div>;
}
