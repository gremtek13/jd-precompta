import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { calculerDeclaration2035 } from './declaration2035'
import { CASE_PAR_CODE, CODES_RATTACHABLES, valeursDesCases } from './cases2035'
import { cotisationsComptees } from './cotisationRapprochee'
import { partsDuReleve } from './partsDuReleve'
import { paiementsDesPieces } from './rattachement'
import { PLAN_PAR_DEFAUT } from './planComptable'
import { CAISSE_ABSENTE } from './recettesDeCaisse'
import { ventesFactureesVides } from '../test/ventesFacturees'
import type { Categorie, CotisationDeclaree, LigneBancaire } from './types'

// RELECTURE DU 01/11/2026 — LES TROIS POINTS « PLAUSIBLES » DE LA RELECTURE DU 31/10/2026, ÉTABLIS AVANT LES DONNÉES RÉELLES
// (MVP-D6 : la 2035 de 2025 d'un praticien exonéré, rejouée vers le 20 novembre et comparée à celle qu'il a déposée).
//
// Un `it` dit ce qui est vrai aujourd'hui et le restera ; un `it.fails` prouve un défaut NON CORRIGÉ : il passe tant que le
// défaut est là, et virera au rouge le jour de sa correction — on l'écrit alors en `it` ordinaire.
//
// Sources (publiques) : le formulaire 2035-A-SD et 2035-B-SD 2026 (« REVENUS 2025 », cerfa 15945*08), livré dans
// public/formulaires/2035-sd-2026.pdf (impots.gouv.fr, 2035-sd_5384.pdf) ; la notice 2035-NOT-SD 2026 (impots.gouv.fr,
// /sites/default/files/formulaires/2035-sd/2026/2035-sd_5385.pdf), p. 1 (BZ, BU), renvois (9), (13), (17), (21), (24),
// (25), (26).

const mouvement = (o: Partial<LigneBancaire>): LigneBancaire => ({
  id: 'l', dossier_id: 'd1', date: '2025-06-01', libelle: 'VIR', montant: 0, statut: 'rapprochee',
  piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false, source_fichier: null,
  libelle_brut: null, emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false,
  reglement_groupe: false, compte_bilan: null, declaration_tva_id: null, id_externe: null, created_at: '2025-06-02T09:00:00Z',
  encaissements_de_factures: false, ...o,
})

const echeance = (o: Partial<CotisationDeclaree>): CotisationDeclaree => ({
  id: 'cot', dossier_id: 'd1', echeance: '2025-03-05', montant_appele: 0, montant_verse: null, montant_csg_crds: null,
  created_at: '2025-01-05T09:00:00Z', previsionnel: false, paiement_personnel_le: null, ...o,
})

const exonere = (o: { categories: Categorie[]; lignes?: LigneBancaire[]; cotisations?: CotisationDeclaree[]; annee?: number }) =>
  calculerDeclaration2035(
    o.annee ?? 2025, [], o.categories, [],
    cotisationsComptees(o.cotisations ?? [], o.lignes ?? [], 'tresorerie'), [], false,
    paiementsDesPieces(o.lignes ?? [], [], []), partsDuReleve(o.lignes ?? [], o.categories, [], false), [], PLAN_PAR_DEFAUT,
    ventesFactureesVides('d1'), { etat: 'sans_bascule' }, CAISSE_ABSENTE,
  )

// Le dossier type d'une infirmière exonérée : 60 000 € de l'Assurance maladie, 9 000 € de cotisations OBLIGATOIRES (Urssaf
// et caisse de retraite, l'onglet Cotisations), 1 200 € de contrat Madelin, 180 € de cotisation à l'Ordre (une cotisation
// professionnelle, ligne 29), 2 400 € de redevance de collaboration versée à la titulaire, 1 500 € d'indemnités
// journalières versées par la caisse et rangées en gains divers.
const recettes = { id: 'c-rec', compte_comptable: '706000', poste_2035: 'Recettes' } as Categorie
const madelin = { id: 'c-mad', compte_comptable: '646100', poste_2035: 'Charges sociales personnelles' } as Categorie
const ordre = { id: 'c-ord', compte_comptable: '628100', poste_2035: 'Cotisations syndicales et professionnelles' } as Categorie
const collaboration = { id: 'c-col', compte_comptable: '613500', poste_2035: 'Redevances de collaboration' } as Categorie
const ij = { id: 'c-ij', compte_comptable: '791000', poste_2035: 'Indemnités journalières' } as Categorie
const cpam = mouvement({ id: 'cpam', categorie_id: 'c-rec', montant: 60_000 })
const urssaf = echeance({ id: 'urssaf', montant_appele: 9_000 })

describe('point 1 — les cases « dont » BT, BZ, BU, BY, BW, et CC, CL, DE, DB', () => {
  const NEUF = ['BT', 'BZ', 'BU', 'BY', 'BW', 'CC', 'CL', 'DE', 'DB']

  // PROUVÉ : aucune voie ne les remplit. Aucun poste n'y mène (le rattachement l'interdit pour les « dont », un test de
  // cases2035.test.ts le garde), `valeursDesCases` ne reçoit que la déclaration, et rien ne pose une valeur à côté.
  it('aucune des neuf n’est atteinte par un poste : toutes sont marquées « saisie du cabinet », et valent zéro', () => {
    for (const code of NEUF) {
      expect(CASE_PAR_CODE.get(code)?.saisieCabinet, code).toBe(true)
      expect(CODES_RATTACHABLES.has(code), code).toBe(false)
    }
    const d = exonere({
      categories: [recettes, madelin, ordre],
      lignes: [cpam, mouvement({ id: 'mad', categorie_id: 'c-mad', montant: -1_200 }), mouvement({ id: 'ord', categorie_id: 'c-ord', montant: -180 })],
      cotisations: [urssaf],
    })
    const { valeurs } = valeursDesCases(d)
    for (const code of NEUF) expect(valeurs.get(code), code).toBe(0)
    // Les porteuses, elles, sont justes : BK porte les obligatoires ET le Madelin, BM la cotisation à l'Ordre.
    expect(valeurs.get('BK')).toBe(10_200)
    expect(valeurs.get('BM')).toBe(180)
  })

  // L'ÉCART QUE LA COMPARAISON MONTRERA, ET CELUI QU'ELLE NE MONTRERA PAS : une case « dont » ne s'additionne jamais
  // (« dont », renvoi (9) pour BW) — vide, elle laisse BR, CP et DD intacts. L'écart est de forme, case par case.
  it('les « dont » vides ne changent ni BR, ni le résultat, ni le revenu brut social', () => {
    const d = exonere({ categories: [recettes, ordre], lignes: [cpam, mouvement({ id: 'ord', categorie_id: 'c-ord', montant: -180 })], cotisations: [urssaf] })
    const { valeurs } = valeursDesCases(d)
    expect(valeurs.get('BR')).toBe(9_180)
    expect(valeurs.get('CP')).toBe(50_820)
    // Renvoi (26) : CE − CN + BK + BV + DE − DB.
    expect(valeurs.get('DD')).toBe(59_820)
  })

  // SE DÉDUIT : la ligne 29 est un poste que le rattachement connaît déjà (« Cotisations syndicales et professionnelles »,
  // envoyé en BM). BY est la somme de ce seul poste ; rien n'est à saisir.
  it.fails('BY se DÉDUIT du poste « Cotisations syndicales et professionnelles » (défaut non corrigé)', () => {
    const d = exonere({ categories: [recettes, ordre], lignes: [cpam, mouvement({ id: 'ord', categorie_id: 'c-ord', montant: -180 })] })
    expect(valeursDesCases(d).valeurs.get('BY')).toBe(180)
  })

  // SE DÉDUIT : les échéances de l'onglet Cotisations sont les cotisations obligatoires (Urssaf, caisse de retraite) —
  // renvoi (13) : « la part respective des cotisations obligatoires et facultatives […] à la rubrique Charges sociales
  // personnelles ». BT est leur part de BK.
  it.fails('BT se DÉDUIT des échéances de l’onglet Cotisations (défaut non corrigé)', () => {
    const d = exonere({ categories: [recettes, madelin], lignes: [cpam, mouvement({ id: 'mad', categorie_id: 'c-mad', montant: -1_200 })], cotisations: [urssaf] })
    expect(valeursDesCases(d).valeurs.get('BT')).toBe(9_000)
  })

  // SE DÉDUIRAIT D'UN POSTE QUI N'EXISTE PAS : un contrat Madelin payé se range aujourd'hui sous le poste générique de BK,
  // qui ne dit pas « Madelin » ; BZ (et BU, le nouveau PER) demandent un poste propre. La part DÉDUCTIBLE (art. 154 bis,
  // plafonds) reste à l'expert-comptable (question ouverte « cotisations facultatives sans plafond »).
  it.fails('BZ se déduit d’un poste « Cotisations facultatives Madelin » (défaut non corrigé : le poste n’a pas de case)', () => {
    const madelinPropre = { ...madelin, poste_2035: 'Cotisations facultatives Madelin' }
    const d = exonere({ categories: [recettes, madelinPropre], lignes: [cpam, mouvement({ id: 'mad', categorie_id: 'c-mad', montant: -1_200 })] })
    const { valeurs, postesSansCase } = valeursDesCases(d)
    expect(postesSansCase).toEqual([])
    expect(valeurs.get('BK')).toBe(1_200)
    expect(valeurs.get('BZ')).toBe(1_200)
  })

  // Même chose pour BW : renvoi (9), « individualiser à la ligne 16 dans le cadre BW […] le montant de ces redevances puis
  // porter le total des locations […] y compris ces redevances, en ligne BG ». Le poste n'a pas de case aujourd'hui : il
  // tombe dans « aucune case connue », et la validation de l'exercice le refuse.
  it.fails('BW se déduit d’un poste « Redevances de collaboration », compté aussi en BG (défaut non corrigé)', () => {
    const d = exonere({ categories: [recettes, collaboration], lignes: [cpam, mouvement({ id: 'col', categorie_id: 'c-col', montant: -2_400 })] })
    const { valeurs, postesSansCase } = valeursDesCases(d)
    expect(postesSansCase).toEqual([])
    expect(valeurs.get('BG')).toBe(2_400)
    expect(valeurs.get('BW')).toBe(2_400)
  })

  // DB : renvoi (25), les indemnités journalières « lorsqu'elles ont été incluses dans la rubrique AF ». Rangées sous un
  // poste propre, elles iraient en AF ET en DB ; aujourd'hui ce poste n'a pas de case, et la validation le refuse.
  it.fails('les indemnités journalières rangées en gains divers vont en AF et en DB (défaut non corrigé)', () => {
    const d = exonere({ categories: [recettes, ij], lignes: [cpam, mouvement({ id: 'ij', categorie_id: 'c-ij', montant: 1_500 })], cotisations: [urssaf] })
    const { valeurs, postesSansCase } = valeursDesCases(d)
    expect(postesSansCase).toEqual([])
    expect(valeurs.get('AF')).toBe(1_500)
    expect(valeurs.get('DB')).toBe(1_500)
    expect(valeurs.get('DD')).toBe(60_000 - 9_000 + 9_000)
  })

  // SE SAISIT : CC (renvoi (17) : quote-part personnelle de dépenses mixtes, avantage en nature du véhicule, fraction non
  // déductible de l'amortissement d'un véhicule…), CL (renvoi (21) : exonérations ZFU, ZFRR, zones déficitaires en offre de
  // soins, abattements des médecins de secteur I…), DE (renvoi (24)) sont des arbitrages : aucune table ne les porte
  // (catalogue de la production relu le 01/11/2026 : ni table, ni colonne), et le calcul n'a pas d'entrée pour eux.
  it.fails('une saisie du cabinet en CC, CL ou DE atteint le formulaire (défaut non corrigé : aucune entrée)', () => {
    const d = exonere({ categories: [recettes], lignes: [cpam], cotisations: [urssaf] })
    // L'entrée qui manque, sous la forme qu'elle prendrait : le calcul l'ignore aujourd'hui.
    const avecSaisies = valeursDesCases as unknown as (d: unknown, s: ReadonlyMap<string, number>) => ReturnType<typeof valeursDesCases>
    const { valeurs } = avecSaisies(d, new Map([['CC', 600], ['CL', 0], ['DE', 0]]))
    expect(valeurs.get('CC')).toBe(600)
    expect(valeurs.get('CP')).toBe(51_600)
  })
})

describe('point 2 — une échéance prévisionnelle et l’appel définitif d’une autre date', () => {
  // L'échéancier prévisionnel de la caisse (CARPIMKO, « ÉCHÉANCIER PRÉVISIONNEL » de l'avis de N−1) pose une échéance au
  // 20/01/2026 ; l'appel définitif la fixe au 05/02/2026, et c'est lui que le relevé paie. L'écran les garde toutes deux
  // (src/pages/dossier/CotisationsTab.test.tsx, « l’appel définitif à une autre date que sa prévisionnelle »), et rien en
  // aval ne les distingue : `cotisationsComptees` compte l'une à son prélèvement, l'autre à son échéance.
  const prevue = echeance({ id: 'prev', echeance: '2026-01-20', montant_appele: 300, previsionnel: true })
  const appel = echeance({ id: 'appel', echeance: '2026-02-05', montant_appele: 320 })
  const prelevement = mouvement({ id: 'prlv', date: '2026-02-05', montant: -320, cotisation_id: 'appel' })

  it('constat : la seule trace est la liste « comptées à leur échéance » de Clôture, qui la dit « prévisionnelle »', () => {
    const comptees = cotisationsComptees([prevue, appel], [prelevement], 'tresorerie')
    expect(comptees.map((c) => [c.cotisation.id, c.date, c.montant, c.ligne === null])).toEqual([
      ['prev', '2026-01-20', 300, true],
      ['appel', '2026-02-05', 320, false],
    ])
  })

  it.fails('BK ne compte que l’appel définitif (défaut non corrigé : 620 € au lieu de 320 €)', () => {
    const d = exonere({ annee: 2026, categories: [], lignes: [prelevement], cotisations: [prevue, appel] })
    expect(valeursDesCases(d).valeurs.get('BK')).toBe(320)
  })
})

describe('point 3 — le formulaire PDF de 2026 rempli pour tout exercice', () => {
  // Le modèle que l'application sert : `remplir2035` ne reçoit pas l'exercice, et le seul modèle nommé est MODELE_2035.
  // Lu dans la source plutôt qu'importé : remplir2035.ts charge le pdf.js du navigateur et son « worker », que l'environnement
  // node des tests n'a pas.
  const source = readFileSync('src/lib/remplir2035.ts', 'utf8')
  const modeles = [...source.matchAll(/'\/formulaires\/(2035-sd-\d{4}\.pdf)'/g)].map((m) => m[1])
  const signature = /export async function remplir2035\(([\s\S]*?)\): Promise/.exec(source)?.[1] ?? ''

  async function revenusDuModele(fichier: string): Promise<number | null> {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(`public/formulaires/${fichier}`)) }).promise
    const page = await doc.getPage(1)
    const texte = (await page.getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join(' ')
    const m = /REVENUS (\d{4})/.exec(texte)
    return m ? Number(m[1]) : null
  }

  // Le modèle qui remplit la 2035 de l'exercice `annee` : un seul, quel que soit l'exercice (le test qui suit l'établit).
  async function revenusDuFormulaireRempliPour(annee: number): Promise<number | null> {
    void annee // l'exercice n'entre pas dans le choix du modèle
    return revenusDuModele(modeles[0])
  }

  it('un seul modèle est servi, et remplir2035 ne reçoit pas l’exercice', () => {
    expect(modeles).toEqual(['2035-sd-2026.pdf'])
    expect(signature).toMatch(/valeurs/)
    expect(signature).not.toMatch(/annee/)
  })

  it('l’exercice 2025 se remplit sur le bon formulaire : « REVENUS 2025 », millésime 2026', async () => {
    expect(await revenusDuFormulaireRempliPour(2025)).toBe(2025)
  })

  // PROUVÉ, NON CORRIGÉ, ET HORS DU MVP : la 2035 de 2026 sera déposée en mai 2027 par l'expert-comptable sur son logiciel
  // (MVP-D5), et le formulaire « REVENUS 2026 » (millésime 2027) n'est pas publié. Aujourd'hui l'application imprime les
  // chiffres de 2026 sous l'en-tête « REVENUS 2025 », sans rien dire.
  it.fails('l’exercice 2026 se remplit sur le formulaire « REVENUS 2026 » (défaut non corrigé)', async () => {
    expect(await revenusDuFormulaireRempliPour(2026)).toBe(2026)
  })
})
