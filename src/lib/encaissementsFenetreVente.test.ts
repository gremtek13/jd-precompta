import { describe, expect, it } from 'vitest'
import {
  AUJOURD_HUI_RELEVE, MONDE, batterie, entierTire, entreeDuCas, lecturesDuMonde, tirage,
} from '../test/encaissementsBatterie'
import {
  ANNEES_ILLISIBLES, FRONTIERE_JUGEE_PAR_LA_BASE, LA_BASE_ADMET_LE_GESTE, NE_POURRA_PAS_SE_CLASSER, REFUS_CONTRE_PASSATION,
  REFUS_ENREGISTREMENT, REFUS_RETRAIT, debitsCitables,
  frontiereJugeeParLaBase, inclassableApres, inclassableApresContrePassation, inclassableApresEnregistrement,
  propositionsEncaissement, refusContrePassation, refusContrePassationVente, refusEnregistrement, refusEnregistrementVente,
  refusRetrait, refusRetraitVente, resteAEncaisser, resteAEncaisserVente,
  type ContexteFacture, type ContexteVente, type DeclarationLue, type EncaissementPourContrePassation, type FactureDuDossier,
  type FacturePourEncaissement, type LigneDeFacture, type MouvementClasse, type MouvementPropose, type PieceLue,
  type SaisieEncaissement,
} from './encaissementsFactures'
import { motsDuCabinet, pourLEspace } from './espaceVentes'
import { paiementsDesPieces, type LignePayante } from './rattachement'

// LA FENÊTRE DES ENCAISSEMENTS JUGE UNE FACTURE SOURCE (ligne 28.65, chantier EC-Q3, étape VF5b ; conception : HISTORIQUE.md,
// « VF5, LA BANQUE : LA CONCEPTION », § 5, la puce VF5b). Ce que ces cas gardent :
//  1. L'ÉQUIVALENCE : pour une facture qui n'est pas source, les jugements de la vente rendent EXACTEMENT ceux d'hier — sur les
//     4 000 saisies tirées de la batterie (src/test/encaissementsBatterie.ts), chacune avec un contexte de la vente tiré lui
//     aussi (des exercices validés, ou illisibles ; des avoirs ; ce qui classe chaque mouvement), et sur des retraits et des
//     contre-passations tirés de même. Le plancher : la même batterie, la facture rendue source, change des réponses — le
//     test n'est pas aveugle là où il dit « rien ne change ». Une exception, depuis l'étape VF5h2 (VF5H-Q2, migration
//     registre_virement_mixte) : sur un mouvement classé PAR SES ENCAISSEMENTS — un virement mixte —, trois refus neufs
//     (`virementMixte`). Chaque écart est l'un d'eux, à son rang — la réponse d'hier quand elle le précède, le refus neuf
//     sinon —, et seulement sur un tel mouvement ; le tirage en rencontre, et une seconde passe, chaque mouvement classé par
//     ses encaissements, les atteint tous les trois.
//  2. Les exercices validés ILLISIBLES (le client) : la frontière sautée, jamais tenue pour vide.
//  3. Le reste net des avoirs, les propositions d'une facture source, les débits citables, le geste qui rendrait un
//     mouvement inclassable. Données FICTIVES.

const D = 'd1'
const AUJOURD_HUI = '2027-11-02'

// ── 1. L'équivalence, sur un tirage ──────────────────────────────────────────────────────────────────────────────────

const SAISIES = 4000
const GRAINE = 20261022

// Ce qui classe un mouvement, tiré : libre le plus souvent, sinon un classement que la base laisse naître.
const CLASSEMENTS_TIRES: Partial<MouvementClasse>[] = [
  {}, {}, {}, { statut: 'rapprochee', piece_id: 'p1' }, { statut: 'rapprochee', categorie_id: 'k1' },
  { statut: 'rapprochee', ventilee: true }, { statut: 'rapprochee', encaissements_de_factures: true },
  { statut: 'ignoree', prelevement_personnel: true }, { statut: 'ignoree' },
]

function classe(m: { id: string; dossier_id: string; date: string; montant: number }, o: Partial<MouvementClasse> = {}): MouvementClasse {
  return {
    ...m, statut: 'non_rapprochee', piece_id: null, cotisation_id: null, categorie_id: null, emprunt_id: null, compte_bilan: null,
    declaration_tva_id: null, ventilee: false, reglement_groupe: false, prelevement_personnel: false,
    encaissements_de_factures: false, ...o,
  }
}

// Les factures du monde, telles que le contexte de la vente les lit ; `source` force la source de toutes.
function facturesDuMonde(source: boolean): FactureDuDossier[] {
  const l = lecturesDuMonde(MONDE)
  return MONDE.factures.map((f) => {
    const lue = l.factures.get(f.id) as FacturePourEncaissement
    return {
      id: f.id, dossier_id: lue.dossier_id, numero: f.id, type: f.type, statut: f.statut, facture_origine_id: f.origine,
      source_de_la_vente: source && f.type === 'facture',
    }
  })
}

const ANNEES_TIREES: ContexteVente['anneesValidees'][] = [[], [2025], [2026], [2025, 2026], ANNEES_ILLISIBLES]

// Le refus neuf de l'étape VF5h2, tel que le module le rend : sa clé et son modèle, qui n'attend aucune valeur.
function refusNeuf<C extends string>(liste: readonly { cle: C; modele: string }[], cle: C) {
  const r = liste.find((x) => x.cle === cle) as { cle: C; modele: string }
  return { cle, message: r.modele }
}

// Chaque mouvement classé par ses encaissements : la seconde passe, qui ne tire rien.
const parSesEncaissements = (mouvements: readonly MouvementClasse[]) =>
  mouvements.map((m) => ({ ...m, statut: 'rapprochee' as const, encaissements_de_factures: true }))

describe('l’équivalence : une facture qui n’est pas source se juge comme hier, hors du virement mixte', () => {
  const cas = batterie(SAISIES, GRAINE, AUJOURD_HUI_RELEVE)
  const suivant = tirage(GRAINE + 1)
  const tirer = <T>(liste: readonly T[]): T => liste[entierTire(suivant, liste.length)]
  const entrees = cas.map((c) => {
    const e = entreeDuCas(MONDE, c)
    const mouvements = e.mouvements.map((m) => classe(m, tirer(CLASSEMENTS_TIRES)))
    const vente: ContexteVente = { anneesValidees: tirer(ANNEES_TIREES), factures: facturesDuMonde(false) }
    return { ...e, mouvementsClasses: mouvements, vente, gereLaBanque: suivant() < 0.8 }
  })

  // Le rang 18 (étape VF5h2) : la réponse d'hier si elle le précède ; sinon, si la saisie cite un mouvement du dossier classé
  // par ses encaissements, le refus neuf.
  const RANG_18 = REFUS_ENREGISTREMENT.findIndex((r) => r.cle === 'mouvement_classe_facture_d_avant')
  const enregistrementAttendu = (e: (typeof entrees)[number], mouvements: readonly MouvementClasse[]) => {
    const hier = refusEnregistrement(e.contexte, e.saisie, e.mouvements, AUJOURD_HUI_RELEVE, e.gereLaBanque)
    const cite = mouvements.find((m) => m.id === e.saisie.ligneBancaireId && m.dossier_id === e.contexte.dossierId)
    const avant = hier != null && REFUS_ENREGISTREMENT.findIndex((r) => r.cle === hier.cle) < RANG_18
    return cite?.encaissements_de_factures && !avant ? refusNeuf(REFUS_ENREGISTREMENT, 'mouvement_classe_facture_d_avant') : hier
  }

  it('enregistrer : 4 000 saisies, la même réponse — avec ou sans « Banque », exercices validés ou illisibles', () => {
    for (const [passe, mouvementsDe] of [
      ['tirée', (e: (typeof entrees)[number]) => e.mouvementsClasses],
      ['par ses encaissements', (e: (typeof entrees)[number]) => parSesEncaissements(e.mouvementsClasses)],
    ] as const) {
      const ecarts = entrees.filter((e) =>
        JSON.stringify(refusEnregistrementVente(e.contexte, e.saisie, mouvementsDe(e), AUJOURD_HUI_RELEVE, e.gereLaBanque, e.vente))
        !== JSON.stringify(enregistrementAttendu(e, mouvementsDe(e))))
      expect(ecarts.length, passe).toBe(0)
      // Le refus neuf se rencontre, à la place d'une acceptation comme d'un refus qui le suit.
      const neufs = entrees.filter((e) => enregistrementAttendu(e, mouvementsDe(e))?.cle === 'mouvement_classe_facture_d_avant')
      const remplaces = new Set(neufs.map((e) =>
        refusEnregistrement(e.contexte, e.saisie, e.mouvements, AUJOURD_HUI_RELEVE, e.gereLaBanque)?.cle ?? 'ok'))
      expect(remplaces.has('ok'), passe).toBe(true)
      expect(remplaces.size, passe).toBeGreaterThanOrEqual(2)
    }
    // Les réponses ne sont pas toutes les mêmes : le tirage parcourt les refus, et l'acceptation.
    const cles = new Set(entrees.map((e) =>
      refusEnregistrement(e.contexte, e.saisie, e.mouvements, AUJOURD_HUI_RELEVE, e.gereLaBanque)?.cle ?? 'ok'))
    expect(cles.size).toBeGreaterThanOrEqual(20)
  })

  it('le plancher : la même batterie, ses factures rendues SOURCES et un exercice validé, change des réponses', () => {
    const differentes = entrees.filter((e) => {
      const source = { ...e.contexte, facture: { ...e.contexte.facture, source_de_la_vente: e.contexte.facture.type === 'facture' } }
      const vente: ContexteVente = { anneesValidees: [2026], factures: facturesDuMonde(true) }
      return JSON.stringify(refusEnregistrementVente(source, e.saisie, e.mouvementsClasses, AUJOURD_HUI_RELEVE, e.gereLaBanque, vente))
        !== JSON.stringify(refusEnregistrement(e.contexte, e.saisie, e.mouvements, AUJOURD_HUI_RELEVE, e.gereLaBanque))
    })
    expect(differentes.length).toBeGreaterThan(500)
  })

  // Les encaissements du monde, datés, et des déclarations tirées : le retrait et la contre-passation, sans débit.
  const l = lecturesDuMonde(MONDE)
  const encaissements: EncaissementPourContrePassation[] = l.encaissements.map((e, i) => ({
    ...e, date_encaissement: `2026-09-${String(10 + i).padStart(2, '0')}`,
  }))
  const etats: DeclarationLue['etat'][] = ['envoi', 'depose', 'accepte', 'echec', 'rejete']
  const tirages = Array.from({ length: 1500 }, () => {
    const e = tirer(encaissements)
    const declarations = encaissements.filter(() => suivant() < 0.4).map((x) => ({ encaissement_id: x.id, etat: tirer(etats) }))
    return {
      dossierId: suivant() < 0.9 ? e.dossier_id : D,
      id: suivant() < 0.95 ? e.id : 'inconnu',
      declarations,
      date: tirer([null, '2026-09-01', '2026-09-30', '2026-10-10', '2026-10-11', '2026-13-01']),
      motif: tirer([null, '', '   ', 'Chèque revenu impayé', 'x'.repeat(2001)]),
      mouvements: l.mouvements.map((m) => classe(m, tirer(CLASSEMENTS_TIRES))),
      vente: { anneesValidees: tirer(ANNEES_TIREES), factures: facturesDuMonde(false) } satisfies ContexteVente,
    }
  })

  // Le mouvement dont dépend un encaissement : le sien, ou, pour une contre-passation sans mouvement, celui de l'encaissement
  // qu'elle annule.
  const dontIlDepend = (id: string, mouvements: readonly MouvementClasse[]) => {
    const e = encaissements.find((x) => x.id === id)
    const ligne = e?.ligne_bancaire_id ?? encaissements.find((x) => x.id === e?.annule_id)?.ligne_bancaire_id ?? null
    return mouvements.find((m) => m.id === ligne)
  }

  it('retirer : 1 500 tirages, la même réponse — le rang 8 (étape VF5h2) après les refus d’hier', () => {
    for (const passe of ['tirée', 'par ses encaissements'] as const) {
      let neufs = 0
      for (const t of tirages) {
        const mouvements = passe === 'tirée' ? t.mouvements : parSesEncaissements(t.mouvements)
        const declares = new Set(t.declarations.filter((d) => ['envoi', 'depose', 'accepte'].includes(d.etat)).map((d) => d.encaissement_id))
        const hier = refusRetrait(t.dossierId, t.id, encaissements, declares)
        const attendu = hier ?? (dontIlDepend(t.id, mouvements)?.encaissements_de_factures
          ? refusNeuf(REFUS_RETRAIT, 'mouvement_classe_facture_d_avant') : null)
        if (attendu !== hier) neufs += 1
        expect(refusRetraitVente(t.dossierId, t.id, encaissements, declares, mouvements, t.vente), passe).toEqual(attendu)
      }
      expect(neufs, passe).toBeGreaterThan(0)
    }
  })

  it('contre-passer sans débit : 1 500 tirages, la même réponse, avec ou sans « Banque » — le rang 21 (étape VF5h2) en dernier', () => {
    const cles = new Set<string>()
    for (const passe of ['tirée', 'par ses encaissements'] as const) {
      let neufs = 0
      // Le droit « Banque » alterne d'un tirage à l'autre sans consommer de hasard : sans débit cité, il ne change rien
      // (migration contre_passation_banque : le refus du rang 2 ne vise qu'un débit cité).
      tirages.forEach((t, i) => {
        const mouvements = passe === 'tirée' ? t.mouvements : parSesEncaissements(t.mouvements)
        const hier = refusContrePassation(t.dossierId, t.id, encaissements, t.declarations, t.date, t.motif, AUJOURD_HUI_RELEVE)
        cles.add(hier?.cle ?? 'ok')
        // Le rang 21 ne regarde que le mouvement de l'encaissement lui-même : une contre-passation ne se contre-passe pas.
        const sien = encaissements.find((x) => x.id === t.id)?.ligne_bancaire_id
        const attendu = hier ?? (sien != null && mouvements.find((m) => m.id === sien)?.encaissements_de_factures
          ? refusNeuf(REFUS_CONTRE_PASSATION, 'mouvement_encaissement_classe_facture_d_avant') : null)
        if (attendu !== hier) neufs += 1
        expect(refusContrePassationVente(
          t.dossierId, t.id, encaissements, t.declarations, t.date, t.motif, AUJOURD_HUI_RELEVE, null, mouvements, i % 2 === 0,
          t.vente,
        ), passe).toEqual(attendu)
      })
      if (passe === 'par ses encaissements') expect(neufs).toBeGreaterThan(0)
    }
    expect(cles.size).toBeGreaterThanOrEqual(8)
  })
})

// ── Le jeu d'une facture SOURCE ───────────────────────────────────────────────────────────────────────────────────────

// 1 000 € à 20 %, 100 € à 5,5 %, 50 € à 0 % — 1 355,50 € TTC. Son avoir validé crédite 120 € à 20 %.
const LIGNES: LigneDeFacture[] = [
  { facture_id: 'f1', ordre: 1, designation: 'a', quantite: 1, prix_unitaire_ht: 1000, taux_tva: 20 },
  { facture_id: 'f1', ordre: 2, designation: 'b', quantite: 1, prix_unitaire_ht: 100, taux_tva: 5.5 },
  { facture_id: 'f1', ordre: 3, designation: 'c', quantite: 1, prix_unitaire_ht: 50, taux_tva: 0 },
  { facture_id: 'av1', ordre: 1, designation: 'remise', quantite: -1, prix_unitaire_ht: 100, taux_tva: 20 },
  { facture_id: 'av2', ordre: 1, designation: 'remise', quantite: -1, prix_unitaire_ht: 50, taux_tva: 20 },
]

function facture(o: Partial<FacturePourEncaissement> = {}): FacturePourEncaissement {
  return {
    id: 'f1', dossier_id: D, statut: 'validee', type: 'facture', numero: 'F2027-0042', date_emission: '2027-10-01',
    emetteur_siret: '12345678200010', montant_ht: 1150, montant_tva: 205.5, montant_ttc: 1355.5, superpdp_invoice_id: null,
    tiers_nom: 'Client Fictif SAS', source_de_la_vente: true, ...o,
  }
}

function contexte(o: Partial<ContexteFacture> = {}): ContexteFacture {
  return {
    dossierId: D, facture: facture(), lignes: LIGNES, transmissions: [], evenementsSuperpdp: [], statutsRecus: [],
    encaissements: [], parts: [], ...o,
  }
}

function factureDuDossier(o: Partial<FactureDuDossier>): FactureDuDossier {
  return { id: 'f1', dossier_id: D, numero: 'F2027-0042', type: 'facture', statut: 'validee', facture_origine_id: null, source_de_la_vente: true, ...o }
}

const FACTURES: FactureDuDossier[] = [
  factureDuDossier({}),
  factureDuDossier({ id: 'av1', numero: 'A2027-0001', type: 'avoir', facture_origine_id: 'f1' }),
  // Un brouillon d'avoir ne crédite rien.
  factureDuDossier({ id: 'av2', numero: null, type: 'avoir', statut: 'brouillon', facture_origine_id: 'f1' }),
  factureDuDossier({ id: 'f2', numero: 'F2027-0043', source_de_la_vente: false }),
  factureDuDossier({ id: 'f3', numero: 'F2027-0044' }),
]

function vente(o: Partial<ContexteVente> = {}): ContexteVente {
  return { anneesValidees: [], factures: FACTURES, ...o }
}

function mouvement(o: Partial<MouvementPropose> = {}): MouvementPropose {
  return {
    ...classe({ id: 'm1', dossier_id: D, date: '2027-10-15', montant: 1235.5 }), libelle: 'VIR SEPA CLIENT FICTIF', libelle_brut: null, ...o,
  }
}

function encaissement(o: Partial<EncaissementPourContrePassation> = {}): EncaissementPourContrePassation {
  return {
    id: 'e1', dossier_id: D, facture_id: 'f1', montant: 100, ligne_bancaire_id: null, annule_id: null, retire_le: null,
    date_encaissement: '2027-10-15', ...o,
  }
}

function saisie(o: Partial<SaisieEncaissement> = {}): SaisieEncaissement {
  return { date: '2027-10-15', montant: 100, moyen: 'virement', ligneBancaireId: null, repartition: [{ taux: 20, montant: 100 }], ...o }
}

// ── 2. Les exercices validés illisibles ──────────────────────────────────────────────────────────────────────────────

describe('les exercices validés illisibles (le client) : la frontière sautée, jamais tenue pour vide', () => {
  const illisibles = vente({ anneesValidees: ANNEES_ILLISIBLES })

  it('enregistrer : la frontière se dit au cabinet ; illisible, le refus suivant — la date d’une facture source', () => {
    const s = saisie({ date: '2026-12-15' })
    expect(refusEnregistrementVente(contexte(), s, [], AUJOURD_HUI, true, vente({ anneesValidees: [2026] })))
      .toEqual({ cle: 'frontiere', message: "L'exercice 2026 est validé : un encaissement de cette facture ne s'y date plus." })
    expect(refusEnregistrementVente(contexte(), s, [], AUJOURD_HUI, true, illisibles)).toBeNull()
    expect(refusEnregistrementVente(contexte(), { ...s, moyen: null }, [], AUJOURD_HUI, true, illisibles)?.cle).toBe('moyen_inconnu')
  })

  it('retirer et contre-passer : de même', () => {
    const e = encaissement({ date_encaissement: '2026-06-01' })
    expect(refusRetraitVente(D, 'e1', [e], new Set(), [], vente({ anneesValidees: [2026] }))?.cle).toBe('frontiere')
    expect(refusRetraitVente(D, 'e1', [e], new Set(), [], illisibles)).toBeNull()
    const declare = [{ encaissement_id: 'e1', etat: 'depose' as const }]
    expect(refusContrePassationVente(D, 'e1', [e], declare, '2026-12-31', 'Impayé', AUJOURD_HUI, null, [], true, vente({ anneesValidees: [2026] }))?.cle)
      .toBe('frontiere')
    expect(refusContrePassationVente(D, 'e1', [e], declare, '2026-12-31', 'Impayé', AUJOURD_HUI, null, [], true, illisibles)).toBeNull()
  })

  it('la fenêtre ne dit la frontière jugée par la base que pour une facture source et des exercices illisibles', () => {
    expect(frontiereJugeeParLaBase(facture(), illisibles)).toBe(true)
    expect(frontiereJugeeParLaBase(facture(), vente())).toBe(false)
    expect(frontiereJugeeParLaBase(facture({ source_de_la_vente: false }), illisibles)).toBe(false)
    // La phrase est celle du client : tutoyée, sans mot du cabinet, et la même pour lui.
    expect(motsDuCabinet(FRONTIERE_JUGEE_PAR_LA_BASE)).toEqual([])
    expect(pourLEspace('client', FRONTIERE_JUGEE_PAR_LA_BASE)).toBe(FRONTIERE_JUGEE_PAR_LA_BASE)
  })

  it('une liste vide n’est pas « illisibles » : elle dit qu’aucun exercice n’est validé', () => {
    expect(ANNEES_ILLISIBLES).toBe('illisibles')
    expect(frontiereJugeeParLaBase(facture(), vente({ anneesValidees: [] }))).toBe(false)
  })
})

// ── 3. Le reste net, les propositions, les débits, le geste inclassable ──────────────────────────────────────────────

describe('resteAEncaisserVente — le reste qu’une facture source peut encore encaisser, net de ses avoirs validés', () => {
  it('une facture qui n’est pas source : le reste d’hier, avoir ou pas', () => {
    const c = contexte({ facture: facture({ source_de_la_vente: false }) })
    expect(resteAEncaisserVente(c, vente())).toEqual(resteAEncaisser(c))
  })

  it('une facture source : 120 € de moins à 20 %, ni le brouillon d’avoir ni l’avoir d’une autre facture', () => {
    const c = contexte({ encaissements: [encaissement({ montant: 200 })], parts: [{ encaissement_id: 'e1', taux: 20, montant: 200 }] })
    const r = resteAEncaisserVente(c, vente())
    expect(r.ttcCentimes).toBe(123550)
    expect(r.resteCentimes).toBe(103550)
    expect(r.parTaux).toEqual([
      { taux: 20, ttcCentimes: 108000, encaisseCentimes: 20000, resteCentimes: 88000 },
      { taux: 5.5, ttcCentimes: 10550, encaisseCentimes: 0, resteCentimes: 10550 },
      { taux: 0, ttcCentimes: 5000, encaisseCentimes: 0, resteCentimes: 5000 },
    ])
    // Le reste net est ce que la base accepte ; un centime de plus, ce qu'elle refuse.
    const parts = [{ taux: 20, montant: 880 }, { taux: 5.5, montant: 105.5 }, { taux: 0, montant: 50 }]
    expect(refusEnregistrementVente(c, saisie({ montant: 1035.5, repartition: parts }), [], AUJOURD_HUI, true, vente())).toBeNull()
    expect(refusEnregistrementVente(c, saisie({ montant: 1035.51, repartition: [...parts.slice(0, 2), { taux: 0, montant: 50.01 }] }), [], AUJOURD_HUI, true, vente())?.cle)
      .toBe('plafond_facture_net')
  })
})

describe('propositionsEncaissement — une facture source : des mouvements libres, jugés comme la base', () => {
  const T = { facture_id: 'f1', canal: 'plateforme' as const, etat: 'accepte' as const, hote: 'pa.exemple.fr', flux_id: 'flux-9' }
  const JUMELLE: PieceLue = {
    id: 'pj', dossier_id: D, flux_hote: 'pa.exemple.fr', flux_id: 'flux-9', superpdp_invoice_id: null,
    identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null,
  }
  const paye: LignePayante = {
    id: 'mj', piece_id: 'pj', date: '2027-10-12', montant: 1235.5, statut: 'rapprochee', reglement_groupe: false,
    encaissements_de_factures: false,
  }
  const proposer = (o: { source?: boolean; mouvements?: MouvementPropose[]; v?: ContexteVente } = {}) => propositionsEncaissement(
    contexte({ transmissions: [T], facture: facture({ source_de_la_vente: o.source ?? true }) }), [JUMELLE], paiementsDesPieces([paye], [], []),
    o.mouvements ?? [mouvement(), mouvement({ id: 'mj', date: '2027-10-12', statut: 'rapprochee', piece_id: 'pj' })], AUJOURD_HUI, true,
    o.v ?? vente(),
  )

  it('la jumelle d’une facture source ne propose plus ses mouvements ; celle d’une autre facture, si', () => {
    expect(proposer().map((p) => `${p.source}:${p.ligneBancaireId}`)).toEqual(['releve:m1'])
    // Hier : le reste brut (1 355,50 €) ; le paiement de la jumelle se propose, partiel, et le crédit de 1 235,50 € ne fait
    // pas ce reste.
    expect(proposer({ source: false }).map((p) => `${p.source}:${p.ligneBancaireId}`)).toEqual(['jumelle:mj'])
  })

  // L'EXEMPLAIRE DÉSIGNÉ (étape VF6d) : le PDF que le cabinet a désigné exemplaire de la facture, sans flux ni identité, est
  // une jumelle par sa désignation. Payé par un mouvement — un état d'avant la garde G4, qui le refuse désormais —, il ne
  // propose pas ce mouvement pour une facture source ; pour une autre, comme hier.
  it('l’exemplaire désigné d’une facture source ne propose pas son paiement ; celui d’une autre facture, si', () => {
    const PDF: PieceLue = {
      id: 'pdf', dossier_id: D, flux_hote: null, flux_id: null, superpdp_invoice_id: null, identite_numero: null,
      identite_siren_vendeur: null, identite_date: null, identite_nature: null, facture_id: 'f1',
    }
    const payePdf: LignePayante = { ...paye, id: 'mp', piece_id: 'pdf' }
    const proposerPdf = (source: boolean) => propositionsEncaissement(
      contexte({ facture: facture({ source_de_la_vente: source }) }), [PDF], paiementsDesPieces([payePdf], [], []),
      [mouvement({ id: 'mp', date: '2027-10-12', statut: 'rapprochee', piece_id: 'pdf' })], AUJOURD_HUI, true, vente(),
    )
    expect(proposerPdf(true)).toEqual([])
    expect(proposerPdf(false).map((p) => `${p.source}:${p.ligneBancaireId}`)).toEqual(['jumelle:mp'])
  })

  it('le crédit qui fait le reste NET se propose, au reste net ; celui du reste brut, non', () => {
    expect(proposer()).toMatchObject([{ ligneBancaireId: 'm1', montantCentimes: 123550, solde: true }])
    expect(proposer({ mouvements: [mouvement({ montant: 1355.5 })] })).toEqual([])
  })

  it('un mouvement classé, de quelque façon, ne se propose pas pour une facture source — il se proposait hier', () => {
    for (const o of CLASSEMENTS_TIRES.slice(3)) {
      expect(proposer({ mouvements: [mouvement(o)] }), JSON.stringify(o)).toEqual([])
    }
    expect(proposer({ source: false, mouvements: [mouvement({ montant: 1355.5, statut: 'rapprochee', categorie_id: 'k1' })] }))
      .toHaveLength(1)
  })

  it('une date que la frontière fige : la proposition se juge comme la base, et tombe', () => {
    expect(proposer({ mouvements: [mouvement({ date: '2027-10-15' })], v: vente({ anneesValidees: [2027] }) })).toEqual([])
    expect(proposer({ mouvements: [mouvement({ date: '2027-10-15' })], v: vente({ anneesValidees: ANNEES_ILLISIBLES }) })).toHaveLength(1)
  })
})

describe('debitsCitables — les débits qu’une contre-passation d’une facture source peut citer', () => {
  it('les débits libres du dossier, le plus proche du montant d’abord, puis la date et l’identifiant', () => {
    const debits = debitsCitables(D, { montant: 100 }, [
      mouvement({ id: 'loin', montant: -300, date: '2027-10-01' }),
      mouvement({ id: 'b', montant: -101, date: '2027-10-20' }),
      mouvement({ id: 'a', montant: -99, date: '2027-10-20' }),
      // Le même écart, plus tôt : avant eux.
      mouvement({ id: 'c', montant: -101, date: '2027-10-10' }),
      mouvement({ id: 'tot', montant: -100.5, date: '2027-10-02' }),
      mouvement({ id: 'juste', montant: -100, date: '2027-10-30' }),
      mouvement({ id: 'credit', montant: 100 }),
      mouvement({ id: 'zero', montant: 0 }),
      mouvement({ id: 'autre', dossier_id: 'd2', montant: -100 }),
      mouvement({ id: 'classe', montant: -100, statut: 'rapprochee', piece_id: 'p' }),
      mouvement({ id: 'perso', montant: -100, statut: 'ignoree', prelevement_personnel: true }),
    ])
    expect(debits.map((m) => m.id)).toEqual(['juste', 'tot', 'c', 'a', 'b', 'loin'])
    // Un encaissement contre-passé est positif ; son montant se lit en valeur absolue de même.
    expect(debitsCitables(D, { montant: -100 }, [mouvement({ id: 'x', montant: -100 })]).map((m) => m.id)).toEqual(['x'])
  })
})

describe('le geste qui rendrait un mouvement inclassable : dit avant le clic, jamais refusé', () => {
  const credit = mouvement({ id: 'mc', montant: 300 })
  const nonSource = encaissement({ id: 'ens', facture_id: 'f2', montant: 100, ligne_bancaire_id: 'mc' })
  // L'exemplaire unique et validé de F2027-0043, qui n'est pas source (le virement mixte, étape VF5h).
  const EXEMPLAIRE_F2 = { id: 'p2', dossier_id: D, facture_id: 'f2', statut: 'validee', type_piece: 'vente' } as const
  const EXF = `${NE_POURRA_PAS_SE_CLASSER} : « Désignez d'abord l'exemplaire de la facture F2027-0043 : ce mouvement porte aussi `
    + 'son encaissement, et cette facture, qui n\'est pas la source de sa vente, se compte par une seule pièce validée. » '
    + LA_BASE_ADMET_LE_GESTE

  it('un encaissement d’une facture source sur un crédit qui justifie déjà une facture non source : son exemplaire, ou le rang 7', () => {
    const c = contexte({ encaissements: [nonSource] })
    const s = saisie({ montant: 200, ligneBancaireId: 'mc' })
    // La base l'accepte : 300 € pour un crédit de 300 €.
    expect(refusEnregistrementVente(c, { ...s, repartition: [{ taux: 20, montant: 200 }] }, [credit], AUJOURD_HUI, true, vente())).toBeNull()
    // Le virement mixte (étape VF5h) : le classement compte la facture d'avant, et demande d'abord son exemplaire.
    expect(inclassableApresEnregistrement(c, s, [credit], vente(), [])).toBe(EXF)
    // Payé en partie seulement : la facture d'avant attend toujours son exemplaire.
    expect(inclassableApresEnregistrement(c, { ...s, montant: 50 }, [credit], vente(), [])).toBe(EXF)
    // Son exemplaire désigné : les deux font le crédit, rien à dire ; 50 €, il attend ses autres encaissements.
    expect(inclassableApresEnregistrement(c, s, [credit], vente(), [EXEMPLAIRE_F2])).toBeNull()
    expect(inclassableApresEnregistrement(c, { ...s, montant: 50 }, [credit], vente(), [EXEMPLAIRE_F2])).toBeNull()
    // 250 € dépasseraient le crédit au-delà des frais, la facture d'avant comptée.
    expect(inclassableApresEnregistrement(c, { ...s, montant: 250 }, [credit], vente(), [EXEMPLAIRE_F2]))
      .toContain('font 350,00 € pour un crédit de 300,00 €')
  })

  it('l’encaissement d’une facture qui n’est pas source, sur un crédit qu’une facture source réserve : son exemplaire, ou le rang 7', () => {
    const reserve = encaissement({ id: 'es', facture_id: 'f1', montant: 200, ligne_bancaire_id: 'mc' })
    const c = contexte({ facture: facture({ id: 'f2', numero: 'F2027-0043', source_de_la_vente: false }), encaissements: [reserve] })
    const s = saisie({ montant: 100, ligneBancaireId: 'mc' })
    expect(inclassableApresEnregistrement(c, s, [credit], vente(), [])).toBe(EXF)
    expect(inclassableApresEnregistrement(c, s, [credit], vente(), [EXEMPLAIRE_F2])).toBeNull()
    // Sur un crédit qu'aucune facture source ne réserve, sa pièce s'y rapproche comme hier : rien à dire.
    expect(inclassableApresEnregistrement({ ...c, encaissements: [] }, s, [credit], vente(), [])).toBeNull()
  })

  // La fenêtre sert aussi le client « Ventes » et « Banque » : il lit la même phrase, tutoyé, et c'est son cabinet qui
  // désigne l'exemplaire d'une facture.
  it('le client lit le rang 7 sous ses mots : son cabinet désigne l’exemplaire', () => {
    const client = pourLEspace('client', EXF)
    expect(client).toBe(`${NE_POURRA_PAS_SE_CLASSER} : « Ton cabinet doit d'abord désigner l'exemplaire de la facture F2027-0043 : `
      + 'ce mouvement porte aussi son encaissement, et cette facture, qui n\'est pas la source de sa vente, se compte par une '
      + `seule pièce validée. » ${LA_BASE_ADMET_LE_GESTE}`)
    expect(motsDuCabinet(client)).toEqual([])
    expect(pourLEspace('cabinet', EXF)).toBe(EXF)
  })

  it('un crédit payé en partie n’est pas inclassable : il attend ses autres encaissements ; payé en entier non plus', () => {
    expect(inclassableApresEnregistrement(contexte(), saisie({ montant: 200, ligneBancaireId: 'mc' }), [credit], vente(), [])).toBeNull()
    expect(inclassableApresEnregistrement(contexte(), saisie({ montant: 300, ligneBancaireId: 'mc' }), [credit], vente(), [])).toBeNull()
    // La banque crédite un peu moins (des frais) : classable.
    expect(inclassableApresEnregistrement(contexte(), saisie({ montant: 302, ligneBancaireId: 'mc' }), [credit], vente(), [])).toBeNull()
    // Une autre facture source sur le même crédit : elle compte, rien de plus à dire.
    const autre = encaissement({ id: 'e3', facture_id: 'f3', montant: 100, ligne_bancaire_id: 'mc' })
    expect(inclassableApresEnregistrement(contexte({ encaissements: [autre] }), saisie({ montant: 200, ligneBancaireId: 'mc' }), [credit], vente(), []))
      .toBeNull()
  })

  it('rien à dire : une facture qui n’est pas source, une saisie sans mouvement ou sans montant, un mouvement classé', () => {
    const c = contexte({ encaissements: [nonSource] })
    expect(inclassableApresEnregistrement({ ...c, facture: facture({ source_de_la_vente: false }) }, saisie({ montant: 200, ligneBancaireId: 'mc' }), [credit], vente(), []))
      .toBeNull()
    expect(inclassableApresEnregistrement(c, saisie({ montant: 200 }), [credit], vente(), [])).toBeNull()
    expect(inclassableApresEnregistrement(c, saisie({ montant: null, ligneBancaireId: 'mc' }), [credit], vente(), [])).toBeNull()
    expect(inclassableApresEnregistrement(c, saisie({ montant: 0.001, ligneBancaireId: 'mc' }), [credit], vente(), [])).toBeNull()
    expect(inclassableApresEnregistrement(c, saisie({ montant: -50, ligneBancaireId: 'mc' }), [credit], vente(), [])).toBeNull()
    expect(inclassableApresEnregistrement(c, saisie({ montant: 0, ligneBancaireId: 'mc' }), [credit], vente(), [])).toBeNull()

    expect(inclassableApresEnregistrement(c, saisie({ montant: 200, ligneBancaireId: 'mc' }), [{ ...credit, statut: 'rapprochee', piece_id: 'p' }], vente(), []))
      .toBeNull()
    expect(inclassableApresEnregistrement(c, saisie({ montant: 200, ligneBancaireId: 'inconnu' }), [credit], vente(), [])).toBeNull()
  })

  it('un mouvement daté d’un exercice validé : la frontière se dit au cabinet ; illisible, le client n’en dit rien', () => {
    const fige = { ...credit, date: '2026-12-30' }
    expect(inclassableApresEnregistrement(contexte(), saisie({ montant: 300, ligneBancaireId: 'mc' }), [fige], vente({ anneesValidees: [2026] }), []))
      .toBe(`${NE_POURRA_PAS_SE_CLASSER} : « L'exercice 2026 est validé : ce mouvement ne change plus. » ${LA_BASE_ADMET_LE_GESTE}`)
    expect(inclassableApresEnregistrement(contexte(), saisie({ montant: 300, ligneBancaireId: 'mc' }), [fige], vente({ anneesValidees: ANNEES_ILLISIBLES }), []))
      .toBeNull()
  })

  describe('la contre-passation qui cite un débit', () => {
    const e1 = encaissement({ montant: 36.5, ligne_bancaire_id: 'm1' })
    const debit = (montant: number) => mouvement({ id: 'md', montant, date: '2027-10-25' })
    const declare = [{ encaissement_id: 'e1', etat: 'depose' as const }]

    it('des contre-passations qui dépasseraient le débit de quelques frais : la base les admet, le classement non', () => {
      expect(refusContrePassationVente(D, 'e1', [e1], declare, '2027-10-25', 'Impayé', AUJOURD_HUI, 'md', [debit(-36)], true, vente())).toBeNull()
      expect(inclassableApresContrePassation(D, 'e1', [e1], 'md', [debit(-36)], vente(), [])).toBe(`${NE_POURRA_PAS_SE_CLASSER} : `
        + '« Les contre-passations que ce mouvement justifie font 36,50 € pour un débit de 36,00 € : elles le dépassent. » '
        + LA_BASE_ADMET_LE_GESTE)
    })

    it('le débit qu’elles font, ou un débit plus grand qui attend d’autres contre-passations : rien à dire', () => {
      expect(inclassableApresContrePassation(D, 'e1', [e1], 'md', [debit(-36.5)], vente(), [])).toBeNull()
      expect(inclassableApresContrePassation(D, 'e1', [e1], 'md', [debit(-37)], vente(), [])).toBeNull()
      expect(inclassableApresContrePassation(D, 'e1', [e1], 'md', [debit(-80)], vente(), [])).toBeNull()
    })

    it('sans débit, pour une facture qui n’est pas source, ou un encaissement d’un autre dossier : rien', () => {
      expect(inclassableApresContrePassation(D, 'e1', [e1], null, [debit(-36)], vente(), [])).toBeNull()
      expect(inclassableApresContrePassation(D, 'e1', [{ ...e1, facture_id: 'f2' }], 'md', [debit(-36)], vente(), [])).toBeNull()
      expect(inclassableApresContrePassation('d2', 'e1', [e1], 'md', [debit(-36)], vente(), [])).toBeNull()
    })

    it('d’autres contre-passations citent déjà ce débit : elles comptent', () => {
      const autre = encaissement({ id: 'c8', facture_id: 'f3', montant: -40, annule_id: 'e8', ligne_bancaire_id: 'md' })
      expect(inclassableApresContrePassation(D, 'e1', [e1, autre], 'md', [debit(-76.5)], vente(), [])).toBeNull()
      expect(inclassableApresContrePassation(D, 'e1', [e1, autre], 'md', [debit(-76)], vente(), [])).toContain('font 76,50 € pour un débit de 76,00 €')
    })
  })

  it('l’état d’après est complété par une facture source fictive, jamais par un identifiant de la base', () => {
    // Un mouvement qu'aucun encaissement ne cite après le geste : le complément fait tout le crédit, et il se classe.
    expect(inclassableApres(D, 'mc', [credit], [], vente(), [])).toBeNull()
    // Un crédit qui ne justifie que l'encaissement d'une facture non source : le complément ne le ferait jamais sans son
    // exemplaire ; avec lui, le complément d'une facture source le classerait (le virement mixte, étape VF5h).
    expect(inclassableApres(D, 'mc', [credit], [nonSource], vente(), [])).toBe(EXF)
    expect(inclassableApres(D, 'mc', [credit], [nonSource], vente(), [EXEMPLAIRE_F2])).toBeNull()

  })
})
