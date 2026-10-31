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

// ── LE FEC D'UN BNC EN TRÉSORERIE, À VINGT-DEUX CHAMPS (lot FEC22c) ──────────────────────────────────────────────────────
//
// L'en-tête du VIII, 7° de l'article A47 A-1, écrit ici en toutes lettres plutôt qu'importé de lib/fec.ts : l'oracle ne
// répète pas ce qu'il juge.
export const ENTETES_BNC_ATTENDUS = [
  'JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib', 'PieceRef',
  'PieceDate', 'EcritureLib', 'Debit', 'Credit', 'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise',
  'DateRglt', 'ModeRglt', 'NatOp', 'IdClient',
]

// Une date du calendrier, AAAAMMJJ, l'année dans 1900–2099 (Test Compta Demat, `trt_txt.pl` : une colonne de date
// remplie doit être une date ; hors de ces années, un avertissement).
function dateDuCalendrier(v: string): boolean {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(v)
  if (!m) return false
  const [a, mo, j] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const d = new Date(Date.UTC(a, mo - 1, j))
  return a >= 1900 && a <= 2099 && d.getUTCFullYear() === a && d.getUTCMonth() === mo - 1 && d.getUTCDate() === j
}

/**
 * LA STRUCTURE QUE L'OUTIL DE LA DGFiP ÉPROUVE dans la catégorie « BNC trésorerie » : l'en-tête des vingt-deux noms, dans
 * l'ordre ; chaque ligne à autant de champs que l'en-tête, vides de fin compris (sinon « La structure du fichier est
 * incorrecte ») ; DateRglt vide ou une date du calendrier.
 */
export function structureBncDgfip(fec: string): string[] {
  const [entete, ...lignes] = colonnes(fec)
  const fautes: string[] = []
  if (JSON.stringify(entete) !== JSON.stringify(ENTETES_BNC_ATTENDUS)) fautes.push(`en-tête : ${entete.join(' ')}`)
  lignes.forEach((r, i) => {
    if (r.length !== ENTETES_BNC_ATTENDUS.length) fautes.push(`ligne ${i + 1} : ${r.length} champs`)
    else if (r[18] !== '' && !dateDuCalendrier(r[18])) fautes.push(`ligne ${i + 1} : DateRglt « ${r[18]} »`)
  })
  return fautes
}

/**
 * CE QUE LA CONCEPTION EXIGE DES QUATRE CHAMPS, relu sur le fichier IMPRIMÉ (« CE QUI EST DÉCIDÉ », 3° et 5° ; FEC22-Q3 et
 * Q4) : DateRglt, ModeRglt et IdClient constants par EcritureNum, et la NATURE aussi — NatOp peut porter, après le tiret,
 * un poste par ligne ; DateRglt et ModeRglt remplis sur toute écriture qui est un règlement — qui touche la banque (512),
 * les valeurs à l'encaissement (511) ou la caisse (53), hors des à-nouveaux, qui reprennent des soldes —, et l'un l'est
 * quand l'autre l'est ; IdClient vide, ou l'un des identifiants du jeu — le numéro d'une facture, un SIREN figé.
 */
export function anomaliesBnc(fec: string, identifiants: ReadonlySet<string>): string[] {
  const parEcriture = new Map<string, string[][]>()
  for (const r of colonnes(fec).slice(1)) parEcriture.set(r[2], [...(parEcriture.get(r[2]) ?? []), r])
  const fautes: string[] = []
  const nature = (natOp: string) => natOp.split(' — ')[0]
  for (const [num, rows] of parEcriture) {
    const distincts = (lire: (r: string[]) => string) => new Set(rows.map(lire)).size
    if (distincts((r) => r[18]) !== 1) fautes.push(`${num} : différentes dates de règlement`)
    if (distincts((r) => r[19]) !== 1) fautes.push(`${num} : différents modes de règlement`)
    if (distincts((r) => nature(r[20])) !== 1) fautes.push(`${num} : différentes natures`)
    if (distincts((r) => r[21]) !== 1) fautes.push(`${num} : différents clients`)
    const [d, m, , id] = rows[0].slice(18)
    if (rows[0][0] !== 'AN' && rows.some((r) => /^(512|511|53)/.test(r[4])) && (d === '' || m === '')) {
      fautes.push(`${num} : un règlement sans date ou sans mode`)
    }
    if ((d === '') !== (m === '')) fautes.push(`${num} : une date de règlement sans mode, ou l'inverse`)
    if (rows.some((r) => r[20] === '')) fautes.push(`${num} : une ligne sans nature`)
    if (id !== '' && !identifiants.has(id)) fautes.push(`${num} : IdClient « ${id} » n'est ni un numéro de facture ni un SIREN du jeu`)
  }
  return fautes
}
