import React from 'react';
import { X } from 'lucide-react';
import { ModalShell } from './ModalShell';

export interface SimpleFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  titleId?: string;
  onSubmit?: (e: React.FormEvent) => void;
  footer: React.ReactNode;
  children: React.ReactNode;
  maxWidth?: 'sm' | 'md';
}

export function SimpleFormModal({
  isOpen,
  onClose,
  title,
  subtitle,
  icon,
  titleId,
  onSubmit,
  footer,
  children,
  maxWidth = 'md',
}: SimpleFormModalProps) {
  const content = (
    <>
      <div className="shrink-0 border-b border-[#17352b]/8 px-4 pb-3 pt-4 sm:px-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {icon && (
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#17352b] text-white">
                {icon}
              </div>
            )}
            <div className="min-w-0">
              <h3
                id={titleId}
                className="truncate font-extrabold text-sm leading-tight text-[#17352b]"
              >
                {title}
              </h3>
              {subtitle && (
                <p className="mt-0.5 text-[10px] font-medium text-[#68756d]">{subtitle}</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="touch-target flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#68756d] hover:bg-[#17352b]/5"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {onSubmit ? (
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 sm:px-5">
            {children}
          </div>
          <div className="shrink-0 border-t border-[#17352b]/8 bg-[#fffdf8] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
            {footer}
          </div>
        </form>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 sm:px-5">
            {children}
          </div>
          <div className="shrink-0 border-t border-[#17352b]/8 bg-[#fffdf8] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
            {footer}
          </div>
        </>
      )}
    </>
  );

  return (
    <ModalShell isOpen={isOpen} onClose={onClose} titleId={titleId} maxWidth={maxWidth}>
      {content}
    </ModalShell>
  );
}
