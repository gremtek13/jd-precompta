// L'OUTIL DE LA DGFiP SUR UN FEC IMPRIMÉ (Test Compta Demat, lu et non exécuté : « LE FEC SUIT L'ARTICLE A47 A-1 »,
// HISTORIQUE.md). Sortis de fec.test.ts à l'étape VF4c2 pour que le FEC d'un dossier qui a basculé se juge aux mêmes
// contrôles (ventesFactureesDesExports.test.ts) ; leur texte n'a pas changé.

export const colonnes = (fec: string) => fec.split('\r\n').map((l) => l.split('\t'))
// Relit un montant tel que la norme l'écrit, virgule décimale comprise — `Number('6000,00')` rend NaN.
const lireMontant = (champ: string) => Number(champ.replace(',', '.'))

// L'OUTIL DE LA DGFiP, ÉCRITURE PAR ÉCRITURE (Test Compta Demat, SQL/ECRITURE.sql et SQL/VUES.sql, l'écran des
// vérificateurs) : les lignes d'un même EcritureNum portent un seul journal, une seule date, une seule pièce, une seule
// date de pièce et un seul lettrage — un lettrage vide n'en est pas un, `min(code_lettrage) = max(code_lettrage)`
// ignorant les vides. Relus sur le fichier IMPRIMÉ, comme l'outil les lit.
export function anomaliesDgfip(fec: string): string[] {
  const parEcriture = new Map<string, string[][]>()
  for (const r of colonnes(fec).slice(1)) parEcriture.set(r[2], [...(parEcriture.get(r[2]) ?? []), r])
  const anomalies: string[] = []
  for (const [num, rows] of parEcriture) {
    const distincts = (i: number) => new Set(rows.map((r) => r[i])).size
    if (distincts(0) !== 1) anomalies.push(`${num} : différents codes journaux`)
    if (distincts(3) !== 1) anomalies.push(`${num} : différentes dates comptables`)
    if (distincts(8) !== 1) anomalies.push(`${num} : différents numéros de pièce`)
    if (distincts(9) !== 1) anomalies.push(`${num} : différentes dates pièce`)
    if (new Set(rows.map((r) => r[13]).filter((v) => v !== '')).size > 1) anomalies.push(`${num} : différents lettrages`)
  }
  return anomalies
}

// Le sixième contrôle de l'outil, « Écriture non équilibrée » : en centimes, écriture par écriture.
export function desequilibresDgfip(fec: string): string[] {
  const soldes = new Map<string, number>()
  for (const r of colonnes(fec).slice(1)) {
    soldes.set(r[2], (soldes.get(r[2]) ?? 0) + Math.round(lireMontant(r[11]) * 100) - Math.round(lireMontant(r[12]) * 100))
  }
  return [...soldes].filter(([, s]) => s !== 0).map(([num]) => num)
}
