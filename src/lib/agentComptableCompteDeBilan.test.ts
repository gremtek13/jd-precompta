import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { COMPTE_BANQUE, COMPTE_DEPOTS_ET_CAUTIONNEMENTS_VERSES, COMPTE_VIREMENTS_INTERNES } from './comptes'
import { ecritureDuCompteDeBilan, mouvementsSurUnCompteDeBilanDesynchronises } from './compteDeBilan'
import { montantsDesMouvementsIgnores, mouvementsIgnoresHorsFec } from './controles'
import { formatMoney } from './format'
import type { EcritureBrouillon, LigneBancaire } from './types'
import { NON_VALIDEE } from '../test/ecritures'

// L'ASSISTANT RECOPIE CE QUE LA CHECKLIST DIT DES MOUVEMENTS ÉCRITS SUR UN COMPTE DE BILAN ET DES MOUVEMENTS
// IGNORÉS (06/10/2026, ligne 26.7).
//
// Un virement vers le compte d'épargne du professionnel s'écrit au 580000, un dépôt de garantie au 275000, ou sur un
// compte de bilan choisi : la Checklist compte le mouvement dont l'écriture ne suit plus son compte, et les mouvements
// IGNORÉS, que rien n'écrit — absents du FEC —, avec ce qu'ils emportent dans chaque sens. `agent-comptable` est
// auto-portée : elle recopie ces fonctions entre les bornes `── DÉBUT/FIN COMPTE DE BILAN`, et ce test les compare à
// `src/lib` sur une batterie commune — la forme des gardes des autres blocs : extraire, transpiler, exécuter, comparer
// à une référence EXTÉRIEURE à la copie, et planter des dérives dans la vraie source pour prouver qu'il sait encore
// échouer.
//
// CE QU'UNE DÉRIVE COÛTERAIT : l'assistant répondrait « rien à signaler » sur un dossier dont des mouvements réels
// manquent au FEC, ou prendrait un virement personnel — classé « ignoré » lui aussi, mais écrit — pour un mouvement à
// classer, en français, à un comptable qui n'ira pas vérifier.

function sourceDeployee(): string {
  return readFileSync(new URL('../../supabase/functions/agent-comptable/index.ts', import.meta.url), 'utf8')
}

type Ecriture = { compte: string; sens: string; montant: number }
interface Copie {
  ecritureDuCompteDeBilan: (l: { montant: number }, compte: string) => Ecriture[]
  mouvementsSurUnCompteDeBilanDesynchronises: (e: EcritureBrouillon[], l: LigneBancaire[], frontiere: string | null) => { id: string }[]
  mouvementsIgnoresHorsFec: (l: LigneBancaire[], ouverture: string | null, frontiere: string | null) => { id: string }[]
  montantsDesMouvementsIgnores: (l: { montant: number }[]) => { encaisse: number; paye: number }
}

// Le bloc COMPTE DE BILAN lit `ecritureDuMouvement`, `ecrituresSansPieceParMouvement` et `ecritureConforme` du bloc
// AFFECTATION, `estFigee` du bloc VALIDATION, et les comptes déclarés plus haut dans la fonction : tous repris de la
// MÊME source, pour qu'une dérive de l'un d'eux morde ici aussi.
function extraire(source: string): Copie {
  const bornes = (nom: string) => {
    const debut = source.indexOf(`// ── DÉBUT ${nom}`)
    const fin = source.indexOf(`// ── FIN ${nom}`)
    expect(debut, `bornes du bloc ${nom} introuvables — garde-fou à remettre à jour`).toBeGreaterThan(-1)
    expect(fin).toBeGreaterThan(debut)
    return source.slice(debut, fin)
  }
  const compte = (nom: string) => {
    const trouve = new RegExp(`const ${nom} = "(\\d+)"`).exec(source)
    expect(trouve, `\`${nom}\` introuvable dans la source`).not.toBeNull()
    return `const ${nom} = "${trouve![1]}"\n`
  }
  const bloc = compte('COMPTE_BANQUE') + compte('COMPTE_EXPLOITANT') + compte('COMPTE_TVA_COLLECTEE')
    + `${bornes('VALIDATION')}\n${bornes('AFFECTATION')}\n${bornes('COMPTE DE BILAN')}`
  const js = ts.transpileModule(bloc, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(`${js}\nreturn { ecritureDuCompteDeBilan, mouvementsSurUnCompteDeBilanDesynchronises, mouvementsIgnoresHorsFec, montantsDesMouvementsIgnores }`)() as Copie
}

const deployee = extraire(sourceDeployee())

const FRONTIERES = [null, '2026-03-04', '2026-03-05', '2026-12-31'] as const

const ligne = (o: Partial<LigneBancaire>): LigneBancaire => ({
  id: 'l', dossier_id: 'd', date: '2026-03-05', libelle: 'VIR VERS LIVRET A', montant: -1000, statut: 'rapprochee',
  piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
  emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false,
  compte_bilan: COMPTE_VIREMENTS_INTERNES, declaration_tva_id: null, id_externe: null, source_fichier: null, libelle_brut: null, created_at: '2026-03-06T09:00:00Z', ...o,
})

const ecriture = (o: Partial<EcritureBrouillon>): EcritureBrouillon => ({
  id: 'e', dossier_id: 'd', piece_id: null, ligne_bancaire_id: 'l', date: '2026-03-05', compte: COMPTE_BANQUE,
  libelle: 'VIR VERS LIVRET A', sens: 'credit', montant: 1000, statut: 'proposee', immobilisation_id: null, vehicule_id: null, declaration_tva_id: null,
  ...NON_VALIDEE, created_at: '2026-03-06T09:00:00Z', ...o,
})

// L'écriture juste d'un mouvement sur son compte, telle que src/lib la compose.
const conforme = (l: LigneBancaire, compte = l.compte_bilan!, date = l.date): EcritureBrouillon[] =>
  ecritureDuCompteDeBilan(l, compte)
    .map((e, i) => ecriture({ id: `${l.id}-${i}`, ligne_bancaire_id: l.id, date, compte: e.compte, sens: e.sens, montant: e.montant }))

const sansLibelle = (e: Ecriture[]) => e.map(({ compte, sens, montant }) => ({ compte, sens, montant }))
const ids = (a: { id: string }[]) => a.map((l) => l.id)

// Des mouvements écrits sur un compte de bilan — l'écriture juste, absente, sur un autre compte, d'un autre montant,
// dans un autre sens, à une autre date, avec une ligne de trop — et ce qui n'en est pas : un mouvement rapproché sans
// compte de bilan, un compte de bilan sur un mouvement qui n'est plus rapproché, et les écritures d'une PIÈCE qui
// désignent le même mouvement.
const LIGNES: LigneBancaire[] = [
  ligne({ id: 'juste' }),
  ligne({ id: 'juste-depot', montant: 750, compte_bilan: COMPTE_DEPOTS_ET_CAUTIONNEMENTS_VERSES }),
  ligne({ id: 'absente', compte_bilan: COMPTE_DEPOTS_ET_CAUTIONNEMENTS_VERSES }),
  ligne({ id: 'autre-compte' }),
  ligne({ id: 'autre-montant' }),
  ligne({ id: 'autre-sens', montant: 1000 }),
  ligne({ id: 'autre-date' }),
  ligne({ id: 'ligne-de-trop' }),
  ligne({ id: 'apres', date: '2026-03-09', compte_bilan: '274100' }),
  ligne({ id: 'sans-compte', compte_bilan: null, declaration_tva_id: null, categorie_id: 'cat' }),
  ligne({ id: 'non-rapproche', statut: 'non_rapprochee' }),
  ligne({ id: 'piece', compte_bilan: '274100' }),
]
const ECRITURES: EcritureBrouillon[] = [
  ...conforme(LIGNES[0]),
  ...conforme(LIGNES[1]),
  ...conforme(LIGNES[3], COMPTE_DEPOTS_ET_CAUTIONNEMENTS_VERSES),
  ...conforme(LIGNES[4]).map((e) => ({ ...e, montant: 999 })),
  // Écrite comme un paiement alors que le mouvement est un encaissement.
  ...conforme(ligne({ id: 'autre-sens', montant: -1000 })),
  ...conforme(LIGNES[6], undefined, '2026-03-06'),
  ...conforme(LIGNES[7]),
  ecriture({ id: 'trop', ligne_bancaire_id: 'ligne-de-trop', compte: '471000', sens: 'debit', montant: 1 }),
  // Les écritures d'une PIÈCE qui désignent le même mouvement n'en sont pas : son écriture à lui manque.
  ecriture({ id: 'p1', piece_id: 'p1', ligne_bancaire_id: 'piece', compte: '606100', sens: 'debit', montant: 1000 }),
  ecriture({ id: 'p2', piece_id: 'p1', ligne_bancaire_id: 'piece', compte: COMPTE_BANQUE, sens: 'credit', montant: 1000 }),
]

// Des mouvements ignorés — un encaissement et des paiements réels, un virement personnel (ignoré lui aussi, mais
// écrit), un mouvement du jour même de l'ouverture et un d'avant — et ce qui ne l'est pas.
const IGNORES: LigneBancaire[] = [
  ligne({ id: 'encaissement', statut: 'ignoree', compte_bilan: null, declaration_tva_id: null, montant: 300 }),
  ligne({ id: 'paiement', statut: 'ignoree', compte_bilan: null, declaration_tva_id: null, montant: -120 }),
  ligne({ id: 'centimes', statut: 'ignoree', compte_bilan: null, declaration_tva_id: null, montant: -0.07, date: '2026-04-01' }),
  ligne({ id: 'centimes-bis', statut: 'ignoree', compte_bilan: null, declaration_tva_id: null, montant: -0.14, date: '2026-04-01' }),
  ligne({ id: 'personnel', statut: 'ignoree', compte_bilan: null, declaration_tva_id: null, prelevement_personnel: true, montant: -500 }),
  ligne({ id: 'jour-ouverture', statut: 'ignoree', compte_bilan: null, declaration_tva_id: null, montant: -40, date: '2026-01-01' }),
  ligne({ id: 'avant-ouverture', statut: 'ignoree', compte_bilan: null, declaration_tva_id: null, montant: -60, date: '2025-12-31' }),
  ligne({ id: 'a-traiter', statut: 'non_rapprochee', compte_bilan: null, declaration_tva_id: null }),
  ligne({ id: 'ecrit', statut: 'rapprochee' }),
]
const OUVERTURES = [null, '2026-01-01', '2026-03-06'] as const

describe('agent-comptable / bloc COMPTE DE BILAN (copie déployée)', () => {
  it('n’est pas la fonction de src/lib elle-même', () => {
    expect(deployee.mouvementsSurUnCompteDeBilanDesynchronises).not.toBe(mouvementsSurUnCompteDeBilanDesynchronises)
    expect(deployee.mouvementsIgnoresHorsFec).not.toBe(mouvementsIgnoresHorsFec)
  })

  it('compose la même écriture, ligne à ligne, dans les deux sens et sur chaque compte', () => {
    for (const montant of [-1000, 750, -0.07, 1234.56, -0.3]) {
      for (const compte of [COMPTE_VIREMENTS_INTERNES, COMPTE_DEPOTS_ET_CAUTIONNEMENTS_VERSES, '274100', '455000']) {
        expect(deployee.ecritureDuCompteDeBilan({ montant }, compte), `${montant} / ${compte}`)
          .toEqual(sansLibelle(ecritureDuCompteDeBilan(ligne({ montant }), compte)))
      }
    }
    // Le compte choisi face à la banque, dans le sens du mouvement, et rien d'autre — pas de TVA.
    expect(sansLibelle(ecritureDuCompteDeBilan(ligne({ montant: -1000 }), COMPTE_VIREMENTS_INTERNES))).toEqual([
      { compte: COMPTE_VIREMENTS_INTERNES, sens: 'debit', montant: 1000 },
      { compte: COMPTE_BANQUE, sens: 'credit', montant: 1000 },
    ])
  })

  it('rend les mêmes mouvements dont l’écriture ne suit plus le compte, sous chaque frontière', () => {
    for (const f of FRONTIERES) {
      expect(ids(deployee.mouvementsSurUnCompteDeBilanDesynchronises(ECRITURES, LIGNES, f)), `frontière ${f}`)
        .toEqual(ids(mouvementsSurUnCompteDeBilanDesynchronises(ECRITURES, LIGNES, f)))
    }
    // La batterie exerce bien ce qui décide : l'écriture absente, un autre compte, un autre montant, un autre sens, une
    // autre date, une ligne de trop, celle d'une pièce qui ne compte pas — et ce qui n'est pas un mouvement écrit sur
    // un compte de bilan. Et la frontière : le jour même du mouvement le fige, le 9 mars reste ouvert sous une
    // frontière au 5.
    expect(ids(mouvementsSurUnCompteDeBilanDesynchronises(ECRITURES, LIGNES, null)))
      .toEqual(['absente', 'autre-compte', 'autre-montant', 'autre-sens', 'autre-date', 'ligne-de-trop', 'apres', 'piece'])
    expect(ids(mouvementsSurUnCompteDeBilanDesynchronises(ECRITURES, LIGNES, '2026-03-05'))).toEqual(['apres'])
  })

  it('rend les mêmes mouvements ignorés, sous chaque ouverture et chaque frontière', () => {
    for (const ouverture of OUVERTURES) {
      for (const f of FRONTIERES) {
        expect(ids(deployee.mouvementsIgnoresHorsFec(IGNORES, ouverture, f)), `ouverture ${ouverture}, frontière ${f}`)
          .toEqual(ids(mouvementsIgnoresHorsFec(IGNORES, ouverture, f)))
      }
    }
    // La batterie exerce bien ce qui décide : le virement personnel n'y est jamais, l'ouverture écarte ce qui la
    // précède et garde son propre jour, la frontière fige ce qu'elle couvre.
    expect(ids(mouvementsIgnoresHorsFec(IGNORES, null, null)))
      .toEqual(['encaissement', 'paiement', 'centimes', 'centimes-bis', 'jour-ouverture', 'avant-ouverture'])
    expect(ids(mouvementsIgnoresHorsFec(IGNORES, '2026-01-01', null)))
      .toEqual(['encaissement', 'paiement', 'centimes', 'centimes-bis', 'jour-ouverture'])
    expect(ids(mouvementsIgnoresHorsFec(IGNORES, null, '2026-03-05'))).toEqual(['centimes', 'centimes-bis'])
  })

  it('rend ce qu’ils emportent, chaque sens à part et au centime — le détail de la Checklist, en nombres', () => {
    // La phrase de la Checklist, refaite avec les nombres de la copie : la même, ou aucune.
    const phrase = ({ encaisse, paye }: { encaisse: number; paye: number }) => {
      const parties = [
        encaisse > 0 ? `${formatMoney(encaisse)} encaissés` : null,
        paye > 0 ? `${formatMoney(paye)} payés` : null,
      ].filter((x): x is string => x !== null)
      return parties.length > 0 ? parties.join(' et ') : undefined
    }
    const cas: { montant: number }[][] = [
      IGNORES.slice(0, 4), [{ montant: 1250.5 }], [{ montant: -0.1 }, { montant: -0.2 }], [{ montant: 0 }], [],
      [{ montant: 300 }, { montant: -300 }],
    ]
    for (const lignes of cas) {
      expect(phrase(deployee.montantsDesMouvementsIgnores(lignes)), JSON.stringify(lignes)).toBe(montantsDesMouvementsIgnores(lignes))
    }
    // Les nombres eux-mêmes, au centime : 0,07 + 0,14 vaut 0,21000000000000002 en virgule flottante.
    expect(deployee.montantsDesMouvementsIgnores(IGNORES.slice(0, 4))).toEqual({ encaisse: 300, paye: 120.21 })
    expect(deployee.montantsDesMouvementsIgnores([{ montant: -0.07 }, { montant: -0.14 }])).toEqual({ encaisse: 0, paye: 0.21 })
    // Un encaissement et un paiement du même montant ne s'annulent pas : chacun se dit.
    expect(deployee.montantsDesMouvementsIgnores([{ montant: 300 }, { montant: -300 }])).toEqual({ encaisse: 300, paye: 300 })
  })
})

describe('agent-comptable / points_a_traiter lit les comptes de bilan et les mouvements ignorés', () => {
  const source = sourceDeployee()
  const corps = source.slice(source.indexOf('if (nom === "points_a_traiter")'), source.indexOf('return { erreur: `Outil inconnu'))

  it('lit le compte de bilan, le statut et le virement personnel sur le relevé entier, sous le même refus de lecture partielle', () => {
    expect(corps).toMatch(/lireTout<[^>]*MouvementCompteBilanRow>\(\(d, f\) =>\s*admin\.from\("lignes_bancaires"\)\.select\("id, date, montant, statut, [^"]*\bcompte_bilan, prelevement_personnel\b[^"]*"[^)]*\)\.eq\("dossier_id", dossierId\)\.order\("id"\)/)
    expect(corps).toMatch(/rANouveaux, rVehicules, rValides, rLettrages\]\s*\.filter\(\(r\) => !r\.complete\)/)
    expect(corps).toMatch(/\[rPieces, [^\]]*rReleve[^\]]*\]\s*\.filter\(\(r\) => !r\.complete\)/)
  })

  it('rend les deux points de la Checklist, l’ouverture et la frontière comprises', () => {
    expect(corps).toContain('const ouverture = rANouveaux.lignes[0]?.date ?? null')
    expect(corps).toContain('const bilanPerimes = mouvementsSurUnCompteDeBilanDesynchronises(ecrituresTyped, rReleve.lignes, frontiere)')
    expect(corps).toContain('const ignoresHorsFec = mouvementsIgnoresHorsFec(rReleve.lignes, ouverture, frontiere)')
    expect(corps).toMatch(/mouvements_ecrits_sur_un_compte_de_bilan_dont_l_ecriture_ne_suit_plus_le_compte: bilanPerimes\.length/)
    expect(corps).toMatch(/mouvements_ignores_absents_du_fec: \{ nombre: ignoresHorsFec\.length, \.\.\.montantsDesMouvementsIgnores\(ignoresHorsFec\) \}/)
  })

  it('dit au modèle qu’un mouvement écrit sur un compte de bilan n’est pas une anomalie, et qu’un mouvement ignoré manque au FEC', () => {
    expect(source).toMatch(/Un mouvement du relevé peut être ÉCRIT SUR UN COMPTE DE BILAN[^\n]*580000 Virements internes[^\n]*275000 Dépôts et cautionnements versés[^\n]*n'a pas de pièce[^\n]*ce n'est pas une anomalie, et ce n'est ni une charge ni une recette\. Un mouvement IGNORÉ, lui, n'est écrit nulle part : absent du FEC[^\n]*un mouvement réel ignoré est un point à traiter\./)
    // Et la description de l'outil les annonce, pour que le modèle sache les demander.
    expect(source).toMatch(/mouvements écrits sur un compte de bilan dont l'écriture ne suit plus le compte, mouvements ignorés absents du FEC/)
  })
})

describe('le garde-fou du bloc COMPTE DE BILAN sait encore échouer', () => {
  const planter = (...remplacements: [string, string][]) => {
    let source = sourceDeployee()
    for (const [avant, apres] of remplacements) {
      expect(source.split(avant).length - 1, `motif à planter introuvable ou ambigu : ${avant}`).toBe(1)
      source = source.replace(avant, apres)
    }
    return extraire(source)
  }
  // Une dérive doit faire échouer une ASSERTION, pas lever pour une autre raison (voir le bloc EMPRUNT).
  const echoue = (f: () => void) => {
    let erreur: unknown = null
    try { f() } catch (e) { erreur = e }
    expect((erreur as Error | null)?.name, `la dérive n'a pas fait échouer une assertion : ${String(erreur)}`).toBe('AssertionError')
  }
  const memesDesynchronises = (copie: Copie) => {
    for (const f of FRONTIERES) {
      expect(ids(copie.mouvementsSurUnCompteDeBilanDesynchronises(ECRITURES, LIGNES, f)))
        .toEqual(ids(mouvementsSurUnCompteDeBilanDesynchronises(ECRITURES, LIGNES, f)))
    }
  }
  const memesIgnores = (copie: Copie) => {
    for (const ouverture of OUVERTURES) {
      for (const f of FRONTIERES) {
        expect(ids(copie.mouvementsIgnoresHorsFec(IGNORES, ouverture, f))).toEqual(ids(mouvementsIgnoresHorsFec(IGNORES, ouverture, f)))
      }
    }
  }

  it('attrape une copie qui juge un mouvement sans compte de bilan', () => {
    echoue(() => memesDesynchronises(planter(['    !!l.compte_bilan\n    && l.statut === "rapprochee"\n', '    l.statut === "rapprochee"\n'])))
  })

  it('attrape une copie qui juge un mouvement qui n’est plus rapproché', () => {
    echoue(() => memesDesynchronises(planter(['    !!l.compte_bilan\n    && l.statut === "rapprochee"\n', '    !!l.compte_bilan\n'])))
  })

  it('attrape une copie qui réclame la réécriture d’un mouvement figé', () => {
    echoue(() => memesDesynchronises(planter(['    && l.statut === "rapprochee"\n    && !estFigee(l.date, frontiere)\n', '    && l.statut === "rapprochee"\n'])))
  })

  it('attrape une copie qui compare l’écriture à un compte figé plutôt qu’au compte du mouvement', () => {
    echoue(() => memesDesynchronises(planter(['ecritureDuCompteDeBilan(l, l.compte_bilan), l.date))', 'ecritureDuCompteDeBilan(l, "580000"), l.date))'])))
  })

  it('attrape une écriture qui porterait de la TVA', () => {
    const derivee = planter(['  return ecritureDuMouvement(ligne, compte, null)\n', '  return ecritureDuMouvement(ligne, compte, 20)\n'])
    echoue(() => expect(derivee.ecritureDuCompteDeBilan({ montant: 1200 }, '274100'))
      .toEqual(sansLibelle(ecritureDuCompteDeBilan(ligne({ montant: 1200 }), '274100'))))
  })

  it('attrape une copie qui compte un virement personnel parmi les mouvements ignorés', () => {
    echoue(() => memesIgnores(planter(['l.statut === "ignoree" && !l.prelevement_personnel\n', 'l.statut === "ignoree"\n'])))
  })

  it('attrape une copie qui oublie l’ouverture d’un dossier repris', () => {
    echoue(() => memesIgnores(planter(['    && (ouverture == null || l.date >= ouverture) && !estFigee(l.date, frontiere))', '    && !estFigee(l.date, frontiere))'])))
  })

  it('attrape une copie qui écarte le jour même de l’ouverture', () => {
    echoue(() => memesIgnores(planter(['(ouverture == null || l.date >= ouverture)', '(ouverture == null || l.date > ouverture)'])))
  })

  it('attrape une copie qui réclame un mouvement ignoré d’un exercice validé', () => {
    echoue(() => memesIgnores(planter(['    && (ouverture == null || l.date >= ouverture) && !estFigee(l.date, frontiere))', '    && (ouverture == null || l.date >= ouverture))'])))
  })

  it('attrape une copie qui somme les deux sens ensemble', () => {
    const derivee = planter(['    if (centimes > 0) entrees += centimes\n    else sorties -= centimes\n', '    entrees += centimes\n'])
    echoue(() => expect(derivee.montantsDesMouvementsIgnores([{ montant: 300 }, { montant: -300 }])).toEqual({ encaisse: 300, paye: 300 }))
  })

  it('attrape une copie qui somme en virgule flottante', () => {
    const derivee = planter(['    const centimes = Math.round(l.montant * 100)\n    if (centimes > 0) entrees += centimes', '    const centimes = l.montant * 100\n    if (centimes > 0) entrees += centimes'])
    echoue(() => expect(derivee.montantsDesMouvementsIgnores([{ montant: -0.07 }, { montant: -0.14 }])).toEqual({ encaisse: 0, paye: 0.21 }))
  })
})
