import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { calculerDeclaration2035 } from './declaration2035'
import { cotisationsComptees } from './cotisationRapprochee'
import { partsDuReleve } from './partsDuReleve'
import { paiementsDesPieces, type PartEncaissee } from './rattachement'
import { ETATS_DE_LA_LIGNE, LIBELLE_DE_L_ETAT_DE_LA_LIGNE, type CauseARevoir } from './revueAnalytique'
import {
  CAUSES_A_REVOIR_DE_LA_LIGNE, PASTILLE_DE_L_ETAT_DE_LA_LIGNE, centimesDeLaSaisie, declarationPourLaRevue,
  donneesDeLaRevueAnalytique, identifiantDeLaLigne, memeCleDeLigne, moisEnMots, parQui, pourcentageEnMots, titreDeLaLigne,
  variationEnMots, type LecturesDuDossierPourLaRevue,
} from './revueAnalytiqueEcran'
import type { ModeleComptable } from './engagement'
import type { Categorie, Piece } from './types'
import { ligne } from '../test/revision'
import { PLAN_PAR_DEFAUT } from './planComptable'
import { encaissementVendu, factureVendue, ligneVendue, ventesFactureesVides } from '../test/ventesFacturees'
import { ventesFacturees } from './ventesFacturees'
import { composition, sourcesDuDossierBascule } from '../test/dossierBascule'
import { CAISSE_ABSENTE } from './recettesDeCaisse'

// CE QUE L'ÉCRAN DE LA REVUE ANALYTIQUE DONNE AU MODULE ET CE QU'IL EN MONTRE (ligne 41, étape R5, phase C). Le calcul, les états
// et les refus sont éprouvés à part (revueAnalytique.test.ts, confrontés au texte des fonctions et rejoués sur l'essai) : ici,
// l'assemblage des données — la 2035 telle que Clôture la calcule — et les mots.

const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '108000', plan: PLAN_PAR_DEFAUT }
const ENGAGEMENT: ModeleComptable = { mode: 'engagement', compteNotesDeFrais: '467000', plan: PLAN_PAR_DEFAUT }

const categories = [
  { id: 'c-loyer', dossier_id: null, code: 'LOYER', libelle: 'Loyer', ordre: 1, compte_comptable: '613200', poste_2035: 'Loyers' },
  { id: 'c-banque', dossier_id: null, code: 'BANQUE', libelle: 'Frais de banque', ordre: 2, compte_comptable: '627000', poste_2035: 'Services bancaires' },
] satisfies Categorie[]

const piece = (o: Partial<Piece>): Piece =>
  ({
    id: 'p', statut: 'validee', type_piece: 'achat', date_piece: '2025-03-10', montant_ht: 100, montant_ttc: 120,
    categorie_id: 'c-loyer', ...o,
  }) as Piece

function dossier(o: Partial<LecturesDuDossierPourLaRevue> = {}): LecturesDuDossierPourLaRevue {
  return {
    piecesValidees: [], categories, immobilisations: [], cotisations: [], vehicules: [], lignes: [], ventilations: [],
    reglements: [], declarationsTva: [], ecritures: [], ...o,
  }
}

describe('declarationPourLaRevue — la 2035 de Clôture, et nulle part ailleurs', () => {
  it('rend ce que le moteur rend des mêmes entrées, le relevé rapproché seul', () => {
    const lignes = [
      ligne({ id: 'l1', date: '2025-05-02', montant: -40, categorie_id: 'c-banque', statut: 'rapprochee' }),
      // Un mouvement pas rapproché ne compte pas : le moteur n'en lit que les rapprochés.
      ligne({ id: 'l2', date: '2025-06-02', montant: -900, categorie_id: 'c-banque', statut: 'non_rapprochee' }),
    ]
    const pieces = [piece({ id: 'p1' })]
    const d = dossier({ piecesValidees: pieces, lignes })
    const rapprochees = lignes.filter((l) => l.statut === 'rapprochee')
    const attendu = calculerDeclaration2035(
      2025, pieces, categories, [], cotisationsComptees([], rapprochees, 'tresorerie'), [], false,
      paiementsDesPieces(rapprochees, [], [], []), partsDuReleve(rapprochees, categories, [], false), [], PLAN_PAR_DEFAUT, ventesFactureesVides('d1'),
      { etat: 'sans_bascule' }, CAISSE_ABSENTE,
    )
    const lue = declarationPourLaRevue(2025, TRESORERIE, false, d, ventesFactureesVides('d1'), { etat: 'sans_bascule' }, [], CAISSE_ABSENTE, [])
    expect(lue).toEqual(attendu)
    // 120 € de loyer (exonéré : TTC) et 40 € de frais de banque : les 900 € non rapprochés n'y sont pas.
    expect(lue?.totalDepenses).toBe(160)
  })

  it('compte le TTC pour un dossier exonéré et le hors taxes pour un assujetti (le paramètre est celui du dossier)', () => {
    const d = dossier({ piecesValidees: [piece({})] })
    expect(declarationPourLaRevue(2025, TRESORERIE, false, d, ventesFactureesVides('d1'), { etat: 'sans_bascule' }, [], CAISSE_ABSENTE, [])?.totalDepenses).toBe(120)
    expect(declarationPourLaRevue(2025, TRESORERIE, true, d, ventesFactureesVides('d1'), { etat: 'sans_bascule' }, [], CAISSE_ABSENTE, [])?.totalDepenses).toBe(100)
  })

  it('est nulle pour un dossier en engagement : la 2035 n’y est pas produite', () => {
    expect(declarationPourLaRevue(2025, ENGAGEMENT, false, dossier({ piecesValidees: [piece({})] }), ventesFactureesVides('d1'), { etat: 'sans_bascule' }, [], CAISSE_ABSENTE, [])).toBeNull()
  })

  it('se lit sur l’exercice demandé, et rien d’un autre', () => {
    const d = dossier({ piecesValidees: [piece({ id: 'a', date_piece: '2024-12-31' }), piece({ id: 'b' })] })
    expect(declarationPourLaRevue(2025, TRESORERIE, false, d, ventesFactureesVides('d1'), { etat: 'sans_bascule' }, [], CAISSE_ABSENTE, [])?.totalDepenses).toBe(120)
    expect(declarationPourLaRevue(2024, TRESORERIE, false, d, ventesFactureesVides('d1'), { etat: 'sans_bascule' }, [], CAISSE_ABSENTE, [])?.totalDepenses).toBe(120)
    expect(declarationPourLaRevue(2023, TRESORERIE, false, d, ventesFactureesVides('d1'), { etat: 'sans_bascule' }, [], CAISSE_ABSENTE, [])?.totalDepenses).toBe(0)
  })

  // LE VIREMENT MIXTE (étape VF5h) : l'exemplaire d'une facture d'avant la bascule, qu'un crédit classé par ses encaissements
  // paie, se date par lui — la revue compare la 2035 que Clôture montre. Sans ses parts, il compterait à sa date de facture.
  it('date par le virement mixte la pièce qu’il paie, comme Clôture', () => {
    const recettes = {
      id: 'c-recettes', dossier_id: null, code: 'RECETTES', libelle: 'Honoraires', ordre: 3, compte_comptable: '706000', poste_2035: 'Recettes',
    } satisfies Categorie
    const exemplaire = piece({ id: 'pv', type_piece: 'vente', date_piece: '2024-12-15', montant_ht: 60, montant_ttc: 60, categorie_id: 'c-recettes' })
    const virement = ligne({ id: 'mx', date: '2025-01-08', montant: 179.5, statut: 'rapprochee', encaissements_de_factures: true })
    const d = dossier({ piecesValidees: [exemplaire], categories: [...categories, recettes], lignes: [virement] })
    const recettesDe = (annee: number, encaissees: readonly PartEncaissee[]) =>
      declarationPourLaRevue(annee, TRESORERIE, false, d, ventesFactureesVides('d1'), { etat: 'sans_bascule' }, encaissees, CAISSE_ABSENTE, [])?.totalRecettes
    const parts = [{ ligne_bancaire_id: 'mx', piece_id: 'pv', montant: 60 }]
    expect([recettesDe(2025, parts), recettesDe(2024, parts)]).toEqual([60, 0])
    expect([recettesDe(2025, []), recettesDe(2024, [])]).toEqual([0, 60])
  })

  // LE JUMEAU DE CLÔTURE : ce fichier recopie quatre expressions de l'écran qui signe la 2035. Si l'une change là-bas, la
  // revue comparerait une autre 2035 que celle que le cabinet voit — ce test le dit.
  it('recopie les quatre appels de ClotureTab', () => {
    const source = readFileSync(new URL('../pages/dossier/ClotureTab.tsx', import.meta.url), 'utf8')
    for (const expression of [
      "toutesLesLignes.filter((l) => l.statut === 'rapprochee')",
      // Les parts des virements mixtes (étape VF5h) : de la lecture des ventes facturées, comme la revue les reçoit.
      // Et les paiements de pièces par la caisse (étape C9a), de la lecture de la caisse, comme la revue les reçoit.
      'paiementsDesPieces(lignesBancaires, reglements, encaissees, paiementsDeLaCaisse)',
      'const paiementsDeLaCaisse = paiementsParLaCaisseDuDossier(lectureCaisse, dossierId) ?? []',
      "const encaissees = lectureVentesDuDossier?.etat === 'lue' ? lectureVentesDuDossier.encaissees : []",
      'partsDuReleve(lignesBancaires, categories, ventilations, assujettiTva)',
      'cotisationsComptees(cotisations, lignesBancaires, modeComptable)',
      // Et la caisse (étape C3a) : ses recettes en espèces, comme la revue les reçoit.
      'calculerDeclaration2035(a, piecesValidees, categories, immobilisations, comptees, vehicules, assujettiTva, paiements, parts, declarationsTva, modele.plan, ventesFacturees, ecrituresDesVentes, recettesDeCaisse)',
    ]) expect(source, expression).toContain(expression)
  })
})

describe('donneesDeLaRevueAnalytique', () => {
  // LES PAIEMENTS PAR LA CAISSE (étape C9a) : la revue date la pièce comme Clôture ; sans eux — une caisse qui n'est pas
  // revenue entière —, aucune 2035, plutôt qu'une 2035 qui daterait à sa facture une pièce payée en espèces.
  it('date une pièce payée par la caisse comme Clôture, et n’a pas de 2035 sans ses paiements', () => {
    const sources = {
      dossier: dossier({ piecesValidees: [piece({ id: 'p1', date_piece: '2024-12-20' })] }), reprise: [], reportes: [], exercicesValides: [],
      reperes: { annuels: [], postes: [] }, seuils: [], explications: [], ventesFacturees: ventesFactureesVides('d1'), encaissees: [],
      ecrituresDesVentes: { etat: 'sans_bascule' } as const, recettesDeCaisse: CAISSE_ABSENTE,
    }
    const especes = [{ operation_caisse_id: 'oc-1', piece_id: 'p1', date: '2025-01-05', montant: -120 }]
    expect(donneesDeLaRevueAnalytique(2025, 2026, TRESORERIE, false, { ...sources, paiementsParLaCaisse: [] }).declaration?.totalDepenses).toBe(0)
    expect(donneesDeLaRevueAnalytique(2025, 2026, TRESORERIE, false, { ...sources, paiementsParLaCaisse: especes }).declaration?.totalDepenses).toBe(120)
    expect(donneesDeLaRevueAnalytique(2025, 2026, TRESORERIE, false, { ...sources, paiementsParLaCaisse: null }).declaration).toBeNull()
  })

  it('donne au module le dossier en entier, la 2035 du jour et les parts du relevé rapproché', () => {
    const lignes = [
      ligne({ id: 'l1', date: '2025-05-02', montant: -40, categorie_id: 'c-banque', statut: 'rapprochee' }),
      ligne({ id: 'l2', date: '2025-06-02', montant: -900, categorie_id: 'c-banque', statut: 'non_rapprochee' }),
    ]
    const d = donneesDeLaRevueAnalytique(2025, 2026, TRESORERIE, false, {
      dossier: dossier({ lignes, piecesValidees: [piece({})] }), reprise: [], reportes: [], exercicesValides: [],
      reperes: { annuels: [], postes: [] }, seuils: [], explications: [], ventesFacturees: ventesFactureesVides('d1'), encaissees: [],
      ecrituresDesVentes: { etat: 'sans_bascule' }, recettesDeCaisse: CAISSE_ABSENTE, paiementsParLaCaisse: [],
    })
    expect(d.annee).toBe(2025)
    expect(d.anneeCourante).toBe(2026)
    expect(d.declaration?.totalDepenses).toBe(160)
    expect(d.partsDuReleve.map((x) => x.ligne.id)).toEqual(['l1'])
  })

  // LES VENTES FACTURÉES (ligne 28.6, étape VF3b1) : la 2035 de la revue les compte comme celle de Clôture ; sans elles —
  // une lecture qui n'est pas revenue entière —, aucune 2035, plutôt qu'une 2035 sans ses ventes facturées.
  it('compte les ventes facturées comme le moteur, et n’a pas de 2035 sans elles', () => {
    const e = encaissementVendu({ id: 'e1', date_encaissement: '2025-06-10', montant: 1200 })
    const ventes = ventesFacturees({
      dossierId: 'd1', factures: [factureVendue({ date_emission: '2025-06-01' })], lignes: [ligneVendue('f1', 1000, 20)],
      encaissements: [e.encaissement], parts: [e.part],
    })
    const sources = {
      dossier: dossier({ piecesValidees: [piece({})] }), reprise: [], reportes: [], exercicesValides: [],
      reperes: { annuels: [], postes: [] }, seuils: [], explications: [], encaissees: [], ecrituresDesVentes: { etat: 'sans_bascule' } as const, recettesDeCaisse: CAISSE_ABSENTE, paiementsParLaCaisse: [],
    }
    const avec = donneesDeLaRevueAnalytique(2025, 2026, TRESORERIE, false, { ...sources, ventesFacturees: ventes })
    expect(avec.declaration?.totalRecettes).toBe(1000)
    expect(avec.declaration).toEqual(declarationPourLaRevue(2025, TRESORERIE, false, sources.dossier, ventes, { etat: 'sans_bascule' }, [], CAISSE_ABSENTE, []))
    expect(donneesDeLaRevueAnalytique(2025, 2026, TRESORERIE, false, { ...sources, ventesFacturees: null }).declaration).toBeNull()
  })

  // LES FRAIS D'UN MOUVEMENT D'ENCAISSEMENTS (ligne 28.65, VF4C3-Q1) : la 2035 de la revue les compte comme celle de Clôture,
  // sous le poste de la catégorie « Frais bancaires » ; sans les écritures des ventes facturées d'un dossier basculé — une
  // lecture qui n'est pas revenue entière —, aucune 2035.
  it('compte les frais d’un mouvement d’encaissements comme le moteur, et n’a pas de 2035 sans les écritures des ventes', () => {
    const sourcesBasculees = sourcesDuDossierBascule()
    const s = { ...sourcesBasculees, mouvements: sourcesBasculees.mouvements.map((m) => (m.id === 'm1' ? { ...m, montant: 118 } : m)) }
    const ventes = ventesFacturees({ dossierId: s.dossierId, factures: s.factures, lignes: s.lignes, encaissements: s.encaissements, parts: s.parts })
    const ecrituresDesVentes = { etat: 'composees' as const, composition: composition(s, 'tresorerie', PLAN_PAR_DEFAUT) }
    const fraisBancaires = { id: 'c-frais', dossier_id: null, code: 'frais_bancaires', libelle: 'Frais bancaires', ordre: 3, compte_comptable: '627000', poste_2035: 'Frais financiers' } satisfies Categorie
    const sources = {
      dossier: dossier({ categories: [...categories, fraisBancaires] }), reprise: [], reportes: [], exercicesValides: [],
      reperes: { annuels: [], postes: [] }, seuils: [], explications: [], ventesFacturees: ventes, encaissees: [], recettesDeCaisse: CAISSE_ABSENTE, paiementsParLaCaisse: [],
    }
    const avec = donneesDeLaRevueAnalytique(2025, 2026, TRESORERIE, false, { ...sources, ecrituresDesVentes })
    expect(avec.declaration?.depenses).toEqual([{ poste: 'Frais financiers', nature: 'depense', montant: 2, nbPieces: 0, nbMouvements: 1, nbEncaissements: 0 }])
    expect(avec.declaration).toEqual(declarationPourLaRevue(2025, TRESORERIE, false, sources.dossier, ventes, ecrituresDesVentes, [], CAISSE_ABSENTE, []))
    expect(donneesDeLaRevueAnalytique(2025, 2026, TRESORERIE, false, { ...sources, ecrituresDesVentes: null }).declaration).toBeNull()
  })

  it('n’a pas de 2035 en engagement', () => {
    const d = donneesDeLaRevueAnalytique(2025, 2026, ENGAGEMENT, false, {
      dossier: dossier(), reprise: [], reportes: [], exercicesValides: [], reperes: { annuels: [], postes: [] }, seuils: [], explications: [], ventesFacturees: ventesFactureesVides('d1'),
      encaissees: [], ecrituresDesVentes: { etat: 'sans_bascule' }, recettesDeCaisse: CAISSE_ABSENTE, paiementsParLaCaisse: [],
    })
    expect(d.declaration).toBeNull()
  })
})

describe('centimesDeLaSaisie', () => {
  it.each([
    ['600', 60_000], ['1 200,50', 120_050], ['1200.5', 120_050], ['1 200,50 €', 120_050], ['0,07', 7], ['12,3', 1230],
    ['0', 0], ['7.', Number.NaN],
  ])('%s', (texte, attendu) => {
    expect(centimesDeLaSaisie(texte)).toBe(attendu)
  })

  it.each(['', '   ', 'abc', '-5', '+5', '12,345', '1,2,3', '1.200,50', ',5', '1e3'])('refuse %j sans rien arrondir', (texte) => {
    expect(centimesDeLaSaisie(texte)).toBeNaN()
  })
})

describe('les mots', () => {
  it('pourcentageEnMots : des dixièmes de point, signés', () => {
    expect(pourcentageEnMots(125)).toBe('+12,5 %')
    expect(pourcentageEnMots(-30)).toBe('-3 %')
    expect(pourcentageEnMots(5)).toBe('+0,5 %')
    expect(pourcentageEnMots(-5)).toBe('-0,5 %')
    expect(pourcentageEnMots(0)).toBe('0 %')
    expect(pourcentageEnMots(1000)).toBe('+100 %')
  })

  it('variationEnMots : rien sans comparaison, le précédent nul dit, jamais « normale »', () => {
    expect(variationEnMots({ variationCentimes: null, variationDixiemesDePourcent: null })).toEqual({ euros: '—', pourcentage: '—' })
    expect(variationEnMots({ variationCentimes: 15_000, variationDixiemesDePourcent: 125 }).pourcentage).toBe('+12,5 %')
    expect(variationEnMots({ variationCentimes: 15_000, variationDixiemesDePourcent: 125 }).euros.replace(/\s/g, ' ')).toBe('+150,00 €')
    expect(variationEnMots({ variationCentimes: -15_000, variationDixiemesDePourcent: -125 }).euros.replace(/\s/g, ' ')).toBe('-150,00 €')
    expect(variationEnMots({ variationCentimes: 0, variationDixiemesDePourcent: 0 }).pourcentage).toBe('0 %')
    expect(variationEnMots({ variationCentimes: 500, variationDixiemesDePourcent: null }).pourcentage).toBe('précédent nul')
  })

  it('moisEnMots : le calendrier civil, sans fuseau', () => {
    expect(moisEnMots('2025-01')).toBe('janvier 2025')
    expect(moisEnMots('2025-12')).toBe('décembre 2025')
    expect(moisEnMots('2025-08')).toBe('août 2025')
    // Ce qui n'est pas un mois se rend tel quel plutôt que de s'inventer.
    expect(moisEnMots('2025-13')).toBe('2025-13')
    expect(moisEnMots('n’importe quoi')).toBe('n’importe quoi')
  })

  it('titreDeLaLigne : le poste avec sa nature, le total sous son libellé, le compte sous son nom', () => {
    expect(titreDeLaLigne({ objet_type: 'poste_2035', objet: 'Loyers', nature: 'depense' })).toBe('Loyers (dépense)')
    expect(titreDeLaLigne({ objet_type: 'poste_2035', objet: 'Honoraires', nature: 'recette' })).toBe('Honoraires (recette)')
    expect(titreDeLaLigne({ objet_type: 'total_2035', objet: 'recettes', nature: null })).toBe('Total des recettes')
    expect(titreDeLaLigne({ objet_type: 'total_2035', objet: 'resultat', nature: null })).toBe('Résultat')
    expect(titreDeLaLigne({ objet_type: 'compte', objet: '512000', nature: null })).toMatch(/^Compte 512000 — /)
    expect(titreDeLaLigne({ objet_type: 'compte', objet: '799999', nature: null })).toBe('Compte 799999')
  })

  it('parQui : « toi » à la casse près, sinon l’identifiant court', () => {
    expect(parQui('ABCDEF01-0000-4000-8000-000000000001', 'abcdef01-0000-4000-8000-000000000001')).toBe('par toi')
    expect(parQui('abcdef01-0000-4000-8000-000000000001', null)).toBe('par un autre compte du cabinet (abcdef01)')
    expect(parQui('abcdef01-0000-4000-8000-000000000001', 'autre')).toBe('par un autre compte du cabinet (abcdef01)')
  })

  it('une ligne se désigne par son type, son objet et sa nature', () => {
    const a = { objet_type: 'poste_2035', objet: 'Loyers', nature: 'depense' } as const
    expect(memeCleDeLigne(a, { ...a })).toBe(true)
    expect(memeCleDeLigne(a, { ...a, nature: 'recette' })).toBe(false)
    expect(memeCleDeLigne(a, { ...a, objet: 'Autre' })).toBe(false)
    expect(memeCleDeLigne(a, { ...a, objet_type: 'compte', nature: null })).toBe(false)
    expect(identifiantDeLaLigne(a)).not.toBe(identifiantDeLaLigne({ ...a, nature: 'recette' }))
  })

  it('chaque état de la ligne a sa pastille sous son libellé, et aucun ne dit « normal »', () => {
    for (const etat of ETATS_DE_LA_LIGNE) {
      expect(PASTILLE_DE_L_ETAT_DE_LA_LIGNE[etat].mot).toBe(LIBELLE_DE_L_ETAT_DE_LA_LIGNE[etat])
      expect(PASTILLE_DE_L_ETAT_DE_LA_LIGNE[etat].mot.toLowerCase()).not.toContain('normal')
    }
    // Ce qui attend le cabinet s'alerte ; l'attente ou l'absence ne s'alarme pas.
    expect(PASTILLE_DE_L_ETAT_DE_LA_LIGNE['a-expliquer'].classe).toBe('badge-warning')
    expect(PASTILLE_DE_L_ETAT_DE_LA_LIGNE['a-revoir'].classe).toBe('badge-warning')
    expect(PASTILLE_DE_L_ETAT_DE_LA_LIGNE.expliquee.classe).toBe('badge-ok')
    for (const etat of ['en-attente', 'sans-comparaison', 'sans-seuil', 'sous-le-seuil'] as const) {
      expect(PASTILLE_DE_L_ETAT_DE_LA_LIGNE[etat].classe).toBe('badge-neutral')
    }
  })

  it('chaque cause d’une ligne « à revoir » se dit', () => {
    const causes: CauseARevoir[] = ['montant-change', 'precedent-change', 'source-changee', 'chaine-illisible']
    expect(Object.keys(CAUSES_A_REVOIR_DE_LA_LIGNE).sort()).toEqual([...causes].sort())
    expect(new Set(causes.map((c) => CAUSES_A_REVOIR_DE_LA_LIGNE[c])).size).toBe(causes.length)
  })
})
