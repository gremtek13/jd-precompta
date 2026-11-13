// LA RÉPÉTITION D'UNE ANNÉE, SECONDE PASSE (MVP-D6) — ce que la première passe (src/lib/repetitionDUneAnnee.test.ts) n'a pas
// éprouvé, et que le 20 novembre 2026 rencontrera : l'année 2025 réelle entrera en NOVEMBRE 2026, probablement par douze
// relevés mensuels. Les mêmes données (src/test/repetitionDUneAnnee.ts), les mêmes attendus ; trois parcours de plus :
//   1. douze relevés mensuels tirés du même relevé annuel, importés l'un après l'autre par le chemin de l'onglet Banque
//      (`ImportCsv`, BanqueTab.tsx : `decoderReleve`, `lireReleveOfxQif` ou la détection des colonnes, `interpreterReleve`, les
//      refus du réglage, `partagerParMultiplicite`, `recouvrements` à confirmer, l'insertion, `controlerSolde` enregistré par
//      fichier), puis les cas réels — un mois importé deux fois, deux fichiers qui se recouvrent, un export du plus récent au
//      plus ancien, un mois manquant, un OFX parmi des CSV ; et la suite des soldes d'un fichier au suivant (RELEVE-Q1,
//      `phraseDeLaSuiteDuFichier`, lib/suiteDesReleves.ts), dite à l'import et dans la Vue d'ensemble ;
//   2. l'horloge au 20/11/2026, à Paris : la Checklist et les préalables de la validation de 2025, sur l'année complète ;
//   3. l'ouverture de 2026 : la validation de 2025 simulée (ce que l'application envoie, `report` ; ce qu'elle relit, les
//      soldes reportés que `soldes_a_reporter` écrit), puis l'ouverture de 2026 confrontée au bilan de clôture de 2025.
//
// Un écart ou un blocage ne se corrige pas ici, ni dans un moteur : il se marque `it.fails` ou `it.todo` avec sa cause.

import { AUCUNE_PIECE_CITEE } from './facturesSources'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { detectColumnMapping, lignesDeDonnees, parseCsv } from './csv'
import {
  AUCUNE_DECISION, douteDuSens, interpreterReleve, partagerParMultiplicite, phraseDesEcartees, phraseDesRecouvrements, recouvrements,
  refusDesLignesATrancher, refusDuReglage, signatureMouvement, type ReglageDeLImport,
} from './importReleve'
import { decoderReleve, lireReleveOfxQif, REGLAGE_OFX_QIF } from './releveOfxQif'
import { controlerSolde, phraseDesSoldes, type ControleSolde } from './soldeReleve'
import { relevesAuTrenteEtUn } from './releveAuTrenteEtUn'
import { controleDuFichier, PHRASE_FICHIER_SANS_SOLDES, phraseDeLaSuiteDuFichier } from './suiteDesReleves'
import { cotisationsComptees, ecritureDeLaCotisation } from './cotisationRapprochee'
import { concordance2035 } from './concordance2035'
import { calculerDeclaration2035 } from './declaration2035'
import { ecrituresAGenerer, piecesAComptabiliser } from './ecritures'
import { ecritureDuMouvement } from './affectationBanque'
import { ecritureDuVirementPersonnel } from './virementPersonnel'
import { ecritureDuCompteDeBilan } from './compteDeBilan'
import { ecritureDuForfait } from './forfaitKilometrique'
import { acquisitionsDesBiens, ecritureDeLaDotation } from './amortissements'
import { ecritureDeLOperation } from './caisse'
import {
  ecrituresDesVentesPourLa2035, etatsDesVentesFacturees, mouvementsClassesParEncaissements, type SourcesDesEcrituresDeVente,
} from './ecrituresVentesFactureesEcran'
import { CHAMPS_BNC_NON_EXPORTES } from './fec'
import { partsDuReleve } from './partsDuReleve'
import { pointsDeLaChecklist, type PointsDeLaChecklist } from './pointsDeLaChecklist'
import { prealablesDeValidation, type EtatDeValidation } from './prealablesValidation'
import { AUCUNE_SAISIE_2035 } from './saisies2035'
import { ventesDeLaChecklist } from './ventesDeLaChecklist'
import { paiementsDesPieces } from './rattachement'
import type { ControleReleveBancaire, EcritureBrouillon, LigneBancaire, SoldeReporte } from './types'
import { SANS_ACOMPTE, ventesFacturees } from './ventesFacturees'
import { lignesAuBrouillon, ecrituresDesVentesFacturees } from './ecrituresVentesFacturees'
import { recettesDeCaisseDuDossier, recettesPourLesMoteurs, type CaisseLue } from './recettesDeCaisse'
import { operationsDeCaisseDuDossier, operationsPourLesControles } from './controlesDeLaCaisse'
import { paiementsParLaCaisseDuDossier } from './paiementParLaCaisse'
import { confronterLOuverture, type ConfrontationDeLOuverture } from './ouvertureConfrontee'
import { ouvertureDeLExercice } from './reportDesSoldes'
import { frontiereDeValidation } from './validationExercice'
import { anneeEtMoisEcoules, aujourdHuiAParis, formatMoney, premierJourDuMoisCourant } from './format'
import { NON_VALIDEE } from '../test/ecritures'
import { modeleDeTest } from '../test/modeles'
import {
  ANNEE, A_NOUVEAUX, CATEGORIES, COTISATIONS, D, FACTURES, IMMOBILISATIONS, MOUVEMENTS, NATURE_MATERIEL, OPERATIONS_DE_CAISSE, PIECES,
  SOLDE_DU_01_01, SOLDE_DU_31_12_IMPRIME, VEHICULES, encaissementsEtParts, reglementsDuMouvement, texteDuReleveCsv,
  type MouvementDeLAnnee,
} from '../test/repetitionDUneAnnee'
import { banquesDuDossier } from './banqueDuMouvement'
import { INVENTAIRE_SANS_OBJET } from './inventaireDeLaValidation'

const MODELE = modeleDeTest('tresorerie')
const PLAN = MODELE.plan
const ASSUJETTI = false
const deux = (n: number) => String(n).padStart(2, '0')
const c = (n: number) => Math.round(n * 100)

// ── Les fichiers mensuels, tels qu'une banque les exporte ────────────────────────────────────────────────────────────────
// La banque imprime ses deux soldes : celui d'ouverture (la veille au soir du premier jour de la période) et celui de clôture
// (les opérations du fichier ajoutées). Ils se tirent ici du relevé de l'année, ce que la banque fait de son côté ; celui du
// 31/12 doit redonner le solde que la première passe écrit en clair (`SOLDE_DU_31_12_IMPRIME`), et un test le vérifie.
const soldeAvant = (date: string) => c(SOLDE_DU_01_01) + MOUVEMENTS.filter((x) => x.date < date).reduce((s, x) => s + c(x.montant), 0)
const dernierJour = (mois: number) => new Date(Date.UTC(ANNEE, mois, 0)).getUTCDate()
const debutDuMois = (mois: number) => `${ANNEE}-${deux(mois)}-01`
const finDuMois = (mois: number) => `${ANNEE}-${deux(mois)}-${deux(dernierJour(mois))}`
const dateFr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
const francais = (centimes: number) => (Math.abs(centimes) / 100).toFixed(2).replace('.', ',')

interface Periode {
  du: string
  au: string
  // Les opérations de la période que l'export n'a pas encore : passée le jour même, après l'export.
  sauf?: readonly MouvementDeLAnnee[]
  // Du plus récent au plus ancien, comme certaines banques exportent.
  inverse?: boolean
}
const operationsDe = (p: Periode) => MOUVEMENTS.filter((x) => x.date >= p.du && x.date <= p.au && !(p.sauf ?? []).includes(x))

/** Un CSV « Débit / Crédit » de la période, encadré de ses deux soldes (un solde débiteur dans la colonne Débit). */
function csvDeLaPeriode(p: Periode): string {
  const ouverture = soldeAvant(p.du)
  const ops = operationsDe(p)
  const cloture = ouverture + ops.reduce((s, x) => s + c(x.montant), 0)
  const solde = (date: string, centimes: number) => `${dateFr(date)};SOLDE AU ${dateFr(date)};${centimes < 0 ? francais(centimes) : ''};${centimes >= 0 ? francais(centimes) : ''}`
  const corps = [
    solde(p.du, ouverture),
    ...ops.map((x) => `${dateFr(x.date)};${x.libelle};${x.montant < 0 ? francais(c(x.montant)) : ''};${x.montant > 0 ? francais(c(x.montant)) : ''}`),
    solde(p.au, cloture),
  ]
  return ['Date;Libellé;Débit;Crédit', ...(p.inverse ? corps.reverse() : corps)].join('\r\n')
}

/** Le même mois en OFX 1.x (SGML), son solde comptable à la fin de la période — un seul solde, comme les banques l'exportent. */
function ofxDeLaPeriode(p: Periode): string {
  const ops = operationsDe(p)
  const cloture = soldeAvant(p.du) + ops.reduce((s, x) => s + c(x.montant), 0)
  const entete = ['OFXHEADER:100', 'DATA:OFXSGML', 'VERSION:102', 'SECURITY:NONE', 'ENCODING:USASCII', 'CHARSET:1252',
    'COMPRESSION:NONE', 'OLDFILEUID:NONE', 'NEWFILEUID:NONE', ''].join('\r\n')
  const operations = ops.flatMap((x) => [
    '<STMTTRN>', `<TRNTYPE>${x.montant < 0 ? 'DEBIT' : 'CREDIT'}`, `<DTPOSTED>${x.date.replaceAll('-', '')}`, `<TRNAMT>${x.montant.toFixed(2)}`,
    `<FITID>MOIS${MOUVEMENTS.indexOf(x)}`, `<NAME>${x.libelle}`, '</STMTTRN>',
  ])
  const stmtrs = [
    '<STMTRS>', '<CURDEF>EUR', '<BANKACCTFROM>', '<BANKID>99999', '<BRANCHID>00001', '<ACCTID>00012345678', '<ACCTTYPE>CHECKING', '</BANKACCTFROM>',
    '<BANKTRANLIST>', `<DTSTART>${p.du.replaceAll('-', '')}`, `<DTEND>${p.au.replaceAll('-', '')}`, ...operations, '</BANKTRANLIST>',
    '<LEDGERBAL>', `<BALAMT>${(cloture / 100).toFixed(2)}`, `<DTASOF>${p.au.replaceAll('-', '')}`, '</LEDGERBAL>', '</STMTRS>',
  ].join('\r\n')
  return `${entete}\r\n<OFX>\r\n<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>20261105<LANGUAGE>FRA</SONRS></SIGNONMSGSRSV1>\r\n`
    + `<BANKMSGSRSV1>\r\n<STMTTRNRS><TRNUID>0<STATUS><CODE>0<SEVERITY>INFO</STATUS>\r\n${stmtrs}\r\n</STMTTRNRS>\r\n</BANKMSGSRSV1>\r\n</OFX>\r\n`
}

const mois = (m: number, x: Omit<Periode, 'du' | 'au'> = {}): Periode => ({ du: debutDuMois(m), au: finDuMois(m), ...x })
const nomDuMois = (m: number) => `releve-${ANNEE}-${deux(m)}.csv`
const DOUZE = Array.from({ length: 12 }, (_, i) => i + 1)

// ── L'onglet Banque, simulé : son relevé en base, ses contrôles, et l'import d'un fichier dans l'ordre de `ImportCsv` ──────
interface LigneEnBase { date: string; libelle: string; montant: number; source_fichier: string | null; libelle_brut: string | null }
interface CompteRendu {
  /** Le message d'erreur de l'écran ; rien n'est alors importé. */
  erreur: string | null
  inserees: number
  doublons: number
  /** La phrase de la confirmation d'un recouvrement, avant l'insertion (`confirmerRecouvrement`). */
  recouvrement: string | null
  /** Ce que l'alerte d'après l'import dit des soldes (une ligne de solde, ou plus de deux) et du contrôle. */
  phraseSoldes: string | null
  controle: ControleSolde | null
  /** Ce que l'alerte d'après l'import dit de la suite des soldes avec les relevés déjà importés (RELEVE-Q1). */
  suite: string | null
  ecartees: string | null
  doute: string | null
}

class Banque {
  lignes: LigneEnBase[] = []
  // `upsert` sur (dossier_id, source_fichier) : le même nom remplace son contrôle (lib/controlesReleves.ts).
  controles = new Map<string, ControleSolde>()

  importer(nom: string, texte: string, confirmer: (phrase: string) => boolean = () => true): CompteRendu {
    const vide: CompteRendu = { erreur: null, inserees: 0, doublons: 0, recouvrement: null, phraseSoldes: null, controle: null, suite: null, ecartees: null, doute: null }
    // `handleFile` : les octets décodés, un OFX ou un QIF reconnu au contenu, sinon la détection des colonnes d'un CSV.
    const { texte: decode } = decoderReleve(new TextEncoder().encode(texte))
    const ofx = lireReleveOfxQif(decode)
    let rows: string[][]
    let reglage: ReglageDeLImport
    let ligneEnTete: number | null = null
    if (ofx) {
      if (ofx.refus !== null) return { ...vide, erreur: `refusé : ${ofx.refus}` }
      rows = ofx.lignes as string[][]
      reglage = REGLAGE_OFX_QIF
    } else {
      rows = parseCsv(decode)
      const d = detectColumnMapping(rows)
      reglage = {
        colDate: d.colDate, colLibelle: d.colLibelle, hasHeader: d.hasHeader, format: d.format, colMontant: d.colMontant,
        colDebit: d.colDebit, colCredit: d.colCredit, colSolde: d.colSolde,
      }
      ligneEnTete = d.ligneEnTete
    }
    const { donnees } = lignesDeDonnees(rows, reglage.hasHeader, ligneEnTete)
    const interpretation = interpreterReleve(donnees, reglage, AUCUNE_DECISION)
    // `handleImport`, dans son ordre.
    const refus = refusDuReglage(reglage) ?? refusDesLignesATrancher(interpretation.aTrancher)
    if (refus) return { ...vide, erreur: refus }
    const { operations, soldes, ecartees } = interpretation
    const toInsert = operations.map((o) => ({ date: o.date, libelle: o.libelle, montant: o.montant, source_fichier: nom, libelle_brut: o.brut }))
    const { nouvelles, dejaPresentes: doublons } = partagerParMultiplicite(toInsert, this.lignes)
    const aInserer = nouvelles // aucun exercice validé : rien n'est figé (`estFigee`, frontière nulle)
    if (aInserer.length === 0) {
      return { ...vide, doublons, erreur: doublons > 0 ? 'Ce relevé semble déjà importé (mêmes date, libellé et montant).' : 'Aucune ligne exploitable — vérifie le mapping des colonnes.' }
    }
    const recouvrement = phraseDesRecouvrements(recouvrements(aInserer.map((l) => l.date), this.lignes))
    if (recouvrement !== null && !confirmer(recouvrement)) return { ...vide, doublons, recouvrement }
    this.lignes.push(...aInserer)
    const controle = controlerSolde(soldes, toInsert)
    // `handleImport` : les contrôles déjà en base, le relevé tel qu'il est devenu, le contrôle du fichier.
    const suite = controle ? phraseDeLaSuiteDuFichier(this.controlesEnBase(), this.lignes, controleDuFichier(nom, controle))
      : soldes.length > 0 ? phraseDeLaSuiteDuFichier(this.controlesEnBase(), this.lignes, null) : null
    if (controle) this.controles.set(nom, controle)
    return {
      erreur: null, inserees: aInserer.length, doublons, recouvrement, controle, suite, ecartees: phraseDesEcartees(ecartees),
      phraseSoldes: soldes.length > 0 ? phraseDesSoldes(soldes.length) : null, doute: douteDuSens(reglage, interpretation.operations),
    }
  }

  /** Les contrôles tels que la base les garde (`controles_releves_bancaires`). */
  controlesEnBase(): ControleReleveBancaire[] {
    return [...this.controles].map(([source, k], i) => ({
      id: `00000000-0000-4000-8012-${String(i).padStart(12, '0')}`, dossier_id: D, source_fichier: source, solde_initial: k.soldeInitial,
      solde_final: k.soldeFinal, somme_mouvements: k.sommeMouvements, ecart: k.ecart, coherent: k.coherent, periode_debut: k.dateInitiale,
      periode_fin: k.dateFinale, created_at: '2026-11-20T10:00:00Z',
    }))
  }
}

/** Le relevé en base, en multiensemble de signatures triées : l'ordre d'arrivée ne compte pas, une ligne en double si. */
const multiensemble = (lignes: readonly { date: string; libelle: string; montant: number }[]) => lignes.map(signatureMouvement).sort()

// Le relevé de la première passe : le relevé annuel importé d'un seul fichier, par le même chemin.
function releveDeLaPremierePasse(): string[] {
  const b = new Banque()
  const r = b.importer('releve-2025.csv', texteDuReleveCsv())
  if (r.erreur !== null || r.controle?.coherent !== true) throw new Error(`La première passe ne se rejoue pas : ${r.erreur}`)
  return multiensemble(b.lignes)
}

function douzeMois(b: Banque, ordre: readonly number[] = DOUZE, x: Omit<Periode, 'du' | 'au'> = {}): CompteRendu[] {
  return ordre.map((m) => b.importer(nomDuMois(m), csvDeLaPeriode(mois(m, x))))
}

// ── Le parcours de la première passe, sur le relevé tel qu'il est en base ────────────────────────────────────────────────
// Le même chemin que le `beforeAll` de la première passe (Clôture, Vue d'ensemble), paramétré par le relevé importé, ses
// contrôles, l'horloge et l'état de la validation. Chaque ligne en base retrouve son classement par sa signature.
interface Horloge { aujourdHui: string; anneeCourante: number; moisEcoules: number; premierJourDuMois: string }
interface EtatDeLaValidation { anneesValidees: number[]; soldesReportes: SoldeReporte[] }
const AVANT_VALIDATION: EtatDeLaValidation = { anneesValidees: [], soldesReportes: [] }

function parcours(enBase: readonly LigneEnBase[], controles: ControleReleveBancaire[], h: Horloge, v: EtatDeLaValidation = AVANT_VALIDATION): {
  lignes: LigneBancaire[]; brouillon: EcritureBrouillon[]; checklist: PointsDeLaChecklist; validation: EtatDeValidation
} {
  const indexParSignature = new Map(MOUVEMENTS.map((x, i) => [signatureMouvement(x), i]))
  const rangs = enBase.map((l) => {
    const i = indexParSignature.get(signatureMouvement(l))
    if (i === undefined) throw new Error(`Une ligne en base n'est pas du relevé de l'année : ${signatureMouvement(l)}`)
    return { l, i }
  }).sort((a, b) => a.i - b.i)
  const lignes: LigneBancaire[] = rangs.map(({ l, i }) => {
    const k = MOUVEMENTS[i].classement
    return {
      id: `00000000-0000-4000-8002-${String(i).padStart(12, '0')}`, dossier_id: D, date: l.date, libelle: l.libelle, montant: l.montant,
      statut: k.type === 'personnel' ? 'ignoree' : 'rapprochee',
      piece_id: k.type === 'piece' ? k.pieceId : null, cotisation_id: k.type === 'cotisation' ? k.cotisationId : null,
      categorie_id: k.type === 'categorie' ? k.categorie.id : null, taux_tva: null, prelevement_personnel: k.type === 'personnel',
      emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false,
      reglement_groupe: k.type === 'groupe', compte_bilan: k.type === 'caisse' ? PLAN.caisse : null, declaration_tva_id: null,
      id_externe: null, source_fichier: l.source_fichier, libelle_brut: l.libelle_brut, created_at: '2026-11-15T10:00:00Z',
      encaissements_de_factures: k.type === 'encaissements',
    }
  })
  const classementDe = (l: LigneBancaire) => MOUVEMENTS[rangs[lignes.indexOf(l)].i].classement
  const reglements = lignes.flatMap((l) => { const k = classementDe(l); return k.type === 'groupe' ? reglementsDuMouvement(l.id, k.parts) : [] })
  const { encaissements, parts } = encaissementsEtParts((factureId) => {
    const l = lignes.find((x) => { const k = classementDe(x); return k.type === 'encaissements' && k.factureId === factureId })
    return l?.id ?? null
  })
  const factures = FACTURES.map((f) => f.facture)
  const lignesDeFacture = FACTURES.map((f) => f.ligne)
  const caisseLue: CaisseLue = { dossierId: D, enBase: true, lignes: OPERATIONS_DE_CAISSE, complete: true, motif: null }
  const recettesDeCaisse = recettesPourLesMoteurs(recettesDeCaisseDuDossier(caisseLue, D, CATEGORIES, ASSUJETTI))
  const operationsDeCaisse = operationsPourLesControles(operationsDeCaisseDuDossier(caisseLue, D))
  const paiementsDeLaCaisse = paiementsParLaCaisseDuDossier(caisseLue, D)
  if (recettesDeCaisse === null || operationsDeCaisse === null || paiementsDeLaCaisse === null) throw new Error('La caisse ne se lit pas.')
  const paiements = paiementsDesPieces(lignes, reglements, [], paiementsDeLaCaisse)
  const partsReleve = partsDuReleve(lignes, CATEGORIES, [], ASSUJETTI)
  const comptees = cotisationsComptees(COTISATIONS, lignes, MODELE.mode)
  const ventes = ventesFacturees({ piecesCitees: AUCUNE_PIECE_CITEE, dossierId: D, factures, lignes: lignesDeFacture, encaissements, parts, acomptes: SANS_ACOMPTE })
  const mouvementsDesEncaissements = lignes.filter((l) => l.encaissements_de_factures)
  const sourcesEcritures: SourcesDesEcrituresDeVente = { piecesCitees: AUCUNE_PIECE_CITEE,
    dossierId: D, factures, lignes: lignesDeFacture, encaissements, parts, mouvements: mouvementsDesEncaissements, exemplaires: [], reprises: [],
  }
  const pourLa2035 = ecrituresDesVentesPourLa2035({
    dossierId: D, ventesParLesFactures: true, facturesSources: ventes.sources, lecture: { dossierId: D, etat: 'lue', sources: sourcesEcritures },
    mode: MODELE.mode, plan: PLAN, banques: { cas: 'role', compte: PLAN.banque },
  })
  if (pourLa2035.etat !== 'pret') throw new Error(`Les écritures des ventes ne sont pas prêtes : ${pourLa2035.etat}`)

  let e = 0
  const ecriture = (x: Pick<EcritureBrouillon, 'date' | 'compte' | 'libelle' | 'montant' | 'sens'> & Partial<EcritureBrouillon>): EcritureBrouillon => ({
    ...NON_VALIDEE, id: `00000000-0000-4000-8008-${String(e++).padStart(12, '0')}`, dossier_id: D, statut: 'proposee',
    created_at: '2026-11-16T10:00:00Z', piece_id: null, ligne_bancaire_id: null, immobilisation_id: null, vehicule_id: null,
    declaration_tva_id: null, cotisation_id: null, encaissement_id: null, facture_id: null, operation_caisse_id: null, ...x,
  })
  const acquisitions = acquisitionsDesBiens(IMMOBILISATIONS, [NATURE_MATERIEL], null)
  const generation = ecrituresAGenerer(D, piecesAComptabiliser(PIECES, CATEGORIES, acquisitions, ventes.sources), [], ASSUJETTI, paiements, MODELE, null, banquesDuDossier({ etat: 'sans_objet' }, MODELE.plan))
  const brouillon: EcritureBrouillon[] = generation.lignes.map((l) => ecriture(l))
  for (const l of lignes) {
    const x = classementDe(l)
    const composees = x.type === 'categorie' ? ecritureDuMouvement(l, x.categorie.compte_comptable!, null, PLAN)
      : x.type === 'cotisation' ? ecritureDeLaCotisation(l, COTISATIONS.find((k) => k.id === x.cotisationId)!, MODELE.mode, PLAN)
        : x.type === 'personnel' ? ecritureDuVirementPersonnel(l, MODELE)
          : x.type === 'caisse' ? ecritureDuCompteDeBilan(l, PLAN.caisse, PLAN)
            : []
    for (const k of composees) brouillon.push(ecriture({ date: l.date, ...k, ligne_bancaire_id: l.id }))
  }
  for (const op of OPERATIONS_DE_CAISSE) {
    if (op.genre === 'paiement') continue
    const aEcrire = { genre: op.genre, date: op.date, montant: op.montant, taux_tva: op.taux_tva, categorie: op.genre === 'recette' ? CATEGORIES.find((k) => k.id === op.categorie_id)! : null }
    for (const k of ecritureDeLOperation(aEcrire, MODELE)) brouillon.push(ecriture({ date: op.date, ...k, operation_caisse_id: op.id }))
  }
  const composition = ecrituresDesVentesFacturees({
    sources: { dossierId: D, factures, lignes: lignesDeFacture, encaissements, parts },
    mouvements: mouvementsDesEncaissements, comptesDeContrepartie: new Map(), exemplaires: [], mode: MODELE.mode, plan: PLAN, banques: { cas: 'role', compte: PLAN.banque },
  })
  for (const w of composition.ecritures) for (const k of lignesAuBrouillon(D, w)) brouillon.push(ecriture(k))
  const fin = `${ANNEE}-12-31`
  for (const bien of IMMOBILISATIONS) {
    for (const k of ecritureDeLaDotation(bien, NATURE_MATERIEL.compte_immobilisation, ANNEE, null, PLAN)) brouillon.push(ecriture({ date: fin, ...k, immobilisation_id: bien.id }))
  }
  for (const w of VEHICULES) for (const k of ecritureDuForfait(w, MODELE, null) ?? []) brouillon.push(ecriture({ date: fin, ...k, vehicule_id: w.id }))

  const declaration = calculerDeclaration2035(ANNEE, PIECES, CATEGORIES, IMMOBILISATIONS, comptees, VEHICULES, ASSUJETTI, paiements, partsReleve, [], PLAN, ventes, pourLa2035.ecritures, recettesDeCaisse)
  const concordance = concordance2035(declaration, brouillon, {
    piecesValidees: new Set(PIECES.map((x) => x.id)), piecesImmobilisees: new Set(IMMOBILISATIONS.map((i) => i.piece_id ?? '')),
    mouvementsDesVentesFacturees: mouvementsClassesParEncaissements(lignes),
  }, null)
  const lectureDesSources = { dossierId: D, etat: 'lue' as const, sources: sourcesEcritures }
  const facturesEmises = factures.map((f) => ({ ...f, emetteur_siret: null, superpdp_invoice_id: null }))
  const frontiere = frontiereDeValidation(v.anneesValidees)

  const checklist = pointsDeLaChecklist({
    piecesValidees: PIECES, piecesAValider: [], cotisations: COTISATIONS, lignes, relevesIncoherents: controles.filter((k) => !k.coherent), controlesReleves: controles, comptesBancaires: { etat: 'sans_objet' }, doublonsTexte: [],
    immobilisations: IMMOBILISATIONS, natures: [NATURE_MATERIEL], categories: CATEGORIES, ecritures: brouillon, emprunts: [], ventilations: [],
    ventilationsPartielles: false, reglements, reglementsPartiels: false, paiementsPartiels: false, lettragesManuels: [], vehicules: VEHICULES,
    declarationsTva: [], declarationsPartielles: false, facturesEmises, transmissions: [], jumellesPartielles: false,
    facturesSources: ventes.sources, info: null, infoInconnue: null, anneesCloturees: [], ouverture: null, ouvertureIncomplete: null,
    aNouveaux: A_NOUVEAUX, soldesReportes: v.soldesReportes, entreesDeLOuvertureIncompletes: null, ventesFacturees: lectureDesSources, caisse: caisseLue,
    entreesDeLaCaisseIncompletes: null, entreesDeLaRepriseDesBiensIncompletes: null, inventaire: { etat: 'sans_objet' },
  }, {
    assujettiTva: ASSUJETTI, periodiciteTva: 'mensuelle', statutTva: 'exonere', modele: MODELE, frontiere, anneesValidees: v.anneesValidees,
    aujourdHui: h.aujourdHui, anneeCourante: h.anneeCourante, moisEcoules: h.moisEcoules, premierJourDuMois: h.premierJourDuMois,
  })

  const validation = prealablesDeValidation({
    annee: ANNEE, anneeCourante: h.anneeCourante, aujourdHui: h.aujourdHui, modele: MODELE, assujettiTva: ASSUJETTI, anneesValidees: v.anneesValidees,
    lectureIncomplete: null, piecesValidees: PIECES, piecesAValider: [], categories: CATEGORIES, immobilisations: IMMOBILISATIONS,
    natures: [NATURE_MATERIEL], ecritures: brouillon, lignes, ventilations: [], reglements, encaissees: [], cotisations: COTISATIONS,
    vehicules: VEHICULES, emprunts: [], aNouveaux: A_NOUVEAUX, soldesReportes: v.soldesReportes, declarationsTva: [], periodiciteTva: 'mensuelle',
    comptesBancaires: { etat: 'sans_objet' }, controlesReleves: controles, doublonsTexte: [], facturesEmises, transmissions: [], facturesSources: ventes.sources, piecesCitees: ventes.piecesCitees,
    etatsDesVentes: etatsDesVentesFacturees({ sources: sourcesEcritures, brouillon, mode: MODELE.mode, plan: PLAN, banques: { cas: 'role', compte: PLAN.banque }, anneesValidees: v.anneesValidees, ventesParLesFactures: true }),
    ventesDeLaChecklist: ventesDeLaChecklist(lectureDesSources, null), operationsDeCaisse, champsBnc: CHAMPS_BNC_NON_EXPORTES,
    declaration, saisies2035: AUCUNE_SAISIE_2035, inventaire: INVENTAIRE_SANS_OBJET, concordance,
  })
  return { lignes, brouillon, checklist, validation }
}

// L'horloge des écrans, lue comme la Vue d'ensemble (ChecklistTab) et Clôture (ClotureTab) la lisent, au 20/11/2026 à Paris.
function horlogeDuJour(): Horloge {
  const { annee, moisEcoules } = anneeEtMoisEcoules()
  const aujourdHui = aujourdHuiAParis()
  if (Number(aujourdHui.slice(0, 4)) !== annee) throw new Error('Clôture et la Vue d’ensemble lisent deux années différentes.')
  return { aujourdHui, anneeCourante: annee, moisEcoules, premierJourDuMois: premierJourDuMoisCourant() }
}

let PREMIERE_PASSE: string[]
beforeAll(() => {
  // 10 h à Paris le 20/11/2026 : le même jour civil sous les quatre fuseaux de `test:fuseaux` (Auckland à 22 h, New York à 4 h).
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-20T09:00:00Z'))
  PREMIERE_PASSE = releveDeLaPremierePasse()
})
afterAll(() => { vi.useRealTimers() })

// ═══ 1. Les douze relevés mensuels ════════════════════════════════════════════════════════════════════════════════════════
describe('la seconde passe : douze relevés mensuels, importés l’un après l’autre', () => {
  it('les douze fichiers redonnent les soldes que la banque imprime, dont celui du 31/12 de la première passe', () => {
    expect(soldeAvant(debutDuMois(1))).toBe(c(SOLDE_DU_01_01))
    expect(francais(soldeAvant(`${ANNEE + 1}-01-01`))).toBe(SOLDE_DU_31_12_IMPRIME.replace(/\s/g, ''))
    expect(new Set(MOUVEMENTS.map(signatureMouvement)).size).toBe(MOUVEMENTS.length)
  })

  it('dans l’ordre : chaque mois entre en entier, sans doublon ni recouvrement, et boucle ; le relevé final est celui de la première passe', () => {
    const b = new Banque()
    const r = douzeMois(b)
    expect(r.map((x) => x.erreur)).toEqual(DOUZE.map(() => null))
    expect(r.map((x) => x.inserees)).toEqual(DOUZE.map((m) => operationsDe(mois(m)).length))
    expect(r.map((x) => [x.doublons, x.recouvrement, x.phraseSoldes, x.ecartees, x.doute])).toEqual(DOUZE.map(() => [0, null, null, null, null]))
    expect(r.map((x) => x.controle?.coherent)).toEqual(DOUZE.map(() => true))
    // Chaque mois s'ouvre au solde où le précédent finit : la suite des soldes n'a rien à dire (RELEVE-Q1).
    expect(r.map((x) => x.suite)).toEqual(DOUZE.map(() => null))
    expect(multiensemble(b.lignes)).toEqual(PREMIERE_PASSE)
    expect(b.lignes).toHaveLength(MOUVEMENTS.length)
    // Le solde du 31/12 se lit sur le relevé de décembre, celui qui finit ce jour (la règle de la Révision et de MVPD7-Q2).
    const auTrenteEtUn = relevesAuTrenteEtUn(b.controlesEnBase(), b.lignes, ANNEE)
    expect(auTrenteEtUn.soldes.map((s) => [s.controle.source_fichier, s.lu, s.lu === null ? null : s.centimes])).toEqual([[nomDuMois(12), 'solde_final', 421531]])
  })

  it('un mois importé deux fois : la seconde fois n’importe rien, compte ses doublons et le dit ; sous un autre nom aussi', () => {
    const b = new Banque()
    douzeMois(b)
    const n = operationsDe(mois(3)).length
    const meme = b.importer(nomDuMois(3), csvDeLaPeriode(mois(3)))
    expect(meme).toMatchObject({ inserees: 0, doublons: n, erreur: 'Ce relevé semble déjà importé (mêmes date, libellé et montant).' })
    const copie = b.importer('releve-2025-03 (1).csv', csvDeLaPeriode(mois(3)))
    expect(copie).toMatchObject({ inserees: 0, doublons: n, erreur: 'Ce relevé semble déjà importé (mêmes date, libellé et montant).' })
    expect(multiensemble(b.lignes)).toEqual(PREMIERE_PASSE)
    // Aucun contrôle de plus : la copie n'a rien importé, et rien ne s'enregistre avant l'insertion.
    expect([...b.controles.keys()]).toEqual(DOUZE.map(nomDuMois))
  })

  it('deux fichiers qui se recouvrent de quelques jours, identiques sur leur recouvrement : les doublons se comptent, rien ne se confirme', () => {
    // Mars exporté jusqu'au 05/04, puis avril entier : du 01/04 au 05/04, trois mouvements (le loyer et le virement de l'appareil
    // le 03/04, l'Urssaf le 05/04).
    const b = new Banque()
    const avant = douzeMois(b, [1, 2])
    const marsEtDebutAvril = b.importer('releve-2025-03-au-05-04.csv', csvDeLaPeriode({ du: debutDuMois(3), au: `${ANNEE}-04-05` }))
    const avril = b.importer(nomDuMois(4), csvDeLaPeriode(mois(4)))
    const apres = douzeMois(b, [5, 6, 7, 8, 9, 10, 11, 12])
    const communs = operationsDe({ du: debutDuMois(4), au: `${ANNEE}-04-05` }).length
    expect(communs).toBe(3)
    expect(marsEtDebutAvril).toMatchObject({ erreur: null, doublons: 0, recouvrement: null, controle: { coherent: true } })
    expect(avril).toMatchObject({ erreur: null, doublons: communs, inserees: operationsDe(mois(4)).length - communs, recouvrement: null, controle: { coherent: true } })
    expect([...avant, ...apres].every((x) => x.erreur === null && x.controle?.coherent === true)).toBe(true)
    // Mars porte le solde du matin du 01/04 (son final, moins ses trois mouvements d'avril) : celui où avril s'ouvre.
    expect([...avant, marsEtDebutAvril, avril, ...apres].map((x) => x.suite)).toEqual(DOUZE.map(() => null))
    expect(multiensemble(b.lignes)).toEqual(PREMIERE_PASSE)
  })

  it('deux fichiers qui se recouvrent, le premier exporté avant une opération du dernier jour : le recouvrement se confirme, l’opération entre une fois', () => {
    // Janvier exporté le 28/01 avant le virement personnel du jour ; puis un fichier du 28/01 au 28/02, qui le porte.
    const virementDu28 = MOUVEMENTS.find((x) => x.date === `${ANNEE}-01-28` && x.libelle === 'VIR COMPTE PERSONNEL')!
    const b = new Banque()
    const confirmations: string[] = []
    const janvier = b.importer(nomDuMois(1), csvDeLaPeriode({ du: debutDuMois(1), au: `${ANNEE}-01-28`, sauf: [virementDu28] }))
    const fevrier = b.importer('releve-2025-01-28-au-02-28.csv', csvDeLaPeriode({ du: `${ANNEE}-01-28`, au: finDuMois(2) }), (phrase) => { confirmations.push(phrase); return true })
    const suite = douzeMois(b, [3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(janvier).toMatchObject({ erreur: null, recouvrement: null, controle: { coherent: true } })
    // Le frais de tenue de compte du 28/01 est dans les deux : un doublon ; le virement du 28/01, nouveau, tombe dans la période
    // de janvier déjà importée : la confirmation le dit avant l'insertion, en nommant le fichier recouvert.
    expect(fevrier).toMatchObject({ erreur: null, doublons: 1, controle: { coherent: true } })
    expect(confirmations).toHaveLength(1)
    expect(confirmations[0]).toContain(`« ${nomDuMois(1)} »`)
    expect(suite.every((x) => x.erreur === null && x.recouvrement === null && x.controle?.coherent === true)).toBe(true)
    // Janvier, arrêté le 28 avant le virement du jour, porte le solde du matin du 28/01 : celui où le fichier suivant s'ouvre.
    // Aucune rupture inventée par l'export en cours de journée.
    expect([janvier, fevrier, ...suite].map((x) => x.suite)).toEqual(DOUZE.map(() => null))
    expect(multiensemble(b.lignes)).toEqual(PREMIERE_PASSE)
  })

  it('le recouvrement refusé à la confirmation n’importe rien du fichier, et le relevé le montre : il ne boucle plus avec le suivant', () => {
    const virementDu28 = MOUVEMENTS.find((x) => x.date === `${ANNEE}-01-28` && x.libelle === 'VIR COMPTE PERSONNEL')!
    const b = new Banque()
    b.importer(nomDuMois(1), csvDeLaPeriode({ du: debutDuMois(1), au: `${ANNEE}-01-28`, sauf: [virementDu28] }))
    const refuse = b.importer('releve-2025-01-28-au-02-28.csv', csvDeLaPeriode({ du: `${ANNEE}-01-28`, au: finDuMois(2) }), () => false)
    expect(refuse.inserees).toBe(0)
    expect(refuse.recouvrement).not.toBeNull()
    // Rien de février n'est en base : le geste du cabinet, dit par la phrase qu'il a refusée, pas une perte silencieuse.
    expect(b.lignes.filter((l) => l.date >= `${ANNEE}-01-29`)).toEqual([])
  })

  it('un export du plus récent au plus ancien, les mois importés de décembre à janvier : tout entre, tout boucle', () => {
    const b = new Banque()
    const r = douzeMois(b, [...DOUZE].reverse(), { inverse: true })
    expect(r.map((x) => [x.erreur, x.doublons, x.recouvrement, x.phraseSoldes, x.ecartees])).toEqual(DOUZE.map(() => [null, 0, null, null, null]))
    expect(r.map((x) => x.controle?.coherent)).toEqual(DOUZE.map(() => true))
    // Les deux soldes se reconnaissent à leur DATE, pas à leur place dans le fichier.
    expect(r[0].controle).toMatchObject({ dateInitiale: debutDuMois(12), dateFinale: finDuMois(12), soldeFinal: 4215.31 })
    // Importé avant le mois qui le précède, chaque fichier se confronte à son SUIVANT : rien à dire non plus.
    expect(r.map((x) => x.suite)).toEqual(DOUZE.map(() => null))
    expect(multiensemble(b.lignes)).toEqual(PREMIERE_PASSE)
  })

  it('un OFX parmi des CSV (juin) : ses opérations sont celles du CSV ; un seul solde, le mois s’importe sans contrôle, et l’alerte le dit', () => {
    const b = new Banque()
    const r = DOUZE.map((m) => (m === 6 ? b.importer(`releve-${ANNEE}-06.ofx`, ofxDeLaPeriode(mois(6))) : b.importer(nomDuMois(m), csvDeLaPeriode(mois(m)))))
    expect(r.map((x) => x.erreur)).toEqual(DOUZE.map(() => null))
    expect(r[5]).toMatchObject({ inserees: operationsDe(mois(6)).length, doublons: 0, recouvrement: null, controle: null })
    expect(r[5].phraseSoldes).toBe(phraseDesSoldes(1))
    // Juin n'a pas de contrôle : il ne se compare pas, et mai et juillet, que ses mouvements séparent, non plus — dit, sans
    // rupture inventée (RELEVE-Q1).
    expect(r[5].suite).toBe(PHRASE_FICHIER_SANS_SOLDES)
    expect(r[6].suite).toBe(`Le relevé du 01/05/${ANNEE} au 31/05/${ANNEE} (« ${nomDuMois(5)} ») et le relevé du 01/07/${ANNEE} au 31/07/${ANNEE} `
      + `(« ${nomDuMois(7)} ») ne se comparent pas : des mouvements datés entre les deux ne viennent d’aucun relevé contrôlé (un fichier sans ses deux soldes, ou une saisie).`)
    expect(r.filter((_, i) => i !== 5 && i !== 6).map((x) => x.suite)).toEqual(DOUZE.slice(2).map(() => null))
    expect(parcours(b.lignes, b.controlesEnBase(), horlogeDuJour()).checklist.tousLesPointsATraiter.find((x) => x.id === 'releves-en-rupture')?.nb).toBe(0)
    expect(multiensemble(b.lignes)).toEqual(PREMIERE_PASSE)
    // Juin redéposé en CSV ensuite : ses lignes ont la même signature, rien n'entre deux fois.
    const juinEnCsv = b.importer(nomDuMois(6), csvDeLaPeriode(mois(6)))
    expect(juinEnCsv).toMatchObject({ inserees: 0, doublons: operationsDe(mois(6)).length })
    expect(multiensemble(b.lignes)).toEqual(PREMIERE_PASSE)
  })

  it('un mois manquant (août) : chaque fichier boucle ; l’import de septembre dit la rupture, la Vue d’ensemble réclame août, la validation avertit', () => {
    const b = new Banque()
    const r = douzeMois(b, DOUZE.filter((m) => m !== 8))
    expect(r.every((x) => x.erreur === null && x.controle?.coherent === true && x.recouvrement === null)).toBe(true)
    // RELEVE-Q1 : juillet finit où août aurait commencé, septembre s'ouvre ailleurs — de la somme d'août, 1 137,50.
    expect(r.map((x) => x.suite !== null)).toEqual([...Array<boolean>(7).fill(false), true, false, false, false])
    expect(r[7].suite).toContain(`⚠ Le relevé du 01/07/${ANNEE} au 31/07/${ANNEE} (« ${nomDuMois(7)} ») finit à`)
    expect(r[7].suite).toContain(`un écart de ${formatMoney(1137.5)}.`)
    expect(b.lignes).toHaveLength(MOUVEMENTS.length - operationsDe(mois(8)).length)
    const p = parcours(b.lignes, b.controlesEnBase(), horlogeDuJour())
    // L'exercice 2025 n'est pas clôturé : la Vue d'ensemble le réclame encore, mois par mois.
    expect(p.checklist.documentsAttendus.find((x) => x.id === `banque-${ANNEE}`)).toMatchObject({ ok: false, detail: 'Mois manquants : août' })
    // Le 512 des écritures n'a pas les mouvements d'août : il diffère du relevé de décembre de leur somme, et la validation
    // l'avertit (MVPD7-Q2). Août, à la main : honoraires 120, Assurance maladie 4 000, loyer −800, Urssaf −650, retraite −1 800,
    // frais −7,50, virement personnel −2 000.
    const aout = 120 + 4000 - 800 - 650 - 1800 - 7.5 - 2000
    expect(c(aout)).toBe(operationsDe(mois(8)).reduce((s, x) => s + c(x.montant), 0))
    const banque = p.validation.prealables.find((x) => x.id === 'banque-au-releve')
    expect(banque?.bloquant).toBe(false)
    expect(banque?.message).toContain(`de solde final ${formatMoney(4215.31)} : un écart de ${formatMoney(-aout)}.`)
    expect(p.checklist.tousLesPointsATraiter.find((x) => x.id === 'releves-en-rupture')).toMatchObject({ nb: 1, severite: 'attention', cible: 'banque' })
    // Importé ensuite, août complète le relevé : celui de la première passe, rien en double, et la suite des soldes se referme.
    const tardif = b.importer(nomDuMois(8), csvDeLaPeriode(mois(8)))
    expect(tardif).toMatchObject({ erreur: null, doublons: 0, recouvrement: null, controle: { coherent: true }, suite: null })
    expect(multiensemble(b.lignes)).toEqual(PREMIERE_PASSE)
    expect(parcours(b.lignes, b.controlesEnBase(), horlogeDuJour()).checklist.tousLesPointsATraiter.find((x) => x.id === 'releves-en-rupture')?.nb).toBe(0)
  })
  it('un mois incomplet (août exporté jusqu’au 15) : chaque fichier boucle ; l’import de septembre et la Vue d’ensemble disent la rupture, la validation avertit', () => {
    // RELEVE-Q1 (08/11/2026) : le solde de clôture d'août (15/08) confronté à l'ouverture de septembre (01/09). La Vue d'ensemble
    // compte les MOIS présents, et août en a : seule la suite des soldes voit la quinzaine manquante, à l'import de septembre et
    // en « attention ». La confrontation du 512 au relevé de décembre (MVPD7-Q2) dit le même écart, à la main — frais −7,50,
    // virement personnel −2 000.
    const quinzaine = { du: debutDuMois(8), au: `${ANNEE}-08-15` }
    const b = new Banque()
    const r = DOUZE.map((m) => b.importer(nomDuMois(m), csvDeLaPeriode(m === 8 ? quinzaine : mois(m))))
    expect(r.every((x) => x.erreur === null && x.controle?.coherent === true && x.recouvrement === null)).toBe(true)
    const finDuQuinze = formatMoney((soldeAvant(debutDuMois(8)) + operationsDe(quinzaine).reduce((s, x) => s + c(x.montant), 0)) / 100)
    const ouvertureDeSeptembre = formatMoney(soldeAvant(debutDuMois(9)) / 100)
    expect(r.map((x) => x.suite)).toEqual(DOUZE.map((m) => (m === 9
      ? `⚠ Le relevé du 01/08/${ANNEE} au 15/08/${ANNEE} (« ${nomDuMois(8)} ») finit à ${finDuQuinze} ; le relevé du 01/09/${ANNEE} au `
        + `30/09/${ANNEE} (« ${nomDuMois(9)} ») s'ouvre à ${ouvertureDeSeptembre} : un écart de ${formatMoney(7.5 + 2000)}. Des opérations `
        + 'manquent probablement entre les deux (un relevé exporté en partie, ou une période non importée) ; rien n’est bloqué, mais les '
        + 'totaux bancaires en dépendent.'
      : null)))
    const p = parcours(b.lignes, b.controlesEnBase(), horlogeDuJour())
    expect(p.checklist.documentsAttendus.filter((x) => x.id === `banque-${ANNEE}`)).toEqual([])
    // Un point « attention », jamais une erreur, qui mène à l'onglet Banque, où la rupture se montre.
    expect(p.checklist.tousLesPointsATraiter.filter((x) => x.nb > 0).map((x) => `${x.severite} ${x.id} (${x.nb})`)).toEqual(['attention releves-en-rupture (1)'])
    expect(p.checklist.tousLesPointsATraiter.find((x) => x.id === 'releves-en-rupture')).toMatchObject({
      cible: 'banque', detail: `du 01/08/${ANNEE} au 15/08/${ANNEE}, puis du 01/09/${ANNEE} au 30/09/${ANNEE} : un écart de ${formatMoney(2007.5)}.`,
    })
    // Le même mois importé dans l'autre sens — septembre d'abord, puis la quinzaine d'août : l'import d'août dit la rupture
    // avec le relevé qui le SUIT.
    const b2 = new Banque()
    const r2 = [...DOUZE.filter((m) => m !== 8), 8].map((m) => b2.importer(nomDuMois(m), csvDeLaPeriode(m === 8 ? quinzaine : mois(m))))
    expect(r2[11].suite).toContain(`« ${nomDuMois(8)} ») finit à ${finDuQuinze}`)
    const banque = p.validation.prealables.find((x) => x.id === 'banque-au-releve')
    expect(banque?.bloquant).toBe(false)
    expect(banque?.message).toContain(`un écart de ${formatMoney(7.5 + 2000)}.`)
  })
})

// ═══ 2. Le 20 novembre 2026, sur l'année complète ═════════════════════════════════════════════════════════════════════════
describe('la seconde passe : la Vue d’ensemble et la validation de 2025, le 20/11/2026', () => {
  let b: Banque
  let p: ReturnType<typeof parcours>
  beforeAll(() => {
    b = new Banque()
    douzeMois(b)
    p = parcours(b.lignes, b.controlesEnBase(), horlogeDuJour())
  })

  it('l’horloge des écrans dit le 20/11/2026 : dix mois de 2026 révolus', () => {
    expect(horlogeDuJour()).toEqual({ aujourdHui: '2026-11-20', anneeCourante: 2026, moisEcoules: 10, premierJourDuMois: '2026-11-01' })
  })

  it('la Checklist n’a aucune erreur', () => {
    expect(p.checklist.tousLesPointsATraiter.filter((x) => x.nb > 0 && x.severite === 'erreur').map((x) => `${x.id} (${x.nb}) ${x.label}`)).toEqual([])
  })

  it('la Checklist n’a aucun point d’attention qui tienne à la date du jour', () => {
    expect(p.checklist.tousLesPointsATraiter.filter((x) => x.nb > 0).map((x) => `${x.severite} ${x.id} (${x.nb})`)).toEqual([])
  })

  it('ce qui attend 2026 se réclame dans les documents attendus, jamais en erreur ; 2025, complet, ne réclame plus rien', () => {
    const attendus = p.checklist.documentsAttendus
    expect(attendus.filter((x) => x.id.endsWith(`-${ANNEE}`))).toEqual([])
    expect(attendus.find((x) => x.id === 'banque-2026')).toMatchObject({ ok: false, detail: 'Mois manquants : janvier, février, mars, avril, mai, juin, juillet, août, septembre, octobre' })
    expect(p.checklist.moisManquants).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('les préalables de la validation de 2025, le 20/11/2026 : rien ne bloque, rien n’avertit — douze relevés comme un seul', () => {
    expect(p.validation.prealables.map((x) => `${x.bloquant ? 'bloquant' : 'avertissement'} ${x.id}`)).toEqual([])
    expect(p.validation.validable).toBe(true)
    expect(p.validation.fecSansChampsBnc).toBe(true)
  })
})

// ═══ 3. L'ouverture de 2026 ═══════════════════════════════════════════════════════════════════════════════════════════════
describe('la seconde passe : 2025 validé, l’ouverture de 2026', () => {
  // Les soldes au 31/12/2025, à la main. Le compte de l'exploitant (108) : la reprise (4 000 au crédit), les virements
  // personnels (12 × 2 000), le prélèvement de caisse (100), la CSG-CRDS entière (2 425) au débit ; le forfait du véhicule payé
  // par l'exploitant (4 251) au crédit. Le résultat COMPTABLE : celui de la 2035 (23 964,31), plus les 6,8 points de CSG
  // déductible (1 700,00) que la 2035 déduit en BV et qu'aucune écriture ne porte. Une entreprise individuelle : le 108 et le
  // résultat passent au 101000 (`soldesAReporter`).
  const compte108 = 24000 + 100 + 2425 - 4000 - 4251 // 18 274,00 au débit
  const resultatComptable = 23964.31 + 1700 // 25 664,31
  const ATTENDU = [
    { compte: '101000', sens: 'credit', montant: resultatComptable - compte108 }, // 7 390,31
    { compte: '215400', sens: 'debit', montant: 3600 },
    { compte: '281540', sens: 'credit', montant: 540 },
    { compte: '512000', sens: 'debit', montant: 4215.31 },
    { compte: '530000', sens: 'debit', montant: 115 },
  ]
  let avant: ReturnType<typeof parcours>
  let reportes: SoldeReporte[]
  let apres: ReturnType<typeof parcours>
  let confrontation: ConfrontationDeLOuverture
  beforeAll(() => {
    const b = new Banque()
    douzeMois(b)
    const h = horlogeDuJour()
    avant = parcours(b.lignes, b.controlesEnBase(), h)
    // La validation : l'application envoie la numérotation (`demandeDeValidation`) ; la base écrit l'ouverture de 2026 par
    // `soldes_a_reporter`, dont `report` est le calcul que l'écran montre (lib/reportDesSoldes.ts, en centimes, le même).
    // L'application relit ces soldes reportés (`soldes_reportes`) et l'exercice validé. Les écritures de 2025 ne sont pas
    // remises ici sous leurs colonnes figées : ni le report ni la confrontation ne les lisent.
    const report = avant.validation.report
    if (report === null) throw new Error('La validation n’a pas de report.')
    reportes = report.soldes.map((s, i) => ({
      id: `00000000-0000-4000-8013-${String(i).padStart(12, '0')}`, dossier_id: D, date: report.date, compte: s.compte, libelle: s.libelle,
      sens: s.sens, montant: s.montant, source_nom: report.source, source_empreinte: 'empreinte-exercice-2025', created_at: '2026-11-20T10:05:00Z',
      compte_lib: null, ecriture_lib: null,
    }))
    apres = parcours(b.lignes, b.controlesEnBase(), h, { anneesValidees: [ANNEE], soldesReportes: reportes })
    confrontation = confronterLOuverture({
      exercice: ANNEE + 1, ecritures: apres.brouillon, categories: CATEGORIES, reprise: A_NOUVEAUX, reportes, anneesValidees: [ANNEE],
      pieces: PIECES, modele: MODELE, aujourdHui: h.aujourdHui,
    }, 'complete')
  })

  it('le report que la validation écrira : les soldes du 31/12/2025, à la main, équilibrés', () => {
    const report = avant.validation.report!
    expect(report).toMatchObject({ exercice: ANNEE, date: '2026-01-01', individuel: true, horsClasses: [], ecartCentimes: 0 })
    expect(c(report.resultat)).toBe(c(resultatComptable))
    expect(report.soldes.map((s) => ({ compte: s.compte, sens: s.sens, montant: c(s.montant) }))).toEqual(ATTENDU.map((a) => ({ ...a, montant: c(a.montant) })))
  })

  it('l’ouverture de 2026 est ce report, et elle seule (la balance reprise ouvre 2025)', () => {
    const ouverture = ouvertureDeLExercice(A_NOUVEAUX, reportes, ANNEE + 1)
    expect(ouverture.map((a) => [a.compte, a.sens, c(a.montant)])).toEqual(ATTENDU.map((a) => [a.compte, a.sens, c(a.montant)]))
  })

  it('l’ouverture de 2026, confrontée au bilan de clôture de 2025 : aucun écart', () => {
    expect(confrontation.etat).toBe('concordante')
  })

  it('la Vue d’ensemble, 2025 validé, ne dit aucun écart d’ouverture, ni aucune erreur', () => {
    expect(apres.checklist.tousLesPointsATraiter.filter((x) => x.nb > 0 && x.severite === 'erreur').map((x) => `${x.id} (${x.nb})`)).toEqual([])
    expect(apres.checklist.tousLesPointsATraiter.filter((x) => x.id === 'ouverture-en-ecart' && x.nb > 0)).toEqual([])
  })
})
