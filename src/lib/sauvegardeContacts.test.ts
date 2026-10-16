import { describe, expect, it } from 'vitest'
import { CONTACTS_EXPORTES } from './contacts'
import {
  auPlanAujourdHui,
  auPlanDesContacts,
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
  tablesSansChemin,
  violationsOrdre,
} from './sauvegarde'

// LES CONTACTS AU PLAN DE SAUVEGARDE (espace client, étape A4a). Leur migration est appliquée et exportée : le drapeau
// est levé, et le plan effectif nomme leur table partout — rebaissé (avant tout retour arrière de la migration), il ne
// devrait plus RIEN en dire : une sauvegarde lirait une table absente et échouerait. Le plan PRÉVU est celui du jour. Les
// tests qui confrontent le plan au schéma exporté (`sauvegardeRelations`, `sauvegardeTables`, `sauvegardeClesPrimaires`,
// `sauvegarde`) jugent l'état effectif ; celui-ci juge le plan prévu, et le lien des deux.

describe('le filtre du plan, côté contacts', () => {
  it('la table des contacts n’est au plan que le drapeau levé ; toute autre l’est toujours', () => {
    expect(TABLES_DES_CONTACTS).toEqual(['contacts'])
    for (const table of TABLES_DES_CONTACTS) {
      expect(auPlanDesContacts(table, false), table).toBe(false)
      expect(auPlanDesContacts(table, true), table).toBe(true)
    }
    for (const table of ['dossiers', 'articles', 'adresses_reception', 'devis', 'contact', 'exercices_valides']) {
      expect(auPlanDesContacts(table, false), table).toBe(true)
      expect(auPlanDesContacts(table, true), table).toBe(true)
    }
  })

  it('le filtre du jour suit le drapeau des contacts', () => {
    expect(auPlanAujourdHui('contacts')).toBe(CONTACTS_EXPORTES)
    expect(auPlanAujourdHui('dossiers')).toBe(true)
  })

  it('aucune table n’est à la fois des contacts et d’un autre drapeau : chaque drapeau garde les siennes', () => {
    const autres = [...TABLES_DES_DEVIS, ...TABLES_DES_ARTICLES, ...TABLES_DES_ADRESSES_RECEPTION]
    expect(TABLES_DES_CONTACTS.filter((t) => autres.includes(t))).toEqual([])
  })

  it('drapeau baissé, le plan effectif ne nomme pas les contacts — drapeau levé, partout', () => {
    const nommees = new Set([
      ...RELATIONS.flatMap((r) => [r.enfant, r.parent]), ...ORDRE_RESTAURATION, ...Object.keys(CHEMINS_DOSSIER),
      ...TABLES_AUTO_REFERENCEES_PAR_VAGUES.map((a) => a.table),
    ])
    for (const table of TABLES_DES_CONTACTS) expect(nommees.has(table), table).toBe(CONTACTS_EXPORTES)
    // Leur clé est la clé commune : aucune ligne dans les clés déclarées, prévues ou non.
    expect(Object.keys(CLES_PRIMAIRES_PREVUES)).not.toContain('contacts')
    expect(Object.keys(CLES_PRIMAIRES)).not.toContain('contacts')
    expect(clePrimaire('contacts')).toEqual(['id'])
  })
})

describe('le plan prévu, contacts compris', () => {
  it('la table y entre partout : l’ordre, le chemin, le graphe — et aucune vague, un contact ne pointe aucun contact', () => {
    for (const table of TABLES_DES_CONTACTS) {
      expect(ORDRE_RESTAURATION_PREVU.filter((t) => t === table), table).toHaveLength(1)
      expect(CHEMINS_DOSSIER_PREVUS[table], table).toEqual({ acces: 'direct' })
      expect(RELATIONS_PREVUES.some((r) => r.enfant === table), table).toBe(true)
    }
    expect(TABLES_AUTO_REFERENCEES_PAR_VAGUES_PREVUES.some((a) => a.table === 'contacts')).toBe(false)
    expect(TABLES_AUTO_REFERENCEES.some((a) => a.table === 'contacts')).toBe(false)
  })

  it('sa relation, telle que la migration la déclare : son dossier, en cascade — et aucune table ne le pointe', () => {
    const desContacts = RELATIONS_PREVUES
      .filter((r) => TABLES_DES_CONTACTS.includes(r.enfant) || TABLES_DES_CONTACTS.includes(r.parent))
      .map((r) => `${r.enfant}.${r.colonne} → ${r.parent} (${r.aLaSuppression})`)
    expect(desContacts).toEqual(['contacts.dossier_id → dossiers (cascade)'])
    // Une facture garde la COPIE de son client : aucune clé, aucune garde ne lit un contact.
    expect(LIENS_GARDES.some((r) => TABLES_DES_CONTACTS.includes(r.enfant) || TABLES_DES_CONTACTS.includes(r.parent))).toBe(false)
  })

  it('après les adresses de réception, à la fin de ce qui ne dépend que du dossier — avant les devis et `exercices_valides`', () => {
    const rang = (t: string) => ORDRE_RESTAURATION_PREVU.indexOf(t)
    expect(ORDRE_RESTAURATION_PREVU[rang('contacts') - 1]).toBe('adresses_reception')
    // Depuis l'étape A5a, les paramètres de facturation les suivent (sauvegardeParametresFacturation.test.ts), puis les devis.
    expect(ORDRE_RESTAURATION_PREVU[rang('contacts') + 1]).toBe('parametres_facturation')
    expect(rang('contacts')).toBeLessThan(rang('devis_numerotation'))
    expect(rang('contacts')).toBeGreaterThan(rang('dossiers'))
    expect(rang('contacts')).toBeLessThan(rang('exercices_valides'))
  })

  it('l’ordre prévu respecte toutes les dépendances, et les chemins se suivent', () => {
    expect(violationsOrdre(ORDRE_RESTAURATION_PREVU, [...RELATIONS_PREVUES, ...LIENS_GARDES])).toEqual([])
    expect(tablesSansChemin(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS)).toEqual([])
    const plan = planExportDossier(ORDRE_RESTAURATION_PREVU, CHEMINS_DOSSIER_PREVUS).map((e) => e.table)
    for (const table of TABLES_DES_CONTACTS) expect(plan, table).toContain(table)
  })

  it('un défaut planté se voit : la table avant son dossier', () => {
    const plante = ORDRE_RESTAURATION_PREVU.filter((t) => t !== 'contacts')
    plante.splice(plante.indexOf('dossiers'), 0, 'contacts')
    expect(violationsOrdre(plante, [...RELATIONS_PREVUES, ...LIENS_GARDES]).map((v) => `${v.enfant} → ${v.parent}`))
      .toContain('contacts → dossiers')
  })
})

describe('les contacts se réinsèrent en une fois, effacés et retirés compris', () => {
  it('drapeau levé : une étape, toutes les lignes ; baissé : rien n’en part', () => {
    const plan = planReinsertion({
      dossiers: [{ id: 'd' }],
      contacts: [
        { id: 'c1', dossier_id: 'd', nom: 'Société Essai', retire_le: null, efface_le: null },
        { id: 'c2', dossier_id: 'd', nom: 'Contact effacé le 15/10/2026', retire_le: null, efface_le: '2026-10-15T08:00:00Z' },
      ],
    })
    expect(plan.etapes.filter((e) => e.table === 'contacts').map((e) => e.lignes.map((l) => l.id)))
      .toEqual(CONTACTS_EXPORTES ? [['c1', 'c2']] : [])
    expect(plan.secondePasse).toEqual([])
  })
})
