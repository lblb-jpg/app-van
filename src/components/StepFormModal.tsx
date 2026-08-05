import React from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, ChevronRight, Check } from 'lucide-react';

export type StepDef = {
  id: number;
  label: string;
  hint: string;
};

export interface StepFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  iconBgClassName?: string;
  steps: readonly StepDef[];
  currentStep: number;
  onStepClick?: (step: number) => void;
  canAdvanceFromStep: (step: number) => boolean;
  onNext: () => void;
  onPrevious: () => void;
  onSubmit: (e: React.FormEvent) => void;
  submitLabel: string;
  error?: string;
  children: React.ReactNode;
  titleId?: string;
  usePortal?: boolean;
  sheetClassName?: string;
}

export function StepFormModal({
  isOpen,
  onClose,
  title,
  subtitle,
  icon,
  iconBgClassName = 'bg-[#17352b]',
  steps,
  currentStep,
  onStepClick,
  canAdvanceFromStep,
  onNext,
  onPrevious,
  onSubmit,
  submitLabel,
  error,
  children,
  titleId,
  usePortal = true,
  sheetClassName = 'bg-[#fffdf8]',
}: StepFormModalProps) {
  if (!isOpen) return null;

  const modal = (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center overscroll-none bg-[#17352b]/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className={`flex w-full max-w-md max-h-[92dvh] flex-col overflow-hidden rounded-t-[1.75rem] border border-[#17352b]/10 shadow-2xl animate-in fade-in slide-in-from-bottom-4 sm:rounded-[2rem] sm:zoom-in-95 ${sheetClassName}`}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-[#17352b]/15 sm:hidden" />

        {/* Header fixe */}
        <div className="shrink-0 border-b border-[#17352b]/8 px-5 pb-4 pt-4 sm:px-6 sm:pt-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div
                className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-white shadow-md ${iconBgClassName}`}
              >
                {icon}
              </div>
              <div className="min-w-0">
                <h3
                  id={titleId}
                  className="truncate font-extrabold text-base leading-tight text-[#17352b]"
                >
                  {title}
                </h3>
                <p className="mt-0.5 text-[11px] font-medium text-[#68756d]">
                  Étape {currentStep}/{steps.length} · {steps[currentStep - 1]?.hint}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="touch-target flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#68756d] hover:bg-[#17352b]/5"
              aria-label="Fermer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Indicateur d'étapes */}
          <div className={`mt-4 grid gap-2 ${steps.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
            {steps.map((step) => {
              const isDone = currentStep > step.id;
              const isCurrent = currentStep === step.id;
              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => {
                    if (step.id < currentStep) onStepClick?.(step.id);
                  }}
                  disabled={step.id > currentStep}
                  className={`rounded-2xl px-2 py-2 text-left transition-all ${
                    isCurrent
                      ? 'bg-[#17352b] text-white shadow-sm'
                      : isDone
                        ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200'
                        : 'bg-[#f5f1e7] text-[#68756d]'
                  } ${step.id < currentStep ? 'cursor-pointer hover:bg-emerald-100/80' : 'cursor-default'}`}
                >
                  <span className="flex items-center gap-1.5">
                    <span
                      className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-black ${
                        isCurrent
                          ? 'bg-[#eb6c32] text-white'
                          : isDone
                            ? 'bg-emerald-500 text-white'
                            : 'bg-[#17352b]/10 text-[#68756d]'
                      }`}
                    >
                      {isDone ? <Check className="h-3 w-3" /> : step.id}
                    </span>
                    <span className="min-w-0 truncate text-[10px] font-extrabold uppercase tracking-wide">
                      {step.label}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#17352b]/8">
            <div
              className="h-full rounded-full bg-[#eb6c32] transition-all duration-300"
              style={{ width: `${(currentStep / steps.length) * 100}%` }}
            />
          </div>
        </div>

        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 sm:px-6">
            {children}
            {error && (
              <p className="mt-4 text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                {error}
              </p>
            )}
          </div>

          {/* Footer fixe */}
          <div className="shrink-0 border-t border-[#17352b]/8 bg-[#fffdf8]/95 px-5 py-4 backdrop-blur-sm sm:px-6">
            <div className="flex items-center gap-2">
              {currentStep > 1 ? (
                <button
                  type="button"
                  onClick={onPrevious}
                  className="flex min-h-11 items-center justify-center gap-1 rounded-2xl px-3.5 text-xs font-bold text-[#68756d] hover:bg-[#17352b]/5"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Retour
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onClose}
                  className="min-h-11 rounded-2xl px-3.5 text-xs font-bold text-[#68756d] hover:bg-[#17352b]/5"
                >
                  Annuler
                </button>
              )}

              {currentStep < steps.length ? (
                <button
                  type="button"
                  disabled={!canAdvanceFromStep(currentStep)}
                  onClick={onNext}
                  className="ml-auto flex min-h-11 flex-1 items-center justify-center gap-1 rounded-2xl bg-[#17352b] px-4 text-xs font-extrabold text-white shadow-sm transition-all hover:bg-[#285849] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Continuer
                  <ChevronRight className="h-4 w-4" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!canAdvanceFromStep(1)}
                  className="ml-auto flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-2xl bg-[#eb6c32] px-4 text-xs font-extrabold text-white shadow-[0_8px_20px_rgba(235,108,50,.28)] transition-all hover:bg-[#d95d29] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Check className="h-4 w-4" />
                  {submitLabel}
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );

  if (usePortal && typeof document !== 'undefined') {
    return createPortal(modal, document.body);
  }
  return modal;
}
