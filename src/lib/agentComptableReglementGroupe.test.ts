import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { paiementsDesPieces, type PaiementsDesPieces, type PartReglee } from './rattachement'
import { piecesPayeesEnTrop, reglementsGroupesIncoherents } from './reglementGroupe'
import type { LigneBancaire, Piece } from './types'

// L'ASSISTANT RECOPIE CE QUE LA CHECKLIST DIT DES VIREMENTS QUI RÈGLENT PLUSIEURS PIÈCES (30/09/2026,
// ligne 26 de la feuille de route).
//
// Un virement peut régler plusieurs pièces, chacune pour sa part (lib/reglementGroupe.ts). La Checklist en
// tire deux points : le virement dont une part ne justifie plus rien — sa pièce supprimée depuis — ou dont
// les parts ne font plus le mouvement, et la pièce payée plus que son montant, que la 2035 ne compte qu'une
// fois. `agent-comptable` est auto-portée : elle recopie ces deux fonctions entre les bornes
// `── DÉBUT/FIN RÈGLEMENT GROUPÉ`, et ce test les compare à `src/lib` — la forme de garde des blocs
// AFFECTATION, EMPRUNT et VENTILATION : extraire, transpiler, exécuter, comparer à une référence EXTÉRIEURE
// à la copie, et planter des dérives dans la vraie source pour prouver qu'il sait encore échouer.
//
// CE QU'UNE DÉRIVE COÛTERAIT : l'assistant répondrait « rien à signaler » sur un dossier où la Checklist
// compte un virement dont une part ne justifie plus rien — en français, à un comptable qui n'ira pas
// vérifier.

function sourceDeployee(): string {
  return readFileSync(new URL('../../supabase/functions/agent-comptable/index.ts', import.meta.url), 'utf8')
}

type Ligne = Pick<LigneBancaire, 'id' | 'montant' | 'statut' | 'reglement_groupe'>
interface Copie {
  reglementsGroupesIncoherents: (l: readonly Ligne[], r: readonly PartReglee[]) => { ligne: Ligne; raison: string; montant: number }[]
  piecesPayeesEnTrop: (p: readonly Pick<Piece, 'id' | 'montant_ttc'>[], paiements: PaiementsDesPieces) => { piece: { id: string }; paye: number; enTrop: number }[]
  paiementsDesPieces: typeof paiementsDesPieces
}

// Le bloc lit `seuilAlignement` et `paiementsDesPieces` du bloc copié de src/lib/rattachement.ts : on reprend
// donc, de la MÊME source, tout ce que garde `agentComptableAnalyse.test.ts` — de la première copie de
// src/lib/ecritures.ts à la fin d'`analyserEcritures` —, puis le bloc lui-même. Une dérive du seuil
// d'alignement doit mordre ici aussi.
function extraire(source: string): Copie {
  const debut = source.indexOf('// ---- Dupliqué depuis src/lib/ecritures.ts')
  expect(debut, 'le bloc copié de src/lib/ecritures.ts est introuvable — garde-fou à remettre à jour').toBeGreaterThan(-1)
  const ancreFin = source.indexOf('function analyserEcritures(', debut)
  expect(ancreFin, '`analyserEcritures` introuvable après le bloc copié').toBeGreaterThan(debut)
  const fin = source.indexOf('\n}\n', ancreFin)
  expect(fin, "fin d'`analyserEcritures` introuvable").toBeGreaterThan(ancreFin)
  const blocDebut = source.indexOf('// ── DÉBUT RÈGLEMENT GROUPÉ')
  const blocFin = source.indexOf('// ── FIN RÈGLEMENT GROUPÉ')
  expect(blocDebut, 'bornes du bloc RÈGLEMENT GROUPÉ introuvables — garde-fou à remettre à jour').toBeGreaterThan(-1)
  expect(blocFin).toBeGreaterThan(blocDebut)
  const bloc = `${source.slice(debut, fin + 2)}\n${source.slice(blocDebut, blocFin)}`
  const js = ts.transpileModule(bloc, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(`${js}\nreturn { reglementsGroupesIncoherents, piecesPayeesEnTrop, paiementsDesPieces }`)() as Copie
}

const deployee = extraire(sourceDeployee())

const ligne = (o: Partial<LigneBancaire>): LigneBancaire => ({
  id: 'g', dossier_id: 'd', date: '2025-04-01', libelle: 'VIR FOURNISSEUR', montant: -900, statut: 'rapprochee',
  piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
  emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: true, compte_bilan: null, declaration_tva_id: null,
  id_externe: null, source_fichier: null, libelle_brut: null, created_at: '2025-04-02T09:00:00Z', ...o,
})
const part = (ligneId: string, pieceId: string | null, montant: number): PartReglee => ({ ligne_bancaire_id: ligneId, piece_id: pieceId, montant })
const piece = (id: string, montant_ttc: number | null): Pick<Piece, 'id' | 'montant_ttc'> => ({ id, montant_ttc })

// Les deux côtés rendus sous une forme comparable : l'identifiant du mouvement ou de la pièce, pas l'objet.
const formeIncoherents = (r: { ligne: { id: string }; raison: string; montant: number }[]) =>
  r.map((x) => `${x.ligne.id}:${x.raison}:${x.montant.toFixed(2)}`)
const formeEnTrop = (r: { piece: { id: string }; paye: number; enTrop: number }[]) =>
  r.map((x) => `${x.piece.id}:${x.paye.toFixed(2)}:${x.enTrop.toFixed(2)}`)

// Chaque cas : le relevé lu, les parts lues.
const CAS_INCOHERENTS: [string, LigneBancaire[], PartReglee[]][] = [
  ['un règlement que ses parts justifient', [ligne({})], [part('g', 'fa', -1000), part('g', 'av', 100)]],
  // Le cas réel : la pièce supprimée laisse sa part, sans pièce, avec son montant.
  ['une part dont la pièce a été supprimée', [ligne({})], [part('g', null, -1000), part('g', 'av', 100)]],
  ['des parts qui ne font plus le mouvement', [ligne({})], [part('g', 'fa', -950), part('g', 'av', 100)]],
  ['un règlement groupé sans aucune part', [ligne({})], []],
  ['des parts sur un mouvement qui ne règle plus en groupe', [ligne({ reglement_groupe: false, compte_bilan: null, declaration_tva_id: null })], [part('g', 'fa', -900)]],
  ['des parts sur un mouvement remis à traiter', [ligne({ statut: 'non_rapprochee' })], [part('g', 'fa', -900)]],
  ['une part dont le mouvement n’a pas été lu', [], [part('g', 'fa', -900)]],
  // Des montants que les flottants représentent mal : la somme se juge en centimes.
  ['des parts au centime que les flottants représentent mal', [ligne({ montant: -0.21 })], [part('g', 'fa', -0.07), part('g', 'fb', -0.14)]],
  ['deux virements, l’un juste et l’autre non', [ligne({}), ligne({ id: 'h', montant: 300 })], [
    part('g', 'fa', -900), part('h', null, 300),
  ]],
]

// Chaque cas : les pièces fournies, le relevé, les parts.
const CAS_EN_TROP: [string, Pick<Piece, 'id' | 'montant_ttc'>[], LigneBancaire[], PartReglee[]][] = [
  ['une pièce payée par un rapprochement ET par la part d’un virement groupé', [piece('fa', 1000)],
    [ligne({ id: 's', piece_id: 'fa', reglement_groupe: false, compte_bilan: null, declaration_tva_id: null, montant: -1000 }), ligne({ montant: -1000 })], [part('g', 'fa', -1000)]],
  ['un frais sous l’écart d’alignement', [piece('fa', 1000)], [ligne({ id: 's', piece_id: 'fa', reglement_groupe: false, compte_bilan: null, declaration_tva_id: null, montant: -1005 })], []],
  ['un écart juste au-delà de l’écart d’alignement', [piece('fa', 1000)], [ligne({ id: 's', piece_id: 'fa', reglement_groupe: false, compte_bilan: null, declaration_tva_id: null, montant: -1005.01 })], []],
  ['un avoir remboursé deux fois', [piece('av', -100)],
    [ligne({ id: 's', piece_id: 'av', reglement_groupe: false, compte_bilan: null, declaration_tva_id: null, montant: 100 }), ligne({ id: 't', piece_id: 'av', reglement_groupe: false, compte_bilan: null, declaration_tva_id: null, montant: 100 })], []],
  ['une pièce sans montant lu', [piece('fa', null)], [ligne({ id: 's', piece_id: 'fa', reglement_groupe: false, compte_bilan: null, declaration_tva_id: null, montant: -1000 })], []],
  ['une pièce que rien ne paie', [piece('fa', 1000)], [], []],
  ['une pièce payée en deux fois, exactement', [piece('fa', 1000)],
    [ligne({ id: 's', piece_id: 'fa', reglement_groupe: false, compte_bilan: null, declaration_tva_id: null, montant: -400 }), ligne({ montant: -600 })], [part('g', 'fa', -600)]],
]

describe('agent-comptable / bloc RÈGLEMENT GROUPÉ (copie déployée)', () => {
  it('n’est pas la fonction de src/lib elle-même', () => {
    expect(deployee.reglementsGroupesIncoherents).not.toBe(reglementsGroupesIncoherents)
    expect(deployee.piecesPayeesEnTrop).not.toBe(piecesPayeesEnTrop)
  })

  it('dit les mêmes virements groupés que la Checklist, pour la même raison et le même montant', () => {
    for (const [cas, lignes, parts] of CAS_INCOHERENTS) {
      expect(formeIncoherents(deployee.reglementsGroupesIncoherents(lignes, parts)), cas)
        .toEqual(formeIncoherents(reglementsGroupesIncoherents(lignes, parts)))
    }
  })

  it('dit les mêmes pièces payées en trop, avec les mêmes montants', () => {
    for (const [cas, pieces, lignes, parts] of CAS_EN_TROP) {
      // Chaque côté tire les paiements de SA copie de `paiementsDesPieces`.
      expect(formeEnTrop(deployee.piecesPayeesEnTrop(pieces, deployee.paiementsDesPieces(lignes, parts))), cas)
        .toEqual(formeEnTrop(piecesPayeesEnTrop(pieces as Piece[], paiementsDesPieces(lignes, parts))))
    }
  })

  it('la batterie exerce bien ce qui décide', () => {
    // Sans ces résultats attendus, une batterie qui ne déclencherait rien laisserait les deux copies
    // « d'accord » sur des listes vides.
    const incoherents = CAS_INCOHERENTS.flatMap(([, lignes, parts]) => formeIncoherents(reglementsGroupesIncoherents(lignes, parts)))
    expect(incoherents).toEqual([
      'g:part_sans_piece:-1000.00',
      'g:somme_differente:-50.00',
      'g:somme_differente:-900.00',
      'g:parts_sans_reglement:-900.00',
      'g:parts_sans_reglement:-900.00',
      'h:part_sans_piece:300.00',
    ])
    const enTrop = CAS_EN_TROP.flatMap(([, pieces, lignes, parts]) => formeEnTrop(piecesPayeesEnTrop(pieces as Piece[], paiementsDesPieces(lignes, parts))))
    expect(enTrop).toEqual(['fa:2000.00:1000.00', 'fa:1005.01:5.01', 'av:200.00:100.00'])
  })
})

describe('agent-comptable / points_a_traiter lit les parts des virements groupés', () => {
  const source = sourceDeployee()
  const corps = source.slice(source.indexOf('if (nom === "points_a_traiter")'), source.indexOf('return { erreur: `Outil inconnu'))

  it('lit les parts et le relevé entier, sous le même refus de lecture partielle', () => {
    expect(corps).toMatch(/from\("reglements_groupes"\)\.select\("ligne_bancaire_id, piece_id, montant", \{ count: "exact" \}\)\.eq\("dossier_id", dossierId\)\.order\("id"\)/)
    expect(corps).toMatch(/from\("lignes_bancaires"\)\.select\("id, date, montant, statut, piece_id, reglement_groupe, [^"]*"[^)]*\)\.eq\("dossier_id", dossierId\)\.order\("id"\)/)
    expect(corps).toMatch(/rReleve, rParts, rReglements, rCotisations[^\]]*\]\s*\.filter\(\(r\) => !r\.complete\)/)
  })

  it('compte les virements par MOUVEMENT et les pièces payées en trop, comme la Checklist', () => {
    // Une part sans pièce et une somme qui ne tombe plus juste sont deux raisons pour UN virement : compter
    // les raisons dirait deux virements là où la Checklist en dit un.
    expect(corps).toContain('const paiements = paiementsDesPieces(rReleve.lignes, rReglements.lignes)')
    expect(corps).toContain('const reglementsFaux = new Set(reglementsGroupesIncoherents(rReleve.lignes, rReglements.lignes).map((r) => r.ligne.id))')
    expect(corps).toContain('const payeesEnTrop = piecesPayeesEnTrop(piecesTyped, paiements)')
    expect(corps).toMatch(/virements_groupes_dont_une_part_ne_justifie_plus_rien_ou_dont_les_parts_ne_font_plus_le_mouvement: reglementsFaux\.size/)
    expect(corps).toMatch(/pieces_payees_plus_que_leur_montant: payeesEnTrop\.length/)
  })

  it('dit au modèle qu’une pièce se paie aussi par la part d’un virement, et qu’elle porte une ligne de banque par paiement', () => {
    expect(source).toContain("- Un VIREMENT peut RÉGLER PLUSIEURS PIÈCES (un paiement qui solde plusieurs factures, un avoir déduit d'un paiement) : chaque pièce reçoit sa PART du mouvement, qui la paie à la date du mouvement. Une pièce payée en plusieurs fois porte au brouillon une ligne de banque par paiement, au montant de ce paiement : ce n'est pas une anomalie.")
  })
})

describe('le garde-fou du bloc RÈGLEMENT GROUPÉ sait encore échouer', () => {
  // Une ancre qui figurerait deux fois ferait planter la dérive au mauvais endroit : on l'exige unique.
  function planter(avant: string, apres: string, quoi: string): Copie {
    const source = sourceDeployee()
    expect(source.split(avant).length - 1, `${quoi} introuvable ou ambiguë — la dérive plantée ne mord plus`).toBe(1)
    return extraire(source.replace(avant, apres))
  }
  const incoherentsDerive = (copie: Copie, [, lignes, parts]: (typeof CAS_INCOHERENTS)[number]) =>
    formeIncoherents(copie.reglementsGroupesIncoherents(lignes, parts))
  const incoherentsIci = ([, lignes, parts]: (typeof CAS_INCOHERENTS)[number]) =>
    formeIncoherents(reglementsGroupesIncoherents(lignes, parts))
  const cas = (nom: string) => CAS_INCOHERENTS.find(([n]) => n === nom)!

  it('attrape une copie qui tait la part d’une pièce supprimée', () => {
    const derivee = planter('      if (sansPiece.length > 0) {\n', '      if (false) {\n', 'la garde des parts sans pièce')
    const c = cas('une part dont la pièce a été supprimée')
    expect(incoherentsDerive(derivee, c)).not.toEqual(incoherentsIci(c))
  })

  it('attrape une copie qui juge la somme des parts en flottants', () => {
    const derivee = planter(
      'const centimesGroupe = (euros: number) => Math.round(euros * 100)\n', 'const centimesGroupe = (euros: number) => euros * 100\n',
      'les centimes du bloc',
    )
    const c = cas('des parts au centime que les flottants représentent mal')
    expect(incoherentsDerive(derivee, c)).not.toEqual(incoherentsIci(c))
  })

  it('attrape une copie qui ignore les parts d’un mouvement qui ne règle plus en groupe', () => {
    // Le bloc VENTILATION porte la même forme de garde : l'ancre prend la ligne qui la suit.
    const derivee = planter(
      '    } else if (parts.length > 0) {\n      incoherents.push({ ligne, raison: "parts_sans_reglement"',
      '    } else if (false) {\n      incoherents.push({ ligne, raison: "parts_sans_reglement"',
      'la garde des parts sans règlement',
    )
    const c = cas('des parts sur un mouvement qui ne règle plus en groupe')
    expect(incoherentsDerive(derivee, c)).not.toEqual(incoherentsIci(c))
  })

  it('attrape une copie qui juge les parts d’un mouvement remis à traiter', () => {
    const derivee = planter(
      '    if (ligne.reglement_groupe && ligne.statut === "rapprochee") {\n', '    if (ligne.reglement_groupe) {\n', 'le statut du mouvement',
    )
    const c = cas('des parts sur un mouvement remis à traiter')
    expect(incoherentsDerive(derivee, c)).not.toEqual(incoherentsIci(c))
  })

  const enTropDerive = (copie: Copie, nom: string) => {
    const [, pieces, lignes, parts] = CAS_EN_TROP.find(([n]) => n === nom)!
    return {
      la: formeEnTrop(copie.piecesPayeesEnTrop(pieces, copie.paiementsDesPieces(lignes, parts))),
      ici: formeEnTrop(piecesPayeesEnTrop(pieces as Piece[], paiementsDesPieces(lignes, parts))),
    }
  }

  it('attrape une copie qui ignore l’écart d’alignement', () => {
    const derivee = planter(
      '    if (enTrop > centimesGroupe(seuilAlignement(piece.montant_ttc))) resultat.push(',
      '    if (enTrop > 0) resultat.push(',
      "l'écart d'alignement",
    )
    const { la, ici } = enTropDerive(derivee, 'un frais sous l’écart d’alignement')
    expect(la).not.toEqual(ici)
  })

  it('attrape une copie qui somme les paiements avec leur signe', () => {
    const derivee = planter(
      '    const paye = centimesGroupe((paiements.get(piece.id) ?? []).reduce((s, p) => s + Math.abs(p.montant), 0))\n',
      '    const paye = centimesGroupe((paiements.get(piece.id) ?? []).reduce((s, p) => s + p.montant, 0))\n',
      'la somme payée',
    )
    const { la, ici } = enTropDerive(derivee, 'une pièce payée par un rapprochement ET par la part d’un virement groupé')
    expect(la).not.toEqual(ici)
  })

  it('et il ne crie PAS au loup sur la copie réellement déployée', () => {
    // Garde symétrique : sans lui, « la dérive est attrapée » serait satisfait par un garde-fou dont la
    // comparaison échouerait sur tout.
    for (const c of CAS_INCOHERENTS) expect(incoherentsDerive(deployee, c), c[0]).toEqual(incoherentsIci(c))
    for (const [nom] of CAS_EN_TROP) {
      const { la, ici } = enTropDerive(deployee, nom)
      expect(la, nom).toEqual(ici)
    }
  })
})
