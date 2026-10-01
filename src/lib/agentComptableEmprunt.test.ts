import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { COMPTE_ASSURANCE_EMPRUNT, COMPTE_BANQUE, COMPTE_EMPRUNT, COMPTE_INTERETS_EMPRUNT } from './comptes'
import {
  couvertureDuReleve, echeancesDesynchronisees, echeancesNonRapprochees, ecritureDeLEcheance, MARGE_PRELEVEMENT_JOURS,
} from './echeanceEmprunt'
import { genererEcheancier, type Emprunt } from './emprunts'
import { ajouterJours, ajouterMois } from './format'
import type { EcritureBrouillon, LigneBancaire } from './types'

// L'ASSISTANT RECOPIE CE QUE LA CHECKLIST DIT DES ÉCHÉANCES D'EMPRUNT (29/09/2026, ligne 26.6).
//
// Deux points de la Checklist en dépendent : les échéances que le relevé couvre sans qu'aucun mouvement
// ne les paie — leurs intérêts ne sont pas comptés —, et l'échéance dont l'écriture ne suit plus son
// découpage. `agent-comptable` est auto-portée : elle recopie l'échéancier, les dates civiles, la
// couverture du relevé et l'écriture attendue entre les bornes `── DÉBUT/FIN EMPRUNT`, et ce test les
// compare à `src/lib` sur une batterie commune — la même forme de garde que les blocs AFFECTATION et
// BALANCE : extraire, transpiler, exécuter, comparer à une référence EXTÉRIEURE à la copie, et planter des
// dérives dans la vraie source pour prouver qu'il sait encore échouer.
//
// CE QU'UNE DÉRIVE COÛTERAIT : l'assistant répondrait « aucune échéance à rapprocher » sur un dossier où
// la Checklist en compte, en français, à un comptable qui n'ira pas vérifier — ou l'inverse, et c'est
// l'échéancier lui-même qui dérive le plus facilement : un arrondi d'intérêts, un 31 du mois.

function sourceDeployee(): string {
  return readFileSync(new URL('../../supabase/functions/agent-comptable/index.ts', import.meta.url), 'utf8')
}

type Echeance = ReturnType<typeof genererEcheancier>[number]
interface Copie {
  ajouterMois: typeof ajouterMois
  ajouterJours: typeof ajouterJours
  genererEcheancier: typeof genererEcheancier
  echeancesNonRapprochees: (e: Emprunt[], l: LigneBancaire[], debut: string, fin: string) => { emprunt: { id: string }; echeance: Echeance }[]
  couvertureDuReleve: typeof couvertureDuReleve
  ecritureDeLEcheance: (l: { montant: number }, interets: number, assurance: number) => { compte: string; sens: string; montant: number }[]
  echeancesDesynchronisees: (e: EcritureBrouillon[], l: LigneBancaire[]) => { id: string }[]
}

// Le bloc EMPRUNT lit `ecrituresSansPieceParMouvement` et `ecritureConforme` du bloc AFFECTATION, et
// `COMPTE_BANQUE` déclaré plus haut : les trois sont repris de la MÊME source, pour qu'une dérive de l'un
// d'eux morde ici aussi.
function extraire(source: string): Copie {
  const bornes = (nom: string) => {
    const debut = source.indexOf(`// ── DÉBUT ${nom}`)
    const fin = source.indexOf(`// ── FIN ${nom}`)
    expect(debut, `bornes du bloc ${nom} introuvables — garde-fou à remettre à jour`).toBeGreaterThan(-1)
    expect(fin).toBeGreaterThan(debut)
    return source.slice(debut, fin)
  }
  const banque = /const COMPTE_BANQUE = "(\d+)"/.exec(source)
  expect(banque, '`COMPTE_BANQUE` introuvable dans la source').not.toBeNull()
  const bloc = `const COMPTE_BANQUE = "${banque![1]}"\n${bornes('AFFECTATION')}\n${bornes('EMPRUNT')}`
  const js = ts.transpileModule(bloc, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(`${js}\nreturn { ajouterMois, ajouterJours, genererEcheancier, echeancesNonRapprochees, couvertureDuReleve, ecritureDeLEcheance, echeancesDesynchronisees }`)() as Copie
}

const deployee = extraire(sourceDeployee())

const emprunt = (o: Partial<Emprunt>): Emprunt => ({
  id: 'a', dossier_id: 'd', nom: 'Prêt matériel', organisme_preteur: null, capital_initial: 12000, taux_annuel: 3.6,
  date_debut: '2025-01-05', duree_mois: 24, created_at: '2025-01-05T10:00:00Z', ...o,
})
// Un 31 du mois (l'échéance de février se ramène au dernier jour), un taux nul, un capital et un taux qui
// arrondissent mal, un prêt qui enjambe une année bissextile.
const EMPRUNTS: Emprunt[] = [
  emprunt({}),
  emprunt({ id: 'b', nom: 'Prêt travaux', capital_initial: 50000, taux_annuel: 1.25, date_debut: '2024-01-31', duree_mois: 84 }),
  emprunt({ id: 'c', nom: 'Prêt à taux zéro', capital_initial: 3000, taux_annuel: 0, date_debut: '2025-02-28', duree_mois: 12 }),
  emprunt({ id: 'd', nom: 'Prêt court', capital_initial: 999.99, taux_annuel: 7.35, date_debut: '2023-11-30', duree_mois: 5 }),
]

const ligne = (o: Partial<LigneBancaire>): LigneBancaire => ({
  id: 'l', dossier_id: 'd', date: '2025-02-06', libelle: 'PRLV ECHEANCE PRET', montant: -540, statut: 'rapprochee',
  piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
  emprunt_id: 'a', emprunt_echeance: 1, emprunt_interets: 36, emprunt_assurance: 21.03, ventilee: false, reglement_groupe: false, id_externe: null,
  source_fichier: null, libelle_brut: null, created_at: '2025-02-06T09:00:00Z', ...o,
})

const ecriture = (o: Partial<EcritureBrouillon>): EcritureBrouillon => ({
  id: 'e', dossier_id: 'd', piece_id: null, ligne_bancaire_id: 'l', date: '2025-02-06', compte: COMPTE_BANQUE,
  libelle: 'PRLV ECHEANCE PRET', sens: 'credit', montant: 540, statut: 'proposee', created_at: '2025-02-06T09:00:00Z', ...o,
})
// L'écriture juste d'un mouvement, telle que src/lib la compose.
const conforme = (l: LigneBancaire, date = l.date): EcritureBrouillon[] =>
  ecritureDeLEcheance(l, { echeance: l.emprunt_echeance, interets: l.emprunt_interets ?? 0, assurance: l.emprunt_assurance ?? 0 })
    .map((e, i) => ecriture({ id: `${l.id}-${i}`, ligne_bancaire_id: l.id, date, compte: e.compte, sens: e.sens, montant: e.montant }))

const resume = (a: { emprunt: { id: string }; echeance: Echeance }[]) => a.map((m) => `${m.emprunt.id}#${m.echeance.numero}@${m.echeance.date}`)
const ids = (a: { id: string }[]) => a.map((l) => l.id)
const sansLibelle = (e: { compte: string; sens: string; montant: number }[]) => e.map(({ compte, sens, montant }) => ({ compte, sens, montant }))

// Les mouvements du relevé : des échéances payées de plusieurs emprunts, un déblocage, des mouvements qui
// n'ont rien à voir — et le MÊME numéro d'échéance payé pour un autre emprunt, qui ne paie pas celui-ci.
const RELEVE: LigneBancaire[] = [
  ligne({ id: 'a1' }),
  ligne({ id: 'a3', date: '2025-04-07', emprunt_echeance: 3, emprunt_interets: 33.1, emprunt_assurance: 0 }),
  ligne({ id: 'b14', date: '2025-03-31', emprunt_id: 'b', emprunt_echeance: 14, emprunt_interets: 45.5, emprunt_assurance: 12.2, montant: -650 }),
  ligne({ id: 'c2', date: '2025-04-28', emprunt_id: 'c', emprunt_echeance: 2, emprunt_interets: 0, emprunt_assurance: 0, montant: -250 }),
  ligne({ id: 'deblocage', date: '2025-01-07', montant: 12000, emprunt_echeance: null, emprunt_interets: 0, emprunt_assurance: 0 }),
  ligne({ id: 'cpam', date: '2025-01-02', montant: 250, emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, categorie_id: 'recettes' }),
  ligne({ id: 'fin', date: '2025-06-30', montant: -8.5, statut: 'non_rapprochee', emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null }),
]

describe('agent-comptable / bloc EMPRUNT (copie déployée)', () => {
  it('n’est pas la fonction de src/lib elle-même', () => {
    expect(deployee.genererEcheancier).not.toBe(genererEcheancier)
    expect(deployee.echeancesNonRapprochees).not.toBe(echeancesNonRapprochees)
  })

  it('compte les jours et les mois sur le calendrier civil, comme src/lib', () => {
    for (const date of ['2024-01-31', '2024-02-29', '2025-01-31', '2025-03-31', '2025-12-31', '2025-06-15', '2023-11-30']) {
      for (let n = -25; n <= 25; n++) expect(deployee.ajouterMois(date, n), `${date} + ${n} mois`).toBe(ajouterMois(date, n))
      for (let n = -40; n <= 40; n++) expect(deployee.ajouterJours(date, n), `${date} + ${n} jours`).toBe(ajouterJours(date, n))
    }
  })

  it('rend le même échéancier, au centime et au jour près', () => {
    for (const e of EMPRUNTS) expect(deployee.genererEcheancier(e), e.nom).toEqual(genererEcheancier(e))
  })

  it('rend les mêmes échéances non rapprochées, sur plusieurs fenêtres', () => {
    for (const [debut, fin] of [['2025-01-01', '2025-12-31'], ['2024-01-01', '2026-12-31'], ['2025-02-05', '2025-04-05'], ['2025-05-01', '2025-04-01']]) {
      expect(resume(deployee.echeancesNonRapprochees(EMPRUNTS, RELEVE, debut, fin)), `${debut} → ${fin}`)
        .toEqual(resume(echeancesNonRapprochees(EMPRUNTS, RELEVE, debut, fin)))
    }
    // La batterie exerce bien ce qui décide : une échéance payée sort, et le numéro 3 payé pour l'emprunt
    // « a » ne paie pas le 3 de l'emprunt « b ».
    const manquantes = resume(echeancesNonRapprochees(EMPRUNTS, RELEVE, '2025-01-01', '2025-04-30'))
    expect(manquantes).not.toContain('a#1@2025-02-05')
    expect(manquantes).toContain('a#2@2025-03-05')
    expect(manquantes.some((m) => m.startsWith('b#'))).toBe(true)
  })

  it('rend la même couverture du relevé, marge comprise', () => {
    expect(deployee.couvertureDuReleve([])).toEqual(couvertureDuReleve([]))
    expect(deployee.couvertureDuReleve(RELEVE)).toEqual(couvertureDuReleve(RELEVE))
    expect(deployee.couvertureDuReleve([RELEVE[0]])).toEqual(couvertureDuReleve([RELEVE[0]]))
    expect(couvertureDuReleve(RELEVE)).toEqual({ debut: '2025-01-02', fin: ajouterJours('2025-06-30', -MARGE_PRELEVEMENT_JOURS) })
  })

  it('compose la même écriture, ligne à ligne, que le mouvement soit une échéance ou un déblocage', () => {
    const cas: [number, number, number][] = [
      [-540, 36, 21.03], [-540, 36, 0], [-540, 540, 0], [-540, 500, 40], [-0.3, 0.1, 0.2], [-1234.57, 0.07, 0.14], [12000, 0, 0], [0.3, 0, 0],
    ]
    for (const [montant, interets, assurance] of cas) {
      expect(deployee.ecritureDeLEcheance({ montant }, interets, assurance), `${montant} / ${interets} / ${assurance}`)
        .toEqual(sansLibelle(ecritureDeLEcheance(ligne({ montant }), { echeance: montant > 0 ? null : 1, interets, assurance })))
    }
    // Les comptes sont bien ceux de src/lib.
    expect(sansLibelle(ecritureDeLEcheance(ligne({}), { echeance: 1, interets: 36, assurance: 21.03 })).map((e) => e.compte))
      .toEqual([COMPTE_EMPRUNT, COMPTE_INTERETS_EMPRUNT, COMPTE_ASSURANCE_EMPRUNT, COMPTE_BANQUE])
  })

  it('rend les mêmes échéances dont l’écriture ne suit plus le découpage', () => {
    const echeances = [
      ligne({ id: 'juste' }),
      ligne({ id: 'absente' }),
      ligne({ id: 'amputee' }),
      ligne({ id: 'autre-montant' }),
      ligne({ id: 'autre-date' }),
      ligne({ id: 'deblocage', montant: 12000, date: '2025-01-07', emprunt_echeance: null, emprunt_interets: 0, emprunt_assurance: 0 }),
      ligne({ id: 'pas-un-emprunt', emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, categorie_id: 'frais' }),
    ]
    const ecritures = [
      ...conforme(echeances[0]),
      ...conforme(echeances[2]).slice(1),
      ...conforme(echeances[3]).map((e) => (e.compte === COMPTE_INTERETS_EMPRUNT ? { ...e, montant: 30 } : e)),
      ...conforme(echeances[4], '2025-02-10'),
      ...conforme(echeances[5]),
      // Les écritures d'une PIÈCE qui désignent le même mouvement n'en sont pas.
      ecriture({ id: 'piece', piece_id: 'p1', ligne_bancaire_id: 'juste', compte: '606100', sens: 'debit', montant: 540 }),
    ]
    expect(ids(deployee.echeancesDesynchronisees(ecritures, echeances))).toEqual(ids(echeancesDesynchronisees(ecritures, echeances)))
    expect(ids(echeancesDesynchronisees(ecritures, echeances))).toEqual(['absente', 'amputee', 'autre-montant', 'autre-date'])
  })
})

describe('agent-comptable / points_a_traiter lit les emprunts et le relevé', () => {
  const source = sourceDeployee()
  const corps = source.slice(source.indexOf('if (nom === "points_a_traiter")'), source.indexOf('return { erreur: `Outil inconnu'))

  it('lit les emprunts et le relevé entier, sous le même refus de lecture partielle', () => {
    expect(corps).toMatch(/from\("emprunts"\)\.select\("id, nom, capital_initial, taux_annuel, date_debut, duree_mois"[^)]*\)\.eq\("dossier_id", dossierId\)\.order\("date_debut"\)\.order\("id"\)/)
    // Le relevé ENTIER, sans filtre de statut : c'est lui qui dit ce qu'il couvre — et, avec `ventilee`, ce
    // que le bloc VENTILATION en lit.
    expect(corps).toMatch(/from\("lignes_bancaires"\)\.select\("id, date, montant, statut, [^"]*emprunt_id, emprunt_echeance, emprunt_interets, emprunt_assurance, ventilee"[^)]*\)\.eq\("dossier_id", dossierId\)\.order\("id"\)/)
    expect(corps).toMatch(/rAffectes, rVirements, rEmprunts, rReleve, rParts, rReglements\]\s*\.filter\(\(r\) => !r\.complete\)/)
  })

  it('borne la réclamation à la couverture du relevé, et rend les deux points de la Checklist', () => {
    expect(corps).toContain('const couverture = couvertureDuReleve(rReleve.lignes)')
    expect(corps).toContain('echeancesNonRapprochees(rEmprunts.lignes, rReleve.lignes, couverture.debut, couverture.fin)')
    expect(corps).toContain('echeancesDesynchronisees(ecrituresTyped, rReleve.lignes)')
    expect(corps).toMatch(/echeances_emprunt_couvertes_par_le_releve_sans_mouvement_rapproche: echeancesManquantes\.length/)
    expect(corps).toMatch(/echeances_emprunt_dont_l_ecriture_ne_suit_plus_le_decoupage: echeancesPerimees\.length/)
  })

  it('dit au modèle qu’une échéance s’écrit sur trois comptes sans pièce, et qu’un déblocage n’est pas une recette', () => {
    expect(source).toMatch(/Une ÉCHÉANCE D'EMPRUNT rapprochée s'écrit face au 512000, sans pièce, sur trois comptes : le capital remboursé au 164000[^\n]*les intérêts au 661100 et l'assurance au 616800[^\n]*Le DÉBLOCAGE d'un emprunt crédite le 164000 face au 512000 : ce n'est pas une recette/)
  })
})

describe('le garde-fou du bloc EMPRUNT sait encore échouer', () => {
  const planter = (...remplacements: [string, string][]) => {
    let source = sourceDeployee()
    for (const [avant, apres] of remplacements) {
      expect(source.split(avant).length - 1, `motif à planter introuvable ou ambigu : ${avant}`).toBe(1)
      source = source.replace(avant, apres)
    }
    return extraire(source)
  }
  const echoue = (f: () => void) => expect(f).toThrow()

  it('attrape un mois qui ne se ramène plus au dernier jour', () => {
    const derivee = planter(['  const jourCible = Math.min(jour, dernierJour)\n  return `${anneeCible}-${String(moisCible + 1).padStart(2, "0")}', '  const jourCible = jour\n  return `${anneeCible}-${String(moisCible + 1).padStart(2, "0")}'])
    echoue(() => expect(derivee.genererEcheancier(EMPRUNTS[1])).toEqual(genererEcheancier(EMPRUNTS[1])))
  })

  it('attrape des intérêts arrondis autrement', () => {
    const derivee = planter(['    const interets = Math.round(capitalRestant * tauxMensuel * 100) / 100\n    let capitalRembourse', '    const interets = Math.floor(capitalRestant * tauxMensuel * 100) / 100\n    let capitalRembourse'])
    echoue(() => { for (const e of EMPRUNTS) expect(derivee.genererEcheancier(e)).toEqual(genererEcheancier(e)) })
  })

  it('attrape une couverture sans marge', () => {
    const derivee = planter(['  return { debut, fin: ajouterJours(fin, -MARGE_PRELEVEMENT_JOURS) }\n}\n\nconst centimesEmprunt', '  return { debut, fin }\n}\n\nconst centimesEmprunt'])
    echoue(() => expect(derivee.couvertureDuReleve(RELEVE)).toEqual(couvertureDuReleve(RELEVE)))
  })

  it('attrape une marge qui a changé', () => {
    const derivee = planter(['const MARGE_PRELEVEMENT_JOURS = 10\n', 'const MARGE_PRELEVEMENT_JOURS = 5\n'])
    echoue(() => expect(derivee.couvertureDuReleve(RELEVE)).toEqual(couvertureDuReleve(RELEVE)))
  })

  it('attrape une échéance payée pour un autre emprunt qui paierait celui-ci', () => {
    const derivee = planter(
      ['.map((l) => `${l.emprunt_id}|${l.emprunt_echeance}`))\n  const manquantes', '.map((l) => `${l.emprunt_echeance}`))\n  const manquantes'],
      ['      if (payees.has(`${emprunt.id}|${echeance.numero}`)) continue', '      if (payees.has(`${echeance.numero}`)) continue'],
    )
    echoue(() => expect(resume(derivee.echeancesNonRapprochees(EMPRUNTS, RELEVE, '2025-01-01', '2025-12-31')))
      .toEqual(resume(echeancesNonRapprochees(EMPRUNTS, RELEVE, '2025-01-01', '2025-12-31'))))
  })

  it('attrape une écriture qui garde ses lignes à zéro', () => {
    const derivee = planter(['  ].filter((l) => l.montant > 0)\n}\n\n// Un mouvement rapproché d\'un emprunt', '  ]\n}\n\n// Un mouvement rapproché d\'un emprunt'])
    echoue(() => expect(derivee.ecritureDeLEcheance({ montant: -540 }, 36, 0))
      .toEqual(sansLibelle(ecritureDeLEcheance(ligne({}), { echeance: 1, interets: 36, assurance: 0 }))))
  })

  it('attrape un déblocage écrit dans le mauvais sens', () => {
    const derivee = planter(['      { compte: COMPTE_EMPRUNT, sens: "credit", montant: total / 100 },', '      { compte: COMPTE_EMPRUNT, sens: "debit", montant: total / 100 },'])
    echoue(() => expect(derivee.ecritureDeLEcheance({ montant: 12000 }, 0, 0))
      .toEqual(sansLibelle(ecritureDeLEcheance(ligne({ montant: 12000 }), { echeance: null, interets: 0, assurance: 0 }))))
  })

  it('attrape un compte d’intérêts qui a changé', () => {
    const derivee = planter(['const COMPTE_INTERETS_EMPRUNT = "661100"', 'const COMPTE_INTERETS_EMPRUNT = "661000"'])
    echoue(() => expect(derivee.ecritureDeLEcheance({ montant: -540 }, 36, 21.03))
      .toEqual(sansLibelle(ecritureDeLEcheance(ligne({}), { echeance: 1, interets: 36, assurance: 21.03 }))))
  })

  it('attrape une copie qui prend tout mouvement pour une échéance', () => {
    const derivee = planter(['    if (!ligne.emprunt_id) return false\n    const attendue', '    const attendue'])
    const releve = [ligne({ id: 'pas-un-emprunt', emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null })]
    echoue(() => expect(ids(derivee.echeancesDesynchronisees([], releve))).toEqual(ids(echeancesDesynchronisees([], releve))))
  })
})
