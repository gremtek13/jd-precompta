import { describe, expect, it } from 'vitest'
import { CAS_DU_PLAN } from '../test/compositionsAuPlan'
import { PLAN_DECALE, PLAN_PAR_DEFAUT, ROLES_COMPTABLES, roleDuDirigeant, planDeLaReponse, lireLePlanDuDossier, type ReponseDuPlan } from './planComptable'
import {
  analyserEcritures, ecrituresAGenerer, ecrituresSansObjet, ligneContrepartieBanque, ligneContrepartieDirigeant,
  lignesChargeProduitPourPiece, lignesPourPiece, type CibleComptable, type PieceAComptabiliser,
} from './ecritures'
import {
  compteDeTiers, comptesDeTiers, comptesDuDirigeant, lignesEngagementPourPiece, lignesFactureEngagement,
  lignesReglementEngagement, modeleDuDossier, type ModeleComptable,
} from './engagement'
import { ecritureDuMouvement, mouvementsAffectesDesynchronises, type MouvementAffecte, type MouvementBancaire } from './affectationBanque'
import { ecritureDeLaVentilation, mouvementsVentilesDesynchronises } from './ventilationBanque'
import { ecritureDeLEcheance, echeancesDesynchronisees, type DecoupageEcheance } from './echeanceEmprunt'
import { cotisationsAEcrire, ecritureDeLaCotisation } from './cotisationRapprochee'
import {
  ecritureDeLaLiquidation, ecritureDuPaiementTva, liquidationsDesynchronisees, paiementsTvaDesynchronises, parametresEnregistrement,
  type DemandeDeDeclaration,
} from './liquidationTva'
import { compteTvaDe } from './montantRetenu'
import { ecritureDeLaDotation, dotationsDuRegistre } from './amortissements'
import { calculerDeclaration2035 } from './declaration2035'
import { comptesDeBilanProposes, ecritureDuCompteDeBilan, mouvementsSurUnCompteDeBilanDesynchronises } from './compteDeBilan'
import { compteDuResultat, compteQuiRecoit } from './reportDesSoldes'
import { compteDeLApplication, compteQueLApplicationEcrit, preparerANouveaux } from './aNouveaux'
import { envoisDuLot, type PropositionRegle } from './reglesAffectation'
import type { LigneBalance } from './balanceImport'
import type { PaiementsDesPieces } from './rattachement'
import type { Categorie, CotisationDeclaree, DeclarationTva, EcritureBrouillon, Immobilisation, NatureImmobilisation, Piece } from './types'

// LE PLAN EST LA SEULE SOURCE DES COMPTES DE RÔLE (ligne 43, étape PC3 ; conception, § 5.1 et § 5.2). Chaque composition
// de l'application — et chaque contrôle qui la recompose — se joue sous le plan par défaut et sous le plan décalé, où
// chaque rôle tient un autre compte (`PLAN_DECALE`). Sous le second, une constante oubliée écrirait un 512000 : aucun
// compte par défaut ne doit y paraître ; et chaque compte décalé ramené à son défaut doit rendre, AU CARACTÈRE PRÈS, ce
// que rend le premier — rien d'autre que les comptes ne dépend du plan. Les jeux d'essai vivent dans
// src/test/compositionsAuPlan.ts, tirés du plan qu'on leur donne (le brouillon d'un contrôle compris).

// Ce qu'un cas rend, sous une forme comparable au caractère près : les Map, les Set et les entiers longs dits tels quels.
function forme(valeur: unknown): string {
  return JSON.stringify(valeur, (_cle, v: unknown) => {
    if (v instanceof Map) return { '#Map': [...v.entries()] }
    if (v instanceof Set) return { '#Set': [...v] }
    if (typeof v === 'bigint') return { '#bigint': v.toString() }
    if (v === undefined) return '#undefined'
    return v
  }) ?? '#undefined'
}

const NUMERO = /(?<!\d)\d{6}(?!\d)/g
const VERS_LE_DEFAUT = new Map(ROLES_COMPTABLES.map((r) => [PLAN_DECALE[r.role], PLAN_PAR_DEFAUT[r.role]]))
const COMPTES_PAR_DEFAUT = new Set(Object.values(PLAN_PAR_DEFAUT))
const rameneAuDefaut = (texte: string) => texte.replace(NUMERO, (n) => VERS_LE_DEFAUT.get(n) ?? n)
const numeros = (texte: string) => [...texte.matchAll(NUMERO)].map((m) => m[0])

describe('chaque composition prend ses comptes de rôle dans le plan du dossier', () => {
  it('le plan décalé change chaque compte de rôle, sans en échanger deux', () => {
    // Sans quoi « ramené au défaut » confondrait deux rôles, et un compte par défaut resterait légitime sous lui.
    expect(VERS_LE_DEFAUT.size).toBe(ROLES_COMPTABLES.length)
    for (const r of ROLES_COMPTABLES) expect(COMPTES_PAR_DEFAUT.has(PLAN_DECALE[r.role]), r.role).toBe(false)
  })

  for (const cas of CAS_DU_PLAN) {
    it(cas.nom, () => {
      const parDefaut = forme(cas.composer(PLAN_PAR_DEFAUT))
      const decale = forme(cas.composer(PLAN_DECALE))
      expect(numeros(decale).filter((n) => COMPTES_PAR_DEFAUT.has(n)), 'un compte par défaut sous le plan décalé').toEqual([])
      expect(rameneAuDefaut(decale), 'ramené au défaut, le plan décalé rend autre chose').toBe(parDefaut)
      for (const role of cas.roles) expect(numeros(decale), `le rôle « ${role} » n’est pas exercé`).toContain(PLAN_DECALE[role])
      if (cas.temoin) expect(forme(cas.temoin(PLAN_PAR_DEFAUT)), 'le brouillon ne décide de rien').not.toBe(parDefaut)
    })
  }

  it('chaque rôle du catalogue est exercé par au moins un cas', () => {
    const exerces = new Set(CAS_DU_PLAN.flatMap((c) => c.roles))
    expect(ROLES_COMPTABLES.map((r) => r.role).filter((r) => !exerces.has(r))).toEqual([])
  })
})

// LE PLAN EST UN PARAMÈTRE OBLIGATOIRE : aucune composition ne se compile sans lui, ni un modèle comptable. Chaque appel
// ci-dessous omet le plan et porte `@ts-expect-error` — que `tsc -b` refuse dès qu'il n'y a plus d'erreur à attendre,
// c'est-à-dire dès qu'un plan par défaut s'y glisserait. La fonction n'est jamais appelée : seul le compilateur la juge.
interface Entrees {
  d: string
  piece: Piece
  cible: CibleComptable
  aComptabiliser: PieceAComptabiliser[]
  ecritures: EcritureBrouillon[]
  categories: Categorie[]
  paiements: PaiementsDesPieces
  modele: ModeleComptable
  ligne: MouvementBancaire
  affectes: MouvementAffecte[]
  decoupage: DecoupageEcheance
  cotisations: CotisationDeclaree[]
  declarations: DeclarationTva[]
  demande: DemandeDeDeclaration
  bien: Immobilisation
  natures: NatureImmobilisation[]
  balance: LigneBalance[]
  propositions: PropositionRegle[]
  reponse: ReponseDuPlan
}

describe('le plan est un paramètre OBLIGATOIRE', () => {
  it('aucune composition ne se compile sans lui (les directives `@ts-expect-error` sont jugées par tsc -b)', () => {
    const sansLePlan = (x: Entrees) => {
      // @ts-expect-error — un modèle comptable porte le plan du dossier
      const modele: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: x.modele.compteNotesDeFrais }
      // @ts-expect-error — le modèle d'un dossier se valide contre son plan
      modeleDuDossier({ mode_comptable: 'tresorerie', compte_notes_de_frais: '108000' })
      // @ts-expect-error — le compte du dirigeant se juge dans un plan
      roleDuDirigeant('108000')
      // @ts-expect-error — la lecture du plan reçoit sa réponse
      planDeLaReponse()
      // @ts-expect-error — et sa requête
      void lireLePlanDuDossier()
      // @ts-expect-error — omis
      lignesChargeProduitPourPiece(x.d, x.piece, x.cible, true, [])
      // @ts-expect-error — omis
      ligneContrepartieBanque(x.d, x.piece, { id: 'l', date: '2026-01-01', montant: 1 })
      // @ts-expect-error — omis
      ligneContrepartieDirigeant(x.d, x.piece, [], [])
      // @ts-expect-error — omis
      ecrituresSansObjet(x.ecritures, [x.piece], x.categories, new Map(), null)
      // @ts-expect-error — omis
      compteDeTiers(x.piece, '455000', false)
      // @ts-expect-error — omis
      comptesDeTiers()
      // @ts-expect-error — omis
      comptesDuDirigeant()
      // @ts-expect-error — omis
      lignesFactureEngagement(x.d, x.piece, x.cible, true, '455000')
      // @ts-expect-error — omis
      lignesReglementEngagement(x.d, x.piece, x.ligne, '455000', false)
      // @ts-expect-error — omis
      lignesEngagementPourPiece(x.d, x.piece, x.cible, true, '455000', [])
      // @ts-expect-error — omis
      ecritureDuMouvement(x.ligne, '606100', null)
      // @ts-expect-error — omis
      mouvementsAffectesDesynchronises(x.ecritures, x.affectes, null)
      // @ts-expect-error — omis
      ecritureDeLEcheance(x.ligne, x.decoupage)
      // @ts-expect-error — omis
      echeancesDesynchronisees(x.ecritures, [x.ligne])
      // @ts-expect-error — omis
      ecritureDeLaCotisation(x.ligne, x.cotisations[0], 'tresorerie')
      // @ts-expect-error — omis
      cotisationsAEcrire(x.ecritures, [x.ligne], x.cotisations, 'tresorerie', null)
      // @ts-expect-error — omis
      ecritureDeLaLiquidation(x.declarations[0])
      // @ts-expect-error — omis
      ecritureDuPaiementTva(x.ligne)
      // @ts-expect-error — omis
      parametresEnregistrement(x.d, x.demande, null)
      // @ts-expect-error — omis
      liquidationsDesynchronisees(x.ecritures, x.declarations, null)
      // @ts-expect-error — omis
      paiementsTvaDesynchronises(x.ecritures, [x.ligne], null)
      // @ts-expect-error — omis
      compteTvaDe(x.piece, false)
      // @ts-expect-error — omis
      ecritureDeLaDotation(x.bien, '218300', 2026, null)
      // @ts-expect-error — omis
      dotationsDuRegistre([x.bien], x.natures, x.ecritures, null, 2026, null)
      // @ts-expect-error — omis
      calculerDeclaration2035(2026, [x.piece], x.categories, [x.bien], [], [], true, x.paiements, [], x.declarations)
      // @ts-expect-error — omis
      comptesDeBilanProposes()
      // @ts-expect-error — omis
      ecritureDuCompteDeBilan(x.ligne, '580000')
      // @ts-expect-error — omis
      mouvementsSurUnCompteDeBilanDesynchronises(x.ecritures, [x.ligne], null)
      // @ts-expect-error — omis
      compteDuResultat(true, 0)
      // @ts-expect-error — omis
      compteQuiRecoit('108000', true, '101000')
      // @ts-expect-error — omis
      compteDeLApplication('512')
      // @ts-expect-error — omis
      compteQueLApplicationEcrit('4010')
      // @ts-expect-error — omis
      preparerANouveaux(x.balance, 2026)
      // @ts-expect-error — le plan vient AVANT la taille facultative d'un envoi
      envoisDuLot(x.propositions)
      // Les compositions qui reçoivent le modèle le reçoivent avec son plan : sans modèle, rien ne se compose.
      // @ts-expect-error — omis
      lignesPourPiece(x.d, x.piece, x.cible, true, [])
      // @ts-expect-error — omis
      ecrituresAGenerer(x.d, x.aComptabiliser, x.ecritures, true, x.paiements)
      // @ts-expect-error — omis
      analyserEcritures(x.ecritures, x.aComptabiliser, true, x.paiements)
      // @ts-expect-error — omis
      ecritureDeLaVentilation(x.ligne, [], x.categories)
      // @ts-expect-error — omis
      mouvementsVentilesDesynchronises(x.ecritures, [x.ligne], [], x.categories)
      return modele
    }
    expect(typeof sansLePlan).toBe('function')
  })
})
