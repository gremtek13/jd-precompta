import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { decouper } from '../test/essaiSql'
import { derniereDefinitionSql, fichiersDuSchema } from '../test/schema'

// LE LOGO DES FACTURES, CONFRONTÉ À LA BASE (espace client, étape A5c1). La migration `logo_des_factures` est appliquée et
// l'export la porte : le module se confronte au texte même de la fonction et de la migration (section 3), et l'essai
// `supabase/essais/logoDesFactures.sql`, joué en production comme sur une réplique, reste la référence de ce que la base a
// RÉPONDU — chacun de ses contrôles exige d'elle un code ET des mots. Ce test :
//   1. confronte le drapeau RÉEL (`LOGO_DES_FACTURES_EXPORTE`) à l'export, et, le jour où l'export porte la migration, le
//      module au texte même de la fonction et de la migration ;
//   2. lit dans l'essai ce que la base a rendu de son catalogue — le seau, les formes, les champs, l'empreinte de ses
//      vingt-cinq messages — et l'exige du module ;
//   3. exige que chaque refus du logo y soit exigé de la base, sous son code et ses mots ;
//   4. REJOUE dans le module ENTIER (`refusEnregistrementParametres`) les appels de l'essai, dans leur ordre, sur l'état que
//      ses étapes gardées construisent — les versions écrites et les fichiers du seau : le même premier refus, ou aucun ;
//   5. éprouve ce que le module calcule seul : l'empreinte, le chemin, le logo d'une version, ce qu'une version en a fait.
//
// Le module se joue ici DRAPEAU LEVÉ — l'état de la base que l'essai éprouve — : les modules que ce fichier importe
// reçoivent un `LOGO_DES_FACTURES_EXPORTE` forcé à vrai ; le drapeau réel se lit à part (`vi.importActual`).

vi.mock('./logoDesFactures', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./logoDesFactures')>()),
  LOGO_DES_FACTURES_EXPORTE: true,
}))
// `hashFichier` (src/lib/extraction.ts), le jumeau de l'empreinte, vit dans un module qui importe le client de la base :
// une doublure vide, que rien n'appelle.
vi.mock('./supabase', () => ({ supabase: {} }))

const REEL = await vi.importActual<typeof import('./logoDesFactures')>('./logoDesFactures')
const {
  CHAMPS_DU_LOGO, DOSSIER_DES_LOGOS, FORME_CHEMIN_DU_LOGO, FORME_EMPREINTE_DU_LOGO, LOGO_DES_FACTURES_EXPORTE, REFUS_DU_LOGO,
  SEAU_DU_LOGO, changementDuLogo, cheminDuLogo, empreinteSha256, extensionDuLogoDeFacture, logoDeLaVersion, logoPret, logoRepris,
  refusDuLogo, typeDuNomDuLogo,
} = await import('./logoDesFactures')
const {
  REFUS_DE_L_IBAN_DES_PARAMETRES, REFUS_ENREGISTREMENT_PARAMETRES, champsAdmisParLaBase, refusDeLEnregistrement,
  refusEnregistrementParametres, versionCourante,
} = await import('./parametresFacturation')
const { champsChanges, parametresEnvoyes, refusDeLaSaisieParametres, saisieDeLaVersion } = await import('./parametresFacturationVue')
const { TAILLE_MAX, TYPES_ADMIS } = await import('./bornesStockage')
const { hashFichier } = await import('./extraction')
const { versionParametres } = await import('../test/parametresFacturation')

const ESSAI = readFileSync(new URL('../../supabase/essais/logoDesFactures.sql', import.meta.url), 'utf8')

// ── La lecture de l'essai ─────────────────────────────────────────────────────────────────────────────────────────────
interface EtapeDeLEssai {
  num: string
  genre: string
  qui: string
  droits: string | null
  ordre: string
  code: string
  attendu: string | null
  cle: string | null
}

const sansDoubles = (texte: string) => texte.replace(/''/g, "'")

function etapesDeLEssai(texte: string): EtapeDeLEssai[] {
  const motif = /\('(\w+)', '(jeu|controle|fait|valeur|mutation)', '(?:[^']|'')*', '(\w+)', (null|'\w+'),\s*\$q\$([\s\S]*?)\$q\$,\s*'(\w+)', (null|'((?:[^']|'')*)'), (null|'(\w+)')\)/g
  return [...texte.matchAll(motif)].map((m) => ({
    num: m[1], genre: m[2], qui: m[3], droits: m[4] === 'null' ? null : m[4].slice(1, -1), ordre: m[5], code: m[6],
    attendu: m[8] === undefined ? null : sansDoubles(m[8]), cle: m[10] ?? null,
  }))
}

const ETAPES = etapesDeLEssai(ESSAI)
const etape = (num: string) => {
  const e = ETAPES.find((x) => x.num === num)
  if (!e) throw new Error(`étape ${num} introuvable dans logoDesFactures.sql`)
  return e
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
// Le texte LITTÉRAL qu'un motif `like` sans joker attend : ses échappements retirés.
const litteralDuLike = (motif: string) => motif.replace(/\\(.)/g, '$1')

// Un modèle du module, en expression régulière : chaque « % » une valeur, « %% » un signe pour cent.
function modeleEnRegex(modele: string): RegExp {
  const morceaux = modele.split('%%').map((m) => m.split('%').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s\\S]*'))
  return new RegExp(`^${morceaux.join('%')}$`)
}

// Une forme du module telle que la base l'écrit : la source de l'expression, sans l'échappement de la barre oblique.
const enSql = (forme: RegExp) => forme.source.replace(/\\\//g, '/')

// Les noms de l'essai (`ids := jsonb_build_object(…)`) : un littéral, `repeat('x', n)`, ou une valeur de la base (le compte
// du client, du chef, le cabinet, un identifiant tiré au hasard) que le rejeu nomme sans la connaître.
const NOMS: ReadonlyMap<string, string> = (() => {
  const bloc = /ids := jsonb_build_object\(([\s\S]*?)\);/.exec(ESSAI)?.[1]
  if (!bloc) throw new Error('les noms de l’essai sont introuvables')
  const parties = decouper(bloc)
  const noms = new Map<string, string>()
  for (let i = 0; i < parties.length; i += 2) {
    const cle = /^'(\w+)'$/.exec(parties[i].trim())?.[1]
    const brut = parties[i + 1].trim()
    if (!cle) throw new Error(`nom illisible : ${parties[i]}`)
    const repete = /^repeat\('(\w)', (\d+)\)$/.exec(brut)
    const litteral = /^'([^']*)'$/.exec(brut)
    noms.set(cle, repete ? repete[1].repeat(Number(repete[2])) : litteral ? litteral[1] : `<${brut}>`)
  }
  return noms
})()
const nom = (cle: string) => {
  const v = NOMS.get(cle)
  if (v === undefined) throw new Error(`le nom ${cle} n’est pas dans l’essai`)
  return v
}
const DA = nom('DA')
const DB = nom('DB')
// Les noms connus remplacés ; ceux qu'une étape garde ({V1}…) et {RENDU} restent, nommés par eux-mêmes.
const remplacer = (texte: string) => texte.replace(/\{(\w+)\}/g, (m, cle: string) => NOMS.get(cle) ?? m)

describe('l’essai, lu', () => {
  it('ses étapes, toutes : trois de jeu, 126 jugées dont onze mutations — le cent-vingt-septième verdict est le bilan', () => {
    // Le plancher qui distingue « aucun écart » d'« aveugle » : un motif qui ne reconnaîtrait plus les étapes rendrait une
    // liste vide, et toutes les confrontations ci-dessous passeraient sans rien confronter. Le 29/10/2026, une de plus :
    // 0g2, ce qui suit les vingt-cinq messages (A7-Q3).
    const ouvertes = [...ESSAI.matchAll(/^\s*\('\w+', '(?:jeu|controle|fait|valeur|mutation)'/gm)].length
    expect(ETAPES).toHaveLength(ouvertes)
    expect(ETAPES.filter((e) => e.genre === 'jeu')).toHaveLength(3)
    expect(ETAPES.filter((e) => e.genre !== 'jeu')).toHaveLength(126)
    expect(ETAPES.filter((e) => e.genre === 'mutation')).toHaveLength(11)
    expect(new Set(ETAPES.map((e) => e.num)).size).toBe(ETAPES.length)
    expect([DA, DB, nom('H1'), nom('HU')]).toEqual([
      'a5c00000-0000-4000-8000-0000000000a1', 'a5c00000-0000-4000-8000-0000000000b1', '1'.repeat(64), 'A'.repeat(64),
    ])
  })

  it('le seau que la base a rendu est celui du module : privé, sa borne, ses deux types', () => {
    expect(etape('0a').attendu).toBe(`${SEAU_DU_LOGO}:false:${TAILLE_MAX.ventes}:${TYPES_ADMIS.ventes.join(',')}`)
  })

  it('la forme du chemin que la policy de dépôt exige est celle du module, et le dossier des logos aussi', () => {
    const policies = litteralDuLike(etape('0c').attendu as string)
    expect(policies).toContain(`(name ~ '${enSql(FORME_CHEMIN_DU_LOGO)}'::text) THEN gere_les_ventes(`)
    expect(enSql(FORME_CHEMIN_DU_LOGO)).toContain(`/${DOSSIER_DES_LOGOS}/`)
  })

  it('les contraintes : l’empreinte à la forme du module, le chemin = dossier/logos/empreinte.png ou .jpg, ensemble ou nuls', () => {
    const contraintes = litteralDuLike(etape('0e').attendu as string)
    expect(contraintes).toContain(`CHECK ((logo_sha256 ~ '${enSql(FORME_EMPREINTE_DU_LOGO)}'::text))`)
    expect(contraintes).toContain("(dossier_id)::text || '/logos/'::text) || logo_sha256) || '.png'::text)")
    expect(contraintes).toContain("(dossier_id)::text || '/logos/'::text) || logo_sha256) || '.jpg'::text)")
    expect(contraintes).toContain('CHECK (((logo_chemin IS NULL) = (logo_sha256 IS NULL)))')
    expect(contraintes.startsWith(`${CHAMPS_DU_LOGO.map((c) => `${c}:text`).join(',')} ;`)).toBe(true)
  })

  // Adapté le 29/10/2026 à A7-Q3 : la migration `iban_hors_des_parametres` ajoute un neuvième rang, après le logo ; l'essai
  // juge les vingt-cinq premiers messages (0g), puis ce qui suit (0g2) — que parametresFacturationIban.test.ts confronte.
  it('les vingt-cinq premiers messages de la fonction sont ceux du module, dans leur ordre : les dix-sept d’A5a puis les huit du logo', () => {
    const modeles = refusDeLEnregistrement(true).map((r) => r.modele)
    expect(modeles).toHaveLength(25 + REFUS_DE_L_IBAN_DES_PARAMETRES.length)
    const premiers = modeles.slice(0, 25)
    const empreinte = createHash('md5').update(premiers.map((m) => m.replace(/'/g, "''")).join('|')).digest('hex')
    expect(`${premiers.length} ${empreinte}`).toBe(etape('0g').attendu)
    expect(modeles.slice(25)).toEqual(REFUS_DE_L_IBAN_DES_PARAMETRES.map((r) => r.modele))
    expect(etape('0g2').ordre).toContain(`= '${REFUS_DE_L_IBAN_DES_PARAMETRES[0].modele.replace(/'/g, "''''")}'`)
  })

  it('les champs qu’admet la fonction sont ceux du module, dans leur ordre', () => {
    expect(etape('0h').attendu).toBe(champsAdmisParLaBase(true).map((c) => `'${c}'`).join(', '))
  })
})

// ── 1. Chaque refus du logo est exigé de la base par l'essai, sous ses mots et son code ──────────────────────────────

const appelleLaFonction = (ordre: string) => ordre.includes('public.enregistrer_parametres_facturation(')

describe('les refus du logo sont ceux que la base rend', () => {
  it('chaque refus du logo est exigé par un contrôle de l’essai, sous son code et ses mots', () => {
    const exiges = ETAPES.filter((e) => e.genre === 'controle' && e.code !== 'OK' && e.attendu != null && appelleLaFonction(e.ordre))
    for (const r of REFUS_DU_LOGO) {
      const temoins = exiges.filter((e) => modeleEnRegex(r.modele).test(remplacer(e.attendu as string)))
      expect(temoins.length, `le refus « ${r.cle} » n'est exigé par aucun contrôle`).toBeGreaterThan(0)
      for (const e of temoins) expect(e.code, `contrôle ${e.num}`).toBe(r.code)
    }
    expect(new Set(REFUS_DU_LOGO.map((r) => r.cle)).size).toBe(REFUS_DU_LOGO.length)
  })

  it('un seul rang, le huitième, après les sept d’A5a — et des clés que les refus d’A5a ne portent pas', () => {
    expect(REFUS_DU_LOGO.map((r) => r.rang)).toEqual(REFUS_DU_LOGO.map(() => 8))
    expect(Math.max(...REFUS_ENREGISTREMENT_PARAMETRES.map((r) => r.rang))).toBe(7)
    const cles = new Set<string>(REFUS_ENREGISTREMENT_PARAMETRES.map((r) => r.cle))
    for (const r of REFUS_DU_LOGO) expect(cles.has(r.cle), r.cle).toBe(false)
  })
})

// ── 2. Les appels de l'essai, rejoués dans le module entier, sur l'état que ses étapes gardées construisent ──────────

interface Appel { dossier: string; version: string | null; saisie: unknown }
interface Version {
  id: string
  dossier_id: string
  remplace_id: string | null
  cree_le: string
  logo_chemin: string | null
  logo_sha256: string | null
}
interface Fichier { type: string | null; taille: number | null }
interface Etat { versions: Map<string, Version>; fichiers: Map<string, Fichier>; seauRetouche: boolean }

// Une valeur SQL d'un `jsonb_build_object` de l'essai : un texte, un nombre, null, ou `repeat('x', n)`.
function valeurDeLEssai(expression: string): unknown {
  const s = expression.trim()
  if (s === 'null') return null
  if (/^-?\d+(?:\.\d+)?$/.test(s)) return Number(s)
  const repete = /^repeat\('((?:[^']|'')*)', (\d+)\)$/.exec(s)
  if (repete) return sansDoubles(repete[1]).repeat(Number(repete[2]))
  const texte = /^'((?:[^']|'')*)'$/.exec(s)
  if (texte) return sansDoubles(texte[1])
  throw new Error(`valeur illisible : ${s}`)
}

function argumentJson(source: string): unknown {
  const s = source.trim()
  const litteral = /^'((?:[^']|'')*)'::jsonb$/.exec(s)
  if (litteral) return JSON.parse(sansDoubles(litteral[1]))
  const construit = /^jsonb_build_object\(([\s\S]*)\)$/.exec(s)
  if (!construit) throw new Error(`argument JSON illisible : ${s}`)
  const valeurs = decouper(construit[1]).map(valeurDeLEssai)
  const objet: Record<string, unknown> = {}
  for (let i = 0; i < valeurs.length; i += 2) objet[valeurs[i] as string] = valeurs[i + 1]
  return objet
}

// Un appel `select … from public.enregistrer_parametres_facturation(args) p`, ses noms déjà remplacés ; null pour une autre
// requête (une lecture, une autre fonction).
function appelDe(partie: string): Appel | null {
  const ouverture = 'public.enregistrer_parametres_facturation('
  const debut = partie.indexOf(ouverture)
  if (debut < 0) return null
  let profondeur = 1
  let chaine = false
  let fin = debut + ouverture.length
  for (; fin < partie.length && profondeur > 0; fin++) {
    if (partie[fin] === "'") chaine = !chaine
    if (!chaine && partie[fin] === '(') profondeur++
    if (!chaine && partie[fin] === ')') profondeur--
  }
  if (partie.slice(fin).trim() !== 'p') return null
  const args = decouper(partie.slice(debut + ouverture.length, fin - 1)).map((a) => a.trim())
  const dossier = /^'([0-9a-f-]{36})'$/.exec(args[0])?.[1]
  if (!dossier) throw new Error(`dossier illisible : ${args[0]}`)
  const version = args[1] === 'null' ? null : /^'\{?(\w+)\}?'$/.exec(args[1])?.[1] ?? null
  if (args[1] !== 'null' && version === null) throw new Error(`version illisible : ${args[1]}`)
  return { dossier, version, saisie: argumentJson(args[2]) }
}

// Qui a accès, comme la base le juge : le chef (super-administrateur) sur les deux dossiers jetables ; le client qui porte
// « Ventes » sur le dossier A ; le membre affecté au dossier B. Le module ne juge pas l'accès : ces appels-là seuls se rejouent.
const aAcces = (e: EtapeDeLEssai, a: Appel) =>
  (e.qui === 'chef' && (a.dossier === DA || a.dossier === DB))
  || (e.qui === 'client' && (e.droits === 'ventes' || e.droits === 'deux') && a.dossier === DA)
  || (e.qui === 'membre_affecte' && a.dossier === DB)

// Les fichiers du jeu (étape j3) : seau, chemin, métadonnées ; ceux du seau des ventes seuls comptent pour la fonction.
function fichiersDuJeu(): Map<string, Fichier> {
  const fichiers = new Map<string, Fichier>()
  const insertion = remplacer(etape('j3').ordre)
  const tuples = [...insertion.matchAll(/\('([\w-]+)', '([^']*)', (null|'([^']*)')\)/g)]
  expect(tuples.length).toBe(13)
  for (const [, seau, chemin, , metadonnees] of tuples) {
    if (seau !== 'ventes') continue
    const m = metadonnees === undefined ? null : (JSON.parse(metadonnees) as { size?: number; mimetype?: string })
    fichiers.set(chemin, { type: m?.mimetype ?? null, taille: m?.size ?? null })
  }
  return fichiers
}

// Ce qu'une étape du propriétaire change au seau : les métadonnées ou le nom d'un fichier, les bornes du seau. Toute autre
// étape gardée du propriétaire LÈVE : le rejeu ne saute pas ce qu'il ne comprend pas.
function appliquerAuSeau(e: EtapeDeLEssai, etat: Etat) {
  const ordre = remplacer(e.ordre)
  const metadonnees = /^update storage\.objects set metadata = '([^']*)' where bucket_id = 'ventes' and name = '([^']*)'$/.exec(ordre)
  const renomme = /^update storage\.objects set name = '([^']*)' where bucket_id = 'ventes' and name = '([^']*)'$/.exec(ordre)
  const types = /^update storage\.buckets set allowed_mime_types = array\[([^\]]*)\] where id = 'ventes'$/.exec(ordre)
  const borne = /^update storage\.buckets set file_size_limit = (\d+) where id = 'ventes'$/.exec(ordre)
  if (metadonnees) {
    const m = JSON.parse(metadonnees[1]) as { size: number; mimetype: string }
    if (!etat.fichiers.has(metadonnees[2])) throw new Error(`${e.num} : fichier inconnu`)
    etat.fichiers.set(metadonnees[2], { type: m.mimetype, taille: m.size })
  } else if (renomme) {
    const f = etat.fichiers.get(renomme[2])
    if (!f) throw new Error(`${e.num} : fichier inconnu`)
    etat.fichiers.delete(renomme[2])
    etat.fichiers.set(renomme[1], f)
  } else if (types) {
    const lus = [...types[1].matchAll(/'([^']*)'/g)].map((m) => m[1])
    etat.seauRetouche = lus.join(',') !== TYPES_ADMIS.ventes.join(',')
  } else if (borne) {
    etat.seauRetouche = Number(borne[1]) !== TAILLE_MAX.ventes
  } else {
    throw new Error(`${e.num} : une étape gardée du propriétaire que le rejeu ne sait pas lire`)
  }
}

interface Rejeu {
  etape: EtapeDeLEssai
  refus: { cle: string; message: string; code: string } | null
  rangDuRefus: number
  appels: number
}

// Les étapes jugées sous un seau RETOUCHÉ par le propriétaire (37f : un type de moins ; 38d : une borne abaissée) : la base
// y lit le catalogue, le module la borne et les types de la migration — bornesStockage.test.ts confronte l'un à l'autre.
// Elles ne se rejouent pas, et se comptent.
const JUGEES_SOUS_UN_SEAU_RETOUCHE = ['37f', '38d']

function rejouer(): { rejeux: Rejeu[]; sautees: string[] } {
  const etat: Etat = { versions: new Map(), fichiers: fichiersDuJeu(), seauRetouche: false }
  let horloge = 0
  const maintenant = () => new Date(Date.UTC(2026, 9, 17, 8, horloge++)).toISOString()
  const rejeux: Rejeu[] = []
  const sautees: string[] = []
  for (const e of ETAPES) {
    if (e.genre === 'fait' && e.qui === 'proprietaire') {
      appliquerAuSeau(e, etat)
      continue
    }
    if (!['controle', 'fait', 'mutation'].includes(e.genre)) continue
    const appels = remplacer(e.ordre).split('§§').map(appelDe)
    if (appels.some((a) => a === null)) continue
    const lus = appels as Appel[]
    if (!lus.every((a) => aAcces(e, a))) continue
    if (etat.seauRetouche) {
      sautees.push(e.num)
      continue
    }
    const local = new Map([...etat.versions].map(([k, v]) => [k, { ...v }]))
    const fichiers = [...etat.fichiers].map(([chemin, f]) => ({ chemin, ...f }))
    let refus: Rejeu['refus'] = null
    let rangDuRefus = -1
    let rendu: string | null = null
    for (let i = 0; i < lus.length; i++) {
      const a = lus[i]
      const versions = [...local.values()]
      const cible = a.version === 'RENDU' ? rendu : a.version
      const verdict = refusEnregistrementParametres(a.dossier, cible, a.saisie, versions, fichiers)
      if (verdict === 'rompue') throw new Error(`${e.num} : chaîne rompue`)
      if (verdict) {
        const code = refusDeLEnregistrement(true).find((r) => r.cle === verdict.cle)?.code ?? '?'
        refus = { ...verdict, code }
        rangDuRefus = i
        break
      }
      const recue = JSON.parse(JSON.stringify(a.saisie)) as Record<string, unknown>
      const id = e.genre === 'fait' && i === lus.length - 1 && e.cle ? e.cle : `${e.num}-${i}`
      local.set(id, {
        id, dossier_id: a.dossier, remplace_id: cible, cree_le: maintenant(),
        logo_chemin: typeof recue.logo_chemin === 'string' ? recue.logo_chemin : null,
        logo_sha256: typeof recue.logo_sha256 === 'string' ? recue.logo_sha256 : null,
      })
      rendu = id
    }
    rejeux.push({ etape: e, refus, rangDuRefus, appels: lus.length })
    if (e.genre === 'fait' && e.code === 'OK' && !refus) etat.versions = local
  }
  return { rejeux, sautees }
}

const { rejeux: REJEUX, sautees: SAUTEES } = rejouer()

describe('les appels de l’essai, rejoués dans le module entier (le drapeau levé)', () => {
  it('assez d’appels pour juger : chaque refus du logo, l’ordre avec ceux d’A5a, des acceptations', () => {
    expect(REJEUX.length).toBeGreaterThanOrEqual(43)
    expect(REJEUX.filter((r) => r.etape.code === 'OK').length).toBeGreaterThanOrEqual(12)
    const rejoues = new Set(REJEUX.flatMap((r) => (r.refus ? [r.refus.cle] : [])))
    for (const r of REFUS_DU_LOGO) expect(rejoues.has(r.cle), `${r.cle} jamais rejoué`).toBe(true)
    for (const cle of ['delai', 'iban_cle', 'champ_inconnu']) expect(rejoues.has(cle), `${cle} jamais rejoué`).toBe(true)
    // Les étapes gardées : les cinq versions de A, chacune rejouée et écrite.
    for (const num of ['30', '50', '55', '56', '57']) expect(REJEUX.find((r) => r.etape.num === num)?.refus, num).toBeNull()
  })

  it('chaque appel : le même premier refus que la base, sous le même code, au même appel — ou aucun quand elle accepte', () => {
    const ecarts: string[] = []
    for (const { etape: e, refus, rangDuRefus, appels } of REJEUX) {
      if (e.code === 'OK') {
        if (refus) ecarts.push(`${e.num} : la base accepte, le module refuse « ${refus.message} »`)
      } else if (!refus) {
        ecarts.push(`${e.num} : la base refuse (${e.code}), le module accepte`)
      } else if (!likeEnRegex(remplacer(e.attendu as string)).test(refus.message) || refus.code !== e.code || rangDuRefus !== appels - 1) {
        ecarts.push(`${e.num} : la base « ${e.code} ${e.attendu} », le module « ${refus.code} ${refus.message} » (appel ${rangDuRefus + 1})`)
      }
    }
    expect(ecarts).toEqual([])
  })

  it('les étapes jugées sous un seau retouché ne se rejouent pas, et ce sont elles seules', () => {
    expect(SAUTEES).toEqual(JUGEES_SOUS_UN_SEAU_RETOUCHE)
  })

  it('le rejeu mord : le module sans le huitième rang, ou un fichier oublié, ferait des écarts', () => {
    // Un logo absent du seau : sans ses fichiers, le module refuse ce que la base a accepté (38b, 52 non : inchangé).
    const sansFichiers = refusEnregistrementParametres(DA, 'V1', { logo_chemin: `${DA}/logos/${nom('H2')}.jpg`, logo_sha256: nom('H2') },
      [{ id: 'V1', dossier_id: DA, remplace_id: null, cree_le: '2026-10-17T08:00:00.000Z', logo_chemin: null, logo_sha256: null }], [])
    expect(sansFichiers !== null && sansFichiers !== 'rompue' && sansFichiers.cle).toBe('logo_absent')
    // Le module qui ne jugerait pas le logo accepterait le contrôle 38 (un octet de trop).
    const e38 = REJEUX.find((r) => r.etape.num === '38')
    expect(e38?.refus?.cle).toBe('logo_poids')
  })
})

// ── 3. Exportée, la migration elle-même ───────────────────────────────────────────────────────────────────────────────
const messagesSql = (sql: string) => [...sql.matchAll(/raise exception '((?:[^']|'')*)'/g)].map((m) => sansDoubles(m[1]))
const codesSql = (sql: string) => [...sql.matchAll(/raise exception '(?:[^']|'')*'[^;]*?using errcode = '(\w+)'/g)].map((m) => m[1])

describe('LOGO_DES_FACTURES_EXPORTE dit ce que porte l’export', () => {
  const migrations = fichiersDuSchema().filter((f) => /\/\d{14}_logo_des_factures\.sql$/.test(f.chemin))

  it('le drapeau réel, et la migration avec lui — une au plus', () => {
    expect(migrations.length).toBeLessThanOrEqual(1)
    expect(migrations.length === 1, 'LOGO_DES_FACTURES_EXPORTE ne dit plus ce que porte l’export').toBe(REEL.LOGO_DES_FACTURES_EXPORTE)
  })

  it('ce fichier joue le drapeau LEVÉ : l’état de la base que l’essai éprouve', () => {
    expect(LOGO_DES_FACTURES_EXPORTE).toBe(true)
  })

  it('exportée, la fonction dit les refus du module, dans le même ordre et sous les mêmes codes ; ses formes et ses champs', () => {
    if (!REEL.LOGO_DES_FACTURES_EXPORTE) return
    const fonction = derniereDefinitionSql('enregistrer_parametres_facturation')
    expect(messagesSql(fonction)).toEqual(refusDeLEnregistrement(true).map((r) => r.modele))
    expect(codesSql(fonction)).toEqual(refusDeLEnregistrement(true).map((r) => r.code))
    expect(fonction).toContain(`p_parametres->>'logo_chemin' !~ '${enSql(FORME_CHEMIN_DU_LOGO)}'`)
    expect(fonction).toContain(`p_parametres->>'logo_sha256' !~ '${enSql(FORME_EMPREINTE_DU_LOGO)}'`)
    const migration = migrations[0].texte
    expect(migration).toContain(`check (logo_sha256 ~ '${enSql(FORME_EMPREINTE_DU_LOGO)}')`)
    expect(migration.split(`'${enSql(FORME_CHEMIN_DU_LOGO)}'`).length - 1).toBe(2)
  })
})

// ── 4. Ce que le module calcule seul ──────────────────────────────────────────────────────────────────────────────────
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]
const SVG = [...new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')]
const sha256 = (octets: Uint8Array) => createHash('sha256').update(octets).digest('hex')

describe('l’empreinte et le chemin', () => {
  it('le SHA-256 d’un fichier : celui de Node, et celui de hashFichier, son jumeau', async () => {
    const grand = Uint8Array.from({ length: 200_000 }, (_, i) => (i * 31 + 7) % 256)
    for (const octets of [new Uint8Array(), new TextEncoder().encode('abc'), new Uint8Array(PNG), grand]) {
      const blob = new Blob([octets])
      const empreinte = await empreinteSha256(blob)
      expect(empreinte).toBe(sha256(octets))
      expect(empreinte).toBe(await hashFichier(blob))
      expect(empreinte).toMatch(FORME_EMPREINTE_DU_LOGO)
    }
    expect(await empreinteSha256(new Blob([]))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  it('le chemin : <dossier>/logos/<empreinte>.png ou .jpg, l’extension tirée du TYPE, à la forme que la base exige', () => {
    const e = '0'.repeat(64)
    expect(cheminDuLogo(DA, e, 'image/png')).toBe(`${DA}/logos/${e}.png`)
    expect(cheminDuLogo(DA, e, 'image/jpeg')).toBe(`${DA}/logos/${e}.jpg`)
    expect([extensionDuLogoDeFacture('image/png'), extensionDuLogoDeFacture('image/jpeg')]).toEqual(['png', 'jpg'])
    expect([typeDuNomDuLogo('a.png'), typeDuNomDuLogo('a.jpg'), typeDuNomDuLogo('a.jpeg'), typeDuNomDuLogo('a.svg'), typeDuNomDuLogo('a.PNG')])
      .toEqual(['image/png', 'image/jpeg', null, null, null])
    for (const type of TYPES_ADMIS.ventes) expect(FORME_CHEMIN_DU_LOGO.test(cheminDuLogo(DA, e, type))).toBe(true)
    for (const faux of [`${DA.toUpperCase()}/logos/${e}.png`, `${DA}/logos/${e}.jpeg`, `${DA}/${e}.png`, `/${DA}/logos/${e}.png`,
      `${DA}/logos/${'A'.repeat(64)}.png`, `${DA}/logos/${e}.png/x`, `${DA}/logos/${e.slice(1)}.png`]) {
      expect(FORME_CHEMIN_DU_LOGO.test(faux), faux).toBe(false)
    }
    expect(SEAU_DU_LOGO).toBe('ventes')
  })

  it('le logo prêt : jugé à sa signature, réétiqueté, son empreinte calculée sur le corps qui part ; un SVG refusé', async () => {
    const pret = await logoPret(DA, new File([new Uint8Array(PNG)], 'logo.svg', { type: 'image/svg+xml' }))
    if ('refus' in pret) throw new Error(pret.refus.message)
    expect([pret.type, pret.corps.type, pret.taille]).toEqual(['image/png', 'image/png', PNG.length])
    expect(pret.empreinte).toBe(sha256(new Uint8Array(PNG)))
    expect(pret.chemin).toBe(`${DA}/logos/${pret.empreinte}.png`)
    const jpeg = await logoPret(DA, new File([new Uint8Array(JPEG)], 'photo', { type: '' }))
    expect('refus' in jpeg ? null : jpeg.chemin).toBe(`${DA}/logos/${sha256(new Uint8Array(JPEG))}.jpg`)
    const svg = await logoPret(DA, new File([new Uint8Array(SVG)], 'logo.png', { type: 'image/png' }))
    expect('refus' in svg && svg.refus.raison).toBe('format')
    // Ce que l'écran déposera, la base l'enregistre : le module ne refuse pas le logo prêt, son fichier dans le seau.
    expect(refusDuLogo(DA, null, { logo_chemin: pret.chemin, logo_sha256: pret.empreinte },
      [{ chemin: pret.chemin, type: pret.corps.type, taille: pret.taille }])).toBeNull()
  })
})

describe('le refus du logo, pour lui-même', () => {
  const H = (c: string) => c.repeat(64)
  const fichier = (c: string, ext: 'png' | 'jpg', type: string | null, taille: number | null) => ({ chemin: `${DA}/logos/${H(c)}.${ext}`, type, taille })
  const saisie = (c: string, ext: 'png' | 'jpg' = 'png') => ({ logo_chemin: `${DA}/logos/${H(c)}.${ext}`, logo_sha256: H(c) })
  const cle = (r: ReturnType<typeof refusDuLogo>) => r?.cle ?? null

  it('rien, ou les deux nuls : aucun refus ; l’un sans l’autre : ensemble', () => {
    expect(refusDuLogo(DA, null, {}, [])).toBeNull()
    expect(refusDuLogo(DA, null, { logo_chemin: null, logo_sha256: null }, [])).toBeNull()
    expect(cle(refusDuLogo(DA, null, { logo_chemin: 'x' }, []))).toBe('logo_ensemble')
    expect(cle(refusDuLogo(DA, null, { logo_sha256: 'x', logo_chemin: null }, []))).toBe('logo_ensemble')
  })

  it('le type rangé se lit sans ses paramètres ni les espaces de ses bords, en minuscules ; un autre blanc ne s’ôte pas', () => {
    expect(refusDuLogo(DA, null, saisie('1'), [fichier('1', 'png', ' IMAGE/PNG ; charset=binary', 10)])).toBeNull()
    expect(cle(refusDuLogo(DA, null, saisie('1'), [fichier('1', 'png', '\timage/png', 10)]))).toBe('logo_type')
    expect(cle(refusDuLogo(DA, null, saisie('1'), [fichier('1', 'png', null, 10)]))).toBe('logo_type')
    expect(cle(refusDuLogo(DA, null, saisie('1'), [fichier('1', 'png', 'image/jpeg', 10)]))).toBe('logo_type')
  })

  it('le poids : la borne admise, un octet de plus non ; inconnu ou illisible, refusé ; la borne dite', () => {
    expect(refusDuLogo(DA, null, saisie('2', 'jpg'), [fichier('2', 'jpg', 'image/jpeg', TAILLE_MAX.ventes)])).toBeNull()
    for (const taille of [TAILLE_MAX.ventes + 1, null, -1, 1.5, Number.NaN]) {
      expect(refusDuLogo(DA, null, saisie('2', 'jpg'), [fichier('2', 'jpg', 'image/jpeg', taille)]), String(taille))
        .toEqual({ cle: 'logo_poids', valeurs: [String(TAILLE_MAX.ventes)] })
    }
  })

  it('un logo INCHANGÉ ne se rejuge pas — son fichier parti ou trop lourd ; le même fichier, désigné par une autre version, se juge', () => {
    const avec = { logo_chemin: `${DA}/logos/${H('1')}.png`, logo_sha256: H('1') }
    expect(refusDuLogo(DA, avec, saisie('1'), [])).toBeNull()
    expect(cle(refusDuLogo(DA, { logo_chemin: null, logo_sha256: null }, saisie('1'), []))).toBe('logo_absent')
    // Une version dont les colonnes n'ont pas été lues ne dit pas que le logo est inchangé : il se juge.
    expect(cle(refusDuLogo(DA, {}, saisie('1'), []))).toBe('logo_absent')
    // Inchangé ne dispense pas des formes : elles se jugent d'abord.
    expect(cle(refusDuLogo(DB, avec, saisie('1'), []))).toBe('logo_autre_dossier')
  })
})

describe('ce qu’une version dit de son logo', () => {
  const avec = (c: string, ext = 'png') => ({ logo_chemin: `${DA}/logos/${c.repeat(64)}.${ext}`, logo_sha256: c.repeat(64) })
  const sans = { logo_chemin: null, logo_sha256: null }

  it('non lu, aucun, ou le fichier qu’elle désigne — jamais deviné', () => {
    expect(logoDeLaVersion({})).toBe('non lu')
    expect(logoDeLaVersion({ logo_chemin: null })).toBe('non lu')
    expect(logoDeLaVersion(sans)).toBeNull()
    expect(logoDeLaVersion(avec('1'))).toEqual({ chemin: `${DA}/logos/${'1'.repeat(64)}.png`, empreinte: '1'.repeat(64), type: 'image/png' })
    expect(logoDeLaVersion(avec('2', 'jpg'))).toEqual(expect.objectContaining({ type: 'image/jpeg' }))
    expect(logoDeLaVersion({ logo_chemin: 'ailleurs.png', logo_sha256: '1'.repeat(64) })).toBe('non lu')
    expect(logoDeLaVersion({ logo_chemin: null, logo_sha256: '1'.repeat(64) })).toBe('non lu')
  })

  it('posé, changé, retiré, rien — et rien ne se dit d’une version dont le logo n’a pas été lu', () => {
    expect(changementDuLogo(avec('1'), sans)).toBe('pose')
    expect(changementDuLogo(avec('2'), avec('1'))).toBe('change')
    expect(changementDuLogo(sans, avec('1'))).toBe('retire')
    expect(changementDuLogo(avec('1'), avec('1'))).toBe('aucun')
    expect(changementDuLogo(sans, sans)).toBe('aucun')
    expect(changementDuLogo(avec('1'), {})).toBeNull()
    expect(changementDuLogo({}, avec('1'))).toBeNull()
  })

  it('l’historique des paramètres le nomme, après les conditions et le RIB', () => {
    const v1 = versionParametres({ id: 'v1', logo_chemin: null, logo_sha256: null })
    const v2 = versionParametres({ id: 'v2', remplace_id: 'v1', delai_paiement_jours: 45, ...avec('1') })
    const v3 = versionParametres({ id: 'v3', remplace_id: 'v2', delai_paiement_jours: 45, ...avec('2', 'jpg') })
    const v4 = versionParametres({ id: 'v4', remplace_id: 'v3', delai_paiement_jours: 45, logo_chemin: null, logo_sha256: null })
    expect(champsChanges(v2, v1)).toEqual(['Délai de paiement', 'Logo posé'])
    expect(champsChanges(v3, v2)).toEqual(['Logo changé'])
    expect(champsChanges(v4, v3)).toEqual(['Logo retiré'])
    expect(champsChanges(v4, v4)).toEqual([])
    // Les colonnes absentes de la lecture (la migration pas en base) : rien n'est dit du logo.
    expect(champsChanges(versionParametres({ id: 'x', remplace_id: 'v1' }), v2)).toEqual(['Délai de paiement'])
  })

  it('une saisie REPREND le logo de la version qu’elle remplace — rien sans la migration, sans logo, ou sans lecture', () => {
    expect(logoRepris(avec('1'), true)).toEqual({ logo_chemin: `${DA}/logos/${'1'.repeat(64)}.png`, logo_sha256: '1'.repeat(64) })
    expect(logoRepris(avec('1'), false)).toEqual({})
    expect(logoRepris(null, true)).toEqual({})
    expect(logoRepris(sans, true)).toEqual({})
    expect(logoRepris({}, true)).toEqual({})
  })

  it('le formulaire des paramètres envoie le logo repris, et la base l’accepterait : inchangé, il ne se rejuge pas', () => {
    const courante = versionParametres({ id: 'v1', dossier_id: DA, ...avec('1') })
    const saisie = { ...saisieDeLaVersion(courante), delai: '45' }
    const envoyes = parametresEnvoyes(courante, saisie)
    expect(envoyes).toEqual(expect.objectContaining({ delai_paiement_jours: 45, ...avec('1') }))
    expect(refusDeLaSaisieParametres(DA, 'v1', saisie, [courante])).toBeNull()
    // Sans logo dans la version remplacée, rien n'est ajouté à la saisie.
    expect(Object.keys(parametresEnvoyes(versionParametres({ id: 'v1', dossier_id: DA }), saisie))).not.toContain('logo_chemin')
    expect(versionCourante([courante], DA)).toBe(courante)
  })
})
