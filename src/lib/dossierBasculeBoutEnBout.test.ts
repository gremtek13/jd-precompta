import { describe, expect, it } from 'vitest'
import { concordance2035 } from './concordance2035'
import { calculerCa3, type DeclarationCa3 } from './declarationTva'
import { calculerDeclaration2035 } from './declaration2035'
import { etatsDesVentesFacturees, mouvementsClassesParEncaissements, type SourcesDesEcrituresDeVente } from './ecrituresVentesFactureesEcran'
import { arrondiDeLaLiquidation, declarationDeLaCa3, ecritureDeLaLiquidation, refusEnregistrement } from './liquidationTva'
import { PLAN_DECALE, PLAN_PAR_DEFAUT, type PlanComptable } from './planComptable'
import { paiementsDesPieces } from './rattachement'
import type { EcritureBrouillon, ModeComptable } from './types'
import { ventesFacturees } from './ventesFacturees'
import { brouillonDesVentes, composition, sourcesDuDossierBascule } from '../test/dossierBascule'

// UN DOSSIER QUI A BASCULÉ, DE BOUT EN BOUT (chantier EC-Q3, étape VF4c3) : les lignes de la base (src/test/dossierBascule.ts
// — trois factures de services, un avoir, un virement du même jour, un chèque remis la veille de son crédit), la composition
// de VF4a, le brouillon que la fonction de VF4b en écrit, puis ce que la 2035, sa concordance, la CA3 et la liquidation en
// font. Rien n'est écrit à la main : la 2035 et la CA3 lisent le module des ventes facturées, les écritures la composition,
// et les deux doivent se retrouver au centime. Sous les deux plans, dans les deux modèles. Données FICTIVES.
const Q4 = { debut: '2025-10-01', fin: '2025-12-31' }
const PLANS: readonly [string, PlanComptable][] = [['plan par défaut', PLAN_PAR_DEFAUT], ['plan décalé', PLAN_DECALE]]

function leDossier(mode: ModeComptable, plan: PlanComptable) {
  const sources: SourcesDesEcrituresDeVente = sourcesDuDossierBascule()
  const brouillon: EcritureBrouillon[] = brouillonDesVentes(composition(sources, mode, plan))
  const ventes = ventesFacturees({
    dossierId: sources.dossierId, factures: sources.factures, lignes: sources.lignes, encaissements: sources.encaissements, parts: sources.parts,
  })
  const etats = etatsDesVentesFacturees({ sources, brouillon, mode, plan, anneesValidees: [], ventesParLesFactures: true })
  const ca3 = calculerCa3({ pieces: [], paiements: paiementsDesPieces([], []), pieceIdsImmobilisees: new Set(), releve: [], ventesFacturees: ventes }, Q4, false, 0, 0)
  return { sources, brouillon, ventes, etats, ca3 }
}

// Le solde d'un compte dans la période, en centimes, positif au crédit.
const auCredit = (lignes: readonly Pick<EcritureBrouillon, 'compte' | 'date' | 'sens' | 'montant'>[], compte: string, debut = '0000', fin = '9999') => lignes
  .filter((l) => l.compte === compte && l.date >= debut && l.date <= fin)
  .reduce((t, l) => t + Math.round(l.montant * 100) * (l.sens === 'credit' ? 1 : -1), 0)

function enregistrement(ca3: DeclarationCa3, etats: ReturnType<typeof etatsDesVentesFacturees>) {
  return refusEnregistrement(
    { periode: Q4, ca3, remboursement: 0, tvaDeclaree: null, credit: null },
    { assujettiTva: true, aujourdhui: '2026-01-15', declarations: [], ouverture: null, anneesValidees: [], ventesFacturees: { etat: 'lue', etats } },
  )
}

describe.each(PLANS)('un dossier basculé, de bout en bout — %s', (_, plan) => {
  it('en trésorerie : la 2035 concorde avec les écritures, au compte que la composition écrit', () => {
    const { sources, brouillon, ventes, etats } = leDossier('tresorerie', plan)
    expect(etats.etat === 'lus' && etats.sources.every((s) => s.etat === 'a_jour')).toBe(true)
    const declaration = calculerDeclaration2035(2025, [], [], [], [], [], true, paiementsDesPieces([], []), [], [], plan, ventes)
    // 100 € de F2025-0001 et 83,33 € des 100 € TTC encaissés de F2025-0002 ; l'avoir de F2025-0003, sans encaissement, rien.
    expect(declaration.totalRecettes).toBe(183.33)
    expect([...new Set(declaration.contributions.map((c) => c.compte))]).toEqual([plan.prestations_de_services])
    const c = concordance2035(declaration, brouillon, {
      piecesValidees: new Set(), piecesImmobilisees: new Set(), mouvementsDesVentesFacturees: mouvementsClassesParEncaissements(sources.mouvements),
    }, null)
    expect(c.ecarts).toEqual([])
    expect(c.concorde).toBe(true)
    expect(c.ecritures).toEqual({ recettes: 183.33, depenses: 0, resultat: 183.33 })
    expect(auCredit(brouillon, plan.prestations_de_services)).toBe(18_333)
  })

  it.each(['tresorerie', 'engagement'] as const)('en %s : la CA3 s’enregistre, et la liquidation solde le 445710 au centime', (mode) => {
    const { brouillon, etats, ca3 } = leDossier(mode, plan)
    expect(etats.etat === 'lus' && etats.sources.every((s) => s.etat === 'a_jour')).toBe(true)
    // La TVA des deux encaissements de services, à leur date : 20 € et 16,67 €.
    expect(ca3.tvaDesComptes.collectee).toBe(36.67)
    expect(auCredit(brouillon, plan.tva_collectee, Q4.debut, Q4.fin)).toBe(3667)
    expect(enregistrement(ca3, etats)).toBeNull()
    const liquidee = declarationDeLaCa3(ca3, Q4)
    // L'arrondi n'est que celui des lignes : 36,67 € de TVA, 37 € déclarés.
    expect(arrondiDeLaLiquidation(liquidee)).toBe(0.33)
    const liquidation = ecritureDeLaLiquidation(liquidee, plan)
    // Après la liquidation, le compte de la TVA collectée est soldé.
    expect(auCredit(brouillon, plan.tva_collectee, Q4.debut, Q4.fin)
      + auCredit(liquidation.map((l) => ({ ...l, date: Q4.fin })), plan.tva_collectee)).toBe(0)
    if (mode === 'engagement') {
      // La TVA en attente reste : celle des 140 € que F2025-0002 doit encore, 23,33 € ; F2025-0003 et son avoir se soldent.
      expect(auCredit(brouillon, plan.tva_collectee_en_attente)).toBe(2333)
      expect(liquidation.some((l) => l.compte === plan.tva_collectee_en_attente)).toBe(false)
    }
  })

  it('une écriture retirée du brouillon : la concordance la dit à écrire, la liquidation l’attend', () => {
    const { sources, brouillon, ventes } = leDossier('tresorerie', plan)
    const sansE2 = brouillon.filter((l) => l.encaissement_id !== 'e2')
    const etats = etatsDesVentesFacturees({ sources, brouillon: sansE2, mode: 'tresorerie', plan, anneesValidees: [], ventesParLesFactures: true })
    const declaration = calculerDeclaration2035(2025, [], [], [], [], [], true, paiementsDesPieces([], []), [], [], plan, ventes)
    const c = concordance2035(declaration, sansE2, {
      piecesValidees: new Set(), piecesImmobilisees: new Set(), mouvementsDesVentesFacturees: mouvementsClassesParEncaissements(sources.mouvements),
    }, null)
    expect(c.ecarts.map((e) => [e.cle, e.motif])).toEqual([['encaissement:e2', 'vente_facturee_non_ecrite']])
    const ca3 = calculerCa3({ pieces: [], paiements: paiementsDesPieces([], []), pieceIdsImmobilisees: new Set(), releve: [], ventesFacturees: ventes }, Q4, false, 0, 0)
    expect(enregistrement(ca3, etats)).toMatch(/l’encaissement du 21\/11\/2025 de la facture F2025-0002 .*\(à écrire\)/)
  })
})
