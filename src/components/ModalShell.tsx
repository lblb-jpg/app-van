import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

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
  useEffect(() => {
    if (!isOpen) return;

    const html = document.documentElement;
    const prevOverflow = html.style.overflow;
    html.style.overflow = 'hidden';

    return () => {
      html.style.overflow = prevOverflow;
    };
  }, [isOpen]);

  if (!isOpen || typeof document === 'undefined') return null;

  const maxW = maxWidth === 'sm' ? 'max-w-sm' : 'max-w-md';

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center overscroll-none bg-[#17352b]/40 p-4 backdrop-blur-sm pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]"
      onClick={onClose}
    >
      <div
        className={`flex w-full ${maxW} max-h-[min(88dvh,calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-2rem))] flex-col overflow-hidden rounded-[1.5rem] border border-[#17352b]/10 bg-[#fffdf8] shadow-[0_24px_60px_rgba(23,53,43,0.18)] animate-in fade-in zoom-in-95 duration-200 sm:rounded-[1.75rem] ${sheetClassName}`}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
