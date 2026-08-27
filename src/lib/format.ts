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

export const CATEGORIE_LABELS: Record<string, string> = {
  achat: 'Achat',
  vente: 'Vente',
  note_frais: 'Note de frais',
  autre: 'Autre',
}
