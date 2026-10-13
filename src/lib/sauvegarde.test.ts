import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  clePrimaire,
  comptesRequis,
  estLignePartagee,
  identiteRestauree,
  noteBlanche,
  parentsHorsPlan,
  liensPerdus,
  ordreSuppression,
  planExportDossier,
  planReinsertion,
  referencesExternes,
  sansAnciennesNotes,
  sansColonnesGenerees,
  tablesSansChemin,
  violationsOrdre,
  ANCIENNES_COLONNES_DES_NOTES,
  CHEMINS_DOSSIER,
  COLONNES_GENEREES,
  LIENS_GARDES,
  ORDRE_RESTAURATION,
  ORDRE_RESTAURATION_PREVU,
  PARENTS_HORS_PLAN_VOULUS,
  PREREQUIS_AUTH,
  RELATIONS,
  TABLES_AUTO_REFERENCEES,
  TABLES_AUTO_REFERENCEES_PAR_VAGUES,
  TOUS_LES_LIENS,
  vaguesParLien,
  type Relation,
} from './sauvegarde'
import { derniereDefinitionSql } from '../test/schema'

// Ces tests sont la RÉPÉTITION de la restauration. Une sauvegarde jamais restaurée n'est pas une
// sauvegarde, et un essai annuel ne prouve rien du mois suivant : la seule répétition qui tienne est
// celle qui rejoue à chaque exécution de la suite.

describe('ordre de restauration', () => {
  it('place chaque table parente avant ses enfants', () => {
    // Le contrôle qui compte. Il rejoue le graphe complet du schéma contre la liste figée : le jour
    // où une relation est ajoutée sans reclasser la liste, ce test tombe ici plutôt que la nuit où on
    // restaure vraiment.
    expect(violationsOrdre(ORDRE_RESTAURATION)).toEqual([])
  })

  it('couvre toutes les tables citées par une relation', () => {
    // Une table oubliée de l'ordre ne serait jamais réinsérée — et sa disparition ne se verrait qu'à
    // l'usage, sur un écran vide.
    const citees = new Set(RELATIONS.flatMap((r) => [r.enfant, r.parent]))
    const manquantes = [...citees].filter((t) => !ORDRE_RESTAURATION.includes(t))
    expect(manquantes).toEqual([])
  })

  it('ne cite aucune table deux fois', () => {
    // Un doublon réinsérerait les mêmes lignes, et ferait échouer la seconde passe sur la clé primaire.
    expect(ORDRE_RESTAURATION.length).toBe(new Set(ORDRE_RESTAURATION).size)
  })

  it('réinsère le plan comptable d’un dossier juste après lui, avant tout ce qui porte un compte', () => {
    // Sa garde n'admet la restauration que dans un dossier qui n'a encore ni écriture, ni à-nouveau, ni solde reporté
    // (ligne 43, PC1) : réinséré après l'un d'eux, il serait refusé. Le catalogue des rôles le précède.
    const rang = (table: string) => ORDRE_RESTAURATION.indexOf(table)
    expect(rang('plan_comptable_dossier')).toBe(rang('dossiers') + 1)
    for (const apres of ['a_nouveaux', 'soldes_reportes', 'ecritures_brouillon']) {
      expect(rang(apres), apres).toBeGreaterThan(rang('plan_comptable_dossier'))
    }
    expect(rang('roles_comptables')).toBeGreaterThanOrEqual(0)
    expect(rang('roles_comptables')).toBeLessThan(rang('plan_comptable_dossier'))
  })

  it('restaure les exercices validés en dernier', () => {
    // Réinsérée, une validation fige son exercice : la base refuse ensuite d'y poser une source ou une
    // écriture, et le super-administrateur n'y réinsère plus d'écriture validée. Le tri ne la mettrait pas
    // là, son seul parent étant le dossier : c'est ce test qui l'y garde.
    expect(ORDRE_RESTAURATION[ORDRE_RESTAURATION.length - 1]).toBe('exercices_valides')
  })

  it('signale un parent placé après son enfant', () => {
    // La preuve que le contrôle ci-dessus détecte quelque chose : un ordre délibérément faux.
    const faux = ['pieces', 'dossiers']
    const relations: Relation[] = [
      { enfant: 'pieces', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
    ]
    expect(violationsOrdre(faux, relations)).toEqual([
      { enfant: 'pieces', parent: 'dossiers', motif: 'parent_apres_enfant' },
    ])
  })

  it('signale une table absente de l’ordre', () => {
    const relations: Relation[] = [
      { enfant: 'pieces', parent: 'dossiers', colonne: 'dossier_id', aLaSuppression: 'cascade' },
    ]
    expect(violationsOrdre(['dossiers'], relations)).toEqual([
      { enfant: 'pieces', parent: 'dossiers', motif: 'table_absente_de_lordre' },
    ])
  })

  it('n’exige rien d’impossible d’une table qui se référence elle-même', () => {
    // `factures_emises.facture_origine_id` pointe une autre facture : aucun ordre de tables ne peut
    // satisfaire ça, puisque la table ne peut pas se précéder elle-même. Compter cette relation comme
    // une violation rendrait le contrôle rouge en permanence, donc inutile — et un contrôle qu'on
    // apprend à ignorer ne protège plus de rien.
    const relations: Relation[] = [
      { enfant: 'factures_emises', parent: 'factures_emises', colonne: 'facture_origine_id', aLaSuppression: 'bloque' },
    ]
    expect(violationsOrdre(['factures_emises'], relations)).toEqual([])
  })

  it('garde trace des tables qui exigent une restauration en deux passes', () => {
    // La conséquence pratique de l'auto-référence : ces tables-là s'insèrent avec la colonne à NULL,
    // puis se complètent. L'oublier produit un échec de clé étrangère au milieu d'une restauration.
    expect(TABLES_AUTO_REFERENCEES).toEqual([{ table: 'factures_emises', colonne: 'facture_origine_id' }])
    for (const { table, colonne } of TABLES_AUTO_REFERENCEES) {
      expect(RELATIONS).toContainEqual(expect.objectContaining({ enfant: table, parent: table, colonne }))
    }
  })

  it('restaure chaque auto-référence du graphe d’une façon déclarée, et d’une seule', () => {
    // `violationsOrdre` ignore les auto-références : aucun ordre de tables ne les satisfait. Celle qu'aucune des deux
    // listes ne déclarerait partirait comme une table ordinaire — et un encaissement qui en annule un autre
    // échouerait au hasard de l'ordre des lignes dans un lot, la nuit où l'on restaure.
    const auto = RELATIONS.filter((r) => r.enfant === r.parent).map((r) => `${r.enfant}.${r.colonne}`).sort()
    const enDeuxPasses = TABLES_AUTO_REFERENCEES.map((a) => `${a.table}.${a.colonne}`)
    const parVagues = TABLES_AUTO_REFERENCEES_PAR_VAGUES.map((a) => `${a.table}.${a.colonne}`)
    expect([...enDeuxPasses, ...parVagues].sort()).toEqual(auto)
    expect(parVagues).toEqual([
      'encaissements_factures.annule_id', 'revision_justifications.remplace_id', 'revision_justifications.reprise_de',
      'pieces_hors_de_france.remplace_id', 'revision_conclusions.remplace_id', 'revision_seuils.remplace_id',
      'revision_explications.remplace_id', 'declarations_ereporting.remplace_id', 'dossier_permanent.remplace_id',
    ])
  })

  it('écrit la fiche « hors de France » après sa pièce, et avant le brouillon dont la validation la figerait', () => {
    // Une dépendance qu'aucune clé étrangère ne porte (ligne 28.5, étape e2) : la garde de la fiche refuse une version sur
    // une pièce qu'une écriture VALIDÉE fige, et la lit dans `ecritures_brouillon`. Réinsérée après le brouillon, la fiche
    // d'une pièce d'un exercice validé ne repasserait pas ; avant, elle passe telle qu'elle a été écrite.
    const rang = (t: string) => ORDRE_RESTAURATION.indexOf(t)
    expect(rang('pieces')).toBeLessThan(rang('pieces_hors_de_france'))
    expect(rang('pieces_hors_de_france')).toBeLessThan(rang('pieces_hors_de_france_taux'))
    expect(rang('pieces_hors_de_france_taux')).toBeLessThan(rang('ecritures_brouillon'))
    expect(RELATIONS.filter((r) => r.enfant.startsWith('pieces_hors_de_france')).map((r) => `${r.enfant}.${r.colonne}>${r.parent}:${r.aLaSuppression}`).sort())
      .toEqual([
        'pieces_hors_de_france.dossier_id>dossiers:cascade',
        'pieces_hors_de_france.piece_id>pieces:cascade',
        'pieces_hors_de_france.remplace_id>pieces_hors_de_france:bloque',
        'pieces_hors_de_france_taux.dossier_id>dossiers:cascade',
        'pieces_hors_de_france_taux.fiche_id>pieces_hors_de_france:cascade',
      ])
  })

  it('écrit les preuves de la révision après les pièces, les documents et les décisions', () => {
    // Deux dépendances qu'aucune clé étrangère ne porte (ligne 41, étape R1) : la garde d'une preuve exige que la pièce ou
    // le document cité existe dans son dossier, et le lit sans clé (hypothèse Q8). `violationsOrdre` les compte, par
    // `LIENS_GARDES` ; ce test les nomme, pour qu'un reclassement de la liste se lise.
    const rang = (t: string) => ORDRE_RESTAURATION.indexOf(t)
    for (const lue of ['pieces', 'documents_divers', 'revision_justifications']) {
      expect(rang(lue), lue).toBeGreaterThanOrEqual(0)
      expect(rang(lue), lue).toBeLessThan(rang('revision_preuves'))
    }
    expect(violationsOrdre(ORDRE_RESTAURATION, LIENS_GARDES)).toEqual([])
    expect(RELATIONS.filter((r) => r.enfant === 'revision_justifications' || r.enfant === 'revision_preuves')
      .map((r) => `${r.enfant}.${r.colonne}>${r.parent}:${r.aLaSuppression}`).sort())
      .toEqual([
        'revision_justifications.dossier_id>dossiers:cascade',
        'revision_justifications.remplace_id>revision_justifications:bloque',
        'revision_justifications.reprise_de>revision_justifications:bloque',
        'revision_preuves.dossier_id>dossiers:cascade',
        'revision_preuves.justification_id>revision_justifications:cascade',
      ])
  })

  it('écrit les cycles de la révision après ses soldes, et la revue après la conclusion qu’elle revoit (étape R4)', () => {
    // Trois tables qui ne lisent rien qu'une validation fige : elles suivent les décisions, avant `exercices_valides`.
    // La revue pointe sa conclusion par une clé sans action ; la conclusion pointe celle qu'elle remplace (par vagues).
    const rang = (t: string) => ORDRE_RESTAURATION.indexOf(t)
    for (const t of ['revision_conclusions', 'revision_notes', 'revision_revues']) {
      expect(rang(t), t).toBeGreaterThan(rang('revision_preuves'))
      expect(rang(t), t).toBeLessThan(rang('exercices_valides'))
    }
    expect(rang('revision_conclusions')).toBeLessThan(rang('revision_revues'))
    expect(RELATIONS.filter((r) => ['revision_conclusions', 'revision_notes', 'revision_revues'].includes(r.enfant))
      .map((r) => `${r.enfant}.${r.colonne}>${r.parent}:${r.aLaSuppression}`).sort())
      .toEqual([
        'revision_conclusions.dossier_id>dossiers:cascade',
        'revision_conclusions.remplace_id>revision_conclusions:bloque',
        'revision_notes.dossier_id>dossiers:cascade',
        'revision_revues.conclusion_id>revision_conclusions:bloque',
        'revision_revues.dossier_id>dossiers:cascade',
      ])
  })

  it('écrit la revue analytique après les cycles de la révision, avant les registres de P7 (étape R5)', () => {
    // Deux tables qui ne lisent, à l'insertion, que la ligne qu'elles remplacent : rien de ce qu'une validation fige, rien
    // du brouillon. Elles suivent les cycles, avant `exercices_valides` ; chacune pointe sa cible par une clé sans action.
    const rang = (t: string) => ORDRE_RESTAURATION.indexOf(t)
    expect(ORDRE_RESTAURATION.slice(rang('revision_revues'), rang('justificatifs_proposes') + 1))
      .toEqual(['revision_revues', 'revision_seuils', 'revision_explications', 'justificatifs_proposes'])
    expect(rang('revision_explications')).toBeLessThan(rang('exercices_valides'))
    expect(RELATIONS.filter((r) => ['revision_seuils', 'revision_explications'].includes(r.enfant))
      .map((r) => `${r.enfant}.${r.colonne}>${r.parent}:${r.aLaSuppression}`).sort())
      .toEqual([
        'revision_explications.dossier_id>dossiers:cascade',
        'revision_explications.remplace_id>revision_explications:bloque',
        'revision_seuils.dossier_id>dossiers:cascade',
        'revision_seuils.remplace_id>revision_seuils:bloque',
      ])
    expect(CHEMINS_DOSSIER.revision_seuils).toEqual({ acces: 'direct' })
    expect(CHEMINS_DOSSIER.revision_explications).toEqual({ acces: 'direct' })
  })

  it('écrit les déclarations d’e-reporting après le régime, par vagues, et leurs sources après elles (étape e5b1)', () => {
    // La garde d'une déclaration lit, à l'insertion, son régime (une clé sans action), la déclaration qu'elle remplace —
    // déjà « remplacée » dans la sauvegarde, d'où les vagues — et les autres déclarations actives ; celle d'une source ne
    // lit que sa déclaration. Rien de ce qu'une validation fige : elles précèdent `exercices_valides`.
    const rang = (t: string) => ORDRE_RESTAURATION.indexOf(t)
    expect(ORDRE_RESTAURATION.slice(rang('regimes_ereporting'), rang('declarations_ereporting_sources') + 1))
      .toEqual(['regimes_ereporting', 'pieces_ecartees_ereporting', 'declarations_ereporting', 'declarations_ereporting_sources'])
    expect(rang('declarations_ereporting_sources')).toBeLessThan(rang('exercices_valides'))
    expect(TABLES_AUTO_REFERENCEES_PAR_VAGUES).toContainEqual({ table: 'declarations_ereporting', colonne: 'remplace_id' })
    expect(RELATIONS.filter((r) => r.enfant.startsWith('declarations_ereporting'))
      .map((r) => `${r.enfant}.${r.colonne}>${r.parent}:${r.aLaSuppression}`).sort())
      .toEqual([
        'declarations_ereporting.dossier_id>dossiers:cascade',
        'declarations_ereporting.regime_id>regimes_ereporting:bloque',
        'declarations_ereporting.remplace_id>declarations_ereporting:bloque',
        'declarations_ereporting_sources.declaration_id>declarations_ereporting:cascade',
        'declarations_ereporting_sources.dossier_id>dossiers:cascade',
      ])
    // Une source désigne sa fiche, sa facture ou son encaissement sans clé, et rien ne la vérifie à la restauration.
    expect(LIENS_GARDES.filter((l) => l.enfant.startsWith('declarations_ereporting'))).toEqual([])
    expect(CHEMINS_DOSSIER.declarations_ereporting).toEqual({ acces: 'direct' })
    expect(CHEMINS_DOSSIER.declarations_ereporting_sources).toEqual({ acces: 'direct' })
    expect(clePrimaire('declarations_ereporting_sources')).toEqual(['declaration_id', 'genre', 'source_id'])
  })

  it('réinsère une chaîne de déclarations d’e-reporting maillon après maillon', () => {
    // L'initiale d'abord, puis chaque rectificative dans la vague qui suit l'écriture de la déclaration qu'elle remplace :
    // dans un même lot, Postgres ne promet pas l'ordre des lignes, et la garde de la rectificative lit sa cible.
    const ligne = (id: string, remplace: string | null) => ({ id, dossier_id: 'd', remplace_id: remplace })
    const plan = planReinsertion({
      declarations_ereporting: [ligne('re2', 're1'), ligne('in', null), ligne('re1', 'in'), ligne('autre', null)],
    })
    expect(plan.etapes.filter((e) => e.table === 'declarations_ereporting').map((e) => e.lignes.map((l) => l.id)))
      .toEqual([['in', 'autre'], ['re1'], ['re2']])
    expect(plan.secondePasse).toEqual([])
  })

  it('écrit le dossier permanent après les pièces et les documents qu’il cite, par vagues (étape R7)', () => {
    // La garde d'une entrée lit, à l'insertion, la version qu'elle remplace (`remplace_id`, par vagues) et la pièce ou le
    // document qu'elle cite, sans clé (`LIENS_GARDES`). Rien de ce qu'une validation fige : elle précède les devis et
    // `exercices_valides`, et ne déplace le rang d'aucune autre table d'hier.
    const rang = (t: string) => ORDRE_RESTAURATION.indexOf(t)
    for (const lue of ['pieces', 'documents_divers']) expect(rang(lue), lue).toBeLessThan(rang('dossier_permanent'))
    expect(ORDRE_RESTAURATION[rang('dossier_permanent') - 1]).toBe('declarations_ereporting_sources')
    expect(rang('dossier_permanent')).toBeLessThan(rang('exercices_valides'))
    // Suivi, depuis la ligne 22.7, des pièces jointes écartées, puis des devis (le test qui suit).
    expect(ORDRE_RESTAURATION_PREVU[ORDRE_RESTAURATION_PREVU.indexOf('dossier_permanent') + 1]).toBe('pieces_jointes_ecartees')
    expect(violationsOrdre(ORDRE_RESTAURATION, TOUS_LES_LIENS)).toEqual([])
    expect(RELATIONS.filter((r) => r.enfant === 'dossier_permanent')
      .map((r) => `${r.enfant}.${r.colonne}>${r.parent}:${r.aLaSuppression}`).sort())
      .toEqual([
        'dossier_permanent.dossier_id>dossiers:cascade',
        'dossier_permanent.remplace_id>dossier_permanent:bloque',
      ])
    expect(LIENS_GARDES.filter((l) => l.enfant === 'dossier_permanent').map((l) => `${l.colonne}>${l.parent}:${l.aLaSuppression}`))
      .toEqual(['document_id>documents_divers:bloque', 'piece_id>pieces:bloque'])
    expect(TABLES_AUTO_REFERENCEES_PAR_VAGUES).toContainEqual({ table: 'dossier_permanent', colonne: 'remplace_id' })
    expect(CHEMINS_DOSSIER.dossier_permanent).toEqual({ acces: 'direct' })
    expect(clePrimaire('dossier_permanent')).toEqual(['id'])
  })

  it('écrit les pièces jointes écartées après leur dossier, avant les devis et `exercices_valides` (ligne 22.7)', () => {
    // Leur seul parent est le dossier ; aucune garde ne les lit à l'insertion, aucune validation ne les fige. Après le
    // dossier permanent et avant la série des devis : elles ne déplacent le rang d'aucune autre table d'hier.
    const rang = (t: string) => ORDRE_RESTAURATION.indexOf(t)
    expect(ORDRE_RESTAURATION[rang('pieces_jointes_ecartees') - 1]).toBe('dossier_permanent')
    expect(rang('pieces_jointes_ecartees')).toBeLessThan(rang('exercices_valides'))
    expect(ORDRE_RESTAURATION_PREVU[ORDRE_RESTAURATION_PREVU.indexOf('pieces_jointes_ecartees') + 1]).toBe('devis_numerotation')
    expect(violationsOrdre(ORDRE_RESTAURATION, TOUS_LES_LIENS)).toEqual([])
    expect(RELATIONS.filter((r) => r.enfant === 'pieces_jointes_ecartees')
      .map((r) => `${r.enfant}.${r.colonne}>${r.parent}:${r.aLaSuppression}`))
      .toEqual(['pieces_jointes_ecartees.dossier_id>dossiers:cascade'])
    expect(LIENS_GARDES.filter((l) => l.enfant === 'pieces_jointes_ecartees')).toEqual([])
    expect(TABLES_AUTO_REFERENCEES_PAR_VAGUES.filter((t) => t.table === 'pieces_jointes_ecartees')).toEqual([])
    expect(CHEMINS_DOSSIER.pieces_jointes_ecartees).toEqual({ acces: 'direct' })
    expect(clePrimaire('pieces_jointes_ecartees')).toEqual(['id'])
    // Une ligne déjà vue se réinsère telle quelle, en une étape : rien ne la relie à une autre ligne de la table.
    const plan = planReinsertion({
      dossiers: [{ id: 'd' }],
      pieces_jointes_ecartees: [
        { id: 'a', dossier_id: 'd', raison: 'format', octets: 12, empreinte: 'e'.repeat(64), vue_le: null, vue_par: null },
        { id: 'b', dossier_id: 'd', raison: 'taille', octets: 30_000_000, empreinte: 'f'.repeat(64), vue_le: '2026-10-13T08:00:00+00:00', vue_par: 'u' },
      ],
    })
    expect(plan.etapes.filter((e) => e.table === 'pieces_jointes_ecartees').map((e) => e.lignes.map((l) => l.id))).toEqual([['a', 'b']])
    expect(plan.secondePasse).toEqual([])
  })

  it('réinsère les versions d’une entrée du dossier permanent maillon après maillon, retirée comprise', () => {
    // La première version d'abord, puis chaque suivante dans la vague qui suit l'écriture de celle qu'elle remplace ; une
    // entrée retirée n'a pas de suite et part avec la vague de sa chaîne, telle qu'elle a été retirée.
    const ligne = (id: string, remplace: string | null, retire_le: string | null = null) =>
      ({ id, dossier_id: 'd', remplace_id: remplace, retire_le })
    const plan = planReinsertion({
      dossier_permanent: [ligne('v3', 'v2', '2026-10-01T10:00:00+00:00'), ligne('v1', null), ligne('v2', 'v1'), ligne('seule', null)],
    })
    expect(plan.etapes.filter((e) => e.table === 'dossier_permanent').map((e) => e.lignes.map((l) => l.id)))
      .toEqual([['v1', 'seule'], ['v2'], ['v3']])
    expect(plan.secondePasse).toEqual([])
  })

  it('attrape une source citée par le dossier permanent, absente de la sauvegarde, que rien ne permet d’effacer', () => {
    // Une entrée ne se modifie pas, et celle qui ne dit rien d'autre que sa citation ne dirait plus rien : le lien perdu
    // ne se sacrifie pas. Une entrée sans citation ne réclame rien.
    const perdus = liensPerdus({
      dossiers: [{ id: 'd1' }],
      pieces: [{ id: 'p1', dossier_id: 'd1' }],
      documents_divers: [],
      dossier_permanent: [
        { id: 'e1', dossier_id: 'd1', remplace_id: null, piece_id: 'p1', document_id: null, fichier_id: null },
        { id: 'e2', dossier_id: 'd1', remplace_id: 'e1', piece_id: null, document_id: 'doc-disparu', fichier_id: null },
        { id: 'e3', dossier_id: 'd1', remplace_id: null, piece_id: null, document_id: null, fichier_id: null },
      ],
    })
    expect(perdus).toEqual([
      { table: 'dossier_permanent', colonne: 'document_id', parent: 'documents_divers', valeur: 'doc-disparu', effacable: false },
    ])
  })

  it('signale une preuve placée avant la pièce qu’elle cite, que le graphe des clés ne voit pas', () => {
    // Un ordre partiel : les tables qu'il ne cite pas y sont absentes, et seul compte ici ce qui est mal placé.
    const faux = ['dossiers', 'revision_justifications', 'revision_preuves', 'pieces', 'documents_divers']
    const malPlaces = (relations?: readonly Relation[]) =>
      violationsOrdre(faux, relations).filter((v) => v.motif === 'parent_apres_enfant')
    expect(malPlaces()).toEqual([
      { enfant: 'revision_preuves', parent: 'documents_divers', motif: 'parent_apres_enfant' },
      { enfant: 'revision_preuves', parent: 'pieces', motif: 'parent_apres_enfant' },
    ])
    // Le graphe des seules clés étrangères ne l'aurait pas dit.
    expect(malPlaces(RELATIONS)).toEqual([])
  })

  it('écrit la répartition d’un encaissement après les lignes de facture dont son déclencheur lit les taux', () => {
    // Une dépendance qu'aucune clé étrangère ne porte, donc que `violationsOrdre` ne voit pas : le déclencheur de
    // `encaissements_factures_taux` refuse une part dont le taux n'est sur aucune ligne de la facture.
    const rang = (t: string) => ORDRE_RESTAURATION.indexOf(t)
    expect(rang('facture_lignes')).toBeGreaterThanOrEqual(0)
    expect(rang('facture_lignes')).toBeLessThan(rang('encaissements_factures_taux'))
    expect(rang('encaissements_factures')).toBeLessThan(rang('encaissements_factures_taux'))
  })

  it('écrit les déclarations d’un encaissement après les transmissions et l’historique de Super PDP que leur garde lit', () => {
    // Deux dépendances qu'aucune clé étrangère ne porte (étape d4) : la garde de `transmissions_encaissements` refuse
    // une déclaration qui n'est pas faite sur la plateforme qui a reçu la facture, ou d'une facture que cette plateforme
    // n'a pas acceptée (le statut 200 de Super PDP compris) — et elle le lit dans ces deux tables. Réinsérée avant
    // elles, une déclaration du registre ferait échouer la restauration.
    const rang = (t: string) => ORDRE_RESTAURATION.indexOf(t)
    for (const lue of ['transmissions_factures', 'facture_superpdp_events', 'encaissements_factures']) {
      expect(rang(lue), lue).toBeGreaterThanOrEqual(0)
      expect(rang(lue), lue).toBeLessThan(rang('transmissions_encaissements'))
    }
    // Ni auto-référence, ni vagues : la déclaration d'une contre-passation ne lit pas celle de son encaissement.
    expect(RELATIONS.filter((r) => r.enfant === 'transmissions_encaissements').map((r) => `${r.parent}:${r.aLaSuppression}`).sort())
      .toEqual(['dossiers:cascade', 'encaissements_factures:bloque', 'factures_emises:bloque'])
  })

  it('écrit les statuts lus sur la plateforme du client avant les transmissions et les déclarations que leurs gardes refusent', () => {
    // Deux dépendances qu'aucune clé étrangère ne porte (étape d7) : les gardes de `transmissions_factures` et de
    // `transmissions_encaissements` lisent les statuts 210 et 213 de `statuts_factures_recus`. Réinsérés après elles, les
    // statuts ne seraient jugés par personne ; réinsérés avant, ils laissent passer ce qui les précédait (la règle de
    // date, `lu_le`) et refusent ce qui n'aurait pas pu naître après eux.
    const rang = (t: string) => ORDRE_RESTAURATION.indexOf(t)
    expect(rang('statuts_factures_recus')).toBeGreaterThan(rang('factures_emises'))
    for (const gardee of ['transmissions_factures', 'transmissions_encaissements']) {
      expect(rang('statuts_factures_recus'), gardee).toBeLessThan(rang(gardee))
    }
    // Le dossier l'emporte ; une facture validée ne le fait pas disparaître sous elle.
    expect(RELATIONS.filter((r) => r.enfant === 'statuts_factures_recus').map((r) => `${r.parent}:${r.aLaSuppression}`).sort())
      .toEqual(['dossiers:cascade', 'factures_emises:bloque'])
  })

  it('rend l’ordre de suppression exactement inverse', () => {
    const suppression = ordreSuppression()
    expect(suppression[0]).toBe(ORDRE_RESTAURATION[ORDRE_RESTAURATION.length - 1])
    expect(suppression[suppression.length - 1]).toBe(ORDRE_RESTAURATION[0])
    expect([...suppression].reverse()).toEqual([...ORDRE_RESTAURATION])
  })

  it('ne modifie pas la liste d’origine en la retournant', () => {
    // `reverse()` opère en place : appelé sans copie sur la constante exportée, il retournerait
    // l'ordre de restauration lui-même pour tout le reste de l'exécution.
    const avant = [...ORDRE_RESTAURATION]
    ordreSuppression()
    ordreSuppression()
    expect([...ORDRE_RESTAURATION]).toEqual(avant)
  })
})

describe('chemins d’accès aux lignes d’un dossier', () => {
  it('déclare un chemin pour chaque table de l’ordre de restauration', () => {
    // Le garde-fou qui compte : une table ajoutée au schéma sans chemin déclaré sortirait de tout
    // export sans un mot, et sa disparition ne se verrait qu'à la restauration, sur un écran vide.
    expect(tablesSansChemin()).toEqual([])
  })

  it('lit toujours une table indirecte après le parent dont elle dépend', () => {
    // `facture_lignes` se lit par les identifiants de `factures_emises`. Inversée, la lecture se
    // ferait avec une liste vide : zéro ligne, aucune erreur, toutes les lignes de facture perdues.
    const chemins = {
      facture_lignes: { acces: 'par_parent', parent: 'factures_emises', colonne: 'facture_id' },
      factures_emises: { acces: 'direct' },
    } as const
    expect(tablesSansChemin(['facture_lignes', 'factures_emises'], chemins)).toEqual([
      { table: 'facture_lignes', motif: 'parent_lu_trop_tard' },
    ])
    expect(tablesSansChemin(['factures_emises', 'facture_lignes'], chemins)).toEqual([])
  })

  it('signale une table sans chemin déclaré', () => {
    expect(tablesSansChemin(['pieces'], {})).toEqual([{ table: 'pieces', motif: 'chemin_non_declare' }])
  })

  it('n’oublie pas les deux tables qui n’ont pas de dossier_id', () => {
    // Le piège central de cet export : trente-deux tables portent `dossier_id`, deux non. Les traiter
    // comme les autres rendrait zéro ligne pour elles — toutes les lignes de facture et tous les
    // mouvements de compte courant, perdus en silence.
    expect(CHEMINS_DOSSIER.facture_lignes).toEqual({ acces: 'par_parent', parent: 'factures_emises', colonne: 'facture_id' })
    expect(CHEMINS_DOSSIER.mouvements_cca).toEqual({ acces: 'par_parent', parent: 'comptes_courants_associes', colonne: 'compte_id' })
  })

  it('exclut du plan les référentiels qui n’appartiennent à aucun dossier', () => {
    // Embarquer les taux de change dans l'export d'un client laisserait croire, à la restauration,
    // qu'on rétablit ce client — alors qu'on écraserait un référentiel partagé par tous les dossiers.
    const plan = planExportDossier()
    expect(plan.map((e) => e.table)).not.toContain('taux_change_bce')
    expect(plan.map((e) => e.table)).not.toContain('cabinets')
    expect(plan.map((e) => e.table)).not.toContain('super_admins')
    // Le catalogue des rôles comptables non plus (ligne 43, PC1) : le restaurer avec un client réécrirait les défauts
    // de l'application pour tous les dossiers. Le plan du dossier, lui, en est.
    expect(plan.map((e) => e.table)).not.toContain('roles_comptables')
    expect(plan.map((e) => e.table)).toContain('plan_comptable_dossier')
  })

  it('garde le dossier lui-même dans le plan', () => {
    // `dossiers` est de niveau cabinet, mais c'est la ligne qu'on restaure : l'exclure rendrait
    // l'export inutilisable, puisque tout le reste y pend.
    expect(planExportDossier().map((e) => e.table)).toContain('dossiers')
  })

  it('ordonne le plan comme la restauration', () => {
    const plan = planExportDossier().map((e) => e.table)
    const attendu = ORDRE_RESTAURATION.filter(
      (t) => CHEMINS_DOSSIER[t]?.acces !== 'global' && CHEMINS_DOSSIER[t]?.acces !== 'cabinet',
    )
    expect(plan).toEqual([...attendu])
  })
})

describe('liens perdus après restauration', () => {
  it('ne signale rien quand tout est là', () => {
    expect(liensPerdus({
      dossiers: [{ id: 'd1' }],
      pieces: [{ id: 'p1', dossier_id: 'd1' }],
      lignes_bancaires: [{ id: 'l1', dossier_id: 'd1', piece_id: 'p1' }],
    })).toEqual([])
  })

  it('attrape un rapprochement bancaire qu’une restauration pourrait sacrifier', () => {
    // Le cas qui justifie tout ce fichier. Contrairement à ce que ce commentaire affirmait d'abord,
    // Postgres REFUSE l'insertion d'un mouvement dont la pièce manque, même sur une relation
    // ON DELETE SET NULL — vérifié en base le 18/09/2026. Le danger n'est donc pas son silence mais
    // le nôtre : `lignes_bancaires.piece_id` accepte NULL, donc y mettre NULL fait passer la
    // restauration. Le dossier paraît alors intact et le rapprochement est défait.
    const perdus = liensPerdus({
      dossiers: [{ id: 'd1' }],
      pieces: [],
      lignes_bancaires: [{ id: 'l1', dossier_id: 'd1', piece_id: 'p-disparue' }],
    })
    expect(perdus).toEqual([
      { table: 'lignes_bancaires', colonne: 'piece_id', parent: 'pieces', valeur: 'p-disparue', effacable: true },
    ])
  })

  it('distingue le lien qu’on peut effacer pour passer de celui qui arrêtera tout', () => {
    // La distinction a une conséquence pratique : un lien non effaçable arrête la restauration, donc
    // il sera vu de toute façon ; un lien effaçable est celui sur lequel on sera tenté d'écrire NULL
    // pour avancer. Les confondre reviendrait à noyer les seconds parmi les premiers.
    const perdus = liensPerdus({
      dossiers: [{ id: 'd1' }],
      categories: [],
      pieces: [{ id: 'p1', dossier_id: 'd1', categorie_id: 'c-disparue' }],
      lignes_bancaires: [{ id: 'l1', dossier_id: 'd1', piece_id: 'p-disparue' }],
    })
    expect(perdus.find((p) => p.colonne === 'categorie_id')?.effacable).toBe(false)
    expect(perdus.find((p) => p.colonne === 'piece_id')?.effacable).toBe(true)
  })

  it('attrape une écriture comptable orpheline de sa pièce ET de son mouvement', () => {
    // `ecritures_brouillon` porte deux liens nullables. Une restauration qui les efface tous les deux
    // pour avancer rend une écriture sans justificatif NI contrepartie bancaire — et aboutit.
    const perdus = liensPerdus({
      dossiers: [{ id: 'd1' }],
      pieces: [],
      lignes_bancaires: [],
      ecritures_brouillon: [{ id: 'e1', dossier_id: 'd1', piece_id: 'p-disparue', ligne_bancaire_id: 'l-disparue' }],
    })
    expect(perdus.map((p) => p.colonne).sort()).toEqual(['ligne_bancaire_id', 'piece_id'])
    expect(perdus.every((p) => p.effacable)).toBe(true)
  })

  it('ne prend pas un lien vide pour un lien cassé', () => {
    // La plupart de ces colonnes sont facultatives : une pièce sans sous-dossier, un mouvement non
    // rapproché. Les signaler ferait un contrôle qui crie sur des dossiers parfaitement sains.
    expect(liensPerdus({
      dossiers: [{ id: 'd1' }],
      sous_dossiers: [],
      pieces: [{ id: 'p1', dossier_id: 'd1', sous_dossier_id: null }],
      lignes_bancaires: [{ id: 'l1', dossier_id: 'd1', piece_id: undefined }],
    })).toEqual([])
  })

  it('ne réclame pas une table hors du périmètre de la sauvegarde', () => {
    // Un export par dossier ne contient pas `cabinets`. Exiger le parent absent rendrait tout export
    // partiel systématiquement en faute, et le contrôle serait désactivé — donc perdu.
    expect(liensPerdus({
      dossiers: [{ id: 'd1', cabinet_id: 'cab-hors-perimetre' }],
    })).toEqual([])
  })

  it('compare les identifiants sur leur écriture, pas sur leur type', () => {
    // Un identifiant relu d'un JSON peut revenir en nombre là où il était en texte. Comparer sans
    // normaliser signalerait des liens parfaitement valides — le pire des faux positifs, celui qui
    // fait douter d'une restauration réussie.
    // Les deux sens comptent, et un seul des deux suffit à passer à côté du défaut : l'ensemble des
    // identifiants connus est construit en texte, donc c'est la valeur CHERCHÉE qui doit l'être aussi.
    expect(liensPerdus({
      dossiers: [{ id: 7 }],
      pieces: [{ id: 'p1', dossier_id: '7' }],
    })).toEqual([])
    expect(liensPerdus({
      dossiers: [{ id: '7' }],
      pieces: [{ id: 'p1', dossier_id: 7 }],
    })).toEqual([])
  })

  it('compare un lien sur la clé primaire de son parent, qui n’est pas toujours `id`', () => {
    // Le catalogue des rôles comptables a pour clé `role` (ligne 43, PC1) : comparée sur `id`, chaque ligne du plan d'un
    // dossier serait déclarée perdue, donc la restauration refusée.
    expect(liensPerdus({
      roles_comptables: [{ role: 'banque' }, { role: 'fournisseurs' }],
      plan_comptable_dossier: [
        { dossier_id: 'd1', role: 'banque', compte: '512100' },
        { dossier_id: 'd1', role: 'fournisseurs', compte: '401100' },
      ],
    })).toEqual([])
    expect(liensPerdus({
      roles_comptables: [{ role: 'banque' }],
      plan_comptable_dossier: [{ dossier_id: 'd1', role: 'role_inconnu', compte: '512100' }],
    })).toEqual([
      { table: 'plan_comptable_dossier', colonne: 'role', parent: 'roles_comptables', valeur: 'role_inconnu', effacable: false },
    ])
  })

  it('attrape une source citée par la révision, absente de la sauvegarde, que rien ne permet d’effacer', () => {
    // La preuve cite exactement une source : le lien vide ne passerait pas la base, et la garde refuserait la preuve.
    const perdus = liensPerdus({
      dossiers: [{ id: 'd1' }],
      pieces: [],
      documents_divers: [{ id: 'doc1', dossier_id: 'd1' }],
      revision_justifications: [{ id: 'j1', dossier_id: 'd1', remplace_id: null, reprise_de: null }],
      revision_preuves: [
        { id: 'r1', dossier_id: 'd1', justification_id: 'j1', piece_id: 'p-disparue', document_id: null },
        { id: 'r2', dossier_id: 'd1', justification_id: 'j1', piece_id: null, document_id: 'doc1' },
      ],
    })
    expect(perdus).toEqual([
      { table: 'revision_preuves', colonne: 'piece_id', parent: 'pieces', valeur: 'p-disparue', effacable: false },
    ])
  })

  it('les liens qu’une garde tient sont ceux que sa garde lit, et aucune clé étrangère ne les porte', () => {
    // Confrontés à la DERNIÈRE définition de la garde exportée : un lien ajouté ou retiré d'un seul côté se voit ici.
    const garde = derniereDefinitionSql('garder_revision_preuve')
    expect(garde).toContain('from public.pieces p where p.id = new.piece_id and p.dossier_id = new.dossier_id for share')
    expect(garde).toContain('from public.documents_divers d where d.id = new.document_id and d.dossier_id = new.dossier_id for share')
    // Le dossier permanent (étape R7) : sa garde lit de même la pièce ou le document cité, dans son dossier, sans clé.
    const permanent = derniereDefinitionSql('garder_dossier_permanent')
    expect(permanent).toContain('from public.pieces p where p.id = new.piece_id and p.dossier_id = new.dossier_id for share')
    expect(permanent).toContain('from public.documents_divers d where d.id = new.document_id and d.dossier_id = new.dossier_id for share')
    expect(LIENS_GARDES.map((l) => `${l.enfant}.${l.colonne}>${l.parent}`)).toEqual([
      'revision_preuves.document_id>documents_divers', 'revision_preuves.piece_id>pieces',
      'dossier_permanent.document_id>documents_divers', 'dossier_permanent.piece_id>pieces',
    ])
    const cles = new Set(RELATIONS.map((r) => `${r.enfant}.${r.colonne}`))
    for (const lien of LIENS_GARDES) expect(cles.has(`${lien.enfant}.${lien.colonne}`), lien.colonne).toBe(false)
    expect(TOUS_LES_LIENS).toEqual([...RELATIONS, ...LIENS_GARDES])
  })

  it('signale chaque ligne fautive, pas seulement la première', () => {
    // Un rapport qui s'arrête au premier lien perdu ferait réparer une restauration en autant
    // d'allers-retours qu'elle compte de trous.
    const perdus = liensPerdus({
      dossiers: [{ id: 'd1' }],
      pieces: [],
      lignes_bancaires: [
        { id: 'l1', dossier_id: 'd1', piece_id: 'pa' },
        { id: 'l2', dossier_id: 'd1', piece_id: 'pb' },
        { id: 'l3', dossier_id: 'd1', piece_id: 'pc' },
      ],
    })
    expect(perdus.map((p) => p.valeur)).toEqual(['pa', 'pb', 'pc'])
  })
})

describe('comptes utilisateurs exigés par une sauvegarde', () => {
  it('sépare le compte sans lequel rien ne passe de celui qui coûte une trace', () => {
    // La distinction entière : `memberships.user_id` est NOT NULL — sans ce compte, l'accès client
    // ne se réinsère pas, point. `pieces.uploaded_by` accepte NULL — la pièce revient, on ne sait
    // plus qui l'a déposée.
    expect(comptesRequis({
      memberships: [{ id: 'm1', user_id: 'u-client' }],
      pieces: [{ id: 'p1', uploaded_by: 'u-cabinet' }],
    })).toEqual({ obligatoires: ['u-client'], facultatifs: ['u-cabinet'] })
  })

  it('classe en obligatoire un compte qui figure aussi ailleurs en facultatif', () => {
    // Le cas courant, et celui qui rendrait la liste trompeuse : le chef de cabinet a généré un pack
    // (obligatoire) ET déposé des pièces (facultatif). Le compter deux fois laisserait croire qu'on
    // peut restaurer sans lui en acceptant de perdre une trace.
    const requis = comptesRequis({
      packs: [{ id: 'k1', generated_by: 'u-chef' }],
      pieces: [{ id: 'p1', uploaded_by: 'u-chef' }],
    })
    expect(requis.obligatoires).toEqual(['u-chef'])
    expect(requis.facultatifs).toEqual([])
  })

  it('ne réclame aucun compte pour une sauvegarde qui n’en cite aucun', () => {
    expect(comptesRequis({
      dossiers: [{ id: 'd1' }],
      pieces: [{ id: 'p1', uploaded_by: null }],
    })).toEqual({ obligatoires: [], facultatifs: [] })
  })

  it('ne dédouble pas un compte cité par plusieurs lignes', () => {
    const requis = comptesRequis({
      pieces: [{ id: 'p1', uploaded_by: 'u1' }, { id: 'p2', uploaded_by: 'u1' }],
    })
    expect(requis.facultatifs).toEqual(['u1'])
  })

  it('garde les trois tables du plan d’export qui exigent un compte', () => {
    // Le fait opérationnel à ne pas perdre : restaurer un dossier dans une base dont les comptes ont
    // disparu s'arrête sur ces trois-là — affectations d'équipe, accès clients, historique des packs.
    // Aucune ne peut être contournée en écrivant NULL. (`cabinet_admins` en porte un aussi mais
    // décrit le cabinet, pas le dossier : elle est hors du plan.)
    const tablesDuPlan = new Set(planExportDossier().map((e) => e.table))
    const bloquantes = PREREQUIS_AUTH.filter((p) => p.obligatoire && tablesDuPlan.has(p.table))
    expect(bloquantes.map((p) => p.table).sort()).toEqual(['dossier_assignations', 'memberships', 'packs'])
  })

  it('ne cite jamais deux fois la même colonne', () => {
    const cles = PREREQUIS_AUTH.map((p) => `${p.table}.${p.colonne}`)
    expect(cles.length).toBe(new Set(cles).size)
  })

  it('reste hors de RELATIONS, qui ne décrit que ce qui est restauré', () => {
    // Les y mêler ferait croire que `auth.users` est sauvegardée — et l'ordre de restauration
    // prétendrait la réinsérer.
    const tablesDuGraphe = new Set(RELATIONS.flatMap((r) => [r.enfant, r.parent]))
    expect(tablesDuGraphe.has('users')).toBe(false)
    expect(ORDRE_RESTAURATION).not.toContain('users')
  })
})

describe('lignes supposées déjà présentes dans la base d’arrivée', () => {
  it('nomme le cabinet qu’un export de dossier ne contient pas', () => {
    // Sans cette ligne, `dossiers.cabinet_id` échoue à la toute première table et rien d'autre n'est
    // tenté. Le savoir avant vaut mieux que le lire dans un message d'erreur Postgres.
    expect(referencesExternes({
      dossiers: [{ id: 'd1', cabinet_id: 'cab-1' }],
    })).toEqual([
      { table: 'dossiers', colonne: 'cabinet_id', parent: 'cabinets', valeurs: ['cab-1'] },
    ])
  })

  it('se tait dès que le parent est dans la sauvegarde', () => {
    // Le parent présent relève de `liensPerdus` : le citer ici ferait deux contrôles sur le même
    // lien, dont un toujours rouge.
    expect(referencesExternes({
      cabinets: [{ id: 'cab-1' }],
      dossiers: [{ id: 'd1', cabinet_id: 'cab-1' }],
    })).toEqual([])
  })

  it('partage exactement les relations avec liensPerdus, sans recouvrement ni oubli', () => {
    // Le test qui donne sa valeur aux deux : ensemble ils couvrent CHAQUE lien non vide, et aucun
    // n'est examiné deux fois. C'est ce qui permet de dire qu'un lien non signalé est un lien sûr.
    const contenu = {
      dossiers: [{ id: 'd1', cabinet_id: 'cab-1' }],
      categories: [{ id: 'c1', dossier_id: 'd1' }],
      pieces: [{ id: 'p1', dossier_id: 'd1', categorie_id: 'c-absente' }],
    }
    const perdus = liensPerdus(contenu).map((p) => `${p.table}.${p.colonne}`)
    const externes = referencesExternes(contenu).map((e) => `${e.table}.${e.colonne}`)
    expect(perdus).toEqual(['pieces.categorie_id'])
    expect(externes).toEqual(['dossiers.cabinet_id'])
    expect(perdus.filter((c) => externes.includes(c))).toEqual([])
  })

  it('dédoublonne et trie les identifiants attendus', () => {
    expect(referencesExternes({
      dossiers: [
        { id: 'd2', cabinet_id: 'cab-b' },
        { id: 'd1', cabinet_id: 'cab-a' },
        { id: 'd3', cabinet_id: 'cab-a' },
      ],
    })[0].valeurs).toEqual(['cab-a', 'cab-b'])
  })

  it('ne réclame rien pour une colonne partout vide', () => {
    expect(referencesExternes({
      pieces: [{ id: 'p1', dossier_id: null, sous_dossier_id: null }],
    })).toEqual([])
  })

  it('nomme les rôles comptables que le plan du dossier désigne, que la base d’arrivée doit connaître', () => {
    // Le point NON VÉRIFIÉ 7 de la conception (ligne 43, PC1) : un rôle qu'une base plus récente connaîtrait, et pas celle
    // d'arrivée. La restauration les y lit, sur la clé du catalogue, avant d'écrire la première ligne.
    expect(referencesExternes({
      dossiers: [{ id: 'd1', cabinet_id: 'cab-1' }],
      plan_comptable_dossier: [
        { dossier_id: 'd1', role: 'fournisseurs', compte: '401100', prefixe_auxiliaire: 'FO' },
        { dossier_id: 'd1', role: 'banque', compte: '512100', prefixe_auxiliaire: null },
      ],
    })).toEqual([
      { table: 'dossiers', colonne: 'cabinet_id', parent: 'cabinets', valeurs: ['cab-1'] },
      { table: 'plan_comptable_dossier', colonne: 'role', parent: 'roles_comptables', valeurs: ['banque', 'fournisseurs'] },
    ])
    expect(clePrimaire('roles_comptables')).toEqual(['role'])
  })

  it('réclame aussi la source qu’une preuve de la révision cite, liée par une garde et non par une clé', () => {
    // La garde de la preuve exige la pièce dans la base d'arrivée exactement comme une clé l'exigerait (ligne 41, R1).
    expect(referencesExternes({
      revision_preuves: [{ id: 'r1', dossier_id: 'd1', justification_id: 'j1', piece_id: 'p1', document_id: null }],
    })).toEqual([
      { table: 'revision_preuves', colonne: 'dossier_id', parent: 'dossiers', valeurs: ['d1'] },
      { table: 'revision_preuves', colonne: 'justification_id', parent: 'revision_justifications', valeurs: ['j1'] },
      { table: 'revision_preuves', colonne: 'piece_id', parent: 'pieces', valeurs: ['p1'] },
    ])
  })
})

describe('plan de réinsertion', () => {
  const avoir = { id: 'f2', dossier_id: 'd1', numero: 2, facture_origine_id: 'f1' }
  const origine = { id: 'f1', dossier_id: 'd1', numero: 1, facture_origine_id: null }

  it('fait partir la facture d’origine à NULL et la repose ensuite', () => {
    // Le cœur de la double passe. La colonne part vide pour tout le monde, puis revient — de sorte
    // que le résultat ne dépende plus de la taille des lots d'écriture.
    const plan = planReinsertion({ factures_emises: [avoir, origine] })
    const ecrites = plan.etapes.find((e) => e.table === 'factures_emises')!.lignes
    expect(ecrites.map((l) => l.facture_origine_id)).toEqual([null, null])
    expect(plan.secondePasse).toEqual([
      { table: 'factures_emises', colonne: 'facture_origine_id', valeurs: [{ id: 'f2', valeur: 'f1' }] },
    ])
  })

  it('ne touche pas la sauvegarde qu’on lui donne', () => {
    // La sauvegarde reste exploitable après coup — `liensPerdus` doit encore pouvoir tourner dessus.
    // Modifier les lignes en place effacerait justement le lien qu'on cherche à vérifier.
    const sauvegarde = { factures_emises: [{ ...avoir }] }
    planReinsertion(sauvegarde)
    expect(sauvegarde.factures_emises[0].facture_origine_id).toBe('f1')
  })

  it('n’ouvre pas de seconde passe quand aucune facture n’en appelle une autre', () => {
    // Le cas ordinaire : un dossier sans avoir. Une seconde passe vide ferait croire à un travail
    // restant, et un appelant finirait par ne plus la regarder.
    expect(planReinsertion({ factures_emises: [origine] }).secondePasse).toEqual([])
  })

  it('suit l’ordre de restauration et saute les tables vides', () => {
    const plan = planReinsertion({
      pieces: [{ id: 'p1', dossier_id: 'd1' }],
      dossiers: [{ id: 'd1' }],
      categories: [],
    })
    expect(plan.etapes.map((e) => e.table)).toEqual(['dossiers', 'pieces'])
  })

  it('signale une table qu’il ne saurait pas où écrire', () => {
    // Une table ajoutée au schéma et sauvegardée, mais absente de l'ordre : le plan l'ignorerait
    // sans un mot, et la restauration se dirait complète. C'est la panne que tout ce fichier combat.
    const plan = planReinsertion({ dossiers: [{ id: 'd1' }], table_inconnue: [{ id: 'x1' }] })
    expect(plan.tablesIgnorees).toEqual(['table_inconnue'])
    expect(plan.etapes.map((e) => e.table)).toEqual(['dossiers'])
  })

  it('ne signale pas une table inconnue mais vide', () => {
    // Rien à écrire, donc rien à perdre : la signaler ferait un avertissement sans conséquence, et
    // c'est ainsi qu'on apprend à les ignorer.
    expect(planReinsertion({ table_inconnue: [] }).tablesIgnorees).toEqual([])
  })

  it('écrit un encaissement avant son annulation, en deux écritures, lien compris', () => {
    // Pas de seconde passe ici : la base refuse une annulation sans sa cible (la règle du signe) et toute
    // modification d'un encaissement inséré. L'annulation part donc dans une écriture APRÈS celle de sa cible, et
    // l'ordre des lignes dans la sauvegarde n'y change rien.
    const annulation = { id: 'e2', dossier_id: 'd1', montant: -50, annule_id: 'e1' }
    const encaissement = { id: 'e1', dossier_id: 'd1', montant: 50, annule_id: null }
    const autre = { id: 'e3', dossier_id: 'd1', montant: 20, annule_id: null }
    const plan = planReinsertion({ encaissements_factures: [annulation, encaissement, autre] })
    expect(plan.etapes.filter((e) => e.table === 'encaissements_factures').map((e) => e.lignes.map((l) => l.id)))
      .toEqual([['e1', 'e3'], ['e2']])
    expect(plan.etapes[1].lignes[0].annule_id).toBe('e1')
    expect(plan.secondePasse).toEqual([])
  })

  it('n’écrit qu’une vague quand aucun encaissement n’en annule un autre', () => {
    const plan = planReinsertion({ encaissements_factures: [{ id: 'e1', annule_id: null }, { id: 'e2' }] })
    expect(plan.etapes.map((e) => e.table)).toEqual(['encaissements_factures'])
  })

  it('met en première vague une annulation dont la cible manque — et `liensPerdus` refuse avant d’écrire', () => {
    const orpheline = { id: 'e2', dossier_id: 'd1', montant: -50, annule_id: 'absent' }
    const encaissement = { id: 'e1', dossier_id: 'd1', montant: 50, annule_id: null }
    const annulation = { id: 'e3', dossier_id: 'd1', montant: -50, annule_id: 'e1' }
    expect(vaguesParLien([orpheline, encaissement, annulation], 'annule_id')).toEqual([[orpheline, encaissement], [annulation]])
    expect(liensPerdus({ encaissements_factures: [orpheline] })).toContainEqual(
      expect.objectContaining({ table: 'encaissements_factures', colonne: 'annule_id', valeur: 'absent', effacable: false }),
    )
  })

  it('ne boucle pas sur un cycle, que la base refusera', () => {
    // Une annulation ne s'annule pas : la base l'interdit, et une sauvegarde n'en porte donc pas. Le plan ne doit
    // pas pour autant tourner sans fin sur un fichier altéré : ce qui ne peut plus avancer part en dernier.
    const a = { id: 'a', annule_id: 'b' }
    const b = { id: 'b', annule_id: 'a' }
    const c = { id: 'c', annule_id: null }
    expect(vaguesParLien([a, b, c], 'annule_id')).toEqual([[c], [a, b]])
  })

  it('ne touche pas la sauvegarde qu’on lui donne, vagues comprises', () => {
    const sauvegarde = { encaissements_factures: [{ id: 'e2', annule_id: 'e1' }, { id: 'e1', annule_id: null }] }
    planReinsertion(sauvegarde)
    expect(sauvegarde.encaissements_factures.map((l) => l.id)).toEqual(['e2', 'e1'])
    expect(sauvegarde.encaissements_factures[0].annule_id).toBe('e1')
  })

  it('écrit une décision de la révision après TOUTES ses cibles : un maillon de chaîne par vague, la reprise ensuite', () => {
    // Une décision en remplace une (`remplace_id`) et reprend celle de l'exercice précédent (`reprise_de`) : immuable,
    // elle ne part pas à NULL, et sa garde lit chaque cible. L'ordre de la sauvegarde n'y change rien.
    const reprise = { id: 'j4', annee: 2025, remplace_id: null, reprise_de: 'j3' }
    const troisieme = { id: 'j3', annee: 2024, remplace_id: 'j2', reprise_de: null }
    const premiere = { id: 'j1', annee: 2024, remplace_id: null, reprise_de: null }
    const seconde = { id: 'j2', annee: 2024, remplace_id: 'j1', reprise_de: null }
    const autre = { id: 'j5', annee: 2024, remplace_id: null, reprise_de: null }
    const plan = planReinsertion({ revision_justifications: [reprise, troisieme, premiere, seconde, autre] })
    expect(plan.etapes.map((e) => e.lignes.map((l) => l.id))).toEqual([['j1', 'j5'], ['j2'], ['j3'], ['j4']])
    expect(plan.secondePasse).toEqual([])
    // Par une seule colonne, la reprise partirait avec la première vague, avant sa cible.
    expect(vaguesParLien([reprise, troisieme, premiere, seconde, autre], 'remplace_id').map((v) => v.map((l) => l.id)))
      .toEqual([['j4', 'j1', 'j5'], ['j2'], ['j3']])
  })

  it('écrit chaque conclusion d’un cycle après celle qu’elle remplace, et sa revue après elle (étape R4)', () => {
    // Une conclusion en remplace une du même cycle et du même exercice : immuable, elle ne part pas à NULL, et sa garde lit
    // la conclusion remplacée — un maillon par vague. Sa revue suit la table des conclusions, que la clé lui fait lire.
    const troisieme = { id: 'k3', dossier_id: 'd1', remplace_id: 'k2' }
    const premiere = { id: 'k1', dossier_id: 'd1', remplace_id: null }
    const seconde = { id: 'k2', dossier_id: 'd1', remplace_id: 'k1' }
    const autre = { id: 'l1', dossier_id: 'd1', remplace_id: null }
    const revues = [{ id: 'v1', dossier_id: 'd1', conclusion_id: 'k1' }, { id: 'v3', dossier_id: 'd1', conclusion_id: 'k3' }]
    const plan = planReinsertion({ revision_revues: revues, revision_conclusions: [troisieme, premiere, seconde, autre] })
    expect(plan.etapes.map((e) => `${e.table}:${e.lignes.map((l) => l.id).join(',')}`)).toEqual([
      'revision_conclusions:k1,l1', 'revision_conclusions:k2', 'revision_conclusions:k3', 'revision_revues:v1,v3',
    ])
    expect(plan.secondePasse).toEqual([])
    // Une conclusion qui en remplace une absente de la sauvegarde, une revue d'une conclusion absente : des liens perdus.
    expect(liensPerdus({ dossiers: [{ id: 'd1' }], revision_conclusions: [seconde], revision_revues: [{ id: 'v9', dossier_id: 'd1', conclusion_id: 'k9' }] }))
      .toEqual([
        { table: 'revision_conclusions', colonne: 'remplace_id', parent: 'revision_conclusions', valeur: 'k1', effacable: false },
        { table: 'revision_revues', colonne: 'conclusion_id', parent: 'revision_conclusions', valeur: 'k9', effacable: false },
      ])
  })

  it('écrit chaque seuil et chaque explication de la revue analytique après celui qu’il remplace (étape R5)', () => {
    // Un seuil en remplace un du même exercice, une explication une de la même ligne et du même exercice (`remplace_id`) :
    // immuables, ils ne partent pas à NULL, et leur garde lit la cible — un maillon par vague, table par table.
    const s2 = { id: 's2', dossier_id: 'd1', annee: 2025, remplace_id: 's1' }
    const s1 = { id: 's1', dossier_id: 'd1', annee: 2025, remplace_id: null }
    const s9 = { id: 's9', dossier_id: 'd1', annee: 2024, remplace_id: null }
    const x3 = { id: 'x3', dossier_id: 'd1', annee: 2025, remplace_id: 'x2' }
    const x2 = { id: 'x2', dossier_id: 'd1', annee: 2025, remplace_id: 'x1' }
    const x1 = { id: 'x1', dossier_id: 'd1', annee: 2025, remplace_id: null }
    const y1 = { id: 'y1', dossier_id: 'd1', annee: 2025, remplace_id: null }
    const plan = planReinsertion({ revision_explications: [x3, y1, x2, x1], revision_seuils: [s2, s1, s9] })
    expect(plan.etapes.map((e) => `${e.table}:${e.lignes.map((l) => l.id).join(',')}`)).toEqual([
      'revision_seuils:s1,s9', 'revision_seuils:s2',
      'revision_explications:y1,x1', 'revision_explications:x2', 'revision_explications:x3',
    ])
    expect(plan.secondePasse).toEqual([])
    // Un seuil ou une explication qui en remplace un absent de la sauvegarde : des liens perdus, jamais effaçables.
    expect(liensPerdus({ dossiers: [{ id: 'd1' }], revision_seuils: [s2], revision_explications: [x3] })).toEqual([
      { table: 'revision_seuils', colonne: 'remplace_id', parent: 'revision_seuils', valeur: 's1', effacable: false },
      { table: 'revision_explications', colonne: 'remplace_id', parent: 'revision_explications', valeur: 'x2', effacable: false },
    ])
  })

  it('écrit chaque version d’une fiche « hors de France » après celle qu’elle remplace, et sa ventilation ensuite', () => {
    // Une version en remplace une de la même pièce (`remplace_id`, ligne 28.5, étape e2) : immuable hors de son retrait,
    // elle ne part pas à NULL, et sa garde lit la version remplacée. Une fiche retirée part avec son retrait.
    const troisieme = { id: 'f3', dossier_id: 'd1', piece_id: 'p1', remplace_id: 'f2', retire_le: '2026-05-01T10:00:00Z' }
    const premiere = { id: 'f1', dossier_id: 'd1', piece_id: 'p1', remplace_id: null, retire_le: null }
    const seconde = { id: 'f2', dossier_id: 'd1', piece_id: 'p1', remplace_id: 'f1', retire_le: null }
    const autre = { id: 'g1', dossier_id: 'd1', piece_id: 'p2', remplace_id: null, retire_le: null }
    const ventilation = [{ fiche_id: 'f3', dossier_id: 'd1', code_tva: 'AE', taux: 0, base: 120, tva: 0 }]
    const plan = planReinsertion({ pieces_hors_de_france_taux: ventilation, pieces_hors_de_france: [troisieme, premiere, seconde, autre] })
    expect(plan.etapes.map((e) => `${e.table}:${e.lignes.map((l) => l.id ?? l.fiche_id).join(',')}`)).toEqual([
      'pieces_hors_de_france:f1,g1', 'pieces_hors_de_france:f2', 'pieces_hors_de_france:f3', 'pieces_hors_de_france_taux:f3',
    ])
    expect(plan.etapes[2].lignes[0]).toEqual(troisieme)
    expect(plan.secondePasse).toEqual([])
  })

  it('une décision qui pointe une décision absente part dans la première vague — et `liensPerdus` refuse', () => {
    const orpheline = { id: 'j2', dossier_id: 'd1', remplace_id: 'absente', reprise_de: null }
    expect(vaguesParLien([orpheline], ['remplace_id', 'reprise_de'])).toEqual([[orpheline]])
    expect(liensPerdus({ dossiers: [{ id: 'd1' }], revision_justifications: [orpheline] })).toEqual([
      { table: 'revision_justifications', colonne: 'remplace_id', parent: 'revision_justifications', valeur: 'absente', effacable: false },
    ])
  })

  it('n’écrit jamais une colonne que la base calcule : l’empreinte du texte lu part sans elle, et la sauvegarde reste intacte', () => {
    // Défaut relevé à l'étape e5b1 : `piece_textes_ocr.texte_md5` est GÉNÉRÉE, et Postgres refuse toute insertion qui la
    // nomme (428C9), même NULL. La ligne part sans elle ; la base la recalcule du texte restauré.
    const texte = { id: 't1', dossier_id: 'd1', piece_id: 'p1', document_id: null, texte: 'Texte lu', texte_md5: 'ab12', created_at: '2026-09-19T10:00:00Z' }
    const sansEmpreinte = { id: 't2', dossier_id: 'd1', piece_id: null, document_id: 'doc1', texte: 'Autre texte lu' }
    const piece = { id: 'p1', dossier_id: 'd1', nom_fichier: 'piece-1.pdf' }
    const sauvegarde: Record<string, Record<string, unknown>[]> = { piece_textes_ocr: [texte, sansEmpreinte], pieces: [piece] }
    const plan = planReinsertion(sauvegarde)
    const ecrites = plan.etapes.find((e) => e.table === 'piece_textes_ocr')!.lignes
    const { texte_md5: _empreinte, ...attendue } = texte
    expect(ecrites).toEqual([attendue, sansEmpreinte])
    // Aucune ligne du lot ne la nomme : PostgREST insère l'union des clés du lot.
    expect(ecrites.some((l) => 'texte_md5' in l)).toBe(false)
    // La sauvegarde reçue garde son empreinte — `liensPerdus` et la vérification la relisent telle quelle.
    expect(sauvegarde.piece_textes_ocr[0].texte_md5).toBe('ab12')
    // Une table sans colonne générée part telle quelle, lignes comprises.
    expect(plan.etapes.find((e) => e.table === 'pieces')!.lignes[0]).toBe(piece)
    expect(sansColonnesGenerees('pieces', sauvegarde.pieces)).toBe(sauvegarde.pieces)
  })

  it('retire les colonnes générées de TOUTES les lignes d’une table, et d’elles seules', () => {
    const lignes = [{ id: 'a', texte: 'x', texte_md5: 'h1' }, { id: 'b', texte: 'y', texte_md5: null }, { id: 'c', texte: 'z' }]
    expect(sansColonnesGenerees('piece_textes_ocr', lignes)).toEqual([{ id: 'a', texte: 'x' }, { id: 'b', texte: 'y' }, { id: 'c', texte: 'z' }])
    expect(lignes[0]).toEqual({ id: 'a', texte: 'x', texte_md5: 'h1' })
    // Une colonne du même nom dans une table où elle n'est pas générée n'est pas retirée.
    expect(sansColonnesGenerees('pieces', [{ id: 'p', texte_md5: 'h' }])).toEqual([{ id: 'p', texte_md5: 'h' }])
    expect(COLONNES_GENEREES).toEqual({ piece_textes_ocr: ['texte_md5'] })
  })

  it('couvre chaque table auto-référencée déclarée', () => {
    // Le lien entre la constante et le plan : une auto-référence ajoutée à TABLES_AUTO_REFERENCEES
    // sans que le plan sache la traiter donnerait une seconde passe muette.
    for (const { table, colonne } of TABLES_AUTO_REFERENCEES) {
      const plan = planReinsertion({ [table]: [{ id: 'a', [colonne]: 'b' }, { id: 'b' }] })
      expect(plan.secondePasse).toContainEqual(
        expect.objectContaining({ table, colonne, valeurs: [{ id: 'a', valeur: 'b' }] }),
      )
    }
  })
})

describe('lignes partagées entre tous les dossiers', () => {
  it('lit les deux tables dont le dossier_id accepte NULL autrement que les autres', () => {
    // Le défaut que ce chemin corrige. `categories` et `natures_immobilisation` mélangent les lignes
    // d'un dossier et des lignes partagées (`dossier_id` nul). Les lire en « direct », donc avec
    // `WHERE dossier_id = <le dossier>`, écarte les partagées sans le dire : en SQL, une comparaison
    // avec NULL n'est jamais vraie. Mesuré en production le 18/09/2026 — les 10 catégories et les
    // 8 natures du cabinet sont partagées, aucune n'appartient à un dossier : l'export en rendait
    // ZÉRO, pendant que les 28 pièces catégorisées du cabinet — toutes les 28 — les pointaient.
    expect(CHEMINS_DOSSIER.categories).toEqual({ acces: 'partage' })
    expect(CHEMINS_DOSSIER.natures_immobilisation).toEqual({ acces: 'partage' })
  })

  it('garde ces deux tables dans le plan d’export', () => {
    // Sans elles, `pieces.categorie_id` et `immobilisations.nature_id` — tous deux en NO ACTION —
    // arrêtent la restauration sur `pieces`, la plus grosse table de la chaîne.
    const plan = planExportDossier().map((e) => e.table)
    expect(plan).toContain('categories')
    expect(plan).toContain('natures_immobilisation')
  })

  it('laisse dehors ce qui décrit le cabinet et non le dossier', () => {
    // Restaurer un client n'a pas à réinsérer la liste des administrateurs du cabinet ni les règles
    // que celui-ci partage entre tous ses dossiers.
    const plan = planExportDossier().map((e) => e.table)
    expect(plan).not.toContain('cabinet_admins')
    expect(plan).not.toContain('tiers_categories_cabinet')
  })

  it('reconnaît une ligne partagée à son dossier_id vide, pas à une liste tenue à côté', () => {
    expect(estLignePartagee('categories', { id: 'c1', dossier_id: null })).toBe(true)
    expect(estLignePartagee('categories', { id: 'c2', dossier_id: 'd1' })).toBe(false)
  })

  it('ne prend pas pour partagée une ligne d’une table qui ne l’est pas', () => {
    // `pieces` n'a pas de lignes partagées — son `dossier_id` est NOT NULL. Si une ligne en arrivait
    // sans dossier, la traiter comme partagée la ferait échapper à la réinsertion sans un mot.
    expect(estLignePartagee('pieces', { id: 'p1', dossier_id: null })).toBe(false)
  })
})

describe('tables pointées mais absentes du plan', () => {
  it('ne laisse que les exceptions voulues', () => {
    // L'invariant qui aurait dit le défaut ci-dessus dès la première exécution des tests : une table
    // du plan qui en pointe une hors du plan fera buter la restauration. `cabinets` et le catalogue des
    // rôles comptables (ligne 43, PC1) sont les seules admises — un export de dossier ne les contient
    // délibérément pas, la base d'arrivée doit les porter (`referencesExternes` les nomme).
    expect(parentsHorsPlan()).toEqual([
      { parent: 'cabinets', pointeePar: ['dossiers'], effacable: false },
      { parent: 'roles_comptables', pointeePar: ['plan_comptable_dossier'], effacable: false },
    ])
    expect(parentsHorsPlan().map((p) => p.parent)).toEqual([...PARENTS_HORS_PLAN_VOULUS].sort())
  })

  it('signale une table pointée qu’on aurait sortie du plan', () => {
    // La preuve que le contrôle détecte quelque chose : le plan d'hier, où `categories` rendait zéro
    // ligne pendant que les pièces la pointaient.
    const trouve = parentsHorsPlan(['dossiers', 'pieces', 'categories'], {
      dossiers: { acces: 'le_dossier' },
      pieces: { acces: 'direct' },
      categories: { acces: 'global' },
    })
    expect(trouve).toEqual([{ parent: 'categories', pointeePar: ['pieces'], effacable: false }])
  })

  it('ne dit effaçable qu’un parent dont AUCUN lien n’est obligatoire', () => {
    // `pieces` est pointée par des liens nullables (le rapprochement bancaire) et par des liens
    // obligatoires (le texte OCR, en cascade). Il suffit d'un seul obligatoire pour que la
    // restauration s'arrête : annoncer « effaçable » ferait croire qu'on peut passer outre.
    const trouve = parentsHorsPlan(['dossiers', 'lignes_bancaires', 'piece_textes_ocr'], {
      dossiers: { acces: 'le_dossier' },
      lignes_bancaires: { acces: 'direct' },
      piece_textes_ocr: { acces: 'direct' },
      pieces: { acces: 'direct' },
    })
    expect(trouve).toEqual([
      { parent: 'pieces', pointeePar: ['lignes_bancaires', 'piece_textes_ocr'], effacable: false },
    ])
  })

  it('dit effaçable un parent dont tous les liens acceptent NULL', () => {
    const trouve = parentsHorsPlan(['dossiers', 'lignes_bancaires'], {
      dossiers: { acces: 'le_dossier' },
      lignes_bancaires: { acces: 'direct' },
      pieces: { acces: 'direct' },
    })
    expect(trouve).toEqual([{ parent: 'pieces', pointeePar: ['lignes_bancaires'], effacable: true }])
  })

  it('signale les sources qu’une preuve de la révision cite, sorties du plan, que seule une garde lie', () => {
    // Sans pièces ni documents dans le plan, chaque preuve restaurée serait refusée par sa garde : aucune clé ne le dit.
    const trouve = parentsHorsPlan(['dossiers', 'revision_justifications', 'revision_preuves'], {
      dossiers: { acces: 'le_dossier' },
      revision_justifications: { acces: 'direct' },
      revision_preuves: { acces: 'direct' },
      pieces: { acces: 'direct' },
      documents_divers: { acces: 'direct' },
    })
    expect(trouve).toEqual([
      { parent: 'documents_divers', pointeePar: ['revision_preuves'], effacable: false },
      { parent: 'pieces', pointeePar: ['revision_preuves'], effacable: false },
    ])
  })

  it('laisse tablesSansChemin dire seule ce qu’elle dit déjà', () => {
    // Une table sans chemin déclaré est un défaut, mais `tablesSansChemin` le nomme mieux. La compter
    // ici aussi ferait deux alertes rouges pour un seul défaut, et on apprendrait à en ignorer une.
    expect(parentsHorsPlan(['pieces'], { pieces: { acces: 'direct' } })).toEqual([])
    expect(tablesSansChemin(['pieces'], { pieces: { acces: 'direct' } })).toEqual([])
  })
})

// LES ANCIENNES COLONNES DES NOTES INTERNES (espace client, étape P0, 09/10/2026) : une sauvegarde d'hier les porte, la
// restauration ne les réécrit plus — elle range leurs notes dans `notes_internes`, comme la migration l'a fait.
describe('les anciennes colonnes des notes internes', () => {
  const MIGRATION = readFileSync(resolve(process.cwd(), 'supabase/schema/20261009185236_notes_internes_du_cabinet.sql'), 'utf8')

  it('une note blanche n’en est pas une : la même règle que la recopie en base', () => {
    // Relue dans la migration appliquée : `btrim` n'ôte que l'espace, la tabulation et les deux fins de ligne.
    expect(MIGRATION.split("btrim(p.notes, E' \\t\\n\\r') <> ''").length).toBe(2)
    expect(MIGRATION.split("btrim(d.notes, E' \\t\\n\\r') <> ''").length).toBe(2)
    for (const blanche of ['', ' ', '\t', '\n', '\r', ' \r\n\t ']) expect(noteBlanche(blanche), JSON.stringify(blanche)).toBe(true)
    // Ce que `btrim` garde : l'espace insécable, la tabulation verticale, le saut de page, et tout texte.
    for (const note of ['a', ' a ', ' ', '\u000b', '\f', ' ', '-']) expect(noteBlanche(note), JSON.stringify(note)).toBe(false)
  })

  it('retire la colonne des trois tables, et d’elles seules', () => {
    expect(ANCIENNES_COLONNES_DES_NOTES).toEqual(['pieces', 'documents_divers', 'dossiers'])
    const { contenu } = sansAnciennesNotes({
      dossiers: [{ id: 'd1', notes: null }],
      pieces: [{ id: 'p1', dossier_id: 'd1', notes: null }],
      documents_divers: [{ id: 'doc1', dossier_id: 'd1', notes: '' }],
      // Les notes d'autres tables sont celles de l'application : elles restent.
      factures_emises: [{ id: 'f1', dossier_id: 'd1', notes: 'Note de l’avoir' }],
      supplements: [{ id: 's1', dossier_id: 'd1', notes: 'Prime' }],
      informations_dossier: [{ dossier_id: 'd1', notes: 'Saisie du client' }],
    })
    for (const table of ANCIENNES_COLONNES_DES_NOTES) expect(contenu[table][0], table).not.toHaveProperty('notes')
    expect(contenu.factures_emises[0].notes).toBe('Note de l’avoir')
    expect(contenu.supplements[0].notes).toBe('Prime')
    expect(contenu.informations_dossier[0].notes).toBe('Saisie du client')
    expect(contenu.notes_internes).toBeUndefined()
  })

  it('range une note non blanche dans les notes internes, si sa cible n’en a pas déjà une', () => {
    const sauvegarde = {
      pieces: [
        { id: 'p1', dossier_id: 'd1', notes: 'À relancer.' },
        { id: 'p2', dossier_id: 'd1', notes: 'Ancienne, remplacée.' },
        { id: 'p3', dossier_id: 'd1', notes: '\n' },
      ],
      documents_divers: [{ id: 'doc1', dossier_id: 'd1', notes: ' Reclassé ' }],
      notes_internes: [{ id: 'n2', dossier_id: 'd1', piece_id: 'p2', document_id: null, texte: 'La note qui fait foi.' }],
    }
    const avant = JSON.stringify(sauvegarde)
    const { contenu, notesRecopiees, refus } = sansAnciennesNotes(sauvegarde)
    expect(contenu.notes_internes).toEqual([
      { id: 'n2', dossier_id: 'd1', piece_id: 'p2', document_id: null, texte: 'La note qui fait foi.' },
      { dossier_id: 'd1', piece_id: 'p1', texte: 'À relancer.' },
      // Le texte tel qu'écrit, blancs compris, comme la recopie en base.
      { dossier_id: 'd1', document_id: 'doc1', texte: ' Reclassé ' },
    ])
    expect(notesRecopiees).toBe(2)
    expect(refus).toEqual([])
    // Pure : la sauvegarde reçue n'a pas bougé (`liensPerdus` et la vérification la relisent telle quelle).
    expect(JSON.stringify(sauvegarde)).toBe(avant)
  })

  it('une note de dossier n’a nulle part où aller : la restauration la refuse plutôt que de la perdre', () => {
    expect(sansAnciennesNotes({ dossiers: [{ id: 'd1', notes: 'Client exigeant.' }] }).refus).toEqual([
      'La fiche du dossier « d1 » porte une note (dossiers.notes) que l\'application ne garde plus nulle part : la restaurer la perdrait.',
    ])
    expect(sansAnciennesNotes({ dossiers: [{ id: 'd1', notes: ' \t' }] }).refus).toEqual([])
  })

  it('le plan de réinsertion écrit la sauvegarde sans les anciennes colonnes, ses notes après leurs cibles', () => {
    const plan = planReinsertion({
      dossiers: [{ id: 'd1', notes: null }],
      pieces: [{ id: 'p1', dossier_id: 'd1', notes: 'À relancer.' }],
      documents_divers: [{ id: 'doc1', dossier_id: 'd1', notes: 'Reclassé' }],
    })
    expect(plan.etapes.map((e) => e.table)).toEqual(['dossiers', 'documents_divers', 'pieces', 'notes_internes'])
    for (const etape of plan.etapes.filter((e) => e.table !== 'notes_internes')) {
      for (const ligne of etape.lignes) expect(ligne, etape.table).not.toHaveProperty('notes')
    }
    expect(plan.etapes.at(-1)!.lignes).toEqual([
      { dossier_id: 'd1', piece_id: 'p1', texte: 'À relancer.' },
      { dossier_id: 'd1', document_id: 'doc1', texte: 'Reclassé' },
    ])
  })

  it('une note interne se vérifie à sa cible, toute autre ligne à sa clé primaire', () => {
    expect(identiteRestauree('notes_internes', { id: 'n1', piece_id: 'p1', document_id: null })).toBe('piece:p1')
    expect(identiteRestauree('notes_internes', { piece_id: null, document_id: 'doc1' })).toBe('document:doc1')
    expect(identiteRestauree('pieces', { id: 'p1', notes: 'x' })).toBe('p1')
    expect(identiteRestauree('facture_numerotation', { dossier_id: 'd1', annee: 2026, type: 'facture' }))
      .toBe('d1\u00002026\u0000facture')
  })
})
