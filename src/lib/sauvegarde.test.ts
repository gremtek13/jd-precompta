import { describe, expect, it } from 'vitest'
import {
  comptesRequis,
  estLignePartagee,
  parentsHorsPlan,
  liensPerdus,
  ordreSuppression,
  planExportDossier,
  planReinsertion,
  referencesExternes,
  tablesSansChemin,
  violationsOrdre,
  CHEMINS_DOSSIER,
  LIENS_GARDES,
  ORDRE_RESTAURATION,
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
    expect(RELATIONS.filter((r) => r.enfant.startsWith('revision_')).map((r) => `${r.enfant}.${r.colonne}>${r.parent}:${r.aLaSuppression}`).sort())
      .toEqual([
        'revision_justifications.dossier_id>dossiers:cascade',
        'revision_justifications.remplace_id>revision_justifications:bloque',
        'revision_justifications.reprise_de>revision_justifications:bloque',
        'revision_preuves.dossier_id>dossiers:cascade',
        'revision_preuves.justification_id>revision_justifications:cascade',
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
    expect(LIENS_GARDES.map((l) => `${l.enfant}.${l.colonne}>${l.parent}`)).toEqual([
      'revision_preuves.document_id>documents_divers', 'revision_preuves.piece_id>pieces',
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

  it('une décision qui pointe une décision absente part dans la première vague — et `liensPerdus` refuse', () => {
    const orpheline = { id: 'j2', dossier_id: 'd1', remplace_id: 'absente', reprise_de: null }
    expect(vaguesParLien([orpheline], ['remplace_id', 'reprise_de'])).toEqual([[orpheline]])
    expect(liensPerdus({ dossiers: [{ id: 'd1' }], revision_justifications: [orpheline] })).toEqual([
      { table: 'revision_justifications', colonne: 'remplace_id', parent: 'revision_justifications', valeur: 'absente', effacable: false },
    ])
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
  it('ne laisse qu’une seule exception, et c’est une exception voulue', () => {
    // L'invariant qui aurait dit le défaut ci-dessus dès la première exécution des tests : une table
    // du plan qui en pointe une hors du plan fera buter la restauration. `cabinets` est la seule
    // admise — un export de dossier ne la contient délibérément pas, la base d'arrivée doit la porter.
    expect(parentsHorsPlan()).toEqual([
      { parent: 'cabinets', pointeePar: ['dossiers'], effacable: false },
    ])
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
