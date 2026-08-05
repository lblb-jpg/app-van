import React, { useEffect, useState } from 'react';
import { User, X } from 'lucide-react';
import {
  CREW_MEMBER_NAMES,
  getStoredDisplayName,
  isCrewMemberName,
  switchToCrewMember,
} from '../services/supabase';
import { toUserFacingError } from '../lib/userFacingError';
import { ModalShell } from './ModalShell';

interface AuthModalProps {
  isOpen: boolean;
  onAuthenticated: () => void;
  onClose?: () => void;
  allowDismiss?: boolean;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onAuthenticated,
  onClose,
  allowDismiss = false,
}) => {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const storedName = getStoredDisplayName();
      setName(isCrewMemberName(storedName) ? storedName : 'Adel');
      setError('');
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (!isCrewMemberName(name)) throw new Error('Choisis un membre de l’équipage.');
      await switchToCrewMember(name);
      onAuthenticated();
    } catch (err: any) {
      setError(toUserFacingError(err, 'Connexion impossible pour le moment.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalShell isOpen={isOpen} onClose={allowDismiss && onClose ? onClose : () => {}} maxWidth="sm">
      <div className="p-5 sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-extrabold leading-snug text-[#17352b]">Bienvenue à bord</h3>
            <p className="mt-1 text-xs leading-relaxed text-[#68756d]">
              Choisis ton profil pour synchroniser le voyage.
            </p>
          </div>
          {allowDismiss && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="touch-target flex h-9 w-9 items-center justify-center rounded-full text-[#68756d] hover:bg-[#17352b]/5"
              aria-label="Fermer"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <label className="block space-y-1">
            <span className="flex items-center gap-1 text-[11px] font-bold text-[#17352b]">
              <User className="h-3.5 w-3.5" /> Utilisateur
            </span>
            <select
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-[#17352b]/12 bg-[#f5f1e7] px-3.5 py-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-[#17352b]/20"
            >
              {CREW_MEMBER_NAMES.map((memberName) => (
                <option key={memberName} value={memberName}>
                  {memberName}
                </option>
              ))}
            </select>
          </label>

          {error && (
            <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-600">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !isCrewMemberName(name)}
            className="w-full rounded-xl bg-[#17352b] py-2.5 text-sm font-bold text-white hover:bg-[#285849] disabled:opacity-60"
          >
            {loading ? 'Connexion…' : 'Entrer dans le van'}
          </button>
        </form>
      </div>
    </ModalShell>
  );
};
