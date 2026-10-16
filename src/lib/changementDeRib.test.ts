import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  AUTEURS_DU_CHANGEMENT, CHANGEMENT_DE_RIB_EXPORTE, CLES_DU_CHANGEMENT, COMBINAISONS_DU_CHANGEMENT, CONSEIL_AU_CLIENT_BANQUE,
  CONSEIL_AU_CLIENT_VENTES, CONSEIL_D_UN_RETRAIT, EFFETS_SUR_LE_RIB_EN_VIGUEUR, ETATS_APRES_LE_CHANGEMENT, GESTES_DU_RIB,
  avisDuChangement, lireLeChangementDeRib, type ChangementDeRib, type DestinataireDuChangement,
} from './changementDeRib'
import { motsDuCabinet } from './espaceVentes'
import { etatDuRibEnregistre, ribEnVigueur, versionCourante, type VersionDuRib } from './parametresFacturation'
import { CONSEIL_VERIFICATION_RIB } from './parametresFacturationVue'
import { decouper, lignesInserees } from '../test/essaiSql'
import { derniereDefinitionSql, fichiersDuSchema } from '../test/schema'

// LE DERNIER CHANGEMENT DU RIB, CONFRONTÉ À LA BASE (espace client, étape A5b3a). La migration est appliquée et l'export la
// porte : le texte même de la fonction est confronté au module (section 6), et l'essai
// `supabase/essais/dernierChangementDeRib.sql`, joué en production comme sur une réplique, reste la référence de ce qu'elle
// rend — chaque valeur qu'il exige de la base est un texte exact.
// Ce test (1) lit chacune dans le module ; (2) REJOUE les versions de l'essai, étape par étape, et retrouve chacune par une
// règle écrite ICI, indépendante du texte SQL — le RIB en vigueur y est celui que dit `ribEnVigueur` (lib/parametres-
// Facturation.ts), l'état d'un RIB enregistré celui que dit `etatDuRibEnregistre` ; (3) parcourt toutes les chaînes courtes
// et retrouve les quinze combinaisons du module, ni plus ni moins ; (4) le jour où l'export porte la migration, confronte le
// module au texte même de la fonction.

const ESSAI = readFileSync(new URL('../../supabase/essais/dernierChangementDeRib.sql', import.meta.url), 'utf8')

interface Etape {
  num: string
  genre: string
  qui: string
  droits: string | null
  ordre: string
  code: string
  attendu: string | null
}

const sansDoubles = (texte: string) => texte.replace(/''/g, "'")

const ETAPES: Etape[] = [...ESSAI.matchAll(
  /\('(\w+)', '(jeu|controle|fait|valeur|mutation)', '(?:[^']|'')*', '(\w+)', (null|'\w+'),\s*\$q\$([\s\S]*?)\$q\$,\s*'(\w+)', (null|'((?:[^']|'')*)')\)/g,
)].map((m) => ({
  num: m[1], genre: m[2], qui: m[3], droits: m[4] === 'null' ? null : m[4].slice(1, -1), ordre: m[5], code: m[6],
  attendu: m[8] === undefined ? null : sansDoubles(m[8]),
}))
const etape = (num: string) => {
  const e = ETAPES.find((x) => x.num === num)
  if (!e) throw new Error(`étape ${num} introuvable dans dernierChangementDeRib.sql`)
  return e
}

// Le jour à Paris d'un instant, comme la base l'écrit (`(instant at time zone 'Europe/Paris')::date`).
function jourAParis(instant: string): string {
  const parties = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(instant))
  const partie = (type: string) => parties.find((p) => p.type === type)?.value ?? ''
  return `${partie('year')}-${partie('month')}-${partie('day')}`
}

// L'instant de la transaction de l'essai : tout ce que les deux fonctions y écrivent porte le même (`now()`), et {AUJ}
// est son jour à Paris. Une heure de l'après-midi, loin de minuit dans tous les fuseaux du test.
const INSTANT_DE_L_ESSAI = '2026-10-16T13:00:00.000Z'
const AUJ = jourAParis(INSTANT_DE_L_ESSAI)

// ── 1. L'essai, lu ─────────────────────────────────────────────────────────────────────────────────────────────────
const LECTURES = ETAPES.filter((e) => /public\.dernier_changement_de_rib\('\{\w+\}'\)::text\$?$/.test(e.ordre.split('§§').pop() as string)
  && e.code === 'OK')
const valeurAttendue = (e: Etape) => JSON.parse((e.attendu as string).replace('{AUJ}', AUJ)) as unknown

describe('l’essai, lu', () => {
  it('ses étapes : le jeu, le catalogue, les refus, chaque geste, les versions restaurées, les mutations', () => {
    const ouvertes = [...ESSAI.matchAll(/^\s*\('\w+', '(?:jeu|controle|fait|valeur|mutation)'/gm)].length
    expect(ETAPES.length).toBe(ouvertes)
    expect(ETAPES.filter((e) => e.genre === 'jeu')).toHaveLength(2)
    expect(ETAPES.filter((e) => e.genre === 'mutation')).toHaveLength(5)
    expect(LECTURES.length).toBeGreaterThanOrEqual(40)
  })

  it('chaque refus est la raison d’accès, sous ses mots et son code ; l’anonyme, le droit d’exécution', () => {
    const refus = ETAPES.filter((e) => e.code !== 'OK')
    expect(refus.length).toBeGreaterThanOrEqual(10)
    for (const e of refus) {
      expect([e.code, e.attendu], e.num).toEqual(['42501', e.qui === 'anon'
        ? 'permission denied for function dernier_changement_de_rib' : 'Accès refusé à ce dossier.'])
    }
    // Le client sans aucune case, sur un autre dossier, un membre hors de ses dossiers, un compte rattaché à rien : refusés.
    expect([etape('3').qui, etape('3').droits]).toEqual(['client', 'aucun'])
    expect(['4', '4b', '4c', '5', '5b', '6', '6b', '2'].every((n) => etape(n).code === '42501')).toBe(true)
  })

  it('chaque valeur que la base rend se LIT dans le module, et chacune des quinze combinaisons y est exigée', () => {
    const vues = new Set<string>()
    for (const e of LECTURES) {
      const lu = lireLeChangementDeRib(valeurAttendue(e))
      expect(lu, `${e.num} : ${e.attendu}`).not.toBeNull()
      const c = lu?.changement
      if (c) vues.add(`${c.geste}|${c.auteur}|${c.etat}|${c.ribEnVigueur}`)
    }
    expect([...vues].sort()).toEqual([...COMBINAISONS_DU_CHANGEMENT].sort())
  })

  it('le client « Banque » seul, « Ventes », les deux, le chef : la même valeur, au caractère près', () => {
    const memes = ['26b', '26c', '26d', '26e'].map((n) => etape(n))
    expect(memes.map((e) => [e.qui, e.droits])).toEqual([['client', 'banque'], ['client', 'ventes'], ['client', 'deux'], ['chef', null]])
    expect(new Set(memes.map((e) => e.attendu)).size).toBe(1)
  })
})

// ── 2. Les versions de l'essai, rejouées ───────────────────────────────────────────────────────────────────────────
type Version = VersionDuRib

// La règle, écrite ici sans le texte SQL : la chaîne dans son ordre ; un événement par version qui change le RIB (le
// triplet), puis un par confirmation qui SUIT un RIB proposé à sa création ; le RIB en vigueur avant et après chacun, tel
// que `ribEnVigueur` le dit de la chaîne À CET INSTANT (la version qui vient d'être écrite avec l'état qu'elle avait alors).
function regle(versions: readonly Version[], dossier: string): ChangementDeRib | null {
  const chaine: Version[] = []
  const courante = versionCourante(versions, dossier)
  if (courante === 'rompue') throw new Error('chaîne rompue')
  const parId = new Map(versions.filter((v) => v.dossier_id === dossier).map((v) => [v.id, v]))
  for (let v = courante ?? undefined; v; v = v.remplace_id === null ? undefined : parId.get(v.remplace_id)) chaine.unshift(v)
  const triplet = (v: Version | null | undefined) => (v ? [v.iban, v.bic, v.titulaire_compte] : [null, null, null]).join('\u0000')
  const tripletDuRib = (r: ReturnType<typeof ribEnVigueur>) => (r && r !== 'rompue' ? [r.iban, r.bic, r.titulaire_compte].join('\u0000') : null)
  const effet = (avant: string | null, apres: string | null): ChangementDeRib['ribEnVigueur'] =>
    avant === null && apres === null ? 'aucun' : avant === apres ? 'inchange' : avant === null ? 'pose' : apres === null ? 'retire' : 'change'
  let dernier: ChangementDeRib | null = null
  for (let k = 0; k < chaine.length; k++) {
    const v = chaine[k]
    const p = k > 0 ? chaine[k - 1] : null
    const change = triplet(v) !== triplet(p)
    const dEmblee = v.rib_etat === 'confirme' && v.rib_confirme_par === v.auteur && v.rib_confirme_le === v.cree_le
    const proposeALaCreation = v.iban !== null && (change ? !dEmblee : p?.rib_etat === 'propose')
    const alors: Version = proposeALaCreation ? { ...v, rib_etat: 'propose', rib_confirme_par: null, rib_confirme_le: null } : v
    const avant = tripletDuRib(ribEnVigueur(chaine.slice(0, k), dossier))
    const apresCreation = tripletDuRib(ribEnVigueur([...chaine.slice(0, k), alors], dossier))
    if (change) {
      dernier = {
        jour: jourAParis(v.cree_le),
        geste: v.iban === null ? 'retire' : p?.iban == null ? 'pose' : 'change',
        auteur: v.iban === null ? 'inconnu' : proposeALaCreation ? 'client' : 'cabinet',
        etat: v.iban === null ? 'retire' : proposeALaCreation ? 'propose' : 'confirme',
        ribEnVigueur: effet(avant, apresCreation),
      }
    }
    if (v.rib_etat === 'confirme' && proposeALaCreation) {
      const confirmeLe = v.rib_confirme_le as string
      dernier = {
        jour: jourAParis(confirmeLe),
        geste: 'confirme',
        auteur: Date.parse(confirmeLe) >= Date.parse(v.cree_le) ? 'cabinet' : 'inconnu',
        etat: 'confirme',
        ribEnVigueur: effet(apresCreation, tripletDuRib(ribEnVigueur(chaine.slice(0, k + 1), dossier))),
      }
    }
  }
  return dernier
}

const COURANTE_SQL = /^\(select x\.id from parametres_facturation x where x\.dossier_id = '\{(\w+)\}' and not exists/
const NOMS = new Map(['DA', 'DB', 'DC', 'CHEF', 'CLIENT', ...Array.from({ length: 9 }, (_, i) => `VC${i + 1}`)].map((n) => [n, n]))
// Un instant de l'essai (« 2026-09-10 22:30:00+00 ») en ISO.
const iso = (t: unknown) => (typeof t === 'string' ? new Date(t.replace(' ', 'T').replace(/\+00$/, 'Z')).toISOString() : null)

// Une étape qui écrit, rejouée sur l'état : l'enregistrement et la confirmation par le module des paramètres — le compte
// et l'instant de la transaction —, ou les lignes que le propriétaire restaure, telles quelles.
function ecrire(etat: Version[], e: Etape, partie: string, rang: number): void {
  const compte = e.qui === 'chef' ? 'CHEF' : 'CLIENT'
  const cabinet = e.qui === 'chef' || e.qui === 'membre_affecte'
  const enregistrement = /public\.enregistrer_parametres_facturation\(([\s\S]*)\) p$/.exec(partie)
  if (enregistrement) {
    const [dossierSql, remplaceSql, saisieSql] = decouper(enregistrement[1])
    const dossier = /^'\{(\w+)\}'$/.exec(dossierSql)?.[1] as string
    const courante = versionCourante(etat, dossier)
    if (courante === 'rompue') throw new Error(`${e.num} : chaîne rompue`)
    if (remplaceSql !== 'null' && !COURANTE_SQL.test(remplaceSql)) throw new Error(`${e.num} : version remplacée illisible`)
    const saisie = JSON.parse(sansDoubles(/^'([\s\S]*)'::jsonb$/.exec(saisieSql)?.[1] as string)) as Record<string, string | undefined>
    const rib = etatDuRibEnregistre(courante, saisie, cabinet)
    const confirmation = rib.quoi === 'inchange' && courante
      ? { par: courante.rib_confirme_par, le: courante.rib_confirme_le }
      : rib.etat === 'confirme' ? { par: compte, le: INSTANT_DE_L_ESSAI } : { par: null, le: null }
    etat.push({
      id: `${e.num}-${rang}`, dossier_id: dossier, remplace_id: remplaceSql === 'null' ? null : courante?.id ?? null,
      cree_le: INSTANT_DE_L_ESSAI, auteur: compte, iban: saisie.iban ?? null, bic: saisie.bic ?? null,
      titulaire_compte: saisie.titulaire_compte ?? null, rib_etat: rib.etat, rib_confirme_par: confirmation.par, rib_confirme_le: confirmation.le,
    })
    return
  }
  const confirmation = /public\.confirmer_rib\('\{(\w+)\}',/.exec(partie)
  if (confirmation) {
    const courante = versionCourante(etat, confirmation[1])
    if (!courante || courante === 'rompue') throw new Error(`${e.num} : aucune version à confirmer`)
    Object.assign(courante, { rib_etat: 'confirme', rib_confirme_par: compte, rib_confirme_le: INSTANT_DE_L_ESSAI })
    return
  }
  for (const l of lignesInserees(partie.replace(/\s+/g, ' '), 'parametres_facturation', NOMS)) {
    etat.push({
      id: l.id as string, dossier_id: l.dossier_id as string, remplace_id: (l.remplace_id as string | undefined) ?? null,
      cree_le: iso(l.cree_le) as string, auteur: l.auteur as string, iban: (l.iban as string | undefined) ?? null,
      bic: (l.bic as string | undefined) ?? null, titulaire_compte: (l.titulaire_compte as string | undefined) ?? null,
      rib_etat: (l.rib_etat as Version['rib_etat'] | undefined) ?? null, rib_confirme_par: (l.rib_confirme_par as string | undefined) ?? null,
      rib_confirme_le: iso(l.rib_confirme_le),
    })
  }
}

interface Rejeu { etape: Etape; dossier: string; attendu: unknown; regle: ChangementDeRib | null }

// Les étapes dans leur ordre : une étape gardée (« fait ») écrit dans l'état ; un contrôle écrit dans une COPIE, qu'il lit
// et qui s'annule ; chaque lecture de la fonction qui passe est confrontée à la règle.
function rejouer(): Rejeu[] {
  const etat: Version[] = []
  const rejeux: Rejeu[] = []
  for (const e of ETAPES) {
    if (e.genre === 'jeu' || e.genre === 'valeur' || e.code !== 'OK') continue
    const local = e.genre === 'fait' ? etat : etat.map((v) => ({ ...v }))
    const parties = e.ordre.split('§§')
    parties.forEach((partie, rang) => {
      const lecture = /public\.dernier_changement_de_rib\('\{(\w+)\}'\)::text$/.exec(partie.trim())
      if (lecture) {
        rejeux.push({ etape: e, dossier: lecture[1], attendu: valeurAttendue(e), regle: regle(local, lecture[1]) })
      } else if (!/^select count\(\*\)/.test(partie.trim())) {
        ecrire(local, e, partie.trim(), rang)
      }
    })
  }
  return rejeux
}

describe('les versions de l’essai, rejouées : la règle retrouve chaque valeur que la base a rendue', () => {
  let rejeux: Rejeu[] = []
  beforeAll(() => { rejeux = rejouer() }, 60_000)

  it('assez de lectures pour juger, sur les trois dossiers', () => {
    expect(rejeux.length).toBe(LECTURES.length)
    expect(new Set(rejeux.map((r) => r.dossier))).toEqual(new Set(['DA', 'DB', 'DC']))
  })

  it('chaque lecture : le même dernier changement, au mot près, ou aucun', () => {
    const ecarts = rejeux
      .filter((r) => JSON.stringify(r.attendu) !== JSON.stringify({
        changement: r.regle && { etat: r.regle.etat, jour: r.regle.jour, geste: r.regle.geste, auteur: r.regle.auteur, rib_en_vigueur: r.regle.ribEnVigueur },
      }))
      .map((r) => `${r.etape.num} : la base ${JSON.stringify(r.attendu)}, la règle ${JSON.stringify(r.regle)}`)
    expect(ecarts).toEqual([])
  })

  it('l’ordre est celui de la chaîne : sur C, la dernière version est la plus ANCIENNE, et c’est elle qui compte', () => {
    const r = rejeux.find((x) => x.etape.num === '32b') as Rejeu
    expect(r.regle).toEqual({ jour: '2026-07-01', geste: 'change', auteur: 'cabinet', etat: 'confirme', ribEnVigueur: 'change' })
  })
})

// ── 3. Toutes les chaînes courtes : l'image exacte de la règle ──────────────────────────────────────────────────────
// Des gestes, rejoués comme les fonctions les écrivent : le cabinet ou un accès client enregistre un RIB (deux IBAN, le
// premier sous deux BIC, ou aucun RIB), le cabinet confirme le RIB proposé de la courante, ou une ligne restaurée qu'aucune
// fonction n'écrit (confirmée la veille de sa version). Chaque chaîne de un à quatre gestes donne un dernier changement, que
// le module doit LIRE ; ensemble, elles donnent les quinze combinaisons du module, ni plus ni moins.
const RIBS = [
  { iban: 'FR5199999002480000RIBUN0100', bic: 'ESSBFR22' },
  { iban: 'FR5199999002480000RIBUN0100', bic: 'ESSDFR44' },
  { iban: 'FR7199999002480000RIBDEUX00', bic: null },
  { iban: null, bic: null },
] as const
type Geste = { quoi: 'cabinet' | 'client' | 'anomalie'; rib: (typeof RIBS)[number] } | { quoi: 'confirmer' }
const GESTES: Geste[] = [
  ...RIBS.flatMap((rib) => (['cabinet', 'client', 'anomalie'] as const).map((quoi) => ({ quoi, rib }))),
  { quoi: 'confirmer' },
]

function chaineDe(gestes: readonly Geste[]): Version[] | null {
  const versions: Version[] = []
  for (let i = 0; i < gestes.length; i++) {
    const g = gestes[i]
    const instant = new Date(Date.UTC(2026, 9, 1 + i, 10)).toISOString()
    const courante = versionCourante(versions, 'D')
    if (courante === 'rompue') throw new Error('chaîne rompue')
    if (g.quoi === 'confirmer') {
      if (!courante || courante.rib_etat !== 'propose') return null
      Object.assign(courante, { rib_etat: 'confirme', rib_confirme_par: 'CHEF', rib_confirme_le: instant })
      continue
    }
    const base = { id: `v${i}`, dossier_id: 'D', remplace_id: courante?.id ?? null, cree_le: instant, iban: g.rib.iban, bic: g.rib.bic, titulaire_compte: null }
    if (g.quoi === 'anomalie') {
      if (g.rib.iban === null) return null
      const veille = new Date(Date.UTC(2026, 9, i, 10)).toISOString()
      versions.push({ ...base, auteur: 'CLIENT', rib_etat: 'confirme', rib_confirme_par: 'CHEF', rib_confirme_le: veille })
      continue
    }
    const auteur = g.quoi === 'cabinet' ? 'CHEF' : 'CLIENT'
    const rib = etatDuRibEnregistre(courante, { iban: g.rib.iban ?? undefined, bic: g.rib.bic ?? undefined }, g.quoi === 'cabinet')
    const confirmation = rib.quoi === 'inchange' && courante
      ? { par: courante.rib_confirme_par, le: courante.rib_confirme_le }
      : rib.etat === 'confirme' ? { par: auteur, le: instant } : { par: null, le: null }
    versions.push({ ...base, auteur, rib_etat: rib.etat, rib_confirme_par: confirmation.par, rib_confirme_le: confirmation.le })
  }
  return versions
}

describe('toutes les chaînes de un à quatre gestes', () => {
  let combinaisons = new Set<string>()
  let illisibles: string[] = []
  let chaines = 0
  beforeAll(() => {
    const vues = new Set<string>()
    const fautes: string[] = []
    const parcourir = (gestes: Geste[]) => {
      if (gestes.length > 0) {
        const versions = chaineDe(gestes)
        if (versions === null) return
        chaines += 1
        const c = regle(versions, 'D')
        const rendu = { changement: c && { jour: c.jour, geste: c.geste, auteur: c.auteur, etat: c.etat, rib_en_vigueur: c.ribEnVigueur } }
        if (lireLeChangementDeRib(rendu) === null) fautes.push(JSON.stringify(rendu))
        if (c) vues.add(`${c.geste}|${c.auteur}|${c.etat}|${c.ribEnVigueur}`)
      }
      // Au quatrième geste, sans ligne restaurée : une confirmation qui remet le RIB en vigueur en demande quatre, aucune
      // combinaison d'une ligne restaurée n'en demande plus de trois.
      if (gestes.length < 3) for (const g of GESTES) parcourir([...gestes, g])
      else if (gestes.length === 3 && gestes.every((g) => g.quoi !== 'anomalie')) {
        for (const g of GESTES) if (g.quoi !== 'anomalie') parcourir([...gestes, g])
      }
    }
    parcourir([])
    combinaisons = vues
    illisibles = fautes
  }, 60_000)

  it('chaque dernier changement se lit dans le module', () => {
    expect(chaines).toBeGreaterThan(3_000)
    expect(illisibles).toEqual([])
  })

  it('les quinze combinaisons du module sont celles que la règle atteint, ni plus ni moins', () => {
    expect([...combinaisons].sort()).toEqual([...COMBINAISONS_DU_CHANGEMENT].sort())
  })
})

// ── 4. La valeur rendue, lue sans rien deviner ─────────────────────────────────────────────────────────────────────
const RENDU = { changement: { jour: '2026-10-16', geste: 'change', auteur: 'client', etat: 'propose', rib_en_vigueur: 'inchange' } }
const avec = (f: (c: Record<string, unknown>) => void) => {
  const copie = JSON.parse(JSON.stringify(RENDU)) as { changement: Record<string, unknown> }
  f(copie.changement)
  return copie
}

describe('la valeur rendue, lue sans rien deviner', () => {
  it('« aucun changement » : seulement l’objet qui le dit', () => {
    expect(lireLeChangementDeRib({ changement: null })).toEqual({ changement: null })
  })

  it('un changement : chaque mot à sa place, le RIB en vigueur sous son nom', () => {
    expect(lireLeChangementDeRib(RENDU)).toEqual({
      changement: { jour: '2026-10-16', geste: 'change', auteur: 'client', etat: 'propose', ribEnVigueur: 'inchange' },
    })
  })

  it.each([
    ['un nul nu', null],
    ['rien', undefined],
    ['un tableau', [RENDU]],
    ['un texte', 'aucun'],
    ['un objet vide', {}],
    ['une clé de plus à la racine', { ...RENDU, iban: 'FR5199999002480000RIBUN0100' }],
    ['la racine sous un autre nom', { dernier: RENDU.changement }],
    ['le changement en tableau', { changement: [] }],
    ['l’IBAN glissé dans le changement', avec((c) => { c.iban = 'FR5199999002480000RIBUN0100' })],
    ['l’auteur nommé', avec((c) => { c.par = '797fe440-df8d-4b8e-828b-d148927bfd60' })],
    ['le jour absent', avec((c) => { delete c.jour })],
    ['le jour avec l’heure', avec((c) => { c.jour = '2026-10-16T10:00:00+00:00' })],
    ['un jour qui n’existe pas', avec((c) => { c.jour = '2026-02-30' })],
    ['un jour français', avec((c) => { c.jour = '16/10/2026' })],
    ['un geste inconnu', avec((c) => { c.geste = 'modifie' })],
    ['un auteur inconnu de la liste', avec((c) => { c.auteur = 'chef' })],
    ['un état inconnu', avec((c) => { c.etat = 'en_attente' })],
    ['un effet inconnu', avec((c) => { c.rib_en_vigueur = 'remplace' })],
    ['un mot en majuscules', avec((c) => { c.geste = 'CHANGE' })],
    ['une proposition par le cabinet', avec((c) => { c.auteur = 'cabinet' })],
    ['une proposition qui change le RIB en vigueur', avec((c) => { c.rib_en_vigueur = 'change' })],
    ['un retrait qui garde un RIB', { changement: { jour: '2026-10-16', geste: 'retire', auteur: 'inconnu', etat: 'retire', rib_en_vigueur: 'inchange' } }],
    ['un retrait signé du client', { changement: { jour: '2026-10-16', geste: 'retire', auteur: 'client', etat: 'retire', rib_en_vigueur: 'retire' } }],
    ['une confirmation par un accès client', { changement: { jour: '2026-10-16', geste: 'confirme', auteur: 'client', etat: 'confirme', rib_en_vigueur: 'change' } }],
    ['une confirmation qui laisse sans RIB', { changement: { jour: '2026-10-16', geste: 'confirme', auteur: 'cabinet', etat: 'confirme', rib_en_vigueur: 'aucun' } }],
    ['une pose qui changerait le RIB en vigueur', { changement: { jour: '2026-10-16', geste: 'pose', auteur: 'cabinet', etat: 'confirme', rib_en_vigueur: 'change' } }],
  ])('%s : illisible — jamais « aucun changement », jamais un avis', (_nom, rendu) => {
    expect(lireLeChangementDeRib(rendu)).toBeNull()
  })

  it('chacune des quinze combinaisons se lit, et aucune autre des 180 que les listes permettent', () => {
    let lues = 0
    for (const geste of GESTES_DU_RIB) for (const auteur of AUTEURS_DU_CHANGEMENT) for (const etat of ETATS_APRES_LE_CHANGEMENT) {
      for (const effet of EFFETS_SUR_LE_RIB_EN_VIGUEUR) {
        const lu = lireLeChangementDeRib({ changement: { jour: '2026-10-16', geste, auteur, etat, rib_en_vigueur: effet } })
        expect(lu !== null, `${geste}|${auteur}|${etat}|${effet}`).toBe(COMBINAISONS_DU_CHANGEMENT.includes(`${geste}|${auteur}|${etat}|${effet}`))
        if (lu) lues += 1
      }
    }
    expect(lues).toBe(15)
  })

  it('chaque combinaison est faite des mots des quatre listes, dans leur ordre', () => {
    for (const cle of COMBINAISONS_DU_CHANGEMENT) {
      const [geste, auteur, etat, effet] = cle.split('|')
      expect(GESTES_DU_RIB as readonly string[], cle).toContain(geste)
      expect(AUTEURS_DU_CHANGEMENT as readonly string[], cle).toContain(auteur)
      expect(ETATS_APRES_LE_CHANGEMENT as readonly string[], cle).toContain(etat)
      expect(EFFETS_SUR_LE_RIB_EN_VIGUEUR as readonly string[], cle).toContain(effet)
    }
    expect(new Set(COMBINAISONS_DU_CHANGEMENT).size).toBe(COMBINAISONS_DU_CHANGEMENT.length)
  })

  it('aucune clé ne nomme ce que la fonction ne rend jamais', () => {
    const toutes = Object.values(CLES_DU_CHANGEMENT).flat() as string[]
    for (const interdite of ['iban', 'bic', 'titulaire_compte', 'auteur_id', 'rib_confirme_par', 'rib_confirme_le', 'id', 'version', 'cree_le', 'heure']) {
      expect(toutes).not.toContain(interdite)
    }
  })
})

// ── 5. Ce que l'avis dit ────────────────────────────────────────────────────────────────────────────────────────────
const combinaison = (cle: string, jour = '2026-10-16'): ChangementDeRib => {
  const [geste, auteur, etat, ribEnVigueur] = cle.split('|') as [ChangementDeRib['geste'], ChangementDeRib['auteur'], ChangementDeRib['etat'], ChangementDeRib['ribEnVigueur']]
  return { jour, geste, auteur, etat, ribEnVigueur }
}
const DESTINATAIRES: DestinataireDuChangement[] = ['cabinet', 'ventes', 'banque']

describe('ce que l’avis dit à chacun', () => {
  it('le jour à la française, dans chaque phrase ; jamais un IBAN, un BIC ni un identifiant', () => {
    for (const cle of COMBINAISONS_DU_CHANGEMENT) for (const d of DESTINATAIRES) {
      const avis = avisDuChangement(combinaison(cle), d)
      expect(avis.phrase, `${cle} ${d}`).toContain('16/10/2026')
      const texte = `${avis.phrase} ${avis.factures} ${avis.conseil ?? ''}`
      expect(texte).not.toMatch(/\b[A-Z]{2}\d{2}[A-Z0-9]{8,}|[0-9a-f]{8}-[0-9a-f]{4}-|2026-10-16/)
    }
  })

  it('au client — « Ventes » ou « Banque » seul — : tutoyé, aucun mot du cabinet, jamais « le client » pour lui', () => {
    for (const cle of COMBINAISONS_DU_CHANGEMENT) for (const d of ['ventes', 'banque'] as const) {
      const avis = avisDuChangement(combinaison(cle), d)
      for (const texte of [avis.phrase, avis.factures, avis.conseil ?? '']) {
        expect(motsDuCabinet(texte), `${cle} ${d} : ${texte}`).toEqual([])
        expect(texte, `${cle} ${d}`).not.toMatch(/\ble client\b|\bdu client\b|\bau client\b/i)
      }
    }
  })

  it('au cabinet : vouvoyé ; un RIB proposé attend SA confirmation, avec le conseil de la vue des paramètres', () => {
    for (const cle of COMBINAISONS_DU_CHANGEMENT) {
      const avis = avisDuChangement(combinaison(cle), 'cabinet')
      expect(`${avis.phrase} ${avis.factures}`, cle).not.toMatch(/\b(tu|ton|ta|tes|toi)\b/i)
      const propose = cle.split('|')[2] === 'propose'
      expect(avis.conseil === CONSEIL_VERIFICATION_RIB, cle).toBe(propose)
      if (propose) expect(avis.phrase, cle).toMatch(/attend votre confirmation/)
    }
  })

  it('l’auteur : le cabinet, ou un accès client — jamais la personne ; un auteur inconnu n’est nommé d’aucune façon', () => {
    expect(avisDuChangement(combinaison('pose|client|propose|aucun'), 'banque').phrase)
      .toBe('Un RIB a été proposé pour tes factures le 16/10/2026, depuis un accès client de ton dossier : il attend la confirmation de ton cabinet.')
    expect(avisDuChangement(combinaison('change|cabinet|confirme|change'), 'banque').phrase).toBe('Ton cabinet a changé le RIB de tes factures le 16/10/2026.')
    expect(avisDuChangement(combinaison('confirme|cabinet|confirme|change'), 'ventes').phrase)
      .toBe('Ton cabinet a confirmé le RIB proposé pour tes factures, le 16/10/2026.')
    for (const cle of COMBINAISONS_DU_CHANGEMENT.filter((c) => c.split('|')[1] === 'inconnu')) for (const d of DESTINATAIRES) {
      expect(avisDuChangement(combinaison(cle), d).phrase, `${cle} ${d}`).not.toMatch(/cabinet|accès client/)
    }
  })

  it('ce que les factures porteront : au futur, « quand elles porteront un RIB » — aucune n’en imprime encore (A7)', () => {
    expect(avisDuChangement(combinaison('change|client|propose|inchange'), 'banque').factures)
      .toBe('Le RIB confirmé d’avant reste en vigueur : c’est lui que tes factures porteront, quand elles porteront un RIB, jusqu’à la confirmation de ton cabinet.')
    expect(avisDuChangement(combinaison('change|client|propose|aucun'), 'cabinet').factures)
      .toBe('Aucun RIB confirmé ne le précède : tant que vous ne l’avez pas confirmé, les factures n’en porteront aucun, quand elles porteront un RIB.')
    expect(avisDuChangement(combinaison('retire|inconnu|retire|retire'), 'ventes').factures)
      .toBe('Tes factures ne porteront plus de RIB, tant qu’un autre n’est pas posé et confirmé par ton cabinet.')
    expect(avisDuChangement(combinaison('retire|inconnu|retire|aucun'), 'cabinet').phrase).toBe('Le RIB proposé pour les factures a été retiré le 16/10/2026.')
    expect(avisDuChangement(combinaison('change|cabinet|confirme|inchange'), 'cabinet').phrase)
      .toBe('Le RIB proposé pour les factures a été écarté le 16/10/2026 par le cabinet, qui a remis le RIB en vigueur.')
    expect(avisDuChangement(combinaison('confirme|cabinet|confirme|inchange'), 'banque').factures).toBe('Le RIB de tes factures ne change pas : c’était déjà lui.')
    expect(avisDuChangement(combinaison('confirme|inconnu|confirme|pose'), 'cabinet').factures)
      .toBe('Aucun RIB n’était confirmé avant lui : les factures porteront celui-ci, quand elles porteront un RIB.')
  })

  it('le conseil : au client, toujours, de prévenir son cabinet — « Ventes » sait où lire le détail ; au cabinet, où lire qui a retiré', () => {
    for (const cle of COMBINAISONS_DU_CHANGEMENT) {
      expect(avisDuChangement(combinaison(cle), 'ventes').conseil).toBe(CONSEIL_AU_CLIENT_VENTES)
      expect(avisDuChangement(combinaison(cle), 'banque').conseil).toBe(CONSEIL_AU_CLIENT_BANQUE)
    }
    expect(CONSEIL_AU_CLIENT_VENTES).toContain('« Mes ventes › Paramètres »')
    expect(CONSEIL_AU_CLIENT_BANQUE).not.toContain('Mes ventes')
    expect(avisDuChangement(combinaison('retire|inconnu|retire|retire'), 'cabinet').conseil).toBe(CONSEIL_D_UN_RETRAIT)
    expect(avisDuChangement(combinaison('pose|cabinet|confirme|pose'), 'cabinet').conseil).toBeNull()
  })

  // Les mots que le cabinet relit (A5B3-Q6), épinglés combinaison par combinaison : une phrase qui passe d'une combinaison
  // à l'autre, ou qui change, se voit ici.
  const Q = 'quand elles porteront un RIB'
  const AU_CABINET: Record<string, [string, string]> = {
    'pose|cabinet|confirme|pose': ['Le RIB des factures a été posé le 16/10/2026 par le cabinet.',
      `Aucun RIB n’était confirmé avant lui : les factures porteront celui-ci, ${Q}.`],
    'pose|client|propose|aucun': ['Un accès client a proposé un RIB pour les factures le 16/10/2026 : il attend votre confirmation.',
      `Aucun RIB confirmé ne le précède : tant que vous ne l’avez pas confirmé, les factures n’en porteront aucun, ${Q}.`],
    'change|cabinet|confirme|pose': ['Le RIB des factures a été changé le 16/10/2026 par le cabinet.',
      `Aucun RIB n’était confirmé avant lui : les factures porteront celui-ci, ${Q}.`],
    'change|cabinet|confirme|change': ['Le RIB des factures a été changé le 16/10/2026 par le cabinet.',
      `Les factures porteront ce RIB à la place du précédent, ${Q}.`],
    'change|cabinet|confirme|inchange': ['Le RIB proposé pour les factures a été écarté le 16/10/2026 par le cabinet, qui a remis le RIB en vigueur.',
      'Le RIB que les factures porteront ne change pas : c’était déjà lui.'],
    'change|client|propose|aucun': ['Un accès client a proposé un nouveau RIB pour les factures le 16/10/2026 : il attend votre confirmation.',
      `Aucun RIB confirmé ne le précède : tant que vous ne l’avez pas confirmé, les factures n’en porteront aucun, ${Q}.`],
    'change|client|propose|inchange': ['Un accès client a proposé un nouveau RIB pour les factures le 16/10/2026 : il attend votre confirmation.',
      `Le RIB confirmé d’avant reste en vigueur : c’est lui que les factures porteront, ${Q}, tant que vous n’avez pas confirmé celui-ci.`],
    'retire|inconnu|retire|aucun': ['Le RIB proposé pour les factures a été retiré le 16/10/2026.',
      'Aucun RIB n’était confirmé : les factures n’en porteront toujours aucun.'],
    'retire|inconnu|retire|retire': ['Le RIB des factures a été retiré le 16/10/2026.',
      'Les factures ne porteront plus de RIB, tant qu’un autre n’est pas posé et confirmé.'],
    'confirme|cabinet|confirme|pose': ['Le RIB proposé pour les factures a été confirmé le 16/10/2026 par le cabinet.',
      `Aucun RIB n’était confirmé avant lui : les factures porteront celui-ci, ${Q}.`],
    'confirme|cabinet|confirme|change': ['Le RIB proposé pour les factures a été confirmé le 16/10/2026 par le cabinet.',
      `Les factures porteront ce RIB à la place du précédent, ${Q}.`],
    'confirme|cabinet|confirme|inchange': ['Le RIB proposé pour les factures a été confirmé le 16/10/2026 par le cabinet.',
      'Le RIB que les factures porteront ne change pas : c’était déjà lui.'],
    'confirme|inconnu|confirme|pose': ['Le RIB proposé pour les factures a été confirmé le 16/10/2026.',
      `Aucun RIB n’était confirmé avant lui : les factures porteront celui-ci, ${Q}.`],
    'confirme|inconnu|confirme|change': ['Le RIB proposé pour les factures a été confirmé le 16/10/2026.',
      `Les factures porteront ce RIB à la place du précédent, ${Q}.`],
    'confirme|inconnu|confirme|inchange': ['Le RIB proposé pour les factures a été confirmé le 16/10/2026.',
      'Le RIB que les factures porteront ne change pas : c’était déjà lui.'],
  }
  const AU_CLIENT: Record<string, [string, string]> = {
    'pose|cabinet|confirme|pose': ['Ton cabinet a posé le RIB de tes factures le 16/10/2026.',
      `Aucun RIB n’était confirmé avant lui : tes factures porteront celui-ci, ${Q}.`],
    'pose|client|propose|aucun': ['Un RIB a été proposé pour tes factures le 16/10/2026, depuis un accès client de ton dossier : il attend la confirmation de ton cabinet.',
      `Aucun RIB confirmé ne le précède : jusqu’à la confirmation de ton cabinet, tes factures n’en porteront aucun, ${Q}.`],
    'change|cabinet|confirme|pose': ['Ton cabinet a changé le RIB de tes factures le 16/10/2026.',
      `Aucun RIB n’était confirmé avant lui : tes factures porteront celui-ci, ${Q}.`],
    'change|cabinet|confirme|change': ['Ton cabinet a changé le RIB de tes factures le 16/10/2026.',
      `Tes factures porteront ce RIB à la place du précédent, ${Q}.`],
    'change|cabinet|confirme|inchange': ['Ton cabinet a écarté le RIB proposé pour tes factures le 16/10/2026, et remis celui qui était en vigueur.',
      'Le RIB de tes factures ne change pas : c’était déjà lui.'],
    'change|client|propose|aucun': ['Un nouveau RIB a été proposé pour tes factures le 16/10/2026, depuis un accès client de ton dossier : il attend la confirmation de ton cabinet.',
      `Aucun RIB confirmé ne le précède : jusqu’à la confirmation de ton cabinet, tes factures n’en porteront aucun, ${Q}.`],
    'change|client|propose|inchange': ['Un nouveau RIB a été proposé pour tes factures le 16/10/2026, depuis un accès client de ton dossier : il attend la confirmation de ton cabinet.',
      `Le RIB confirmé d’avant reste en vigueur : c’est lui que tes factures porteront, ${Q}, jusqu’à la confirmation de ton cabinet.`],
    'retire|inconnu|retire|aucun': ['Le RIB proposé pour tes factures a été retiré le 16/10/2026.',
      'Aucun RIB n’était confirmé : tes factures n’en porteront toujours aucun.'],
    'retire|inconnu|retire|retire': ['Le RIB de tes factures a été retiré le 16/10/2026.',
      'Tes factures ne porteront plus de RIB, tant qu’un autre n’est pas posé et confirmé par ton cabinet.'],
    'confirme|cabinet|confirme|pose': ['Ton cabinet a confirmé le RIB proposé pour tes factures, le 16/10/2026.',
      `Aucun RIB n’était confirmé avant lui : tes factures porteront celui-ci, ${Q}.`],
    'confirme|cabinet|confirme|change': ['Ton cabinet a confirmé le RIB proposé pour tes factures, le 16/10/2026.',
      `Tes factures porteront ce RIB à la place du précédent, ${Q}.`],
    'confirme|cabinet|confirme|inchange': ['Ton cabinet a confirmé le RIB proposé pour tes factures, le 16/10/2026.',
      'Le RIB de tes factures ne change pas : c’était déjà lui.'],
    'confirme|inconnu|confirme|pose': ['Le RIB proposé pour tes factures a été confirmé le 16/10/2026.',
      `Aucun RIB n’était confirmé avant lui : tes factures porteront celui-ci, ${Q}.`],
    'confirme|inconnu|confirme|change': ['Le RIB proposé pour tes factures a été confirmé le 16/10/2026.',
      `Tes factures porteront ce RIB à la place du précédent, ${Q}.`],
    'confirme|inconnu|confirme|inchange': ['Le RIB proposé pour tes factures a été confirmé le 16/10/2026.',
      'Le RIB de tes factures ne change pas : c’était déjà lui.'],
  }

  it.each(COMBINAISONS_DU_CHANGEMENT.map((c) => [c]))('%s : les mots du cabinet et ceux du client, au caractère près', (cle) => {
    const cabinet = avisDuChangement(combinaison(cle), 'cabinet')
    expect([cabinet.phrase, cabinet.factures]).toEqual(AU_CABINET[cle])
    const banque = avisDuChangement(combinaison(cle), 'banque')
    expect([banque.phrase, banque.factures]).toEqual(AU_CLIENT[cle])
    // Le client « Ventes » lit les mêmes mots ; son conseil seul diffère (il sait où lire le détail).
    const ventes = avisDuChangement(combinaison(cle), 'ventes')
    expect([ventes.phrase, ventes.factures]).toEqual(AU_CLIENT[cle])
  })

  it('les deux tables couvrent les quinze combinaisons, ni plus ni moins', () => {
    expect(Object.keys(AU_CABINET).sort()).toEqual([...COMBINAISONS_DU_CHANGEMENT].sort())
    expect(Object.keys(AU_CLIENT).sort()).toEqual([...COMBINAISONS_DU_CHANGEMENT].sort())
  })

  it('deux combinaisons, deux avis : aucune phrase ne confond deux changements différents', () => {
    for (const d of DESTINATAIRES) {
      const textes = COMBINAISONS_DU_CHANGEMENT.map((cle) => {
        const a = avisDuChangement(combinaison(cle), d)
        return `${a.phrase} ${a.factures}`
      })
      // Seule l'origine d'une confirmation (le cabinet, ou une ligne qu'aucune fonction n'écrit) change la phrase sans
      // changer ce que les factures porteront : quinze avis distincts.
      expect(new Set(textes).size, d).toBe(15)
    }
  })
})

// ── 6. Le drapeau, et le texte de la fonction exportée ──────────────────────────────────────────────────────────────
describe('le module et la fonction exportée disent la même chose', () => {
  const exportee = fichiersDuSchema().some((f) => /create function public\.dernier_changement_de_rib\(/.test(f.texte))

  it('le drapeau dit ce que porte l’export : faux tant que la migration n’y est pas', () => {
    expect(CHANGEMENT_DE_RIB_EXPORTE, 'CHANGEMENT_DE_RIB_EXPORTE ne dit plus ce que porte l’export').toBe(exportee)
  })

  it('exportée : la définition, l’accès d’abord — le cabinet, « Ventes » ou « Banque » —, puis la lecture', () => {
    if (!CHANGEMENT_DE_RIB_EXPORTE) return
    const sql = derniereDefinitionSql('dernier_changement_de_rib')
    expect(sql).toMatch(/dernier_changement_de_rib\(p_dossier_id uuid\)\nreturns jsonb\nlanguage plpgsql\nstable\nsecurity definer\nset search_path = public/)
    const corps = sql.slice(sql.indexOf('\nbegin\n'))
    const acces = corps.indexOf("raise exception 'Accès refusé à ce dossier.' using errcode = '42501'")
    expect(acces).toBeGreaterThan(0)
    expect(corps.slice(0, acces)).toMatch(/public\.admin_du_dossier\(p_dossier_id\)\s+or public\.client_du_dossier\(p_dossier_id, 'ventes'\)\s+or public\.client_du_dossier\(p_dossier_id, 'banque'\)\)/)
    expect(corps.slice(0, acces)).not.toMatch(/parametres_facturation/)
    expect(corps.indexOf('parametres_facturation')).toBeGreaterThan(acces)
  })

  it('exportée : la valeur a les clés du module, et chaque clé ne rend que les mots de sa liste — jamais une colonne', () => {
    if (!CHANGEMENT_DE_RIB_EXPORTE) return
    const sql = derniereDefinitionSql('dernier_changement_de_rib')
    expect(sql).toMatch(/return jsonb_build_object\('changement', v_dernier\);/)
    const objets = [...sql.matchAll(/v_dernier := jsonb_build_object\(/g)].map((m) => {
      let profondeur = 1
      let i = (m.index as number) + m[0].length
      let chaine = false
      const debut = i
      for (; i < sql.length && profondeur > 0; i++) {
        if (sql[i] === "'") chaine = !chaine
        if (!chaine && sql[i] === '(') profondeur++
        if (!chaine && sql[i] === ')') profondeur--
      }
      return decouper(sql.slice(debut, i - 1).replace(/--[^\n]*\n/g, '\n'))
    })
    expect(objets).toHaveLength(2)
    const vus: Record<string, Set<string>> = { geste: new Set(), auteur: new Set(), etat: new Set(), rib_en_vigueur: new Set() }
    for (const args of objets) {
      const cles = args.filter((_, i) => i % 2 === 0).map((c) => c.replace(/'/g, ''))
      expect(cles).toEqual([...CLES_DU_CHANGEMENT.changement])
      for (let i = 0; i < args.length; i += 2) {
        const cle = cles[i / 2]
        const valeur = args[i + 1].trim()
        if (cle === 'jour') {
          expect(valeur).toMatch(/^\(v\.(cree_le|rib_confirme_le) at time zone 'Europe\/Paris'\)::date$/)
          continue
        }
        // Un mot seul, ou un `case` dont CHAQUE branche rend un mot : jamais une colonne, jamais une expression.
        const sorties = /^'\w+'$/.test(valeur) ? [valeur] : [...valeur.matchAll(/\b(?:then|else)\s+(\S+)/g)].map((m) => m[1])
        expect(/^'\w+'$/.test(valeur) || /^case\b/.test(valeur), `${cle} : ${valeur}`).toBe(true)
        expect(sorties.length, `${cle} : ${valeur}`).toBeGreaterThan(0)
        for (const s of sorties) {
          expect(s, `${cle} : ${valeur}`).toMatch(/^'\w+'$/)
          vus[cle].add(s.slice(1, -1))
        }
      }
    }
    expect([...vus.geste].sort()).toEqual([...GESTES_DU_RIB].sort())
    expect([...vus.auteur].sort()).toEqual([...AUTEURS_DU_CHANGEMENT].sort())
    expect([...vus.etat].sort()).toEqual([...ETATS_APRES_LE_CHANGEMENT].sort())
    expect([...vus.rib_en_vigueur].sort()).toEqual([...EFFETS_SUR_LE_RIB_EN_VIGUEUR].sort())
  })

  it('exportée : l’anonyme et PUBLIC n’exécutent pas la fonction ; les connectés, oui', () => {
    if (!CHANGEMENT_DE_RIB_EXPORTE) return
    const texte = fichiersDuSchema().find((f) => /create function public\.dernier_changement_de_rib\(/.test(f.texte))?.texte as string
    expect(texte).toContain('revoke execute on function public.dernier_changement_de_rib(uuid) from public, anon;')
    expect(texte).toContain('grant execute on function public.dernier_changement_de_rib(uuid) to authenticated;')
  })
})
