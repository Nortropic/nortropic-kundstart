/** Tunna linjeikoner i samma stil som resten av ytan. Dekorativa: knappen eller länken bär alltid texten. */
const VAGAR: Record<string, string> = {
  samtal: 'M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4h0A1.5 1.5 0 0 1 4 14.5z',
  mal: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01',
  verksamhet: 'M3.5 9.5 5 4h14l1.5 5.5M3.5 9.5h17M3.5 9.5a2.8 2.8 0 0 0 5.6 0 2.8 2.8 0 0 0 5.8 0 2.8 2.8 0 0 0 5.6 0M5 12v8h14v-8M10 20v-5h4v5',
  tillval: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM16.5 13v7M13 16.5h7',
  material: 'M20 11.5 12.2 19.3a4.8 4.8 0 0 1-6.8-6.8l7.7-7.7a3.2 3.2 0 0 1 4.5 4.5l-7.4 7.4a1.6 1.6 0 0 1-2.3-2.3l6.8-6.8',
  aterstar: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  plus: 'M12 5v14M5 12h14',
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
