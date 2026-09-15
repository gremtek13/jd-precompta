export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9.]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
}

// Clé de correspondance tiers → catégorie : insensible à la casse/aux espaces pour que
// "EDF", "edf" ou " EDF " retrouvent la même catégorie apprise.
export function normalizeTiers(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function formatMoney(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—'
  return value.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
}

export function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('fr-FR')
}

// Année, mois (1-12) et jour d'une date, lus sur le calendrier civil.
//
// `new Date('2026-01-01').getFullYear()` ne rend 2026 qu'à l'est de Greenwich : la chaîne est
// interprétée comme minuit UTC, donc replacée en heure locale elle recule d'un jour dès que le
// décalage est négatif — à New York, ce 1er janvier se lit 31 décembre 2025. Tant que les
// utilisateurs sont en France le résultat est juste par chance, pas par construction ; ces
// fonctions lisent directement les composantes de la chaîne et ne dépendent d'aucun fuseau.
//
// À n'utiliser que sur une date SQL (AAAA-MM-JJ) ou un horodatage ISO : pour un instant précis
// (`created_at`), c'est bien la date UTC portée par la chaîne qui est lue, ce qui reste le repère
// stable attendu pour classer par exercice.
export function anneeDe(date: string): number {
  return Number(date.slice(0, 4))
}

export function moisDe(date: string): number {
  return Number(date.slice(5, 7))
}

export function jourDe(date: string): number {
  return Number(date.slice(8, 10))
}

// Nombre de mois de l'année en cours déjà entièrement terminés (0 en janvier, 8 en septembre...) —
// sert à ne jamais réclamer un relevé bancaire ou une échéance pour le mois en cours, qui vient
// peut-être de commencer (voir DossiersList, ChecklistTab). Avant ce correctif, le mois en cours
// comptait comme "écoulé" dès son premier jour — le 8 septembre signalait déjà septembre comme
// manquant alors que le mois n'était même pas fini.
export function moisEcoulesCetteAnnee(): number {
  return new Date().getMonth()
}

// Ancienneté en langage courant ("il y a 2 h", "hier") pour les fils d'activité des tableaux de bord
// (voir DossiersList, ClientHome) — au-delà d'une semaine la date exacte redevient plus parlante
// qu'un décompte de jours.
export function dateRelative(iso: string): string {
  const heures = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000)
  if (heures < 1) return "à l'instant"
  if (heures < 24) return `il y a ${heures} h`
  const jours = Math.floor(heures / 24)
  if (jours === 1) return 'hier'
  if (jours < 7) return `il y a ${jours} j`
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

// Date SQL (AAAA-MM-JJ) d'aujourd'hui vue par l'utilisateur. `new Date().toISOString()` donnerait la
// veille entre minuit et 2 h du matin à Paris (l'instant est alors encore hier en UTC) — de quoi
// dater une facture de la veille pour qui la saisit tard le soir.
export function aujourdHuiSql(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Dernier jour du mois auquel appartient `dateSql`.
export function dernierJourDuMois(dateSql: string): string {
  const [annee, mois] = dateSql.slice(0, 10).split('-').map(Number)
  const jour = new Date(Date.UTC(annee, mois, 0)).getUTCDate()
  return `${dateSql.slice(0, 7)}-${String(jour).padStart(2, '0')}`
}

// Date SQL (AAAA-MM-JJ) du 1er du mois en cours, construite depuis les composantes locales — la
// seule façon sûre de nommer "le mois courant" : passer par `new Date(a, m, 1).toISOString()`
// renverrait le mois précédent dès que le fuseau local est à l'est de Greenwich (le 1er septembre à
// minuit à Paris, c'est le 31 août 22 h en UTC).
export function premierJourDuMoisCourant(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

// Ajoute `n` mois (négatif accepté) à une date SQL en restant dans le calendrier civil, sans jamais
// repasser par un objet Date converti en UTC — deux pièges évités d'un coup :
//   - le décalage de fuseau/heure d'été : `new Date('2026-01-15')` puis `setMonth(+6)` puis
//     `toISOString()` rend le 14 juillet, pas le 15, parce que Paris passe de UTC+1 à UTC+2 ;
//   - le débordement de fin de mois : `setMonth()` transforme le 31 janvier + 1 mois en 3 mars.
// Un jour absent du mois d'arrivée est ramené au dernier jour de ce mois, convention des
// échéanciers de prêt : une mensualité au 31 janvier tombe le 28 février.
export function ajouterMois(dateSql: string, n: number): string {
  const [annee, mois, jour] = dateSql.slice(0, 10).split('-').map(Number)
  const indexMois = mois - 1 + n
  const anneeCible = annee + Math.floor(indexMois / 12)
  const moisCible = ((indexMois % 12) + 12) % 12
  // Jour 0 du mois suivant = dernier jour du mois visé. En UTC, donc insensible au fuseau local.
  const dernierJour = new Date(Date.UTC(anneeCible, moisCible + 1, 0)).getUTCDate()
  const jourCible = Math.min(jour, dernierJour)
  return `${anneeCible}-${String(moisCible + 1).padStart(2, '0')}-${String(jourCible).padStart(2, '0')}`
}

// Nombre de dépôts par mois sur les `nbMois` derniers mois (le dernier = mois en cours), dans l'ordre
// chronologique — alimente les tendances des tuiles chiffrées.
export function comptesParMois(datesIso: string[], nbMois: number): number[] {
  const maintenant = new Date()
  const cles = Array.from({ length: nbMois }, (_, i) => {
    const d = new Date(maintenant.getFullYear(), maintenant.getMonth() - (nbMois - 1 - i), 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const compteurs = new Map(cles.map((c) => [c, 0]))
  for (const iso of datesIso) {
    const cle = iso.slice(0, 7)
    const actuel = compteurs.get(cle)
    if (actuel !== undefined) compteurs.set(cle, actuel + 1)
  }
  return cles.map((c) => compteurs.get(c) ?? 0)
}

export const CATEGORIE_LABELS: Record<string, string> = {
  achat: 'Achat',
  vente: 'Vente',
  note_frais: 'Note de frais',
  autre: 'Autre',
}
