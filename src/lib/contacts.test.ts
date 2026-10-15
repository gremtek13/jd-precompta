import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ADRESSE_CONTACT_MAX,
  ARTICLE_DES_SOINS,
  BLANCS,
  CONTACTS_EXPORTES,
  DELAI_CONTACT_MAX_JOURS,
  EMAIL_CONTACT_MAX,
  FORME_EMAIL,
  GENRES_CONTACT,
  HYPOTHESES_DES_CONTACTS,
  NOM_CONTACT_MAX,
  OBSERVATIONS_CONTACT_MAX,
  PREFIXE_DU_NOM_EFFACE,
  REFUS_EFFACEMENT_CONTACT,
  REFUS_ENREGISTREMENT_CONTACT,
  REFUS_REPRISE_CONTACT,
  REFUS_RETRAIT_CONTACT,
  TYPES_CLIENT_CONTACT,
  dossierDeSoins,
  etatDuContact,
  nomDUnContactEfface,
  refusEffacementContact,
  refusEnregistrementContact,
  refusRepriseContact,
  refusRetraitContact,
  regleDesSoins,
  saisieQuiPart,
  type CibleContact,
  type ContactPourSiret,
  type SaisieContact,
} from './contacts'
import { FORME_ADRESSE_ELECTRONIQUE, LONGUEUR_CODE_SERVICE } from './mentionsFacture'
import type { ArticleExoneration, Contact } from './types'
import { contact } from '../test/contacts'
import { decouper, lignesInserees } from '../test/essaiSql'
import { derniereDefinitionSql, fichiersDuSchema } from '../test/schema'

// LE MODULE DES CONTACTS, CONFRONTÉ À LA BASE (espace client, étape A4a). La migration est appliquée, et l'export
// (supabase/schema) la porte : ce test confronte le module au texte même de la migration et de ses fonctions. Sa première
// RÉFÉRENCE reste l'essai `supabase/essais/contacts.sql`, joué sur une réplique de la production munie de la migration,
// puis en production : chacun de ses contrôles exige de la base un code ET des mots. Ce test exige que chaque refus du
// module y soit exigé de la fonction qui le lève, et REJOUE dans le module les écritures de l'essai, dans leur ordre, sur
// l'état que ses étapes gardées construisent : le même premier refus, ou aucun.

const ESSAI = readFileSync(new URL('../../supabase/essais/contacts.sql', import.meta.url), 'utf8')

interface EtapeDeLEssai {
  num: string
  genre: string
  qui: string
  droits: string | null
  ordre: string
  code: string
  attendu: string | null
}

const sansDoubles = (texte: string) => texte.replace(/''/g, "'")

function etapesDeLEssai(texte: string): EtapeDeLEssai[] {
  const motif = /\('(\w+)', '(jeu|controle|fait|valeur|mutation)', '(?:[^']|'')*', '(\w+)', (null|'\w+'),\s*\$q\$([\s\S]*?)\$q\$,\s*'(\w+)', (null|'((?:[^']|'')*)'), (?:null|'\w+')\)/g
  return [...texte.matchAll(motif)].map((m) => ({
    num: m[1], genre: m[2], qui: m[3], droits: m[4] === 'null' ? null : m[4].slice(1, -1), ordre: m[5], code: m[6],
    attendu: m[8] === undefined ? null : sansDoubles(m[8]),
  }))
}

// Un motif `like` de l'essai, en expression régulière : « % » pour n'importe quoi, « _ » pour un caractère, « \x » pour x.
function likeEnRegex(motif: string): RegExp {
  let source = ''
  for (let i = 0; i < motif.length; i++) {
    const c = motif[i]
    if (c === '\\' && i + 1 < motif.length) source += motif[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    else if (c === '%') source += '[\\s\\S]*'
    else if (c === '_') source += '.'
    else source += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${source}$`)
}

// Un modèle du module, en expression régulière : chaque « % » une valeur, « %% » un signe pour cent.
function modeleEnRegex(modele: string): RegExp {
  const morceaux = modele.split('%%').map((m) => m.split('%').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s\\S]*'))
  return new RegExp(`^${morceaux.join('%')}$`)
}

const FONCTIONS = ['enregistrer_contact', 'retirer_contact', 'reprendre_contact', 'effacer_contact'] as const
type Fonction = (typeof FONCTIONS)[number]
const fonctionAppelee = (ordre: string): Fonction | null => FONCTIONS.find((f) => ordre.includes(`public.${f}(`)) ?? null

const ETAPES = etapesDeLEssai(ESSAI)
const etape = (num: string) => {
  const e = ETAPES.find((x) => x.num === num)
  if (!e) throw new Error(`étape ${num} introuvable dans contacts.sql`)
  return e
}

describe('l’essai, lu', () => {
  it('ses étapes, toutes : quatre de jeu, 223 jugées — le deux-cent-vingt-quatrième verdict est le bilan « rien n’est resté »', () => {
    // Le plancher qui distingue « aucun écart » d'« aveugle » : un motif qui ne reconnaîtrait plus les étapes rendrait une
    // liste vide, et toutes les confrontations ci-dessous passeraient sans rien confronter.
    const ouvertes = [...ESSAI.matchAll(/^\s*\('\w+', '(?:jeu|controle|fait|valeur|mutation)'/gm)].length
    expect(ETAPES).toHaveLength(ouvertes)
    expect(ETAPES.filter((e) => e.genre === 'jeu')).toHaveLength(4)
    expect(ETAPES.filter((e) => e.genre !== 'jeu')).toHaveLength(223)
    expect(ETAPES.filter((e) => e.genre === 'mutation')).toHaveLength(15)
    expect(new Set(ETAPES.map((e) => e.num)).size).toBe(ETAPES.length)
  })

  it('un motif « like » se lit comme la base le lit, un modèle du module comme remplirModele l’écrit', () => {
    expect(likeEnRegex('Contact effacé le __/__/____').test('Contact effacé le 15/10/2026')).toBe(true)
    expect(likeEnRegex('Contact effacé le __/__/____').test('Contact effacé le 5/10/2026')).toBe(false)
    expect(likeEnRegex('%contacts_siret_unique%').test('… « contacts_siret_unique » …')).toBe(true)
    expect(modeleEnRegex('Le SIRET « % » est').test('Le SIRET « 12345678200010 » est')).toBe(true)
    expect(modeleEnRegex('Le SIRET « % » est').test('Le SIRET 12345678200010 est')).toBe(false)
  })

  it('les colonnes que l’essai attend de la table sont celles du type, dans leur ordre (aucun téléphone, aucune date de naissance)', () => {
    const colonnes = (etape('0f').attendu as string).split(',').map((c) => c.split(':')[0])
    expect(colonnes).toEqual(Object.keys(contact()))
    expect(colonnes.filter((c) => /telephone|naissance/.test(c))).toEqual([])
  })
})

// ── 1. Chaque refus du module est exigé de la base par l'essai, sous ses mots et son code ─────────────────────────────

describe('les refus du module sont ceux que la base rend', () => {
  const listes = [
    ['enregistrer_contact', REFUS_ENREGISTREMENT_CONTACT],
    ['retirer_contact', REFUS_RETRAIT_CONTACT],
    ['reprendre_contact', REFUS_REPRISE_CONTACT],
    ['effacer_contact', REFUS_EFFACEMENT_CONTACT],
  ] as const

  for (const [fonction, liste] of listes) {
    it(`${fonction} : chaque refus est exigé par un contrôle de l’essai, sous son code et ses mots`, () => {
      const exiges = ETAPES.filter((e) => e.genre === 'controle' && e.code !== 'OK' && e.attendu != null
        && fonctionAppelee(e.ordre) === fonction)
      for (const r of liste) {
        const temoins = exiges.filter((e) => modeleEnRegex(r.modele).test(e.attendu as string))
        expect(temoins.length, `${fonction} : le refus « ${r.cle} » n'est exigé par aucun contrôle de contacts.sql`).toBeGreaterThan(0)
        for (const e of temoins) expect(e.code, `${fonction}, contrôle ${e.num}`).toBe(r.code)
      }
      expect(new Set(liste.map((r) => r.cle)).size).toBe(liste.length)
      // Les rangs se suivent, du premier au dernier, sans en sauter.
      const rangs = [...new Set(liste.map((r) => r.rang))]
      expect(rangs).toEqual(rangs.map((_, i) => i + 1))
    })
  }

  it('douze rangs pour enregistrer_contact, vingt-sept messages ; l’accès d’abord, partout, avant « introuvable »', () => {
    expect(new Set(REFUS_ENREGISTREMENT_CONTACT.map((r) => r.rang)).size).toBe(12)
    expect(REFUS_ENREGISTREMENT_CONTACT).toHaveLength(27)
    for (const [, liste] of listes) expect(liste.slice(0, 2).map((r) => r.cle)).toEqual(['acces', 'introuvable'])
    // Sans droit, un contact qui n'existe pas : le refus d'accès.
    for (const num of ['12', '40e']) expect([etape(num).code, etape(num).attendu]).toEqual(['42501', 'Accès refusé à ce dossier.'])
  })

  it('le cabinet et le client « Ventes » tiennent les contacts, par les mêmes fonctions (le patron des articles, MEG1-Q1)', () => {
    expect(etape('0d').ordre).toContain('if not public.gere_les_ventes(p_dossier_id) or not exists')
    expect([etape('7').qui, etape('7').code]).toEqual(['chef', 'OK'])
    expect([etape('7b').qui, etape('7b').droits, etape('7b').code]).toEqual(['client', 'ventes', 'OK'])
    expect([etape('50').qui, etape('50').droits, fonctionAppelee(etape('50').ordre)]).toEqual(['client', 'ventes', 'effacer_contact'])
  })
})

// ── 2. Les écritures de l'essai, rejouées dans le module, sur l'état que ses étapes gardées construisent ─────────────

const DOSSIERS = ['DA', 'DB', 'DC', 'DD', 'DE', 'DF'] as const
const NOMS = new Map<string, string>([...DOSSIERS, 'CAB'].map((n) => [n, n]))

// Les articles d'exonération des dossiers jetables, tels que le jeu les pose — et que l'essai change en route (étape 65).
function articlesDuJeu(): Map<string, ArticleExoneration | null> {
  const lignes = lignesInserees(etape('j1').ordre, 'dossiers', NOMS)
  return new Map(lignes.map((l) => [l.id as string, (l.article_exoneration as ArticleExoneration | null) ?? null]))
}

// Une valeur SQL de l'essai : un texte, un nombre, null, `repeat('x', n)`, ou leur concaténation par `||`.
function valeurDeLEssai(expression: string): unknown {
  const morceaux: string[] = []
  let chaine = false
  let courant = ''
  const s = expression.trim()
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "'") chaine = !chaine
    if (!chaine && s.startsWith(' || ', i)) {
      morceaux.push(courant)
      courant = ''
      i += 3
    } else courant += s[i]
  }
  morceaux.push(courant)
  if (morceaux.length > 1) return morceaux.map((m) => String(valeurDeLEssai(m))).join('')
  if (s === 'null') return null
  if (/^-?\d+(?:\.\d+)?(?:e-?\d+)?$/.test(s)) return Number(s)
  const repete = /^repeat\('((?:[^']|'')*)', (\d+)\)$/.exec(s)
  if (repete) return sansDoubles(repete[1]).repeat(Number(repete[2]))
  const texte = /^'((?:[^']|'')*)'$/.exec(s)
  if (texte) return sansDoubles(texte[1])
  throw new Error(`valeur illisible : ${s}`)
}

// L'argument JSON d'un appel de l'essai : `null`, un littéral `'…'::jsonb`, ou `jsonb_build_object(…)`.
function argumentJson(source: string): unknown {
  const s = source.trim()
  if (s === 'null') return null
  const litteral = /^'((?:[^']|'')*)'::jsonb$/.exec(s)
  if (litteral) return JSON.parse(sansDoubles(litteral[1]))
  const construit = /^jsonb_build_object\(([\s\S]*)\)$/.exec(s)
  if (!construit) throw new Error(`argument JSON illisible : ${s}`)
  const valeurs = decouper(construit[1]).map(valeurDeLEssai)
  const objet: Record<string, unknown> = {}
  for (let i = 0; i < valeurs.length; i += 2) objet[valeurs[i] as string] = valeurs[i + 1]
  return objet
}

interface Appel {
  fonction: Fonction
  dossier: string
  contact: string | null
  saisie: unknown
}

function appelDe(ordre: string): Appel | null {
  const enregistrer = /public\.enregistrer_contact\('\{(\w+)\}', (null|'\{(\w+)\}'), ([\s\S]*)\) c$/.exec(ordre)
  if (enregistrer) {
    return { fonction: 'enregistrer_contact', dossier: enregistrer[1], contact: enregistrer[3] ?? null, saisie: argumentJson(enregistrer[4]) }
  }
  const autre = /public\.(retirer_contact|reprendre_contact|effacer_contact)\('\{(\w+)\}', '\{(\w+)\}'\) c$/.exec(ordre)
  if (autre) return { fonction: autre[1] as Fonction, dossier: autre[2], contact: autre[3], saisie: null }
  return null
}

// Qui a accès, comme la base le juge : le chef (super-administrateur) sur un dossier jetable, le client qui porte « Ventes »
// sur le dossier A, le membre affecté sur le dossier B. Le module ne juge pas l'accès : ces étapes-là seules se rejouent.
const aAcces = (e: EtapeDeLEssai, dossier: string) =>
  (e.qui === 'chef' && (DOSSIERS as readonly string[]).includes(dossier))
  || (e.qui === 'client' && (e.droits === 'ventes' || e.droits === 'deux') && dossier === 'DA')
  || (e.qui === 'membre_affecte' && dossier === 'DB')

// La clé qu'une étape « fait » garde (la dernière colonne de son tuple) : l'identifiant que les étapes suivantes citent.
function cleDeLEtape(num: string): string {
  const m = new RegExp(`\\('${num}', 'fait',[\\s\\S]*?\\$q\\$,\\s*'\\w+', (?:null|'(?:[^']|'')*'), '(\\w+)'\\)`).exec(ESSAI)
  if (!m) throw new Error(`la clé de l’étape ${num} est introuvable`)
  return m[1]
}

type EtatContact = ContactPourSiret & Pick<Contact, 'efface_le' | 'type_client' | 'siren'>

interface Rejeu {
  etape: EtapeDeLEssai
  appel: Appel
  refus: { cle: string; message: string } | null
  codeDuModule: string | null
}

const code = (liste: readonly { cle: string; code: string }[], refus: { cle: string } | null) =>
  refus ? liste.find((r) => r.cle === refus.cle)?.code ?? null : null

function rejouer(): Rejeu[] {
  const articles = articlesDuJeu()
  const etat = new Map<string, EtatContact>()
  const rejeux: Rejeu[] = []
  for (const e of ETAPES) {
    // Le dossier E passe aux soins en cours d'essai : le propriétaire change son statut, la fonction n'y est pour rien.
    const passage = /^update dossiers set statut_tva = '\w+', assujetti_tva = (?:true|false), article_exoneration = '(\w+)' where id = '\{(\w+)\}'/.exec(e.ordre)
    if (passage && e.genre === 'fait') articles.set(passage[2], passage[1] as ArticleExoneration)
    if (!['controle', 'fait', 'mutation'].includes(e.genre)) continue
    const appel = appelDe(e.ordre)
    if (!appel || !aAcces(e, appel.dossier)) continue
    const vise = appel.contact == null ? null : etat.get(appel.contact) ?? null
    const article = articles.get(appel.dossier) ?? null
    let refus: { cle: string; message: string } | null
    let codeDuModule: string | null
    if (appel.fonction === 'enregistrer_contact') {
      const cible: CibleContact = appel.contact == null ? { nouveau: true } : { nouveau: false, contact: vise }
      refus = refusEnregistrementContact(appel.dossier, article, cible, appel.saisie, [...etat.values()])
      codeDuModule = code(REFUS_ENREGISTREMENT_CONTACT, refus)
    } else if (appel.fonction === 'retirer_contact') {
      refus = refusRetraitContact(appel.dossier, vise)
      codeDuModule = code(REFUS_RETRAIT_CONTACT, refus)
    } else if (appel.fonction === 'reprendre_contact') {
      refus = refusRepriseContact(appel.dossier, article, vise)
      codeDuModule = code(REFUS_REPRISE_CONTACT, refus)
    } else {
      refus = refusEffacementContact(appel.dossier, vise)
      codeDuModule = code(REFUS_EFFACEMENT_CONTACT, refus)
    }
    rejeux.push({ etape: e, appel, refus, codeDuModule })
    // Une étape gardée et acceptée écrit ce que la base a écrit.
    if (e.genre === 'fait' && e.code === 'OK') {
      const saisie = (appel.saisie ?? {}) as Record<string, unknown>
      const champs = {
        nom: saisie.nom as string, siret: (saisie.siret as string | undefined) ?? null, siren: (saisie.siren as string | undefined) ?? null,
        type_client: (saisie.type_client as Contact['type_client'] | undefined) ?? null,
      }
      if (appel.fonction === 'enregistrer_contact' && appel.contact == null) {
        const nom = cleDeLEtape(e.num)
        etat.set(nom, { id: nom, dossier_id: appel.dossier, retire_le: null, efface_le: null, ...champs })
      } else if (vise && appel.fonction === 'enregistrer_contact') {
        etat.set(vise.id, { ...vise, ...champs })
      } else if (vise && appel.fonction === 'retirer_contact') {
        etat.set(vise.id, { ...vise, retire_le: '2026-10-15T12:00:00Z' })
      } else if (vise && appel.fonction === 'reprendre_contact') {
        etat.set(vise.id, { ...vise, retire_le: null })
      } else if (vise && appel.fonction === 'effacer_contact') {
        etat.set(vise.id, { ...vise, nom: nomDUnContactEfface('2026-10-15'), siret: null, siren: null, type_client: null, retire_le: null,
          efface_le: '2026-10-15T12:00:00Z' })
      }
    }
  }
  return rejeux
}

describe('les écritures de l’essai, rejouées dans le module', () => {
  const REJEUX = rejouer()

  it('assez d’écritures pour juger : refus et acceptations, des quatre fonctions, de chaque rang', () => {
    expect(REJEUX.length).toBeGreaterThanOrEqual(130)
    expect(REJEUX.filter((r) => r.etape.code === 'OK').length).toBeGreaterThanOrEqual(40)
    for (const f of FONCTIONS) expect(REJEUX.filter((r) => r.appel.fonction === f).length, f).toBeGreaterThanOrEqual(6)
    const rangsRejoues = (liste: readonly { cle: string; rang: number }[], f: Fonction) => new Set(REJEUX.filter((r) => r.appel.fonction === f)
      .flatMap((r) => (r.refus ? [liste.find((x) => x.cle === r.refus?.cle)?.rang] : [])))
    // Le rang 1 (l'accès) se juge en base seulement ; les autres sont rejoués, et chaque message aussi.
    expect([...rangsRejoues(REFUS_ENREGISTREMENT_CONTACT, 'enregistrer_contact')].sort((a, b) => (a ?? 0) - (b ?? 0)))
      .toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    const clesRejouees = new Set(REJEUX.flatMap((r) => (r.refus ? [`${r.appel.fonction}:${r.refus.cle}`] : [])))
    for (const [f, liste] of [['enregistrer_contact', REFUS_ENREGISTREMENT_CONTACT], ['retirer_contact', REFUS_RETRAIT_CONTACT],
      ['reprendre_contact', REFUS_REPRISE_CONTACT], ['effacer_contact', REFUS_EFFACEMENT_CONTACT]] as const) {
      for (const r of liste) if (r.cle !== 'acces') expect(clesRejouees.has(`${f}:${r.cle}`), `${f} : ${r.cle} jamais rejoué`).toBe(true)
    }
  })

  it('chaque écriture : le même premier refus que la base, sous le même code — ou aucun quand elle accepte', () => {
    const ecarts: string[] = []
    for (const { etape: e, refus, codeDuModule } of REJEUX) {
      if (e.code === 'OK') {
        if (refus) ecarts.push(`${e.num} : la base accepte, le module refuse « ${refus.message} »`)
      } else if (!refus) {
        ecarts.push(`${e.num} : la base refuse (${e.code}), le module accepte`)
      } else if (!likeEnRegex(e.attendu as string).test(refus.message) || codeDuModule !== e.code) {
        ecarts.push(`${e.num} : la base « ${e.code} ${e.attendu} », le module « ${codeDuModule} ${refus.message} »`)
      }
    }
    expect(ecarts).toEqual([])
  })
})

// ── 3. Ce que le module lit, comme la base le lit ────────────────────────────────────────────────────────────────────

const DA = 'DA'
const DB = 'DB'
const SAISIE = { nom: 'Société Essai', type_client: 'assujetti', adresse: 'Adresse fictive' }
const neuf: CibleContact = { nouveau: true }
const refus = (saisie: unknown, contacts: readonly ContactPourSiret[] = [], cible: CibleContact = neuf, article: ArticleExoneration | null = null) =>
  refusEnregistrementContact(DA, article, cible, saisie, contacts)?.cle ?? null
const pourSiret = (o: Partial<ContactPourSiret> & { id: string }): ContactPourSiret => ({
  dossier_id: DA, siret: null, nom: 'Société Essai', retire_le: null, ...o,
})

describe('la saisie, lue comme la base la reçoit', () => {
  it('une saisie juste passe ; un champ facultatif nul ou absent aussi', () => {
    expect(refus(SAISIE)).toBeNull()
    expect(refus({ ...SAISIE, siren: null, siret: undefined, email: null, delai_paiement_jours: null, observations: undefined })).toBeNull()
  })

  it('l’aller-retour par JSON : NaN devient nul, une clé indéfinie ou héritée disparaît, un tableau n’est pas une saisie', () => {
    expect(refus({ ...SAISIE, delai_paiement_jours: Number.NaN })).toBeNull()
    expect(refus({ ...SAISIE, delai_paiement_jours: Number.POSITIVE_INFINITY })).toBeNull()
    expect(refus(undefined)).toBe('nom_absent')
    expect(refus(null)).toBe('nom_absent')
    expect(refus(['Société Essai', 'assujetti'])).toBe('nom_absent')
    expect(refus(Object.create(SAISIE))).toBe('nom_absent')
  })

  it('les caractères se comptent par point de code, comme `char_length` : un emoji vaut un', () => {
    const emoji = String.fromCodePoint(0x1f600)
    expect(refus({ ...SAISIE, nom: emoji.repeat(NOM_CONTACT_MAX) })).toBeNull()
    expect(refus({ ...SAISIE, nom: emoji.repeat(NOM_CONTACT_MAX + 1) })).toBe('nom_long')
    expect(refus({ ...SAISIE, adresse: emoji.repeat(ADRESSE_CONTACT_MAX) })).toBeNull()
    expect(refus({ ...SAISIE, adresse: emoji.repeat(ADRESSE_CONTACT_MAX + 1) })).toBe('adresse_longue')
    expect(refus({ ...SAISIE, observations: emoji.repeat(OBSERVATIONS_CONTACT_MAX) })).toBeNull()
    expect(refus({ ...SAISIE, observations: emoji.repeat(OBSERVATIONS_CONTACT_MAX + 1) })).toBe('observations_longues')
    expect(refus({ ...SAISIE, type_client: 'organisme_public', code_service: emoji.repeat(LONGUEUR_CODE_SERVICE) })).toBeNull()
    expect(refus({ ...SAISIE, type_client: 'organisme_public', code_service: emoji.repeat(LONGUEUR_CODE_SERVICE + 1) })).toBe('code_service_forme')
  })

  it('les blancs des bords sont les quatre de la base : une espace insécable n’en est pas un', () => {
    expect(BLANCS).toBe(' \t\n\r')
    const insecable = String.fromCharCode(0xa0)
    expect(refus({ ...SAISIE, nom: insecable })).toBeNull()
    for (const blanc of [' ', '\t', '\n', '\r']) {
      expect(refus({ ...SAISIE, nom: blanc.repeat(2) }), JSON.stringify(blanc)).toBe('nom_absent')
      expect(refus({ ...SAISIE, adresse: blanc }), JSON.stringify(blanc)).toBe('adresse_absente')
      expect(refus({ ...SAISIE, type_client: 'organisme_public', code_service: blanc }), JSON.stringify(blanc)).toBe('code_service_forme')
    }
  })

  it('le type : l’un des quatre de la facture, à la lettre près', () => {
    for (const type of TYPES_CLIENT_CONTACT) expect(refus({ ...SAISIE, type_client: type }), type).toBeNull()
    for (const type of ['Assujetti', 'entreprise', '', 1, null, undefined]) expect(refus({ ...SAISIE, type_client: type }), String(type)).toBe('type_inconnu')
  })

  it('l’e-mail : la forme du WHATWG, 254 caractères au plus', () => {
    expect(refus({ ...SAISIE, email: 'compta@exemple.invalid' })).toBeNull()
    expect(refus({ ...SAISIE, email: 'compta+essai@sous.exemple.invalid' })).toBeNull()
    expect(refus({ ...SAISIE, email: `${'e'.repeat(236)}+a@exemple.invalid` })).toBeNull()
    for (const email of [`${'e'.repeat(239)}@exemple.invalid`, 'compta.exemple.invalid', 'compta @exemple.invalid', 'compté@exemple.invalid',
      'compta@-exemple.invalid', 'compta@exemple-.invalid', 'compta@exemple.invalid-', 'compta@exemple..invalid', '', 7, true]) {
      expect(refus({ ...SAISIE, email }), String(email)).toBe('email_invalide')
    }
    // Un nom de domaine : soixante-trois caractères par étiquette au plus, qui ne commence ni ne finit par un tiret.
    expect(refus({ ...SAISIE, email: `compta@${'e'.repeat(63)}.invalid` })).toBeNull()
    expect(refus({ ...SAISIE, email: `compta@${'e'.repeat(64)}.invalid` })).toBe('email_invalide')
    expect(refus({ ...SAISIE, email: 'compta@ex-emple.invalid' })).toBeNull()
    expect(EMAIL_CONTACT_MAX).toBe(254)
  })

  it('le délai : un nombre entier de jours, de 0 à 60 — à tout type de client', () => {
    for (const delai of [0, 30, 60]) {
      for (const type of TYPES_CLIENT_CONTACT) expect(refus({ ...SAISIE, type_client: type, delai_paiement_jours: delai }), `${type} ${delai}`).toBeNull()
    }
    for (const delai of [61, -1, 30.5, '30', 1e21]) expect(refus({ ...SAISIE, delai_paiement_jours: delai }), String(delai)).toBe('delai_invalide')
    expect(DELAI_CONTACT_MAX_JOURS).toBe(60)
  })
})

describe('les identifiants, dans l’ordre de la facture', () => {
  it('ni SIREN ni SIRET pour un client établi hors de France ; un SIREN pour les trois autres types', () => {
    expect(refus({ ...SAISIE, type_client: 'etranger', siren: '123456782' })).toBe('etranger_identifiants')
    expect(refus({ ...SAISIE, type_client: 'etranger', siret: '12345678200010' })).toBe('etranger_identifiants')
    expect(refus({ ...SAISIE, type_client: 'etranger', siren: null, siret: null })).toBeNull()
    for (const type of ['assujetti', 'organisme_public', 'non_assujetti']) expect(refus({ ...SAISIE, type_client: type, siren: '123456782' }), type).toBeNull()
  })

  it('le SIREN : neuf chiffres, puis sa clé de Luhn', () => {
    for (const siren of ['12345678', '1234567820', '123 456 782', 123456782, '12345678A']) expect(refus({ ...SAISIE, siren }), String(siren)).toBe('siren_forme')
    expect(refus({ ...SAISIE, siren: '987654321' })).toBe('siren_cle')
    expect(refus({ ...SAISIE, siren: '987654324' })).toBeNull()
  })

  it('le SIRET : quatorze chiffres, sa clé — La Poste par la somme de ses chiffres —, avec le SIREN qu’il commence', () => {
    expect(refus({ ...SAISIE, siren: '123456782', siret: '1234567820001' })).toBe('siret_forme')
    expect(refus({ ...SAISIE, siren: '123456782', siret: 12345678200010 })).toBe('siret_forme')
    expect(refus({ ...SAISIE, siren: '123456782', siret: '12345678200011' })).toBe('siret_cle')
    expect(refus({ ...SAISIE, siret: '12345678200010' })).toBe('siret_sans_siren')
    expect(refus({ ...SAISIE, siren: '987654324', siret: '12345678200010' })).toBe('siret_autre_siren')
    // Au neuvième chiffre près : 123456781 ne passe pas la clé de Luhn — ce n'est le SIREN de personne —, et le SIRET qui le
    // commence passe la sienne.
    expect(refus({ ...SAISIE, siren: '123456782', siret: '12345678100004' })).toBe('siret_autre_siren')
    expect(refus({ ...SAISIE, siren: '123456782', siret: '12345678200010' })).toBeNull()
    // Un établissement de La Poste (hors production : 356000000 est une entreprise réelle — la fonction, jouée sur une
    // réplique, rend la même chose ; HISTORIQUE.md, « LES CONTACTS, EN BASE »).
    expect(refus({ ...SAISIE, siren: '356000000', siret: '35600000000001' })).toBeNull()
    expect(refus({ ...SAISIE, siren: '356000000', siret: '35600000000014' })).toBe('siret_cle')
    expect(refus({ ...SAISIE, siren: '356000000', siret: '35600000000048' })).toBeNull()
  })

  it('le SIRET pris par un autre contact du dossier, retirés compris, se nomme ; libre ailleurs ou le sien', () => {
    const porteur = pourSiret({ id: 'c1', siret: '12345678200010' })
    const avecSiret = { ...SAISIE, siren: '123456782', siret: '12345678200010' }
    expect(refusEnregistrementContact(DA, null, neuf, avecSiret, [porteur])?.message)
      .toBe("Le SIRET « 12345678200010 » est déjà celui du contact « Société Essai » : un établissement ne se range qu'une fois par dossier.")
    expect(refusEnregistrementContact(DA, null, neuf, avecSiret, [{ ...porteur, retire_le: '2026-10-01T08:00:00Z' }])?.message)
      .toBe("Le SIRET « 12345678200010 » est déjà celui du contact « Société Essai » (retiré) : un établissement ne se range qu'une fois par dossier.")
    expect(refus(avecSiret, [{ ...porteur, dossier_id: DB }])).toBeNull()
    expect(refus(avecSiret, [porteur], { nouveau: false, contact: { id: 'c1', dossier_id: DA, retire_le: null, efface_le: null } })).toBeNull()
    expect(refus({ ...SAISIE, type_client: 'non_assujetti' }, [pourSiret({ id: 'c2' }), pourSiret({ id: 'c3' })])).toBeNull()
    // Un nom long se nomme par ses soixante-dix-neuf premiers caractères, comptés par point de code.
    expect(refusEnregistrementContact(DA, null, neuf, avecSiret, [{ ...porteur, nom: 'é'.repeat(85) }])?.message)
      .toContain(`« ${'é'.repeat(79)}… »`)
  })

  it('l’adresse électronique : à une entreprise ou à un organisme public, à la forme de l’annuaire, le SIREN en tête', () => {
    for (const type of ['non_assujetti', 'etranger']) expect(refus({ ...SAISIE, type_client: type, adresse_electronique: '123456782' }), type).toBe('adresse_electronique_type')
    expect(refus({ ...SAISIE, adresse_electronique: '123456782 ESSAI' })).toBe('adresse_electronique_forme')
    expect(refus({ ...SAISIE, adresse_electronique: 123456782 })).toBe('adresse_electronique_forme')
    expect(refus({ ...SAISIE, siren: '987654324', adresse_electronique: '123456782_ESSAI' })).toBe('adresse_electronique_siren')
    expect(refus({ ...SAISIE, siren: '123456782', adresse_electronique: '123456782_12345678200010_ROUTAGE/1@a' })).toBeNull()
    expect(refus({ ...SAISIE, adresse_electronique: '987654324_SUFFIXE.1' })).toBeNull()
  })

  it('le code service : à un organisme public seulement', () => {
    for (const type of ['assujetti', 'non_assujetti', 'etranger']) expect(refus({ ...SAISIE, type_client: type, code_service: 'S' }), type).toBe('code_service_type')
    expect(refus({ ...SAISIE, type_client: 'organisme_public', code_service: 'SERVICE-ESSAI' })).toBeNull()
    expect(refus({ ...SAISIE, type_client: 'organisme_public', code_service: 7 })).toBe('code_service_forme')
  })
})

describe('la règle des soins (MEG1-Q10, A4-Q1 à A4-Q3, hypothèses)', () => {
  const SOINS: ArticleExoneration = 'cgi_261_4_1'
  const soins = (saisie: unknown, article: ArticleExoneration | null = SOINS) => refus(saisie, [], neuf, article)

  it('le dossier de soins est celui de l’article des soins, et lui seul', () => {
    expect(ARTICLE_DES_SOINS).toBe('cgi_261_4_1')
    expect(dossierDeSoins('cgi_261_4_1')).toBe(true)
    for (const article of ['cgi_261_4_4_a', 'cgi_261_4_4_b', 'cgi_261_c_2', null] as const) expect(dossierDeSoins(article), String(article)).toBe(false)
  })

  it('un particulier — un non-assujetti sans SIREN — et un client établi hors de France ne s’y rangent pas', () => {
    expect(soins({ ...SAISIE, type_client: 'non_assujetti' })).toBe('soins_particulier')
    expect(soins({ ...SAISIE, type_client: 'etranger' })).toBe('soins_etranger')
    expect(soins({ ...SAISIE, type_client: 'non_assujetti', siren: '111111118' })).toBeNull()
    expect(soins({ ...SAISIE, type_client: 'assujetti' })).toBeNull()
    expect(soins({ ...SAISIE, type_client: 'organisme_public' })).toBeNull()
    // Hors des soins, tous les types se rangent.
    for (const type of TYPES_CLIENT_CONTACT) expect(soins({ ...SAISIE, type_client: type }, 'cgi_261_4_4_a'), type).toBeNull()
  })

  it('la règle vient en dernier : ce qui est faux avant se dit d’abord', () => {
    expect(soins({ ...SAISIE, type_client: 'non_assujetti', observations: 'o'.repeat(OBSERVATIONS_CONTACT_MAX + 1) })).toBe('observations_longues')
    expect(soins({ ...SAISIE, type_client: 'etranger', email: 'x' })).toBe('email_invalide')
  })

  it('regleDesSoins : ce que l’écran dira d’un contact rangé avant que le dossier passe aux soins (A4-Q4)', () => {
    expect(regleDesSoins(SOINS, 'non_assujetti', null)).toBe('soins_particulier')
    expect(regleDesSoins(SOINS, 'non_assujetti', '111111118')).toBeNull()
    expect(regleDesSoins(SOINS, 'etranger', null)).toBe('soins_etranger')
    expect(regleDesSoins(SOINS, null, null)).toBeNull()
    expect(regleDesSoins(null, 'non_assujetti', null)).toBeNull()
  })

  it('les hypothèses sont nommées, chacune une fois', () => {
    expect(Object.keys(HYPOTHESES_DES_CONTACTS)).toEqual(['MEG1-Q9', 'MEG1-Q10', 'MEG1-Q11', 'A4-Q1', 'A4-Q2', 'A4-Q3', 'A4-Q4'])
    expect(GENRES_CONTACT).toEqual(['client'])
  })
})

describe('le contact visé : introuvable, d’un autre dossier, retiré, effacé — avant tout le reste', () => {
  const vise = { id: 'c1', dossier_id: DA, retire_le: null, efface_le: null }
  const retire = '2026-10-01T08:00:00Z'

  it('enregistrer_contact', () => {
    expect(refus({}, [], { nouveau: false, contact: null })).toBe('introuvable')
    expect(refus({}, [], { nouveau: false, contact: { ...vise, dossier_id: DB } })).toBe('introuvable')
    expect(refus({}, [], { nouveau: false, contact: { ...vise, retire_le: retire } })).toBe('retire')
    expect(refus({}, [], { nouveau: false, contact: { ...vise, efface_le: retire } })).toBe('efface')
    expect(refus(SAISIE, [], { nouveau: false, contact: vise })).toBeNull()
  })

  it('retirer_contact, reprendre_contact, effacer_contact', () => {
    const actif = contact({ dossier_id: DA })
    const enRetrait = contact({ dossier_id: DA, retire_le: retire, retire_par: 'u' })
    const efface = contact({ dossier_id: DA, efface_le: retire, efface_par: 'u', type_client: null, adresse: null, siren: null, siret: null })
    expect(refusRetraitContact(DA, null)?.cle).toBe('introuvable')
    expect(refusRetraitContact(DB, actif)?.cle).toBe('introuvable')
    expect(refusRetraitContact(DA, efface)?.message).toBe('Ce contact est effacé : il ne se retire plus.')
    expect(refusRetraitContact(DA, enRetrait)?.message).toBe('Ce contact est déjà retiré.')
    expect(refusRetraitContact(DA, actif)).toBeNull()
    expect(refusRepriseContact(DA, null, null)?.cle).toBe('introuvable')
    expect(refusRepriseContact(DB, null, enRetrait)?.cle).toBe('introuvable')
    expect(refusRepriseContact(DA, null, efface)?.message).toBe('Ce contact est effacé : il ne se reprend plus.')
    expect(refusRepriseContact(DA, null, actif)?.message).toBe("Ce contact n'est pas retiré.")
    expect(refusRepriseContact(DA, null, enRetrait)).toBeNull()
    // La reprise suit la règle des soins.
    expect(refusRepriseContact(DA, 'cgi_261_4_1', { ...enRetrait, type_client: 'non_assujetti', siren: null })?.cle).toBe('soins_particulier')
    expect(refusRepriseContact(DA, 'cgi_261_4_1', { ...enRetrait, type_client: 'etranger', siren: null })?.cle).toBe('soins_etranger')
    expect(refusRepriseContact(DA, 'cgi_261_4_1', enRetrait)).toBeNull()
    expect(refusEffacementContact(DA, null)?.cle).toBe('introuvable')
    expect(refusEffacementContact(DB, actif)?.cle).toBe('introuvable')
    expect(refusEffacementContact(DA, efface)?.message).toBe('Ce contact est déjà effacé.')
    expect(refusEffacementContact(DA, actif)).toBeNull()
    expect(refusEffacementContact(DA, enRetrait)).toBeNull()
  })

  it('l’état d’un contact, le nom d’un effacé', () => {
    expect(etatDuContact(contact())).toBe('actif')
    expect(etatDuContact(contact({ retire_le: retire }))).toBe('retire')
    expect(etatDuContact(contact({ efface_le: retire }))).toBe('efface')
    expect(nomDUnContactEfface('2026-10-15')).toBe('Contact effacé le 15/10/2026')
    expect(nomDUnContactEfface('2026-10-15').startsWith(PREFIXE_DU_NOM_EFFACE)).toBe(true)
    expect(() => nomDUnContactEfface('15/10/2026')).toThrow()
  })
})

// ── 4. La saisie telle qu'elle part ─────────────────────────────────────────────────────────────────────────────────

describe('la saisie telle qu’elle part', () => {
  const vide: SaisieContact = {
    nom: '', typeClient: '', adresse: '', siren: '', siret: '', adresseElectronique: '', codeService: '', email: '', delai: '', observations: '',
  }

  it('les blancs des bords retirés, ceux d’un identifiant retirés tous, un champ vide envoyé nul', () => {
    const envoye = saisieQuiPart({
      ...vide, nom: '  Société Essai\t', typeClient: 'assujetti', adresse: '\n1 rue Fictive\n00000 Essai ', siren: ' 123 456 782 ',
      siret: '123 456 782 00010', adresseElectronique: ' 123456782 ', email: ' compta@exemple.invalid ', delai: ' 30 ', observations: '  ',
    })
    expect(envoye).toEqual({
      nom: 'Société Essai', type_client: 'assujetti', adresse: '1 rue Fictive\n00000 Essai', siren: '123456782', siret: '12345678200010',
      adresse_electronique: '123456782', code_service: null, email: 'compta@exemple.invalid', delai_paiement_jours: 30, observations: null,
    })
    expect(refus(envoye)).toBeNull()
  })

  it('un champ que le type ne lui ouvre pas repart à nul, comme sur la facture', () => {
    const plein = { ...vide, nom: 'N', adresse: 'A', siren: '123456782', siret: '12345678200010', adresseElectronique: '123456782', codeService: 'S' }
    const champs = (typeClient: SaisieContact['typeClient']) => {
      const e = saisieQuiPart({ ...plein, typeClient })
      return [e.siren, e.siret, e.adresse_electronique, e.code_service].map((v) => v != null)
    }
    expect(champs('organisme_public')).toEqual([true, true, true, true])
    expect(champs('assujetti')).toEqual([true, true, true, false])
    expect(champs('non_assujetti')).toEqual([true, true, false, false])
    expect(champs('etranger')).toEqual([false, false, false, false])
    expect(saisieQuiPart({ ...plein, typeClient: '' }).type_client).toBeNull()
  })

  it('le délai part en nombre quand il en est un ; sinon tel quel, et la base le refuse', () => {
    expect(saisieQuiPart({ ...vide, delai: '045' }).delai_paiement_jours).toBe(45)
    expect(saisieQuiPart({ ...vide, delai: '' }).delai_paiement_jours).toBeNull()
    for (const delai of ['30,5', '3 0', '-1', 'trente']) {
      const envoye = saisieQuiPart({ ...vide, nom: 'N', typeClient: 'assujetti', adresse: 'A', delai })
      expect(envoye.delai_paiement_jours, delai).toBe(delai.trim())
      expect(refus(envoye), delai).toBe('delai_invalide')
    }
  })
})

// ── 5. Le jour où l'export porte la migration ───────────────────────────────────────────────────────────────────────

const messagesSql = (sql: string) => [...sql.matchAll(/raise exception '((?:[^']|'')*)'/g)].map((m) => sansDoubles(m[1]))
const codesSql = (sql: string) => [...sql.matchAll(/raise exception '(?:[^']|'')*'[^;]*?using errcode = '(\w+)'/g)].map((m) => m[1])

describe('CONTACTS_EXPORTES dit ce que porte l’export', () => {
  const portee = fichiersDuSchema().some((f) => /create table public\.contacts \(/.test(f.texte))

  it('le drapeau, et la migration avec lui', () => {
    expect(portee, 'CONTACTS_EXPORTES ne dit plus ce que porte l’export').toBe(CONTACTS_EXPORTES)
  })

  // La migration elle-même, dès qu'elle est dans l'export : UN fichier, à la version que l'historique lui a donnée.
  const migration = () => {
    const schema = new URL('../../supabase/schema/', import.meta.url)
    const noms = readdirSync(schema).filter((nom) => /^\d{14}_contacts\.sql$/.test(nom))
    expect(noms, 'la migration contacts doit être UNE dans l’export').toHaveLength(1)
    return readFileSync(new URL(noms[0], schema), 'utf8')
  }

  it('exportée, les fonctions disent les refus du module, dans le même ordre et sous les mêmes codes', () => {
    if (!CONTACTS_EXPORTES) return
    for (const [fonction, liste] of [['enregistrer_contact', REFUS_ENREGISTREMENT_CONTACT], ['retirer_contact', REFUS_RETRAIT_CONTACT],
      ['reprendre_contact', REFUS_REPRISE_CONTACT], ['effacer_contact', REFUS_EFFACEMENT_CONTACT]] as const) {
      expect(messagesSql(derniereDefinitionSql(fonction)), fonction).toEqual(liste.map((r) => r.modele))
      expect(codesSql(derniereDefinitionSql(fonction)), fonction).toEqual(liste.map((r) => r.code))
    }
  })

  it('exportée, ses valeurs sont celles du module : genres, types, bornes, formes, blancs, La Poste, le jour de Paris', () => {
    if (!CONTACTS_EXPORTES) return
    const texte = migration()
    const enregistrer = derniereDefinitionSql('enregistrer_contact')
    const liste = (motif: RegExp, source: string) => [...(motif.exec(source)?.[1] ?? '').matchAll(/'(\w+)'/g)].map((m) => m[1])
    expect(liste(/constraint contacts_genre_check check \(genre in \(([^)]*)\)\)/, texte)).toEqual([...GENRES_CONTACT])
    expect(liste(/constraint contacts_type_client_check\s+check \(type_client in \(([^)]*)\)\)/, texte)).toEqual([...TYPES_CLIENT_CONTACT])
    expect(liste(/p_contact->>'type_client' not in \(([^)]*)\)/, enregistrer)).toEqual([...TYPES_CLIENT_CONTACT])
    expect(texte).toContain(`check (btrim(nom, E' \\t\\n\\r') <> '' and char_length(nom) <= ${NOM_CONTACT_MAX})`)
    expect(texte).toContain(`check (btrim(adresse, E' \\t\\n\\r') <> '' and char_length(adresse) <= ${ADRESSE_CONTACT_MAX})`)
    expect(texte).toContain(`check (char_length(observations) <= ${OBSERVATIONS_CONTACT_MAX})`)
    expect(texte).toContain(`check (delai_paiement_jours between 0 and ${DELAI_CONTACT_MAX_JOURS})`)
    expect(texte).toContain(`check (length(code_service) <= ${LONGUEUR_CODE_SERVICE} and btrim(code_service) <> '')`)
    expect(texte).toContain('constraint contacts_siret_unique unique (dossier_id, siret)')
    // Les mêmes bornes dans la fonction que dans la table, et les mêmes blancs que le module, trois fois.
    expect(enregistrer).toContain(`if char_length(v_nom) > ${NOM_CONTACT_MAX} then`)
    expect(enregistrer).toContain(`if char_length(v_adresse) > ${ADRESSE_CONTACT_MAX} then`)
    expect(enregistrer).toContain(`char_length(p_contact->>'observations') > ${OBSERVATIONS_CONTACT_MAX}`)
    expect(enregistrer).toContain(`char_length(p_contact->>'code_service') > ${LONGUEUR_CODE_SERVICE}`)
    expect(enregistrer).toContain(`char_length(p_contact->>'email') > ${EMAIL_CONTACT_MAX}`)
    expect(enregistrer).toContain(`::numeric not between 0 and ${DELAI_CONTACT_MAX_JOURS}`)
    expect([...enregistrer.matchAll(/btrim\(p_contact->>'(\w+)', E' \\t\\n\\r'\)/g)].map((m) => m[1])).toEqual(['nom', 'adresse', 'code_service'])
    // Les formes : celle de l'annuaire, celle du WHATWG — les mêmes que le module, dans la table et dans la fonction.
    const annuaire = FORME_ADRESSE_ELECTRONIQUE.source
    expect(texte.split(`'${annuaire}'`).length - 1).toBe(2)
    const email = FORME_EMAIL.source.replace(/\(\?:/g, '(').replace(/'/g, "''")
    expect(texte.split(`'${email}'`).length - 1).toBe(2)
    // La clé de Luhn et La Poste (INSEE), comme `siretValide`.
    expect(enregistrer).toContain("if left(v_siret, 9) = '356000000' and v_siret <> '35600000000048' then")
    expect(enregistrer).toContain('v_cle := v_somme % 5 = 0;')
    // Le nom d'un effacé, au jour de Paris ; la table le garde.
    expect(derniereDefinitionSql('effacer_contact'))
      .toContain(`set nom = '${PREFIXE_DU_NOM_EFFACE}' || to_char((now() at time zone 'Europe/Paris')::date, 'DD/MM/YYYY')`)
    expect(texte).toContain(`nom like '${PREFIXE_DU_NOM_EFFACE}%'`)
    // La règle des soins : l'article des soins, à l'écriture comme à la reprise.
    for (const fonction of ['enregistrer_contact', 'reprendre_contact']) {
      expect(derniereDefinitionSql(fonction), fonction).toContain(`select coalesce(d.article_exoneration = '${ARTICLE_DES_SOINS}', false) into v_soins`)
    }
    // Un SIRET pris nomme le contact qui le porte, coupé comme le module le coupe.
    expect(enregistrer).toContain("case when char_length(v_autre.nom) > 80 then left(v_autre.nom, 79) || '…' else v_autre.nom end")
  })

  it('exportée, qui lit et qui écrit : trois policies aux connectés, aucune écriture directe hors de la restauration', () => {
    if (!CONTACTS_EXPORTES) return
    const texte = migration()
    const policies = [...texte.matchAll(/create policy (\w+) on public\.contacts\s+for (\w+) to (\w+) (using|with check) \(([^;]*)\);/g)]
      .map((m) => `${m[1]} ${m[2]} ${m[3]} ${m[4]} ${m[5]}`)
    expect(policies).toEqual([
      'contacts_lecture select authenticated using public.admin_du_dossier(dossier_id)',
      "contacts_lecture_ventes select authenticated using public.client_du_dossier(dossier_id, 'ventes')",
      'contacts_restauration insert authenticated with check public.is_super_admin()',
    ])
    expect([...texte.matchAll(/create policy/g)]).toHaveLength(3)
    for (const fonction of ['enregistrer_contact(uuid, uuid, jsonb)', 'retirer_contact(uuid, uuid)', 'reprendre_contact(uuid, uuid)',
      'effacer_contact(uuid, uuid)']) {
      expect(texte).toContain(`revoke execute on function public.${fonction} from public, anon;`)
      expect(texte).toContain(`grant execute on function public.${fonction} to authenticated;`)
    }
    // L'accès des quatre gestes est celui des ventes, avant toute autre chose.
    for (const fonction of FONCTIONS) {
      expect(derniereDefinitionSql(fonction), fonction)
        .toMatch(/\$\$\ndeclare[\s\S]*?\nbegin\n {2}if not public\.gere_les_ventes\(p_dossier_id\) or not exists/)
    }
    // Rien n'y retire quoi que ce soit : `apply_migration` la prend sans demander de confirmation.
    const instructions = texte.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')
    expect(instructions.replace(/on delete cascade/g, '')).not.toMatch(/\b(delete|drop|truncate)\b/i)
    // Chaque hypothèse est nommée dans l'en-tête, figé avec l'historique.
    for (const question of Object.keys(HYPOTHESES_DES_CONTACTS)) expect(texte, question).toContain(question)
  })
})
