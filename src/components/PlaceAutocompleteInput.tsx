import React, { useEffect, useRef, useState } from 'react';
import { LoaderCircle, MapPin } from 'lucide-react';
import type { FrancePlace } from '../types';
import { suggestFrenchPlaces } from '../services/vanSpots';
import { CompactFormTextInput } from './CompactFormLayout';

type PlaceAutocompleteInputProps = {
  value: string;
  onChange: (value: string) => void;
  onSelectPlace?: (place: FrancePlace) => void;
  tone?: 'hero' | 'light';
  placeholder?: string;
  required?: boolean;
  className?: string;
};

export function PlaceAutocompleteInput({
  value,
  onChange,
  onSelectPlace,
  tone = 'light',
  placeholder = 'Ville, spot, adresse…',
  required,
  className = '',
}: PlaceAutocompleteInputProps) {
  const [suggestions, setSuggestions] = useState<FrancePlace[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [open, setOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const skipNextFetchRef = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (skipNextFetchRef.current) {
      skipNextFetchRef.current = false;
      return;
    }

    const trimmed = value.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    const timer = window.setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setSuggesting(true);

      try {
        const places = await suggestFrenchPlaces(trimmed, controller.signal);
        if (abortRef.current !== controller) return;
        setSuggestions(places);
        setOpen(places.length > 0);
      } catch (err) {
        if ((err as DOMException)?.name !== 'AbortError') {
          setSuggestions([]);
          setOpen(false);
        }
      } finally {
        if (abortRef.current === controller) setSuggesting(false);
      }
    }, 280);

    return () => window.clearTimeout(timer);
  }, [value]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const pickPlace = (place: FrancePlace) => {
    skipNextFetchRef.current = true;
    onChange(place.name);
    onSelectPlace?.(place);
    setSuggestions([]);
    setOpen(false);
  };

  const listClass =
    tone === 'hero'
      ? 'border-white/15 bg-[#fffdf8] text-[#17352b] shadow-[0_12px_32px_rgba(23,53,43,0.22)]'
      : 'border-[#17352b]/10 bg-white text-[#17352b] shadow-2xl';

  return (
    <div ref={rootRef} className="space-y-1">
      <CompactFormTextInput
        tone={tone}
        required={required}
        placeholder={placeholder}
        value={value}
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value);
          if (e.target.value.trim().length >= 2) setOpen(true);
        }}
        onFocus={() => {
          if (suggestions.length) setOpen(true);
        }}
        onBlur={() => {
          window.setTimeout(() => setOpen(false), 160);
        }}
        className={className}
      />

      {open && (suggestions.length > 0 || suggesting) && (
        <div
          className={`overflow-hidden rounded-xl border ${listClass}`}
          role="listbox"
          aria-label="Suggestions de villes"
        >
          <div className="flex items-center justify-between px-2.5 py-1.5">
            <span className="text-[8px] font-extrabold uppercase tracking-wider text-[#68756d]">
              Communes
            </span>
            {suggesting && <LoaderCircle className="h-3 w-3 animate-spin text-[#eb6c32]" />}
          </div>
          <div className="max-h-40 overflow-y-auto px-1 pb-1">
            {suggestions.map((place) => (
              <button
                key={place.id}
                type="button"
                role="option"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pickPlace(place)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-[#f5f1e7]"
              >
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700">
                  <MapPin className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-[11px] font-bold">
                    {place.name}
                    {place.postalCode ? ` (${place.postalCode})` : ''}
                  </strong>
                  <small className="block truncate text-[9px] font-semibold text-[#68756d]">
                    {place.department}
                    {place.region ? ` · ${place.region}` : ''}
                  </small>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
