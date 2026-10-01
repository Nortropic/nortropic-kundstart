// Kundens samtycke vid inlämning. Klientsäker modul (inga node-importer): samma text visas i granskningen och
// kontrolleras ordagrant på servern. Ändras texten får den en ny version, så att äldre inlämningar förblir läsbara.
export const SAMTYCKE = {
  version: 'samtycke/1',
  text: 'Jag har läst igenom min intervju och vill lämna den vidare till Nortropic.',
} as const;
