import React from 'react';
import { Icon } from './icon.js';
import { LoaderCircle } from 'lucide-react';
import { CircleAlert, CircleCheck } from './icons.js';
import { cx } from './classnames.js';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export type SaveStateProps = {
  status: SaveStatus;
  savingLabel?: string;
  savedLabel?: string;
  /** Shown when `status` is `error`; errors stay until the next attempt. */
  errorLabel?: string;
  className?: string;
};

/**
 * Visible, announced feedback for saving. The live region is always mounted so a change of status is read out
 * without moving focus; every state carries an icon and text, never color alone.
 */
export function SaveState({ status, savingLabel = 'Guardando…', savedLabel = 'Guardado', errorLabel = 'No se pudo guardar', className }: SaveStateProps) {
  const content = status === 'saving' ? { icon: LoaderCircle, text: savingLabel, spin: true }
    : status === 'saved' ? { icon: CircleCheck, text: savedLabel, spin: false }
    : status === 'error' ? { icon: CircleAlert, text: errorLabel, spin: false }
    : null;
  return <span className={cx('ui-save-state', className)} data-status={status} role={status === 'error' ? 'alert' : 'status'} aria-live={status === 'error' ? 'assertive' : 'polite'}>
    {content && <><Icon icon={content.icon} size={16} {...(content.spin ? { className: 'ui-spin' } : {})} /><span>{content.text}</span></>}
  </span>;
}
