/** Tunna linjeikoner i samma stil som resten av ytan. Dekorativa: knappen eller länken bär alltid texten. */
const VAGAR: Record<string, string> = {
  klocka: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  hand: 'M8 12V5.5a1.5 1.5 0 0 1 3 0V11M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6a1.5 1.5 0 0 1 3 0v6.5M17 12.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.5a6 6 0 0 1-5-2.7L5 14.3a1.5 1.5 0 0 1 2.5-1.7L8 13.5',
  bock: 'M5 12.5l4.5 4.5L19 7.5',
  upp: 'M12 19V5M6 11l6-6 6 6',
  ner: 'M6 9l6 6 6-6',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01',
};

export function Ikon({ namn, storlek = 18 }: { namn: keyof typeof VAGAR | string; storlek?: number }) {
  return (
    <svg className="ikon" width={storlek} height={storlek} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={VAGAR[namn] || ''} />
    </svg>
  );
}

/** Nortropics märke: en nordpil. */
export function Marke({ storlek = 30 }: { storlek?: number }) {
  return (
    <svg className="marke" width={storlek} height={storlek} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path d="M16 3 26 27 16 21.5 6 27z" fill="currentColor" />
      <path d="M16 3v18.5" stroke="var(--papper)" strokeWidth="1.2" />
    </svg>
  );
}
