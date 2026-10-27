import { describe, expect, it } from 'vitest'
import { derniereDefinitionSql, fichiersDuSchema } from '../test/schema'
import {
  DOSSIER_FERME_PAR_LE_CABINET, POUR_OUVRIR_LE_DOSSIER, dossiersAVerifier, dossiersOuverts, ouvertureIllisible,
  type AccesDuCompte, type OuvertureLue,
} from './dossiersOuverts'

// LA LISTE DES DOSSIERS D'UN MEMBRE DE L'ÉQUIPE (23Q2Q2Q1-Q1) : ceux que le cabinet lui ouvre, et eux seuls. Un dossier rendu où
// le compte n'a aucun accès client est ouvert ; un dossier où il en a un ne l'est que si `admin_du_dossier` le dit ; ce qui n'a
// pas pu être vérifié manque, et le motif le dit. Données FICTIVES.

const D = (id: string) => ({ id, nom: `Dossier ${id}` })
const acces = (...ids: string[]): AccesDuCompte => ({ dossiers: new Set(ids) })
const ouvertures = (entrees: Record<string, OuvertureLue>) => new Map(Object.entries(entrees))
const ids = (r: { dossiers: { id: string }[] }) => r.dossiers.map((d) => d.id)

describe('dossiersAVerifier — l’ouverture ne se demande que là où le compte a un accès client', () => {
  it('les dossiers rendus où il en a un, chacun une fois, dans l’ordre reçu', () => {
    expect(dossiersAVerifier([D('a'), D('b'), D('c'), D('b')], acces('c', 'b', 'z'))).toEqual(['b', 'c'])
  })

  it('aucun accès client : rien à demander', () => {
    expect(dossiersAVerifier([D('a'), D('b')], acces())).toEqual([])
  })

  it('des accès illisibles : rien à demander — la liste sera vide, et le dira', () => {
    expect(dossiersAVerifier([D('a')], { illisibles: 'lecture interrompue' })).toEqual([])
  })
})

describe('dossiersOuverts — la règle', () => {
  it('un dossier sans accès client du compte est ouvert, sans rien demander', () => {
    expect(dossiersOuverts([D('a'), D('b')], acces(), ouvertures({}))).toEqual({ dossiers: [D('a'), D('b')], motif: null })
  })

  it('un dossier où il a un accès client ne reste que si son ouverture vaut vrai', () => {
    const r = dossiersOuverts([D('a'), D('b'), D('c')], acces('a', 'b'), ouvertures({ a: { ouvert: true }, b: { ouvert: false } }))
    expect(ids(r)).toEqual(['a', 'c'])
    expect(r.motif).toBeNull()
  })

  it('garde l’ordre reçu, et rend les lignes telles quelles', () => {
    const lignes = [{ id: 'z', nom: 'Zéta', extra: 1 }, { id: 'a', nom: 'Alpha', extra: 2 }]
    const r = dossiersOuverts(lignes, acces('z'), ouvertures({ z: { ouvert: true } }))
    expect(r.dossiers).toEqual(lignes)
    expect(r.dossiers[0]).toBe(lignes[0])
  })

  it('une ouverture illisible : le dossier manque, et le motif le dit avec sa raison', () => {
    const r = dossiersOuverts([D('a'), D('b')], acces('b'), ouvertures({ b: { illisible: 'statement timeout' } }))
    expect(ids(r)).toEqual(['a'])
    expect(r.motif).toBe('l’ouverture d’un dossier à ce compte n’a pas pu être vérifiée (statement timeout) : il ne s’affiche pas')
  })

  it('une ouverture jamais demandée tombe du même côté : le dossier manque', () => {
    const r = dossiersOuverts([D('a'), D('b')], acces('b'), ouvertures({}))
    expect(ids(r)).toEqual(['a'])
    expect(r.motif).toBe('l’ouverture d’un dossier à ce compte n’a pas pu être vérifiée (son ouverture n’a pas été demandée) : il ne s’affiche pas')
  })

  it('plusieurs illisibles : leur nombre, et la raison de la première', () => {
    const r = dossiersOuverts(
      [D('a'), D('b'), D('c'), D('d')], acces('b', 'c', 'd'),
      ouvertures({ b: { illisible: 'première raison' }, c: { ouvert: false }, d: { illisible: 'seconde raison' } }),
    )
    expect(ids(r)).toEqual(['a'])
    expect(r.motif).toBe('l’ouverture de 2 dossiers à ce compte n’a pas pu être vérifiée (première raison) : ils ne s’affichent pas')
  })

  it('des accès illisibles : AUCUN dossier — faute de savoir lesquels le cabinet ouvre —, et le motif le dit', () => {
    const r = dossiersOuverts([D('a'), D('b')], { illisibles: 'lecture interrompue après 0 ligne(s) : refus' }, ouvertures({}))
    expect(r.dossiers).toEqual([])
    expect(r.motif).toBe('les accès client de ce compte n’ont pas pu être lus en entier (lecture interrompue après 0 ligne(s) : '
      + 'refus) : aucun dossier ne s’affiche, faute de savoir lesquels le cabinet lui ouvre')
  })

  // Le vide n'est une affirmation que d'une liste vérifiée : aucun dossier rendu, aucun motif.
  it('aucun dossier rendu : une liste vide, sans motif', () => {
    expect(dossiersOuverts([], acces('a'), ouvertures({}))).toEqual({ dossiers: [], motif: null })
  })
})

describe('dossiersOuverts — les phrases de la page d’un dossier', () => {
  it('la fermeture dit pourquoi les écrans manquent, sans rien affirmer du cabinet du dossier', () => {
    expect(DOSSIER_FERME_PAR_LE_CABINET).toMatch(/ne t’est pas ouvert dans l’espace du cabinet/)
    expect(DOSSIER_FERME_PAR_LE_CABINET).toMatch(/l’accès client de ton compte/)
    expect(POUR_OUVRIR_LE_DOSSIER).toMatch(/^S’il appartient à ton cabinet, /)
  })

  it('une ouverture illisible dit sa raison', () => {
    expect(ouvertureIllisible('refus')).toBe('L’ouverture de ce dossier à ton compte n’a pas pu être vérifiée (refus). Ses écrans ne '
      + 's’affichent pas : ils pourraient n’en montrer que ce qu’un client lit.')
  })
})

// CE QUE LA RÈGLE SUPPOSE DE LA BASE, CONFRONTÉ À L'EXPORT (supabase/schema). La règle ne demande l'ouverture que des dossiers où
// le compte a un accès client : elle suppose que `dossiers_select` n'a que DEUX branches — `admin_du_dossier`, ou un accès client
// —, qu'aucune autre policy ne rend un dossier en lecture, et qu'`admin_du_dossier` ne lit pas les accès client. Une branche de
// plus ferait paraître un dossier qu'elle n'ouvre pas ; une fonction qui lirait `memberships` ouvrirait au client ce que le cabinet
// ne lui ouvre pas. Le premier qui change fait tomber ce test, et la règle se revoit avec lui.
describe('dossiersOuverts — ce que la règle suppose de la base', () => {
  // Les policies de `dossiers`, rejouées dans l'ordre de l'export : une création ajoute, une suppression retire.
  function policiesDesDossiers(): Map<string, string> {
    const policies = new Map<string, string>()
    for (const { texte } of fichiersDuSchema()) {
      const sql = texte.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')
      // Une forme que ce relevé ne rejoue pas lève, au lieu d'être ignorée.
      if (/alter\s+policy\s+"?\w+"?\s+on\s+(?:public\.)?"?dossiers"?\s/i.test(sql)) throw new Error('alter policy sur dossiers : à rejouer')
      const motif = /(create|drop)\s+policy\s+(?:if\s+exists\s+)?"?(\w+)"?\s+on\s+(?:public\.)?"?(\w+)"?([^;]*);/gi
      for (const [, verbe, nom, table, reste] of sql.matchAll(motif)) {
        if (table !== 'dossiers') continue
        if (verbe.toLowerCase() === 'drop') policies.delete(nom)
        else policies.set(nom, reste.replace(/\s+/g, ' ').trim())
      }
    }
    return policies
  }

  it('une seule policy rend un dossier en lecture, et elle a deux branches : admin_du_dossier, ou un accès client', () => {
    // Sans `for`, une policy vaut pour toutes les commandes, la lecture comprise.
    const commande = (corps: string) => /\bfor\s+(all|select|insert|update|delete)\b/i.exec(corps)?.[1].toLowerCase() ?? 'all'
    const lecture = [...policiesDesDossiers()].filter(([, corps]) => ['select', 'all'].includes(commande(corps)))
    expect(lecture).toEqual([[
      'dossiers_select',
      'for select using (admin_du_dossier(id) or exists (select 1 from memberships m where m.dossier_id = dossiers.id and m.user_id = auth.uid()))',
    ]])
  })

  it('admin_du_dossier ouvre au super-administrateur, au chef du cabinet et au membre assigné — jamais par un accès client', () => {
    const corps = derniereDefinitionSql('admin_du_dossier')
    expect(corps).toMatch(/public\.is_super_admin\(\)/)
    expect(corps).toMatch(/ca\.role = 'comptable_en_chef'/)
    expect(corps).toMatch(/from dossier_assignations da where da\.dossier_id = p_dossier_id and da\.user_id = auth\.uid\(\)/)
    expect(corps).not.toMatch(/memberships/)
  })
})
