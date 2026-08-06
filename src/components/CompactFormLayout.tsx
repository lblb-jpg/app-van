import React from 'react';
import { CheckCircle2 } from 'lucide-react';

export function CompactFormRoot({ children }: { children: React.ReactNode }) {
  return <div className="space-y-2.5">{children}</div>;
}

export function CompactFormHero({ children }: { children: React.ReactNode }) {
  return <div className="space-y-2 rounded-xl bg-[#17352b] p-3 text-white">{children}</div>;
}

export function CompactFormSection({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-2 rounded-xl border border-[#17352b]/8 bg-[#f5f1e7]/60 p-2.5">
      {children}
    </div>
  );
}

type CompactFormFieldProps = {
  label: string;
  children: React.ReactNode;
  tone?: 'hero' | 'light';
};

export function CompactFormField({ label, children, tone = 'light' }: CompactFormFieldProps) {
  const labelClass =
    tone === 'hero'
      ? 'text-[9px] font-bold uppercase tracking-wider text-white/45'
      : 'text-[9px] font-bold uppercase tracking-wider text-[#68756d]';

  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <div className="mt-0.5">{children}</div>
    </label>
  );
}

const heroInputClass =
  'w-full border-0 border-b border-white/15 bg-transparent pb-1 text-sm font-semibold text-white placeholder:text-white/25 focus:border-emerald-400 focus:outline-hidden';

const lightInputClass =
  'w-full rounded-lg border border-[#17352b]/10 bg-white px-2.5 py-1.5 text-[11px] font-medium text-[#17352b] placeholder:text-[#68756d]/50 focus:border-emerald-500 focus:outline-hidden';

export function CompactFormTextInput({
  tone = 'light',
  className = '',
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { tone?: 'hero' | 'light' }) {
  return (
    <input
      {...props}
      className={`${tone === 'hero' ? heroInputClass : lightInputClass} ${className}`}
    />
  );
}

export function CompactFormTextarea({
  className = '',
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`${lightInputClass} resize-none ${className}`}
    />
  );
}

type CompactFormChipProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
};

export function CompactFormChip({ active, onClick, children, className = '', ...rest }: CompactFormChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      {...rest}
      className={`rounded-lg px-2 py-1 text-[10px] font-semibold transition-colors ${
        active
          ? 'bg-[#17352b] text-white'
          : 'bg-white text-[#68756d] ring-1 ring-[#17352b]/8'
      } ${className}`}
    >
      {children}
    </button>
  );
}

type FormModalFooterProps = {
  onCancel: () => void;
  submitLabel: string;
  canSubmit?: boolean;
  saving?: boolean;
  submitTone?: 'forest' | 'sunset';
};

export function FormModalFooter({
  onCancel,
  submitLabel,
  canSubmit = true,
  saving = false,
  submitTone = 'forest',
}: FormModalFooterProps) {
  const submitClass =
    submitTone === 'sunset'
      ? 'bg-[#eb6c32] shadow-[0_4px_12px_rgba(235,108,50,.22)] hover:bg-[#d95d29]'
      : 'bg-[#17352b] hover:bg-[#285849]';

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onCancel}
        disabled={saving}
        className="min-h-9 rounded-lg px-3 text-[11px] font-bold text-[#68756d] hover:bg-[#17352b]/5 disabled:opacity-40"
      >
        Annuler
      </button>
      <button
        type="submit"
        disabled={!canSubmit || saving}
        className={`ml-auto flex min-h-9 flex-1 items-center justify-center gap-1 rounded-lg px-3 text-[11px] font-extrabold text-white transition-all disabled:cursor-not-allowed disabled:opacity-40 ${submitClass}`}
      >
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
        {saving ? 'Enregistrement…' : submitLabel}
      </button>
    </div>
  );
}
