import { describe, expect, it } from 'vitest'
import { concordance2035 } from './concordance2035'
import { calculerCa3, type DeclarationCa3 } from './declarationTva'
import { calculerDeclaration2035, type EcrituresDesVentesDeLa2035 } from './declaration2035'
import { fraisDesMouvements } from './ecrituresVentesFacturees'
import type { Categorie } from './types'
import { etatsDesVentesFacturees, mouvementsClassesParEncaissements, type SourcesDesEcrituresDeVente } from './ecrituresVentesFactureesEcran'
import { arrondiDeLaLiquidation, declarationDeLaCa3, ecritureDeLaLiquidation, refusEnregistrement } from './liquidationTva'
import { PLAN_DECALE, PLAN_PAR_DEFAUT, type PlanComptable } from './planComptable'
import { paiementsDesPieces } from './rattachement'
import { calculerSituationIntermediaire } from './situationIntermediaire'
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
  const ca3 = calculerCa3({ pieces: [], paiements: paiementsDesPieces([], [], []), pieceIdsImmobilisees: new Set(), releve: [], ventesFacturees: ventes }, Q4, false, 0, 0)
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
    const declaration = calculerDeclaration2035(2025, [], [], [], [], [], true, paiementsDesPieces([], [], []), [], [], plan, ventes, { etat: 'composees', composition: composition(sources, 'tresorerie', plan) })
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
    const declaration = calculerDeclaration2035(2025, [], [], [], [], [], true, paiementsDesPieces([], [], []), [], [], plan, ventes, { etat: 'composees', composition: composition(sources, 'tresorerie', plan) })
    const c = concordance2035(declaration, sansE2, {
      piecesValidees: new Set(), piecesImmobilisees: new Set(), mouvementsDesVentesFacturees: mouvementsClassesParEncaissements(sources.mouvements),
    }, null)
    expect(c.ecarts.map((e) => [e.cle, e.motif])).toEqual([['encaissement:e2', 'vente_facturee_non_ecrite']])
    const ca3 = calculerCa3({ pieces: [], paiements: paiementsDesPieces([], [], []), pieceIdsImmobilisees: new Set(), releve: [], ventesFacturees: ventes }, Q4, false, 0, 0)
    expect(enregistrement(ca3, etats)).toMatch(/l’encaissement du 21\/11\/2025 de la facture F2025-0002 .*\(à écrire\)/)
  })
})

// LES FRAIS D'UN MOUVEMENT D'ENCAISSEMENTS, DE BOUT EN BOUT (ligne 28.65, VF4C3-Q1) : le même dossier, son virement m1 crédité
// de 118 € pour 120 € encaissés (2 € de frais) et sa remise de chèque m2 de 98 € pour 100 € (2 €). Pour chaque mouvement, les
// frais que la 2035 compte sont, au centime et à la date, les lignes que la composition écrit au compte des services
// bancaires ; écrites, la concordance est entière. Données FICTIVES.
describe.each(PLANS)('les frais d’un mouvement d’encaissements, de bout en bout — %s', (_, plan) => {
  const FRAIS_BANCAIRES = { id: 'c-frais', dossier_id: null, code: 'frais_bancaires', libelle: 'Frais bancaires', compte_comptable: '627000', poste_2035: 'Frais financiers' } as Categorie
  const sourcesAvecFrais = (): SourcesDesEcrituresDeVente => {
    const s = sourcesDuDossierBascule()
    return { ...s, mouvements: s.mouvements.map((m) => ({ ...m, montant: m.montant - 2 })) }
  }

  it('pour chaque mouvement, les frais que la 2035 compte égalent les lignes que la composition écrit, et tout concorde', () => {
    const sources = sourcesAvecFrais()
    const c = composition(sources, 'tresorerie', plan)
    const brouillon = brouillonDesVentes(c)
    const ventes = ventesFacturees({
      dossierId: sources.dossierId, factures: sources.factures, lignes: sources.lignes, encaissements: sources.encaissements, parts: sources.parts,
    })
    const declaration = calculerDeclaration2035(
      2025, [], [FRAIS_BANCAIRES], [], [], [], true, paiementsDesPieces([], [], []), [], [], plan, ventes, { etat: 'composees', composition: c },
    )
    // Les lignes du compte des services bancaires que le brouillon porte, mouvement par mouvement, signées au débit.
    const ecritParMouvement = new Map<string, number>()
    for (const l of brouillon) {
      if (l.compte !== plan.services_bancaires) continue
      expect(l.encaissement_id ?? l.facture_id).toBeNull()
      ecritParMouvement.set(l.ligne_bancaire_id!, (ecritParMouvement.get(l.ligne_bancaire_id!) ?? 0) + Math.round(l.montant * 100) * (l.sens === 'debit' ? 1 : -1))
    }
    const compteParMouvement = new Map(declaration.contributions
      .flatMap((x) => (x.source.type === 'frais_d_encaissements' ? [[x.source.id, x.centimes] as const] : [])))
    expect([...ecritParMouvement]).toEqual([['m1', 200], ['m2', 200]])
    expect([...compteParMouvement].sort()).toEqual([...ecritParMouvement].sort())
    for (const f of fraisDesMouvements(c, plan)) {
      expect(brouillon.filter((l) => l.ligne_bancaire_id === f.ligneBancaireId && l.compte === plan.services_bancaires).every((l) => l.date === f.date)).toBe(true)
    }
    expect(declaration.contributions.filter((x) => x.source.type === 'frais_d_encaissements').every((x) => x.compte === plan.services_bancaires)).toBe(true)
    expect(declaration.totalDepenses).toBe(4)
    const conc = concordance2035(declaration, brouillon, {
      piecesValidees: new Set(), piecesImmobilisees: new Set(), mouvementsDesVentesFacturees: mouvementsClassesParEncaissements(sources.mouvements),
    }, null)
    expect(conc.ecarts).toEqual([])
    expect(conc.ecritures).toEqual({ recettes: 183.33, depenses: 4, resultat: 179.33 })
  })
})

// LA SITUATION DE L'ANNÉE ENTIÈRE ET LA 2035 DU MÊME EXERCICE COMPTENT LES MÊMES FRAIS, AU MÊME POSTE (ligne 28.65) : le même
// dossier, ses deux mouvements crédités de 2 € de moins que leurs encaissements. La situation est la 2035 « à ce jour » : sur
// l'année civile, elle doit dire, poste par poste, ce que la 2035 déclare — et ce qu'aucune ligne ne porte, les mêmes frais.
// Sous les deux plans ; en engagement, la composition écrit le mouvement comme en trésorerie, et les frais restent les mêmes.
// Données FICTIVES.
describe.each(PLANS)('la situation de l’année et la 2035 comptent les mêmes frais d’encaissements — %s', (_, plan) => {
  const categorieFrais = (o: Partial<Categorie> = {}): Categorie => ({
    id: 'c-frais', dossier_id: null, code: 'frais_bancaires', libelle: 'Frais bancaires', ordre: 1, compte_comptable: '627000',
    poste_2035: 'Frais financiers', ...o,
  })
  const sources = (): SourcesDesEcrituresDeVente => {
    const s = sourcesDuDossierBascule()
    return { ...s, mouvements: s.mouvements.map((m) => ({ ...m, montant: m.montant - 2 })) }
  }
  const lesDeux = (mode: ModeComptable, categories: Categorie[]) => {
    const s = sources()
    const ventes = ventesFacturees({ dossierId: s.dossierId, factures: s.factures, lignes: s.lignes, encaissements: s.encaissements, parts: s.parts })
    const ecritures: EcrituresDesVentesDeLa2035 = { etat: 'composees', composition: composition(s, mode, plan) }
    return {
      situation: calculerSituationIntermediaire([], categories, [], [], '2025-01-01', '2025-12-31', true, new Map(), mode, [], ventes, plan, ecritures),
      declaration: calculerDeclaration2035(2025, [], categories, [], [], [], true, paiementsDesPieces([], [], []), [], [], plan, ventes, ecritures),
    }
  }

  it.each(['tresorerie', 'engagement'] as const)('en %s : les frais, poste pour poste', (mode) => {
    const { situation, declaration } = lesDeux(mode, [categorieFrais()])
    const depensesDeLa2035 = declaration.depenses.map((l): [string, number] => [l.poste, -l.montant])
    expect(depensesDeLa2035).toEqual([['Frais financiers', -4]])
    expect(situation.totauxParPoste.filter(([, montant]) => montant < 0)).toEqual(depensesDeLa2035)
    expect(situation.charges).toBe(declaration.totalDepenses)
  })

  it('en trésorerie : la situation de l’année entière est la 2035, recettes, charges et résultat', () => {
    const { situation, declaration } = lesDeux('tresorerie', [categorieFrais()])
    expect(situation.totauxParPoste).toEqual([
      ...declaration.recettes.map((l): [string, number] => [l.poste, l.montant]),
      ...declaration.depenses.map((l): [string, number] => [l.poste, -l.montant]),
    ])
    expect([situation.recettes, situation.charges]).toEqual([declaration.totalRecettes, declaration.totalDepenses])
    expect(situation.resultat).toBeCloseTo(declaration.resultat, 10)
  })

  const SANS_LIGNE: [string, Categorie[]][] = [
    ['sans poste', [categorieFrais({ poste_2035: null })]],
    ['sans catégorie « Frais bancaires »', []],
  ]
  it.each(SANS_LIGNE)('%s : les mêmes frais, sur aucune ligne, dits par les deux', (_, categories) => {
    const { situation, declaration } = lesDeux('tresorerie', categories)
    expect(declaration.depenses).toEqual([])
    expect(situation.charges).toBe(0)
    expect(situation.fraisSansPoste).toEqual(declaration.exclusions.fraisSansPoste)
    expect(situation.fraisSansPoste.map((f) => f.frais.ligneBancaireId)).toEqual(['m1', 'm2'])
  })
})
