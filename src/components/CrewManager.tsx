import React, { useRef, useState } from 'react';
import { UserPlus, X, Camera } from 'lucide-react';
import { Friend } from '../types';

interface CrewManagerProps {
  isOpen: boolean;
  onClose: () => void;
  onAddFriend: (newFriend: Omit<Friend, 'id'>) => void;
}

const PRESET_AVATARS = [
  'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150&auto=format&fit=crop&q=80'
];

const PRESET_COLORS = ['#059669', '#0284c7', '#d97706', '#ec4899', '#7c3aed', '#dc2626'];

async function fileToAvatarDataUrl(file: File, maxSize = 256): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Image illisible'));
      img.src = objectUrl;
    });

    const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas indisponible');
    ctx.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.86);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export const CrewManager: React.FC<CrewManagerProps> = ({ isOpen, onClose, onAddFriend }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [role, setRole] = useState('Copain de voyage 🚐');
  const [avatar, setAvatar] = useState(PRESET_AVATARS[0]);
  const [customAvatar, setCustomAvatar] = useState<string | null>(null);
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [uploadError, setUploadError] = useState('');

  if (!isOpen) return null;

  const resetForm = () => {
    setName('');
    setRole('Copain de voyage 🚐');
    setAvatar(PRESET_AVATARS[0]);
    setCustomAvatar(null);
    setColor(PRESET_COLORS[0]);
    setUploadError('');
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    onAddFriend({
      name: name.trim(),
      role: role.trim(),
      avatar,
      color,
      battery: 100,
      lastActive: 'À l\'instant',
    });

    resetForm();
    onClose();
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setUploadError('Choisis une image (JPG, PNG, HEIC…).');
      return;
    }

    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      setCustomAvatar(dataUrl);
      setAvatar(dataUrl);
      setUploadError('');
    } catch {
      setUploadError('Impossible de lire cette photo.');
    }
  };

  const avatarClass = (selected: boolean) =>
    `w-9 h-9 rounded-full object-cover cursor-pointer border-2 transition-transform ${
      selected
        ? 'border-emerald-600 scale-110 shadow-md ring-2 ring-emerald-200'
        : 'border-transparent opacity-70 hover:opacity-100'
    }`;

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-[2rem] p-6 shadow-2xl border border-zinc-200 animate-in fade-in zoom-in-95 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-zinc-100">
          <h3 className="min-w-0 flex-1 font-extrabold text-sm text-zinc-900 leading-snug flex items-center gap-1.5">
            <UserPlus className="w-4 h-4 text-emerald-600 shrink-0" /> Ajouter un Copain au Van
          </h3>
          <button type="button" onClick={handleClose} className="touch-target flex items-center justify-center rounded-full text-zinc-400 hover:text-zinc-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label className="block text-xs font-bold text-zinc-700 mb-1">Prénom / Surnom *</label>
            <input
              type="text"
              required
              placeholder="ex: Lucas, Marie, Hugo..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-zinc-200 bg-zinc-50 focus:outline-hidden focus:ring-2 focus:ring-zinc-900"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-zinc-700 mb-1">Rôle dans le Van</label>
            <input
              type="text"
              placeholder="ex: DJ, Chef Coq, Copilote..."
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-zinc-200 bg-zinc-50"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-zinc-700 mb-1">Avatar</label>
            <div className="flex flex-wrap items-center gap-2">
              {customAvatar && (
                <img
                  src={customAvatar}
                  alt="Photo importée"
                  onClick={() => setAvatar(customAvatar)}
                  className={avatarClass(avatar === customAvatar)}
                />
              )}
              {PRESET_AVATARS.map((url) => (
                <img
                  key={url}
                  src={url}
                  alt="Avatar option"
                  onClick={() => setAvatar(url)}
                  className={avatarClass(avatar === url)}
                />
              ))}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="Importer une photo"
                className={`w-9 h-9 rounded-full border-2 border-dashed flex items-center justify-center transition-all ${
                  customAvatar && avatar === customAvatar
                    ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                    : 'border-zinc-300 bg-zinc-50 text-zinc-500 hover:border-emerald-500 hover:text-emerald-600'
                }`}
              >
                <Camera className="w-4 h-4" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => void handleAvatarUpload(e)}
              />
            </div>
            {uploadError ? (
              <p className="mt-1.5 text-[10px] font-semibold text-amber-700">{uploadError}</p>
            ) : (
              <p className="mt-1.5 text-[10px] font-medium text-zinc-400">
                Ou importe une photo depuis ton téléphone
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold text-zinc-700 mb-1">Couleur du Badge</label>
            <div className="flex items-center gap-2">
              {PRESET_COLORS.map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => setColor(c)}
                  className={`h-11 w-11 rounded-full transition-transform ${
                    color === c ? 'ring-2 ring-zinc-900 scale-110' : ''
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={handleClose}
              className="px-3.5 py-2 text-xs font-bold text-zinc-600 hover:bg-zinc-100 rounded-xl"
            >
              Annuler
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-bold bg-zinc-900 text-white rounded-xl shadow-xs hover:bg-zinc-800"
            >
              Ajouter l'Équipier
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
