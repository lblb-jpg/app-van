import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useHistoryBack } from '../lib/historyBack';

export interface ModalShellProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  titleId?: string;
  maxWidth?: 'sm' | 'md';
  sheetClassName?: string;
}

export function ModalShell({
  isOpen,
  onClose,
  children,
  titleId,
  maxWidth = 'md',
  sheetClassName = '',
}: ModalShellProps) {
  useHistoryBack(isOpen, onClose);

  useEffect(() => {
    if (!isOpen) return;

    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';

    return () => {
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
    };
  }, [isOpen]);

  if (!isOpen || typeof document === 'undefined') return null;

  const maxW = maxWidth === 'sm' ? 'max-w-sm' : 'max-w-md';

  return createPortal(
    <div className="van-modal-root fixed inset-0 z-[200] overscroll-none" onClick={onClose}>
      {/* Full-bleed backdrop — no padding so blur covers safe areas / home indicator */}
      <div aria-hidden className="van-modal-backdrop" />
      <div className="relative flex h-full min-h-[100dvh] w-full items-center justify-center p-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,calc(env(safe-area-inset-bottom)+0.25rem))]">
        <div
          className={`flex w-full ${maxW} max-h-[min(88dvh,calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-1.5rem))] flex-col overflow-hidden rounded-[1.35rem] border border-[#17352b]/10 bg-[#fffdf8] shadow-[0_24px_60px_rgba(23,53,43,0.18)] animate-in fade-in zoom-in-95 duration-200 sm:rounded-[1.75rem] ${sheetClassName}`}
          onClick={(event) => event.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
