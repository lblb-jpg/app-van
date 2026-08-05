import React, { useEffect, useState } from 'react';
import { User, X } from 'lucide-react';
import {
  CREW_MEMBER_NAMES,
  getStoredDisplayName,
  isCrewMemberName,
  switchToCrewMember,
} from '../services/supabase';
import { toUserFacingError } from '../lib/userFacingError';

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

  if (!isOpen) return null;

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
    <div className="fixed inset-0 z-50 bg-zinc-950/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-[2rem] p-6 shadow-2xl border border-zinc-200 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="font-extrabold text-zinc-900 text-base leading-snug">Bienvenue à bord</h3>
            <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
              Choisis ton profil pour synchroniser le voyage.
            </p>
          </div>
          {allowDismiss && onClose && (
            <button type="button" onClick={onClose} className="touch-target flex items-center justify-center text-zinc-400 hover:text-zinc-700">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <label className="block space-y-1">
            <span className="text-[11px] font-bold text-zinc-600 flex items-center gap-1">
              <User className="w-3.5 h-3.5" /> Utilisateur
            </span>
            <select
              autoFocus
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full text-sm px-3.5 py-3 rounded-xl border border-zinc-200 bg-zinc-50 focus:outline-hidden focus:ring-2 focus:ring-zinc-900"
            >
              {CREW_MEMBER_NAMES.map((memberName) => (
                <option key={memberName} value={memberName}>
                  {memberName}
                </option>
              ))}
            </select>
          </label>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2 leading-relaxed">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !isCrewMemberName(name)}
            className="w-full py-2.5 rounded-xl bg-zinc-900 text-white text-sm font-bold hover:bg-zinc-800 disabled:opacity-60"
          >
            {loading ? 'Connexion…' : 'Entrer dans le van'}
          </button>
        </form>
      </div>
    </div>
  );
};
