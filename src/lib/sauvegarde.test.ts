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
  ORDRE_RESTAURATION,
  PREREQUIS_AUTH,
  RELATIONS,
  TABLES_AUTO_REFERENCEES,
  type Relation,
} from './sauvegarde'

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
    // ZÉRO, pendant que 76 pièces catégorisées sur 76 les pointaient.
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

  it('laisse tablesSansChemin dire seule ce qu’elle dit déjà', () => {
    // Une table sans chemin déclaré est un défaut, mais `tablesSansChemin` le nomme mieux. La compter
    // ici aussi ferait deux alertes rouges pour un seul défaut, et on apprendrait à en ignorer une.
    expect(parentsHorsPlan(['pieces'], { pieces: { acces: 'direct' } })).toEqual([])
    expect(tablesSansChemin(['pieces'], { pieces: { acces: 'direct' } })).toEqual([])
  })
})
