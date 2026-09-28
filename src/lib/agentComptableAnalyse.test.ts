import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { analyserEcritures, lignesChargeProduitPourPiece, piecesAComptabiliser } from './ecritures'
import { rattachementsTresorerie } from './rattachement'
import type { Categorie, EcritureBrouillon, LigneBancaire, Piece } from './types'

// `agent-comptable` EST AUTO-PORTÉE, ET C'ÉTAIT LA DERNIÈRE DUPLICATION SANS GARDE.
//
// Elle redéclarait six fonctions de `src/lib` (soldeCompte, tvaNettePourPeriode, analyserEcritures,
// categoriesSansCompte, categoriesSansPoste, piecesSansTva) plus les deux tarifs de `coutsApi`, et
// aucun des neuf tests-garde du dépôt ne la couvrait : ils gardent `extract-piece`, `receive-email`
// et `superpdp-emit`. Les deux premières sont parties le 28/09/2026 avec la comparaison des
// déclarations de TVA au brouillon, que l'onglet TVA remplace (lib/declarationTva.ts).
//
// ELLE AVAIT DÉRIVÉ, sur celle des six qui pouvait le plus coûter. `analyserEcritures` a gagné
// TROIS comparaisons dans `src/lib` — le compte, la ventilation de TVA, la date — et la copie
// déployée n'en portait toujours qu'une, le TOTAL. Or les trois ajoutées ont précisément été
// écrites parce que le total NE BOUGE PAS dans ces cas-là : recatégoriser une pièce, corriger sa
// TVA à TTC constant, ou lui rendre sa date laissent la somme du groupe rigoureusement inchangée.
//
// CE QUE ÇA COÛTAIT : l'assistant répondait « aucune écriture à régénérer » sur un dossier dont la
// Checklist en comptait, à la question « quelles sont les anomalies ? » — la seule que cet outil
// existe pour traiter. Deux livrables, deux réponses, aucun signal : l'incohérence que ce dépôt a
// déjà payée trois fois.
//
// Le garde est volontairement FRAGILE, comme ses huit aînés : renommer une fonction ou changer une
// signature le casse bruyamment, ce qui vaut mieux qu'une copie qui dérive en silence.
function sourceDeployee(): string {
  return readFileSync(new URL('../../supabase/functions/agent-comptable/index.ts', import.meta.url), 'utf8')
}

// Prend la SOURCE en paramètre plutôt que de la lire elle-même : c'est ce qui permet de lui donner
// une source où une dérive a été PLANTÉE, et donc de prouver que ce garde-fou sait encore échouer.
function extraire(source: string) {
  // DE LA PREMIÈRE COPIE DE src/lib/ecritures.ts À LA FIN D'`analyserEcritures` : les constantes
  // comptables, `piecesAComptabiliser`, le bloc copié de src/lib/rattachement.ts (qui décide de la
  // DATE qu'une écriture doit porter) et `analyserEcritures`. Tout vient de la MÊME source : une
  // dérive sur un numéro de compte, sur le seuil d'alignement ou sur la tolérance d'équilibre doit
  // mordre ici aussi, pas seulement une dérive d'algorithme.
  const debut = source.indexOf('// ---- Dupliqué depuis src/lib/ecritures.ts')
  expect(debut, 'le bloc copié de src/lib/ecritures.ts est introuvable — garde-fou à remettre à jour')
    .toBeGreaterThan(-1)
  const ancreFin = source.indexOf('function analyserEcritures(', debut)
  expect(ancreFin, '`analyserEcritures` introuvable après le bloc copié').toBeGreaterThan(debut)
  const fin = source.indexOf('\n}\n', ancreFin)
  expect(fin, "fin d'`analyserEcritures` introuvable").toBeGreaterThan(ancreFin)
  const bloc = source.slice(debut, fin + 2)
  for (const attendu of ['function piecesAComptabiliser(', 'function rattachementsTresorerie(', 'const COMPTE_BANQUE ='] as const) {
    expect(bloc, `« ${attendu} » absent du bloc gardé`).toContain(attendu)
  }

  // Le bloc est du TypeScript (interfaces, `Pick`, types de retour) : on le transpile avec le
  // compilateur du projet plutôt que d'en retirer les types à la main — une traduction écrite à la
  // main mentirait au premier cas tordu.
  const js = ts.transpileModule(bloc, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(`${js}\nreturn { piecesAComptabiliser, analyserEcritures, rattachementsTresorerie }`)() as {
    piecesAComptabiliser: (p: Piece[], c: Categorie[], i: ReadonlySet<string>) => { piece: Piece; compte: string }[]
    analyserEcritures: (
      e: EcritureBrouillon[], a: { piece: Piece; compte: string }[], assujettiTva: boolean, lignesBancaires: LigneBancaire[],
    ) => {
      nbSansContrepartie: number
      groupesDesequilibres: { pieceId: string; solde: number }[]
      piecesDesynchronisees: Piece[]
    }
    rattachementsTresorerie: typeof rattachementsTresorerie
  }
}

const deployee = extraire(sourceDeployee())

const COMPTE_ACHATS = '606100'
const COMPTE_TVA_DEDUCTIBLE = '445660'
const COMPTE_BANQUE = '512000'

const categories = [
  { id: 'cat-achats', compte_comptable: COMPTE_ACHATS, poste_2035: 'Achats' },
  { id: 'cat-autre', compte_comptable: '628000', poste_2035: 'Divers' },
  { id: 'cat-sans-compte', compte_comptable: null, poste_2035: 'Achats' },
] as Categorie[]

const piece = (o: Partial<Piece>): Piece =>
  ({
    id: 'p1', statut: 'validee', type_piece: 'achat', date_piece: '2025-03-10',
    montant_ht: 100, montant_tva: 20, montant_ttc: 120, categorie_id: 'cat-achats',
    created_at: '2025-03-10T09:00:00Z', nom_fichier: 'f.pdf', ...o,
  }) as Piece

const ecriture = (o: Partial<EcritureBrouillon>): EcritureBrouillon =>
  ({
    id: 'e1', piece_id: 'p1', date: '2025-03-10', compte: COMPTE_ACHATS,
    libelle: 'FOURNISSEUR', sens: 'debit', montant: 100, statut: 'proposee', ...o,
  }) as EcritureBrouillon

/** Le jeu d'écritures qu'une pièce conforme produit : charge + TVA + contrepartie banque. */
function groupeConforme(id: string, o: { compte?: string; tva?: number; date?: string } = {}) {
  const date = o.date ?? '2025-03-10'
  return [
    ecriture({ id: `${id}-a`, piece_id: id, compte: o.compte ?? COMPTE_ACHATS, montant: 100, date }),
    ecriture({ id: `${id}-t`, piece_id: id, compte: COMPTE_TVA_DEDUCTIBLE, montant: o.tva ?? 20, date }),
    ecriture({ id: `${id}-b`, piece_id: id, compte: COMPTE_BANQUE, sens: 'credit', montant: 120, date }),
  ]
}

/**
 * Les deux copies doivent rendre EXACTEMENT la même chose — on compare les ids, pas les objets.
 *
 * `copie` est paramétrable et vaut la copie déployée par défaut : les dix cas ci-dessous exercent
 * donc bien ce défaut, et la BORNE de fin de fichier lui passe une copie dérivée pour vérifier que
 * cette fonction sait encore échouer. Sans elle, neutraliser la comparaison ici laisserait les dix
 * cas verts — « le scanner est aveugle » et « zéro faute » redeviendraient indiscernables.
 */
function memeResultat(
  ecritures: EcritureBrouillon[], pieces: Piece[], immos: string[] = [], copie = deployee, assujettiTva = true,
  paiements: LigneBancaire[] = [],
) {
  const ici = piecesAComptabiliser(pieces, categories, new Set(immos))
  const la = copie.piecesAComptabiliser(pieces, categories, new Set(immos))
  const resume = (a: { piece: Piece; compte: string }[]) => a.map((x) => `${x.piece.id}:${x.compte}`)
  expect(resume(la), 'piecesAComptabiliser a dérivé').toEqual(resume(ici))

  const r1 = analyserEcritures(ecritures, ici, assujettiTva, paiements)
  const r2 = copie.analyserEcritures(ecritures, la, assujettiTva, paiements)
  const forme = (r: typeof r1) => ({
    nbSansContrepartie: r.nbSansContrepartie,
    groupesDesequilibres: r.groupesDesequilibres.map((g) => `${g.pieceId}:${g.solde.toFixed(2)}`),
    piecesDesynchronisees: r.piecesDesynchronisees.map((p) => p.id),
  })
  expect(forme(r2), 'analyserEcritures a dérivé').toEqual(forme(r1))
  return forme(r1)
}

describe('agent-comptable / analyserEcritures (copie déployée)', () => {
  it('se tait sur une pièce parfaitement synchronisée', () => {
    expect(memeResultat(groupeConforme('p1'), [piece({ id: 'p1' })])).toEqual({
      nbSansContrepartie: 0, groupesDesequilibres: [], piecesDesynchronisees: [],
    })
  })

  it('voit un TOTAL faux — la seule comparaison que la copie portait', () => {
    const ecritures = groupeConforme('p1')
    ecritures[0].montant = 150
    expect(memeResultat(ecritures, [piece({ id: 'p1' })]).piecesDesynchronisees).toEqual(['p1'])
  })

  it('voit un COMPTE changé, à total rigoureusement identique', () => {
    // Recatégoriser une pièce validée ne réécrit pas son écriture. La somme ne bouge pas d'un
    // centime : c'est exactement le cas que la copie déployée déclarait « synchronisée ».
    const r = memeResultat(groupeConforme('p1', { compte: '628000' }), [piece({ id: 'p1' })])
    expect(r.piecesDesynchronisees).toEqual(['p1'])
  })

  it('voit une VENTILATION DE TVA fausse, à TTC constant', () => {
    // 100 + 20 devient 106,09 + 13,91 : même total, mêmes comptes, et la charge comme la TVA
    // déductible partent fausses en FEC et en balance.
    const ecritures = groupeConforme('p1', { tva: 13.91 })
    ecritures[0].montant = 106.09
    expect(memeResultat(ecritures, [piece({ id: 'p1' })]).piecesDesynchronisees).toEqual(['p1'])
  })

  it('voit une DATE qui ne suit plus celle de la pièce', () => {
    // Le cas de « Retrouver les dates manquantes » : la pièce reçoit sa date, l'écriture garde
    // celle du dépôt — et part donc dans le mauvais exercice.
    const r = memeResultat(groupeConforme('p1', { date: '2026-09-16' }), [piece({ id: 'p1' })])
    expect(r.piecesDesynchronisees).toEqual(['p1'])
  })

  it('se tait quand la pièce n’a PAS de date', () => {
    // Sans date elle ne prétend à aucun exercice : il n'y a rien à contredire, et comparer au
    // repli ferait crier au loup sur toute écriture générée dans un autre fuseau.
    const r = memeResultat(groupeConforme('p1', { date: '2026-09-16' }), [piece({ id: 'p1', date_piece: null })])
    expect(r.piecesDesynchronisees).toEqual([])
  })

  it('se tait sur un AVOIR correctement enregistré au sens inverse', () => {
    const ecritures = [
      ecriture({ id: 'a', piece_id: 'p1', sens: 'credit', montant: 100 }),
      ecriture({ id: 't', piece_id: 'p1', compte: COMPTE_TVA_DEDUCTIBLE, sens: 'credit', montant: 20 }),
      ecriture({ id: 'b', piece_id: 'p1', compte: COMPTE_BANQUE, sens: 'debit', montant: 120 }),
    ]
    const avoir = piece({ id: 'p1', montant_ht: -100, montant_tva: -20, montant_ttc: -120 })
    expect(memeResultat(ecritures, [avoir]).piecesDesynchronisees).toEqual([])
  })

  it('se tait sur une pièce pas encore générée', () => {
    expect(memeResultat([], [piece({ id: 'p1' })]).piecesDesynchronisees).toEqual([])
  })

  it('compte les groupes sans contrepartie et les groupes déséquilibrés', () => {
    const ecritures = [
      // Sans contrepartie banque.
      ecriture({ id: 'a', piece_id: 'p1' }),
      // Avec contrepartie, mais le solde ne tombe pas à zéro.
      ...groupeConforme('p2'),
      ecriture({ id: 'x', piece_id: 'p2', compte: COMPTE_ACHATS, montant: 5 }),
      // Une écriture orpheline, qu'aucun groupe ne doit compter.
      ecriture({ id: 'o', piece_id: null }),
    ]
    const r = memeResultat(ecritures, [piece({ id: 'p1' }), piece({ id: 'p2' })])
    expect(r.nbSansContrepartie).toBe(1)
    expect(r.groupesDesequilibres).toEqual(['p2:5.00'])
  })

  // UN DOSSIER EXONÉRÉ NE VENTILE PAS LA TVA : sa charge est le TTC, sur une seule ligne (voir
  // src/lib/montantRetenu.ts). Les deux copies doivent le savoir, sinon l'assistant annoncerait « à
  // régénérer » une écriture juste — ou tairait celle qui porte encore une TVA qu'il ne récupère pas.
  it('se tait sur la charge TTC d’un dossier exonéré, sur une seule ligne', () => {
    const ecritures = [
      ecriture({ id: 'a', piece_id: 'p1', montant: 120 }),
      ecriture({ id: 'b', piece_id: 'p1', compte: COMPTE_BANQUE, sens: 'credit', montant: 120 }),
    ]
    expect(memeResultat(ecritures, [piece({ id: 'p1' })], [], deployee, false).piecesDesynchronisees).toEqual([])
  })

  it('voit une TVA encore ventilée sur un dossier exonéré', () => {
    expect(memeResultat(groupeConforme('p1'), [piece({ id: 'p1' })], [], deployee, false).piecesDesynchronisees)
      .toEqual(['p1'])
  })

  // LA DATE DU PAIEMENT (src/lib/rattachement.ts) : une écriture est datée à son paiement quand le
  // rapprochement le connaît. Sans le bloc copié, l'assistant signalerait « à régénérer » toute
  // écriture justement datée — et se tairait sur celle restée à la date de facture.
  const paiement = (o: Partial<LigneBancaire> = {}): LigneBancaire => ({
    id: 'l1', dossier_id: 'd1', date: '2025-04-02', libelle: 'PRLV', montant: -120, statut: 'rapprochee',
    piece_id: 'p1', cotisation_id: null, prelevement_personnel: false, source_fichier: null, libelle_brut: null,
    created_at: '2025-04-02T09:00:00Z', ...o,
  })

  it('voit une écriture restée à la date de facture alors que le paiement est connu', () => {
    const r = memeResultat(groupeConforme('p1'), [piece({ id: 'p1' })], [], deployee, true, [paiement()])
    expect(r.piecesDesynchronisees).toEqual(['p1'])
  })

  it('se tait sur une écriture datée à son paiement', () => {
    const r = memeResultat(groupeConforme('p1', { date: '2025-04-02' }), [piece({ id: 'p1' })], [], deployee, true, [paiement()])
    expect(r.piecesDesynchronisees).toEqual([])
  })

  it('accepte une pièce réglée en partie, répartie sur ses deux dates', () => {
    const partiel = [paiement({ montant: -48 })]
    const p = piece({ id: 'p1' })
    const reparties = lignesChargeProduitPourPiece('d1', p, COMPTE_ACHATS, true, partiel)
      .map((l, i) => ecriture({ ...l, id: `r${i}` }))
    expect(memeResultat(reparties, [p], [], deployee, true, partiel).piecesDesynchronisees).toEqual([])
    // Et la même écriture tout entière au paiement ne l'est pas.
    const toutAuPaiement = groupeConforme('p1', { date: '2025-04-02' })
    expect(memeResultat(toutAuPaiement, [p], [], deployee, true, partiel).piecesDesynchronisees).toEqual(['p1'])
  })

  it('ne se laisse pas dater par un mouvement qui n’est plus rapproché', () => {
    const r = memeResultat(groupeConforme('p1'), [piece({ id: 'p1' })], [], deployee, true, [paiement({ statut: 'non_rapprochee' })])
    expect(r.piecesDesynchronisees).toEqual([])
  })

  it('rattache une pièce comme src/lib, paiement partiel et note de frais compris', () => {
    // La copie de `rattachementsTresorerie` elle-même, sur les cas qui la distinguent d'une date de
    // facture : deux paiements, un reste, un écart sous le seuil d'alignement, une note de frais.
    const cas: [Piece, LigneBancaire[]][] = [
      [piece({ id: 'p1' }), []],
      [piece({ id: 'p1', type_piece: 'note_frais' }), []],
      [piece({ id: 'p1', date_piece: null }), []],
      [piece({ id: 'p1' }), [paiement()]],
      [piece({ id: 'p1' }), [paiement({ montant: -118 })]],
      [piece({ id: 'p1' }), [paiement({ montant: -48 })]],
      [piece({ id: 'p1', montant_ttc: 256.16 }), [paiement({ montant: -251.16 })]],
      [piece({ id: 'p1' }), [paiement({ id: 'a', date: '2025-05-01', montant: -60 }), paiement({ id: 'b', date: '2025-04-01', montant: -60 })]],
    ]
    for (const [p, paiements] of cas) {
      expect(deployee.rattachementsTresorerie(p, paiements)).toEqual(rattachementsTresorerie(p, paiements))
    }
  })

  it('écarte les mêmes pièces de la liste à comptabiliser', () => {
    // Les quatre portes : montant absent, immobilisée, catégorie sans compte, catégorie inconnue.
    memeResultat([], [
      piece({ id: 'ok' }),
      piece({ id: 'sans-montant', montant_ttc: null }),
      piece({ id: 'immo' }),
      piece({ id: 'sans-compte', categorie_id: 'cat-sans-compte' }),
      piece({ id: 'sans-categorie', categorie_id: null }),
    ], ['immo'])
  })
})

// LA BORNE : ce garde-fou sait-il encore échouer ?
//
// Sans elle, remplacer la copie déployée par la copie locale dans `memeResultat` laisse les dix cas
// ci-dessus parfaitement verts — le test comparerait `src/lib` à lui-même. C'est la panne que ce
// dépôt connaît sous plusieurs noms, et celle qui a laissé passer trois versions du scanner de
// lectures paginées : un contrôle qui ne voit plus rien ressemble exactement à un dépôt sain.
//
// On lui donne donc la VRAIE source déployée, amputée d'une seule des quatre comparaisons, et on
// exige qu'il s'en aperçoive. Défaut PLANTÉ, pas simulé : si la forme de la source change au point
// que l'amputation ne mord plus, l'extraction elle-même échouera d'abord.
// LE CÂBLAGE, que l'extraction ne voit pas : la copie est juste, encore faut-il que `points_a_traiter`
// lui passe le statut TVA DU DOSSIER. Un `true` écrit en dur ferait signaler « à régénérer » toute
// écriture juste d'un dossier exonéré — l'outil qui répond « quelles sont les anomalies ? ».
describe('agent-comptable / points_a_traiter passe le statut TVA du dossier', () => {
  it('appelle analyserEcritures avec dossier.assujetti_tva et les paiements rapprochés', () => {
    expect(sourceDeployee()).toMatch(/analyserEcritures\(ecrituresTyped, aComptabiliser, dossier\.assujetti_tva, rPaiements\.lignes\)/)
  })

  it('lit la date des pièces et les paiements RAPPROCHÉS, sous le même refus de lecture partielle', () => {
    // Sans `date_piece` dans la lecture, la date attendue d'une pièce non payée serait `undefined`,
    // et toute écriture passerait pour « à régénérer ».
    const source = sourceDeployee()
    expect(source).toMatch(/select\("id, date_piece, montant_ttc, montant_tva, categorie_id, type_piece"/)
    expect(source).toMatch(/from\("lignes_bancaires"\)\.select\("piece_id, date, montant, statut"[^)]*\)\.eq\("dossier_id", dossierId\)\.eq\("statut", "rapprochee"\)/)
    expect(source).toMatch(/\[rPieces, rPiecesAValider, rCategories, rEcritures, rImmobilisations, rPaiements\]\s*\.filter\(\(r\) => !r\.complete\)/)
  })
})

describe('le garde-fou sait encore échouer', () => {
  // La copie telle qu'elle était avant le correctif : elle attend la TVA de la pièce quel que soit le
  // statut du dossier. Le cas exonéré à une seule ligne doit la séparer de src/lib.
  function sansStatutTva(): string {
    const source = sourceDeployee()
    const avant = '    const tvaAttendue = assujettiTva ? p.montant_tva ?? 0 : 0\n'
    expect(source.includes(avant), 'la TVA attendue est introuvable — la dérive plantée ne mord plus').toBe(true)
    return source.replace(avant, '    const tvaAttendue = p.montant_tva ?? 0\n')
  }

  it('attrape une copie déployée qui ignore le statut TVA du dossier', () => {
    const derivee = extraire(sansStatutTva())
    const ecritures = [
      ecriture({ id: 'a', piece_id: 'p1', montant: 120 }),
      ecriture({ id: 'b', piece_id: 'p1', compte: COMPTE_BANQUE, sens: 'credit', montant: 120 }),
    ]
    expect(() => memeResultat(ecritures, [piece({ id: 'p1' })], [], derivee, false)).toThrow()
  })

  function sansComparaisonDeCompte(): string {
    const source = sourceDeployee()
    const debut = source.indexOf('    const surUnAutreCompte = lignes.some(')
    expect(debut, 'la comparaison de compte est introuvable — la dérive plantée ne mord plus')
      .toBeGreaterThan(-1)
    const fin = source.indexOf('    if (surUnAutreCompte) return true\n', debut)
    expect(fin, 'fin de la comparaison de compte introuvable').toBeGreaterThan(debut)
    return source.slice(0, debut) + source.slice(fin + '    if (surUnAutreCompte) return true\n'.length)
  }

  it('attrape une copie déployée à qui il manque la comparaison de compte', () => {
    const derivee = extraire(sansComparaisonDeCompte())
    // Le cas qui les sépare : un compte changé à total rigoureusement identique.
    expect(() => memeResultat(
      groupeConforme('p1', { compte: '628000' }), [piece({ id: 'p1' })], [], derivee,
    )).toThrow()
  })

  function sansFiltreImmobilisation(): string {
    const source = sourceDeployee()
    const avant = 'if (piece.montant_ttc == null || pieceIdsImmobilisees.has(piece.id)) return []'
    expect(source.includes(avant), 'le filtre des immobilisations est introuvable').toBe(true)
    return source.replace(avant, 'if (piece.montant_ttc == null) return []')
  }

  function sansPaiements(): string {
    const source = sourceDeployee()
    const avant = '    const attendues = datesAttendues(p, paiements.get(p.id) ?? [])\n'
    expect(source.includes(avant), 'la date attendue est introuvable — la dérive plantée ne mord plus').toBe(true)
    return source.replace(avant, '    const attendues = datesAttendues(p, [])\n')
  }

  it('attrape une copie déployée qui attend la date de facture malgré le paiement', () => {
    // Le code d'avant ce chantier : il attendait `date_piece` partout.
    const derivee = extraire(sansPaiements())
    const paye = [{
      id: 'l1', dossier_id: 'd1', date: '2025-04-02', libelle: 'PRLV', montant: -120, statut: 'rapprochee',
      piece_id: 'p1', cotisation_id: null, prelevement_personnel: false, source_fichier: null, libelle_brut: null,
      created_at: '2025-04-02T09:00:00Z',
    } satisfies LigneBancaire]
    expect(() => memeResultat(groupeConforme('p1', { date: '2025-04-02' }), [piece({ id: 'p1' })], [], derivee, true, paye)).toThrow()
  })

  function seuilSansArrondi(): string {
    const source = sourceDeployee()
    const avant = '  const reste = Math.round((montantPiece - paye) * 100) / 100\n'
    expect(source.includes(avant), "l'arrondi du reste est introuvable").toBe(true)
    return source.replace(avant, '  const reste = montantPiece - paye\n')
  }

  it('attrape une copie du rattachement qui ne juge pas l’écart au centime', () => {
    const derivee = extraire(seuilSansArrondi())
    const p = piece({ id: 'p1', montant_ttc: 256.16 })
    const paye: LigneBancaire[] = [{
      id: 'l1', dossier_id: 'd1', date: '2025-04-02', libelle: 'PRLV', montant: -251.16, statut: 'rapprochee',
      piece_id: 'p1', cotisation_id: null, prelevement_personnel: false, source_fichier: null, libelle_brut: null,
      created_at: '2025-04-02T09:00:00Z',
    }]
    expect(derivee.rattachementsTresorerie(p, paye)).not.toEqual(rattachementsTresorerie(p, paye))
  })

  it('attrape une dérive de `piecesAComptabiliser` elle-même', () => {
    // Sans cette seconde dérive plantée, retirer la comparaison des deux listes à comptabiliser
    // laisserait tout vert : `analyserEcritures` reçoit alors la liste de la copie déployée, et les
    // deux implémentations tombent d'accord sur ce qu'elles en font. La porte d'entrée doit être
    // gardée autant que le calcul.
    const derivee = extraire(sansFiltreImmobilisation())
    expect(() => memeResultat([], [piece({ id: 'immo' })], ['immo'], derivee)).toThrow()
  })

  it('a bien extrait la copie DÉPLOYÉE, et pas la copie locale', () => {
    // La borne la plus bête et la plus nécessaire : si `deployee` cessait d'être ce que la source
    // Deno contient, les douze cas compareraient `src/lib` à lui-même et resteraient verts.
    expect(deployee.analyserEcritures).not.toBe(analyserEcritures)
    expect(deployee.piecesAComptabiliser).not.toBe(piecesAComptabiliser)
  })

  it('et il ne crie PAS au loup sur la copie réellement déployée', () => {
    // Garde symétrique : sans lui, « la dérive est attrapée » serait satisfait par un garde-fou qui
    // échoue sur tout, y compris sur deux copies rigoureusement identiques.
    expect(() => memeResultat(
      groupeConforme('p1', { compte: '628000' }), [piece({ id: 'p1' })],
    )).not.toThrow()
  })
})
