import { describe, expect, it } from 'vitest'
import {
  liensPerdus,
  ordreSuppression,
  planExportDossier,
  tablesSansChemin,
  violationsOrdre,
  CHEMINS_DOSSIER,
  ORDRE_RESTAURATION,
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
    const attendu = ORDRE_RESTAURATION.filter((t) => CHEMINS_DOSSIER[t]?.acces !== 'global')
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

  it('attrape un rapprochement bancaire que la base laisserait passer en silence', () => {
    // Le cas qui justifie tout ce fichier. `lignes_bancaires.piece_id` est en SET NULL : si la pièce
    // manque, Postgres n'échoue pas, il écrit NULL. Le dossier restauré paraît intact, mais le
    // rapprochement est défait — et personne ne le voit avant de rouvrir l'écran banque.
    const perdus = liensPerdus({
      dossiers: [{ id: 'd1' }],
      pieces: [],
      lignes_bancaires: [{ id: 'l1', dossier_id: 'd1', piece_id: 'p-disparue' }],
    })
    expect(perdus).toEqual([
      { table: 'lignes_bancaires', colonne: 'piece_id', parent: 'pieces', valeur: 'p-disparue', silencieux: true },
    ])
  })

  it('distingue un lien qui échouerait bruyamment d’un lien qui passerait en silence', () => {
    // La distinction a une conséquence pratique : un lien « bruyant » fera échouer la restauration et
    // sera donc vu ; un lien « silencieux » ne sera vu que par ce contrôle. Les confondre reviendrait
    // à noyer les seconds parmi les premiers.
    const perdus = liensPerdus({
      dossiers: [{ id: 'd1' }],
      categories: [],
      pieces: [{ id: 'p1', dossier_id: 'd1', categorie_id: 'c-disparue' }],
      lignes_bancaires: [{ id: 'l1', dossier_id: 'd1', piece_id: 'p-disparue' }],
    })
    expect(perdus.find((p) => p.colonne === 'categorie_id')?.silencieux).toBe(false)
    expect(perdus.find((p) => p.colonne === 'piece_id')?.silencieux).toBe(true)
  })

  it('attrape une écriture comptable orpheline de sa pièce ET de son mouvement', () => {
    // `ecritures_brouillon` porte deux liens en SET NULL. Une restauration incomplète peut donc rendre
    // une écriture sans justificatif ni contrepartie bancaire, sans la moindre erreur.
    const perdus = liensPerdus({
      dossiers: [{ id: 'd1' }],
      pieces: [],
      lignes_bancaires: [],
      ecritures_brouillon: [{ id: 'e1', dossier_id: 'd1', piece_id: 'p-disparue', ligne_bancaire_id: 'l-disparue' }],
    })
    expect(perdus.map((p) => p.colonne).sort()).toEqual(['ligne_bancaire_id', 'piece_id'])
    expect(perdus.every((p) => p.silencieux)).toBe(true)
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
