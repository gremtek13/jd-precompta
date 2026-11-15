import { afterEach, describe, expect, it, vi } from 'vitest'
import { definitionsSql, fichiersDuSchema, fichiersPrepares } from '../test/schema'

// A8B-Q3 : UN DOSSIER QUI PORTE DES FACTURES REPRISES NE PASSE PAS EN COMPTABILITÉ D'ENGAGEMENT. Le module redit le refus
// de la garde du modèle comptable (`verrouiller_modele_comptable`, la migration `reprises_retiennent_la_tresorerie`, en
// production depuis le 15/11/2026) : ses mots confrontés au texte de la DERNIÈRE définition — exportée —, son rang après le
// refus d'hier, le drapeau (levé) confronté à l'export, la règle sous ses deux états, et la lecture qui ne rejette jamais —
// l'état d'avant, le drapeau baissé, joué sur l'objet tant que son code existe. Données FICTIVES.

const faux = vi.hoisted(() => ({
  reponse: { count: 0 as number | null, error: null as unknown },
  leve: false,
  appels: [] as string[],
}))

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => {
      const filtres: string[] = []
      const r: Record<string, unknown> = {
        select: (colonnes: string, options: { count?: string; head?: boolean }) => {
          faux.appels.push(`${table} ${colonnes} ${options?.count} ${options?.head}`)
          return r
        },
        eq: (colonne: string, valeur: unknown) => { filtres.push(`${colonne}=${String(valeur)}`); return r },
        then: (suite: (x: unknown) => unknown, echec?: (e: unknown) => unknown) => {
          faux.appels.push(filtres.join(' '))
          if (faux.reponse.error === 'lève') return Promise.reject(new Error('réseau coupé')).then(suite, echec)
          return Promise.resolve({ data: null, ...faux.reponse }).then(suite, echec)
        },
      }
      return r
    },
  },
}))

const module = await import('./reprisesRetiennentLaTresorerie')
const { lireLesReprisesDuModele } = await import('./reprisesRetiennentLaTresorerieLecture')
const { DRAPEAU_DES_REPRISES_ET_DU_MODELE, REFUS_ENGAGEMENT_DES_REPRISES, REPRISES_NON_LUES, refusDuPassageEnEngagement } = module

afterEach(() => {
  DRAPEAU_DES_REPRISES_ET_DU_MODELE.REPRISES_RETIENNENT_LA_TRESORERIE_PREVUES = true
  faux.reponse = { count: 0, error: null }
  faux.appels = []
})

const MIGRATION = /\d{14}_reprises_retiennent_la_tresorerie\.sql$/
const EXPORTEE = fichiersDuSchema().some((f) => MIGRATION.test(f.chemin))
const TOUTES = [...fichiersDuSchema(), ...fichiersPrepares()]
  .sort((a, b) => (a.chemin.split('/').pop()! < b.chemin.split('/').pop()! ? -1 : 1))
const sansApostrophes = (s: string) => s.replace(/''/g, "'").replace(/’/g, "'")

/** Les messages des `raise exception` d'un corps, dans l'ordre du texte. */
function refusDuCorps(sql: string): string[] {
  return [...sql.matchAll(/raise exception '((?:[^']|'')*)'/g)].map((m) => sansApostrophes(m[1]))
}

describe('A8B-Q3 — la garde du modèle comptable, confrontée au texte de la migration', () => {
  const definitions = definitionsSql('verrouiller_modele_comptable', TOUTES)
  const derniere = definitions[definitions.length - 1]

  it('la dernière définition est celle de la migration, exportée, une seule fois', () => {
    expect(TOUTES.filter((f) => MIGRATION.test(f.chemin))).toHaveLength(1)
    expect(derniere.chemin).toMatch(MIGRATION)
  })

  it('redit le refus de la base à ses mots, APRÈS celui du brouillon, pour le seul passage vers l’engagement', () => {
    const refus = refusDuCorps(derniere.definition)
    expect(refus).toEqual([
      "Le modèle comptable d'un dossier ne se change que tant que son brouillon d'écritures est vide.",
      sansApostrophes(REFUS_ENGAGEMENT_DES_REPRISES),
    ])
    expect(derniere.definition).toContain("new.mode_comptable is distinct from old.mode_comptable and new.mode_comptable = 'engagement'")
    expect(derniere.definition).toContain("f.dossier_id = new.id and f.statut = 'importee'")
    // Celle d'avant ne portait que le refus du brouillon : le module ne disait rien de plus quand le drapeau était baissé.
    expect(refusDuCorps(definitions[definitions.length - 2].definition)).toEqual(refus.slice(0, 1))
  })

  it('le drapeau suit l’export : levé depuis que la migration y est entrée (15/11/2026)', () => {
    expect(EXPORTEE).toBe(true)
    expect(module.reprisesRetiennentLaTresoreriePrevues()).toBe(EXPORTEE)
  })
})

describe('A8B-Q3 — refusDuPassageEnEngagement, sous les deux états du drapeau', () => {
  const D = 'd0000000-0000-4000-8000-0000000000b3'
  it('baissé : rien ne retient, quoi que la lecture dise — l’écran d’hier', () => {
    for (const lecture of [null, { dossierId: D, etat: 'lue' as const, nombre: 3 }, { dossierId: D, etat: 'illisible' as const, motif: 'x' }]) {
      expect(refusDuPassageEnEngagement(lecture, D, false)).toBeNull()
    }
  })

  it('levé : une facture reprise retient sous les mots de la base ; aucune, rien', () => {
    expect(refusDuPassageEnEngagement({ dossierId: D, etat: 'lue', nombre: 1 }, D, true)).toBe(REFUS_ENGAGEMENT_DES_REPRISES)
    expect(refusDuPassageEnEngagement({ dossierId: D, etat: 'lue', nombre: 12 }, D, true)).toBe(REFUS_ENGAGEMENT_DES_REPRISES)
    expect(refusDuPassageEnEngagement({ dossierId: D, etat: 'lue', nombre: 0 }, D, true)).toBeNull()
  })

  it('levé : une lecture absente, illisible ou d’un autre dossier retient — jamais « aucune » deviné', () => {
    expect(refusDuPassageEnEngagement(null, D, true)).toBe(REPRISES_NON_LUES)
    expect(refusDuPassageEnEngagement({ dossierId: D, etat: 'illisible', motif: 'délai' }, D, true)).toBe(REPRISES_NON_LUES)
    expect(refusDuPassageEnEngagement({ dossierId: 'autre', etat: 'lue', nombre: 0 }, D, true)).toBe(REPRISES_NON_LUES)
  })
})

describe('A8B-Q3 — lireLesReprisesDuModele', () => {
  const D = 'd0000000-0000-4000-8000-0000000000b3'
  it('baissé : rien n’est lu, sans appel au réseau', async () => {
    DRAPEAU_DES_REPRISES_ET_DU_MODELE.REPRISES_RETIENNENT_LA_TRESORERIE_PREVUES = false
    expect(await lireLesReprisesDuModele(D)).toBeNull()
    expect(faux.appels).toEqual([])
  })

  it('levé : un compte des factures « importee » du dossier, sans ligne rendue', async () => {
    DRAPEAU_DES_REPRISES_ET_DU_MODELE.REPRISES_RETIENNENT_LA_TRESORERIE_PREVUES = true
    faux.reponse = { count: 2, error: null }
    expect(await lireLesReprisesDuModele(D)).toEqual({ dossierId: D, etat: 'lue', nombre: 2 })
    expect(faux.appels).toEqual(['factures_emises id exact true', `dossier_id=${D} statut=importee`])
  })

  it('levé : une erreur, un compte absent ou une requête qui lève rendent une lecture illisible', async () => {
    DRAPEAU_DES_REPRISES_ET_DU_MODELE.REPRISES_RETIENNENT_LA_TRESORERIE_PREVUES = true
    faux.reponse = { count: null, error: { message: 'délai dépassé' } }
    expect(await lireLesReprisesDuModele(D)).toEqual({ dossierId: D, etat: 'illisible', motif: 'délai dépassé' })
    faux.reponse = { count: null, error: null }
    expect(await lireLesReprisesDuModele(D)).toEqual({ dossierId: D, etat: 'illisible', motif: 'la base n’a pas rendu de compte' })
    faux.reponse = { count: null, error: 'lève' }
    expect((await lireLesReprisesDuModele(D))?.etat).toBe('illisible')
  })
})
