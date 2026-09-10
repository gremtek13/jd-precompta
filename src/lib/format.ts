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
