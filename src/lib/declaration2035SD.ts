import { amortissementCumuleCentimes, miseEnService, rang360 } from './amortissements'
import { formaterMontant } from './gabarit2035'
import type { Immobilisation } from './types'

// CE QUE LA DÉCLARATION PRINCIPALE N° 2035-SD PORTE, TIRÉ DE CE QUE L'APPLICATION SAIT DÉJÀ (docs/conceptions/
// 55-formulaire-2035-sd.md). Module pur, sans pdf.js ni pdf-lib : gabarit2035SD.ts dit où l'écrire, remplir2035SD.ts l'écrit.
//
// RIEN N'EST REMPLI À LA PLACE DU CABINET. Deux cadres seulement se remplissent :
//   - la ligne 1 de la récapitulation, « Résultat fiscal (report des lignes 46 ou 47 de l'annexe 2035-B) » : les cases CP et
//     CR telles que le PDF de la 2035-A/B les imprime (`arrondirPourFormulaire`, ou l'instantané d'un exercice validé) ;
//   - le tableau I des immobilisations et des amortissements (page 3), tiré du registre par le calcul même qui fait la case CH
//     (lib/amortissements.ts), puis CONFRONTÉ à CH : la ligne « Dotation nette … à reporter ligne CH » doit la redire.
// Tout le reste (plus-values, exonérations, BNC non professionnels, salariés, associés, comptabilité informatisée, viseur)
// reste vide : l'application ne le connaît pas. Une valeur que l'application sait due mais ne connaît pas s'imprime
// « à saisir » (`'a_saisir'`), jamais 0 ; un montant nul ne s'imprime pas (une case vide vaut zéro sur un formulaire fiscal).

/** Un montant à l'euro, ou « à saisir » : dû, mais l'application ne le connaît pas. */
export type Montant2035SD = number | 'a_saisir'

export interface LigneDesImmobilisations {
  id: string
  /** Colonne « Nature des immobilisations » : le libellé du registre. */
  nature: string
  /** Colonne 1, la date de mise en service (l'acquisition sans elle) : celle d'où part l'amortissement. */
  miseEnService: string
  /** Colonne 2, le prix total payé TVA comprise. */
  prixTtc: Montant2035SD
  /** Colonne 3, la TVA déduite : 0 pour qui n'est pas redevable (la notice : « n'ont pas à servir cette colonne »). */
  tvaDeduite: Montant2035SD
  /** Colonne 4, la base amortissable (col. 2 − col. 3) : la valeur du registre. */
  base: number
  /** Colonne 5, « L 20 % » : l'application n'amortit qu'en linéaire. */
  mode: string
  /** Colonne 6, les amortissements antérieurs : le cumul au 31 décembre de l'année d'avant. */
  anterieurs: number
  /** Colonne 7, la dotation de l'année. */
  annee: number
}

export interface TotauxDesImmobilisations {
  prixTtc: Montant2035SD
  tvaDeduite: Montant2035SD
  base: number
  anterieurs: number
  annee: number
}

export interface TableauDesImmobilisations {
  lignes: LigneDesImmobilisations[]
  /** « Total général » (A) : la somme de la colonne 7. */
  totalGeneral: number
  /** (B) : les amortissements des véhicules du registre sous le barème forfaitaire — « à saisir » quand il y en a. */
  vehiculesSousLeBareme: Montant2035SD
  /** (A − B), « à reporter ligne CH » : « à saisir » tant que B l'est. */
  dotationNette: Montant2035SD
  /** La case CH telle que la 2035-B l'imprime, et si le tableau la redit. */
  ch: number
  concorde: boolean
}

export interface Declaration2035SD {
  annee: number
  /** Ligne 1 : le bénéfice (CP) ou le déficit (CR) de la 2035-B, à l'euro. */
  benefice: number
  deficit: number
  immobilisations: TableauDesImmobilisations
}

export interface Entree2035SD {
  annee: number
  /** Les cases de la 2035-A/B à l'euro, telles que leur PDF les imprime : `arrondirPourFormulaire`, ou l'instantané validé. */
  formulaire: ReadonlyMap<string, number>
  /** Le registre lu EN ENTIER : un bien manquant manquerait au tableau sans que rien le dise (le refus de l'écran). */
  immobilisations: readonly Immobilisation[]
  /** Le dossier redevable de la TVA : la colonne 3 lui est due, et l'application ne la connaît pas. */
  assujettiTva: boolean
  /** Vrai quand un véhicule du registre est amorti l'année d'un barème (`amortissementsSousLeBareme`, non vide). */
  vehiculesSousLeBareme: boolean
}

// L'euro d'un montant en centimes positifs, le demi-euro vers le haut : en entiers, jamais en virgule flottante.
const enEurosArrondis = (centimes: bigint): number => Number((centimes + 50n) / 100n)

// Le taux linéaire de la durée, au centième, à la française : 5 ans → « 20 », 3 ans → « 33,33 ».
export function modeLineaire(dureeAnnees: number): string {
  const taux = 100 / dureeAnnees
  const texte = Number.isInteger(taux) ? String(taux) : taux.toFixed(2).replace('.', ',')
  return `L ${texte} %`
}

// LA COLONNE 7 S'ADDITIONNE EN CH. Chaque dotation arrondie seule à l'euro ferait une colonne dont la somme s'écarte de la case
// CH (qui est l'arrondi de la SOMME au centime) d'un euro ou deux dès quelques biens : la ligne « à reporter ligne CH »
// mentirait. La méthode du plus fort reste : chaque dotation prend son euro inférieur, puis les euros qui manquent pour
// atteindre la cible vont aux plus forts restes (à égalité, l'ordre du tableau). Chaque ligne est donc son arrondi inférieur
// ou supérieur, jamais plus loin. Rend null si la cible n'est pas atteignable ainsi (elle l'est toujours quand elle est
// l'arrondi de la somme).
function repartirALEuro(centimes: readonly bigint[], cible: number): number[] | null {
  const planchers = centimes.map((c) => Number(c / 100n))
  let manque = cible - planchers.reduce((s, x) => s + x, 0)
  if (manque < 0 || manque > centimes.length) return null
  const ordre = centimes.map((c, i) => ({ i, reste: Number(c % 100n) })).sort((a, b) => b.reste - a.reste || a.i - b.i)
  const euros = [...planchers]
  for (const { i, reste } of ordre) {
    if (manque === 0) break
    if (reste === 0) return null
    euros[i] += 1
    manque--
  }
  return manque === 0 ? euros : null
}

export function tableauDesImmobilisations(e: Entree2035SD): TableauDesImmobilisations {
  const finDeLAnnee = `${e.annee}-12-31`
  // Les biens du registre acquis au plus tard le 31 décembre : ceux que le cabinet détient (l'application ne connaît pas
  // les cessions). Dans l'ordre de leur mise en service, puis du libellé : un ordre stable d'une impression à l'autre.
  const biens = e.immobilisations
    .filter((b) => b.date_acquisition <= finDeLAnnee)
    .sort((a, b) => miseEnService(a).localeCompare(miseEnService(b)) || a.libelle.localeCompare(b.libelle) || a.id.localeCompare(b.id))

  const calcul = biens.map((bien) => {
    const anterieurs = amortissementCumuleCentimes(bien, rang360(`${e.annee - 1}-12-31`))
    const cumul = amortissementCumuleCentimes(bien, rang360(finDeLAnnee))
    return { bien, base: BigInt(Math.round(bien.valeur * 100)), anterieurs, dotation: cumul - anterieurs }
  })

  const ch = e.formulaire.get('CH') ?? 0
  const sommeAuCentime = calcul.reduce((s, c) => s + c.dotation, 0n)
  // Le tableau redit CH quand l'arrondi de sa somme au centime EST la case : sinon le registre a bougé depuis (un exercice
  // validé relit CH de son instantané), ou CH porte autre chose que les dotations du registre — et c'est dit, jamais tu.
  const concorde = enEurosArrondis(sommeAuCentime) === ch
  const dotations = (concorde ? repartirALEuro(calcul.map((c) => c.dotation), ch) : null)
    ?? calcul.map((c) => enEurosArrondis(c.dotation))

  const lignes: LigneDesImmobilisations[] = calcul.map((c, i) => {
    const base = enEurosArrondis(c.base)
    return {
      id: c.bien.id,
      nature: c.bien.libelle,
      miseEnService: miseEnService(c.bien),
      prixTtc: e.assujettiTva ? 'a_saisir' : base,
      tvaDeduite: e.assujettiTva ? 'a_saisir' : 0,
      base,
      mode: modeLineaire(c.bien.duree_annees),
      anterieurs: enEurosArrondis(c.anterieurs),
      annee: dotations[i],
    }
  })

  const totalGeneral = lignes.reduce((s, l) => s + l.annee, 0)
  const vehiculesSousLeBareme: Montant2035SD = e.vehiculesSousLeBareme ? 'a_saisir' : 0
  return {
    lignes,
    totalGeneral,
    vehiculesSousLeBareme,
    dotationNette: vehiculesSousLeBareme === 'a_saisir' ? 'a_saisir' : totalGeneral,
    ch,
    concorde,
  }
}

/** Les totaux d'une suite de lignes (une page du tableau, ou ses annexes) : « à saisir » dès qu'une ligne l'est. */
export function totauxDesLignes(lignes: readonly LigneDesImmobilisations[]): TotauxDesImmobilisations {
  const somme = (valeurs: Montant2035SD[]): Montant2035SD =>
    valeurs.includes('a_saisir') ? 'a_saisir' : (valeurs as number[]).reduce((s, x) => s + x, 0)
  return {
    prixTtc: somme(lignes.map((l) => l.prixTtc)),
    tvaDeduite: somme(lignes.map((l) => l.tvaDeduite)),
    base: lignes.reduce((s, l) => s + l.base, 0),
    anterieurs: lignes.reduce((s, l) => s + l.anterieurs, 0),
    annee: lignes.reduce((s, l) => s + l.annee, 0),
  }
}

export function calculer2035SD(e: Entree2035SD): Declaration2035SD {
  return {
    annee: e.annee,
    benefice: e.formulaire.get('CP') ?? 0,
    deficit: e.formulaire.get('CR') ?? 0,
    immobilisations: tableauDesImmobilisations(e),
  }
}

// CE QUE CLÔTURE DIT AVANT LE CLIC, et que le PDF écrit en rouge au bas de sa page 3 : un tableau qui ne redit pas CH, ce qui
// reste à saisir. Vide, rien à dire.
export function avisDuTableauDesImmobilisations(t: TableauDesImmobilisations): string[] {
  const avis: string[] = []
  if (!t.concorde) {
    avis.push(`Le tableau des immobilisations (dotations ${formaterMontant(t.totalGeneral)} €) ne redit pas la case CH de la 2035-B (${formaterMontant(t.ch)} €) : `
      + `à vérifier avant le dépôt.`)
  }
  if (t.lignes.some((l) => l.prixTtc === 'a_saisir')) {
    avis.push('Dossier redevable de la TVA : le prix TVA comprise et la TVA déduite de chaque bien (colonnes 2 et 3) sont à saisir.')
  }
  if (t.vehiculesSousLeBareme === 'a_saisir') {
    avis.push('Un véhicule du registre est amorti l’année du barème kilométrique : la ligne (B) et la dotation nette sont à saisir.')
  }
  return avis
}
