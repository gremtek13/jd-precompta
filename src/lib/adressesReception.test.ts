import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ADRESSES_RECEPTION_EXPORTEES,
  BLANCS,
  DERNIER_JOUR,
  MAILLES_ADRESSE,
  PLATEFORME_MAX,
  PREDICAT_DE_LA_DECLARATION,
  PREMIER_JOUR,
  REFUS_DECLARATION_ADRESSE,
  VERIFICATIONS,
  aLaFormeDeSaMaille,
  estUnJourCivil,
  maillesPossibles,
  refusDeclarationAdresse,
  versionCourante,
  type SaisieAdresseReception,
} from './adressesReception'
import { sirenDuDossier } from './factureElectronique'
import { dateAParis, formatDate } from './format'
import { FORME_ADRESSE_ELECTRONIQUE } from './mentionsFacture'
import type { AdresseReception } from './types'
import { decouper } from '../test/essaiSql'
import { derniereDefinitionSql, fichiersDuSchema } from '../test/schema'

// LE MODULE DE L'ADRESSE DE RÉCEPTION, CONFRONTÉ À LA BASE (espace client, étape A6a). La migration est appliquée, et
// l'export (supabase/schema) la porte : ce test confronte le module au texte même de la migration et de ses fonctions. Sa
// première RÉFÉRENCE reste l'essai `supabase/essais/etatFactureElectronique.sql`, joué sur une réplique de la production
// munie de la migration, puis en production : chacun de ses contrôles exige de la base un code ET des mots. Ce test exige
// que chaque refus du module y soit exigé de la fonction, et REJOUE dans le module les déclarations de l'essai, dans leur
// ordre, sur l'état que ses étapes gardées construisent : le même premier refus, ou aucun.

const ESSAI = readFileSync(new URL('../../supabase/essais/etatFactureElectronique.sql', import.meta.url), 'utf8')
const RLS = readFileSync(new URL('../../supabase/essais/rls.sql', import.meta.url), 'utf8')

interface EtapeDeLEssai {
  num: string
  genre: string
  qui: string
  droits: string | null
  ordre: string
  code: string
  attendu: string | null
  // La clé sous laquelle l'essai garde ce que l'étape a rendu (l'identifiant d'une adresse déclarée).
  cle: string | null
}

const sansDoubles = (texte: string) => texte.replace(/''/g, "'")

function etapesDeLEssai(texte: string): EtapeDeLEssai[] {
  const motif = /\('(\w+)', '(jeu|controle|fait|valeur|mutation)', '(?:[^']|'')*', '(\w+)', (null|'\w+'),\s*\$q\$([\s\S]*?)\$q\$,\s*'(\w+)', (null|'((?:[^']|'')*)'), (null|'\w+')\)/g
  return [...texte.matchAll(motif)].map((m) => ({
    num: m[1], genre: m[2], qui: m[3], droits: m[4] === 'null' ? null : m[4].slice(1, -1), ordre: m[5], code: m[6],
    attendu: m[8] === undefined ? null : sansDoubles(m[8]), cle: m[9] === 'null' ? null : m[9].slice(1, -1),
  }))
}

// Un modèle du module, en expression régulière : chaque « % » une valeur.
const modeleEnRegex = (modele: string) =>
  new RegExp(`^${modele.split('%').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s\\S]*')}$`)

const ETAPES = etapesDeLEssai(ESSAI)
const etape = (num: string) => {
  const e = ETAPES.find((x) => x.num === num)
  if (!e) throw new Error(`étape ${num} introuvable dans etatFactureElectronique.sql`)
  return e
}
const declare = (e: EtapeDeLEssai) => e.ordre.includes('public.declarer_adresse_reception(')

describe('l’essai, lu', () => {
  it('ses étapes, toutes : trois de jeu, cent vingt-huit jugées, dont seize mutations', () => {
    // Le plancher qui distingue « aucun écart » d'« aveugle » : un motif qui ne reconnaîtrait plus les étapes rendrait une
    // liste vide, et toutes les confrontations ci-dessous passeraient sans rien confronter.
    const ouvertes = [...ESSAI.matchAll(/^\s*\('\w+', '(?:jeu|controle|fait|valeur|mutation)'/gm)].length
    expect(ETAPES).toHaveLength(ouvertes)
    expect(ETAPES.filter((e) => e.genre === 'jeu')).toHaveLength(3)
    expect(ETAPES.filter((e) => e.genre !== 'jeu')).toHaveLength(128)
    expect(ETAPES.filter((e) => e.genre === 'mutation')).toHaveLength(16)
    expect(new Set(ETAPES.map((e) => e.num)).size).toBe(ETAPES.length)
    // Soixante et une déclarations jugées : cinquante-trois passent l'accès et se rejouent, huit sont des refus d'accès.
    expect(ETAPES.filter(declare)).toHaveLength(61)
  })
})

// ── 1. Chaque refus du module est exigé de la base par l'essai, sous son code et ses mots ─────────────────────────────

describe('les refus du module sont ceux que la base rend', () => {
  const exiges = ETAPES.filter((e) => e.genre === 'controle' && e.code !== 'OK' && e.attendu != null && declare(e))

  it('chaque refus est exigé par un contrôle de l’essai, sous son code et ses mots', () => {
    for (const r of REFUS_DECLARATION_ADRESSE) {
      const temoins = exiges.filter((e) => modeleEnRegex(r.modele).test(e.attendu as string))
      expect(temoins.length, `le refus « ${r.cle} » n'est exigé par aucun contrôle de etatFactureElectronique.sql`).toBeGreaterThan(0)
      for (const e of temoins) expect(e.code, `contrôle ${e.num}`).toBe(r.code)
    }
  })

  it('et chaque refus que l’essai exige de la fonction — hors le droit d’exécution — est un refus du module', () => {
    for (const e of exiges.filter((x) => !(x.attendu as string).startsWith('permission denied'))) {
      expect(REFUS_DECLARATION_ADRESSE.some((r) => modeleEnRegex(r.modele).test(e.attendu as string)), `contrôle ${e.num}`).toBe(true)
    }
  })

  it('sept rangs, dix-neuf messages, dans l’ordre de la conception ; l’accès d’abord', () => {
    expect(REFUS_DECLARATION_ADRESSE).toHaveLength(19)
    expect(new Set(REFUS_DECLARATION_ADRESSE.map((r) => r.cle)).size).toBe(19)
    const rangs = [...new Set(REFUS_DECLARATION_ADRESSE.map((r) => r.rang))]
    expect(rangs).toEqual([1, 2, 3, 4, 5, 6, 7])
    // Les rangs se suivent sans revenir en arrière.
    const suite = REFUS_DECLARATION_ADRESSE.map((r) => r.rang)
    expect(suite).toEqual([...suite].sort((a, b) => a - b))
    expect(REFUS_DECLARATION_ADRESSE[0]).toEqual({ cle: 'acces', rang: 1, code: '42501', modele: 'Accès refusé à ce dossier.' })
    expect(REFUS_DECLARATION_ADRESSE.filter((r) => r.code !== '22023').map((r) => r.cle)).toEqual(['acces'])
    // Les rangs de la conception, chacun à sa place : la forme (2), le SIREN (3), la prise d'effet (4), la version (7).
    const rangDe = (cle: string) => REFUS_DECLARATION_ADRESSE.find((r) => r.cle === cle)?.rang
    expect([rangDe('forme_siren'), rangDe('siren_du_dossier'), rangDe('prise_effet_absente'), rangDe('remplacee_pas_courante')])
      .toEqual([2, 3, 4, 7])
  })

  it('MEG1-Q16, la décision du cabinet : le cabinet et le client « Ventes » déclarent — l’accès de la fonction est `gere_les_ventes`', () => {
    expect(etape('0d').ordre).toContain(`if not public.${PREDICAT_DE_LA_DECLARATION}(p_dossier_id) or not exists`)
    expect([etape('80').qui, etape('80').droits, etape('80').code]).toEqual(['client', 'ventes', 'OK'])
    expect([etape('83').qui, etape('83').code]).toEqual(['chef', 'OK'])
    expect([etape('32').qui, etape('32').droits, etape('32').code]).toEqual(['client', 'aucun', '42501'])
    expect([etape('33').qui, etape('33').droits, etape('33').code]).toEqual(['client', 'banque', '42501'])
  })
})

// ── 2. Les déclarations de l'essai, rejouées dans le module, sur l'état que ses étapes gardées construisent ─────────

// Le jour de l'essai, fixé ici : l'essai écrit le sien, que la base calcule à Paris.
const AUJOURDHUI = '2026-10-14'
const DEMAIN = '2026-10-15'
// L'instant d'une écriture gardée de l'essai : la même transaction, donc ce jour-là à Paris.
const INSTANT_DE_L_ESSAI = '2026-10-14T08:00:00.000Z'

// Un argument SQL d'un appel de l'essai : `null`, `'…'`, `E'…'`, `date '…'`, `repeat('…', n)`, et leurs concaténations.
function argumentSql(source: string): string | null {
  const s = source.trim()
  if (s === 'null') return null
  const date = /^date '([^']*)'$/.exec(s)
  if (date) return remplacer(date[1])
  const morceaux = s.split(/\s*\|\|\s*/)
  return morceaux.map((m) => {
    const repete = /^repeat\('((?:[^']|'')*)', (\d+)\)$/.exec(m)
    if (repete) return sansDoubles(repete[1]).repeat(Number(repete[2]))
    const echappee = /^E'((?:[^']|'')*)'$/.exec(m)
    if (echappee) return sansDoubles(echappee[1]).replace(/\\t/g, '\t').replace(/\\n/g, '\n')
    const texte = /^'((?:[^']|'')*)'$/.exec(m)
    if (texte) return remplacer(sansDoubles(texte[1]))
    throw new Error(`argument illisible : ${m}`)
  }).join('')
}

const remplacer = (texte: string) => texte.replace('{AUJOURDHUI}', AUJOURDHUI).replace('{DEMAIN}', DEMAIN)

interface Appel {
  dossier: string
  saisie: SaisieAdresseReception
}

function appelDe(ordre: string): Appel | null {
  const m = /public\.declarer_adresse_reception\(([\s\S]*)\) a$/.exec(ordre)
  if (!m) return null
  const args = decouper(m[1])
  if (args.length !== 8) throw new Error(`huit arguments attendus : ${m[1]}`)
  const [dossier, forme, identifiant, plateforme, priseEffet, verification, verifieeLe, remplace] = args.map(argumentSql)
  return {
    dossier: dossier as string,
    saisie: { forme, identifiant, plateforme, prise_effet: priseEffet, verification, verifiee_le: verifieeLe, remplace_id: remplace },
  }
}

// Les SIRET des dossiers jetables, lus dans l'insertion du jeu (j1) : un texte, un E'…' aux échappements Unicode, ou nul.
// Le réglage des ventes suit le SIRET depuis l'étape VF8f (A naît basculé : « Ventes » ne se porte que sur un dossier
// basculé) ; il ne change rien à l'adresse de réception.
function siretsDuJeu(): Map<string, string | null> {
  const j1 = etape('j1').ordre
  const sirets = new Map<string, string | null>()
  for (const ligne of j1.matchAll(/\('\{(\w+)\}', '[^']*', '\{CAB\}', '\w+', \w+, (null|'[^']*'|E'[^']*'), (?:true|false)\)/g)) {
    const brut = ligne[2]
    sirets.set(`{${ligne[1]}}`, brut === 'null' ? null : brut.startsWith('E')
      ? brut.slice(2, -1).replace(/\\u([0-9a-f]{4})/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
      : brut.slice(1, -1))
  }
  return sirets
}

// Qui a accès, comme la base le juge : le chef (super-administrateur) sur un dossier jetable, le client qui porte
// « Ventes » sur le dossier A, le membre affecté au dossier B. Le module ne juge pas l'accès : ces étapes-là seules se
// rejouent.
const aAcces = (e: EtapeDeLEssai, dossier: string) =>
  (e.qui === 'chef' && ['{DA}', '{DB}', '{DC}', '{DD}'].includes(dossier))
  || (e.qui === 'client' && (e.droits === 'ventes' || e.droits === 'deux') && dossier === '{DA}')
  || (e.qui === 'membre_affecte' && dossier === '{DB}')

interface Rejeu {
  etape: EtapeDeLEssai
  refus: ReturnType<typeof refusDeclarationAdresse>
}

function rejouer(): Rejeu[] {
  const sirets = siretsDuJeu()
  const etat: AdresseReception[] = []
  const rejeux: Rejeu[] = []
  for (const e of ETAPES) {
    if (!['controle', 'fait', 'mutation'].includes(e.genre) || !declare(e)) continue
    const appel = appelDe(e.ordre)
    if (!appel || !aAcces(e, appel.dossier)) continue
    const refus = refusDeclarationAdresse(appel.dossier, sirets.get(appel.dossier) ?? null, appel.saisie, etat, AUJOURDHUI)
    rejeux.push({ etape: e, refus })
    // Une étape gardée et acceptée écrit ce que la base a écrit ; sa clé est son identifiant.
    if (e.genre === 'fait' && e.code === 'OK' && refus === null && e.cle) {
      etat.push({
        id: `{${e.cle}}`, dossier_id: appel.dossier, forme: appel.saisie.forme as AdresseReception['forme'],
        identifiant: appel.saisie.identifiant as string, plateforme: appel.saisie.plateforme as string,
        prise_effet: appel.saisie.prise_effet as string, verification: appel.saisie.verification as AdresseReception['verification'],
        verifiee_le: appel.saisie.verifiee_le, remplace_id: appel.saisie.remplace_id, auteur: 'auteur', cree_le: INSTANT_DE_L_ESSAI,
      })
    }
  }
  return rejeux
}

describe('les déclarations de l’essai, rejouées dans le module', () => {
  const rejeux = rejouer()

  it('le rejeu a de quoi juger : des refus de chaque rang, des acceptations, des étapes gardées', () => {
    expect(rejeux).toHaveLength(53)
    const rangs = new Set(rejeux.flatMap((r) => {
      const refus = r.refus
      return refus && refus !== 'rompue' ? [REFUS_DECLARATION_ADRESSE.find((x) => x.cle === refus.cle)?.rang] : []
    }))
    expect([...rangs].sort()).toEqual([2, 3, 4, 5, 6, 7])
    expect(rejeux.filter((r) => r.refus === null)).toHaveLength(15)
    expect(rejeux.filter((r) => r.etape.genre === 'fait').map((r) => r.etape.num)).toEqual(['78', '80', '83', '85', '88'])
  })

  it('chaque déclaration : le même premier refus que la base, sous les mêmes mots — ou aucun', () => {
    for (const { etape: e, refus } of rejeux) {
      expect(refus, `étape ${e.num}`).not.toBe('rompue')
      if (e.code === 'OK') {
        expect(refus, `étape ${e.num} : la base accepte, le module refuse`).toBeNull()
      } else {
        const attendu = (e.attendu as string).replace('{JOUR_FR}', formatDate(AUJOURDHUI))
        expect(refus && refus !== 'rompue' ? refus.message : null, `étape ${e.num}`).toBe(attendu)
        expect(REFUS_DECLARATION_ADRESSE.find((r) => refus && refus !== 'rompue' && r.cle === refus.cle)?.code, `étape ${e.num}`).toBe(e.code)
      }
    }
  })

  it('les refus d’accès que l’essai exige ne se rejouent pas : ce sont bien des refus d’accès', () => {
    const sirets = siretsDuJeu()
    const horsAcces = ETAPES.filter((e) => declare(e) && e.genre === 'controle' && (() => {
      const appel = appelDe(e.ordre)
      return appel !== null && !aAcces(e, appel.dossier)
    })())
    expect(horsAcces).toHaveLength(8)
    for (const e of horsAcces) expect([e.code, e.num]).toEqual(['42501', e.num])
    expect(sirets.size).toBe(4)
  })
})

// ── 3. Les formes, la version courante, le SIREN du dossier ─────────────────────────────────────────────────────────

const adresse = (o: Partial<AdresseReception>): AdresseReception => ({
  id: 'a1', dossier_id: 'd1', forme: 'siren', identifiant: '123456782', plateforme: 'P', prise_effet: '2026-09-01',
  verification: 'declaration', verifiee_le: null, remplace_id: null, auteur: 'u1', cree_le: '2026-10-14T08:00:00Z', ...o,
})

describe('les mailles de l’annuaire', () => {
  it('chaque maille, sa forme ; le SIRET d’une autre entreprise refusé (G1.80)', () => {
    expect(aLaFormeDeSaMaille('siren', '123456782')).toBe(true)
    expect(aLaFormeDeSaMaille('siren', '12345678')).toBe(false)
    expect(aLaFormeDeSaMaille('siren_siret', '123456782_12345678200010')).toBe(true)
    expect(aLaFormeDeSaMaille('siren_siret', '123456782_98765432100015')).toBe(false)
    expect(aLaFormeDeSaMaille('siren_siret_routage', '123456782_12345678200010_SERVICE/compta@2')).toBe(true)
    expect(aLaFormeDeSaMaille('siren_siret_routage', '123456782_12345678200010_A.B')).toBe(false)
    expect(aLaFormeDeSaMaille('siren_siret_routage', `123456782_12345678200010_${'r'.repeat(100)}`)).toBe(true)
    expect(aLaFormeDeSaMaille('siren_siret_routage', `123456782_12345678200010_${'r'.repeat(101)}`)).toBe(false)
    expect(aLaFormeDeSaMaille('siren_suffixe', '123456782_FACTURES.achats-1@siege')).toBe(true)
    expect(aLaFormeDeSaMaille('siren_suffixe', '123456782_A/B')).toBe(false)
    expect(aLaFormeDeSaMaille('siren_suffixe', '123456782_é')).toBe(false)
    expect(aLaFormeDeSaMaille('siren', '123456782\n')).toBe(false)
  })

  it('un identifiant qui admet deux mailles les dit toutes deux — la maille se déclare', () => {
    expect(maillesPossibles('123456782')).toEqual(['siren'])
    expect(maillesPossibles('123456782_12345678200010')).toEqual(['siren_siret', 'siren_suffixe'])
    expect(maillesPossibles('123456782_12345678200010_X')).toEqual(['siren_siret_routage', 'siren_suffixe'])
    // Un SIRET d'une autre entreprise n'en est pas un : seul le suffixe reste.
    expect(maillesPossibles('123456782_98765432100015')).toEqual(['siren_suffixe'])
    expect(maillesPossibles('123456782_A/B')).toEqual([])
  })

  it('les caractères d’un routage et d’un suffixe sont ceux que la base admet déjà pour l’adresse électronique d’un acheteur', () => {
    const routage = '[-_/@a-zA-Z0-9]{1,100}'
    const suffixe = '[-_.@a-zA-Z0-9]{1,100}'
    expect(FORME_ADRESSE_ELECTRONIQUE.source).toContain(`_${routage}`)
    expect(FORME_ADRESSE_ELECTRONIQUE.source).toContain(`_${suffixe}`)
    expect(MAILLES_ADRESSE.map((m) => m.motif.source)).toEqual([
      '^[0-9]{9}$', '^[0-9]{9}_[0-9]{14}$', `^[0-9]{9}_[0-9]{14}_${routage}$`, `^[0-9]{9}_${suffixe}$`,
    ])
  })
})

describe('la version courante, déduite de la chaîne', () => {
  it('aucune, une, une chaîne lue dans le désordre ; jamais celle d’un autre dossier', () => {
    expect(versionCourante([], 'd1')).toBeNull()
    expect(versionCourante([adresse({ id: 'x', dossier_id: 'd2' })], 'd1')).toBeNull()
    const a1 = adresse({ id: 'a1' })
    const a2 = adresse({ id: 'a2', remplace_id: 'a1' })
    const a3 = adresse({ id: 'a3', remplace_id: 'a2' })
    expect(versionCourante([a1], 'd1')).toBe(a1)
    expect(versionCourante([a3, a1, a2], 'd1')).toBe(a3)
    expect(versionCourante([a3, a1, a2, adresse({ id: 'b1', dossier_id: 'd2' })], 'd1')).toBe(a3)
  })

  it('des lignes qui ne font pas une chaîne : rompue — deux premières, une fourche, un trou, un cycle', () => {
    const a1 = adresse({ id: 'a1' })
    expect(versionCourante([a1, adresse({ id: 'a2' })], 'd1')).toBe('rompue')
    expect(versionCourante([a1, adresse({ id: 'a2', remplace_id: 'a1' }), adresse({ id: 'a3', remplace_id: 'a1' })], 'd1')).toBe('rompue')
    expect(versionCourante([a1, adresse({ id: 'a3', remplace_id: 'a2' })], 'd1')).toBe('rompue')
    expect(versionCourante([a1, adresse({ id: 'a2', remplace_id: 'a3' }), adresse({ id: 'a3', remplace_id: 'a2' })], 'd1')).toBe('rompue')
    expect(versionCourante([a1, a1], 'd1')).toBe('rompue')
    // La suite d'une adresse d'un autre dossier n'en fait pas une chaîne.
    expect(versionCourante([a1, adresse({ id: 'a2', remplace_id: 'b1' })], 'd1')).toBe('rompue')
  })

  it('le module ne juge pas une chaîne rompue', () => {
    const saisie: SaisieAdresseReception = { forme: 'siren', identifiant: '123456782', plateforme: 'P', prise_effet: '2026-09-01',
      verification: 'declaration', verifiee_le: null, remplace_id: 'a1' }
    expect(refusDeclarationAdresse('d1', '12345678200010', saisie, [adresse({ id: 'a1' }), adresse({ id: 'a2' })], AUJOURDHUI)).toBe('rompue')
  })
})

describe('ce que l’essai ne rejoue pas', () => {
  const saisie = (o: Partial<SaisieAdresseReception>): SaisieAdresseReception => ({ forme: 'siren', identifiant: '123456782',
    plateforme: 'P', prise_effet: '2026-09-01', verification: 'declaration', verifiee_le: null, remplace_id: null, ...o })

  it('une date que le champ ne donne pas n’est pas une saisie : le module lève', () => {
    expect(() => refusDeclarationAdresse('d1', '12345678200010', saisie({ prise_effet: '2026-02-30' }), [], AUJOURDHUI)).toThrow()
    expect(() => refusDeclarationAdresse('d1', '12345678200010', saisie({ verifiee_le: '14/10/2026' }), [], AUJOURDHUI)).toThrow()
    expect(() => refusDeclarationAdresse('d1', '12345678200010', saisie({}), [], '2026-10-32')).toThrow()
    expect(estUnJourCivil('2028-02-29')).toBe(true)
    expect(estUnJourCivil('2026-02-29')).toBe(false)
  })

  it('à un chiffre près : le SIRET de l’adresse et le SIREN du dossier se jugent sur leurs neuf chiffres', () => {
    // Le SIRET commence par 123456781, l'entreprise est 123456782 : un établissement d'une autre entreprise.
    expect(aLaFormeDeSaMaille('siren_siret', '123456782_12345678100010')).toBe(false)
    expect(refusDeclarationAdresse('d1', '12345678200010', saisie({ forme: 'siren_siret', identifiant: '123456782_12345678100010' }),
      [], AUJOURDHUI)).toMatchObject({ cle: 'siret_d_une_autre_entreprise' })
    // Le dossier est 123456782 : une adresse de 123456781 n'est pas la sienne.
    expect(refusDeclarationAdresse('d1', '12345678200010', saisie({ identifiant: '123456781' }), [], AUJOURDHUI))
      .toEqual({ cle: 'siren_du_dossier', message: "L'adresse doit commencer par le SIREN du dossier, 123456782." })
  })

  it('le jour de vérification se borne au jour DONNÉ, bornes comprises', () => {
    const verifiee = (jour: string) => saisie({ verification: 'portail_annuaire', verifiee_le: jour })
    expect(refusDeclarationAdresse('d1', '12345678200010', verifiee(AUJOURDHUI), [], AUJOURDHUI)).toBeNull()
    expect(refusDeclarationAdresse('d1', '12345678200010', verifiee(PREMIER_JOUR), [], AUJOURDHUI)).toBeNull()
    expect(refusDeclarationAdresse('d1', '12345678200010', verifiee(DEMAIN), [], AUJOURDHUI)).toMatchObject({ cle: 'verification_hors_bornes' })
    expect(refusDeclarationAdresse('d1', '12345678200010', verifiee(DEMAIN), [], DEMAIN)).toBeNull()
    expect(refusDeclarationAdresse('d1', '12345678200010', saisie({ prise_effet: DERNIER_JOUR }), [], AUJOURDHUI)).toBeNull()
  })

  it('le nom de la plateforme : quatre-vingt-dix-neuf caractères comptés comme la base (par point de code), les blancs qu’elle retire', () => {
    expect(PLATEFORME_MAX).toBe(99)
    expect(refusDeclarationAdresse('d1', '12345678200010', saisie({ plateforme: '😀'.repeat(99) }), [], AUJOURDHUI)).toBeNull()
    expect(refusDeclarationAdresse('d1', '12345678200010', saisie({ plateforme: '😀'.repeat(100) }), [], AUJOURDHUI))
      .toMatchObject({ cle: 'plateforme_longue' })
    // Une espace insécable n'est pas un blanc que la base retire : un nom fait d'elle seule est un nom.
    expect(refusDeclarationAdresse('d1', '12345678200010', saisie({ plateforme: String.fromCodePoint(0xa0) }), [], AUJOURDHUI)).toBeNull()
    expect(refusDeclarationAdresse('d1', '12345678200010', saisie({ plateforme: ` \t\n\r` }), [], AUJOURDHUI))
      .toMatchObject({ cle: 'plateforme_absente' })
    expect(BLANCS).toBe(' \t\n\r')
  })

  it('le SIREN du dossier : celui que l’application lit, la valeur nommée dans le refus', () => {
    expect(refusDeclarationAdresse('d1', '987654321', saisie({}), [], AUJOURDHUI))
      .toEqual({ cle: 'siren_du_dossier', message: "L'adresse doit commencer par le SIREN du dossier, 987654321." })
    expect(refusDeclarationAdresse('d1', '123 456 782 00010', saisie({}), [], AUJOURDHUI)).toBeNull()
    expect(refusDeclarationAdresse('d1', '1234567820001', saisie({}), [], AUJOURDHUI)).toMatchObject({ cle: 'dossier_sans_siren' })
  })

  it('une première quand le dossier en a une, ou une version qui ne l’est plus : la courante nommée, son jour à Paris', () => {
    const courante = adresse({ id: 'a2', remplace_id: 'a1', identifiant: '123456782_X', forme: 'siren_suffixe', cree_le: '2026-10-13T22:30:00Z' })
    const lues = [adresse({ id: 'a1' }), courante]
    const message = `Une autre adresse a été déclarée entre-temps (« 123456782_X », le ${formatDate(dateAParis(courante.cree_le))}) : relire avant de déclarer.`
    // 22 h 30 en temps universel le 13 : le 14 à Paris.
    expect(message).toContain('le 14/10/2026')
    expect(refusDeclarationAdresse('d1', '12345678200010', saisie({}), lues, AUJOURDHUI)).toEqual({ cle: 'remplacee_pas_courante', message })
    expect(refusDeclarationAdresse('d1', '12345678200010', saisie({ remplace_id: 'a1' }), lues, AUJOURDHUI)).toEqual({ cle: 'remplacee_pas_courante', message })
    expect(refusDeclarationAdresse('d1', '12345678200010', saisie({ remplace_id: 'a2' }), lues, AUJOURDHUI)).toBeNull()
    expect(refusDeclarationAdresse('d1', '12345678200010', saisie({ remplace_id: 'b1' }), lues, AUJOURDHUI))
      .toMatchObject({ cle: 'remplacee_d_un_autre_dossier' })
  })
})

// ── 4. Le SIREN d'un dossier : la base retire les blancs que JavaScript nomme `\s` ───────────────────────────────────
// La migration (et le jeu de rls.sql, qui doit la satisfaire) écrit sa classe de blancs un à un, en échappements ASCII,
// pour ne dépendre d'aucune locale ; `sirenDuDossier` retire ceux de `/\s/`. Les deux ensembles doivent être le même.

function classeDesBlancs(texte: string): Set<number> {
  const m = /regexp_replace\(coalesce\(d\.siret, ''\),\s*'\[((?:[^\]'])*)\]', '', 'g'\)/.exec(texte)
  if (!m) throw new Error('classe des blancs introuvable')
  const corps = m[1]
  const unites: number[] = []
  const lettres: Record<string, number> = { t: 9, n: 10, v: 11, f: 12, r: 13 }
  const points: (number | '-')[] = []
  for (let i = 0; i < corps.length; i++) {
    if (corps[i] === '\\') {
      const suivant = corps[i + 1]
      if (suivant === 'u') {
        points.push(parseInt(corps.slice(i + 2, i + 6), 16))
        i += 5
      } else {
        points.push(lettres[suivant])
        i += 1
      }
    } else points.push(corps[i] === '-' ? '-' : (corps.codePointAt(i) as number))
  }
  for (let i = 0; i < points.length; i++) {
    if (points[i + 1] === '-') {
      for (let c = points[i] as number; c <= (points[i + 2] as number); c++) unites.push(c)
      i += 2
    } else unites.push(points[i] as number)
  }
  return new Set(unites)
}

const blancsDeJavaScript = () => {
  const blancs = new Set<number>()
  for (let c = 0; c <= 0xffff; c++) if (/\s/.test(String.fromCodePoint(c))) blancs.add(c)
  return blancs
}

describe('le SIREN du dossier se lit comme l’application le lit', () => {
  it('la classe de blancs du jeu de rls.sql est exactement `\\s` de JavaScript', () => {
    const sql = classeDesBlancs(RLS)
    expect([...sql].sort((a, b) => a - b)).toEqual([...blancsDeJavaScript()].sort((a, b) => a - b))
    // Le plancher : l'espace insécable fine en est.
    expect(sql.has(0x202f)).toBe(true)
  })

  it('`sirenDuDossier` : quatorze chiffres, neuf chiffres, les blancs retirés ; rien d’autre', () => {
    expect(sirenDuDossier('12345678200010')).toBe('123456782')
    expect(sirenDuDossier('987654321')).toBe('987654321')
    expect(sirenDuDossier(`123${String.fromCodePoint(0xa0)}456 782${String.fromCodePoint(0x202f)}00010`)).toBe('123456782')
    expect(sirenDuDossier('1234567820001')).toBeNull()
    expect(sirenDuDossier(null)).toBeNull()
  })
})

// ── 5. Le jour où l'export porte la migration ───────────────────────────────────────────────────────────────────────

const messagesSql = (sql: string) => [...sql.matchAll(/raise exception '((?:[^']|'')*)'/g)].map((m) => sansDoubles(m[1]))
const codesSql = (sql: string) => [...sql.matchAll(/raise exception '(?:[^']|'')*'[^;]*?using errcode = '(\w+)'/g)].map((m) => m[1])

describe('ADRESSES_RECEPTION_EXPORTEES dit ce que porte l’export', () => {
  const portee = fichiersDuSchema().some((f) => /create table public\.adresses_reception \(/.test(f.texte))

  it('le drapeau, et la migration avec lui', () => {
    expect(portee, 'ADRESSES_RECEPTION_EXPORTEES ne dit plus ce que porte l’export').toBe(ADRESSES_RECEPTION_EXPORTEES)
  })

  // La migration elle-même, dès qu'elle est dans l'export : UN fichier, à la version que l'historique lui a donnée.
  const migration = () => {
    const schema = new URL('../../supabase/schema/', import.meta.url)
    const noms = readdirSync(schema).filter((nom) => /^\d{14}_adresses_reception\.sql$/.test(nom))
    expect(noms, 'la migration adresses_reception doit être UNE dans l’export').toHaveLength(1)
    return readFileSync(new URL(noms[0], schema), 'utf8')
  }

  it('exportée, la fonction dit les refus du module, dans le même ordre et sous les mêmes codes', () => {
    if (!ADRESSES_RECEPTION_EXPORTEES) return
    const declarer = derniereDefinitionSql('declarer_adresse_reception')
    expect(messagesSql(declarer)).toEqual(REFUS_DECLARATION_ADRESSE.map((r) => r.modele))
    expect(codesSql(declarer)).toEqual(REFUS_DECLARATION_ADRESSE.map((r) => r.code))
    expect(declarer).toMatch(new RegExp(`\\nbegin\\n  if not public\\.${PREDICAT_DE_LA_DECLARATION}\\(p_dossier_id\\) or not exists`))
    // Deux déclarations du même dossier se suivent : le verrou, avant toute lecture de la forme.
    expect(declarer.indexOf("pg_advisory_xact_lock(hashtextextended('jd.adresses_reception:' || p_dossier_id::text, 0))"))
      .toBeLessThan(declarer.indexOf('-- 2. La maille'))
  })

  it('exportée, ses valeurs sont celles du module : mailles, formes, bornes, vérifications, blancs, la classe du SIREN', () => {
    if (!ADRESSES_RECEPTION_EXPORTEES) return
    const texte = migration()
    const declarer = derniereDefinitionSql('declarer_adresse_reception')
    const liste = (motif: RegExp, source: string) => [...(motif.exec(source)?.[1] ?? '').matchAll(/'(\w+)'/g)].map((m) => m[1])
    expect(liste(/check \(forme in \(([^)]*)\)\)/, texte)).toEqual(MAILLES_ADRESSE.map((m) => m.forme))
    expect(liste(/p_forme not in \(([^)]*)\)/, declarer)).toEqual(MAILLES_ADRESSE.map((m) => m.forme))
    expect(liste(/check \(verification in \(([^)]*)\)\)/, texte)).toEqual([...VERIFICATIONS])
    expect(liste(/p_verification not in \(([^)]*)\)/, declarer)).toEqual([...VERIFICATIONS])
    // Chaque forme, la même dans la table et dans la fonction que dans le module.
    for (const m of MAILLES_ADRESSE) {
      expect(texte, m.forme).toContain(`when '${m.forme}' then identifiant ~ '${m.motif.source}'`)
      expect(declarer, m.forme).toContain(`p_forme = '${m.forme}' and (p_identifiant is null or p_identifiant !~ '${m.motif.source}')`)
    }
    expect(texte).toContain(`check (btrim(plateforme, E' \\t\\n\\r') <> '' and char_length(plateforme) <= ${PLATEFORME_MAX})`)
    expect(declarer).toContain(`if char_length(p_plateforme) > ${PLATEFORME_MAX} then`)
    expect(texte).toContain(`check (prise_effet between date '${PREMIER_JOUR}' and date '${DERNIER_JOUR}')`)
    expect(declarer).toContain(`if p_prise_effet not between date '${PREMIER_JOUR}' and date '${DERNIER_JOUR}' then`)
    expect(declarer).toContain(`if p_verifiee_le < date '${PREMIER_JOUR}' or p_verifiee_le > (now() at time zone 'Europe/Paris')::date then`)
    // La classe des blancs du SIREN : celle de la fonction est celle du jeu de rls.sql, donc `\s` de JavaScript.
    expect([...classeDesBlancs(declarer)].sort()).toEqual([...classeDesBlancs(RLS)].sort())
  })

  it('exportée, qui lit et qui écrit : trois policies aux connectés, aucune écriture directe hors de la restauration', () => {
    if (!ADRESSES_RECEPTION_EXPORTEES) return
    const texte = migration()
    const policies = [...texte.matchAll(/create policy (\w+) on public\.adresses_reception\s+for (\w+) to (\w+) (using|with check) \(([^;]*)\);/g)]
      .map((m) => `${m[1]} ${m[2]} ${m[3]} ${m[4]} ${m[5]}`)
    expect(policies).toEqual([
      'adresses_reception_lecture select authenticated using public.admin_du_dossier(dossier_id)',
      "adresses_reception_lecture_ventes select authenticated using public.client_du_dossier(dossier_id, 'ventes')",
      'adresses_reception_restauration insert authenticated with check public.is_super_admin()',
    ])
    expect([...texte.matchAll(/create policy/g)]).toHaveLength(3)
    for (const fonction of ['declarer_adresse_reception(uuid, text, text, text, date, text, date, uuid)', 'etat_facture_electronique(uuid)']) {
      expect(texte).toContain(`revoke execute on function public.${fonction} from public, anon;`)
      expect(texte).toContain(`grant execute on function public.${fonction} to authenticated;`)
    }
    expect(texte).toContain('revoke execute on function public.garder_adresse_reception() from public, anon, authenticated;')
    // Rien n'y retire quoi que ce soit : `apply_migration` la prend sans demander de confirmation. Le mot ne paraît que
    // dans la clé du dossier et dans la garde, sous les formes que l'outil a déjà prises sans confirmation.
    const instructions = texte.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')
    expect(instructions.replace(/on delete cascade/g, '').replace(/before insert or update or delete/g, '')
      .replace(/tg_op = 'DELETE'/g, '')).not.toMatch(/\b(delete|drop|truncate)\b/i)
  })
})
