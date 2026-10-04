import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { COMPTE_BANQUE } from './comptes'
import type { ModeleComptable } from './engagement'
import type { Categorie, EcritureBrouillon, LigneBancaire, VentilationBancaire } from './types'
import {
  ecritureDeLaVentilation, mouvementsVentilesDesynchronises, partsDesVentilations, recettesVentileesSansTaux,
  ventilationsIncoherentes,
} from './ventilationBanque'
import { NON_VALIDEE } from '../test/ecritures'

// L'ASSISTANT RECOPIE CE QUE LA CHECKLIST DIT DES MOUVEMENTS VENTILÉS (30/09/2026, ligne 26.6).
//
// Un mouvement du relevé se ventile sur plusieurs comptes — une remise de carte et sa commission, un
// paiement en partie personnel. Trois points de la Checklist en dépendent : le mouvement dont l'écriture
// ne suit plus ses parts, celui dont les parts ne font plus le mouvement, et la part de recettes SANS TAUX
// de TVA d'un dossier assujetti — depuis le 01/10/2026, une part de recette d'un dossier assujetti porte
// son taux, et s'écrit au hors taxe avec sa TVA collectée à côté. `agent-comptable` est auto-portée : elle recopie ces fonctions entre les bornes
// `── DÉBUT/FIN VENTILATION`, et ce test les compare à `src/lib` sur une batterie commune — la forme de
// garde des blocs AFFECTATION et EMPRUNT : extraire, transpiler, exécuter, comparer à une référence
// EXTÉRIEURE à la copie, et planter des dérives dans la vraie source pour prouver qu'il sait encore échouer.
//
// CE QU'UNE DÉRIVE COÛTERAIT : l'assistant répondrait « rien à réécrire » sur un dossier où la Checklist
// compte un mouvement ventilé dont l'écriture a gardé l'ancien compte d'une catégorie — en français, à un
// comptable qui n'ira pas vérifier.

function sourceDeployee(): string {
  return readFileSync(new URL('../../supabase/functions/agent-comptable/index.ts', import.meta.url), 'utf8')
}

type Ecriture = { compte: string; sens: string; montant: number }
interface Copie {
  ecritureDeLaVentilation: (l: { montant: number }, p: VentilationBancaire[], c: Categorie[], m: ModeleComptable, assujetti: boolean) => Ecriture[] | null
  partsDesVentilations: (l: LigneBancaire[], p: VentilationBancaire[], c: Categorie[], assujetti: boolean) => { ligne: { id: string }; nature: string | null; taux: number | null }[]
  recettesVentileesSansTaux: (p: ReturnType<Copie['partsDesVentilations']>, assujetti: boolean) => { id: string }[]
  ventilationsIncoherentes: (l: LigneBancaire[], p: VentilationBancaire[]) => { ligne: { id: string }; raison: string }[]
  mouvementsVentilesDesynchronises: (e: EcritureBrouillon[], l: LigneBancaire[], p: VentilationBancaire[], c: Categorie[], m: ModeleComptable, assujetti: boolean) => { id: string }[]
}

// Le bloc VENTILATION lit `natureDuCompte`, `compteDuDirigeant`, `ecrituresSansPieceParMouvement`,
// `ecritureConforme`, `tauxApplicable` et `horsTaxeEtTva` du bloc AFFECTATION, et `COMPTE_BANQUE` et
// `COMPTE_TVA_COLLECTEE` déclarés plus haut : tous sont repris de la MÊME source, pour qu'une dérive de l'un
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
  const tva = /const COMPTE_TVA_COLLECTEE = "(\d+)"/.exec(source)
  expect(tva, '`COMPTE_TVA_COLLECTEE` introuvable dans la source').not.toBeNull()
  const bloc = `const COMPTE_BANQUE = "${banque![1]}"\nconst COMPTE_TVA_COLLECTEE = "${tva![1]}"\n${bornes('AFFECTATION')}\n${bornes('VENTILATION')}`
  const js = ts.transpileModule(bloc, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(`${js}\nreturn { ecritureDeLaVentilation, partsDesVentilations, recettesVentileesSansTaux, ventilationsIncoherentes, mouvementsVentilesDesynchronises }`)() as Copie
}

const deployee = extraire(sourceDeployee())

const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '455000' }
const ENGAGEMENT_455: ModeleComptable = { mode: 'engagement', compteNotesDeFrais: '455000' }
const ENGAGEMENT_467: ModeleComptable = { mode: 'engagement', compteNotesDeFrais: '467000' }
const MODELES = [TRESORERIE, ENGAGEMENT_455, ENGAGEMENT_467]

const categorie = (o: Partial<Categorie>): Categorie => ({
  id: 'c', dossier_id: null, code: 'x', libelle: 'X', ordre: 0, compte_comptable: null, poste_2035: null, ...o,
})
const CATEGORIES: Categorie[] = [
  categorie({ id: 'tel', libelle: 'Téléphone', compte_comptable: '626000', poste_2035: 'Frais postaux' }),
  categorie({ id: 'frais', libelle: 'Frais bancaires', compte_comptable: '627000', poste_2035: 'Frais financiers' }),
  categorie({ id: 'recettes', libelle: 'Honoraires encaissés', compte_comptable: '706000', poste_2035: 'Recettes' }),
  // Une seconde catégorie de recettes : deux parts taxées d'un même mouvement ne vont pas au même compte.
  categorie({ id: 'ventes', libelle: 'Ventes de produits', compte_comptable: '707000', poste_2035: 'Recettes' }),
  // Une catégorie sortie des comptes de résultat : sa part ne peut plus s'écrire.
  categorie({ id: 'bilan', libelle: 'Compte de bilan', compte_comptable: '108000', poste_2035: null }),
]

const ligne = (o: Partial<LigneBancaire>): LigneBancaire => ({
  id: 'l', dossier_id: 'd', date: '2025-03-31', libelle: 'PRLV OPERATEUR', montant: -120, statut: 'rapprochee',
  piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
  emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: true, reglement_groupe: false, id_externe: null,
  source_fichier: null, libelle_brut: null, created_at: '2025-04-01T09:00:00Z', ...o,
})
const part = (
  ligneId: string, categorieId: string | null, montant: number, id = `${ligneId}-${categorieId ?? 'perso'}`, taux: number | null = null,
): VentilationBancaire => ({
  id, dossier_id: 'd', ligne_bancaire_id: ligneId, categorie_id: categorieId, part_personnelle: categorieId === null,
  montant, taux_tva: taux, created_at: '2025-04-01T09:00:00Z',
})
const ecriture = (o: Partial<EcritureBrouillon>): EcritureBrouillon => ({
  id: 'e', dossier_id: 'd', piece_id: null, ligne_bancaire_id: 'l', date: '2025-03-31', compte: COMPTE_BANQUE,
  libelle: 'PRLV OPERATEUR', sens: 'credit', montant: 120, statut: 'proposee', immobilisation_id: null, vehicule_id: null, ...NON_VALIDEE, created_at: '2025-04-01T09:00:00Z', ...o,
})
const sansLibelle = (e: { compte: string; sens: string; montant: number }[] | null) =>
  e && e.map(({ compte, sens, montant }) => ({ compte, sens, montant }))
const ids = (a: { id: string }[]) => a.map((l) => l.id)
const resumeParts = (p: { ligne: { id: string }; nature: string | null; taux: number | null }[]) => p.map((x) => `${x.ligne.id}:${x.nature}:${x.taux}`)
// L'écriture juste d'un mouvement ventilé, telle que src/lib la compose.
const conforme = (l: LigneBancaire, parts: VentilationBancaire[], modele: ModeleComptable, date = l.date, assujetti = false): EcritureBrouillon[] =>
  (ecritureDeLaVentilation(l, parts, CATEGORIES, modele, assujetti) ?? [])
    .map((e, i) => ecriture({ id: `${l.id}-${i}`, ligne_bancaire_id: l.id, date, compte: e.compte, sens: e.sens, montant: e.montant }))

describe('agent-comptable / bloc VENTILATION (copie déployée)', () => {
  it('n’est pas la fonction de src/lib elle-même', () => {
    expect(deployee.ecritureDeLaVentilation).not.toBe(ecritureDeLaVentilation)
    expect(deployee.mouvementsVentilesDesynchronises).not.toBe(mouvementsVentilesDesynchronises)
  })

  it('compose la même écriture, ligne à ligne, dans les trois modèles', () => {
    const cas: [number, VentilationBancaire[]][] = [
      // Un paiement en partie personnel.
      [-120, [part('l', 'tel', -84), part('l', null, -36)]],
      // Une remise de carte et la commission que la banque en retient.
      [4950, [part('l', 'recettes', 5000), part('l', 'frais', -50)]],
      // Un encaissement dont une part est un apport de l'exploitant.
      [10500, [part('l', 'recettes', 10000), part('l', null, 500)]],
      // Des montants que les flottants représentent mal : l'écriture passe par les centimes.
      [-0.3, [part('l', 'tel', -0.1), part('l', 'frais', -0.2)]],
      [-1234.57, [part('l', 'tel', -0.07), part('l', 'frais', -0.14), part('l', null, -1234.36)]],
      // Une part inconnue, une part sortie des comptes de résultat : aucune écriture.
      [-120, [part('l', 'inconnue', -84), part('l', null, -36)]],
      [-120, [part('l', 'bilan', -84), part('l', null, -36)]],
      // Des parts de recette taxées — à 20 % et à 5,5 % —, une exonérée, et un taux posé sur une dépense, qui
      // ne s'applique pas.
      [4950, [part('l', 'recettes', 5000, 'l-r', 20), part('l', 'frais', -50)]],
      [1500, [part('l', 'recettes', 1200, 'l-r', 20), part('l', 'ventes', 300, 'l-v', 5.5)]],
      [4950, [part('l', 'recettes', 5000, 'l-r', 0), part('l', 'frais', -50)]],
      [-120, [part('l', 'tel', -84, 'l-t', 20), part('l', null, -36)]],
      // Le demi-centime de TVA monte : 0,03 € à 20 % en porte 0,005 €, rendu 0,01 €.
      [0.04, [part('l', 'recettes', 0.03, 'l-r', 20), part('l', 'frais', 0.01)]],
      // Une reprise : une part de recette négative garde son taux, en sens inverse.
      [-60, [part('l', 'recettes', -60, 'l-r', 20), part('l', null, 0)]],
    ]
    for (const assujetti of [false, true]) {
      for (const modele of MODELES) {
        for (const [montant, parts] of cas) {
          expect(deployee.ecritureDeLaVentilation({ montant }, parts, CATEGORIES, modele, assujetti), `${montant} / ${modele.mode} ${modele.compteNotesDeFrais} / assujetti ${assujetti}`)
            .toEqual(sansLibelle(ecritureDeLaVentilation(ligne({ montant }), parts, CATEGORIES, modele, assujetti)))
        }
      }
    }
    // La batterie exerce bien ce qui décide : la part personnelle suit le modèle, la commission se débite.
    const perso = (m: ModeleComptable) => sansLibelle(ecritureDeLaVentilation(ligne({}), cas[0][1], CATEGORIES, m, false))!.map((e) => e.compte)
    expect(perso(TRESORERIE)).toEqual(['626000', '108000', COMPTE_BANQUE])
    expect(perso(ENGAGEMENT_467)).toEqual(['626000', '467000', COMPTE_BANQUE])
    expect(sansLibelle(ecritureDeLaVentilation(ligne({ montant: 4950 }), cas[1][1], CATEGORIES, TRESORERIE, false)))
      .toEqual([{ compte: '706000', sens: 'credit', montant: 5000 }, { compte: '627000', sens: 'debit', montant: 50 }, { compte: COMPTE_BANQUE, sens: 'debit', montant: 4950 }])
    // Et la TVA : la recette taxée au hors taxe, le 445710 à côté — sur un dossier assujetti seulement.
    expect(sansLibelle(ecritureDeLaVentilation(ligne({ montant: 4950 }), cas[7][1], CATEGORIES, TRESORERIE, true)))
      .toEqual([
        { compte: '706000', sens: 'credit', montant: 4166.67 }, { compte: '445710', sens: 'credit', montant: 833.33 },
        { compte: '627000', sens: 'debit', montant: 50 }, { compte: COMPTE_BANQUE, sens: 'debit', montant: 4950 },
      ])
    expect(sansLibelle(ecritureDeLaVentilation(ligne({ montant: 0.04 }), cas[11][1], CATEGORIES, TRESORERIE, true))![1])
      .toEqual({ compte: '445710', sens: 'credit', montant: 0.01 })
  })

  // Les mouvements du relevé : des ventilations cohérentes et incohérentes, un mouvement ventilé mais pas
  // rapproché, un mouvement qui porte des parts sans être ventilé, et des mouvements qui n'ont rien à voir.
  const RELEVE: LigneBancaire[] = [
    ligne({ id: 'paiement' }),
    ligne({ id: 'remise', montant: 4950 }),
    ligne({ id: 'deux-recettes', montant: 900 }),
    ligne({ id: 'une-part', montant: -50 }),
    ligne({ id: 'somme-fausse', montant: -100 }),
    ligne({ id: 'non-ventile', ventilee: false, reglement_groupe: false, id_externe: null, statut: 'non_rapprochee', montant: -30 }),
    ligne({ id: 'pas-rapproche', statut: 'non_rapprochee', montant: -60 }),
    ligne({ id: 'affecte', ventilee: false, reglement_groupe: false, id_externe: null, categorie_id: 'frais', montant: -8.5 }),
  ]
  const PARTS: VentilationBancaire[] = [
    part('paiement', 'tel', -84), part('paiement', null, -36),
    part('remise', 'recettes', 5000), part('remise', 'frais', -50),
    part('deux-recettes', 'recettes', 600, 'r1'), part('deux-recettes', 'inconnue', 300, 'r2'),
    part('une-part', 'tel', -50),
    part('somme-fausse', 'tel', -60), part('somme-fausse', null, -30),
    part('non-ventile', 'tel', -30),
    part('pas-rapproche', 'recettes', -20), part('pas-rapproche', null, -40),
    // Une remise dont la part de recette porte son taux : elle n'est pas « sans taux ».
    part('remise-taxee', 'recettes', 5000, 'rt-r', 20), part('remise-taxee', 'frais', -50, 'rt-f'),
  ]
  const RELEVE_TAXE = [...RELEVE, ligne({ id: 'remise-taxee', montant: 4950 })]

  it('rend les mêmes parts de recettes SANS TAUX sur un dossier assujetti — et rien sur un dossier exonéré', () => {
    for (const assujetti of [true, false]) {
      const src = recettesVentileesSansTaux(partsDesVentilations(RELEVE_TAXE, PARTS, CATEGORIES, assujetti), assujetti)
      const dep = deployee.recettesVentileesSansTaux(deployee.partsDesVentilations(RELEVE_TAXE, PARTS, CATEGORIES, assujetti), assujetti)
      expect(ids(dep), `assujetti ${assujetti}`).toEqual(ids(src))
      // Les parts elles-mêmes, avec le taux qui s'applique : celui gardé sur un dossier assujetti, aucun ailleurs.
      expect(resumeParts(deployee.partsDesVentilations(RELEVE_TAXE, PARTS, CATEGORIES, assujetti)), `parts, assujetti ${assujetti}`)
        .toEqual(resumeParts(partsDesVentilations(RELEVE_TAXE, PARTS, CATEGORIES, assujetti)))
    }
    // Un mouvement par entrée ; pas celui qui n'est pas rapproché, pas une dépense, pas la remise taxée.
    expect(ids(recettesVentileesSansTaux(partsDesVentilations(RELEVE_TAXE, PARTS, CATEGORIES, true), true))).toEqual(['remise', 'deux-recettes'])
    expect(resumeParts(partsDesVentilations(RELEVE_TAXE, PARTS, CATEGORIES, true))).toContain('remise-taxee:recette:20')
    expect(resumeParts(partsDesVentilations(RELEVE_TAXE, PARTS, CATEGORIES, false))).toContain('remise-taxee:recette:null')
  })

  it('rend les mêmes ventilations incohérentes, avec leur raison', () => {
    const resume = (a: { ligne: { id: string }; raison: string }[]) => a.map((v) => `${v.ligne.id}:${v.raison}`)
    expect(resume(deployee.ventilationsIncoherentes(RELEVE, PARTS))).toEqual(resume(ventilationsIncoherentes(RELEVE, PARTS)))
    expect(resume(ventilationsIncoherentes(RELEVE, PARTS)))
      .toEqual(['une-part:moins_de_deux_parts', 'somme-fausse:somme_differente', 'non-ventile:parts_sans_ventilation'])
  })

  it('rend les mêmes mouvements dont l’écriture ne suit plus les parts, dans les trois modèles', () => {
    const lignes = [
      ligne({ id: 'juste' }),
      ligne({ id: 'absente' }),
      ligne({ id: 'autre-compte' }),
      ligne({ id: 'autre-montant' }),
      ligne({ id: 'autre-date' }),
      ligne({ id: 'hors-resultat' }),
      ligne({ id: 'categorie-non-lue' }),
      ligne({ id: 'incoherente' }),
      ligne({ id: 'pas-rapproche', statut: 'non_rapprochee' }),
    ]
    const partsDe = (id: string, categorieId = 'tel') => [part(id, categorieId, -84), part(id, null, -36)]
    const parts = [
      ...partsDe('juste'), ...partsDe('absente'), ...partsDe('autre-compte'), ...partsDe('autre-montant'), ...partsDe('autre-date'),
      ...partsDe('hors-resultat', 'bilan'), ...partsDe('categorie-non-lue', 'inconnue'), part('incoherente', 'tel', -120),
      ...partsDe('pas-rapproche'),
    ]
    for (const modele of MODELES) {
      const ecritures = [
        ...conforme(lignes[0], partsDe('juste'), modele),
        ...conforme(lignes[2], partsDe('autre-compte'), modele).map((e) => (e.compte === '626000' ? { ...e, compte: '626100' } : e)),
        ...conforme(lignes[3], partsDe('autre-montant'), modele).map((e) => (e.compte === '626000' ? { ...e, montant: 80 } : e)),
        ...conforme(lignes[4], partsDe('autre-date'), modele, '2025-04-02'),
        // Les écritures d'une PIÈCE qui désignent le même mouvement n'en sont pas.
        ecriture({ id: 'piece', piece_id: 'p1', ligne_bancaire_id: 'juste', compte: '606100', sens: 'debit', montant: 120 }),
      ]
      expect(ids(deployee.mouvementsVentilesDesynchronises(ecritures, lignes, parts, CATEGORIES, modele, false)), `${modele.mode} ${modele.compteNotesDeFrais}`)
        .toEqual(ids(mouvementsVentilesDesynchronises(ecritures, lignes, parts, CATEGORIES, modele, false, null)))
      expect(ids(mouvementsVentilesDesynchronises(ecritures, lignes, parts, CATEGORIES, modele, false, null)))
        .toEqual(['absente', 'autre-compte', 'autre-montant', 'autre-date', 'hors-resultat'])
    }
    // Et le modèle compte : l'écriture juste en trésorerie est périmée en engagement.
    const ecrituresTresorerie = conforme(lignes[0], partsDe('juste'), TRESORERIE)
    expect(ids(deployee.mouvementsVentilesDesynchronises(ecrituresTresorerie, [lignes[0]], partsDe('juste'), CATEGORIES, ENGAGEMENT_455, false))).toEqual(['juste'])
  })

  it('l’écriture attendue d’une part de recette taxée suit le statut ACTUEL du dossier', () => {
    const lignes = [ligne({ id: 'avec-tva', montant: 4950 }), ligne({ id: 'au-ttc', montant: 4950 })]
    const partsDe = (id: string) => [part(id, 'recettes', 5000, `${id}-r`, 20), part(id, 'frais', -50, `${id}-f`)]
    const parts = [...partsDe('avec-tva'), ...partsDe('au-ttc')]
    const ecritures = [
      ...conforme(lignes[0], partsDe('avec-tva'), TRESORERIE, lignes[0].date, true),
      ...conforme(lignes[1], partsDe('au-ttc'), TRESORERIE, lignes[1].date, false),
    ]
    for (const assujetti of [true, false]) {
      expect(ids(deployee.mouvementsVentilesDesynchronises(ecritures, lignes, parts, CATEGORIES, TRESORERIE, assujetti)), `assujetti ${assujetti}`)
        .toEqual(ids(mouvementsVentilesDesynchronises(ecritures, lignes, parts, CATEGORIES, TRESORERIE, assujetti, null)))
    }
    // Assujetti, l'écriture au TTC est périmée ; qui ne l'est plus, celle qui porte encore la TVA.
    expect(ids(mouvementsVentilesDesynchronises(ecritures, lignes, parts, CATEGORIES, TRESORERIE, true, null))).toEqual(['au-ttc'])
    expect(ids(mouvementsVentilesDesynchronises(ecritures, lignes, parts, CATEGORIES, TRESORERIE, false, null))).toEqual(['avec-tva'])
  })
})

describe('agent-comptable / points_a_traiter lit les parts des mouvements ventilés', () => {
  const source = sourceDeployee()
  const corps = source.slice(source.indexOf('if (nom === "points_a_traiter")'), source.indexOf('return { erreur: `Outil inconnu'))

  it('lit les parts — leur taux compris — et le drapeau du relevé entier, sous le même refus de lecture partielle', () => {
    expect(corps).toMatch(/from\("ventilations_bancaires"\)\.select\("ligne_bancaire_id, categorie_id, part_personnelle, montant, taux_tva", \{ count: "exact" \}\)\.eq\("dossier_id", dossierId\)\.order\("id"\)/)
    expect(corps).toMatch(/from\("lignes_bancaires"\)\.select\("id, date, montant, statut, [^"]*ventilee"[^)]*\)\.eq\("dossier_id", dossierId\)\.order\("id"\)/)
    expect(corps).toMatch(/rReleve, rParts, rReglements, rCotisations[^\]]*\]\s*\.filter\(\(r\) => !r\.complete\)/)
  })

  it('passe les parts aux catégories sans compte ou sans poste, et rend les trois points de la Checklist', () => {
    expect(corps).toContain('categoriesSansCompte(categoriesTyped, piecesTyped, [...rAffectes.lignes, ...rParts.lignes], pieceIdsImmobilisees)')
    expect(corps).toContain('categoriesSansPoste(categoriesTyped, piecesTyped, [...rAffectes.lignes, ...rParts.lignes], pieceIdsImmobilisees)')
    expect(corps).toContain('recettesVentileesSansTaux(\n      partsDesVentilations(rReleve.lignes, rParts.lignes, categoriesTyped, dossier.assujetti_tva), dossier.assujetti_tva)')
    expect(corps).toContain('ventilationsIncoherentes(rReleve.lignes, rParts.lignes)')
    expect(corps).toContain('mouvementsVentilesDesynchronises(ecrituresTyped, rReleve.lignes, rParts.lignes, categoriesTyped, modele, dossier.assujetti_tva)')
    expect(corps).toMatch(/mouvements_ventiles_dont_l_ecriture_ne_suit_plus_les_parts: ventilesPerimes\.length/)
    expect(corps).toMatch(/mouvements_ventiles_dont_les_parts_ne_font_plus_le_mouvement: ventilationsFausses\.length/)
    expect(corps).toMatch(/encaissements_affectes_ou_ventiles_en_recette_sans_taux_de_tva_sur_dossier_assujetti: recettesAffecteesSansTva\.length \+ recettesVentileesSansTva\.length/)
  })

  it('dit au modèle qu’une écriture de mouvement ventilé sans pièce n’est pas une anomalie, et que la part personnelle n’est ni charge ni recette', () => {
    expect(source).toMatch(/Un mouvement du relevé peut être VENTILÉ sur plusieurs comptes[^\n]*la part personnelle va au compte du dirigeant, ni charge ni recette[^\n]*Ce n'est pas une anomalie/)
  })
})

describe('le garde-fou du bloc VENTILATION sait encore échouer', () => {
  const planter = (...remplacements: [string, string][]) => {
    let source = sourceDeployee()
    for (const [avant, apres] of remplacements) {
      expect(source.split(avant).length - 1, `motif à planter introuvable ou ambigu : ${avant}`).toBe(1)
      source = source.replace(avant, apres)
    }
    return extraire(source)
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
  const PAIEMENT = [part('l', 'tel', -84), part('l', null, -36)]
  const REMISE = [part('l', 'recettes', 5000), part('l', 'frais', -50)]

  it('attrape une part personnelle qui ne suit plus le modèle', () => {
    const derivee = planter(['      compte = compteDuDirigeant(modele)\n    } else if (p.categorie_id) {', '      compte = COMPTE_EXPLOITANT\n    } else if (p.categorie_id) {'])
    echoue(() => expect(derivee.ecritureDeLaVentilation({ montant: -120 }, PAIEMENT, CATEGORIES, ENGAGEMENT_455, false))
      .toEqual(sansLibelle(ecritureDeLaVentilation(ligne({}), PAIEMENT, CATEGORIES, ENGAGEMENT_455, false))))
  })

  it('attrape des parts écrites dans le mauvais sens', () => {
    const derivee = planter(['    const sens = p.montant > 0 ? "credit" : "debit"', '    const sens = p.montant > 0 ? "debit" : "credit"'])
    echoue(() => expect(derivee.ecritureDeLaVentilation({ montant: 4950 }, REMISE, CATEGORIES, TRESORERIE, false))
      .toEqual(sansLibelle(ecritureDeLaVentilation(ligne({ montant: 4950 }), REMISE, CATEGORIES, TRESORERIE, false))))
  })

  it('attrape une banque écrite dans le mauvais sens', () => {
    const derivee = planter(['  lignes.push({ compte: COMPTE_BANQUE, sens: ligne.montant > 0 ? "debit" : "credit"', '  lignes.push({ compte: COMPTE_BANQUE, sens: ligne.montant > 0 ? "credit" : "debit"'])
    echoue(() => expect(derivee.ecritureDeLaVentilation({ montant: -120 }, PAIEMENT, CATEGORIES, TRESORERIE, false))
      .toEqual(sansLibelle(ecritureDeLaVentilation(ligne({}), PAIEMENT, CATEGORIES, TRESORERIE, false))))
  })

  // Sur l'écriture, la division par cent défait l'erreur du produit et rien ne se voit ; sur la SOMME des
  // parts, non : 7 + 14 + 123 436 centimes font 123 456,999… sans l'arrondi, et une ventilation juste
  // passerait pour incohérente — donc tue en silence le point « à réécrire » de ce mouvement.
  it('attrape des montants qui ne passent plus par les centimes', () => {
    const derivee = planter(['const centimesVentilation = (n: number) => Math.round(n * 100)', 'const centimesVentilation = (n: number) => n * 100'])
    const lignes = [ligne({ id: 'l', montant: -1234.57 })]
    const parts = [part('l', 'tel', -0.07), part('l', 'frais', -0.14), part('l', null, -1234.36)]
    expect(ventilationsIncoherentes(lignes, parts)).toEqual([])
    echoue(() => expect(derivee.ventilationsIncoherentes(lignes, parts)).toEqual([]))
  })

  it('attrape une catégorie hors résultat qui s’écrirait quand même', () => {
    const derivee = planter(['      compte = c && nature ? c.compte_comptable : null', '      compte = c ? c.compte_comptable : null'])
    const parts = [part('l', 'bilan', -84), part('l', null, -36)]
    echoue(() => expect(derivee.ecritureDeLaVentilation({ montant: -120 }, parts, CATEGORIES, TRESORERIE, false)).toBeNull())
  })

  it('attrape une incohérence qui ne voit plus les parts posées sur un mouvement non ventilé', () => {
    const derivee = planter(['    } else if (parts.length > 0) {\n      incoherentes.push({ ligne, raison: "parts_sans_ventilation" })', '    } else if (false) {\n      incoherentes.push({ ligne, raison: "parts_sans_ventilation" })'])
    const lignes = [ligne({ id: 'l', ventilee: false, reglement_groupe: false, id_externe: null, statut: 'non_rapprochee' })]
    echoue(() => expect(derivee.ventilationsIncoherentes(lignes, PAIEMENT).length).toBe(ventilationsIncoherentes(lignes, PAIEMENT).length))
  })

  it('attrape une somme comparée sans les centimes', () => {
    const derivee = planter(['      else if (parts.reduce((s, p) => s + centimesVentilation(p.montant), 0) !== centimesVentilation(ligne.montant)) {', '      else if (parts.reduce((s, p) => s + p.montant, 0) !== ligne.montant) {'])
    // 0,1 + 0,2 ne vaut pas 0,3 en flottants : une ventilation juste passerait pour incohérente.
    const lignes = [ligne({ id: 'l', montant: -0.3 })]
    const parts = [part('l', 'tel', -0.1), part('l', 'frais', -0.2)]
    echoue(() => expect(derivee.ventilationsIncoherentes(lignes, parts)).toEqual(ventilationsIncoherentes(lignes, parts)))
  })

  it('attrape un contrôle d’écriture qui juge aussi les ventilations incohérentes', () => {
    const derivee = planter(['    if (!ligne.ventilee || ligne.statut !== "rapprochee" || incoherentes.has(ligne.id)) return false', '    if (!ligne.ventilee || ligne.statut !== "rapprochee") return false'])
    const lignes = [ligne({ id: 'l' })]
    const parts = [part('l', 'tel', -120)]
    echoue(() => expect(ids(derivee.mouvementsVentilesDesynchronises([], lignes, parts, CATEGORIES, TRESORERIE, false))).toEqual([]))
  })

  it('attrape un contrôle d’écriture qui juge une catégorie qu’il n’a pas lue', () => {
    const derivee = planter(['    if (parts.some((p) => p.categorie_id && !connues.has(p.categorie_id))) return false\n    const attendue = ecritureDeLaVentilation', '    const attendue = ecritureDeLaVentilation'])
    const lignes = [ligne({ id: 'l' })]
    const parts = [part('l', 'inconnue', -84), part('l', null, -36)]
    echoue(() => expect(ids(derivee.mouvementsVentilesDesynchronises([], lignes, parts, CATEGORIES, TRESORERIE, false))).toEqual([]))
  })

  it('attrape des parts de recettes comptées sur un mouvement qui n’est pas rapproché', () => {
    const derivee = planter(['    if (ligne.statut !== "rapprochee" || !ligne.ventilee) continue\n    for (const part of parLigne.get(ligne.id) ?? []) {', '    if (!ligne.ventilee) continue\n    for (const part of parLigne.get(ligne.id) ?? []) {'])
    const lignes = [ligne({ id: 'l', statut: 'non_rapprochee', montant: 4950 })]
    echoue(() => expect(ids(derivee.recettesVentileesSansTaux(derivee.partsDesVentilations(lignes, REMISE, CATEGORIES, true), true))).toEqual([]))
  })

  it('attrape une dépense comptée parmi les recettes sans taux d’un dossier assujetti', () => {
    const derivee = planter(['  for (const p of parts) if (p.nature === "recette" && p.taux === null) parLigne.set(p.ligne.id, p.ligne)', '  for (const p of parts) if (p.taux === null) parLigne.set(p.ligne.id, p.ligne)'])
    const lignes = [ligne({ id: 'l' })]
    echoue(() => expect(ids(derivee.recettesVentileesSansTaux(derivee.partsDesVentilations(lignes, PAIEMENT, CATEGORIES, true), true))).toEqual([]))
  })

  // LE TAUX DE TVA D'UNE PART DE RECETTE (01/10/2026) : chaque morceau de la copie qui le porte.
  const REMISE_TAXEE = [part('l', 'recettes', 5000, 'l-r', 20), part('l', 'frais', -50)]

  it('attrape une copie qui n’écrit plus la TVA collectée d’une part de recette', () => {
    const derivee = planter(['    if (tva > 0) lignes.push({ compte: COMPTE_TVA_COLLECTEE, sens, montant: tva })\n', ''])
    echoue(() => expect(derivee.ecritureDeLaVentilation({ montant: 4950 }, REMISE_TAXEE, CATEGORIES, TRESORERIE, true))
      .toEqual(sansLibelle(ecritureDeLaVentilation(ligne({ montant: 4950 }), REMISE_TAXEE, CATEGORIES, TRESORERIE, true))))
  })

  it('attrape une copie qui écrit la part de recette au TTC à côté de sa TVA', () => {
    const derivee = planter(['    lignes.push({ compte, sens, montant: ht })', '    lignes.push({ compte, sens, montant: ht + tva })'])
    echoue(() => expect(derivee.ecritureDeLaVentilation({ montant: 4950 }, REMISE_TAXEE, CATEGORIES, TRESORERIE, true))
      .toEqual(sansLibelle(ecritureDeLaVentilation(ligne({ montant: 4950 }), REMISE_TAXEE, CATEGORIES, TRESORERIE, true))))
  })

  it('attrape une copie qui applique le taux d’une part sans regarder le statut du dossier', () => {
    const derivee = planter(['      resultat.push({ ligne, nature, taux: tauxApplicable(assujettiTva, nature, part.taux_tva) })', '      resultat.push({ ligne, nature, taux: part.taux_tva })'])
    const lignes = [ligne({ id: 'l', montant: 4950 })]
    echoue(() => expect(resumeParts(derivee.partsDesVentilations(lignes, REMISE_TAXEE, CATEGORIES, false)))
      .toEqual(resumeParts(partsDesVentilations(lignes, REMISE_TAXEE, CATEGORIES, false))))
  })

  it('attrape une copie qui compte une part de recette taxée parmi les recettes sans taux', () => {
    const derivee = planter(['  for (const p of parts) if (p.nature === "recette" && p.taux === null) parLigne.set(p.ligne.id, p.ligne)', '  for (const p of parts) if (p.nature === "recette") parLigne.set(p.ligne.id, p.ligne)'])
    const lignes = [ligne({ id: 'l', montant: 4950 })]
    echoue(() => expect(ids(derivee.recettesVentileesSansTaux(derivee.partsDesVentilations(lignes, REMISE_TAXEE, CATEGORIES, true), true))).toEqual([]))
  })

  it('attrape une copie dont l’écriture attendue ignore le statut du dossier', () => {
    const derivee = planter(['    const attendue = ecritureDeLaVentilation(ligne, parts, categories, modele, assujettiTva)', '    const attendue = ecritureDeLaVentilation(ligne, parts, categories, modele, false)'])
    const lignes = [ligne({ id: 'l', montant: 4950 })]
    const ecritures = conforme(lignes[0], REMISE_TAXEE, TRESORERIE, lignes[0].date, true)
    echoue(() => expect(ids(derivee.mouvementsVentilesDesynchronises(ecritures, lignes, REMISE_TAXEE, CATEGORIES, TRESORERIE, true))).toEqual([]))
  })
})
