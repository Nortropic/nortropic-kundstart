import Link from 'next/link';

export default function Startsida() {
  return (
    <main className="ram">
      <header className="huvud">
        <span className="ord">Nortropic<small>Digitala</small></span>
      </header>
      <h1>Den här sidan öppnas med er personliga länk</h1>
      <p>
        Kundstart är ett samtal om er webbplats som ni för i er egen takt. Länken har ni fått från er kontakt hos Nortropic.
        Öppna den igen så fortsätter ni där ni var.
      </p>
      <p className="dis liten">
        Har länken slutat fungera? Hör av er till er kontakt så får ni en ny. <Link href="/om">Så behandlar vi uppgifterna</Link>.
      </p>
    </main>
  );
}
