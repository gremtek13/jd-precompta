import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import {
  mouvementsAffectes, mouvementsAffectesDesynchronises, natureDuCompte, recettesAffecteesSurDossierAssujetti,
} from './affectationBanque'
import { categoriesSansCompte, categoriesSansPoste } from './controles'
import type { ModeleComptable } from './engagement'
import type { Categorie, EcritureBrouillon, LigneBancaire, Piece } from './types'
import { compteDuDirigeant, virementsPersonnelsAEcrire } from './virementPersonnel'

// L'ASSISTANT RECOPIE CE QUE LA CHECKLIST DIT DES MOUVEMENTS AFFECTÉS (29/09/2026, ligne 26.6).
//
// Depuis qu'un mouvement du relevé s'affecte à une catégorie sans justificatif, trois contrôles de la
// Checklist en dépendent : les catégories qu'il utilise (sans compte ou sans poste, elles le sortent
// de la 2035), les mouvements dont l'écriture ne suit plus la catégorie, et les recettes affectées
// d'un dossier devenu assujetti. `agent-comptable` est auto-portée : elle recopie ces fonctions entre
// les bornes `── DÉBUT/FIN AFFECTATION`, et ce test les compare à `src/lib` sur une batterie commune.
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
  mouvementsAffectes: (l: LigneBancaire[], c: Categorie[]) => { ligne: { id: string }; categorie: { id: string }; nature: string | null; montantPoste: number }[]
  mouvementsAffectesDesynchronises: (e: EcritureBrouillon[], a: ReturnType<Copie['mouvementsAffectes']>) => { ligne: { id: string } }[]
  recettesAffecteesSurDossierAssujetti: (a: ReturnType<Copie['mouvementsAffectes']>, assujetti: boolean) => { ligne: { id: string } }[]
  categoriesSansCompte: (c: Categorie[], p: Piece[], m: Pick<LigneBancaire, 'categorie_id'>[]) => Categorie[]
  categoriesSansPoste: (c: Categorie[], p: Piece[], m: Pick<LigneBancaire, 'categorie_id'>[]) => Categorie[]
  compteDuDirigeant: typeof compteDuDirigeant
  virementsPersonnelsAEcrire: (e: EcritureBrouillon[], l: LigneBancaire[], m: ModeleComptable) => { id: string }[]
}

// Prend la SOURCE en paramètre : c'est ce qui permet de lui donner une source où une dérive a été
// plantée. Le bloc lit `COMPTE_BANQUE`, déclaré plus haut dans la fonction : sa valeur est reprise de
// la MÊME source, pour qu'une dérive du numéro de compte morde ici aussi.
function extraire(source: string): Copie {
  const debut = source.indexOf('// ── DÉBUT AFFECTATION')
  const fin = source.indexOf('// ── FIN AFFECTATION')
  expect(debut, 'bornes du bloc AFFECTATION introuvables — garde-fou à remettre à jour').toBeGreaterThan(-1)
  expect(fin).toBeGreaterThan(debut)
  const banque = /const COMPTE_BANQUE = "(\d+)"/.exec(source)
  expect(banque, '`COMPTE_BANQUE` introuvable dans la source').not.toBeNull()
  const bloc = `const COMPTE_BANQUE = "${banque![1]}"\n${source.slice(debut, fin)}`
  const js = ts.transpileModule(bloc, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(`${js}\nreturn { natureDuCompte, mouvementsAffectes, mouvementsAffectesDesynchronises, recettesAffecteesSurDossierAssujetti, categoriesSansCompte, categoriesSansPoste, compteDuDirigeant, virementsPersonnelsAEcrire }`)() as Copie
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
  piece_id: null, cotisation_id: null, categorie_id: 'recettes', prelevement_personnel: false,
  emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false,
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
  compte: '706000', libelle: 'VIR CPAM', sens: 'credit', montant: 100, statut: 'proposee', created_at: '2025-03-10T09:00:00Z', ...o,
})
const conforme = (id: string, compte: string, montant: number, date = '2025-03-10'): EcritureBrouillon[] => {
  const entree = montant >= 0
  return [
    ecriture({ id: `${id}-c`, ligne_bancaire_id: id, compte, sens: entree ? 'credit' : 'debit', montant: Math.abs(montant), date }),
    ecriture({ id: `${id}-b`, ligne_bancaire_id: id, compte: '512000', sens: entree ? 'debit' : 'credit', montant: Math.abs(montant), date }),
  ]
}

const piece = (o: Partial<Piece>): Piece => ({ id: 'p1', categorie_id: 'recettes', ...o }) as Piece

const resumeAffectes = (a: { ligne: { id: string }; categorie: { id: string }; nature: string | null; montantPoste: number }[]) =>
  a.map((m) => `${m.ligne.id}:${m.categorie.id}:${m.nature}:${m.montantPoste}`)
const ids = (a: { ligne: { id: string } }[]) => a.map((m) => m.ligne.id)
const libelles = (c: Categorie[]) => c.map((x) => x.libelle)

/** Les deux copies doivent rendre EXACTEMENT la même chose sur les mêmes entrées. */
function memeResultat(ecritures: EcritureBrouillon[], lignes: LigneBancaire[], assujetti: boolean, copie: Copie = deployee) {
  const ici = mouvementsAffectes(lignes, CATEGORIES)
  const la = copie.mouvementsAffectes(lignes, CATEGORIES)
  expect(resumeAffectes(la), 'mouvementsAffectes a dérivé').toEqual(resumeAffectes(ici))
  expect(ids(copie.mouvementsAffectesDesynchronises(ecritures, la)), 'mouvementsAffectesDesynchronises a dérivé')
    .toEqual(ids(mouvementsAffectesDesynchronises(ecritures, ici)))
  expect(ids(copie.recettesAffecteesSurDossierAssujetti(la, assujetti)), 'recettesAffecteesSurDossierAssujetti a dérivé')
    .toEqual(ids(recettesAffecteesSurDossierAssujetti(ici, assujetti)))
  return { affectes: resumeAffectes(ici), aReaffecter: ids(mouvementsAffectesDesynchronises(ecritures, ici)) }
}

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
      'encaissement:recettes:recette:100',
      'frais:frais:depense:12.5',
      'remboursement:frais:depense:-30',
      'reprise:recettes:recette:-40',
      'bilan:bilan:null:-500',
      'sans-compte:sans-compte:null:-8',
    ])
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

  it('rend les recettes affectées d’un dossier assujetti, et rien sinon', () => {
    memeResultat([], LIGNES, true)
    memeResultat([], LIGNES, false)
    expect(ids(recettesAffecteesSurDossierAssujetti(mouvementsAffectes(LIGNES, CATEGORIES), true))).toEqual(['encaissement', 'reprise'])
  })

  it('compte une catégorie utilisée par une pièce OU par un mouvement affecté', () => {
    const pieces = [piece({ id: 'p1', categorie_id: 'recettes' })]
    for (const mouvements of [LIGNES, [], [ligne({ id: 'z', categorie_id: 'sans-poste' })]]) {
      expect(libelles(deployee.categoriesSansCompte(CATEGORIES, pieces, mouvements)))
        .toEqual(libelles(categoriesSansCompte(CATEGORIES, pieces, mouvements)))
      expect(libelles(deployee.categoriesSansPoste(CATEGORIES, pieces, mouvements)))
        .toEqual(libelles(categoriesSansPoste(CATEGORIES, pieces, mouvements)))
    }
    // Et la batterie exerce bien les mouvements : sans eux, « À classer » et « Apport » se taisent.
    expect(libelles(categoriesSansCompte(CATEGORIES, pieces, LIGNES))).toEqual(['À classer'])
    expect(libelles(categoriesSansPoste(CATEGORIES, pieces, LIGNES))).toEqual(['Apport'])
    expect(libelles(categoriesSansPoste(CATEGORIES, pieces, []))).toEqual([])
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
        .toEqual(ids2(virementsPersonnelsAEcrire(ECRITURES_VIREMENTS, VIREMENTS, modele)))
    }
    // La batterie exerce bien ce qui décide : l'écriture absente, le compte qui suit le modèle, et les
    // mouvements qu'on ne peut pas écrire (zéro euro, rapproché, affecté, pas un virement personnel).
    expect(ids2(virementsPersonnelsAEcrire(ECRITURES_VIREMENTS, VIREMENTS, TRESORERIE))).toEqual(['sans-ecriture', 'ecrit-467'])
    expect(ids2(virementsPersonnelsAEcrire(ECRITURES_VIREMENTS, VIREMENTS, ENGAGEMENT))).toEqual(['sans-ecriture', 'ecrit-108', 'apport'])
  })
})

const ids2 = (a: { id: string }[]) => a.map((l) => l.id)

describe('agent-comptable / points_a_traiter lit les mouvements affectés', () => {
  const source = sourceDeployee()
  const corps = source.slice(source.indexOf('if (nom === "points_a_traiter")'), source.indexOf('return { erreur: `Outil inconnu'))

  it('lit les mouvements rapprochés portant une catégorie, sous le même refus de lecture partielle', () => {
    expect(corps).toMatch(/from\("lignes_bancaires"\)\.select\("id, date, montant, statut, categorie_id"[^)]*\)\.eq\("dossier_id", dossierId\)\.eq\("statut", "rapprochee"\)\.not\("categorie_id", "is", null\)/)
    expect(corps).toMatch(/\[rPieces, rPiecesAValider, rCategories, rEcritures, rImmobilisations, rPaiements, rAffectes, rVirements, rEmprunts, rReleve\]\s*\.filter\(\(r\) => !r\.complete\)/)
  })

  it('passe les mouvements aux catégories sans compte ou sans poste, et rend les deux points de la Checklist', () => {
    expect(corps).toContain('categoriesSansCompte(categoriesTyped, piecesTyped, rAffectes.lignes)')
    expect(corps).toContain('categoriesSansPoste(categoriesTyped, piecesTyped, rAffectes.lignes)')
    expect(corps).toContain('mouvementsAffectesDesynchronises(ecrituresTyped, affectes)')
    expect(corps).toContain('recettesAffecteesSurDossierAssujetti(affectes, dossier.assujetti_tva)')
    expect(corps).toMatch(/mouvements_affectes_a_reaffecter: affectesAReaffecter\.length/)
    expect(corps).toMatch(/encaissements_affectes_en_recette_sur_dossier_assujetti: recettesAffecteesAssujetti\.length/)
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
  const echoue = (f: () => void) => expect(f).toThrow()

  it('attrape une copie qui ne compte plus les mouvements dans les catégories', () => {
    const derivee = planter(
      'return pieces.some((p) => p.categorie_id === c.id) || mouvements.some((m) => m.categorie_id === c.id)',
      'return pieces.some((p) => p.categorie_id === c.id)',
    )
    echoue(() => expect(libelles(derivee.categoriesSansCompte(CATEGORIES, [], LIGNES)))
      .toEqual(libelles(categoriesSansCompte(CATEGORIES, [], LIGNES))))
  })

  it('attrape une copie qui ne compare plus la date', () => {
    const derivee = planter(' && e.date === date', '')
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
    const derivee = planter('montantPoste: nature === "depense" ? -ligne.montant : ligne.montant', 'montantPoste: Math.abs(ligne.montant)')
    echoue(() => memeResultat([], LIGNES, false, derivee))
  })

  it('attrape une copie qui écrit toujours sur le compte de l’exploitant', () => {
    const derivee = planter('return modele.mode === "engagement" ? modele.compteNotesDeFrais : COMPTE_EXPLOITANT', 'return COMPTE_EXPLOITANT')
    echoue(() => expect(ids2(derivee.virementsPersonnelsAEcrire(ECRITURES_VIREMENTS, VIREMENTS, ENGAGEMENT)))
      .toEqual(ids2(virementsPersonnelsAEcrire(ECRITURES_VIREMENTS, VIREMENTS, ENGAGEMENT))))
  })

  it('attrape une copie qui propose d’écrire un virement de zéro euro', () => {
    const derivee = planter(' && l.montant !== 0', '')
    echoue(() => expect(ids2(derivee.virementsPersonnelsAEcrire(ECRITURES_VIREMENTS, VIREMENTS, TRESORERIE)))
      .toEqual(ids2(virementsPersonnelsAEcrire(ECRITURES_VIREMENTS, VIREMENTS, TRESORERIE))))
  })

  it('attrape une copie qui prend tout mouvement pour un virement personnel', () => {
    const derivee = planter('    l.prelevement_personnel\n    && !l.piece_id', '    !l.piece_id')
    echoue(() => expect(ids2(derivee.virementsPersonnelsAEcrire(ECRITURES_VIREMENTS, VIREMENTS, TRESORERIE)))
      .toEqual(ids2(virementsPersonnelsAEcrire(ECRITURES_VIREMENTS, VIREMENTS, TRESORERIE))))
  })

  it('attrape une copie dont la contrepartie n’est plus la banque', () => {
    const source = sourceDeployee()
    const derivee = extraire(source.replace('const COMPTE_BANQUE = "512000"', 'const COMPTE_BANQUE = "512100"'))
    echoue(() => memeResultat(conforme('encaissement', '706000', 100), [ligne({ id: 'encaissement' })], false, derivee))
  })
})
