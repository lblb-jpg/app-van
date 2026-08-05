import React from 'react';
import { X, ChevronLeft, ChevronRight, Check } from 'lucide-react';
import { ModalShell } from './ModalShell';

export type StepDef = {
  id: number;
  label: string;
  hint: string;
};

export interface StepFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
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
}: StepFormModalProps) {
  const currentHint = steps[currentStep - 1]?.hint;

  return (
    <ModalShell isOpen={isOpen} onClose={onClose} titleId={titleId}>
      <div className="shrink-0 border-b border-[#17352b]/8 px-5 pb-4 pt-5 sm:px-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {icon && (
              <div
                className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white ${iconBgClassName}`}
              >
                {icon}
              </div>
            )}
            <div className="min-w-0">
              <h3
                id={titleId}
                className="truncate font-extrabold text-base leading-tight text-[#17352b]"
              >
                {title}
              </h3>
              <p className="mt-0.5 text-[11px] font-medium text-[#68756d]">
                {steps.length > 1
                  ? `Étape ${currentStep}/${steps.length}${currentHint ? ` · ${currentHint}` : ''}`
                  : subtitle || currentHint}
              </p>
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

        {steps.length > 1 && (
          <div className="mt-4">
            <div className="mb-2 flex gap-1">
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
                    className={`flex-1 truncate rounded-lg py-1.5 text-center text-[10px] font-bold uppercase tracking-wide transition-colors ${
                      isCurrent
                        ? 'bg-[#17352b] text-white'
                        : isDone
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'text-[#68756d]/40'
                    } ${step.id < currentStep ? 'cursor-pointer hover:bg-emerald-100/60' : 'cursor-default'}`}
                  >
                    {step.label}
                  </button>
                );
              })}
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-[#17352b]/8">
              <div
                className="h-full rounded-full bg-[#eb6c32] transition-all duration-300"
                style={{ width: `${(currentStep / steps.length) * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>

      <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 sm:px-6">
          {children}
          {error && (
            <p className="mt-4 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800">
              {error}
            </p>
          )}
        </div>

        <div className="shrink-0 border-t border-[#17352b]/8 bg-[#fffdf8] px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
          <div className="flex items-center gap-2">
            {currentStep > 1 ? (
              <button
                type="button"
                onClick={onPrevious}
                className="flex min-h-11 items-center justify-center gap-1 rounded-xl px-3.5 text-xs font-bold text-[#68756d] hover:bg-[#17352b]/5"
              >
                <ChevronLeft className="h-4 w-4" />
                Retour
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="min-h-11 rounded-xl px-3.5 text-xs font-bold text-[#68756d] hover:bg-[#17352b]/5"
              >
                Annuler
              </button>
            )}

            {currentStep < steps.length ? (
              <button
                type="button"
                disabled={!canAdvanceFromStep(currentStep)}
                onClick={onNext}
                className="ml-auto flex min-h-11 flex-1 items-center justify-center gap-1 rounded-xl bg-[#17352b] px-4 text-xs font-extrabold text-white transition-all hover:bg-[#285849] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Continuer
                <ChevronRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!canAdvanceFromStep(1)}
                className="ml-auto flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#eb6c32] px-4 text-xs font-extrabold text-white shadow-[0_6px_16px_rgba(235,108,50,.25)] transition-all hover:bg-[#d95d29] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Check className="h-4 w-4" />
                {submitLabel}
              </button>
            )}
          </div>
        </div>
      </form>
    </ModalShell>
  );
}
