import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CATEGORIES_JURIDIQUES, CATEGORIE_ENTREPRENEUR_INDIVIDUEL, categorieJuridique } from './categoriesJuridiques'
import { refusDUneLigne } from './contactsImport'
import { MOYENS_ENCAISSEMENT } from './encaissementsFactures'
import {
  CAPITAL_BORNE,
  CHAMPS_DES_PARAMETRES,
  DELAI_MAX_JOURS,
  DENOMINATION_MAX,
  ESCOMPTE_MAX,
  FORME_BIC,
  FORME_IBAN,
  HYPOTHESES_DES_PARAMETRES_FACTURATION,
  MENTIONS_MAX,
  MOYENS_PROPOSABLES,
  PARAMETRES_FACTURATION_EXPORTES,
  PENALITES_MAX,
  PIED_DE_PAGE_MAX,
  PROPOSITIONS_PAR_DEFAUT,
  RCS_VILLE_MAX,
  REFUS_CONFIRMATION_RIB,
  REFUS_ENREGISTREMENT_PARAMETRES,
  REFUS_IDENTITE_LEGALE,
  TITULAIRE_MAX,
  avantEnPointsDeCode,
  ceQueDitLeRib,
  cleIbanValide,
  denominationProposee,
  etatDuRibEnregistre,
  jourEtHeureAParis,
  refusConfirmationRib,
  refusEnregistrementParametres,
  refusIdentiteLegale,
  ribEnVigueur,
  saisieQuiPart,
  versionCourante,
  type IdentiteLegale,
  type SaisieParametresFacturation,
  type VersionDuRib,
} from './parametresFacturation'
import { versionParametres } from '../test/parametresFacturation'
import { decouper } from '../test/essaiSql'
import { derniereDefinitionSql, fichiersDuSchema } from '../test/schema'

// LE MODULE DES PARAMÈTRES DE FACTURATION, CONFRONTÉ À LA BASE (espace client, étape A5a). La migration est PRÉPARÉE, pas
// appliquée : tant que l'export (supabase/schema) ne la porte pas, la RÉFÉRENCE est l'essai
// `supabase/essais/parametresFacturation.sql`, joué sur une réplique de la production munie de la migration — chacun de ses
// contrôles exige de la base un code ET des mots. Ce test exige que chaque refus du module y soit exigé de la fonction qui
// le lève, et REJOUE dans le module les appels de l'essai, dans leur ordre, sur l'état que ses étapes gardées construisent :
// le même premier refus, ou aucun ; l'état du RIB que la base a écrit ; le RIB qu'une facture verrait. Le jour où l'export
// porte la migration, il confronte aussi le module au texte même des fonctions et des contraintes.

const ESSAI = readFileSync(new URL('../../supabase/essais/parametresFacturation.sql', import.meta.url), 'utf8')

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

const FONCTIONS = ['enregistrer_parametres_facturation', 'confirmer_rib'] as const
type Fonction = (typeof FONCTIONS)[number]
const fonctionAppelee = (ordre: string): Fonction | null => FONCTIONS.find((f) => ordre.includes(`public.${f}(`)) ?? null

const ETAPES = etapesDeLEssai(ESSAI)
const etape = (num: string) => {
  const e = ETAPES.find((x) => x.num === num)
  if (!e) throw new Error(`étape ${num} introuvable dans parametresFacturation.sql`)
  return e
}

describe('l’essai, lu', () => {
  it('ses étapes, toutes : deux de jeu, 203 jugées — le deux-cent-quatrième verdict est le bilan « rien n’est resté »', () => {
    // Le plancher qui distingue « aucun écart » d'« aveugle » : un motif qui ne reconnaîtrait plus les étapes rendrait une
    // liste vide, et toutes les confrontations ci-dessous passeraient sans rien confronter.
    const ouvertes = [...ESSAI.matchAll(/^\s*\('\w+', '(?:jeu|controle|fait|valeur|mutation)'/gm)].length
    expect(ETAPES).toHaveLength(ouvertes)
    expect(ETAPES.filter((e) => e.genre === 'jeu')).toHaveLength(2)
    expect(ETAPES.filter((e) => e.genre !== 'jeu')).toHaveLength(203)
    expect(ETAPES.filter((e) => e.genre === 'mutation')).toHaveLength(12)
    expect(new Set(ETAPES.map((e) => e.num)).size).toBe(ETAPES.length)
  })

  it('un motif « like » se lit comme la base le lit, un modèle du module comme remplirModele l’écrit', () => {
    expect(likeEnRegex('(le __/__/____ à __:__)').test('(le 16/10/2026 à 10:28)')).toBe(true)
    expect(likeEnRegex('(le __/__/____ à __:__)').test('(le 6/10/2026 à 10:28)')).toBe(false)
    expect(likeEnRegex('%dossiers_capital_forme%').test('… « dossiers_capital_forme » …')).toBe(true)
    expect(modeleEnRegex('Le champ « % » n').test('Le champ « logo » n')).toBe(true)
    expect(modeleEnRegex('Le champ « % » n').test('Le champ logo n')).toBe(false)
  })

  it('les colonnes que l’essai attend de la table sont celles du type, dans leur ordre — sans le logo (étape A5c)', () => {
    const colonnes = (etape('0f').attendu as string).split(',').map((c) => c.split(':')[0])
    expect(colonnes).toEqual(Object.keys(versionParametres()))
    expect(colonnes.filter((c) => /logo/.test(c))).toEqual([])
  })

  it('la forme juridique : les 260 codes que la contrainte porte sont ceux du module, à l’empreinte près', () => {
    const codes = CATEGORIES_JURIDIQUES.map((c) => c.code)
    expect(codes).toHaveLength(260)
    expect([...codes].sort()).toEqual(codes)
    expect(new Set(codes).size).toBe(260)
    for (const code of codes) expect(code).toMatch(/^\d{4}$/)
    const empreinte = createHash('md5').update(codes.join(',')).digest('hex')
    expect(`${codes.length} ${empreinte}`).toBe(etape('0j').attendu)
  })
})

// ── 1. Chaque refus du module est exigé de la base par l'essai, sous ses mots et son code ─────────────────────────────

describe('les refus du module sont ceux que la base rend', () => {
  const listes = [
    ['enregistrer_parametres_facturation', REFUS_ENREGISTREMENT_PARAMETRES],
    ['confirmer_rib', REFUS_CONFIRMATION_RIB],
  ] as const

  for (const [fonction, liste] of listes) {
    it(`${fonction} : chaque refus est exigé par un contrôle de l’essai, sous son code et ses mots`, () => {
      const exiges = ETAPES.filter((e) => e.genre === 'controle' && e.code !== 'OK' && e.attendu != null
        && fonctionAppelee(e.ordre) === fonction)
      for (const r of liste) {
        const temoins = exiges.filter((e) => modeleEnRegex(r.modele).test((e.attendu as string).replace(/__\/__\/____ à __:__/, 'X')))
        expect(temoins.length, `${fonction} : le refus « ${r.cle} » n'est exigé par aucun contrôle`).toBeGreaterThan(0)
        for (const e of temoins) expect(e.code, `${fonction}, contrôle ${e.num}`).toBe(r.code)
      }
      expect(new Set(liste.map((r) => r.cle)).size).toBe(liste.length)
      const rangs = [...new Set(liste.map((r) => r.rang))]
      expect(rangs).toEqual(rangs.map((_, i) => i + 1))
    })
  }

  it('sept rangs pour l’enregistrement, dix-sept messages ; cinq pour la confirmation ; l’accès d’abord', () => {
    expect(new Set(REFUS_ENREGISTREMENT_PARAMETRES.map((r) => r.rang)).size).toBe(7)
    expect(REFUS_ENREGISTREMENT_PARAMETRES).toHaveLength(17)
    expect(REFUS_CONFIRMATION_RIB).toHaveLength(5)
    for (const [, liste] of listes) expect(liste[0]).toMatchObject({ cle: 'acces', code: '42501', modele: 'Accès refusé à ce dossier.' })
    // Sans droit, une version qui n'existe pas et une saisie qui n'est pas un objet : le refus d'accès d'abord.
    for (const num of ['6c', '40c', '33h']) expect([etape(num).code, etape(num).attendu]).toEqual(['42501', 'Accès refusé à ce dossier.'])
  })

  it('le cabinet et le client « Ventes » enregistrent par la même fonction ; le cabinet seul confirme', () => {
    expect(etape('0d').attendu).toContain('enregistrer_parametres_facturation= if not public.gere_les_ventes(p_dossier_id) or not exists')
    expect(etape('0d').attendu).toContain('confirmer_rib= if not public.admin_du_dossier(p_dossier_id) or not exists')
    expect([etape('7').qui, etape('7').code]).toEqual(['chef', 'OK'])
    expect([etape('9').qui, etape('9').droits, etape('9').code]).toEqual(['client', 'ventes', 'OK'])
    // Le client ne confirme jamais : avec « Ventes », les deux cases, « Banque » seul, ou sans droit.
    for (const num of ['11', '11b', '11c', '11d']) {
      expect([etape(num).qui, fonctionAppelee(etape(num).ordre), etape(num).code], num).toEqual(['client', 'confirmer_rib', '42501'])
    }
  })
})

// ── 2. Les appels de l'essai, rejoués dans le module, sur l'état que ses étapes gardées construisent ─────────────────

const DOSSIERS = ['DA', 'DB'] as const
type Version = VersionDuRib & { delai_paiement_jours: number | null }

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
  const echappee = /^E'((?:[^']|'')*)'$/.exec(s)
  if (echappee) return sansDoubles(echappee[1]).replace(/\\n/g, '\n').replace(/\\t/g, '\t')
  const texte = /^'((?:[^']|'')*)'$/.exec(s)
  if (texte) return sansDoubles(texte[1]).replace(/^\{(\w+)\}$/, '$1')
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
  version: string | null
  courante: boolean
  saisie: unknown
  selection: string
}

// Un appel `select … from public.f(args) p` : la fonction et ses arguments, lus par parenthèses appariées. La version
// remplacée peut être une sous-requête qui désigne la courante (étape 28e) : elle se lit comme telle.
function appelDe(partie: string): Appel | null {
  const fonction = fonctionAppelee(partie)
  if (!fonction) return null
  const debut = partie.indexOf(`public.${fonction}(`) + `public.${fonction}(`.length
  let profondeur = 1
  let chaine = false
  let fin = debut
  for (; fin < partie.length && profondeur > 0; fin++) {
    if (partie[fin] === "'") chaine = !chaine
    if (!chaine && partie[fin] === '(') profondeur++
    if (!chaine && partie[fin] === ')') profondeur--
  }
  if (partie.slice(fin).trim() !== 'p') return null
  const selection = /^select ([\s\S]*?) from public\./.exec(partie)?.[1] ?? ''
  const args = decouper(partie.slice(debut, fin - 1))
  const dossier = /^'\{(\w+)\}'$/.exec(args[0])?.[1]
  if (!dossier) throw new Error(`dossier illisible : ${args[0]}`)
  const cible = args[1]
  const courante = cible.startsWith('(select x.id from parametres_facturation x where x.dossier_id = ')
  const version = cible === 'null' || courante ? null : /^'\{(\w+)\}'$/.exec(cible)?.[1] ?? null
  if (!courante && cible !== 'null' && version === null) throw new Error(`version illisible : ${cible}`)
  return { fonction, dossier, version, courante, saisie: fonction === 'confirmer_rib' ? null : argumentJson(args[2]), selection }
}

// Qui a accès, comme la base le juge : le chef (super-administrateur) sur les deux dossiers jetables ; le client qui porte
// « Ventes » sur le dossier A, pour enregistrer seulement ; le membre affecté au dossier B. Le module ne juge pas l'accès :
// ces appels-là seuls se rejouent. Le cabinet (`admin_du_dossier`) : le chef, le membre affecté.
const aAcces = (e: EtapeDeLEssai, a: Appel) =>
  (e.qui === 'chef' && (DOSSIERS as readonly string[]).includes(a.dossier))
  || (e.qui === 'client' && a.fonction === 'enregistrer_parametres_facturation' && (e.droits === 'ventes' || e.droits === 'deux')
    && a.dossier === 'DA')
  || (e.qui === 'membre_affecte' && a.dossier === 'DB')
const duCabinet = (e: EtapeDeLEssai) => e.qui === 'chef' || e.qui === 'membre_affecte'
// Le compte de l'appel : le chef, ou le compte du client (le membre du cabinet de l'essai est le compte du client).
const compteDe = (e: EtapeDeLEssai) => (e.qui === 'chef' ? 'CHEF' : 'CLIENT')

interface Rejeu {
  etape: EtapeDeLEssai
  appels: Appel[]
  // Le premier refus, à l'appel où il tombe, ou aucun.
  refus: { cle: string; message: string; code: string } | null
  rangDuRefus: number
  // L'état du RIB de la version écrite ou confirmée par le dernier appel, quand il passe.
  etatEcrit: string | null
  confirmeParEcrit: string | null
}

interface Instantane {
  apres: string
  versions: Map<string, Version>
}

function rejouer(): { rejeux: Rejeu[]; instantanes: Instantane[] } {
  let horloge = 0
  const maintenant = () => new Date(Date.UTC(2026, 9, 16, 8, horloge++)).toISOString()
  const etat = new Map<string, Version>()
  const rejeux: Rejeu[] = []
  const instantanes: Instantane[] = []
  for (const e of ETAPES) {
    if (!['controle', 'fait', 'mutation'].includes(e.genre)) continue
    const parties = e.ordre.split('§§')
    const appels = parties.map(appelDe)
    if (appels.some((a) => a === null)) continue
    const lus = appels as Appel[]
    if (!lus.every((a) => aAcces(e, a))) continue
    // Un contrôle s'annule : ses écritures vivent dans une copie ; une étape gardée écrit dans l'état.
    const local = new Map([...etat].map(([k, v]) => [k, { ...v }]))
    let refus: Rejeu['refus'] = null
    let rangDuRefus = -1
    let etatEcrit: string | null = null
    let confirmeParEcrit: string | null = null
    for (let i = 0; i < lus.length; i++) {
      const a = lus[i]
      const versions = [...local.values()]
      const courante = versionCourante(versions, a.dossier)
      if (courante === 'rompue') throw new Error(`${e.num} : chaîne rompue`)
      const cible = a.courante ? courante?.id ?? null : a.version
      const verdict = a.fonction === 'enregistrer_parametres_facturation'
        ? refusEnregistrementParametres(a.dossier, cible, a.saisie, versions)
        : refusConfirmationRib(a.dossier, cible as string, versions)
      if (verdict === 'rompue') throw new Error(`${e.num} : chaîne rompue`)
      if (verdict) {
        const liste = a.fonction === 'enregistrer_parametres_facturation' ? REFUS_ENREGISTREMENT_PARAMETRES : REFUS_CONFIRMATION_RIB
        refus = { ...verdict, code: (liste as readonly { cle: string; code: string }[]).find((r) => r.cle === verdict.cle)?.code ?? '?' }
        rangDuRefus = i
        break
      }
      const instant = maintenant()
      if (a.fonction === 'enregistrer_parametres_facturation') {
        const recue = JSON.parse(JSON.stringify(a.saisie)) as Record<string, unknown>
        const texte = (cle: string) => (typeof recue[cle] === 'string' ? (recue[cle] as string) : null)
        const rib = etatDuRibEnregistre(courante, recue, duCabinet(e))
        const id = e.genre === 'fait' && i === lus.length - 1 && e.cle ? e.cle : `${e.num}-${i}`
        const confirmation = rib.quoi === 'inchange' && courante
          ? { par: courante.rib_confirme_par, le: courante.rib_confirme_le }
          : rib.etat === 'confirme' ? { par: compteDe(e), le: instant } : { par: null, le: null }
        local.set(id, {
          id, dossier_id: a.dossier, remplace_id: cible, cree_le: instant, auteur: compteDe(e), iban: texte('iban'), bic: texte('bic'),
          titulaire_compte: texte('titulaire_compte'), rib_etat: rib.etat, rib_confirme_par: confirmation.par,
          rib_confirme_le: confirmation.le, delai_paiement_jours: typeof recue.delai_paiement_jours === 'number' ? recue.delai_paiement_jours : null,
        })
        etatEcrit = rib.etat
        confirmeParEcrit = confirmation.par
      } else {
        const v = local.get(cible as string) as Version
        local.set(v.id, { ...v, rib_etat: 'confirme', rib_confirme_par: compteDe(e), rib_confirme_le: instant })
        etatEcrit = 'confirme'
        confirmeParEcrit = compteDe(e)
      }
    }
    rejeux.push({ etape: e, appels: lus, refus, rangDuRefus, etatEcrit, confirmeParEcrit })
    if (e.genre === 'fait' && e.code === 'OK' && !refus) {
      etat.clear()
      for (const [k, v] of local) etat.set(k, v)
      instantanes.push({ apres: e.num, versions: new Map([...etat].map(([k, v]) => [k, { ...v }])) })
    }
  }
  return { rejeux, instantanes }
}

const { rejeux: REJEUX, instantanes: INSTANTANES } = rejouer()
// L'état gardé tel qu'il est juste avant une étape : celui de la dernière étape gardée qui la précède.
function etatAvant(num: string): Map<string, Version> {
  const rang = ETAPES.findIndex((e) => e.num === num)
  let dernier: Map<string, Version> = new Map()
  for (const i of INSTANTANES) if (ETAPES.findIndex((e) => e.num === i.apres) < rang) dernier = i.versions
  return dernier
}

describe('les appels de l’essai, rejoués dans le module', () => {
  it('assez d’appels pour juger : refus et acceptations, des deux fonctions, de chaque rang rejouable', () => {
    expect(REJEUX.length).toBeGreaterThanOrEqual(85)
    expect(REJEUX.filter((r) => r.etape.code === 'OK').length).toBeGreaterThanOrEqual(30)
    for (const f of FONCTIONS) expect(REJEUX.filter((r) => r.appels.some((a) => a.fonction === f)).length, f).toBeGreaterThanOrEqual(8)
    // Le rang 1 (l'accès) se juge en base seulement ; tous les autres refus sont rejoués, chacun sous son message.
    const rejoues = new Set(REJEUX.flatMap((r) => (r.refus ? [r.refus.cle] : [])))
    for (const r of [...REFUS_ENREGISTREMENT_PARAMETRES, ...REFUS_CONFIRMATION_RIB]) {
      if (r.cle !== 'acces') expect(rejoues.has(r.cle), `${r.cle} jamais rejoué`).toBe(true)
    }
  })

  it('chaque appel : le même premier refus que la base, sous le même code, au même appel — ou aucun quand elle accepte', () => {
    const ecarts: string[] = []
    for (const { etape: e, refus, rangDuRefus, appels } of REJEUX) {
      if (e.code === 'OK') {
        if (refus) ecarts.push(`${e.num} : la base accepte, le module refuse « ${(refus as { message: string }).message} »`)
      } else if (!refus) {
        ecarts.push(`${e.num} : la base refuse (${e.code}), le module accepte`)
      } else {
        const r = refus as { message: string; code: string }
        if (!likeEnRegex(e.attendu as string).test(r.message) || r.code !== e.code || rangDuRefus !== appels.length - 1) {
          ecarts.push(`${e.num} : la base « ${e.code} ${e.attendu} », le module « ${r.code} ${r.message} » (appel ${rangDuRefus + 1})`)
        }
      }
    }
    expect(ecarts).toEqual([])
  })

  it('l’état du RIB que la base rend d’un appel est celui que le module déduit', () => {
    const lus = REJEUX.filter((r) => r.etape.code === 'OK' && r.etape.attendu != null && /^p\.rib_etat\b/.test(r.appels[r.appels.length - 1].selection))
    expect(lus.map((r) => r.etape.num).sort()).toEqual(['12', '18', '42', '9c', '9d', 'M11', 'M12', 'M2'].sort())
    for (const r of lus) {
      const [etat, confirmePar] = (r.etape.attendu as string).split(/[|/]/)
      expect(r.etatEcrit, r.etape.num).toBe(etat)
      if (confirmePar === 'nul') expect(r.confirmeParEcrit, r.etape.num).toBeNull()
    }
  })

  // Ce que la base a écrit, relu par une étape « valeur » : la version, et la position de son état dans la ligne rendue.
  const ETATS_LUS: [string, string, number][] = [['8', 'V1', 9], ['9b', 'V2', 0], ['10b', 'V3', 0], ['14b', 'V4', 0], ['16b', 'V6', 0]]
  it.each(ETATS_LUS)('l’étape %s relit l’état du RIB de %s : celui que le module a déduit', (num, version, position) => {
    const lu = (etape(num).attendu as string).split('|')[position]
    expect(etatAvant(num).get(version)?.rib_etat ?? 'nul').toBe(lu)
  })

  it('l’état repris garde la confirmation d’avant : V2 confirmée par le chef à l’instant de V1 ; V6, proposée sans confirmation', () => {
    const v = etatAvant('9b')
    expect([v.get('V2')?.rib_confirme_par, v.get('V2')?.rib_confirme_le]).toEqual(['CHEF', v.get('V1')?.rib_confirme_le])
    expect(etape('9b').attendu).toBe('confirme|true|true|true|true|nul|45')
    const w = etatAvant('16b')
    expect([w.get('V6')?.rib_etat, w.get('V6')?.rib_confirme_par, w.get('V6')?.auteur]).toEqual(['propose', null, 'CHEF'])
  })

  // Le RIB qu'une facture verrait, relu par la base après chaque geste : le module le déduit de la même chaîne.
  const RIB_LUS = ['10c', '12c', '16c', '18b', '19b']
  it.each(RIB_LUS)('l’étape %s : le RIB qu’une facture verrait est celui que le module déduit', (num) => {
    const attendu = (etape(num).attendu as string).split('|').pop()
    const rib = ribEnVigueur([...etatAvant(num).values()], 'DA')
    expect(rib === null ? 'aucun' : rib === 'rompue' ? 'rompue' : rib.iban).toBe(attendu)
  })

  it('ce que dit le RIB d’une version : qui l’a posé, qui l’a confirmé, d’un même geste ou ensuite', () => {
    const versions = [...etatAvant('19b').values()]
    // V1 : posé et confirmé par le chef d'un même geste ; V2 le reprend, confirmation comprise.
    expect(ceQueDitLeRib(versions, 'DA', 'V1')).toMatchObject({ rib: 'confirme', pose: { parQui: 'CHEF' }, confirme: { parQui: 'CHEF' }, dUnMemeGeste: true })
    expect(ceQueDitLeRib(versions, 'DA', 'V2')).toMatchObject({ rib: 'confirme', pose: { parQui: 'CHEF' }, dUnMemeGeste: true })
    // V3 : posé par le client, confirmé ensuite par le chef.
    expect(ceQueDitLeRib(versions, 'DA', 'V3')).toMatchObject({ rib: 'confirme', pose: { parQui: 'CLIENT' }, confirme: { parQui: 'CHEF' }, dUnMemeGeste: false })
    // V5 : proposé par le client ; V6, enregistrée par le chef, l'a repris — le RIB reste posé par le client, puis confirmé.
    expect(ceQueDitLeRib(versions, 'DA', 'V5')).toMatchObject({ rib: 'propose', pose: { parQui: 'CLIENT' } })
    const v6 = ceQueDitLeRib(versions, 'DA', 'V6')
    expect(v6).toMatchObject({ rib: 'confirme', pose: { parQui: 'CLIENT' }, confirme: { parQui: 'CHEF' }, dUnMemeGeste: false })
    expect(etatAvant('19b').get('V6')?.auteur).toBe('CHEF')
    expect(ceQueDitLeRib(versions, 'DA', 'V7')).toEqual({ rib: 'aucun' })
    expect(ceQueDitLeRib(versions, 'DA', 'VB1')).toBeNull()
  })
})

// ── 3. L'identité légale : l'ordre des contraintes, rejoué ──────────────────────────────────────────────────────────

describe('l’identité légale du dossier, rejouée dans le module', () => {
  // L'identité de A telle que l'étape 82 l'écrit, puis chaque mise à jour du propriétaire sur elle (annulée).
  const ASSIGNATION = /^update dossiers set ([\s\S]*) where id = '\{DA\}'$/
  function identiteApres(ordre: string, depart: IdentiteLegale): IdentiteLegale {
    const m = ASSIGNATION.exec(ordre)
    if (!m) throw new Error(`mise à jour illisible : ${ordre}`)
    const suite = { ...depart }
    for (const morceau of decouper(m[1])) {
      const [colonne, valeur] = morceau.split(/ = ([\s\S]*)/)
      if (!(colonne in suite)) throw new Error(`colonne inconnue : ${colonne}`)
      ;(suite as Record<string, unknown>)[colonne] = valeurDeLEssai(valeur)
    }
    return suite
  }
  const ecrite = /update dossiers set ([\s\S]*?) where id = '\{DA\}' returning 1/.exec(etape('82').ordre)?.[1] as string
  const DEPART = identiteApres(`update dossiers set ${ecrite} where id = '{DA}'`, { denomination_imprimee: null, rcs_ville: null, forme_juridique: null, capital: null })

  it('l’identité que le chef écrit passe ; la base l’a rendue telle quelle', () => {
    expect(DEPART).toEqual({ denomination_imprimee: 'ESSAI PARAMETRES SARL', rcs_ville: 'Ville d essai', forme_juridique: '5499', capital: 1000.5 })
    expect(refusIdentiteLegale(DEPART)).toBeNull()
    expect(etape('83').attendu).toBe('ESSAI PARAMETRES SARL|Ville d essai|5499|1000.5')
  })

  const CONTROLES = ETAPES.filter((e) => /^84[a-z]?$/.test(e.num))
  it('chaque mise à jour refusée : la contrainte que la base nomme est la première que le module dit ; acceptée, aucune', () => {
    expect(CONTROLES.map((e) => e.num)).toEqual(['84', '84b', '84c', '84d', '84e', '84f', '84g', '84h', '84i', '84j', '84k', '84l', '84m'])
    for (const e of CONTROLES) {
      const ordre = e.code === 'OK'
        ? `update dossiers set ${(/update dossiers set ([\s\S]*?) where id = '\{DA\}' returning 1/.exec(e.ordre) as RegExpExecArray)[1]} where id = '{DA}'`
        : e.ordre
      const refus = refusIdentiteLegale(identiteApres(ordre, DEPART))
      if (e.code === 'OK') expect(refus, e.num).toBeNull()
      else expect(likeEnRegex(e.attendu as string).test(refus?.contrainte ?? ''), `${e.num} : ${refus?.contrainte}`).toBe(true)
    }
    // Chaque contrainte que le module nomme est exigée, seule ou la première de plusieurs.
    for (const r of REFUS_IDENTITE_LEGALE) {
      expect(CONTROLES.some((e) => e.attendu === `%${r.contrainte}%`), r.contrainte).toBe(true)
    }
  })

  it('l’ordre est celui des noms des contraintes', () => {
    const noms = REFUS_IDENTITE_LEGALE.map((r) => r.contrainte)
    expect([...noms].sort()).toEqual(noms)
  })

  // Le seul chemin d'écriture des quatre colonnes est la policy `dossiers_update`, au cabinet du dossier : l'essai prouve
  // qu'aucune fonction du schéma n'écrit `dossiers` (contrôle 0i) et qu'aucun client ne l'écrit (80 à 80h) ; ce scanner,
  // qu'aucune Edge Function ne l'écrit — elles le LISENT, chaque chaîne commence par `select`. Il part de TOUTES les
  // fonctions du dossier `supabase/functions`, et un plancher distingue « aucune écriture » d'« aveugle ».
  it('aucune Edge Function n’écrit `dossiers` : chaque requête sur la table commence par une lecture', () => {
    const racine = new URL('../../supabase/functions/', import.meta.url)
    const fonctions = readdirSync(racine, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
    expect(fonctions.length).toBeGreaterThanOrEqual(15)
    const requetes: string[] = []
    for (const f of fonctions) {
      const texte = readFileSync(new URL(`${f}/index.ts`, racine), 'utf8')
      for (const m of texte.matchAll(/\.from\(\s*["'`]dossiers["'`]\s*\)/g)) {
        const methode = /^\s*\.(\w+)\(/.exec(texte.slice((m.index as number) + m[0].length))?.[1]
        requetes.push(`${f} ${methode}`)
      }
    }
    expect(requetes.length, requetes.join(' ; ')).toBeGreaterThanOrEqual(8)
    expect(requetes.filter((r) => !r.endsWith(' select'))).toEqual([])
  })
})

// ── 4. Ce que le module lit, comme la base le lit ────────────────────────────────────────────────────────────────────

const DA = 'DA'
const premiere = (o: Partial<VersionDuRib> = {}): VersionDuRib => versionParametres({ id: 'p1', dossier_id: DA, ...o })
const refus = (saisie: unknown, versions: readonly VersionDuRib[] = [], remplace: string | null = null) => {
  const r = refusEnregistrementParametres(DA, remplace, saisie, versions)
  return r === null || r === 'rompue' ? r : r.cle
}
// Des IBAN fictifs à clé juste (le code banque 99999, celui des essais) ; un compte qui porte des lettres ; un autre pays.
const IBANS_JUSTES = [
  'FR9399999000010000000000100', 'FR1299999000010000000000200', 'FR2899999000010000000000300', 'FR4499999000010000000000400',
  'FR6099999000010000000000500', 'FR7699999000010000000000600', 'FR9299999000010000000000700', 'FR5799999000010000ESSAI0100',
  'DE93999999990000000001',
]

describe('l’IBAN et le BIC (ISO 13616, ISO 9362)', () => {
  // La clé, recalculée sur le grand nombre entier : la référence du calcul de proche en proche.
  const cleParLeGrandNombre = (iban: string) => {
    const chiffres = [...iban.slice(4) + iban.slice(0, 4)].map((c) => (c <= '9' ? c : String(c.charCodeAt(0) - 55))).join('')
    return BigInt(chiffres) % 97n === 1n
  }

  it('les IBAN fictifs des essais passent leur clé, et la base les a acceptés', () => {
    for (const iban of IBANS_JUSTES) {
      expect(cleIbanValide(iban), iban).toBe(true)
      expect(cleParLeGrandNombre(iban), iban).toBe(true)
    }
    expect(etape('30h').attendu).toBe('FR5799999000010000ESSAI0100')
    expect(etape('30i').attendu).toBe('DE93999999990000000001')
  })

  it('pour un compte donné, une seule paire de chiffres de contrôle passe, et c’est celle que donne le grand nombre', () => {
    for (const bban of ['99999000010000000000100', '99999000010000ESSAI0100', 'ESSAI', '0', 'Z'.repeat(30)]) {
      const justes = Array.from({ length: 100 }, (_, i) => `FR${String(i).padStart(2, '0')}${bban}`).filter(cleIbanValide)
      expect(justes, bban).toHaveLength(1)
      expect(cleParLeGrandNombre(justes[0]), bban).toBe(true)
    }
  })

  it('une faute de frappe se voit : un chiffre changé, deux chiffres voisins échangés', () => {
    const iban = 'FR9399999000010000000000100'
    for (let i = 4; i < iban.length; i++) {
      const change = iban.slice(0, i) + String((Number(iban[i]) + 1) % 10) + iban.slice(i + 1)
      expect(cleIbanValide(change), change).toBe(false)
      if (i + 1 < iban.length && iban[i] !== iban[i + 1]) {
        expect(cleIbanValide(iban.slice(0, i) + iban[i + 1] + iban[i] + iban.slice(i + 2)), `échange en ${i}`).toBe(false)
      }
    }
  })

  it('la forme électronique : sans espace, en majuscules, d’un à trente caractères après la clé', () => {
    expect(FORME_IBAN.test('FR93' + '9'.repeat(30))).toBe(true)
    expect(FORME_IBAN.test('FR93' + '9'.repeat(31))).toBe(false)
    for (const iban of ['FR93', 'fr9399999000010000000000100', 'FR93 9999 9000 0100 0000 0000 100', 'F19399999', 'FRAB99999', 'FR93é']) {
      expect(FORME_IBAN.test(iban), iban).toBe(false)
      expect(cleIbanValide(iban), iban).toBe(false)
    }
    for (const bic of ['ESSAFR10', 'E5SAFR10XXX', '1234FR10', 'ESSAFRAB']) expect(FORME_BIC.test(bic), bic).toBe(true)
    for (const bic of ['ESSAFR10X', 'essafr10', 'ESSA1R10', 'ESSAFR1', 'ESSAFR10XX', 'ESSA FR10']) expect(FORME_BIC.test(bic), bic).toBe(false)
  })
})

describe('la saisie, lue comme la base la reçoit', () => {
  it('une saisie vide passe ; un champ nul ou absent aussi ; NaN devient nul', () => {
    expect(refus({})).toBeNull()
    expect(refus({ delai_paiement_jours: null, iban: undefined, escompte: null })).toBeNull()
    expect(refus({ delai_paiement_jours: Number.NaN })).toBeNull()
  })

  it('ce qui n’est pas un objet : nul, un tableau, un texte, un nombre', () => {
    for (const saisie of [null, undefined, [30], 'délai : 30 jours', 30, true]) expect(refus(saisie), String(saisie)).toBe('saisie_pas_un_objet')
  })

  it('un champ inconnu se nomme — le premier dans l’ordre des points de code, coupé à quatre-vingts caractères', () => {
    expect(refusEnregistrementParametres(DA, null, { logo_chemin: 'x' }, [])).toEqual({
      cle: 'champ_inconnu', message: "Le champ « logo_chemin » n'est pas un paramètre de facturation.",
    })
    expect((refusEnregistrementParametres(DA, null, { alpha: 1, Zeta: 2 }, []) as { message: string }).message).toContain('« Zeta »')
    const long = (refusEnregistrementParametres(DA, null, { ['x'.repeat(100)]: 1 }, []) as { message: string }).message
    expect(long).toContain(`« ${'x'.repeat(79)}… »`)
    // Un caractère hors du plan de base vient APRÈS U+FFFD dans l'ordre des octets, avant lui en unités UTF-16.
    const astral = String.fromCodePoint(0x1f600)
    expect((refusEnregistrementParametres(DA, null, { [astral]: 1, '�': 2 }, []) as { message: string }).message).toContain('« � »')
    for (const cle of ['id', 'rib_etat', 'auteur', 'remplace_id', 'dossier_id']) expect(refus({ [cle]: 'x' }), cle).toBe('champ_inconnu')
  })

  it('l’ordre des points de code est celui de l’import des contacts, son jumeau', () => {
    const astral = String.fromCodePoint(0x1f600)
    const paires = [[astral, '�'], ['Zeta', 'alpha'], ['é', 'z'], ['a', 'ab'], ['', astral]]
    for (const [a, b] of paires) {
      const ici = [a, b].sort(avantEnPointsDeCode)[0]
      const ligne = refusDUneLigne(DA, null, { [a]: 1, [b]: 2 }, 1, [])
      expect(ligne?.message, `${a} ${b}`).toContain(`« ${ici} »`)
    }
  })

  it('les textes : jamais faits que des quatre blancs de la base, sous leur borne comptée en caractères', () => {
    const emoji = String.fromCodePoint(0x1f600)
    const bornes: [string, number, string][] = [['escompte', ESCOMPTE_MAX, 'escompte'], ['penalites', PENALITES_MAX, 'penalites'],
      ['mentions_complementaires', MENTIONS_MAX, 'mentions_complementaires'], ['pied_de_page', PIED_DE_PAGE_MAX, 'pied_de_page']]
    for (const [champ, max, cle] of bornes) {
      expect(refus({ [champ]: emoji.repeat(max) }), champ).toBeNull()
      expect(refus({ [champ]: emoji.repeat(max + 1) }), champ).toBe(cle)
      expect(refus({ [champ]: ' \t\n\r ' }), champ).toBe(cle)
      expect(refus({ [champ]: '' }), champ).toBe(cle)
      expect(refus({ [champ]: 0 }), champ).toBe(cle)
      expect(refus({ [champ]: ['Mention'] }), champ).toBe(cle)
      expect(refus({ [champ]: ' ' }), champ).toBeNull()
    }
    expect([ESCOMPTE_MAX, PENALITES_MAX, MENTIONS_MAX, PIED_DE_PAGE_MAX, TITULAIRE_MAX]).toEqual([300, 300, 1000, 500, 70])
  })

  it('le délai : un nombre entier de jours, de 0 à 60', () => {
    for (const delai of [0, 30, 60, 30.0]) expect(refus({ delai_paiement_jours: delai }), String(delai)).toBeNull()
    for (const delai of [61, -1, 30.5, '30', 1e21, true]) expect(refus({ delai_paiement_jours: delai }), String(delai)).toBe('delai')
    expect(DELAI_MAX_JOURS).toBe(60)
  })

  it('le moyen proposé : l’un des huit du registre des encaissements, à la lettre près', () => {
    expect(MOYENS_PROPOSABLES).toEqual(MOYENS_ENCAISSEMENT.map((m) => m.moyen))
    expect(MOYENS_PROPOSABLES).toHaveLength(8)
    for (const moyen of MOYENS_PROPOSABLES) expect(refus({ moyen_prefere: moyen }), moyen).toBeNull()
    for (const moyen of ['Virement', 'portefeuille', '', 1]) expect(refus({ moyen_prefere: moyen }), String(moyen)).toBe('moyen')
  })

  it('le RIB : l’IBAN à sa forme puis à sa clé ; le BIC et le titulaire avec lui seulement', () => {
    expect(refus({ iban: IBANS_JUSTES[0], bic: 'ESSAFR10', titulaire_compte: 'ESSAI' })).toBeNull()
    expect(refus({ iban: 'FR9499999000010000000000100' })).toBe('iban_cle')
    expect(refus({ iban: 93999990000100 })).toBe('iban_forme')
    expect(refus({ bic: 'ESSAFR10' })).toBe('bic_sans_iban')
    expect(refus({ bic: 'x', iban: null })).toBe('bic_sans_iban')
    expect(refus({ iban: IBANS_JUSTES[0], bic: 'ESSAFR10X' })).toBe('bic_forme')
    expect(refus({ titulaire_compte: 'ESSAI' })).toBe('titulaire_sans_iban')
    expect(refus({ iban: IBANS_JUSTES[0], titulaire_compte: 't'.repeat(TITULAIRE_MAX) })).toBeNull()
    expect(refus({ iban: IBANS_JUSTES[0], titulaire_compte: 't'.repeat(TITULAIRE_MAX + 1) })).toBe('titulaire')
    expect(refus({ iban: IBANS_JUSTES[0], titulaire_compte: '  ' })).toBe('titulaire')
  })

  it('l’ordre des rangs : la saisie, les textes, le délai, le moyen, l’IBAN, le BIC, le titulaire', () => {
    expect(refus({ escompte: 'e'.repeat(301), remise: 1 })).toBe('champ_inconnu')
    expect(refus({ pied_de_page: '', delai_paiement_jours: 99 })).toBe('pied_de_page')
    expect(refus({ escompte: '', penalites: '' })).toBe('escompte')
    expect(refus({ delai_paiement_jours: 99, moyen_prefere: 'troc' })).toBe('delai')
    expect(refus({ moyen_prefere: 'troc', iban: 'fr93' })).toBe('moyen')
    expect(refus({ iban: 'FR9499999000010000000000100', bic: 'x' })).toBe('iban_cle')
    expect(refus({ bic: 'x', titulaire_compte: 'ESSAI' })).toBe('bic_sans_iban')
    expect(refus({ iban: IBANS_JUSTES[0], bic: 'x', titulaire_compte: '' })).toBe('bic_forme')
  })
})

describe('la chaîne des versions', () => {
  const v1 = premiere({ id: 'p1', cree_le: '2026-10-16T08:00:00Z' })
  const v2 = premiere({ id: 'p2', remplace_id: 'p1', cree_le: '2026-10-16T08:05:00Z' })

  it('la courante : aucune, la première, la dernière d’une chaîne ; rompue quand les versions lues n’en font pas une', () => {
    expect(versionCourante([], DA)).toBeNull()
    expect(versionCourante([v1], DA)).toBe(v1)
    expect(versionCourante([v2, v1], DA)).toBe(v2)
    expect(versionCourante([v2], DA)).toBe('rompue')
    expect(versionCourante([v1, v2, premiere({ id: 'p3', remplace_id: 'p1' })], DA)).toBe('rompue')
    expect(versionCourante([v1, premiere({ id: 'p9' })], DA)).toBe('rompue')
    expect(versionCourante([v1, v2, premiere({ id: 'p3', dossier_id: 'DB' })], DA)).toBe(v2)
  })

  it('la version remplacée : de ce dossier, puis la courante — sinon la saisie passée entre-temps, nommée à Paris', () => {
    expect(refus({}, [v1, v2], 'p2')).toBeNull()
    expect(refus({}, [v1, v2], 'inconnue')).toBe('remplacee_d_un_autre_dossier')
    expect(refus({}, [v1, v2, premiere({ id: 'b1', dossier_id: 'DB' })], 'b1')).toBe('remplacee_d_un_autre_dossier')
    expect(refusEnregistrementParametres(DA, 'p1', {}, [v1, v2])).toEqual({
      cle: 'remplacee_pas_courante',
      message: "D'autres paramètres de facturation ont été enregistrés entre-temps (le 16/10/2026 à 10:05) : relire avant d'enregistrer.",
    })
    expect(refus({}, [v1, v2], null)).toBe('remplacee_pas_courante')
    expect(refus({}, [], null)).toBeNull()
    expect(refus({}, [v2], 'p2')).toBe('rompue')
    // La version remplacée avant la saisie : une saisie qui n'est pas un objet n'est pas jugée sur une version périmée.
    expect(refus([1], [v1, v2], 'p1')).toBe('remplacee_pas_courante')
  })

  it('le jour et l’heure à Paris, quel que soit le fuseau de qui regarde : heure d’été, heure d’hiver, minuit', () => {
    expect(jourEtHeureAParis('2026-10-16T08:05:00Z')).toBe('16/10/2026 à 10:05')
    expect(jourEtHeureAParis('2026-12-31T23:30:00Z')).toBe('01/01/2027 à 00:30')
    expect(jourEtHeureAParis('2026-03-29T00:59:59Z')).toBe('29/03/2026 à 01:59')
    expect(jourEtHeureAParis('2026-03-29T01:00:00Z')).toBe('29/03/2026 à 03:00')
    expect(jourEtHeureAParis('2026-10-16T08:05:00.123456+00:00')).toBe('16/10/2026 à 10:05')
  })

  it('confirmer : la version de ce dossier, la courante, un RIB, pas déjà confirmé', () => {
    const rib = { iban: IBANS_JUSTES[0], rib_etat: 'propose' as const }
    const a = premiere({ id: 'p1', ...rib, cree_le: '2026-10-16T08:00:00Z' })
    const b = premiere({ id: 'p2', remplace_id: 'p1', ...rib, cree_le: '2026-10-16T08:05:00Z' })
    const r = (id: string, versions: readonly VersionDuRib[]) => {
      const x = refusConfirmationRib(DA, id, versions)
      return x === null || x === 'rompue' ? x : x.cle
    }
    expect(r('p2', [a, b])).toBeNull()
    expect(r('inconnue', [a, b])).toBe('introuvable')
    expect(r('p1', [a, b])).toBe('pas_courante')
    expect((refusConfirmationRib(DA, 'p1', [a, b]) as { message: string }).message)
      .toBe("D'autres paramètres de facturation ont été enregistrés entre-temps (le 16/10/2026 à 10:05) : relire avant de confirmer le RIB.")
    expect(r('p1', [premiere({ id: 'p1' })])).toBe('sans_rib')
    expect(r('p1', [premiere({ id: 'p1', iban: IBANS_JUSTES[0], rib_etat: 'confirme' })])).toBe('deja_confirme')
    expect(r('p2', [b])).toBe('rompue')
  })
})

describe('l’état du RIB (MEG1-Q12, hypothèse)', () => {
  const confirmee = { iban: IBANS_JUSTES[0], bic: 'ESSAFR10', titulaire_compte: 'ESSAI', rib_etat: 'confirme' as const }
  it('sans IBAN, aucun ; inchangé, il garde son état — même réenregistré par le cabinet ; changé, confirmé ou proposé selon qui', () => {
    expect(etatDuRibEnregistre(null, {}, true)).toEqual({ quoi: 'aucun', etat: null })
    expect(etatDuRibEnregistre(confirmee, { delai_paiement_jours: 30 }, false)).toEqual({ quoi: 'aucun', etat: null })
    expect(etatDuRibEnregistre(null, { iban: IBANS_JUSTES[0] }, true)).toEqual({ quoi: 'confirme', etat: 'confirme' })
    expect(etatDuRibEnregistre(null, { iban: IBANS_JUSTES[0] }, false)).toEqual({ quoi: 'propose', etat: 'propose' })
    const meme = { iban: IBANS_JUSTES[0], bic: 'ESSAFR10', titulaire_compte: 'ESSAI' }
    expect(etatDuRibEnregistre(confirmee, meme, false)).toEqual({ quoi: 'inchange', etat: 'confirme' })
    expect(etatDuRibEnregistre({ ...confirmee, rib_etat: 'propose' }, meme, true)).toEqual({ quoi: 'inchange', etat: 'propose' })
    // L'IBAN, le BIC et le titulaire, ensemble : un seul qui change, et le RIB n'est plus le même.
    expect(etatDuRibEnregistre(confirmee, { ...meme, titulaire_compte: 'AUTRE' }, false).etat).toBe('propose')
    expect(etatDuRibEnregistre(confirmee, { ...meme, bic: null }, false).etat).toBe('propose')
    expect(etatDuRibEnregistre(confirmee, { ...meme, iban: IBANS_JUSTES[1] }, true).quoi).toBe('confirme')
  })

  it('d’un même geste : à l’instant où le RIB est posé ET par son auteur — un même compte qui confirme plus tard, non', () => {
    const rib = { id: 'p1', iban: IBANS_JUSTES[0], rib_etat: 'confirme' as const, auteur: 'u1', cree_le: '2026-10-16T08:00:00Z' }
    const dit = (o: Partial<VersionDuRib>) => ceQueDitLeRib([premiere({ ...rib, ...o })], DA, 'p1')
    expect(dit({ rib_confirme_par: 'u1', rib_confirme_le: '2026-10-16T08:00:00Z' })).toMatchObject({ dUnMemeGeste: true })
    // Le compte d'un client devenu membre du cabinet, qui confirme ensuite le RIB qu'il avait proposé.
    expect(dit({ rib_confirme_par: 'u1', rib_confirme_le: '2026-10-17T08:00:00Z' })).toMatchObject({ dUnMemeGeste: false })
    expect(dit({ rib_confirme_par: 'u2', rib_confirme_le: '2026-10-16T08:00:00Z' })).toMatchObject({ dUnMemeGeste: false })
  })

  it('le RIB en vigueur remonte les versions proposées ; aucun quand la première qui ne l’est pas n’a pas de RIB', () => {
    const v = (id: string, remplace: string | null, o: Partial<VersionDuRib>) => premiere({ id, remplace_id: remplace, ...o })
    const a = v('a', null, { iban: IBANS_JUSTES[0], rib_etat: 'confirme', rib_confirme_par: 'u', rib_confirme_le: 't' })
    const b = v('b', 'a', { iban: IBANS_JUSTES[1], rib_etat: 'propose' })
    const c = v('c', 'b', { iban: IBANS_JUSTES[2], rib_etat: 'propose' })
    expect(ribEnVigueur([a, b, c], DA)).toMatchObject({ iban: IBANS_JUSTES[0], version: 'a' })
    expect(ribEnVigueur([v('a', null, {}), b, c], DA)).toBeNull()
    expect(ribEnVigueur([v('a', null, { iban: IBANS_JUSTES[0], rib_etat: 'propose' })], DA)).toBeNull()
    expect(ribEnVigueur([], DA)).toBeNull()
    expect(ribEnVigueur([b, c], DA)).toBe('rompue')
    const d = v('d', 'c', {})
    expect(ribEnVigueur([a, b, c, d], DA)).toBeNull()
  })
})

describe('les mentions proposées (MEG1-Q13, hypothèse)', () => {
  it('chacune est une saisie que la base accepte, et dit sa source', () => {
    expect(refus(PROPOSITIONS_PAR_DEFAUT)).toBeNull()
    expect(PROPOSITIONS_PAR_DEFAUT.delai_paiement_jours).toBe(30)
    expect(PROPOSITIONS_PAR_DEFAUT.escompte).toBe("Pas d'escompte pour paiement anticipé.")
    expect(PROPOSITIONS_PAR_DEFAUT.penalites).toContain('majoré de 10 points de pourcentage (C. com., art. L441-10, II)')
    // L'essai les a fait accepter par la base (étape 7), mot pour mot pour l'escompte.
    expect(etape('7').ordre).toContain(`"escompte":"${PROPOSITIONS_PAR_DEFAUT.escompte.replace(/'/g, "''")}"`)
  })
})

describe('la saisie telle qu’elle part', () => {
  const vide: SaisieParametresFacturation = {
    delai: '', moyen: '', escompte: '', penalites: '', mentions: '', piedDePage: '', iban: '', bic: '', titulaire: '',
  }
  it('les blancs des bords partent, un champ vide part nul ; l’IBAN et le BIC sans aucun blanc, en majuscules', () => {
    expect(saisieQuiPart(vide)).toEqual({
      delai_paiement_jours: null, moyen_prefere: null, escompte: null, penalites: null, mentions_complementaires: null,
      pied_de_page: null, iban: null, bic: null, titulaire_compte: null,
    })
    const partie = saisieQuiPart({
      ...vide, delai: ' 45 ', moyen: 'virement', escompte: ' Néant \n', mentions: 'ligne 1\nligne 2', iban: 'fr76 9999 9000 0100 0000 0000 600',
      bic: ' essa fr10 ', titulaire: '  ESSAI  ',
    })
    expect(partie).toMatchObject({
      delai_paiement_jours: 45, moyen_prefere: 'virement', escompte: 'Néant', mentions_complementaires: 'ligne 1\nligne 2',
      iban: 'FR7699999000010000000000600', bic: 'ESSAFR10', titulaire_compte: 'ESSAI',
    })
    expect(refus(partie)).toBeNull()
    expect(saisieQuiPart({ ...vide, delai: '30 jours' }).delai_paiement_jours).toBe('30 jours')
    expect(refus(saisieQuiPart({ ...vide, delai: '30 jours' }))).toBe('delai')
    // Les champs qui partent sont ceux d'une version, dans l'ordre de la fonction.
    expect(Object.keys(saisieQuiPart(vide))).toEqual([...CHAMPS_DES_PARAMETRES])
  })
})

describe('l’identité légale (MEG1-Q14, hypothèse)', () => {
  const rien: IdentiteLegale = { denomination_imprimee: null, rcs_ville: null, forme_juridique: null, capital: null }
  const cle = (o: Partial<IdentiteLegale>) => refusIdentiteLegale({ ...rien, ...o })?.cle ?? null
  it('rien n’est imposé : tout nul passe', () => {
    expect(cle({})).toBeNull()
  })
  it('le capital : positif, au centime, sous sa borne ; jamais pour un entrepreneur individuel', () => {
    for (const capital of [0.01, 1000.5, 1000.55, CAPITAL_BORNE - 0.01]) expect(cle({ capital }), String(capital)).toBeNull()
    for (const capital of [0, -1, 1000.555, CAPITAL_BORNE, 1e-7, Number.NaN, 0.1 + 0.2]) expect(cle({ capital }), String(capital)).toBe('capital')
    expect(cle({ forme_juridique: CATEGORIE_ENTREPRENEUR_INDIVIDUEL, capital: 1000 })).toBe('capital_d_un_entrepreneur_individuel')
    expect(cle({ forme_juridique: CATEGORIE_ENTREPRENEUR_INDIVIDUEL })).toBeNull()
  })
  it('la dénomination et la ville du greffe : ni faites de blancs, sous leur borne', () => {
    expect(cle({ denomination_imprimee: 'd'.repeat(DENOMINATION_MAX) })).toBeNull()
    expect(cle({ denomination_imprimee: 'd'.repeat(DENOMINATION_MAX + 1) })).toBe('denomination')
    expect(cle({ denomination_imprimee: ' \n' })).toBe('denomination')
    expect(cle({ rcs_ville: 'v'.repeat(RCS_VILLE_MAX) })).toBeNull()
    expect(cle({ rcs_ville: 'v'.repeat(RCS_VILLE_MAX + 1) })).toBe('rcs_ville')
  })
  it('la forme : un code de la nomenclature, à la lettre près', () => {
    for (const forme of ['1000', '5499', '5485', '5710', '6589', '9220']) expect(cle({ forme_juridique: forme }), forme).toBeNull()
    for (const forme of ['5498', '549', '05499', 'SARL', '']) expect(cle({ forme_juridique: forme }), forme).toBe('forme_juridique')
    expect(categorieJuridique('5499')?.libelle).toBe('Société à responsabilité limitée (sans autre indication)')
    expect(categorieJuridique('1000')?.libelle).toBe('Entrepreneur individuel')
  })
  it('la dénomination proposée à un entrepreneur individuel : son nom suivi de « EI » (R526-27), une proposition', () => {
    expect(denominationProposee('Jeanne Essai', '1000')).toBe('Jeanne Essai EI')
    expect(denominationProposee(' Jeanne Essai EI ', '1000')).toBe('Jeanne Essai EI')
    expect(denominationProposee('Jeanne Essai, entrepreneur individuel', '1000')).toBe('Jeanne Essai, entrepreneur individuel')
    expect(denominationProposee('Jeanne Essai', '5499')).toBeNull()
    expect(denominationProposee('  ', '1000')).toBeNull()
  })
})

// ── 5. Le jour où l'export porte la migration ───────────────────────────────────────────────────────────────────────

const messagesSql = (sql: string) => [...sql.matchAll(/raise exception '((?:[^']|'')*)'/g)].map((m) => sansDoubles(m[1]))
const codesSql = (sql: string) => [...sql.matchAll(/raise exception '(?:[^']|'')*'[^;]*?using errcode = '(\w+)'/g)].map((m) => m[1])

describe('PARAMETRES_FACTURATION_EXPORTES dit ce que porte l’export', () => {
  const portee = fichiersDuSchema().some((f) => /create table public\.parametres_facturation \(/.test(f.texte))

  it('le drapeau, et la migration avec lui', () => {
    expect(portee, 'PARAMETRES_FACTURATION_EXPORTES ne dit plus ce que porte l’export').toBe(PARAMETRES_FACTURATION_EXPORTES)
  })

  const migration = () => {
    const schema = new URL('../../supabase/schema/', import.meta.url)
    const noms = readdirSync(schema).filter((nom) => /^\d{14}_parametres_facturation\.sql$/.test(nom))
    expect(noms, 'la migration parametres_facturation doit être UNE dans l’export').toHaveLength(1)
    return readFileSync(new URL(noms[0], schema), 'utf8')
  }

  it('exportée, les fonctions disent les refus du module, dans le même ordre et sous les mêmes codes', () => {
    if (!PARAMETRES_FACTURATION_EXPORTES) return
    for (const [fonction, liste] of [['enregistrer_parametres_facturation', REFUS_ENREGISTREMENT_PARAMETRES],
      ['confirmer_rib', REFUS_CONFIRMATION_RIB]] as const) {
      expect(messagesSql(derniereDefinitionSql(fonction)), fonction).toEqual(liste.map((r) => r.modele))
      expect(codesSql(derniereDefinitionSql(fonction)), fonction).toEqual(liste.map((r) => r.code))
    }
  })

  it('exportée, ses valeurs sont celles du module : champs, moyens, bornes, formes, blancs, codes de l’INSEE', () => {
    if (!PARAMETRES_FACTURATION_EXPORTES) return
    const texte = migration()
    const enregistrer = derniereDefinitionSql('enregistrer_parametres_facturation')
    const liste = (motif: RegExp, source: string) => [...(motif.exec(source)?.[1] ?? '').matchAll(/'(\w+)'/g)].map((m) => m[1])
    expect(liste(/where k not in \(([^)]*)\)/, enregistrer)).toEqual([...CHAMPS_DES_PARAMETRES])
    expect(liste(/p_parametres->>'moyen_prefere' not in \(([^)]*)\)/, enregistrer)).toEqual([...MOYENS_PROPOSABLES])
    expect(liste(/check \(moyen_prefere in \(([^)]*)\)\)/, texte)).toEqual([...MOYENS_PROPOSABLES])
    for (const [champ, max] of [['escompte', ESCOMPTE_MAX], ['penalites', PENALITES_MAX], ['mentions_complementaires', MENTIONS_MAX],
      ['pied_de_page', PIED_DE_PAGE_MAX], ['titulaire_compte', TITULAIRE_MAX]] as const) {
      expect(enregistrer, champ).toContain(`char_length(p_parametres->>'${champ}') > ${max}`)
      expect(texte, champ).toContain(`check (btrim(${champ}, E' \\t\\n\\r') <> '' and char_length(${champ}) <= ${max})`)
    }
    expect(enregistrer).toContain(`::numeric not between 0 and ${DELAI_MAX_JOURS}`)
    expect(texte).toContain(`check (delai_paiement_jours between 0 and ${DELAI_MAX_JOURS})`)
    expect(texte.split(`'${FORME_IBAN.source}'`).length - 1).toBe(2)
    expect(texte.split(`'${FORME_BIC.source}'`).length - 1).toBe(2)
    expect(enregistrer).toContain("order by k collate \"C\" limit 1")
    expect(enregistrer).toContain("case when char_length(v_inconnu) > 80 then left(v_inconnu, 79) || '…' else v_inconnu end")
    expect(enregistrer).toContain("to_char(v_courante.cree_le at time zone 'Europe/Paris', 'DD/MM/YYYY \"à\" HH24:MI')")
    // La clé de l'IBAN : la rotation, la conversion des lettres, le reste.
    expect(enregistrer).toContain('v_car := substr(substr(v_iban, 5) || left(v_iban, 4), i, 1);')
    expect(enregistrer).toContain('(ascii(v_car) - 55)::text')
    expect(enregistrer).toContain('if v_converti::numeric % 97 <> 1 then')
    // L'identité légale : les cinq contraintes, et les 260 codes de l'INSEE, ni plus ni moins.
    for (const r of REFUS_IDENTITE_LEGALE) expect(texte, r.contrainte).toContain(`constraint ${r.contrainte}`)
    expect(liste(/check \(forme_juridique in \(([^)]*)\)\)/, texte.replace(/\s+/g, ' '))).toEqual(CATEGORIES_JURIDIQUES.map((c) => c.code))
    expect(texte).toContain(`check (capital > 0 and capital = round(capital, 2) and capital < ${CAPITAL_BORNE})`)
    expect(texte).toContain(`check (capital is null or forme_juridique is distinct from '${CATEGORIE_ENTREPRENEUR_INDIVIDUEL}')`)
    expect(texte).toContain(`char_length(denomination_imprimee) <= ${DENOMINATION_MAX}`)
    expect(texte).toContain(`char_length(rcs_ville) <= ${RCS_VILLE_MAX}`)
  })

  it('exportée, qui lit et qui écrit : trois policies aux connectés, aucune écriture directe hors de la restauration', () => {
    if (!PARAMETRES_FACTURATION_EXPORTES) return
    const texte = migration()
    const policies = [...texte.matchAll(/create policy (\w+) on public\.parametres_facturation\s+for (\w+) to (\w+) (using|with check) \(([^;]*)\);/g)]
      .map((m) => `${m[1]} ${m[2]} ${m[3]} ${m[4]} ${m[5]}`)
    expect(policies).toEqual([
      'parametres_facturation_lecture select authenticated using public.admin_du_dossier(dossier_id)',
      "parametres_facturation_lecture_ventes select authenticated using public.client_du_dossier(dossier_id, 'ventes')",
      'parametres_facturation_restauration insert authenticated with check public.is_super_admin()',
    ])
    expect([...texte.matchAll(/create policy/g)]).toHaveLength(3)
    for (const fonction of ['enregistrer_parametres_facturation(uuid, uuid, jsonb)', 'confirmer_rib(uuid, uuid)']) {
      expect(texte).toContain(`revoke execute on function public.${fonction} from public, anon;`)
      expect(texte).toContain(`grant execute on function public.${fonction} to authenticated;`)
    }
    expect(texte).toContain('revoke execute on function public.garder_parametres_facturation() from public, anon, authenticated;')
    // L'accès d'abord : les ventes pour enregistrer, le cabinet pour confirmer.
    expect(derniereDefinitionSql('enregistrer_parametres_facturation'))
      .toMatch(/\$\$\ndeclare[\s\S]*?\nbegin\n {2}if not public\.gere_les_ventes\(p_dossier_id\) or not exists/)
    expect(derniereDefinitionSql('confirmer_rib'))
      .toMatch(/\$\$\ndeclare[\s\S]*?\nbegin\n {2}if not public\.admin_du_dossier\(p_dossier_id\) or not exists/)
    // Rien n'y retire quoi que ce soit : le mot n'y paraît que dans trois formes, qu'`apply_migration` prend sans confirmation.
    const instructions = texte.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')
    const restes = instructions.replace(/on delete cascade/g, '').replace(/before insert or update or delete/g, '')
      .replace(/tg_op = 'DELETE'/g, '')
    expect(restes).not.toMatch(/\b(delete|drop|truncate)\b/i)
    // Chaque hypothèse est nommée dans l'en-tête, figé avec l'historique.
    for (const question of Object.keys(HYPOTHESES_DES_PARAMETRES_FACTURATION)) expect(texte, question).toContain(question)
  })
})
