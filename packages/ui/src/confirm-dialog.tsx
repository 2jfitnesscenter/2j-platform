import React from 'react';
import { Button } from './button.js';
import { cx } from './classnames.js';

export type ConfirmDialogReason = {
  label: string;
  /** When true the confirm button stays disabled until the reason has at least `minLength` characters. */
  required?: boolean;
  minLength?: number;
  placeholder?: string;
  hint?: string;
};

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  /** Plain-language consequence: what will happen and what is kept. */
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** `danger` uses the filled danger button, the only place the design system fills it. */
  tone?: 'danger' | 'default';
  reason?: ConfirmDialogReason;
  /** Blocks confirm, cancel and Escape while the operation runs. */
  busy?: boolean;
  /** Error from the last attempt; announced and kept visible until the user retries. */
  error?: string;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
};

const FOCUSABLE = 'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Confirmation for destructive or consequential actions. Behaviour: role alertdialog, focus starts on Cancel
 * (the safe choice), Tab stays inside, Escape or the backdrop cancels unless `busy`, and focus returns to the
 * element that opened it. Open it from the action's own handler instead of using window.confirm.
 */
export function ConfirmDialog({ open, title, description, confirmLabel, cancelLabel = 'Cancelar', tone = 'danger', reason, busy = false, error, onConfirm, onCancel }: ConfirmDialogProps) {
  const titleId = React.useId();
  const descriptionId = React.useId();
  const reasonId = React.useId();
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  const [text, setText] = React.useState('');
  const busyRef = React.useRef(busy);
  busyRef.current = busy;
  const cancelCallback = React.useRef(onCancel);
  cancelCallback.current = onCancel;

  React.useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setText('');
    cancelRef.current?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, [open]);

  if (!open) return null;

  const minLength = reason?.required ? (reason.minLength ?? 1) : 0;
  const trimmed = text.trim();
  const reasonValid = trimmed.length >= minLength;
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.stopPropagation(); if (!busyRef.current) cancelCallback.current(); return; }
    if (event.key !== 'Tab' || !dialogRef.current) return;
    const items = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  return <div className="ui-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
    <div ref={dialogRef} className={cx('ui-modal', 'ui-confirm')} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} onKeyDown={onKeyDown}>
      <h2 id={titleId} className="ui-modal-title">{title}</h2>
      <div id={descriptionId} className="ui-modal-lead">{description}</div>
      {reason && <label htmlFor={reasonId}>{reason.label}{!reason.required && <span className="ui-confirm-optional"> (opcional)</span>}
        <textarea id={reasonId} rows={3} value={text} placeholder={reason.placeholder} aria-required={reason.required || undefined} aria-describedby={reason.hint ? `${reasonId}-hint` : undefined} disabled={busy} onChange={(event) => setText(event.target.value)} />
        {reason.hint && <small id={`${reasonId}-hint`} className="ui-confirm-hint">{reason.hint}</small>}
      </label>}
      {error && <p className="ui-confirm-error" role="alert">{error}</p>}
      <div className="ui-confirm-actions">
        <Button ref={cancelRef as React.Ref<HTMLButtonElement>} variant="secondary" disabled={busy} onClick={onCancel}>{cancelLabel}</Button>
        <Button variant={tone === 'danger' ? 'danger-solid' : 'primary'} loading={busy} disabled={!reasonValid} onClick={() => onConfirm(trimmed)}>{confirmLabel}</Button>
      </div>
    </div>
  </div>;
}
