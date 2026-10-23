import { describe, expect, it } from 'vitest'
import { PARAMETRES_FACTURATION_EXPORTES } from './parametresFacturation'
import {
  auPlanAujourdHui,
  auPlanDesParametresFacturation,
  CHEMINS_DOSSIER,
  CHEMINS_DOSSIER_PREVUS,
  CLES_PRIMAIRES,
  CLES_PRIMAIRES_PREVUES,
  clePrimaire,
  LIENS_GARDES,
  ORDRE_RESTAURATION,
  ORDRE_RESTAURATION_PREVU,
  planExportDossier,
  planReinsertion,
  RELATIONS,
  RELATIONS_PREVUES,
  TABLES_AUTO_REFERENCEES,
  TABLES_AUTO_REFERENCEES_PAR_VAGUES,
  TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES,
  TABLES_DES_ADRESSES_RECEPTION,
  TABLES_DES_ARTICLES,
  TABLES_DES_CONTACTS,
  TABLES_DES_DEVIS,
  TABLES_DES_PARAMETRES_FACTURATION,
  tablesSansChemin,
  violationsOrdre,
} from './sauvegarde'

// LES PARAMÈTRES DE FACTURATION AU PLAN DE SAUVEGARDE (espace client, étape A5a). Leur migration est appliquée et
// exportée : le drapeau est levé, et le plan effectif nomme leur table partout — rebaissé (avant tout retour arrière de la
// migration), il ne devrait plus RIEN en dire : une sauvegarde lirait une table absente et échouerait. Le plan PRÉVU est
// celui du jour. Les tests qui confrontent le plan au schéma exporté (`sauvegardeRelations`, `sauvegardeTables`,
// `sauvegardeClesPrimaires`, `sauvegarde`) jugent l'état effectif ; celui-ci juge le plan prévu, et le lien des deux.

describe('le filtre du plan, côté paramètres de facturation', () => {
  it('la table n’est au plan que le drapeau levé ; toute autre l’est toujours', () => {
    expect(TABLES_DES_PARAMETRES_FACTURATION).toEqual(['parametres_facturation'])
    for (const table of TABLES_DES_PARAMETRES_FACTURATION) {
      expect(auPlanDesParametresFacturation(table, false), table).toBe(false)
      expect(auPlanDesParametresFacturation(table, true), table).toBe(true)
    }
    for (const table of ['dossiers', 'contacts', 'adresses_reception', 'devis', 'parametre_facturation', 'exercices_valides']) {
      expect(auPlanDesParametresFacturation(table, false), table).toBe(true)
      expect(auPlanDesParametresFacturation(table, true), table).toBe(true)
    }
  })

  it('le filtre du jour suit le drapeau des paramètres de facturation', () => {
    expect(auPlanAujourdHui('parametres_facturation')).toBe(PARAMETRES_FACTURATION_EXPORTES)
    expect(auPlanAujourdHui('dossiers')).toBe(true)
  })

  it('aucune table n’est à la fois des paramètres et d’un autre drapeau : chaque drapeau garde les siennes', () => {
    const autres = [...TABLES_DES_DEVIS, ...TABLES_DES_ARTICLES, ...TABLES_DES_ADRESSES_RECEPTION, ...TABLES_DES_CONTACTS]
    expect(TABLES_DES_PARAMETRES_FACTURATION.filter((t) => autres.includes(t))).toEqual([])
  })

  it('drapeau baissé, le plan effectif ne nomme pas la table — drapeau levé, partout, sa vague comprise', () => {
    const nommees = new Set([
      ...RELATIONS.flatMap((r) => [r.enfant, r.parent]), ...ORDRE_RESTAURATION, ...Object.keys(CHEMINS_DOSSIER),
      ...TABLES_AUTO_REFERENCEES_PAR_VAGUES.map((a) => a.table),
    ])
    for (const table of TABLES_DES_PARAMETRES_FACTURATION) expect(nommees.has(table), table).toBe(PARAMETRES_FACTURATION_EXPORTES)
    expect(TABLES_AUTO_REFERENCEES_PAR_VAGUES).toEqual(TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES.filter((a) => auPlanAujourdHui(a.table)))
    // Sa clé est la clé commune : aucune ligne dans les clés déclarées, prévues ou non.
    expect(Object.keys(CLES_PRIMAIRES_PREVUES)).not.toContain('parametres_facturation')
    expect(Object.keys(CLES_PRIMAIRES)).not.toContain('parametres_facturation')
    expect(clePrimaire('parametres_facturation')).toEqual(['id'])
  })
})

describe('le plan prévu, paramètres de facturation compris', () => {
  it('la table y entre partout : l’ordre, le chemin, le graphe, les vagues', () => {
    for (const table of TABLES_DES_PARAMETRES_FACTURATION) {
      expect(ORDRE_RESTAURATION_PREVU.filter((t) => t === table), table).toHaveLength(1)
      expect(CHEMINS_DOSSIER_PREVUS[table], table).toEqual({ acces: 'direct' })
      expect(RELATIONS_PREVUES.some((r) => r.enfant === table), table).toBe(true)
    }
    expect(TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES.filter((a) => a.table === 'parametres_facturation'))
      .toEqual([{ table: 'parametres_facturation', colonne: 'remplace_id' }])
    // Par vagues, jamais en deux passes : une version ne part pas à NULL pour se compléter ensuite.
    expect(TABLES_AUTO_REFERENCEES.some((a) => a.table === 'parametres_facturation')).toBe(false)
  })

  it('ses relations, telles que la migration les déclare : son dossier, en cascade ; la version qu’elle remplace, sans action', () => {
    const desParametres = RELATIONS_PREVUES
      .filter((r) => TABLES_DES_PARAMETRES_FACTURATION.includes(r.enfant) || TABLES_DES_PARAMETRES_FACTURATION.includes(r.parent))
      .map((r) => `${r.enfant}.${r.colonne} → ${r.parent} (${r.aLaSuppression})`)
    expect(desParametres.sort()).toEqual([
      'parametres_facturation.dossier_id → dossiers (cascade)',
      'parametres_facturation.remplace_id → parametres_facturation (bloque)',
    ])
    // Aucune garde ne lit une version à l'insertion d'une autre ligne avant l'étape A7 : elle n'est pas un lien gardé.
    expect(LIENS_GARDES.some((r) => TABLES_DES_PARAMETRES_FACTURATION.includes(r.enfant) || TABLES_DES_PARAMETRES_FACTURATION.includes(r.parent)))
      .toBe(false)
  })

  it('après les contacts, à la fin de ce qui ne dépend que du dossier — avant les devis et `exercices_valides`', () => {
    const rang = (t: string) => ORDRE_RESTAURATION_PREVU.indexOf(t)
    expect(ORDRE_RESTAURATION_PREVU[rang('parametres_facturation') - 1]).toBe('contacts')
    // Depuis l'étape VF6b, le journal des désignations les suit (sauvegardeDesignations.test.ts), puis les devis.
    expect(ORDRE_RESTAURATION_PREVU[rang('parametres_facturation') + 1]).toBe('designations_des_pieces')
    expect(rang('parametres_facturation')).toBeLessThan(rang('devis_numerotation'))
    expect(rang('parametres_facturation')).toBeGreaterThan(rang('dossiers'))
    expect(rang('parametres_facturation')).toBeLessThan(rang('exercices_valides'))
  })

  it('l’ordre prévu respecte toutes les dépendances, et les chemins se suivent', () => {
    expect(violationsOrdre(ORDRE_RESTAURATION_PREVU, [...RELATIONS_PREVUES, ...LIENS_GARDES])).toEqual([])
    expect(tablesSansChemin(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS)).toEqual([])
    const plan = planExportDossier(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS).map((e) => e.table)
    for (const table of TABLES_DES_PARAMETRES_FACTURATION) expect(plan, table).toContain(table)
  })

  it('un défaut planté se voit : la table avant son dossier', () => {
    const plante = ORDRE_RESTAURATION_PREVU.filter((t) => t !== 'parametres_facturation')
    plante.splice(plante.indexOf('dossiers'), 0, 'parametres_facturation')
    expect(violationsOrdre(plante, [...RELATIONS_PREVUES, ...LIENS_GARDES]).map((v) => `${v.enfant} → ${v.parent}`))
      .toContain('parametres_facturation → dossiers')
  })
})

describe('la chaîne des versions se réinsère par vagues', () => {
  it('drapeau levé : la première, puis chaque version après celle qu’elle remplace, même lues dans le désordre ; baissé : rien n’en part', () => {
    const plan = planReinsertion({
      dossiers: [{ id: 'd' }],
      parametres_facturation: [
        { id: 'p3', dossier_id: 'd', remplace_id: 'p2', iban: 'FR9399999000010000000000100', rib_etat: 'propose' },
        { id: 'p1', dossier_id: 'd', remplace_id: null, iban: null, rib_etat: null },
        { id: 'p2', dossier_id: 'd', remplace_id: 'p1', iban: 'FR1299999000010000000000200', rib_etat: 'confirme' },
      ],
    })
    expect(plan.etapes.filter((e) => e.table === 'parametres_facturation').map((e) => e.lignes.map((l) => l.id)))
      .toEqual(PARAMETRES_FACTURATION_EXPORTES ? [['p1'], ['p2'], ['p3']] : [])
    expect(plan.secondePasse).toEqual([])
  })
})
