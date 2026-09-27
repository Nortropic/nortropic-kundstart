const TEXTER: Record<string, { rubrik: string; text: string }> = {
  ogiltig: { rubrik: 'Länken känns inte igen', text: 'Kontrollera att hela länken kom med. Annars ber ni er kontakt hos Nortropic om en ny.' },
  utgangen: { rubrik: 'Länken har gått ut', text: 'Er personliga länk gällde en begränsad tid. Be er kontakt hos Nortropic om en ny länk; det ni redan svarat finns kvar.' },
  aterkallad: { rubrik: 'Länken har stängts', text: 'Den här länken är inte längre aktiv. Har ni fått en ny länk använder ni den; annars hör ni av er till er kontakt.' },
  session: { rubrik: 'Ni behöver öppna länken igen', text: 'Vi hittar ingen aktiv session i den här webbläsaren. Öppna er personliga länk så fortsätter ni där ni var, även på en annan enhet.' },
};

export default async function Lank({ searchParams }: { searchParams: Promise<{ skal?: string }> }) {
  const { skal } = await searchParams;
  const t = TEXTER[skal || ''] || TEXTER.ogiltig;
  return (
    <main className="ram">
      <header className="huvud">
        <span className="ord">Nortropic<small>Digitala</small></span>
      </header>
      <h1>{t.rubrik}</h1>
      <p>{t.text}</p>
    </main>
  );
}
