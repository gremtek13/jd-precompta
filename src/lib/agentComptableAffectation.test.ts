import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import {
  mouvementsAffectes, mouvementsAffectesDesynchronises, natureDuCompte, recettesAffecteesSansTaux,
} from './affectationBanque'
import { categoriesSansCompte, categoriesSansPoste } from './controles'
import type { ModeleComptable } from './engagement'
import type { Categorie, EcritureBrouillon, LigneBancaire, Piece } from './types'
import { compteDuDirigeant, virementsPersonnelsAEcrire } from './virementPersonnel'
import { NON_VALIDEE } from '../test/ecritures'

// L'ASSISTANT RECOPIE CE QUE LA CHECKLIST DIT DES MOUVEMENTS AFFECTÉS (29/09/2026, ligne 26.6).
//
// Depuis qu'un mouvement du relevé s'affecte à une catégorie sans justificatif, trois contrôles de la
// Checklist en dépendent : les catégories qu'il utilise (sans compte ou sans poste, elles le sortent
// de la 2035), les mouvements dont l'écriture ne suit plus la catégorie, et les recettes affectées
// SANS TAUX de TVA d'un dossier assujetti — depuis le 01/10/2026, une recette d'un dossier assujetti
// porte son taux, et compte au hors taxe. `agent-comptable` est auto-portée : elle recopie ces fonctions
// entre les bornes `── DÉBUT/FIN AFFECTATION`, et ce test les compare à `src/lib` sur une batterie commune.
//
// CE QU'UNE DÉRIVE COÛTERAIT : l'assistant répondrait « aucune catégorie sans compte » ou « rien à
// réaffecter » sur un dossier où la Checklist en compte — la panne que `agentComptableAnalyse` a déjà
// payée sur `analyserEcritures`, et c'est la même forme de garde : extraire, transpiler, exécuter,
// comparer à une référence EXTÉRIEURE à la copie, et planter des dérives dans la vraie source pour
// prouver qu'il sait encore échouer.

function sourceDeployee(): string {
  return readFileSync(new URL('../../supabase/functions/agent-comptable/index.ts', import.meta.url), 'utf8')
}

interface Copie {
  natureDuCompte: typeof natureDuCompte
  mouvementsAffectes: (l: LigneBancaire[], c: Categorie[], assujetti: boolean) => {
    ligne: { id: string }; categorie: { id: string }; nature: string | null; taux: number | null; montantPoste: number
  }[]
  mouvementsAffectesDesynchronises: (e: EcritureBrouillon[], a: ReturnType<Copie['mouvementsAffectes']>) => { ligne: { id: string } }[]
  recettesAffecteesSansTaux: (a: ReturnType<Copie['mouvementsAffectes']>, assujetti: boolean) => { ligne: { id: string } }[]
  categoriesSansCompte: (c: Categorie[], p: Piece[], m: Pick<LigneBancaire, 'categorie_id'>[], immobilisees: ReadonlySet<string>) => Categorie[]
  categoriesSansPoste: (c: Categorie[], p: Piece[], m: Pick<LigneBancaire, 'categorie_id'>[], immobilisees: ReadonlySet<string>) => Categorie[]
  compteDuDirigeant: typeof compteDuDirigeant
  virementsPersonnelsAEcrire: (e: EcritureBrouillon[], l: LigneBancaire[], m: ModeleComptable) => { id: string }[]
}

// Prend la SOURCE en paramètre : c'est ce qui permet de lui donner une source où une dérive a été
// plantée. Le bloc lit `COMPTE_BANQUE` et `COMPTE_TVA_COLLECTEE`, déclarés plus haut dans la fonction :
// leur valeur est reprise de la MÊME source, pour qu'une dérive d'un numéro de compte morde ici aussi.
function extraire(source: string): Copie {
  const debut = source.indexOf('// ── DÉBUT AFFECTATION')
  const fin = source.indexOf('// ── FIN AFFECTATION')
  expect(debut, 'bornes du bloc AFFECTATION introuvables — garde-fou à remettre à jour').toBeGreaterThan(-1)
  expect(fin).toBeGreaterThan(debut)
  const banque = /const COMPTE_BANQUE = "(\d+)"/.exec(source)
  expect(banque, '`COMPTE_BANQUE` introuvable dans la source').not.toBeNull()
  // Le compte de l'exploitant vit avec les comptes de la copie de src/lib/ecritures.ts, qui l'emploie la première.
  const exploitant = /const COMPTE_EXPLOITANT = "(\d+)"/.exec(source)
  expect(exploitant, '`COMPTE_EXPLOITANT` introuvable dans la source').not.toBeNull()
  const tva = /const COMPTE_TVA_COLLECTEE = "(\d+)"/.exec(source)
  expect(tva, '`COMPTE_TVA_COLLECTEE` introuvable dans la source').not.toBeNull()
  const bloc = `const COMPTE_BANQUE = "${banque![1]}"\nconst COMPTE_EXPLOITANT = "${exploitant![1]}"\nconst COMPTE_TVA_COLLECTEE = "${tva![1]}"\n${source.slice(debut, fin)}`
  const js = ts.transpileModule(bloc, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(`${js}\nreturn { natureDuCompte, mouvementsAffectes, mouvementsAffectesDesynchronises, recettesAffecteesSansTaux, categoriesSansCompte, categoriesSansPoste, compteDuDirigeant, virementsPersonnelsAEcrire }`)() as Copie
}

const deployee = extraire(sourceDeployee())

const categorie = (o: Partial<Categorie>): Categorie => ({
  id: 'c', dossier_id: null, code: 'x', libelle: 'X', ordre: 0, compte_comptable: null, poste_2035: null, ...o,
})
const CATEGORIES: Categorie[] = [
  categorie({ id: 'recettes', libelle: 'Honoraires encaissés', compte_comptable: '706000', poste_2035: 'Recettes' }),
  categorie({ id: 'frais', libelle: 'Frais bancaires', compte_comptable: '627000', poste_2035: 'Frais financiers' }),
  categorie({ id: 'bilan', libelle: 'Apport', compte_comptable: '108000', poste_2035: null }),
  categorie({ id: 'sans-compte', libelle: 'À classer', compte_comptable: null, poste_2035: 'Divers' }),
  categorie({ id: 'sans-poste', libelle: 'Sans poste', compte_comptable: '628000', poste_2035: null }),
  categorie({ id: 'inutilisee', libelle: 'Inutilisée', compte_comptable: null, poste_2035: null }),
]

const ligne = (o: Partial<LigneBancaire>): LigneBancaire => ({
  id: 'l', dossier_id: 'd', date: '2025-03-10', libelle: 'VIR CPAM', montant: 100, statut: 'rapprochee',
  piece_id: null, cotisation_id: null, categorie_id: 'recettes', taux_tva: null, prelevement_personnel: false,
  emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false, id_externe: null,
  source_fichier: null, libelle_brut: null, created_at: '2025-03-10T09:00:00Z', ...o,
})
const LIGNES: LigneBancaire[] = [
  ligne({ id: 'encaissement' }),
  ligne({ id: 'frais', montant: -12.5, categorie_id: 'frais' }),
  ligne({ id: 'remboursement', montant: 30, categorie_id: 'frais' }),
  ligne({ id: 'reprise', montant: -40, categorie_id: 'recettes' }),
  ligne({ id: 'bilan', montant: -500, categorie_id: 'bilan' }),
  ligne({ id: 'sans-compte', montant: -8, categorie_id: 'sans-compte' }),
  ligne({ id: 'non-rapprochee', statut: 'non_rapprochee', categorie_id: 'recettes' }),
  ligne({ id: 'sans-categorie', categorie_id: null, piece_id: 'p1' }),
  ligne({ id: 'categorie-inconnue', categorie_id: 'absente' }),
]

const ecriture = (o: Partial<EcritureBrouillon>): EcritureBrouillon => ({
  id: 'e', dossier_id: 'd', piece_id: null, ligne_bancaire_id: 'encaissement', date: '2025-03-10',
  compte: '706000', libelle: 'VIR CPAM', sens: 'credit', montant: 100, statut: 'proposee', immobilisation_id: null, vehicule_id: null, ...NON_VALIDEE, created_at: '2025-03-10T09:00:00Z', ...o,
})
const conforme = (id: string, compte: string, montant: number, date = '2025-03-10'): EcritureBrouillon[] => {
  const entree = montant >= 0
  return [
    ecriture({ id: `${id}-c`, ligne_bancaire_id: id, compte, sens: entree ? 'credit' : 'debit', montant: Math.abs(montant), date }),
    ecriture({ id: `${id}-b`, ligne_bancaire_id: id, compte: '512000', sens: entree ? 'debit' : 'credit', montant: Math.abs(montant), date }),
  ]
}

const piece = (o: Partial<Piece>): Piece => ({ id: 'p1', categorie_id: 'recettes', ...o }) as Piece

const resumeAffectes = (a: { ligne: { id: string }; categorie: { id: string }; nature: string | null; taux: number | null; montantPoste: number }[]) =>
  a.map((m) => `${m.ligne.id}:${m.categorie.id}:${m.nature}:${m.taux}:${m.montantPoste}`)
const ids = (a: { ligne: { id: string } }[]) => a.map((m) => m.ligne.id)
const libelles = (c: Categorie[]) => c.map((x) => x.libelle)

/** Les deux copies doivent rendre EXACTEMENT la même chose sur les mêmes entrées. */
function memeResultat(ecritures: EcritureBrouillon[], lignes: LigneBancaire[], assujetti: boolean, copie: Copie = deployee) {
  const ici = mouvementsAffectes(lignes, CATEGORIES, assujetti)
  const la = copie.mouvementsAffectes(lignes, CATEGORIES, assujetti)
  expect(resumeAffectes(la), 'mouvementsAffectes a dérivé').toEqual(resumeAffectes(ici))
  expect(ids(copie.mouvementsAffectesDesynchronises(ecritures, la)), 'mouvementsAffectesDesynchronises a dérivé')
    .toEqual(ids(mouvementsAffectesDesynchronises(ecritures, ici, null)))
  expect(ids(copie.recettesAffecteesSansTaux(la, assujetti)), 'recettesAffecteesSansTaux a dérivé')
    .toEqual(ids(recettesAffecteesSansTaux(ici, assujetti, null)))
  return { affectes: resumeAffectes(ici), aReaffecter: ids(mouvementsAffectesDesynchronises(ecritures, ici, null)) }
}

// Une recette taxée, écrite comme l'affectation l'écrit : le hors taxe au 706, la TVA au 445710, le
// mouvement entier à la banque.
const taxee = (id: string, ht: number, tva: number): EcritureBrouillon[] => [
  ecriture({ id: `${id}-c`, ligne_bancaire_id: id, compte: '706000', sens: 'credit', montant: ht }),
  ecriture({ id: `${id}-t`, ligne_bancaire_id: id, compte: '445710', sens: 'credit', montant: tva }),
  ecriture({ id: `${id}-b`, ligne_bancaire_id: id, compte: '512000', sens: 'debit', montant: Math.round((ht + tva) * 100) / 100 }),
]

describe('agent-comptable / bloc AFFECTATION (copie déployée)', () => {
  it('n’est pas la fonction de src/lib elle-même', () => {
    // Sans ce contrôle, un garde qui comparerait src/lib à lui-même resterait vert quoi qu'il arrive
    // à la copie — l'aveuglement trouvé sur `agentComptableAnalyse`.
    expect(deployee.mouvementsAffectes).not.toBe(mouvementsAffectes)
    expect(deployee.categoriesSansCompte).not.toBe(categoriesSansCompte)
  })

  it('lit la nature au compte comme src/lib', () => {
    for (const compte of ['706000', '622600', '627000', '7', '70', '706', '6', '60', '512000', '445710', '108000', '7a1', '', null, undefined]) {
      expect(deployee.natureDuCompte(compte), `nature de ${String(compte)}`).toBe(natureDuCompte(compte))
    }
  })

  it('retient les mêmes mouvements affectés, avec la même nature et le même montant de poste', () => {
    const r = memeResultat([], LIGNES, false)
    // La batterie exerce bien les cas qui décident : un encaissement, un frais, un remboursement de
    // frais (négatif pour son poste), une reprise de recette, un compte de bilan (sans nature) — et
    // écarte le mouvement non rapproché, celui sans catégorie et celui dont la catégorie n'est pas lue.
    expect(r.affectes).toEqual([
      'encaissement:recettes:recette:null:100',
      'frais:frais:depense:null:12.5',
      'remboursement:frais:depense:null:-30',
      'reprise:recettes:recette:null:-40',
      'bilan:bilan:null:null:-500',
      'sans-compte:sans-compte:null:null:-8',
    ])
  })

  it('compte une recette taxée au hors taxe sur un dossier assujetti — entière ailleurs, son taux gardé ne s’appliquant plus', () => {
    const lignes = [
      ligne({ id: 'taxee', montant: 120, taux_tva: 20 }),
      ligne({ id: 'exoneree', montant: 50, taux_tva: 0 }),
      ligne({ id: 'sans-taux', montant: 80 }),
      ligne({ id: 'reprise-taxee', montant: -60, taux_tva: 20 }),
      ligne({ id: 'grosse', montant: 98765.43, taux_tva: 5.5 }),
      // Un demi-centime de TVA monte : 0,03 € à 20 % en porte 0,005 €, rendu 0,01 €.
      ligne({ id: 'demi', montant: 0.03, taux_tva: 20 }),
      // Une dépense ne porte pas de taux en base ; si elle en portait un, il ne s'appliquerait pas.
      ligne({ id: 'frais-taux', montant: -12, categorie_id: 'frais', taux_tva: 20 }),
    ]
    expect(memeResultat([], lignes, true).affectes).toEqual([
      'taxee:recettes:recette:20:100',
      'exoneree:recettes:recette:0:50',
      'sans-taux:recettes:recette:null:80',
      'reprise-taxee:recettes:recette:20:-50',
      'grosse:recettes:recette:5.5:93616.52',
      'demi:recettes:recette:20:0.02',
      'frais-taux:frais:depense:null:12',
    ])
    expect(memeResultat([], lignes, false).affectes).toEqual([
      'taxee:recettes:recette:null:120',
      'exoneree:recettes:recette:null:50',
      'sans-taux:recettes:recette:null:80',
      'reprise-taxee:recettes:recette:null:-60',
      'grosse:recettes:recette:null:98765.43',
      'demi:recettes:recette:null:0.03',
      'frais-taux:frais:depense:null:12',
    ])
  })

  it('attend l’écriture au hors taxe avec sa TVA, et la voit périmée quand le statut du dossier change', () => {
    const lignes = [ligne({ id: 'avec-tva', montant: 120, taux_tva: 20 }), ligne({ id: 'au-ttc', montant: 120, taux_tva: 20 })]
    const ecritures = [...taxee('avec-tva', 100, 20), ...conforme('au-ttc', '706000', 120)]
    // Assujetti, l'écriture au TTC est périmée ; qui ne l'est plus, celle qui porte encore la TVA.
    expect(memeResultat(ecritures, lignes, true).aReaffecter).toEqual(['au-ttc'])
    expect(memeResultat(ecritures, lignes, false).aReaffecter).toEqual(['avec-tva'])
  })

  it('se tait sur des écritures conformes', () => {
    const ecritures = [...conforme('encaissement', '706000', 100), ...conforme('frais', '627000', -12.5),
      ...conforme('remboursement', '627000', 30), ...conforme('reprise', '706000', -40)]
    const lignes = LIGNES.filter((l) => !['bilan', 'sans-compte'].includes(l.id))
    expect(memeResultat(ecritures, lignes, false).aReaffecter).toEqual([])
  })

  it('voit une écriture absente, sur un autre compte, dans un autre sens, à une autre date ou d’un autre montant', () => {
    const lignes = [ligne({ id: 'a' }), ligne({ id: 'b' }), ligne({ id: 'c' }), ligne({ id: 'd' }), ligne({ id: 'e' }), ligne({ id: 'f' })]
    const ecritures = [
      // a : aucune écriture
      ...conforme('b', '706100', 100),
      ...conforme('c', '706000', -100).map((e) => ({ ...e, ligne_bancaire_id: 'c' })),
      ...conforme('d', '706000', 100, '2025-03-11'),
      ...conforme('e', '706000', 100.03),
      // f : un centime d'écart, sous la tolérance — conforme
      ...conforme('f', '706000', 100.01),
    ]
    expect(memeResultat(ecritures, lignes, false).aReaffecter).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('voit une ligne de trop, ignore les écritures d’une pièce, et reprend toujours un compte devenu hors résultat', () => {
    const ecritures = [
      ...conforme('encaissement', '706000', 100),
      ecriture({ id: 'x', ligne_bancaire_id: 'encaissement', compte: '445710', sens: 'credit', montant: 0 }),
      ...conforme('frais', '627000', -12.5).map((e) => ({ ...e, piece_id: 'p9' })),
      ...conforme('bilan', '108000', -500),
    ]
    const lignes = LIGNES.filter((l) => ['encaissement', 'frais', 'bilan'].includes(l.id))
    expect(memeResultat(ecritures, lignes, false).aReaffecter).toEqual(['encaissement', 'frais', 'bilan'])
  })

  it('rend les recettes affectées SANS TAUX d’un dossier assujetti, et rien sinon', () => {
    const lignes = [...LIGNES, ligne({ id: 'taxee', montant: 120, taux_tva: 20 }), ligne({ id: 'exoneree', montant: 50, taux_tva: 0 })]
    memeResultat([], lignes, true)
    memeResultat([], lignes, false)
    // Celle qui porte un taux — exonération comprise — n'en est pas.
    expect(ids(recettesAffecteesSansTaux(mouvementsAffectes(lignes, CATEGORIES, true), true, null))).toEqual(['encaissement', 'reprise'])
    expect(ids(recettesAffecteesSansTaux(mouvementsAffectes(lignes, CATEGORIES, false), false, null))).toEqual([])
  })

  it('compte une catégorie utilisée par une pièce OU par un mouvement affecté', () => {
    const pieces = [piece({ id: 'p1', categorie_id: 'recettes' })]
    for (const mouvements of [LIGNES, [], [ligne({ id: 'z', categorie_id: 'sans-poste' })]]) {
      expect(libelles(deployee.categoriesSansCompte(CATEGORIES, pieces, mouvements, new Set())))
        .toEqual(libelles(categoriesSansCompte(CATEGORIES, pieces, mouvements, new Set())))
      expect(libelles(deployee.categoriesSansPoste(CATEGORIES, pieces, mouvements, new Set())))
        .toEqual(libelles(categoriesSansPoste(CATEGORIES, pieces, mouvements, new Set())))
    }
    // Et la batterie exerce bien les mouvements : sans eux, « À classer » et « Apport » se taisent.
    expect(libelles(categoriesSansCompte(CATEGORIES, pieces, LIGNES, new Set()))).toEqual(['À classer'])
    expect(libelles(categoriesSansPoste(CATEGORIES, pieces, LIGNES, new Set()))).toEqual(['Apport'])
    expect(libelles(categoriesSansPoste(CATEGORIES, pieces, [], new Set()))).toEqual([])
  })

  it('ne compte pas la facture d’un bien, qui s’écrit sur le compte de sa nature', () => {
    // La pièce d'un bien du registre : sa catégorie ne décide ni de son écriture ni de la 2035.
    const pieces = [piece({ id: 'immo', categorie_id: 'sans-compte' }), piece({ id: 'autre', categorie_id: 'bilan' })]
    for (const immobilisees of [new Set<string>(), new Set(['immo']), new Set(['immo', 'autre'])]) {
      expect(libelles(deployee.categoriesSansCompte(CATEGORIES, pieces, [], immobilisees)))
        .toEqual(libelles(categoriesSansCompte(CATEGORIES, pieces, [], immobilisees)))
      expect(libelles(deployee.categoriesSansPoste(CATEGORIES, pieces, [], immobilisees)))
        .toEqual(libelles(categoriesSansPoste(CATEGORIES, pieces, [], immobilisees)))
    }
    // Et la batterie exerce bien l'exclusion : sans elle, « À classer » et « Apport » seraient signalés.
    expect(libelles(categoriesSansCompte(CATEGORIES, pieces, [], new Set()))).toEqual(['À classer'])
    expect(libelles(categoriesSansCompte(CATEGORIES, pieces, [], new Set(['immo'])))).toEqual([])
    expect(libelles(categoriesSansPoste(CATEGORIES, pieces, [], new Set()))).toEqual(['Apport'])
    expect(libelles(categoriesSansPoste(CATEGORIES, pieces, [], new Set(['immo', 'autre'])))).toEqual([])
  })
})

// LES VIREMENTS PERSONNELS (src/lib/virementPersonnel.ts) : la Checklist compte ceux dont l'écriture
// manque — ceux classés avant que ce classement s'écrive —, et l'assistant doit dire la même chose.
const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '455000' }
const ENGAGEMENT: ModeleComptable = { mode: 'engagement', compteNotesDeFrais: '467000' }
const perso = (o: Partial<LigneBancaire>): LigneBancaire =>
  ligne({ statut: 'ignoree', categorie_id: null, prelevement_personnel: true, montant: -500, ...o })
const VIREMENTS: LigneBancaire[] = [
  perso({ id: 'sans-ecriture' }),
  perso({ id: 'ecrit-108' }),
  perso({ id: 'ecrit-467' }),
  perso({ id: 'apport', montant: 800 }),
  perso({ id: 'zero', montant: 0 }),
  perso({ id: 'rapproche', statut: 'rapprochee', piece_id: 'p1' }),
  perso({ id: 'affecte', statut: 'rapprochee', categorie_id: 'frais' }),
  ligne({ id: 'pas-perso', statut: 'ignoree', categorie_id: null, montant: -500 }),
]
const ECRITURES_VIREMENTS: EcritureBrouillon[] = [
  ...conforme('ecrit-108', '108000', -500),
  ...conforme('ecrit-467', '467000', -500),
  ...conforme('apport', '108000', 800),
]

describe('agent-comptable / bloc AFFECTATION — les virements personnels', () => {
  it('lit le compte du dirigeant dans le modèle comme src/lib', () => {
    for (const modele of [TRESORERIE, ENGAGEMENT, { ...ENGAGEMENT, compteNotesDeFrais: '455000' as const }, { ...ENGAGEMENT, compteNotesDeFrais: '108000' as const }]) {
      expect(deployee.compteDuDirigeant(modele)).toBe(compteDuDirigeant(modele))
    }
  })

  it('rend les mêmes virements à écrire, dans les deux modèles', () => {
    for (const modele of [TRESORERIE, ENGAGEMENT]) {
      expect(ids2(deployee.virementsPersonnelsAEcrire(ECRITURES_VIREMENTS, VIREMENTS, modele)), `modèle ${modele.mode}`)
        .toEqual(ids2(virementsPersonnelsAEcrire(ECRITURES_VIREMENTS, VIREMENTS, modele, null)))
    }
    // La batterie exerce bien ce qui décide : l'écriture absente, le compte qui suit le modèle, et les
    // mouvements qu'on ne peut pas écrire (zéro euro, rapproché, affecté, pas un virement personnel).
    expect(ids2(virementsPersonnelsAEcrire(ECRITURES_VIREMENTS, VIREMENTS, TRESORERIE, null))).toEqual(['sans-ecriture', 'ecrit-467'])
    expect(ids2(virementsPersonnelsAEcrire(ECRITURES_VIREMENTS, VIREMENTS, ENGAGEMENT, null))).toEqual(['sans-ecriture', 'ecrit-108', 'apport'])
  })
})

const ids2 = (a: { id: string }[]) => a.map((l) => l.id)

describe('agent-comptable / points_a_traiter lit les mouvements affectés', () => {
  const source = sourceDeployee()
  const corps = source.slice(source.indexOf('if (nom === "points_a_traiter")'), source.indexOf('return { erreur: `Outil inconnu'))

  it('lit les mouvements rapprochés portant une catégorie, avec leur taux, sous le même refus de lecture partielle', () => {
    expect(corps).toMatch(/from\("lignes_bancaires"\)\.select\("id, date, montant, statut, categorie_id, taux_tva"[^)]*\)\.eq\("dossier_id", dossierId\)\.eq\("statut", "rapprochee"\)\.not\("categorie_id", "is", null\)/)
    expect(corps).toMatch(/\[rPieces, rPiecesAValider, rCategories, rEcritures, rImmobilisations, rAffectes, rVirements, rEmprunts, rReleve, rParts, rReglements, rCotisations, rNatures, rANouveaux, rVehicules\]\s*\.filter\(\(r\) => !r\.complete\)/)
  })

  it('passe les mouvements aux catégories sans compte ou sans poste, et rend les deux points de la Checklist', () => {
    // Les parts d'un mouvement ventilé désignent des catégories comme les mouvements affectés (bloc
    // VENTILATION, gardé par agentComptableVentilation.test.ts).
    // Et la pièce de chaque bien du registre, que sa catégorie ne décide plus (bloc AMORTISSEMENT,
    // `acquisitionsDesBiens`) — l'ouverture d'un dossier repris dit lesquels la balance reprise porte déjà.
    expect(corps).toContain('categoriesSansCompte(categoriesTyped, piecesTyped, [...rAffectes.lignes, ...rParts.lignes], pieceIdsImmobilisees)')
    expect(corps).toContain('categoriesSansPoste(categoriesTyped, piecesTyped, [...rAffectes.lignes, ...rParts.lignes], pieceIdsImmobilisees)')
    expect(corps).toContain('const acquisitions = acquisitionsDesBiens(rImmobilisations.lignes, rNatures.lignes, ouverture)')
    expect(corps).toContain('const pieceIdsImmobilisees = new Set(acquisitions.keys())')
    expect(corps).toContain('piecesAComptabiliser(piecesTyped, categoriesTyped, acquisitions)')
    expect(corps).toContain('mouvementsAffectes(rAffectes.lignes, categoriesTyped, dossier.assujetti_tva)')
    expect(corps).toContain('mouvementsAffectesDesynchronises(ecrituresTyped, affectes)')
    expect(corps).toContain('recettesAffecteesSansTaux(affectes, dossier.assujetti_tva)')
    expect(corps).toMatch(/mouvements_affectes_a_reaffecter: affectesAReaffecter\.length/)
    expect(corps).toMatch(/encaissements_affectes_ou_ventiles_en_recette_sans_taux_de_tva_sur_dossier_assujetti: recettesAffecteesSansTva\.length \+ recettesVentileesSansTva\.length/)
  })

  it('dit au modèle qu’une recette d’un dossier assujetti porte son taux, et qu’elle compte au hors taxe', () => {
    expect(source).toMatch(/Sur un dossier assujetti à la TVA, une recette du relevé[^\n]*porte le taux de TVA[^\n]*la 2035 ne compte que le hors taxe[^\n]*Une recette sans taux sur un dossier assujetti est un point à traiter/)
  })

  it('dit au modèle qu’une écriture de mouvement affecté sans pièce n’est pas une anomalie', () => {
    expect(source).toMatch(/Un mouvement du relevé peut être AFFECTÉ à une catégorie sans justificatif[^\n]*n'a pas de pièce, ce n'est pas une anomalie/)
  })

  it('lit les virements personnels sous le même refus de lecture partielle, et rend le point de la Checklist', () => {
    expect(corps).toMatch(/from\("lignes_bancaires"\)\.select\("id, date, montant, prelevement_personnel, piece_id, cotisation_id, categorie_id"[^)]*\)\.eq\("dossier_id", dossierId\)\.eq\("prelevement_personnel", true\)/)
    expect(corps).toContain('virementsPersonnelsAEcrire(ecrituresTyped, rVirements.lignes, modele)')
    expect(corps).toMatch(/virements_personnels_sans_ecriture: virementsAEcrire\.length/)
  })

  it('dit au modèle qu’un virement personnel s’écrit sur le compte du dirigeant, sans pièce', () => {
    expect(source).toMatch(/Un VIREMENT PERSONNEL[^\n]*s'écrit sur le compte du dirigeant[^\n]*sans pièce : ce n'est pas une anomalie/)
  })
})

describe('le garde-fou sait encore échouer', () => {
  const planter = (avant: string, apres: string) => {
    const source = sourceDeployee()
    expect(source.split(avant).length - 1, `motif à planter introuvable ou ambigu : ${avant}`).toBe(1)
    return extraire(source.replace(avant, apres))
  }
  // Une dérive doit faire échouer une ASSERTION. Une `ReferenceError` ou un `TypeError` levés par le test
  // lui-même — un helper hors de portée, une copie qui plante — passeraient sinon pour une dérive attrapée :
  // c'est ainsi qu'une de ces dérives est d'abord passée, le 01/10/2026, pour une raison qui n'était pas la
  // sienne.
  const echoue = (f: () => void) => {
    let erreur: unknown = null
    try { f() } catch (e) { erreur = e }
    expect((erreur as Error | null)?.name, `la dérive n'a pas fait échouer une assertion : ${String(erreur)}`).toBe('AssertionError')
  }

  it('attrape une copie qui ne compte plus les mouvements dans les catégories', () => {
    const derivee = planter('\n    || mouvements.some((m) => m.categorie_id === c.id)', '')
    echoue(() => expect(libelles(derivee.categoriesSansCompte(CATEGORIES, [], LIGNES, new Set())))
      .toEqual(libelles(categoriesSansCompte(CATEGORIES, [], LIGNES, new Set()))))
  })

  it('attrape une copie qui compte la facture d’un bien dans les catégories', () => {
    const derivee = planter(' && !pieceIdsImmobilisees.has(p.id))', ')')
    const pieces = [piece({ id: 'immo', categorie_id: 'sans-compte' })]
    echoue(() => expect(libelles(derivee.categoriesSansCompte(CATEGORIES, pieces, [], new Set(['immo']))))
      .toEqual(libelles(categoriesSansCompte(CATEGORIES, pieces, [], new Set(['immo'])))))
  })

  it('attrape une copie qui ne compare plus la date', () => {
    const derivee = planter(' && e.date === date && Math.abs', ' && Math.abs')
    echoue(() => memeResultat(conforme('encaissement', '706000', 100, '2025-04-01'), [ligne({ id: 'encaissement' })], false, derivee))
  })

  it('attrape une copie dont la tolérance a changé', () => {
    const derivee = planter('const EPSILON_AFFECTATION = 0.02', 'const EPSILON_AFFECTATION = 0.05')
    echoue(() => memeResultat(conforme('encaissement', '706000', 100.03), [ligne({ id: 'encaissement' })], false, derivee))
  })

  it('attrape une copie qui lit la nature sur le premier chiffre seul', () => {
    const derivee = planter('if (/^7\\d{2}/.test(compte)) return "recette"', 'if (/^7/.test(compte)) return "recette"')
    echoue(() => expect(derivee.natureDuCompte('7')).toBe(natureDuCompte('7')))
  })

  it('attrape une copie qui signe le poste d’un remboursement à l’envers', () => {
    const derivee = planter('montantPoste: nature === "depense" ? -horsTaxe : horsTaxe', 'montantPoste: Math.abs(horsTaxe)')
    echoue(() => memeResultat([], LIGNES, false, derivee))
  })

  // LE TAUX DE TVA D'UNE RECETTE (01/10/2026) : chaque morceau de la copie qui le porte.
  const TAXEE = [ligne({ id: 'taxee', montant: 120, taux_tva: 20 })]

  it('attrape une copie qui n’écrit plus la ligne de TVA collectée', () => {
    const derivee = planter('    ...(tva > 0 ? [{ compte: COMPTE_TVA_COLLECTEE, sens: sensCompte, montant: tva }] : []),\n', '')
    echoue(() => memeResultat(taxee('taxee', 100, 20), TAXEE, true, derivee))
  })

  it('attrape une copie qui écrit la banque au hors taxe', () => {
    const derivee = planter('{ compte: COMPTE_BANQUE, sens: entree ? "debit" : "credit", montant: Math.abs(ligne.montant) }', '{ compte: COMPTE_BANQUE, sens: entree ? "debit" : "credit", montant: ht }')
    echoue(() => memeResultat(taxee('taxee', 100, 20), TAXEE, true, derivee))
  })

  it('attrape une copie qui applique le taux gardé sans regarder le statut du dossier', () => {
    const derivee = planter('return assujettiTva && nature === "recette" ? taux : null', 'return nature === "recette" ? taux : null')
    echoue(() => memeResultat([], TAXEE, false, derivee))
  })

  it('attrape une copie qui arrondit le demi-centime vers le bas', () => {
    const derivee = planter('const numerateur = 2 * centimes * t + 1000 + t', 'const numerateur = 2 * centimes * t + t')
    echoue(() => memeResultat([], [ligne({ id: 'demi', montant: 0.03, taux_tva: 20 })], true, derivee))
  })

  it('attrape une copie qui compte toute recette d’un dossier assujetti, même avec son taux', () => {
    const derivee = planter('affectes.filter((m) => m.nature === "recette" && m.taux === null)', 'affectes.filter((m) => m.nature === "recette")')
    echoue(() => memeResultat([], TAXEE, true, derivee))
  })

  it('attrape une copie dont la TVA ne va plus au 445710', () => {
    const source = sourceDeployee()
    const derivee = extraire(source.replace('const COMPTE_TVA_COLLECTEE = "445710"', 'const COMPTE_TVA_COLLECTEE = "445660"'))
    echoue(() => memeResultat(taxee('taxee', 100, 20), TAXEE, true, derivee))
  })

  it('attrape une copie qui écrit toujours sur le compte de l’exploitant', () => {
    const derivee = planter('return modele.mode === "engagement" ? modele.compteNotesDeFrais : COMPTE_EXPLOITANT', 'return COMPTE_EXPLOITANT')
    echoue(() => expect(ids2(derivee.virementsPersonnelsAEcrire(ECRITURES_VIREMENTS, VIREMENTS, ENGAGEMENT)))
      .toEqual(ids2(virementsPersonnelsAEcrire(ECRITURES_VIREMENTS, VIREMENTS, ENGAGEMENT, null))))
  })

  it('attrape une copie qui propose d’écrire un virement de zéro euro', () => {
    const derivee = planter(' && l.montant !== 0', '')
    echoue(() => expect(ids2(derivee.virementsPersonnelsAEcrire(ECRITURES_VIREMENTS, VIREMENTS, TRESORERIE)))
      .toEqual(ids2(virementsPersonnelsAEcrire(ECRITURES_VIREMENTS, VIREMENTS, TRESORERIE, null))))
  })

  it('attrape une copie qui prend tout mouvement pour un virement personnel', () => {
    const derivee = planter('    l.prelevement_personnel\n    && !l.piece_id', '    !l.piece_id')
    echoue(() => expect(ids2(derivee.virementsPersonnelsAEcrire(ECRITURES_VIREMENTS, VIREMENTS, TRESORERIE)))
      .toEqual(ids2(virementsPersonnelsAEcrire(ECRITURES_VIREMENTS, VIREMENTS, TRESORERIE, null))))
  })

  it('attrape une copie dont la contrepartie n’est plus la banque', () => {
    const source = sourceDeployee()
    const derivee = extraire(source.replace('const COMPTE_BANQUE = "512000"', 'const COMPTE_BANQUE = "512100"'))
    echoue(() => memeResultat(conforme('encaissement', '706000', 100), [ligne({ id: 'encaissement' })], false, derivee))
  })
})
