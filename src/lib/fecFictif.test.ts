import { beforeAll, describe, expect, it, vi } from 'vitest'
import { anomaliesBnc, anomaliesDgfip, colonnes, desequilibresDgfip, ENTETES_BNC_ATTENDUS, structureBncDgfip } from '../test/fecDgfip'
import { ANNEE_DU_FEC_FICTIF, composerLeFecFictif, type FecFictif } from '../test/fecFictif'
import { POSTES_RATTACHES } from './cases2035'
import { MODES_REGLEMENT, NATURES_OPERATION, SEPARATEUR_DU_POSTE, type ChoixChampsBnc } from './champsBncDuFec'

// L'ÉPREUVE DU FICHIER (lot FEC22f, première partie) : le FEC fictif que outils/fec/ écrit, joué ici en mémoire par la même
// composition (src/test/fecFictif.ts), et jugé à la FORME que l'article A47 A-1 du LPF et Test Compta Demat (catégorie
// « BNC trésorerie ») demandent — les contrôles de l'outil de la DGFiP étant ceux, déjà écrits, de src/test/fecDgfip.ts. Ce
// que ces cas gardent : le nom du fichier ; la tabulation, le CRLF, les dates AAAAMMJJ, la virgule décimale ; chaque
// écriture et le fichier équilibrés ; la numérotation continue par journal ; les à-nouveaux en tête ; une date, une pièce, un
// journal par écriture ; pour les vingt-deux champs, l'en-tête du VIII, 7°, la date de règlement dans l'exercice, le mode et
// la nature dans leurs listes fermées, l'identification du client vide ou un numéro de facture (FEC22-Q4 : aucun client de
// ce dossier n'a de SIREN), et sur tout le fichier AUCUN libellé repris d'un crédit du relevé (lib/libellesDuReleve.ts).

// LA GÉNÉRATION DANS LES DEUX ÉTATS DU DRAPEAU. La numérotation reçoit les quatre champs par son paramètre ; la génération des
// écritures lit le drapeau à l'appel (lib/ecritureParReglement.ts). L'outil compose avec le drapeau tel qu'il est (baissé) ;
// le dernier cas prouve que, levé, la génération rendrait ici le même fichier — aucune pièce de ce dossier n'est payée le
// même jour par deux modes.
const generation: { choix: ChoixChampsBnc | null } = { choix: null }
vi.mock('./champsBncExportes', async (original) => {
  const vrai = await original<typeof import('./champsBncExportes')>()
  return { ...vrai, get CHAMPS_BNC_EXPORTES() { return generation.choix } }
})

const VIDES: ChoixChampsBnc = { sansReglement: 'vides' }
const DATE_ECRITURE: ChoixChampsBnc = { sansReglement: 'date_de_l_ecriture' }
const DEBUT = `${ANNEE_DU_FEC_FICTIF}0101`
const FIN = `${ANNEE_DU_FEC_FICTIF}1231`

let vides: FecFictif
let dates: FecFictif
beforeAll(() => {
  generation.choix = null
  vides = composerLeFecFictif(VIDES)
  dates = composerLeFecFictif(DATE_ECRITURE)
})

const lignesDe = (fec: string) => colonnes(fec).slice(1)
const centimes = (champ: string) => Math.round(Number(champ.replace(',', '.')) * 100)
const dateDuCalendrier = (v: string) => {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(v)
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3])
}
// La clé de Luhn d'un SIREN : un chiffre sur deux doublé, à partir du deuxième.
const luhn = (siren: string) => [...siren].reduce((s, c, i) => {
  const d = Number(c) * (i % 2 === 1 ? 2 : 1)
  return s + (d > 9 ? d - 9 : d)
}, 0) % 10 === 0

// Les fautes de FORME communes aux dix-huit et aux vingt-deux champs, relues sur le texte imprimé.
function fautesDeForme(f: FecFictif, fec: string, nbChamps: number): string[] {
  const fautes: string[] = []
  if (/\r(?!\n)|(?<!\r)\n/.test(fec)) fautes.push('un saut de ligne qui n’est pas CRLF')
  const [entete, ...lignes] = colonnes(fec)
  if (JSON.stringify(entete) !== JSON.stringify(ENTETES_BNC_ATTENDUS.slice(0, nbChamps))) fautes.push(`en-tête : ${entete.join(' ')}`)
  if (lignes.length !== f.brouillon.length + f.aNouveaux) fautes.push(`${lignes.length} lignes pour ${f.brouillon.length + f.aNouveaux} écritures du brouillon et à-nouveaux`)
  let totalDebit = 0
  let totalCredit = 0
  lignes.forEach((r, i) => {
    const ou = `ligne ${i + 2}`
    if (r.length !== nbChamps) fautes.push(`${ou} : ${r.length} champs`)
    for (const k of [3, 9, 15]) if (!dateDuCalendrier(r[k])) fautes.push(`${ou} : ${ENTETES_BNC_ATTENDUS[k]} « ${r[k]} »`)
    if (r[14] !== '' && !dateDuCalendrier(r[14])) fautes.push(`${ou} : DateLet « ${r[14]} »`)
    if (r[3] < DEBUT || r[3] > FIN) fautes.push(`${ou} : EcritureDate hors de l’exercice`)
    for (const k of [11, 12]) if (!/^\d+,\d{2}$/.test(r[k])) fautes.push(`${ou} : ${ENTETES_BNC_ATTENDUS[k]} « ${r[k]} »`)
    if (centimes(r[11]) !== 0 && centimes(r[12]) !== 0) fautes.push(`${ou} : un débit et un crédit`)
    if (centimes(r[11]) === 0 && centimes(r[12]) === 0) fautes.push(`${ou} : ni débit ni crédit`)
    totalDebit += centimes(r[11])
    totalCredit += centimes(r[12])
    if (!/^[A-Z]{2}\d{5}$/.test(r[2]) || !r[2].startsWith(r[0])) fautes.push(`${ou} : EcritureNum « ${r[2]} » du journal ${r[0]}`)
    // Les « données absentes » de l'outil en BNC trésorerie (PieceRef et PieceDate), et ce que tout logiciel affiche.
    for (const k of [0, 1, 4, 5, 8, 10]) if (r[k].trim() === '') fautes.push(`${ou} : ${ENTETES_BNC_ATTENDUS[k]} vide`)
  })
  if (totalDebit !== totalCredit) fautes.push(`le fichier n’est pas équilibré : ${totalDebit} contre ${totalCredit}`)
  // Les à-nouveaux en tête, d'un seul bloc.
  const premierAutre = lignes.findIndex((r) => r[0] !== 'AN')
  if (lignes.slice(premierAutre).some((r) => r[0] === 'AN')) fautes.push('un à-nouveau après une autre écriture')
  if (lignes[0]?.[0] !== 'AN') fautes.push('le fichier ne commence pas par ses à-nouveaux')
  // La numérotation continue par journal : dans l'ordre du fichier, 1, 2, 3… sans trou ni retour.
  const vus = new Map<string, string[]>()
  for (const r of lignes) {
    const deJournal = vus.get(r[0]) ?? []
    if (deJournal.at(-1) !== r[2]) deJournal.push(r[2])
    vus.set(r[0], deJournal)
  }
  for (const [journal, numeros] of vus) {
    const attendus = numeros.map((_, i) => `${journal}${String(i + 1).padStart(5, '0')}`)
    if (JSON.stringify(numeros) !== JSON.stringify(attendus)) fautes.push(`journal ${journal} : ${numeros.join(' ')}`)
  }
  return [...fautes, ...anomaliesDgfip(fec), ...desequilibresDgfip(fec).map((n) => `${n} : écriture non équilibrée`)]
}

// AUCUN libellé repris d'un crédit du relevé : ni le libellé, ni le libellé brut, ni l'un contenu dans un champ du fichier.
function libellesDeCredits(f: FecFictif, fec: string): string[] {
  const credits = new Set(f.mouvements.filter((m) => m.montant > 0).flatMap((m) => [m.libelle, m.libelle_brut ?? '']).filter((x) => x !== ''))
  return lignesDe(fec).flatMap((r) => r.filter((champ) => [...credits].some((c) => champ.includes(c))).map((champ) => `${r[2]} : « ${champ} »`))
}

describe('le FEC fictif : le nom du fichier', () => {
  it('<SIREN>FEC<date de clôture>.txt, le SIREN fabriqué passant la clé de Luhn', () => {
    expect(vides.nomFichier).toBe(`123456782FEC${FIN}.txt`)
    expect(luhn(vides.nomFichier.slice(0, 9))).toBe(true)
  })
})

describe('le FEC fictif à dix-huit champs (le drapeau baissé, le fichier d’aujourd’hui)', () => {
  it('a la forme de l’article A47 A-1 et passe les contrôles de l’outil de la DGFiP', () => {
    expect(fautesDeForme(vides, vides.dixHuit, 18)).toEqual([])
  })

  it('le choix de FEC22-Q1 n’y change rien', () => {
    expect(dates.dixHuit).toBe(vides.dixHuit)
  })

  it('ne reprend le libellé d’aucun crédit du relevé', () => {
    // Le plancher : le relevé a bien des crédits — ceux de l'Assurance maladie, des factures, les versements d'espèces, le rejet.
    expect(vides.mouvements.filter((m) => m.montant > 0).length).toBeGreaterThanOrEqual(30)
    expect(libellesDeCredits(vides, vides.dixHuit)).toEqual([])
  })
})

describe.each([
  ['vides', () => vides],
  ['la date de l’écriture et « Sans règlement »', () => dates],
])('le FEC fictif à vingt-deux champs, sans règlement : %s', (_, lire) => {
  it('a la forme de l’article A47 A-1, l’en-tête du VIII, 7° et la structure que l’outil éprouve en BNC trésorerie', () => {
    const f = lire()
    expect(fautesDeForme(f, f.vingtDeux, 22)).toEqual([])
    expect(structureBncDgfip(f.vingtDeux)).toEqual([])
  })

  it('les quatre champs : constants par écriture, un règlement daté et dans son mode, IdClient un numéro de facture du dossier', () => {
    const f = lire()
    expect(anomaliesBnc(f.vingtDeux, new Set(f.numerosDesFactures))).toEqual([])
  })

  it('la date de règlement dans l’exercice, le mode et la nature dans leurs listes fermées, le poste un poste de la 2035', () => {
    const f = lire()
    const fautes = lignesDe(f.vingtDeux).flatMap((r) => {
      const [dateRglt, modeRglt, natOp] = r.slice(18)
      const [nature, poste, ...reste] = natOp.split(SEPARATEUR_DU_POSTE)
      return [
        ...(dateRglt !== '' && (dateRglt < DEBUT || dateRglt > FIN) ? [`${r[2]} : DateRglt ${dateRglt}`] : []),
        ...(modeRglt !== '' && !(MODES_REGLEMENT as readonly string[]).includes(modeRglt) ? [`${r[2]} : ModeRglt « ${modeRglt} »`] : []),
        ...(!(NATURES_OPERATION as readonly string[]).includes(nature) ? [`${r[2]} : nature « ${nature} »`] : []),
        ...(poste !== undefined && !POSTES_RATTACHES.includes(poste) ? [`${r[2]} : poste « ${poste} »`] : []),
        ...(reste.length > 0 ? [`${r[2]} : NatOp « ${natOp} »`] : []),
      ]
    })
    expect(fautes).toEqual([])
  })

  it('ses dix-huit premiers champs sont le fichier d’aujourd’hui, ligne pour ligne', () => {
    const f = lire()
    expect(colonnes(f.vingtDeux).map((r) => r.slice(0, 18).join('\t')).join('\r\n')).toBe(f.dixHuit)
  })

  it('ne reprend le libellé d’aucun crédit du relevé', () => {
    const f = lire()
    expect(libellesDeCredits(f, f.vingtDeux)).toEqual([])
  })
})

describe('le FEC fictif à vingt-deux champs : ce que le dossier couvre, et le choix de FEC22-Q1', () => {
  it('chaque sorte du dossier est au fichier : les cinq journaux, les modes et les natures d’un praticien', () => {
    const lignes = lignesDe(vides.vingtDeux)
    expect([...new Set(lignes.map((r) => r[0]))].sort()).toEqual(['AC', 'AN', 'BQ', 'OD', 'VE'])
    expect([...new Set(lignes.map((r) => r[19]))].sort()).toEqual(['', 'Banque', 'Chèque', 'Espèces', 'Virement'])
    expect([...new Set(lignes.map((r) => r[20].split(SEPARATEUR_DU_POSTE)[0]))].sort()).toEqual([
      "Acquisition d'immobilisation", 'Cotisation sociale', 'Dotation aux amortissements', 'Dépense', 'Frais de véhicule (barème)',
      "Prélèvement de l'exploitant", 'Recette', "Versement d'espèces", 'À-nouveaux',
    ].sort())
    // IdClient sur les seuls encaissements des factures : vingt-quatre factures payées, deux lignes chacune.
    expect(lignes.filter((r) => r[21] !== '').map((r) => r[0])).toEqual(Array.from({ length: 48 }, () => 'VE'))
  })

  it('sans règlement — les à-nouveaux, la dotation, le forfait : vides, ou la date de l’écriture et « Sans règlement »', () => {
    // Une écriture qui n'est pas un règlement : aucune de ses lignes sur la banque, les valeurs à l'encaissement ou la caisse —
    // et les à-nouveaux, qui reprennent des soldes.
    const sansReglement = (fec: string) => {
      const lignes = lignesDe(fec)
      const reglements = new Set(lignes.filter((r) => r[0] !== 'AN' && /^(512|511|53)/.test(r[4])).map((r) => r[2]))
      return lignes.filter((r) => !reglements.has(r[2]))
    }
    expect(sansReglement(vides.vingtDeux).length).toBe(6)
    expect(sansReglement(vides.vingtDeux).filter((r) => r[18] !== '' || r[19] !== '')).toEqual([])
    expect(sansReglement(dates.vingtDeux).filter((r) => r[18] !== r[3] || r[19] !== 'Sans règlement')).toEqual([])
  })
})

describe('le FEC fictif : la génération levée rendrait le même fichier', () => {
  it('le drapeau levé, la génération répartit par règlement, et aucun des deux fichiers ne change', () => {
    generation.choix = VIDES
    try {
      const leve = composerLeFecFictif(VIDES)
      expect(leve.vingtDeux).toBe(vides.vingtDeux)
      expect(leve.dixHuit).toBe(vides.dixHuit)
    } finally {
      generation.choix = null
    }
  })
})
