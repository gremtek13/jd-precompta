import { calculerDeclaration2035 } from '../lib/declaration2035'
import { cotisationsComptees, cotisationsAEcrire, ecritureDeLaCotisation } from '../lib/cotisationRapprochee'
import { comptesDeBilanProposes, ecritureDuCompteDeBilan, mouvementsSurUnCompteDeBilanDesynchronises, refusCompteDeBilanDuMouvement } from '../lib/compteDeBilan'
import {
  argumentsDeLaDeclaration, avertissementRetraitPaiementPersonnel, confirmationPaiementPersonnel, ecritureDuPaiementPersonnel,
  paiementsPersonnelsAReprendre,
} from '../lib/cotisationPersonnelle'
import { compteDeLApplication, compteQueLApplicationEcrit, preparerANouveaux } from '../lib/aNouveaux'
import { ecritureDeLaDotation, dotationsDuRegistre } from '../lib/amortissements'
import { ecritureDeLEcheance, echeancesDesynchronisees } from '../lib/echeanceEmprunt'
import {
  analyserEcritures, ecrituresAGenerer, ecrituresSansObjet, ligneContrepartieBanque, ligneContrepartieDirigeant,
  lignesChargeProduitPourPiece, lignesPourPiece, type LigneAGenerer, type PieceAComptabiliser,
} from '../lib/ecritures'
import {
  compteDeTiers, comptesDeTiers, comptesDuDirigeant, lignesEngagementPourPiece, lignesFactureEngagement,
  lignesReglementEngagement, modeleDuDossier, type ModeleComptable,
} from '../lib/engagement'
import { ecritureDuMouvement, mouvementsAffectes, mouvementsAffectesDesynchronises, type LigneEcritureMouvement } from '../lib/affectationBanque'
import { ecritureDuForfait, forfaitsDuCadre7 } from '../lib/forfaitKilometrique'
import { ecritureDeLaLiquidation, ecritureDuPaiementTva, liquidationsDesynchronisees, paiementsTvaDesynchronises } from '../lib/liquidationTva'
import { compteTvaDe } from '../lib/montantRetenu'
import { partsDuReleve } from '../lib/partsDuReleve'
import { PLAN_DECALE, type CleRoleComptable, type PlanComptable, type RoleDuDirigeant } from '../lib/planComptable'
import type { PaiementDePiece } from '../lib/rattachement'
import { envoisDuLot } from '../lib/reglesAffectation'
import { compteDuResultat, compteQuiRecoit, soldesAReporter } from '../lib/reportDesSoldes'
import type {
  Categorie, CotisationDeclaree, DeclarationTva, EcritureBrouillon, Immobilisation, LigneBancaire, ModeComptable,
  NatureImmobilisation, Piece, RegleAffectationBancaire, VehiculeDossier, VentilationBancaire,
} from '../lib/types'
import { ecritureDeLaVentilation, mouvementsVentilesDesynchronises } from '../lib/ventilationBanque'
import { compteDuDirigeant, ecritureDuVirementPersonnel, virementsPersonnelsAEcrire } from '../lib/virementPersonnel'
import { NON_VALIDEE } from './ecritures'
import { encaissementVendu, factureVendue, ligneVendue, SANS_EXEMPLAIRE, SANS_FACTURE_SOURCE, ventesFactureesVides } from './ventesFacturees'
import { ecrituresDesVentesFacturees, type MouvementDesEncaissements } from '../lib/ecrituresVentesFacturees'
import { ventesFacturees } from '../lib/ventesFacturees'

// LES COMPOSITIONS SOUS UN PLAN (ligne 43, étape PC3 ; conception, § 5.1 et § 5.2) : chaque écriture que l'application
// compose — et chaque contrôle qui la recompose pour juger le brouillon — joué sur des jeux d'essai FICTIFS tirés du
// plan qu'on lui donne. `compositionsAuPlan.test.ts` les joue sous le plan par défaut et sous le plan décalé : sous le
// second, aucun compte par défaut ne doit paraître, et chaque compte décalé ramené à son défaut doit rendre, au caractère
// près, ce que rend le premier — le plan est alors la SEULE source des comptes de rôle. Le brouillon d'un contrôle se
// compose sous le même plan : un contrôle qui lirait un numéro en dur le dirait « à reprendre » sous le plan décalé.
//
// Les jeux ne portent aucun numéro de compte de rôle écrit en dur (les catégories, les biens, la balance reprise en
// prennent d'autres) : un jeu qui en porterait un ne prouverait rien de ce qu'il compose. Les honoraires des jeux sont au
// 706200 : le 706000 qu'ils portaient est, depuis l'étape VF4a, le défaut du rôle `prestations_de_services`.

export interface CasDuPlan {
  nom: string
  // Les rôles dont le compte DOIT paraître dans ce que le cas rend : un jeu qui n'exerce rien ne prouve rien. Leur union
  // est le catalogue entier (`compositionsAuPlan.test.ts`).
  roles: readonly CleRoleComptable[]
  composer: (plan: PlanComptable) => unknown
  // Pour un CONTRÔLE : le même appel sans le brouillon (ou avec un brouillon faux), qui doit rendre autre chose sous le
  // plan par défaut — sans quoi le brouillon composé sous le plan ne déciderait de rien, et le cas ne prouverait rien.
  temoin?: (plan: PlanComptable) => unknown
}

const D = 'd-plan'

export const piece = (o: Partial<Piece> = {}): Piece => ({
  id: 'p-achat', dossier_id: D, uploaded_by: null, source: 'upload', storage_path: `${D}/fictif.pdf`, nom_fichier: 'fictif.pdf',
  storage_hash: null, date_piece: '2026-03-02', tiers: 'Tiers fictif', montant_ht: 100, montant_tva: 20, montant_ttc: 120,
  devise: 'EUR', montant_devise: null, taux_change: null, conversion_source: null, categorie_id: 'c-achats', sous_dossier_id: null,
  type_piece: 'achat', statut: 'validee', notes: null, confiance: null, superpdp_invoice_id: null, flux_hote: null, flux_id: null,
  lisible_path: null, identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null, facture_id: null, vente_hors_des_factures: false,
  created_at: '2026-03-03T09:00:00Z', updated_at: '2026-03-03T09:00:00Z', ...o,
})

export const mouvement = (o: Partial<LigneBancaire> = {}): LigneBancaire => ({
  id: 'l-1', dossier_id: D, date: '2026-03-10', libelle: 'MOUVEMENT FICTIF', montant: -120, statut: 'rapprochee', piece_id: null,
  cotisation_id: null, categorie_id: null, taux_tva: null, emprunt_id: null, emprunt_echeance: null, emprunt_interets: null,
  emprunt_assurance: null, ventilee: false, reglement_groupe: false, compte_bilan: null, declaration_tva_id: null,
  prelevement_personnel: false, source_fichier: null, libelle_brut: null, id_externe: null, created_at: '2026-03-11T08:00:00Z', encaissements_de_factures: false, ...o,
})

export const categorie = (o: Partial<Categorie> = {}): Categorie => ({
  id: 'c-achats', dossier_id: D, code: 'achats', libelle: 'Achats fictifs', ordre: 1, compte_comptable: '606100',
  poste_2035: 'Achats', ...o,
})

const CATEGORIES: Categorie[] = [
  categorie(),
  categorie({ id: 'c-honoraires', code: 'honoraires', libelle: 'Honoraires fictifs', compte_comptable: '706200', poste_2035: 'Recettes' }),
  categorie({ id: 'c-telecom', code: 'telecom', libelle: 'Télécom fictive', compte_comptable: '626000', poste_2035: 'Frais postaux' }),
]

const ecriture = (o: Partial<EcritureBrouillon> = {}): EcritureBrouillon => ({
  id: 'e', dossier_id: D, piece_id: null, ligne_bancaire_id: null, date: '2026-03-10', compte: '606100', libelle: 'Écriture fictive',
  montant: 1, sens: 'debit', statut: 'proposee', created_at: '2026-03-12T08:00:00Z', immobilisation_id: null, vehicule_id: null,
  declaration_tva_id: null, cotisation_id: null, ...NON_VALIDEE, encaissement_id: null, facture_id: null, ...o,
})

// Le brouillon tel que la génération l'écrit : les lignes composées d'une pièce, chacune son identifiant.
function brouillonDesPieces(prefixe: string, lignes: readonly LigneAGenerer[]): EcritureBrouillon[] {
  return lignes.map((l, i) => ecriture({
    id: `${prefixe}-${i}`, piece_id: l.piece_id, ligne_bancaire_id: l.ligne_bancaire_id ?? null, date: l.date,
    compte: l.compte, libelle: l.libelle, montant: l.montant, sens: l.sens,
  }))
}

// Le brouillon tel qu'une fonction de la base l'écrit pour un mouvement, une déclaration, un bien, un véhicule ou une
// échéance : les lignes composées, à la date donnée, sous le lien donné.
function brouillon(
  prefixe: string, lignes: readonly LigneEcritureMouvement[], date: string, lien: Partial<EcritureBrouillon>,
): EcritureBrouillon[] {
  return lignes.map((l, i) => ecriture({ id: `${prefixe}-${i}`, date, compte: l.compte, libelle: l.libelle, montant: l.montant, sens: l.sens, ...lien }))
}

const modele = (plan: PlanComptable, mode: ModeComptable, dirigeant: RoleDuDirigeant): ModeleComptable =>
  ({ mode, compteNotesDeFrais: plan[dirigeant], plan })

// ── Les pièces ───────────────────────────────────────────────────────────────────────────────────────────────────────

const ACHAT = piece()
const VENTE = piece({
  id: 'p-vente', type_piece: 'vente', tiers: 'Client fictif', montant_ht: 500, montant_tva: 100, montant_ttc: 600,
  categorie_id: 'c-honoraires',
})
const BIEN = piece({ id: 'p-bien', tiers: 'Vendeur fictif', montant_ht: 1000, montant_tva: 200, montant_ttc: 1200, categorie_id: null })
const NOTE = piece({ id: 'p-note', type_piece: 'note_frais', tiers: 'Restaurant fictif', montant_ht: 50, montant_tva: 10, montant_ttc: 60 })

const paiement = (id: string, montant: number, date = '2026-03-10'): PaiementDePiece => ({ id, date, montant, origine: 'rapprochement' })

const A_COMPTABILISER: PieceAComptabiliser[] = [
  { piece: ACHAT, compte: '606100', immobilisation: false },
  { piece: VENTE, compte: '706200', immobilisation: false },
  { piece: BIEN, compte: '218300', immobilisation: true },
  { piece: NOTE, compte: '606100', immobilisation: false },
]
const PAIEMENTS = new Map<string, PaiementDePiece[]>([
  ['p-achat', [paiement('l-achat', -120)]],
  ['p-vente', [paiement('l-vente', 600, '2026-03-20')]],
  ['p-bien', [paiement('l-bien', -1200, '2026-04-02')]],
])

// Le brouillon que la génération écrit pour ces quatre pièces, sous ce modèle — donc sous son plan.
function brouillonGenere(m: ModeleComptable): EcritureBrouillon[] {
  return A_COMPTABILISER.flatMap(({ piece: p, compte, immobilisation }) =>
    brouillonDesPieces(p.id, lignesPourPiece(D, p, { compte, immobilisation }, true, PAIEMENTS.get(p.id) ?? [], m)))
}

const CAS_DES_PIECES: CasDuPlan[] = [
  {
    nom: 'lignesPourPiece — trésorerie, achat, vente, bien et note de frais d’un dossier assujetti',
    roles: ['banque', 'tva_deductible', 'tva_collectee', 'tva_immobilisations', 'exploitant'],
    composer: (plan) => A_COMPTABILISER.map(({ piece: p, compte, immobilisation }) =>
      lignesPourPiece(D, p, { compte, immobilisation }, true, PAIEMENTS.get(p.id) ?? [], modele(plan, 'tresorerie', 'exploitant'))),
  },
  {
    nom: 'lignesPourPiece — engagement, dirigeant associé',
    roles: ['banque', 'tva_deductible', 'tva_collectee', 'tva_immobilisations', 'fournisseurs', 'clients', 'fournisseurs_immobilisations', 'associe'],
    composer: (plan) => A_COMPTABILISER.map(({ piece: p, compte, immobilisation }) =>
      lignesPourPiece(D, p, { compte, immobilisation }, true, PAIEMENTS.get(p.id) ?? [], modele(plan, 'engagement', 'associe'))),
  },
  {
    nom: 'lignesPourPiece — engagement, dirigeant non associé, et l’exploitant d’une entreprise individuelle',
    roles: ['autres_debiteurs_crediteurs', 'exploitant'],
    composer: (plan) => (['autres_debiteurs_crediteurs', 'exploitant'] as const).map((dirigeant) =>
      lignesPourPiece(D, NOTE, { compte: '606100', immobilisation: false }, true, [], modele(plan, 'engagement', dirigeant))),
  },
  {
    nom: 'les briques de la trésorerie : charge et TVA, banque, dirigeant',
    roles: ['tva_deductible', 'banque', 'exploitant'],
    composer: (plan) => {
      const charge = lignesChargeProduitPourPiece(D, NOTE, { compte: '606100', immobilisation: false }, true, [], plan)
      return [charge, ligneContrepartieBanque(D, ACHAT, paiement('l-achat', -120), plan), ligneContrepartieDirigeant(D, NOTE, charge, [], plan)]
    },
  },
  {
    nom: 'les briques de l’engagement : la facture, le règlement, les deux ensemble',
    roles: ['tva_deductible', 'fournisseurs', 'banque', 'clients', 'tva_collectee'],
    composer: (plan) => [
      lignesFactureEngagement(D, ACHAT, { compte: '606100', immobilisation: false }, true, plan.associe, plan),
      lignesReglementEngagement(D, VENTE, { id: 'l-vente', date: '2026-03-20', montant: 600 }, plan.associe, false, plan),
      lignesEngagementPourPiece(D, VENTE, { compte: '706200', immobilisation: false }, true, plan.associe, [{ id: 'l-vente', date: '2026-03-20', montant: 600 }], plan),
    ],
  },
  {
    nom: 'le compte de TVA et le compte de tiers d’une pièce',
    roles: ['tva_collectee', 'tva_deductible', 'tva_immobilisations', 'clients', 'fournisseurs', 'fournisseurs_immobilisations', 'associe'],
    composer: (plan) => [
      compteTvaDe(VENTE, false, plan), compteTvaDe(ACHAT, false, plan), compteTvaDe(BIEN, true, plan),
      compteDeTiers(VENTE, plan.associe, false, plan), compteDeTiers(ACHAT, plan.associe, false, plan),
      compteDeTiers(BIEN, plan.associe, true, plan), compteDeTiers(NOTE, plan.associe, false, plan),
    ],
  },
  {
    nom: 'les comptes de tiers et les comptes du dirigeant',
    roles: ['fournisseurs', 'fournisseurs_immobilisations', 'clients', 'associe', 'exploitant', 'autres_debiteurs_crediteurs'],
    composer: (plan) => [[...comptesDeTiers(plan)], comptesDuDirigeant(plan)],
  },
  {
    nom: 'le modèle d’un dossier : le compte du dirigeant validé par le plan, ou le refus qui le cite',
    roles: ['associe', 'exploitant', 'autres_debiteurs_crediteurs'],
    composer: (plan) => [plan.associe, plan.exploitant, plan.autres_debiteurs_crediteurs, '468000'].map((compte) => {
      const lu = modeleDuDossier({ mode_comptable: 'engagement', compte_notes_de_frais: compte }, plan)
      return { compte: lu.modele?.compteNotesDeFrais ?? null, refus: lu.refus }
    }),
  },
  {
    nom: 'ecrituresAGenerer — le brouillon composé sous le plan est à jour, en trésorerie et en engagement',
    roles: [],
    composer: (plan) => (['tresorerie', 'engagement'] as const).map((mode) => {
      const m = modele(plan, mode, mode === 'tresorerie' ? 'exploitant' : 'associe')
      return ecrituresAGenerer(D, A_COMPTABILISER, brouillonGenere(m), true, PAIEMENTS, m, null)
    }),
    temoin: (plan) => (['tresorerie', 'engagement'] as const).map((mode) => {
      const m = modele(plan, mode, mode === 'tresorerie' ? 'exploitant' : 'associe')
      return ecrituresAGenerer(D, A_COMPTABILISER, [], true, PAIEMENTS, m, null)
    }),
  },
  {
    nom: 'analyserEcritures — le brouillon composé sous le plan est juste, en trésorerie et en engagement',
    roles: [],
    composer: (plan) => (['tresorerie', 'engagement'] as const).map((mode) => {
      const m = modele(plan, mode, mode === 'tresorerie' ? 'exploitant' : 'associe')
      return analyserEcritures(brouillonGenere(m), A_COMPTABILISER, true, PAIEMENTS, m, null, SANS_EXEMPLAIRE)
    }),
    temoin: (plan) => (['tresorerie', 'engagement'] as const).map((mode) => {
      const m = modele(plan, mode, mode === 'tresorerie' ? 'exploitant' : 'associe')
      // Le même brouillon, sa banque ôtée : l'analyse le dit déséquilibré.
      return analyserEcritures(brouillonGenere(m).filter((e) => e.compte !== plan.banque), A_COMPTABILISER, true, PAIEMENTS, m, null, SANS_EXEMPLAIRE)
    }),
  },
  {
    nom: 'ecrituresSansObjet — une facture d’engagement sortie de sa catégorie : ni la banque ni le tiers ne comptent en trop',
    roles: [],
    composer: (plan) => {
      const m = modele(plan, 'engagement', 'associe')
      const sansCategorie = { ...ACHAT, categorie_id: null }
      return ecrituresSansObjet(brouillonGenere(m), [sansCategorie, VENTE], CATEGORIES, new Map(), null, plan, SANS_FACTURE_SOURCE)
    },
    // Lu sous un autre plan que celui qui l'a composé, le même brouillon compterait sa banque et son tiers en trop.
    temoin: (plan) => {
      const m = modele(plan, 'engagement', 'associe')
      const sansCategorie = { ...ACHAT, categorie_id: null }
      return ecrituresSansObjet(brouillonGenere(m), [sansCategorie, VENTE], CATEGORIES, new Map(), null, PLAN_DECALE, SANS_FACTURE_SOURCE)
    },
  },
  {
    // L'EXEMPLAIRE D'UNE FACTURE SOURCE (étape VF6a) : toutes ses lignes ouvertes partent, et son montant — ce que le
    // produit compte en trop — écarte la banque et le tiers du plan, dans les deux modèles.
    nom: 'ecrituresSansObjet — l’exemplaire d’une facture source : ses lignes, sans la banque ni le tiers du plan dans son montant',
    roles: [],
    composer: (plan) => (['tresorerie', 'engagement'] as const).map((mode) => {
      const m = modele(plan, mode, mode === 'tresorerie' ? 'exploitant' : 'associe')
      return ecrituresSansObjet(brouillonGenere(m), [ACHAT, { ...VENTE, facture_id: 'f-source' }], CATEGORIES, new Map(), null, plan, new Set(['f-source']))
    }),
    // Lu sous un autre plan que celui qui l'a composé, le même brouillon compterait sa banque et son tiers dans le montant.
    temoin: (plan) => (['tresorerie', 'engagement'] as const).map((mode) => {
      const m = modele(plan, mode, mode === 'tresorerie' ? 'exploitant' : 'associe')
      return ecrituresSansObjet(brouillonGenere(m), [ACHAT, { ...VENTE, facture_id: 'f-source' }], CATEGORIES, new Map(), null, PLAN_DECALE, new Set(['f-source']))
    }),
  },
]

// ── Les mouvements du relevé ─────────────────────────────────────────────────────────────────────────────────────────

const RECETTE = mouvement({ id: 'l-recette', montant: 240, categorie_id: 'c-honoraires', taux_tva: 20, date: '2026-05-04' })
const DEPENSE = mouvement({ id: 'l-depense', montant: -45, categorie_id: 'c-telecom', date: '2026-05-06' })
const VENTILE = mouvement({ id: 'l-ventile', montant: -300, ventilee: true, date: '2026-05-08' })
const VENTILATIONS: VentilationBancaire[] = [
  { id: 'v-1', dossier_id: D, ligne_bancaire_id: 'l-ventile', categorie_id: 'c-achats', part_personnelle: false, montant: -200, taux_tva: null, created_at: '2026-05-09T08:00:00Z' },
  { id: 'v-2', dossier_id: D, ligne_bancaire_id: 'l-ventile', categorie_id: null, part_personnelle: true, montant: -100, taux_tva: null, created_at: '2026-05-09T08:00:00Z' },
]
const ECHEANCE = mouvement({
  id: 'l-echeance', montant: -850, emprunt_id: 'emp-1', emprunt_echeance: 3, emprunt_interets: 120, emprunt_assurance: 30,
  date: '2026-06-05', libelle: 'ECHEANCE PRET FICTIF',
})
const DEBLOCAGE = mouvement({ id: 'l-deblocage', montant: 20000, emprunt_id: 'emp-1', date: '2026-01-15', libelle: 'DEBLOCAGE PRET FICTIF' })
const COTISATION: CotisationDeclaree = {
  id: 'cot-1', dossier_id: D, echeance: '2026-06-20', montant_appele: 900, montant_verse: 900, montant_csg_crds: 150,
  previsionnel: false, created_at: '2026-06-01T08:00:00Z', paiement_personnel_le: null,
}
const PRELEVEMENT_COTISATION = mouvement({ id: 'l-cotisation', montant: -900, cotisation_id: 'cot-1', date: '2026-06-20', libelle: 'PRLV URSSAF FICTIF' })
const PAIEMENT_TVA = mouvement({ id: 'l-tva', montant: -500, declaration_tva_id: 'dt-1', date: '2026-05-15', libelle: 'PRLV TVA FICTIF' })
const REMBOURSEMENT_TVA = mouvement({ id: 'l-remboursement', montant: 300, declaration_tva_id: 'dt-2', date: '2026-08-20', libelle: 'REMBOURSEMENT TVA FICTIF' })
const VIREMENT_PERSONNEL = mouvement({ id: 'l-perso', montant: -1500, prelevement_personnel: true, date: '2026-07-01', libelle: 'VIR PERSONNEL FICTIF' })
const VERS_EPARGNE = (plan: PlanComptable) =>
  mouvement({ id: 'l-epargne', montant: -2000, compte_bilan: plan.virements_internes, date: '2026-07-03', libelle: 'VIR EPARGNE FICTIF' })

const CAS_DES_MOUVEMENTS: CasDuPlan[] = [
  {
    nom: 'ecritureDuMouvement — une recette taxée et une dépense affectées',
    roles: ['banque', 'tva_collectee'],
    composer: (plan) => [ecritureDuMouvement(RECETTE, '706200', 20, plan), ecritureDuMouvement(DEPENSE, '626000', null, plan)],
  },
  {
    nom: 'mouvementsAffectesDesynchronises — l’écriture composée sous le plan est conforme',
    roles: [],
    composer: (plan) => {
      const affectes = mouvementsAffectes([RECETTE, DEPENSE], CATEGORIES, true)
      const presentes = [
        ...brouillon('a-r', ecritureDuMouvement(RECETTE, '706200', 20, plan), RECETTE.date, { ligne_bancaire_id: RECETTE.id }),
        ...brouillon('a-d', ecritureDuMouvement(DEPENSE, '626000', null, plan), DEPENSE.date, { ligne_bancaire_id: DEPENSE.id }),
      ]
      return mouvementsAffectesDesynchronises(presentes, affectes, null, plan).map((m) => m.ligne.id)
    },
    temoin: (plan) => mouvementsAffectesDesynchronises([], mouvementsAffectes([RECETTE, DEPENSE], CATEGORIES, true), null, plan).map((m) => m.ligne.id),
  },
  {
    nom: 'ecritureDeLaVentilation — une dépense en partie personnelle, et une recette taxée',
    roles: ['banque', 'exploitant', 'associe', 'tva_collectee'],
    composer: (plan) => [
      ecritureDeLaVentilation(VENTILE, VENTILATIONS, CATEGORIES, modele(plan, 'tresorerie', 'associe'), true),
      ecritureDeLaVentilation(VENTILE, VENTILATIONS, CATEGORIES, modele(plan, 'engagement', 'associe'), true),
      ecritureDeLaVentilation(
        RECETTE, [{ categorie_id: 'c-honoraires', part_personnelle: false, montant: 240, taux_tva: 20 }], CATEGORIES,
        modele(plan, 'tresorerie', 'exploitant'), true,
      ),
    ],
  },
  {
    nom: 'mouvementsVentilesDesynchronises — l’écriture composée sous le plan est conforme',
    roles: [],
    composer: (plan) => {
      const m = modele(plan, 'tresorerie', 'exploitant')
      const presentes = brouillon('v', ecritureDeLaVentilation(VENTILE, VENTILATIONS, CATEGORIES, m, true) ?? [], VENTILE.date, { ligne_bancaire_id: VENTILE.id })
      return mouvementsVentilesDesynchronises(presentes, [VENTILE], VENTILATIONS, CATEGORIES, m, true, null).map((l) => l.id)
    },
    temoin: (plan) =>
      mouvementsVentilesDesynchronises([], [VENTILE], VENTILATIONS, CATEGORIES, modele(plan, 'tresorerie', 'exploitant'), true, null).map((l) => l.id),
  },
  {
    nom: 'ecritureDeLEcheance — une échéance d’emprunt et son déblocage',
    roles: ['banque', 'emprunt', 'interets_emprunt', 'assurance_emprunt'],
    composer: (plan) => [
      ecritureDeLEcheance(ECHEANCE, { echeance: 3, interets: 120, assurance: 30 }, plan),
      ecritureDeLEcheance(DEBLOCAGE, { echeance: null, interets: 0, assurance: 0 }, plan),
    ],
  },
  {
    nom: 'echeancesDesynchronisees — l’écriture composée sous le plan est conforme',
    roles: [],
    composer: (plan) => {
      const presentes = [
        ...brouillon('ech', ecritureDeLEcheance(ECHEANCE, { echeance: 3, interets: 120, assurance: 30 }, plan), ECHEANCE.date, { ligne_bancaire_id: ECHEANCE.id }),
        ...brouillon('deb', ecritureDeLEcheance(DEBLOCAGE, { echeance: null, interets: 0, assurance: 0 }, plan), DEBLOCAGE.date, { ligne_bancaire_id: DEBLOCAGE.id }),
      ]
      return echeancesDesynchronisees(presentes, [ECHEANCE, DEBLOCAGE], plan).map((l) => l.id)
    },
    temoin: (plan) => echeancesDesynchronisees([], [ECHEANCE, DEBLOCAGE], plan).map((l) => l.id),
  },
  {
    nom: 'ecritureDeLaCotisation — en trésorerie (la CSG-CRDS au compte de l’exploitant) et en engagement',
    roles: ['banque', 'cotisations_exploitant', 'exploitant'],
    composer: (plan) => (['tresorerie', 'engagement'] as const).map((mode) => ecritureDeLaCotisation(PRELEVEMENT_COTISATION, COTISATION, mode, plan)),
  },
  {
    nom: 'cotisationsAEcrire — l’écriture composée sous le plan est conforme',
    roles: [],
    composer: (plan) => {
      const presentes = brouillon('cot', ecritureDeLaCotisation(PRELEVEMENT_COTISATION, COTISATION, 'tresorerie', plan), PRELEVEMENT_COTISATION.date, { ligne_bancaire_id: PRELEVEMENT_COTISATION.id })
      return cotisationsAEcrire(presentes, [PRELEVEMENT_COTISATION], [COTISATION], 'tresorerie', null, plan).map((r) => r.ligne.id)
    },
    temoin: (plan) => cotisationsAEcrire([], [PRELEVEMENT_COTISATION], [COTISATION], 'tresorerie', null, plan).map((r) => r.ligne.id),
  },
  {
    nom: 'ecritureDuPaiementTva — un paiement et un remboursement',
    roles: ['banque', 'tva_a_decaisser', 'remboursement_tva_demande'],
    composer: (plan) => [ecritureDuPaiementTva(PAIEMENT_TVA, plan), ecritureDuPaiementTva(REMBOURSEMENT_TVA, plan)],
  },
  {
    nom: 'paiementsTvaDesynchronises — l’écriture composée sous le plan est conforme',
    roles: [],
    composer: (plan) => {
      const presentes = [
        ...brouillon('ptva', ecritureDuPaiementTva(PAIEMENT_TVA, plan), PAIEMENT_TVA.date, { ligne_bancaire_id: PAIEMENT_TVA.id }),
        ...brouillon('rtva', ecritureDuPaiementTva(REMBOURSEMENT_TVA, plan), REMBOURSEMENT_TVA.date, { ligne_bancaire_id: REMBOURSEMENT_TVA.id }),
      ]
      return paiementsTvaDesynchronises(presentes, [PAIEMENT_TVA, REMBOURSEMENT_TVA], null, plan).map((l) => l.id)
    },
    temoin: (plan) => paiementsTvaDesynchronises([], [PAIEMENT_TVA, REMBOURSEMENT_TVA], null, plan).map((l) => l.id),
  },
  {
    nom: 'le virement personnel : le compte du dirigeant et son écriture, en trésorerie et en engagement',
    roles: ['banque', 'exploitant', 'associe'],
    composer: (plan) => [modele(plan, 'tresorerie', 'associe'), modele(plan, 'engagement', 'associe')].map((m) =>
      [compteDuDirigeant(m), ecritureDuVirementPersonnel(VIREMENT_PERSONNEL, m)]),
  },
  {
    nom: 'virementsPersonnelsAEcrire — l’écriture composée sous le plan est conforme',
    roles: [],
    composer: (plan) => {
      const m = modele(plan, 'engagement', 'associe')
      const presentes = brouillon('vp', ecritureDuVirementPersonnel(VIREMENT_PERSONNEL, m), VIREMENT_PERSONNEL.date, { ligne_bancaire_id: VIREMENT_PERSONNEL.id })
      return virementsPersonnelsAEcrire(presentes, [VIREMENT_PERSONNEL], m, null).map((l) => l.id)
    },
    temoin: (plan) => virementsPersonnelsAEcrire([], [VIREMENT_PERSONNEL], modele(plan, 'engagement', 'associe'), null).map((l) => l.id),
  },
  {
    nom: 'le compte de bilan d’un mouvement : les comptes proposés, l’écriture, le refus qui cite le dirigeant',
    roles: ['virements_internes', 'depots_cautionnements_verses', 'banque', 'exploitant', 'associe'],
    composer: (plan) => [
      comptesDeBilanProposes(plan),
      ecritureDuCompteDeBilan(VERS_EPARGNE(plan), plan.virements_internes, plan),
      refusCompteDeBilanDuMouvement(mouvement({ id: 'l-x', montant: -10 }), plan.exploitant, modele(plan, 'tresorerie', 'exploitant')),
      refusCompteDeBilanDuMouvement(mouvement({ id: 'l-x', montant: -10 }), plan.associe, modele(plan, 'engagement', 'associe')),
    ],
  },
  {
    nom: 'mouvementsSurUnCompteDeBilanDesynchronises — l’écriture composée sous le plan est conforme',
    roles: [],
    composer: (plan) => {
      const l = VERS_EPARGNE(plan)
      const presentes = brouillon('cb', ecritureDuCompteDeBilan(l, plan.virements_internes, plan), l.date, { ligne_bancaire_id: l.id })
      return mouvementsSurUnCompteDeBilanDesynchronises(presentes, [l], null, plan).map((x) => x.id)
    },
    temoin: (plan) => mouvementsSurUnCompteDeBilanDesynchronises([], [VERS_EPARGNE(plan)], null, plan).map((x) => x.id),
  },
  {
    nom: 'envoisDuLot — les écritures d’un lot de règles d’affectation',
    roles: ['banque', 'tva_collectee'],
    composer: (plan) => {
      const regle: RegleAffectationBancaire = {
        id: 'r-1', dossier_id: D, motif: 'HONORAIRES', sens: 'encaissement', categorie_id: 'c-honoraires', taux_tva: 20,
        created_at: '2026-05-01T08:00:00Z',
      }
      return envoisDuLot([{ ligne: mouvement({ id: 'l-lot', montant: 240, statut: 'non_rapprochee' }), regle, categorie: CATEGORIES[1], taux: 20 }], plan)
    },
  },
]

// ── La TVA déclarée ──────────────────────────────────────────────────────────────────────────────────────────────────

// Une déclaration à payer (ligne 28) dont les comptes portent trente centimes de plus que la CA3 : un arrondi de produit ;
// une déclaration en crédit (lignes 22, 26 et 27) dont la CA3 dépasse les comptes : un arrondi de charge.
const declarationTva = (o: Partial<DeclarationTva>): DeclarationTva => ({
  id: 'dt-1', dossier_id: D, periode_debut: '2026-04-01', periode_fin: '2026-04-30', tva_declaree: 80, credit_anterieur: 0,
  remboursement_demande: 0, date_declaration: '2026-05-10', notes: null, created_at: '2026-05-10T08:00:00Z',
  cases: { l28: 80 }, tva_collectee: 100.4, tva_deductible: 20.1, tva_deductible_immobilisations: 0, ...o,
})
const A_PAYER = declarationTva({})
const EN_CREDIT = declarationTva({
  id: 'dt-2', periode_debut: '2026-07-01', periode_fin: '2026-07-31', tva_declaree: 0, remboursement_demande: 300,
  cases: { l22: 0, l26: 300, l27: 120 }, tva_collectee: 50, tva_deductible: 400, tva_deductible_immobilisations: 70.7,
})

const CAS_DE_LA_TVA: CasDuPlan[] = [
  {
    nom: 'ecritureDeLaLiquidation — une déclaration à payer, une déclaration en crédit',
    roles: [
      'tva_collectee', 'tva_deductible', 'tva_immobilisations', 'tva_a_decaisser', 'credit_tva_a_reporter',
      'remboursement_tva_demande', 'arrondi_charge', 'arrondi_produit',
    ],
    composer: (plan) => [ecritureDeLaLiquidation(A_PAYER, plan), ecritureDeLaLiquidation(EN_CREDIT, plan)],
  },
  {
    nom: 'liquidationsDesynchronisees — l’écriture composée sous le plan est conforme',
    roles: [],
    composer: (plan) => {
      const presentes = [A_PAYER, EN_CREDIT].flatMap((d) =>
        brouillon(`liq-${d.id}`, ecritureDeLaLiquidation(d, plan), d.periode_fin, { declaration_tva_id: d.id }))
      return liquidationsDesynchronisees(presentes, [A_PAYER, EN_CREDIT], null, plan).map((d) => d.id)
    },
    temoin: (plan) => liquidationsDesynchronisees([], [A_PAYER, EN_CREDIT], null, plan).map((d) => d.id),
  },
]

// ── L'inventaire : dotations, forfait kilométrique, cotisations payées de la poche du dirigeant ──────────────────────

const NATURE: NatureImmobilisation = {
  id: 'n-info', dossier_id: null, libelle: 'Informatique fictive', duree_annees_defaut: 3, ordre: 2, compte_immobilisation: '218300',
}
const IMMOBILISATION: Immobilisation = {
  id: 'i-1', dossier_id: D, piece_id: 'p-bien', nature_id: 'n-info', libelle: 'Ordinateur fictif', valeur: 1200,
  date_acquisition: '2025-07-01', date_mise_en_service: null, duree_annees: 3, created_at: '2025-07-02T10:00:00Z',
}
const VEHICULE: VehiculeDossier = {
  id: 'veh-1', dossier_id: D, annee: 2025, modele: 'Citadine fictive', type: 'voiture', puissance_fiscale: 3, bareme: 'bnc',
  motorisation: 'thermique', carburant: 'diesel', km_professionnel: 4500, inscrit_immobilisations: false,
  amortissements_a_reintegrer: null, created_at: '2025-01-05T10:00:00Z', updated_at: '2025-01-05T10:00:00Z',
}
const PAYEE_DE_SA_POCHE: CotisationDeclaree = { ...COTISATION, id: 'cot-2', echeance: '2026-09-20', paiement_personnel_le: '2026-09-18' }

const CAS_DE_L_INVENTAIRE: CasDuPlan[] = [
  {
    nom: 'ecritureDeLaDotation — la dotation de l’exercice',
    roles: ['dotations_amortissements'],
    composer: (plan) => [ecritureDeLaDotation(IMMOBILISATION, '218300', 2026, null, plan)],
  },
  {
    nom: 'dotationsDuRegistre — la dotation composée sous le plan est écrite',
    roles: ['dotations_amortissements'],
    composer: (plan) => {
      const presentes = [2025, 2026].flatMap((annee) =>
        brouillon(`dot-${annee}`, ecritureDeLaDotation(IMMOBILISATION, '218300', annee, null, plan), `${annee}-12-31`, { immobilisation_id: 'i-1' }))
      return dotationsDuRegistre([IMMOBILISATION], [NATURE], presentes, null, 2026, null, plan)
    },
    temoin: (plan) => dotationsDuRegistre([IMMOBILISATION], [NATURE], [], null, 2026, null, plan),
  },
  {
    nom: 'ecritureDuForfait — le forfait kilométrique, face à l’exploitant puis à l’associé',
    roles: ['indemnites_kilometriques', 'exploitant', 'associe'],
    composer: (plan) => [ecritureDuForfait(VEHICULE, modele(plan, 'tresorerie', 'associe'), null), ecritureDuForfait(VEHICULE, modele(plan, 'engagement', 'associe'), null)],
  },
  {
    nom: 'forfaitsDuCadre7 — le forfait composé sous le plan est écrit',
    roles: ['indemnites_kilometriques', 'exploitant'],
    composer: (plan) => {
      const m = modele(plan, 'tresorerie', 'exploitant')
      const presentes = brouillon('fk', ecritureDuForfait(VEHICULE, m, null) ?? [], '2025-12-31', { vehicule_id: 'veh-1' })
      return forfaitsDuCadre7([VEHICULE], presentes, m, null, 2026, null)
    },
    temoin: (plan) => forfaitsDuCadre7([VEHICULE], [], modele(plan, 'tresorerie', 'exploitant'), null, 2026, null),
  },
  {
    nom: 'le paiement d’une cotisation depuis le compte personnel : écriture, arguments, confirmation, retrait',
    roles: ['cotisations_exploitant', 'exploitant', 'associe'],
    composer: (plan) => [modele(plan, 'tresorerie', 'exploitant'), modele(plan, 'engagement', 'associe')].map((m) => {
      const ecrites = brouillon('pp', ecritureDuPaiementPersonnel(PAYEE_DE_SA_POCHE, m), '2026-09-18', { cotisation_id: 'cot-2' })
      return [
        ecritureDuPaiementPersonnel(PAYEE_DE_SA_POCHE, m),
        argumentsDeLaDeclaration(D, PAYEE_DE_SA_POCHE, '2026-09-18', m),
        confirmationPaiementPersonnel(PAYEE_DE_SA_POCHE, '2026-09-18', m),
        avertissementRetraitPaiementPersonnel(PAYEE_DE_SA_POCHE, m, ecrites),
      ]
    }),
  },
  {
    nom: 'paiementsPersonnelsAReprendre — l’écriture composée sous le plan est conforme',
    roles: [],
    composer: (plan) => {
      const m = modele(plan, 'tresorerie', 'exploitant')
      const presentes = brouillon('pp', ecritureDuPaiementPersonnel(PAYEE_DE_SA_POCHE, m), '2026-09-18', { cotisation_id: 'cot-2' })
      return paiementsPersonnelsAReprendre(presentes, [PAYEE_DE_SA_POCHE], m, null)
    },
    temoin: (plan) => paiementsPersonnelsAReprendre([], [PAYEE_DE_SA_POCHE], modele(plan, 'tresorerie', 'exploitant'), null),
  },
]

// ── Les ventes facturées (chantier EC-Q3, étape VF4a) ────────────────────────────────────────────────────────────────

// Une facture de services réglée par un chèque remis deux jours avant son crédit, que des frais écornent (le 511, puis le
// mouvement : la banque, le 511 et le 627) ; une facture de biens réglée en espèces (le 53). En trésorerie et en
// engagement — la TVA en attente d'un service facturé. Données FICTIVES.
const VENTES_SERVICES = factureVendue({ id: 'vf-s', numero: 'F2025-0101', date_emission: '2025-11-10' })
const VENTES_BIENS = factureVendue({ id: 'vf-b', numero: 'F2025-0102', date_emission: '2025-11-10', nature_operation: 'biens' })
const VENTES_CHEQUE = encaissementVendu({ id: 'vf-e1', facture_id: 'vf-s', date_encaissement: '2025-11-12', montant: 120, moyen: 'cheque', ligne_bancaire_id: 'vf-m1' })
const VENTES_ESPECES = encaissementVendu({ id: 'vf-e2', facture_id: 'vf-b', date_encaissement: '2025-11-20', montant: 220, moyen: 'especes' }, 10)
const VENTES_MOUVEMENT: MouvementDesEncaissements = {
  id: 'vf-m1', dossier_id: 'd1', date: '2025-11-14', montant: 118.5, libelle: 'REMISE CHEQUE FICTIVE', source_fichier: 'releve-fictif.csv',
  encaissements_de_factures: true,
}

const CAS_DES_VENTES_FACTUREES: CasDuPlan[] = [
  {
    nom: 'ecrituresDesVentesFacturees — un chèque au 511 et ses frais, des espèces, en trésorerie et en engagement',
    roles: [
      'banque', 'clients', 'tva_collectee', 'prestations_de_services', 'ventes_de_biens', 'tva_collectee_en_attente',
      'valeurs_a_l_encaissement', 'caisse', 'services_bancaires',
    ],
    composer: (plan) => (['tresorerie', 'engagement'] as const).map((mode) => {
      const { ecritures, nonEcrites } = ecrituresDesVentesFacturees({
        sources: {
          dossierId: 'd1', factures: [VENTES_SERVICES, VENTES_BIENS],
          lignes: [ligneVendue('vf-s', 100, 20), ligneVendue('vf-b', 200, 10)],
          encaissements: [VENTES_CHEQUE.encaissement, VENTES_ESPECES.encaissement], parts: [VENTES_CHEQUE.part, VENTES_ESPECES.part],
        },
        mouvements: [VENTES_MOUVEMENT], comptesDeContrepartie: new Map(), exemplaires: [], mode, plan,
      })
      return { ecritures, nonEcrites }
    }),
  },
  {
    // LES FRAIS D'UN MOUVEMENT D'ENCAISSEMENTS DANS LA 2035 (ligne 28.65, VF4C3-Q1) : au compte des services bancaires du
    // plan, celui que la composition écrit — jamais celui de la catégorie « Frais bancaires », qui ne donne que son poste.
    nom: 'calculerDeclaration2035 — les frais d’un mouvement d’encaissements, au compte que la composition écrit',
    roles: ['services_bancaires', 'prestations_de_services', 'ventes_de_biens'],
    composer: (plan) => {
      const sources = {
        dossierId: 'd1', factures: [VENTES_SERVICES, VENTES_BIENS],
        lignes: [ligneVendue('vf-s', 100, 20), ligneVendue('vf-b', 200, 10)],
        encaissements: [VENTES_CHEQUE.encaissement, VENTES_ESPECES.encaissement], parts: [VENTES_CHEQUE.part, VENTES_ESPECES.part],
      }
      const composition = ecrituresDesVentesFacturees({
        sources, mouvements: [VENTES_MOUVEMENT], comptesDeContrepartie: new Map(), exemplaires: [], mode: 'tresorerie', plan,
      })
      const fraisBancaires = categorie({ id: 'c-frais', dossier_id: null, code: 'frais_bancaires', libelle: 'Frais bancaires fictifs', poste_2035: 'Frais financiers' })
      return calculerDeclaration2035(
        2025, [], [fraisBancaires], [], [], [], true, new Map(), [], [], plan, ventesFacturees(sources), { etat: 'composees', composition },
      ).contributions
    },
  },
]

// ── La 2035, le report des soldes, la reprise d'une balance ──────────────────────────────────────────────────────────

const CAS_DE_LA_CLOTURE: CasDuPlan[] = [
  {
    nom: 'calculerDeclaration2035 — le compte de chaque contribution d’un rôle',
    roles: ['interets_emprunt', 'assurance_emprunt', 'cotisations_exploitant', 'dotations_amortissements', 'indemnites_kilometriques', 'arrondi_produit', 'arrondi_charge'],
    composer: (plan) => {
      const lignes = [ECHEANCE, PRELEVEMENT_COTISATION]
      const parts = partsDuReleve(lignes, CATEGORIES, [], true)
      const vehicule2026: VehiculeDossier = { ...VEHICULE, annee: 2026 }
      return calculerDeclaration2035(
        2026, [], CATEGORIES, [IMMOBILISATION], cotisationsComptees([COTISATION], lignes, 'tresorerie'), [vehicule2026], true,
        new Map(), parts, [A_PAYER, EN_CREDIT], plan, ventesFactureesVides('d1'),
        { etat: 'sans_bascule' },
      ).contributions
    },
  },
  {
    nom: 'le report des soldes : le compte du résultat, le compte qui reçoit, les soldes d’une entreprise individuelle et d’une société',
    roles: ['capital_individuel', 'resultat_benefice', 'resultat_perte', 'banque', 'exploitant'],
    composer: (plan) => {
      const mouvements = [
        { compte: plan.banque, compteLib: 'Banque', sens: 'debit' as const, montant: 5000 },
        { compte: plan.exploitant, compteLib: 'Compte de l’exploitant', sens: 'debit' as const, montant: 1000 },
        { compte: '706200', compteLib: 'Honoraires', sens: 'credit' as const, montant: 8000 },
        { compte: '606100', compteLib: 'Achats', sens: 'debit' as const, montant: 2000 },
      ]
      return [
        compteDuResultat(true, 1, plan), compteDuResultat(false, 1, plan), compteDuResultat(false, -1, plan),
        compteQuiRecoit(plan.exploitant, true, plan.capital_individuel, plan), compteQuiRecoit(plan.banque, true, plan.capital_individuel, plan),
        soldesAReporter(mouvements, modele(plan, 'tresorerie', 'exploitant'), 2026),
        soldesAReporter(mouvements, modele(plan, 'engagement', 'associe'), 2026),
      ]
    },
  },
  {
    nom: 'la reprise d’une balance : la banque, la TVA et le résultat d’avant au plan, et ce qu’elle ne range pas',
    roles: ['banque', 'tva_deductible', 'tva_collectee', 'resultat_benefice', 'fournisseurs', 'emprunt'],
    composer: (plan) => {
      const balance = [
        { compte: '512', libelle: 'Banque fictive', debit: 3000, credit: 0 },
        { compte: plan.tva_deductible, libelle: 'TVA déductible', debit: 40, credit: 0 },
        { compte: plan.tva_collectee, libelle: 'TVA collectée', debit: 0, credit: 90 },
        { compte: plan.fournisseurs, libelle: 'Fournisseurs', debit: 0, credit: 450 },
        { compte: '4010', libelle: 'Fournisseurs (autre numérotation)', debit: 0, credit: 50 },
        { compte: '1640', libelle: 'Emprunt fictif', debit: 0, credit: 1200 },
        { compte: '706200', libelle: 'Honoraires', debit: 0, credit: 2500 },
        { compte: '606100', libelle: 'Achats', debit: 1250, credit: 0 },
      ]
      return [
        compteDeLApplication('5121', plan), compteDeLApplication(plan.tva_collectee, plan), compteQueLApplicationEcrit('4010', plan),
        preparerANouveaux(balance, 2026, plan),
      ]
    },
  },
]

export const CAS_DU_PLAN: readonly CasDuPlan[] = [
  ...CAS_DES_PIECES, ...CAS_DES_MOUVEMENTS, ...CAS_DE_LA_TVA, ...CAS_DE_L_INVENTAIRE, ...CAS_DE_LA_CLOTURE,
  ...CAS_DES_VENTES_FACTUREES,
]
