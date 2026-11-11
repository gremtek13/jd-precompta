import { UNITES_ARTICLE } from './articles'
import { numeroAdmis } from './factureCii'
import {
  concordanceAvecLeDossier,
  lireFactureXmlDetaillee,
  type DetailDeLaFacture,
  type FactureLue,
  type ValeurLue,
} from './factureElectronique'
import { xmlDuFacturX, type OuvrirPdf } from './factureX'
import { calculerLigne } from './montantsFacture'
import type { NatureOperation, TypeClient } from './types'

// LA LECTURE D'UNE FACTURE DE L'ANCIEN LOGICIEL DU CLIENT (ligne 51.5, étape A8d1). Un client qui quitte son ancien
// logiciel en reprend les factures d'avant (A8a, `importer_factures`, en production depuis le 10/11/2026). Ce module lit
// UNE facture structurée — un PDF Factur-X (lib/factureX.ts en tire le XML), un CII seul ou un UBL —, la juge, et rend
// l'objet que la fonction attend pour elle, ou les raisons de ne pas la reprendre, TOUTES, champ par champ. Il est pur :
// ni base, ni stockage, ni écran (A8d2), ni CSV (qui attend A4B3-Q6). Il ne journalise rien : une facture porte le nom de
// son client.
//
// RIEN N'Y EST DEVINÉ. Le XML se lit par le lecteur de la réception (lib/factureElectronique.ts : `lireFactureXmlDetaillee`,
// à la place que la norme donne à chaque champ) ; une valeur absente ou illisible que la reprise exige est un refus nommé ;
// ce que la facture ne dit pas — le type du client, sa transmission, l'encaissé avant la reprise, et, quand ils ne sont pas
// écrits, la nature de ses opérations et l'option sur les débits — est un CHOIX de l'appelant (`ChoixDeLaReprise`), sans
// défaut. Les montants se comptent en centimes entiers, les lignes par `calculerLigne` (montantsFacture.ts), la règle que
// la base applique (`centimes_ligne_facture`) : la somme des lignes doit faire le total déclaré, sinon la facture se
// refuse, l'écart chiffré.
//
// LES SOURCES (publiques ; les normes AFNOR XP Z12-012 et XP Z12-013 ne s'utilisent pas) : norme EN 16931-1 et ses
// artefacts de validation (Commission européenne ; syntaxes CII D16B et UBL 2.1) — BT-1, BT-3 (liste UNTDID 1001 : 380 la
// facture commerciale, 381 l'avoir), BT-5, BT-8 (UNTDID 2475 en CII : 5 la date de facture, 72 la date du paiement ;
// UNTDID 2005 en UBL : 3 et 432), BT-9, BT-23, BT-25, BT-106 à BT-112, BT-129 à BT-131, BT-146, BT-149, BT-151, BT-152,
// BG-20, BG-21, BG-27, BG-28, règles BR-27 (un prix n'est jamais négatif) et BR-CO-17 (la TVA d'un taux, base × taux,
// arrondie) ; DGFiP, spécifications externes de la facture électronique, annexe 7, règles G1.02 (le cadre de facturation :
// B biens, S services, M mixte ; 4 la facture définitive après acompte), G1.05 (le numéro), G1.36 (la date).

/** Les formats d'un fichier que ce module lit : ceux du lot d'`importer_factures`, sans le PDF seul ni le CSV. */
export type FormatDUnFichier = 'facturx' | 'cii' | 'ubl'
export const FORMATS_LUS: readonly FormatDUnFichier[] = ['facturx', 'cii', 'ubl']

/** Les taux de la TVA française qu'`importer_factures` admet (CGI, art. 278 à 281 nonies, 296, 297), en pour cent. */
export const TAUX_DE_LA_REPRISE: readonly number[] = [0, 0.9, 1.05, 1.75, 2.1, 5.5, 8.5, 10, 13, 20]

/** Les catégories de TVA (BT-151) qui n'ont pas de taux à écrire : la ligne compte alors à 0 %. */
const CATEGORIES_SANS_TAXE = new Set(['E', 'Z', 'AE', 'K', 'G', 'O'])

// Les bornes d'`importer_factures`, redites pour se dire avant l'appel ; lectureDesFacturesReprises.test.ts les confronte
// au texte de la migration.
export const NOM_DU_CLIENT_MAX = 300
export const ADRESSE_DU_CLIENT_MAX = 1000
export const DESIGNATION_MAX = 1000
export const LIGNES_MAX = 500
export const NOM_DE_PLATEFORME_MAX = 100

export type TransmiseePar = 'papier' | 'pdf' | 'plateforme' | 'inconnu'
export const TRANSMISSIONS: readonly TransmiseePar[] = ['papier', 'pdf', 'plateforme', 'inconnu']
export const TYPES_CLIENT: readonly TypeClient[] = ['assujetti', 'organisme_public', 'non_assujetti', 'etranger']
export const NATURES: readonly NatureOperation[] = ['biens', 'services', 'mixte']

// ── Ce que la lecture rend ───────────────────────────────────────────────────────────────────────────────────────

/** Une ligne lue, dans le sens de l'application : les quantités d'un avoir négatives, ses prix positifs. */
export interface LigneReprise {
  designation: string
  quantite: number
  prix_unitaire_ht: number
  taux_tva: number
  unite: string | null
}

export interface FactureRepriseLue {
  format: FormatDUnFichier
  numero: string
  type: 'facture' | 'avoir'
  /** La facture qu'un avoir crédite (BT-25) ; nulle pour une facture. */
  origine_numero: string | null
  date_emission: string
  date_echeance: string | null
  tiers_nom: string
  tiers_adresse: string | null
  tiers_siren: string | null
  tiers_siret: string | null
  /** La nature des opérations, quand le cadre de facturation (BT-23) la dit ; sinon un choix de l'appelant. */
  nature_lue: NatureOperation | null
  /** L'option sur les débits, quand la date d'exigibilité de la TVA (BT-8) la dit ; sinon un choix de l'appelant. */
  option_debits_lue: boolean | null
  /** Les totaux, en centimes, dans le sens de l'application : négatifs pour un avoir. */
  ht_centimes: number
  tva_centimes: number
  ttc_centimes: number
  lignes: LigneReprise[]
}

export type LectureDeReprise = { lue: FactureRepriseLue } | { refus: string[] }

// ── Le fichier ───────────────────────────────────────────────────────────────────────────────────────────────────

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d] // « %PDF- »

/**
 * Lit le fichier d'UNE facture de l'ancien logiciel. Le format se décide au CONTENU, jamais au nom ni au type annoncé :
 * un PDF est un Factur-X (sa facture structurée jointe), un XML un CII ou un UBL. `sirenDuDossier` : celui de l'émetteur
 * du dossier (`sirenDuDossier` de factureElectronique.ts), nul quand le dossier n'en a pas — la facture se refuse alors.
 */
export async function lireFichierDeReprise(
  octets: Uint8Array,
  sirenDuDossier: string | null,
  ouvrir?: OuvrirPdf,
): Promise<LectureDeReprise> {
  if (PDF.every((o, i) => octets[i] === o)) {
    const x = await xmlDuFacturX(octets, ouvrir)
    if ('refus' in x) return { refus: [x.refus] }
    return lireXmlDeReprise(x.xml, 'facturx', sirenDuDossier)
  }
  let xml: string
  try {
    xml = new TextDecoder('utf-8', { fatal: true }).decode(octets)
  } catch {
    return { refus: ['Ce fichier n’est ni un PDF ni un texte UTF-8 : ni un Factur-X, ni un CII, ni un UBL.'] }
  }
  if (!xml.trimStart().startsWith('<')) {
    return { refus: ['Ce fichier n’est ni un PDF ni un XML : ni un Factur-X, ni un CII, ni un UBL.'] }
  }
  const encodage = /^\s*<\?xml[^>]*\bencoding\s*=\s*["']([^"']+)["']/i.exec(xml)
  if (encodage && encodage[1].toLowerCase().replace(/[-_]/g, '') !== 'utf8') {
    return { refus: [`Ce XML se déclare en ${encodage[1]} : une facture se reprend en UTF-8.`] }
  }
  return lireXmlDeReprise(xml, null, sirenDuDossier)
}

/**
 * Lit le XML d'une facture (CII ou UBL) et la juge. `format` : « facturx » quand le XML vient d'un PDF, nul pour un XML
 * seul (sa syntaxe le dit).
 */
export function lireXmlDeReprise(xml: string, format: 'facturx' | null, sirenDuDossier: string | null): LectureDeReprise {
  const l = lireFactureXmlDetaillee(xml)
  if ('refus' in l) return { refus: [l.refus] }
  return jugerLaFacture(l.facture, l.detail, format ?? (l.facture.syntaxe === 'CII' ? 'cii' : 'ubl'), sirenDuDossier)
}

// ── Le jugement ──────────────────────────────────────────────────────────────────────────────────────────────────

const euros = (c: number) => {
  const a = Math.abs(c)
  return `${c < 0 ? '−' : ''}${Math.floor(a / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${String(a % 100).padStart(2, '0')} €`
}
const enCentimes = (n: number) => Math.round(n * 100)
const tauxEnTexte = (t: number) => `${String(t).replace('.', ',')} %`

function natureDuCadre(cadre: string | null): NatureOperation | null | 'acompte' {
  const m = /^([BSM])([0-9])$/.exec(cadre ?? '')
  if (!m) return null
  if (m[2] === '4') return 'acompte'
  return m[1] === 'B' ? 'biens' : m[1] === 'S' ? 'services' : 'mixte'
}

// L'option sur les débits : la TVA exigible à la date de la facture (CII 5, UBL 3) la dit ; à la date du paiement (CII 72,
// UBL 432), son absence. Une facture mixte peut dater de la livraison (CII 29, UBL 35) la taxe de ses biens à côté : seule
// l'option ne vise que les services. Les deux dates ensemble se contredisent ; aucune des deux ne dit rien, et c'est un
// choix de l'appelant.
function optionDesDebits(syntaxe: 'CII' | 'UBL', codes: string[]): boolean | null | 'contradiction' {
  const parLesDebits = codes.includes(syntaxe === 'CII' ? '5' : '3')
  const auPaiement = codes.includes(syntaxe === 'CII' ? '72' : '432')
  if (parLesDebits && auPaiement) return 'contradiction'
  return parLesDebits ? true : auPaiement ? false : null
}

function lisible<T>(v: ValeurLue<T>): v is T {
  return v !== null && v !== 'illisible'
}

function jugerLaFacture(f: FactureLue, d: DetailDeLaFacture, format: FormatDUnFichier, sirenDuDossier: string | null): LectureDeReprise {
  const refus: string[] = []

  // Ce que la lecture de l'en-tête a trouvé absent, illisible ou contradictoire : la reprise ne comble rien.
  refus.push(...f.anomalies)

  // Le type : la facture commerciale (380) ou l'avoir (381), rien d'autre — ni l'acompte (386, 503), qu'aucun devis ne
  // reprendrait, ni la rectificative ou l'autofacture, que l'import ne sait pas porter.
  // (Un `CreditNote` UBL est un avoir par sa racine : son code 380 ne fait pas de lui une facture.)
  const type = f.typeCode === '380' && f.nature === 'facture' ? 'facture' : f.typeCode === '381' ? 'avoir' : null
  if (f.typeCode !== null && f.nature !== null && type === null) {
    refus.push(`Type de document ${f.typeCode} : seule une facture (380) ou un avoir (381) se reprend.`)
  }
  // La lecture de l'en-tête ne dit que le TTC absent ; la reprise exige les trois totaux écrits.
  if (f.montantHt === null && !f.anomalies.some((a) => a.startsWith('Total hors taxes'))) refus.push('Total hors taxes absent')
  if (f.montantTva === null && !f.anomalies.some((a) => a.startsWith('Total de la TVA'))) refus.push('Total de la TVA absent')

  if (f.numero !== null && !numeroAdmis(f.numero)) {
    refus.push('Numéro de facture hors de la forme admise : 35 caractères au plus — lettres, chiffres, espace, « - + _ / » —, sans espace en tête, en fin ni doublé (DGFiP, G1.05).')
  }
  if (f.devise !== null && f.devise !== 'EUR') refus.push(`Devise ${f.devise} : une facture reprise est en euros.`)
  if (d.echeanceEcrite && f.echeance === null) refus.push('Date d’échéance illisible')

  // L'émetteur : la facture est celle du dossier, prouvée par le SIREN du vendeur.
  const concordance = concordanceAvecLeDossier(f, 'vente', sirenDuDossier)
  if (sirenDuDossier === null) refus.push('Le SIREN du dossier n’est pas connu : rien ne prouve que la facture est la sienne.')
  else if (concordance.etat === 'inconnue') refus.push('SIREN du vendeur absent : rien ne prouve que la facture est celle du dossier.')
  else if (concordance.etat === 'autre') refus.push(`Le vendeur de cette facture (SIREN ${concordance.siren}) n’est pas l’émetteur du dossier.`)

  // Le client : son nom entier, son SIRET s'il en porte un, son SIREN.
  if (d.acheteurNom === null) refus.push('Nom du client absent')
  else if (d.acheteurNom.length > NOM_DU_CLIENT_MAX) refus.push(`Nom du client de plus de ${NOM_DU_CLIENT_MAX} caractères`)
  if (d.acheteurAdresse !== null && d.acheteurAdresse.length > ADRESSE_DU_CLIENT_MAX) {
    refus.push(`Adresse du client de plus de ${ADRESSE_DU_CLIENT_MAX} caractères`)
  }
  let siret: string | null = null
  if (d.acheteurSirets.length > 1) refus.push('Le client porte plusieurs SIRET')
  else if (d.acheteurSirets.length === 1) {
    siret = d.acheteurSirets[0]
    if (!/^\d{14}$/.test(siret)) refus.push('SIRET du client illisible (quatorze chiffres)')
    else if (f.acheteur.siren !== null && !siret.startsWith(f.acheteur.siren)) refus.push('Le SIRET du client ne commence pas par son SIREN')
  }
  const siren = f.acheteur.siren ?? (siret !== null && /^\d{14}$/.test(siret) ? siret.slice(0, 9) : null)

  // L'avoir cite la facture qu'il crédite (BT-25), une seule ; une facture n'en cite pas.
  let origine: string | null = null
  if (type === 'avoir') {
    if (d.references.length === 0) refus.push('L’avoir ne cite pas la facture qu’il crédite (BT-25).')
    else if (d.references.length > 1) refus.push('L’avoir cite plusieurs factures : une reprise n’en crédite qu’une.')
    else origine = d.references[0]
  }

  // Le cadre (BT-23) et l'exigibilité (BT-8).
  const cadre = natureDuCadre(d.cadre)
  if (cadre === 'acompte') refus.push(`Cadre de facturation ${d.cadre as string} : une facture définitive après acompte ne se reprend pas sans son devis.`)
  const debits = optionDesDebits(f.syntaxe, d.exigibilite)
  if (debits === 'contradiction') refus.push('La date d’exigibilité de la TVA (BT-8) se contredit d’un taux à l’autre.')

  // Les remises et frais : l'import ne porte que des lignes (quantité × prix), il ne les reprend pas.
  if (d.remisesOuFraisDuDocument > 0) refus.push('Remise ou frais sur l’ensemble de la facture (BG-20, BG-21) : ne se reprend pas.')

  // Les lignes, une à une, dans le sens du document, puis dans celui de l'application.
  const sens = type === 'avoir' ? -1 : 1
  const unites = new Set<string>(UNITES_ARTICLE.map((u) => u.code))
  if (d.lignes.length === 0) refus.push('La facture ne porte aucune ligne.')
  if (d.lignes.length > LIGNES_MAX) refus.push(`La facture porte ${d.lignes.length} lignes : une reprise en porte ${LIGNES_MAX} au plus.`)
  const lignes: LigneReprise[] = []
  let htLignesDocument = 0
  d.lignes.slice(0, LIGNES_MAX).forEach((l, i) => {
    const n = `Ligne ${i + 1}`
    const avant = refus.length
    if (l.designation === null) refus.push(`${n} : désignation absente`)
    else if (l.designation.length > DESIGNATION_MAX) refus.push(`${n} : désignation de plus de ${DESIGNATION_MAX} caractères`)
    if (!lisible(l.quantite)) refus.push(`${n} : quantité ${l.quantite === null ? 'absente' : 'illisible'}`)
    else if (l.quantite === 0) refus.push(`${n} : quantité nulle`)
    else if (type === 'avoir' && l.quantite < 0) refus.push(`${n} : quantité négative sur un avoir, qui crédite chacune de ses lignes`)
    if (!lisible(l.prixNet)) refus.push(`${n} : prix net ${l.prixNet === null ? 'absent' : 'illisible (six décimales au plus)'}`)
    else if (l.prixNet < 0) refus.push(`${n} : prix net négatif (EN 16931, BR-27)`)
    if (l.quantiteDeBase === 'illisible' || (lisible(l.quantiteDeBase) && l.quantiteDeBase !== 1)) {
      refus.push(`${n} : prix donné pour une quantité de base autre que un (BT-149)`)
    }
    if (l.unite !== null && !unites.has(l.unite)) refus.push(`${n} : unité ${l.unite}, hors de celles de l’application`)
    if (l.remisesOuFrais > 0) refus.push(`${n} : remise ou frais sur la ligne (BG-27, BG-28) : ne se reprend pas`)
    let taux: number | null = null
    if (l.taux === 'illisible') refus.push(`${n} : taux de TVA illisible`)
    else if (l.taux === null) {
      if (l.categorie !== null && CATEGORIES_SANS_TAXE.has(l.categorie)) taux = 0
      else refus.push(`${n} : taux de TVA absent`)
    } else if (!TAUX_DE_LA_REPRISE.includes(l.taux)) refus.push(`${n} : le taux de ${tauxEnTexte(l.taux)} n’est pas un taux de la TVA française`)
    else taux = l.taux
    if (!lisible(l.montantNetCentimes)) refus.push(`${n} : montant net ${l.montantNetCentimes === null ? 'absent' : 'illisible'}`)
    if (refus.length > avant || taux === null || !lisible(l.quantite) || !lisible(l.prixNet) || !lisible(l.montantNetCentimes)) return

    const htDocument = enCentimes(calculerLigne(l.quantite, l.prixNet, taux).montant_ht)
    if (htDocument !== l.montantNetCentimes) {
      refus.push(`${n} : son montant net (${euros(l.montantNetCentimes)}) ne vaut pas sa quantité fois son prix (${euros(htDocument)}).`)
      return
    }
    htLignesDocument += htDocument
    lignes.push({
      designation: l.designation as string,
      quantite: l.quantite === 0 ? 0 : l.quantite * sens,
      prix_unitaire_ht: l.prixNet,
      taux_tva: taux,
      unite: l.unite,
    })
  })

  // Les totaux, recontrôlés sur les lignes, comme la base les recontrôle : le HT au centime, la TVA par taux (BR-CO-17)
  // ou ligne à ligne, le TTC leur somme ; la ventilation par taux (BG-23) doit dire les mêmes bases.
  const complet = refus.length === 0 && type !== null && f.montantHt !== null && f.montantTva !== null && f.montantTtc !== null
  if (complet) {
    const ht = enCentimes(f.montantHt as number)
    const tva = enCentimes(f.montantTva as number)
    if (lisible(d.totalDesLignesCentimes) && d.totalDesLignesCentimes !== htLignesDocument) {
      refus.push(`La somme des lignes déclarée (BT-106, ${euros(d.totalDesLignesCentimes)}) ne vaut pas celle des lignes (${euros(htLignesDocument)}).`)
    } else if (d.totalDesLignesCentimes === 'illisible') refus.push('Somme des lignes (BT-106) illisible')
    if (ht !== htLignesDocument) {
      refus.push(`La facture déclare ${euros(ht)} hors taxe ; ses lignes en font ${euros(htLignesDocument)} (un écart de ${euros(ht - htLignesDocument)}).`)
    }
    const bases = new Map<number, number>()
    let tvaLigneALigne = 0
    for (const l of lignes) {
      const c = calculerLigne(l.quantite * sens, l.prix_unitaire_ht, l.taux_tva)
      bases.set(l.taux_tva, (bases.get(l.taux_tva) ?? 0) + enCentimes(c.montant_ht))
      tvaLigneALigne += enCentimes(c.montant_tva)
    }
    const tvaParTaux = [...bases].reduce((s, [taux, base]) => s + enCentimes(calculerLigne(1, base / 100, taux).montant_tva), 0)
    if (tva !== tvaParTaux && tva !== tvaLigneALigne) {
      refus.push(`La facture déclare ${euros(tva)} de TVA ; ses lignes en font ${euros(tvaParTaux)} par taux (EN 16931, BR-CO-17), ${euros(tvaLigneALigne)} ligne à ligne.`)
    }
    const ventilees = new Map<number, number>()
    for (const t of f.ventilation) {
      const tauxVentile = t.taux ?? (t.categorie !== null && CATEGORIES_SANS_TAXE.has(t.categorie) ? 0 : null)
      if (tauxVentile === null || t.base === null) {
        refus.push('La ventilation de la TVA par taux (BG-23) a un taux ou une base illisible.')
        break
      }
      ventilees.set(tauxVentile, (ventilees.get(tauxVentile) ?? 0) + enCentimes(t.base))
    }
    const memesBases = ventilees.size === bases.size && [...bases].every(([taux, base]) => ventilees.get(taux) === base)
    if (!memesBases && !refus.some((r) => r.startsWith('La ventilation'))) {
      refus.push('La ventilation de la TVA par taux (BG-23) ne dit pas les bases des lignes.')
    }
  }

  if (refus.length > 0 || !complet) {
    return { refus: refus.length > 0 ? refus : ['La facture ne se lit pas entière.'] }
  }
  return {
    lue: {
      format,
      numero: f.numero as string,
      type: type as 'facture' | 'avoir',
      origine_numero: origine,
      date_emission: f.date as string,
      date_echeance: f.echeance,
      tiers_nom: d.acheteurNom as string,
      tiers_adresse: d.acheteurAdresse,
      tiers_siren: siren,
      tiers_siret: siret,
      nature_lue: cadre === 'acompte' ? null : cadre,
      option_debits_lue: debits === 'contradiction' ? null : debits,
      ht_centimes: sens * enCentimes(f.montantHt as number),
      tva_centimes: sens * enCentimes(f.montantTva as number),
      ttc_centimes: sens * enCentimes(f.montantTtc as number),
      lignes,
    },
  }
}

// ── La forme qu'`importer_factures` attend ───────────────────────────────────────────────────────────────────────

/** Ce que la facture ne dit pas, et que l'appelant (le cabinet, à l'écran A8d2) choisit : AUCUN défaut. */
export interface ChoixDeLaReprise {
  type_client: TypeClient
  transmise_par: TransmiseePar
  /** Le nom de la plateforme agréée qui l'a transmise : exigé avec « plateforme », nul sinon. */
  plateforme_nom: string | null
  /** Ce qui en était encaissé avant la reprise, net des remboursements, en centimes ; zéro pour un avoir. */
  encaisse_avant_reprise_centimes: number
  /** Exigée quand le fichier ne la dit pas ; nulle, ou celle qu'il dit, sinon. */
  nature_operation: NatureOperation | null
  /** Exigée quand le fichier ne la dit pas ; nulle, ou celle qu'il dit, sinon. */
  option_debits: boolean | null
  /** La nature de chaque ligne, dans l'ordre : exigée d'une facture mixte, nulle sinon. */
  natures_des_lignes: readonly ('biens' | 'services')[] | null
}

export interface LigneAImporter {
  designation: string
  quantite: number
  prix_unitaire_ht: number
  taux_tva: number
  nature?: 'biens' | 'services'
  unite?: string
}

/** Une facture, sous les clés qu'`importer_factures` connaît (`v_cles_facture`), celles qu'une lecture remplit. */
export interface FactureAImporter {
  numero: string
  type: 'facture' | 'avoir'
  origine_numero?: string
  date_emission: string
  date_echeance?: string
  tiers_nom: string
  tiers_adresse?: string
  tiers_siren?: string
  tiers_siret?: string
  type_client: TypeClient
  nature_operation: NatureOperation
  option_debits: boolean
  montant_ht: number
  montant_tva: number
  montant_ttc: number
  lignes: LigneAImporter[]
  encaisse_avant_reprise: number
  transmise_par: TransmiseePar
  plateforme_nom?: string
}

// Les clés que ce module remplit, et, de celles qu'`importer_factures` connaît, celles qu'il laisse — chacune avec sa
// raison : lectureDesFacturesReprises.test.ts confronte les deux listes au texte de la migration, au nom près.
export const CLES_REMPLIES: readonly (keyof FactureAImporter)[] = [
  'numero', 'type', 'origine_numero', 'date_emission', 'date_echeance', 'tiers_nom', 'tiers_adresse', 'tiers_siren',
  'tiers_siret', 'type_client', 'nature_operation', 'option_debits', 'montant_ht', 'montant_tva', 'montant_ttc', 'lignes',
  'encaisse_avant_reprise', 'transmise_par', 'plateforme_nom',
]
export const CLES_LAISSEES: Readonly<Record<string, string>> = {
  encaisse_par_taux: 'la répartition par taux de l’encaissé, un choix de l’écran (A8d2) ; sans elle, la base répartit au prorata et le dit',
  ligne_csv: 'la ligne d’un CSV, qui attend A4B3-Q6',
  fichier_sha256: 'le fichier propre de la facture, déposé par l’écran (A8d2) avec la policy du seau',
  fichier_chemin: 'le chemin de ce fichier, avec lui',
}
export const CLES_DE_LIGNE: readonly (keyof LigneAImporter)[] = ['designation', 'quantite', 'prix_unitaire_ht', 'taux_tva', 'nature', 'unite']

const euro = (c: number) => (c === 0 ? 0 : c / 100)

/**
 * La facture lue, sous la forme qu'`importer_factures` attend, avec les choix de l'appelant ; ou ce qui manque à ces
 * choix. Aucune clé nulle ne part : la fonction ôte les nulles, et ce module ne les écrit pas.
 */
export function formeDImport(lue: FactureRepriseLue, choix: ChoixDeLaReprise): { facture: FactureAImporter } | { refus: string[] } {
  const refus: string[] = []

  const nature = lue.nature_lue ?? choix.nature_operation
  if (lue.nature_lue === null && choix.nature_operation === null) {
    refus.push('Le fichier ne dit pas la nature des opérations (BT-23) : biens, services ou mixte, à préciser.')
  } else if (lue.nature_lue !== null && choix.nature_operation !== null && choix.nature_operation !== lue.nature_lue) {
    refus.push(`Le fichier dit des opérations « ${lue.nature_lue} » : le choix ne le contredit pas.`)
  }
  const option = lue.option_debits_lue ?? choix.option_debits
  if (lue.option_debits_lue === null && choix.option_debits === null) {
    refus.push('Le fichier ne dit pas si la facture a été émise sous l’option pour les débits (BT-8) : à préciser.')
  } else if (lue.option_debits_lue !== null && choix.option_debits !== null && choix.option_debits !== lue.option_debits_lue) {
    refus.push('Le fichier dit l’option sur les débits : le choix ne la contredit pas.')
  }
  if (nature === 'mixte') {
    if (choix.natures_des_lignes === null || choix.natures_des_lignes.length !== lue.lignes.length) {
      refus.push(`Une facture mixte dit la nature de chacune de ses ${lue.lignes.length} lignes.`)
    }
  } else if (choix.natures_des_lignes !== null) {
    refus.push('Seule une facture mixte dit la nature de ses lignes.')
  }

  const plateforme = choix.plateforme_nom?.trim() ?? ''
  if ((choix.transmise_par === 'plateforme') !== (plateforme !== '')) {
    refus.push('Une facture transmise par une plateforme agréée la nomme, et seule celle-là.')
  } else if (plateforme.length > NOM_DE_PLATEFORME_MAX) {
    refus.push(`Le nom de la plateforme tient en ${NOM_DE_PLATEFORME_MAX} caractères.`)
  }

  const encaisse = choix.encaisse_avant_reprise_centimes
  if (!Number.isSafeInteger(encaisse) || encaisse < 0) {
    refus.push('L’encaissé avant la reprise est un nombre entier de centimes, positif ou nul.')
  } else if (lue.type === 'avoir' && encaisse !== 0) {
    refus.push('Un avoir ne porte pas d’encaissé avant la reprise : il s’impute sur sa facture.')
  } else if (lue.type === 'facture' && encaisse > lue.ttc_centimes) {
    refus.push(`L’encaissé avant la reprise dépasse le TTC de la facture (${euros(lue.ttc_centimes)}).`)
  }

  if (refus.length > 0 || nature === null || option === null) return { refus }

  const facture: FactureAImporter = {
    numero: lue.numero,
    type: lue.type,
    date_emission: lue.date_emission,
    tiers_nom: lue.tiers_nom,
    type_client: choix.type_client,
    nature_operation: nature,
    option_debits: option,
    montant_ht: euro(lue.ht_centimes),
    montant_tva: euro(lue.tva_centimes),
    montant_ttc: euro(lue.ttc_centimes),
    lignes: lue.lignes.map((l, i) => ({
      designation: l.designation,
      quantite: l.quantite,
      prix_unitaire_ht: l.prix_unitaire_ht,
      taux_tva: l.taux_tva,
      ...(nature === 'mixte' ? { nature: (choix.natures_des_lignes as readonly ('biens' | 'services')[])[i] } : {}),
      ...(l.unite !== null ? { unite: l.unite } : {}),
    })),
    encaisse_avant_reprise: euro(encaisse),
    transmise_par: choix.transmise_par,
  }
  if (lue.origine_numero !== null) facture.origine_numero = lue.origine_numero
  if (lue.date_echeance !== null) facture.date_echeance = lue.date_echeance
  if (lue.tiers_adresse !== null) facture.tiers_adresse = lue.tiers_adresse
  if (lue.tiers_siren !== null) facture.tiers_siren = lue.tiers_siren
  if (lue.tiers_siret !== null) facture.tiers_siret = lue.tiers_siret
  if (choix.transmise_par === 'plateforme') facture.plateforme_nom = plateforme
  return { facture }
}
