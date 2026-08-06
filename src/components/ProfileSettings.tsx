import React, { useEffect, useRef, useState } from 'react';
import { Camera, Check, LoaderCircle, UserRound } from 'lucide-react';
import type { Friend } from '../types';
import { CREW_MEMBER_NAMES, type CrewMemberName } from '../services/supabase';
import { fileToAvatarDataUrl } from '../lib/crewAvatars';

type ProfileSettingsProps = {
  friend: Friend | undefined;
  activeCrewName?: CrewMemberName;
  cloudReady: boolean;
  saving?: boolean;
  onSave: (patch: { name: string; avatar: string }) => Promise<void>;
  onSwitchCrewMember: (name: CrewMemberName) => void;
};

export function ProfileSettings({
  friend,
  activeCrewName,
  cloudReady,
  saving = false,
  onSave,
  onSwitchCrewMember,
}: ProfileSettingsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!friend) return;
    setName(friend.name);
    setAvatar(friend.avatar);
    setUploadError('');
    setSaveError('');
    setSaved(false);
  }, [friend?.id, friend?.name, friend?.avatar]);

  if (!friend) {
    return (
      <div className="profile-page">
        <div className="profile-page__empty">Aucun profil sélectionné.</div>
      </div>
    );
  }

  const dirty = name.trim() !== friend.name.trim() || avatar !== friend.avatar;
  const canSave = Boolean(name.trim()) && dirty && !saving;

  const handlePickPhoto = async (file: File) => {
    setUploadError('');
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      setAvatar(dataUrl);
      setSaved(false);
    } catch {
      setUploadError('Impossible de lire cette image.');
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    setSaved(false);
    setSaveError('');
    try {
      await onSave({ name: name.trim(), avatar });
      setSaved(true);
    } catch (err) {
      const message =
        err instanceof Error && err.message.trim()
          ? err.message
          : 'Impossible d’enregistrer le profil.';
      setSaveError(message);
    }
  };

  return (
    <div className="profile-page">
      <div className="profile-page__hero">
        <p className="profile-page__kicker">Mon espace</p>
        <h2 className="profile-page__title">Profil</h2>
        <p className="profile-page__subtitle">
          {cloudReady
            ? 'Modifie ton prénom et ta photo — visible par l’équipage.'
            : 'Mode local : tes changements restent sur cet appareil.'}
        </p>
      </div>

      <form onSubmit={(event) => void handleSubmit(event)} className="profile-page__card">
        <div className="profile-page__avatar-wrap">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="profile-page__avatar-btn"
            style={{ borderColor: friend.color }}
            aria-label="Changer la photo de profil"
          >
            <img src={avatar || friend.avatar} alt="" className="profile-page__avatar" />
            <span className="profile-page__avatar-overlay">
              <Camera className="h-4 w-4" />
            </span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handlePickPhoto(file);
              event.target.value = '';
            }}
          />
          <div className="profile-page__avatar-meta">
            <strong>{name.trim() || friend.name}</strong>
            {friend.role && <span>{friend.role}</span>}
          </div>
        </div>

        {uploadError && <p className="profile-page__error">{uploadError}</p>}
        {saveError && <p className="profile-page__error">{saveError}</p>}

        <label className="profile-page__field">
          <span>Prénom affiché</span>
          <input
            type="text"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setSaved(false);
            }}
            placeholder="Ton prénom"
            maxLength={32}
            autoComplete="name"
          />
        </label>

        <button type="submit" disabled={!canSave} className="profile-page__save">
          {saving ? (
            <>
              <LoaderCircle className="h-4 w-4 animate-spin" />
              Enregistrement…
            </>
          ) : saved && !dirty ? (
            <>
              <Check className="h-4 w-4" />
              Profil enregistré
            </>
          ) : (
            'Enregistrer le profil'
          )}
        </button>
      </form>

      <section className="profile-page__card profile-page__card--switch">
        <div className="profile-page__switch-head">
          <UserRound className="h-4 w-4" />
          <div>
            <strong>Changer de compte</strong>
            <p>Chaque personne modifie son profil dans son espace.</p>
          </div>
        </div>
        <div className="profile-page__crew-row">
          {CREW_MEMBER_NAMES.map((crewName) => {
            const selected = activeCrewName === crewName;
            return (
              <button
                key={crewName}
                type="button"
                onClick={() => onSwitchCrewMember(crewName)}
                className={`profile-page__crew-btn ${selected ? 'is-active' : ''}`}
              >
                {crewName}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
