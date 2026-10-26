import React from 'react';
import { IconButton, icons } from '@2j/ui';
import { cx } from '@2j/ui';

/**
 * Shared modal behaviour for pages that render in the V2 scope: focus moves in on open and returns to the opener,
 * Tab stays inside, Escape and a click on the scrim close it. Visuals come from @2j/ui (`ui-modal*`).
 */
export function Modal({ titleId, title, description, onClose, closeDisabled = false, wide = false, children }: { titleId: string; title: React.ReactNode; description?: React.ReactNode; onClose: () => void; closeDisabled?: boolean; wide?: boolean; children: React.ReactNode }) {
  const ref = React.useRef<HTMLElement>(null);
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;
  const disabledRef = React.useRef(closeDisabled);
  disabledRef.current = closeDisabled;
  React.useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const focusable = () => [...(ref.current?.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])') ?? [])].filter((item) => !item.hasAttribute('disabled'));
    (ref.current?.querySelector<HTMLElement>('[data-modal-initial-focus]') ?? ref.current?.querySelector<HTMLElement>('input, select, textarea') ?? focusable()[0])?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !disabledRef.current) { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== 'Tab') return;
      const items = focusable();
      const first = items[0], last = items[items.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); if (opener?.isConnected) opener.focus(); };
  }, []);
  return <div className="ui-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !disabledRef.current) closeRef.current(); }}>
    <section ref={ref} className={cx('ui-modal', wide && 'ui-modal--wide')} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <IconButton className="ui-modal-close" icon={icons.X} label="Cerrar diálogo" disabled={closeDisabled} onClick={onClose} />
      <h2 className="ui-modal-title" id={titleId}>{title}</h2>
      {description ? <p className="ui-modal-lead">{description}</p> : null}
      {children}
    </section>
  </div>;
}
