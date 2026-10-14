import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ADRESSES_RECEPTION_EXPORTEES } from './adressesReception'
import { CLES_DE_L_ETAT, etatDeLaFactureElectronique, lireEtatFactureElectronique } from './etatFactureElectronique'
import type { EtatFactureElectroniqueLu } from './types'
import { derniereDefinitionSql } from '../test/schema'

// L'ÉTAT DE LA FACTURE ÉLECTRONIQUE, LU SANS RIEN DEVINER (espace client, étape A6a). Les clés que le module attend sont
// celles que la fonction rend : confrontées à l'essai `supabase/essais/etatFactureElectronique.sql` (contrôles 22, 26, 27
// et 91, qui exigent de la base chaque clé et son type), et, le jour où l'export porte la migration, au texte même de
// `etat_facture_electronique`.

const ESSAI = readFileSync(new URL('../../supabase/essais/etatFactureElectronique.sql', import.meta.url), 'utf8')

// Ce que l'essai exige d'une étape : la valeur attendue, l'apostrophe doublée rendue simple.
function attenduDe(num: string): string {
  const m = new RegExp(`\\('${num}', '\\w+', '(?:[^']|'')*', '\\w+', (?:null|'\\w+'),\\s*\\$q\\$[\\s\\S]*?\\$q\\$,\\s*'OK', '((?:[^']|'')*)'`).exec(ESSAI)
  if (!m) throw new Error(`étape ${num} introuvable dans etatFactureElectronique.sql`)
  return m[1].replace(/''/g, "'")
}

// « cle=type,cle=type » : les clés d'un niveau, triées.
const clesDe = (liste: string) => liste.split(',').map((x) => x.split('=')[0])
const trie = (cles: readonly string[]) => [...cles].sort()

describe('les clés que le module attend sont celles que la base rend', () => {
  it('l’essai exige de la base chaque clé de chaque niveau, et son type (contrôles 22 et 91)', () => {
    const [racine, plateforme, superpdp, adresse] = attenduDe('22').split(' | ')
    expect(clesDe(racine)).toEqual(trie(CLES_DE_L_ETAT.racine))
    expect(clesDe(plateforme)).toEqual(trie(CLES_DE_L_ETAT.plateforme))
    expect(clesDe(superpdp)).toEqual(trie(CLES_DE_L_ETAT.superpdp))
    expect(adresse).toBe('null')
    expect(plateforme).toContain('reliee=boolean')
    expect(superpdp).toContain('relie=boolean')
    expect(clesDe(attenduDe('91'))).toEqual(trie(CLES_DE_L_ETAT.adresse))
  })

  it('l’état d’un dossier où rien n’est relié ni déclaré, tel que la base l’exige (contrôle 26), se lit', () => {
    const vide = /= '(\{[^']*\})'::jsonb/.exec(ESSAI.slice(ESSAI.indexOf("('26', 'valeur'")))?.[1]
    expect(vide).toBeDefined()
    const lu = lireEtatFactureElectronique(JSON.parse(vide as string))
    expect(lu).toEqual({
      plateforme: { reliee: false, nom: null, creee_le: null, derniere_recuperation: null, statuts_lus_le: null },
      superpdp: { relie: false, depuis: null },
      adresse: null,
    })
  })

  it('aucune clé ne nomme ce que la fonction ne rend jamais', () => {
    const toutes = Object.values(CLES_DE_L_ETAT).flat()
    for (const interdite of ['url_flux', 'url_jeton', 'client_id', 'client_secret', 'organisation_id', 'portee', 'recherche_depuis',
      'cycle_vie_depuis', 'created_by', 'updated_at']) {
      expect(toutes).not.toContain(interdite)
    }
  })

  it('exportée, la fonction rend ces clés-là, dans cet ordre, et ne lit rien d’autre des connexions', () => {
    if (!ADRESSES_RECEPTION_EXPORTEES) return
    const sql = derniereDefinitionSql('etat_facture_electronique')
    expect(sql).toMatch(/etat_facture_electronique\(p_dossier_id uuid\)\nreturns jsonb\nlanguage plpgsql\nstable\nsecurity definer\nset search_path = public/)
    const premierAppel = sql.indexOf('return jsonb_build_object(')
    // Une clé est suivie de sa valeur, sur la même ligne ou sur la suivante (l'adresse) : la virgule, puis un blanc.
    const cles = [...sql.slice(premierAppel).matchAll(/'(\w+)',\s/g)].map((m) => m[1])
    // Le texte nomme chaque clé à sa place : la racine, la plateforme reliée, puis non reliée, Super PDP relié, puis non, l'adresse.
    expect(cles).toEqual([
      'plateforme', ...CLES_DE_L_ETAT.plateforme, ...CLES_DE_L_ETAT.plateforme,
      'superpdp', ...CLES_DE_L_ETAT.superpdp, ...CLES_DE_L_ETAT.superpdp,
      'adresse', ...CLES_DE_L_ETAT.adresse,
    ])
    for (const colonne of ['url_flux', 'url_jeton', 'client_id', 'client_secret', 'organisation_id', 'portee', 'recherche_depuis',
      'cycle_vie_depuis', 'created_by', 'updated_at']) {
      expect(sql, colonne).not.toMatch(new RegExp(`\\b${colonne}\\b`))
    }
  })
})

// ── La lecture ─────────────────────────────────────────────────────────────────────────────────────────────────────

const ADRESSE = {
  id: 'a6a60000-0000-4000-8000-0000000000f1', forme: 'siren_suffixe', identifiant: '123456782_FACTURES.achats-1@siege',
  plateforme: 'PLATEFORME TROIS', prise_effet: '2026-10-01', verification: 'plateforme', verifiee_le: '2026-10-14',
  auteur: '797fe440-df8d-4b8e-828b-d148927bfd60', cree_le: '2026-10-14T13:07:12.123456+00:00',
}
const RENDU = {
  plateforme: { reliee: true, nom: 'PLATEFORME ESSAI', creee_le: '2026-09-01T08:00:00+00:00', derniere_recuperation: '2026-10-01T07:30:00+00:00',
    statuts_lus_le: null },
  superpdp: { relie: false, depuis: null },
  adresse: ADRESSE,
}
const avec = (chemin: (o: Record<string, unknown>) => void) => {
  const copie = JSON.parse(JSON.stringify(RENDU)) as Record<string, unknown>
  chemin(copie)
  return copie
}
type Objet = Record<string, Record<string, unknown>>

describe('la valeur rendue, lue sans rien deviner', () => {
  it('se lit telle quelle, chaque champ à sa place', () => {
    expect(lireEtatFactureElectronique(RENDU)).toEqual(RENDU)
    // Super PDP relié, la plateforme non, une adresse déclarée sans vérification.
    const autre = avec((o) => {
      Object.assign(o, { plateforme: { reliee: false, nom: null, creee_le: null, derniere_recuperation: null, statuts_lus_le: null } })
      Object.assign(o, { superpdp: { relie: true, depuis: '2026-09-05T14:00:00+02:00' } })
      Object.assign((o as Objet).adresse, { forme: 'siren', identifiant: '123456782', verification: 'declaration', verifiee_le: null })
    })
    expect(lireEtatFactureElectronique(autre)).toEqual(autre)
  })

  it('une clé de plus, de moins, ou d’une autre forme : illisible, à chaque niveau', () => {
    const fautes: [string, (o: Record<string, unknown>) => void][] = [
      ['une clé de plus à la racine', (o) => { o.portee = 'x' }],
      ['la racine sans adresse', (o) => { delete o.adresse }],
      ['une clé de plus à la plateforme', (o) => { (o as Objet).plateforme.client_id = 'x' }],
      ['la longueur d’un secret', (o) => { (o as Objet).plateforme.longueur = 15 }],
      ['la plateforme sans son nom', (o) => { delete (o as Objet).plateforme.nom }],
      ['« reliee » en texte', (o) => { (o as Objet).plateforme.reliee = 'true' }],
      ['reliée sans date de création', (o) => { (o as Objet).plateforme.creee_le = null }],
      ['reliée, une date illisible', (o) => { (o as Objet).plateforme.derniere_recuperation = '01/10/2026' }],
      ['non reliée mais nommée', (o) => { Object.assign((o as Objet).plateforme, { reliee: false, creee_le: null, derniere_recuperation: null }) }],
      ['Super PDP relié sans date', (o) => { (o as Objet).superpdp.relie = true }],
      ['Super PDP non relié mais daté', (o) => { (o as Objet).superpdp.depuis = '2026-09-05T12:00:00+00:00' }],
      ['Super PDP, une clé de plus', (o) => { (o as Objet).superpdp.client_secret = 'x' }],
      ['l’adresse, une clé de plus', (o) => { (o as Objet).adresse.dossier_id = ADRESSE.id }],
      ['l’adresse sans son auteur', (o) => { delete (o as Objet).adresse.auteur }],
      ['une maille inconnue', (o) => { (o as Objet).adresse.forme = 'siret' }],
      ['un identifiant hors de sa maille', (o) => { (o as Objet).adresse.identifiant = '123456782_A/B' }],
      ['un SIRET d’une autre entreprise', (o) => { Object.assign((o as Objet).adresse, { forme: 'siren_siret', identifiant: '123456782_98765432100015' }) }],
      ['une prise d’effet hors des bornes de la table', (o) => { (o as Objet).adresse.prise_effet = '1999-12-31' }],
      ['une prise d’effet qui n’existe pas', (o) => { (o as Objet).adresse.prise_effet = '2026-02-30' }],
      ['vérifiée sans jour', (o) => { (o as Objet).adresse.verifiee_le = null }],
      ['déclarée sans vérification, mais datée', (o) => { (o as Objet).adresse.verification = 'declaration' }],
      ['une source de vérification inconnue', (o) => { (o as Objet).adresse.verification = 'annuaire' }],
      ['un nom de plateforme fait de blancs', (o) => { (o as Objet).adresse.plateforme = ' \t' }],
      ['un nom de plateforme de cent caractères', (o) => { (o as Objet).adresse.plateforme = 'p'.repeat(100) }],
      ['un identifiant qui n’est pas un uuid', (o) => { (o as Objet).adresse.id = 'a1' }],
      ['un instant sans fuseau', (o) => { (o as Objet).adresse.cree_le = '2026-10-14 13:07:12' }],
      ['un instant sans fuseau, à la forme ISO', (o) => { (o as Objet).adresse.cree_le = '2026-10-14T13:07:12' }],
      ['un auteur qui n’est pas un uuid', (o) => { (o as Objet).adresse.auteur = 'chef' }],
      ['une adresse vide', (o) => { (o as Objet).adresse = {} }],
    ]
    for (const [quoi, faute] of fautes) expect(lireEtatFactureElectronique(avec(faute)), quoi).toBeNull()
    for (const autre of [null, undefined, [], 'texte', 3, true, [RENDU]]) expect(lireEtatFactureElectronique(autre)).toBeNull()
  })
})

// ── L'état que l'encart dit ─────────────────────────────────────────────────────────────────────────────────────────

const lu = (o: Partial<{ plateforme: boolean; superpdp: boolean; adresse: string | null }>): EtatFactureElectroniqueLu => ({
  plateforme: o.plateforme
    ? { reliee: true, nom: 'P', creee_le: '2026-09-01T08:00:00+00:00', derniere_recuperation: null, statuts_lus_le: null }
    : { reliee: false, nom: null, creee_le: null, derniere_recuperation: null, statuts_lus_le: null },
  superpdp: o.superpdp ? { relie: true, depuis: '2026-09-05T12:00:00+00:00' } : { relie: false, depuis: null },
  adresse: o.adresse === null || o.adresse === undefined ? null : {
    id: ADRESSE.id, forme: 'siren', identifiant: '123456782', plateforme: 'P', prise_effet: o.adresse, verification: 'declaration',
    verifiee_le: null, auteur: ADRESSE.auteur, cree_le: ADRESSE.cree_le,
  },
})

describe('l’état que l’encart dit, au jour de Paris DONNÉ', () => {
  it('« active » : une plateforme OU Super PDP reliés, ET une adresse en vigueur — le jour même de sa prise d’effet compris', () => {
    expect(etatDeLaFactureElectronique(lu({ plateforme: true, adresse: '2026-10-14' }), '2026-10-14'))
      .toMatchObject({ etat: 'active', reliees: ['plateforme_agreee'] })
    expect(etatDeLaFactureElectronique(lu({ superpdp: true, adresse: '2026-09-01' }), '2026-10-14'))
      .toMatchObject({ etat: 'active', reliees: ['superpdp'] })
    const lesDeux = etatDeLaFactureElectronique(lu({ plateforme: true, superpdp: true, adresse: '2026-09-01' }), '2026-10-14')
    expect(lesDeux).toMatchObject({ etat: 'active', reliees: ['plateforme_agreee', 'superpdp'] })
    expect(lesDeux.etat === 'active' && lesDeux.adresse.identifiant).toBe('123456782')
  })

  it('« à compléter » : ce qui manque, nommé — la plateforme, l’adresse, ou son jour à venir', () => {
    expect(etatDeLaFactureElectronique(lu({ adresse: '2026-09-01' }), '2026-10-14')).toEqual({
      etat: 'a_completer',
      manque: [{ cle: 'aucune_plateforme', libelle: 'aucune plateforme de réception reliée (plateforme agréée ou Super PDP)' }],
    })
    expect(etatDeLaFactureElectronique(lu({ plateforme: true }), '2026-10-14')).toEqual({
      etat: 'a_completer', manque: [{ cle: 'aucune_adresse', libelle: 'aucune adresse de réception déclarée' }],
    })
    expect(etatDeLaFactureElectronique(lu({ superpdp: true, adresse: '2026-10-15' }), '2026-10-14')).toEqual({
      etat: 'a_completer',
      manque: [{ cle: 'adresse_a_venir', libelle: 'l’adresse de réception déclarée ne prend effet que le 15/10/2026' }],
    })
    expect(etatDeLaFactureElectronique(lu({}), '2026-10-14')).toMatchObject({
      etat: 'a_completer', manque: [{ cle: 'aucune_plateforme' }, { cle: 'aucune_adresse' }],
    })
    expect(etatDeLaFactureElectronique(lu({ adresse: '2026-11-01' }), '2026-10-14')).toMatchObject({
      etat: 'a_completer', manque: [{ cle: 'aucune_plateforme' }, { cle: 'adresse_a_venir' }],
    })
  })

  it('le jour est celui que l’appelant donne : le lendemain, l’adresse à venir est en vigueur ; un jour illisible lève', () => {
    expect(etatDeLaFactureElectronique(lu({ plateforme: true, adresse: '2026-10-15' }), '2026-10-15').etat).toBe('active')
    expect(() => etatDeLaFactureElectronique(lu({ plateforme: true, adresse: '2026-10-15' }), '15/10/2026')).toThrow()
  })
})
