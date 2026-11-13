// LE FEC FICTIF DE L'ÉPREUVE DU FICHIER (lot FEC22f, première partie ; lignes 26.5 et 26.6, MVP-D5). L'année 2025 FICTIVE de
// la répétition générale (src/test/repetitionDUneAnnee.ts : un praticien BNC en trésorerie, exonéré de TVA, dossier basculé,
// sans aucun nom — « Particulier », « Fournisseur n ») passée par les VRAIS moteurs de l'application, dans l'ordre où les
// onglets les appellent : la génération des écritures des pièces, les écritures des mouvements du relevé, de la caisse, des
// ventes facturées, des dotations et du forfait, puis la numérotation (celle que la validation envoie à la base), le rendu
// des banques et la mise en forme de l'onglet Écritures (EcrituresTab, `fecRendu`). Rien n'est réécrit ici : une ligne du
// FEC qui paraîtrait fausse est un défaut de l'application, jamais un réglage de ce module.
//
// Deux fichiers : le FEC à dix-huit champs (le drapeau `CHAMPS_BNC_EXPORTES` baissé, l'état d'aujourd'hui) et le FEC à
// vingt-deux champs, que la numérotation reçoit par son PARAMÈTRE (`ChampsBncDuFec`, comme l'écran le bâtit), le choix de
// FEC22-Q1 passé sans valeur par défaut — la constante n'est jamais levée. La génération lit, elle, le drapeau à l'appel
// (lib/ecritureParReglement.ts) : fecFictif.test.ts prouve que, sur ce dossier, elle rend le même fichier dans ses deux états.
//
// Le dossier a été jugé par sa répétition (src/lib/repetitionDUneAnnee.test.ts) : la 2035 au centime d'attendus tirés à la
// main, la Checklist muette, la validation sans préalable. Ce module n'en redit rien ; il produit le fichier. Le lanceur :
// outils/fec/lancer.mjs. Le SIREN du nom de fichier est fabriqué (des chiffres qui se suivent, la clé de Luhn juste).

import { AUCUNE_PIECE_CITEE } from '../lib/facturesSources'
import { acquisitionsDesBiens, ecritureDeLaDotation } from '../lib/amortissements'
import { ecritureDuMouvement } from '../lib/affectationBanque'
import { banquesDuDossier } from '../lib/banqueDuMouvement'
import { RENDU_DES_BANQUES_AU_FEC, rendreLesBanquesAuFec } from '../lib/banquesAuFec'
import { ecritureDeLOperation } from '../lib/caisse'
import type { ChoixChampsBnc, FactureDuClient } from '../lib/champsBncDuFec'
import { ecritureDuCompteDeBilan } from '../lib/compteDeBilan'
import { operationsDeCaisseDuDossier, operationsPourLesControles } from '../lib/controlesDeLaCaisse'
import { ecritureDeLaCotisation } from '../lib/cotisationRapprochee'
import { ecrituresAGenerer, piecesAComptabiliser } from '../lib/ecritures'
import { ecrituresDesVentesFacturees, lignesAuBrouillon } from '../lib/ecrituresVentesFacturees'
import {
  CHAMPS_BNC_NON_EXPORTES, formaterFec, nomFichierFec, numeroterFec, type ChampsBncDuFec, type NumerotationFec,
} from '../lib/fec'
import { ecritureDuForfait } from '../lib/forfaitKilometrique'
import { lettrages } from '../lib/lettrage'
import { paiementsParLaCaisseDuDossier } from '../lib/paiementParLaCaisse'
import { paiementsDesPieces } from '../lib/rattachement'
import type { CaisseLue } from '../lib/recettesDeCaisse'
import type { EcritureBrouillon, LigneBancaire } from '../lib/types'
import { ventesFacturees, SANS_ACOMPTE } from '../lib/ventesFacturees'
import { ecritureDuVirementPersonnel } from '../lib/virementPersonnel'
import { NON_VALIDEE } from './ecritures'
import { modeleDeTest } from './modeles'
import {
  ANNEE, A_NOUVEAUX, CATEGORIES, COTISATIONS, D, FACTURES, IMMOBILISATIONS, MOUVEMENTS, NATURE_MATERIEL, OPERATIONS_DE_CAISSE, PIECES,
  VEHICULES, encaissementsEtParts, reglementsDuMouvement,
} from './repetitionDUneAnnee'

/** Le SIRET fabriqué du praticien fictif : son SIREN, 123456782, suit les chiffres et passe la clé de Luhn. */
export const SIRET_FICTIF = '12345678200010'
export const ANNEE_DU_FEC_FICTIF = ANNEE

const MODELE = modeleDeTest('tresorerie')
const PLAN = MODELE.plan
const ASSUJETTI = false
const FIN = `${ANNEE}-12-31`
const BANQUES = banquesDuDossier({ etat: 'sans_objet' }, PLAN)

export interface FecFictif {
  /** `<SIREN>FEC<AAAAMMJJ>.txt`, la date de clôture (LPF, art. A47 A-1 ; `nomFichierFec`). */
  nomFichier: string
  dixHuit: string
  vingtDeux: string
  /** Ce que le test confronte au fichier : les lignes du relevé (leurs libellés), les numéros des factures, le brouillon. */
  mouvements: readonly LigneBancaire[]
  numerosDesFactures: readonly string[]
  brouillon: readonly EcritureBrouillon[]
  aNouveaux: number
}

/** Le dossier fictif d'une année entière, composé par les moteurs, et ses deux FEC. */
export function composerLeFecFictif(choix: ChoixChampsBnc): FecFictif {
  // Le relevé, tel que la base le porte une fois importé et classé : le libellé de la banque compris, que le FEC ne doit
  // jamais reprendre pour un crédit (lib/libellesDuReleve.ts).
  const lignes: LigneBancaire[] = MOUVEMENTS.map((x, i) => {
    const k = x.classement
    return {
      id: `00000000-0000-4000-8002-${String(i).padStart(12, '0')}`, dossier_id: D, date: x.date, libelle: x.libelle, montant: x.montant,
      statut: k.type === 'personnel' ? 'ignoree' : 'rapprochee',
      piece_id: k.type === 'piece' ? k.pieceId : null, cotisation_id: k.type === 'cotisation' ? k.cotisationId : null,
      categorie_id: k.type === 'categorie' ? k.categorie.id : null, taux_tva: null, prelevement_personnel: k.type === 'personnel',
      emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false,
      reglement_groupe: k.type === 'groupe', compte_bilan: k.type === 'caisse' ? PLAN.caisse : null, declaration_tva_id: null,
      id_externe: null, source_fichier: `releve-${ANNEE}.csv`, libelle_brut: x.libelle, created_at: `${ANNEE + 1}-01-05T10:00:00Z`,
      encaissements_de_factures: k.type === 'encaissements',
    }
  })
  const reglements = MOUVEMENTS.flatMap((x, i) => (x.classement.type === 'groupe' ? reglementsDuMouvement(lignes[i].id, x.classement.parts) : []))
  const { encaissements, parts } = encaissementsEtParts((factureId) => {
    const i = MOUVEMENTS.findIndex((x) => x.classement.type === 'encaissements' && x.classement.factureId === factureId)
    return i < 0 ? null : lignes[i].id
  })
  const factures = FACTURES.map((f) => f.facture)
  const lignesDeFacture = FACTURES.map((f) => f.ligne)

  const caisseLue: CaisseLue = { dossierId: D, enBase: true, lignes: OPERATIONS_DE_CAISSE, complete: true, motif: null }
  const operationsDeCaisse = operationsPourLesControles(operationsDeCaisseDuDossier(caisseLue, D))
  const paiementsDeLaCaisse = paiementsParLaCaisseDuDossier(caisseLue, D)
  if (operationsDeCaisse === null || paiementsDeLaCaisse === null) throw new Error('La caisse du dossier fictif ne se lit pas.')
  const paiements = paiementsDesPieces(lignes, reglements, [], paiementsDeLaCaisse)
  const ventes = ventesFacturees({ piecesCitees: AUCUNE_PIECE_CITEE, dossierId: D, factures, lignes: lignesDeFacture, encaissements, parts, acomptes: SANS_ACOMPTE })
  const mouvementsDesEncaissements = lignes.filter((l) => l.encaissements_de_factures)
  const acquisitions = acquisitionsDesBiens(IMMOBILISATIONS, [NATURE_MATERIEL], null)

  // Le brouillon, comme chaque geste l'écrit.
  let n = 0
  const ecriture = (x: Pick<EcritureBrouillon, 'date' | 'compte' | 'libelle' | 'montant' | 'sens'> & Partial<EcritureBrouillon>): EcritureBrouillon => ({
    ...NON_VALIDEE, id: `00000000-0000-4000-8008-${String(n++).padStart(12, '0')}`, dossier_id: D, statut: 'proposee',
    created_at: `${ANNEE + 1}-01-10T10:00:00Z`, piece_id: null, ligne_bancaire_id: null, immobilisation_id: null, vehicule_id: null,
    declaration_tva_id: null, cotisation_id: null, encaissement_id: null, facture_id: null, operation_caisse_id: null, ...x,
  })
  const generation = ecrituresAGenerer(D, piecesAComptabiliser(PIECES, CATEGORIES, acquisitions, ventes.sources), [], ASSUJETTI, paiements, MODELE, null, BANQUES)
  if (generation.banquesInconnues.length > 0 || generation.dansUnExerciceValide.length > 0) throw new Error('La génération des pièces retient des pièces.')
  const brouillon: EcritureBrouillon[] = generation.lignes.map((l) => ecriture(l))
  lignes.forEach((l, i) => {
    const x = MOUVEMENTS[i].classement
    const composees = x.type === 'categorie' ? ecritureDuMouvement(l, x.categorie.compte_comptable!, null, PLAN)
      : x.type === 'cotisation' ? ecritureDeLaCotisation(l, COTISATIONS.find((k) => k.id === x.cotisationId)!, MODELE.mode, PLAN)
        : x.type === 'personnel' ? ecritureDuVirementPersonnel(l, MODELE)
          : x.type === 'caisse' ? ecritureDuCompteDeBilan(l, PLAN.caisse, PLAN)
            : []
    for (const k of composees) brouillon.push(ecriture({ date: l.date, ...k, ligne_bancaire_id: l.id }))
  })
  for (const op of OPERATIONS_DE_CAISSE) {
    if (op.genre === 'paiement') continue
    const aEcrire = { genre: op.genre, date: op.date, montant: op.montant, taux_tva: op.taux_tva, categorie: op.genre === 'recette' ? CATEGORIES.find((k) => k.id === op.categorie_id)! : null }
    for (const k of ecritureDeLOperation(aEcrire, MODELE)) brouillon.push(ecriture({ date: op.date, ...k, operation_caisse_id: op.id }))
  }
  const composition = ecrituresDesVentesFacturees({
    sources: { dossierId: D, factures, lignes: lignesDeFacture, encaissements, parts },
    mouvements: mouvementsDesEncaissements, comptesDeContrepartie: new Map(), exemplaires: [], mode: MODELE.mode, plan: PLAN, banques: BANQUES,
  })
  for (const v of composition.ecritures) for (const k of lignesAuBrouillon(D, v)) brouillon.push(ecriture(k))
  for (const bien of IMMOBILISATIONS) {
    for (const k of ecritureDeLaDotation(bien, NATURE_MATERIEL.compte_immobilisation, ANNEE, null, PLAN)) brouillon.push(ecriture({ date: FIN, ...k, immobilisation_id: bien.id }))
  }
  for (const v of VEHICULES) for (const k of ecritureDuForfait(v, MODELE, null) ?? []) brouillon.push(ecriture({ date: FIN, ...k, vehicule_id: v.id }))

  // La mise en forme de l'onglet Écritures : le lettrage (rien ne se lettre en trésorerie, mais l'écran le calcule), le
  // rendu des banques (un seul compte : la numérotation telle quelle), puis le fichier.
  const lettrage = lettrages(brouillon, PIECES, [], MODELE, { ecritures: composition.ecritures, factures, encaissements })
  const fichier = (champs: ChampsBncDuFec): string => {
    const numerotation: NumerotationFec = numeroterFec(brouillon, PIECES, CATEGORIES, A_NOUVEAUX, MODELE, lignes, composition.ecritures, operationsDeCaisse, champs)
    if (numerotation.horsFec.length > 0) throw new Error(`${numerotation.horsFec.length} écriture(s) hors du FEC.`)
    const rendue = rendreLesBanquesAuFec(numerotation, RENDU_DES_BANQUES_AU_FEC, PLAN, BANQUES)
    if ('refus' in rendue) throw new Error(rendue.refus)
    return formaterFec(rendue, lettrage, MODELE.mode)
  }
  const facturesDuClient: FactureDuClient[] = factures.map((f) => ({
    id: f.id, numero: f.numero, statut: f.statut, tiers_siret: f.tiers_siret, source_de_la_vente: f.source_de_la_vente,
  }))
  const exportes: ChampsBncDuFec = {
    etat: 'exportes',
    entrees: {
      choix, paiements, registre: encaissements, factures: facturesDuClient, cotisations: COTISATIONS, ventilations: [], acquisitions, plan: PLAN,
    },
  }
  return {
    nomFichier: nomFichierFec(SIRET_FICTIF, ANNEE),
    dixHuit: fichier(CHAMPS_BNC_NON_EXPORTES),
    vingtDeux: fichier(exportes),
    mouvements: lignes,
    numerosDesFactures: factures.map((f) => f.numero).filter((x): x is string => x !== null),
    brouillon,
    aNouveaux: A_NOUVEAUX.length,
  }
}
