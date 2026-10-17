import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { avisDuChangement, type ChangementDeRib } from './changementDeRib'
import {
  AUCUN_RIB_A_CONFIRMER, CLES_DES_DOSSIERS_AU_RIB, DOSSIERS_AU_RIB_A_CONFIRMER_EXPORTE, LECTURE_MANQUEE_DE_LA_LISTE,
  MENTION_DOSSIER_ARCHIVE, ceQueDitLaListe, lignesDesDossiers, lireLesDossiersAuRibAConfirmer, phraseDuCompte,
  type DossiersAuRibAConfirmerLus,
} from './dossiersAuRibAConfirmer'
import { motsDuCabinet } from './espaceVentes'
import { changementFictif } from '../test/changementDeRib'
import { decouper, lignesInserees } from '../test/essaiSql'
import { derniereDefinitionSql, fichiersDuSchema } from '../test/schema'

// LES DOSSIERS DONT UN RIB PROPOSÉ ATTEND LA CONFIRMATION DU CABINET, CONFRONTÉS À LA BASE (espace client, étape A5b3c).
// La migration est appliquée et l'export la porte : le texte même de la fonction est confronté au module (section 5), et
// l'essai `supabase/essais/dossiersAuRibAConfirmer.sql`, joué en production comme sur une réplique, reste la référence de ce
// qu'elle rend — chaque liste qu'il exige de la base est un texte exact.
// Ce test (1) lit chacune dans le module ; (2) REJOUE l'essai étape par étape et retrouve chacune par une règle écrite ICI,
// indépendante du texte SQL — les dossiers que le profil administre (le cabinet de son chef, les affectations d'un membre,
// tous pour le super-administrateur), la valeur que l'essai exige de `dernier_changement_de_rib` pour chacun, un RIB proposé
// seulement, le plus ancien d'abord puis l'identifiant ; (3) lit sans rien deviner ; (4) épingle ce qu'un écran dira ; (5)
// le jour où l'export porte la migration, confronte le module au texte même de la fonction.

const ESSAI = readFileSync(new URL('../../supabase/essais/dossiersAuRibAConfirmer.sql', import.meta.url), 'utf8')

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
  /\('(\w+)', '(jeu|controle|fait|valeur|mutation)', '(?:[^']|'')*', '(\w+)', (null|'\w+'),\s*\$q\$([\s\S]*?)\$q\$,\s*'(\w+)',\s*(null|'((?:[^']|'')*)')\)/g,
)].map((m) => ({
  num: m[1], genre: m[2], qui: m[3], droits: m[4] === 'null' ? null : m[4].slice(1, -1), ordre: m[5], code: m[6],
  attendu: m[8] === undefined ? null : sansDoubles(m[8]),
}))
const etape = (num: string) => {
  const e = ETAPES.find((x) => x.num === num)
  if (!e) throw new Error(`étape ${num} introuvable dans dossiersAuRibAConfirmer.sql`)
  return e
}

// Les identifiants jetables de l'essai, lus dans son `ids := jsonb_build_object(…)`.
const BLOC_DES_IDS = ESSAI.slice(ESSAI.indexOf('ids := jsonb_build_object('), ESSAI.indexOf("'AUJ',"))
const IDS = new Map([...BLOC_DES_IDS.matchAll(/'(\w+)', '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'/g)]
  .map((m) => [m[1], m[2]] as const))
// {AUJ} : le jour à Paris de la transaction de l'essai — ici un jour d'octobre 2026 postérieur aux versions restaurées.
const AUJ = '2026-10-17'
const resoudre = (texte: string) => texte.replace(/\{(\w+)\}/g, (m, nom: string) => (nom === 'AUJ' ? AUJ : IDS.get(nom) ?? m))

// LES PROFILS DU CABINET, lus dans le moteur de l'essai : (profil, cabinet, rôle, dossiers affectés).
const BLOC_DES_PROFILS = ESSAI.slice(ESSAI.indexOf('-- LES PROFILS DU CABINET'), ESSAI.indexOf(') as v(qui, cabinet, role, affectes)'))
const PROFILS = new Map([...BLOC_DES_PROFILS.matchAll(/\('(\w+)', '(K\d)', '(comptable_en_chef|comptable)', '([\w,]*)'\)/g)]
  .map((m) => [m[1], { cabinet: m[2], role: m[3], affectes: m[4] === '' ? [] : m[4].split(',') }] as const))

// Les dossiers jetables, tels que le jeu les insère : leur nom, leur cabinet, leur marque « archivé ».
interface DossierDuJeu { id: string; nom: string; cabinet: string; archive: boolean }
// Les noms des identifiants, rendus symboliques (« D1 », « K1 ») : la règle compare des noms, l'identifiant ne sert qu'à l'ordre.
const NOMS = new Map([...IDS.keys(), 'CLIENT', 'CHEF'].map((nom) => [nom, nom]))
const DOSSIERS_DU_JEU: DossierDuJeu[] = lignesInserees(etape('j2').ordre.replace(/\s+/g, ' '), 'dossiers', NOMS)
  .map((l) => ({ id: l.id as string, nom: l.nom as string, cabinet: l.cabinet_id as string, archive: l.archive as boolean }))

const LISTE = /public\.dossiers_au_rib_a_confirmer\(\)/
const LECTURES = ETAPES.filter((e) => e.code === 'OK' && LISTE.test(e.ordre) && (e.attendu ?? '').startsWith('{"dossiers"'))
const valeurAttendue = (e: Etape) => JSON.parse(resoudre(e.attendu as string)) as unknown

// ── 1. L'essai, lu ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('l’essai, lu', () => {
  it('ses étapes : le jeu, le catalogue, les refus, les versions, les listes, les mutations', () => {
    const ouvertes = [...ESSAI.matchAll(/^\s*\('\w+', '(?:jeu|controle|fait|valeur|mutation)'/gm)].length
    expect(ETAPES.length).toBe(ouvertes)
    expect(ETAPES.filter((e) => e.genre === 'jeu').map((e) => e.num)).toEqual(['j1', 'j2', 'j3', 'j4'])
    expect(ETAPES.filter((e) => e.genre === 'mutation')).toHaveLength(5)
    expect(LECTURES.length).toBeGreaterThanOrEqual(12)
    expect(DOSSIERS_DU_JEU).toHaveLength(11)
    expect([...PROFILS.keys()].sort()).toEqual(['chef_k1', 'chef_k2', 'membre', 'membre_aucun', 'membre_plus'])
  })

  it('chaque refus est celui du cabinet, sous ses mots et son code ; l’anonyme, le droit d’exécution', () => {
    const refus = ETAPES.filter((e) => e.code !== 'OK')
    expect(refus.length).toBeGreaterThanOrEqual(7)
    for (const e of refus) {
      expect([e.code, e.attendu], e.num).toEqual(['42501', e.qui === 'anon'
        ? 'permission denied for function dossiers_au_rib_a_confirmer' : 'Seul le cabinet lit les RIB à confirmer.'])
    }
    // Un accès client, quelles que soient ses cases, et un compte rattaché à rien : refusés — jamais une liste vide.
    expect(refus.map((e) => `${e.qui}:${e.droits ?? '-'}`).sort())
      .toEqual(['anon:-', 'client:aucun', 'client:banque', 'client:deux', 'client:deux', 'client:ventes', 'inconnu:-'])
  })

  it('chaque liste que la base rend se LIT dans le module, et chaque ligne se dit par l’avis de la Vue d’ensemble', () => {
    const combinaisons = new Set<string>()
    let archives = 0
    let vides = 0
    for (const e of LECTURES) {
      const lu = lireLesDossiersAuRibAConfirmer(valeurAttendue(e))
      expect(lu, `${e.num} : ${e.attendu}`).not.toBeNull()
      if (!lu) continue
      if (lu.dossiers.length === 0) vides += 1
      for (const d of lu.dossiers) {
        combinaisons.add(`${d.changement.geste}|${d.changement.auteur}|${d.changement.etat}|${d.changement.ribEnVigueur}`)
        if (d.archive) archives += 1
      }
      expect(lignesDesDossiers(lu).map((l) => l.avis)).toEqual(lu.dossiers.map((d) => avisDuChangement(d.changement, 'cabinet')))
    }
    // Les trois combinaisons d'une proposition (lib/changementDeRib.ts), chacune exigée de la base ; un dossier archivé ;
    // la liste vide, affirmée à un profil du cabinet.
    expect([...combinaisons].sort()).toEqual(['change|client|propose|aucun', 'change|client|propose|inchange', 'pose|client|propose|aucun'])
    expect(archives).toBeGreaterThan(0)
    expect(vides).toBeGreaterThanOrEqual(3)
  })
})

// ── 2. L'essai, rejoué ─────────────────────────────────────────────────────────────────────────────────────────────
// La règle, écrite ici sans le texte SQL : les dossiers que le profil administre — le cabinet de son chef, les dossiers
// affectés à un membre, tous pour le super-administrateur (rattaché ou non à un cabinet) ; jamais un dossier dont le compte
// n'est qu'un accès client — ; pour chacun, la DERNIÈRE valeur que l'essai a exigée de `dernier_changement_de_rib` (avant
// toute version : aucun changement ; une étape qui écrit sur un dossier rend sa valeur inconnue jusqu'à la suivante) ; un
// RIB proposé seulement ; le plus ancien changement d'abord, puis l'identifiant.
const DOSSIER_ECRIT = /public\.(?:enregistrer_parametres_facturation|confirmer_rib)\('\{(\w+)\}'/g
const LECTURE_DU_CHANGEMENT = /public\.dernier_changement_de_rib\('\{(\w+)\}'\)::text$/

interface Rejeu { etape: Etape; attendu: unknown; regle: unknown }

// Un JSON écrit clés triées : `jsonb` range les clés à sa façon, la règle à la sienne — seules les valeurs se comparent.
function canonique(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonique).join(',')}]`
  if (typeof v === 'object' && v !== null) {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonique((v as Record<string, unknown>)[k])}`).join(',')}}`
  }
  return JSON.stringify(v)
}

function administres(qui: string, dossiers: readonly DossierDuJeu[]): DossierDuJeu[] {
  if (qui === 'super' || qui === 'super_seul') return [...dossiers]
  const p = PROFILS.get(qui)
  if (!p) throw new Error(`profil ${qui} : il ne lit pas la liste`)
  return p.role === 'comptable_en_chef'
    ? dossiers.filter((d) => d.cabinet === p.cabinet)
    : dossiers.filter((d) => p.affectes.includes(d.id))
}

function rejouer(): Rejeu[] {
  const changements = new Map<string, { changement: unknown } | 'inconnu'>(DOSSIERS_DU_JEU.map((d) => [d.id, { changement: null }]))
  const rejeux: Rejeu[] = []
  for (const e of ETAPES) {
    if (e.genre === 'jeu') {
      for (const l of lignesInserees(e.ordre.replace(/\s+/g, ' '), 'parametres_facturation', NOMS)) changements.set(l.dossier_id as string, 'inconnu')
      continue
    }
    if (e.code !== 'OK') continue
    const parties = e.ordre.split('§§').map((p) => p.trim())
    if (e.genre === 'fait') {
      for (const m of e.ordre.matchAll(DOSSIER_ECRIT)) changements.set(m[1], 'inconnu')
      continue
    }
    const lecture = LECTURE_DU_CHANGEMENT.exec(parties[parties.length - 1])
    if (lecture) {
      changements.set(lecture[1], JSON.parse(resoudre(e.attendu as string)) as { changement: unknown })
      continue
    }
    if (!LECTURES.includes(e)) continue
    // Ce qu'un contrôle écrit avant de lire ne vaut que pour lui (il s'annule) : ici, un dossier désarchivé.
    const dossiers = DOSSIERS_DU_JEU.map((d) => ({ ...d }))
    for (const p of parties.slice(0, -1)) {
      const desarchive = /^update dossiers set archive = false where id = '\{(\w+)\}'$/.exec(p)
      if (!desarchive) throw new Error(`${e.num} : écriture que le test ne sait pas rejouer : ${p}`)
      for (const d of dossiers) if (d.id === desarchive[1]) d.archive = false
    }
    const enAttente = administres(e.qui, dossiers).flatMap((d) => {
      const c = changements.get(d.id)
      if (c === 'inconnu' || c === undefined) throw new Error(`${e.num} : la valeur de ${d.id} n'est pas dite avant la liste`)
      const changement = c.changement as { etat?: string; jour?: string } | null
      return changement?.etat === 'propose' ? [{ dossier_id: d.id, nom: d.nom, archive: d.archive, changement, jour: changement.jour as string }] : []
    })
    const id = (nom: string) => IDS.get(nom) ?? ''
    enAttente.sort((a, b) => (a.jour < b.jour ? -1 : a.jour > b.jour ? 1 : id(a.dossier_id) < id(b.dossier_id) ? -1 : 1))
    rejeux.push({
      etape: e,
      attendu: valeurAttendue(e),
      regle: { dossiers: enAttente.map(({ dossier_id, nom, archive, changement }) => ({ dossier_id: IDS.get(dossier_id), nom, archive, changement })) },
    })
  }
  return rejeux
}

describe('l’essai, rejoué : la règle retrouve chaque liste que la base a rendue', () => {
  const rejeux = rejouer()

  it('chaque lecture de la liste est rejouée', () => {
    expect(rejeux.map((r) => r.etape.num)).toEqual(LECTURES.map((e) => e.num))
  })

  it('chaque liste : les mêmes dossiers, les mêmes changements, dans le même ordre', () => {
    const ecarts = rejeux.filter((r) => canonique(r.attendu) !== canonique(r.regle))
      .map((r) => `${r.etape.num} : la base ${JSON.stringify(r.attendu)}, la règle ${JSON.stringify(r.regle)}`)
    expect(ecarts).toEqual([])
  })

  it('ce que l’essai fait voir : un cabinet ne voit pas l’autre, un accès client ne fait pas entrer un dossier, un RIB proposé entre puis sort', () => {
    // Les dossiers rendus, profil par profil : jamais deux profils de cabinets différents ne voient le même.
    const vus = (num: string) => (valeurAttendue(etape(num)) as { dossiers: { dossier_id: string }[] }).dossiers.map((d) => d.dossier_id)
    expect(vus('17')).toEqual([IDS.get('DB')])
    expect(vus('14').some((id) => vus('17').includes(id))).toBe(false)
    // Le membre ne voit jamais D3, où le même compte n'est qu'un accès client ; affecté à D3, il le voit.
    expect(vus('15')).not.toContain(IDS.get('D3'))
    expect(vus('M2')).toContain(IDS.get('D3'))
    // Un RIB proposé entre dans la liste (20c), puis en sort à sa confirmation (21c).
    expect(vus('20c')).toContain(IDS.get('D5'))
    expect(vus('21c')).not.toContain(IDS.get('D5'))
    // Le dossier archivé est rendu, marqué ; désarchivé, il l'est sans la marque (M4).
    const marque = (num: string) => (valeurAttendue(etape(num)) as { dossiers: { dossier_id: string; archive: boolean }[] }).dossiers
      .find((d) => d.dossier_id === IDS.get('D8'))?.archive
    expect([marque('14'), marque('M4')]).toEqual([true, false])
  })
})

// ── 3. La valeur rendue, lue sans rien deviner ─────────────────────────────────────────────────────────────────────
const UN = 'a5b3c000-0000-4000-8000-0000000000d1'
const DEUX = 'a5b3c000-0000-4000-8000-0000000000d2'
const PROPOSE = { etat: 'propose', jour: '2026-10-16', geste: 'change', auteur: 'client', rib_en_vigueur: 'inchange' }
const ELEMENT = { dossier_id: UN, nom: 'Dossier fictif', archive: false, changement: PROPOSE }
const RENDU = { dossiers: [ELEMENT] }
const avec = (f: (e: Record<string, unknown>) => void) => {
  const copie = JSON.parse(JSON.stringify(RENDU)) as { dossiers: Record<string, unknown>[] }
  f(copie.dossiers[0])
  return copie
}

describe('la valeur rendue, lue sans rien deviner', () => {
  it('« aucun dossier » : seulement l’objet qui porte la liste vide', () => {
    expect(lireLesDossiersAuRibAConfirmer({ dossiers: [] })).toEqual({ dossiers: [] })
  })

  it('un dossier : chaque mot à sa place, le changement lu par le module de l’étape A5b3a', () => {
    expect(lireLesDossiersAuRibAConfirmer(RENDU)).toEqual({
      dossiers: [{ dossierId: UN, nom: 'Dossier fictif', archive: false,
        changement: { jour: '2026-10-16', geste: 'change', auteur: 'client', etat: 'propose', ribEnVigueur: 'inchange' } }],
    })
    expect(lireLesDossiersAuRibAConfirmer(avec((e) => { e.archive = true }))?.dossiers[0].archive).toBe(true)
    // Le nom est rendu tel que la base le porte : rien n'est « nettoyé ».
    expect(lireLesDossiersAuRibAConfirmer(avec((e) => { e.nom = '  ' }))?.dossiers[0].nom).toBe('  ')
  })

  it.each([
    ['un nul nu', null],
    ['rien', undefined],
    ['un tableau nu', [ELEMENT]],
    ['un texte', 'aucun'],
    ['un objet vide', {}],
    ['la liste nulle', { dossiers: null }],
    ['la liste en objet', { dossiers: {} }],
    ['une clé de plus à la racine', { dossiers: [], nombre: 0 }],
    ['la racine sous un autre nom', { liste: [] }],
    ['un élément nul', { dossiers: [null] }],
    ['un élément en tableau', { dossiers: [[]] }],
    ['l’IBAN glissé dans un élément', avec((e) => { e.iban = 'FR7199999002480000RIBDEUX00' })],
    ['le compte glissé dans un élément', avec((e) => { e.par = '797fe440-df8d-4b8e-828b-d148927bfd60' })],
    ['l’identifiant absent', avec((e) => { delete e.dossier_id })],
    ['le nom absent', avec((e) => { delete e.nom })],
    ['la marque « archivé » absente', avec((e) => { delete e.archive })],
    ['le changement absent', avec((e) => { delete e.changement })],
    ['un identifiant en majuscules', avec((e) => { e.dossier_id = UN.toUpperCase() })],
    ['un identifiant sans tirets', avec((e) => { e.dossier_id = UN.replace(/-/g, '') })],
    ['un identifiant numérique', avec((e) => { e.dossier_id = 42 })],
    ['un nom nul', avec((e) => { e.nom = null })],
    ['la marque « archivé » en texte', avec((e) => { e.archive = 'false' })],
    ['la marque « archivé » nulle', avec((e) => { e.archive = null })],
    ['aucun changement (nul)', avec((e) => { e.changement = null })],
    ['un changement confirmé', avec((e) => { e.changement = { etat: 'confirme', jour: '2026-10-16', geste: 'confirme', auteur: 'cabinet', rib_en_vigueur: 'change' } })],
    ['un changement retiré', avec((e) => { e.changement = { etat: 'retire', jour: '2026-10-16', geste: 'retire', auteur: 'inconnu', rib_en_vigueur: 'aucun' } })],
    ['une proposition que la fonction ne rend jamais (par le cabinet)', avec((e) => { e.changement = { ...PROPOSE, auteur: 'cabinet' } })],
    ['un changement à l’IBAN glissé', avec((e) => { e.changement = { ...PROPOSE, iban: 'FR7199999002480000RIBDEUX00' } })],
    ['un changement sous la forme de la fonction voisine', avec((e) => { e.changement = { changement: PROPOSE } })],
    ['un jour qui n’existe pas', avec((e) => { e.changement = { ...PROPOSE, jour: '2026-02-30' } })],
    ['le même dossier deux fois', { dossiers: [ELEMENT, ELEMENT] }],
    ['deux dossiers dans l’ordre des identifiants à rebours', { dossiers: [{ ...ELEMENT, dossier_id: DEUX }, ELEMENT] }],
    ['le plus récent d’abord', { dossiers: [{ ...ELEMENT, changement: { ...PROPOSE, jour: '2026-10-17' } }, { ...ELEMENT, dossier_id: DEUX }] }],
  ])('%s : illisible — jamais « aucun dossier », jamais une liste', (_nom, rendu) => {
    expect(lireLesDossiersAuRibAConfirmer(rendu)).toBeNull()
  })

  it('l’ordre de la fonction : le plus ancien d’abord, puis l’identifiant — lu, jamais refait', () => {
    const ancien = { ...ELEMENT, dossier_id: DEUX, changement: { ...PROPOSE, jour: '2026-09-01' } }
    const lu = lireLesDossiersAuRibAConfirmer({ dossiers: [ancien, ELEMENT, { ...ELEMENT, dossier_id: 'a5b3c000-0000-4000-8000-0000000000d3' }] })
    expect(lu?.dossiers.map((d) => d.dossierId)).toEqual([DEUX, UN, 'a5b3c000-0000-4000-8000-0000000000d3'])
    // Les identifiants se comparent comme PostgreSQL compare des uuid : octet par octet, donc chiffre hexadécimal par chiffre.
    const neuf = { ...ELEMENT, dossier_id: '9fffffff-ffff-4fff-bfff-ffffffffffff' }
    const a = { ...ELEMENT, dossier_id: 'a0000000-0000-4000-8000-000000000000' }
    expect(lireLesDossiersAuRibAConfirmer({ dossiers: [neuf, a] })).not.toBeNull()
    expect(lireLesDossiersAuRibAConfirmer({ dossiers: [a, neuf] })).toBeNull()
  })

  it('aucune clé ne nomme ce que la fonction ne rend jamais', () => {
    const toutes = Object.values(CLES_DES_DOSSIERS_AU_RIB).flat() as string[]
    for (const interdite of ['iban', 'bic', 'titulaire_compte', 'auteur_id', 'rib_confirme_par', 'version', 'cree_le', 'heure', 'cabinet_id']) {
      expect(toutes).not.toContain(interdite)
    }
  })
})

// ── 4. Ce qu'un écran en dira ───────────────────────────────────────────────────────────────────────────────────────
const dossier = (n: number, o: { archive?: boolean; changement?: Partial<ChangementDeRib> } = {}) => ({
  dossierId: `a5b3c000-0000-4000-8000-0000000000${(0xd0 + n).toString(16)}`, nom: `Dossier fictif ${n}`, archive: o.archive ?? false,
  changement: changementFictif({ jour: '2026-10-16', ...o.changement }),
})
const liste = (...dossiers: ReturnType<typeof dossier>[]): DossiersAuRibAConfirmerLus => ({ dossiers })

describe('ce qu’un écran en dira', () => {
  it('le compte : aucun, un, plusieurs, et parmi eux les archivés', () => {
    expect(phraseDuCompte(liste())).toBe(AUCUN_RIB_A_CONFIRMER)
    expect(AUCUN_RIB_A_CONFIRMER).toBe('Aucun RIB proposé n’attend votre confirmation.')
    expect(phraseDuCompte(liste(dossier(1)))).toBe('Un dossier a un RIB proposé qui attend votre confirmation.')
    expect(phraseDuCompte(liste(dossier(1, { archive: true })))).toBe('Un dossier archivé a un RIB proposé qui attend votre confirmation.')
    expect(phraseDuCompte(liste(dossier(1), dossier(2)))).toBe('2 dossiers ont un RIB proposé qui attend votre confirmation.')
    expect(phraseDuCompte(liste(dossier(1), dossier(2, { archive: true }))))
      .toBe('2 dossiers ont un RIB proposé qui attend votre confirmation, dont un archivé.')
    expect(phraseDuCompte(liste(dossier(1), dossier(2, { archive: true }), dossier(3, { archive: true }))))
      .toBe('3 dossiers ont un RIB proposé qui attend votre confirmation, dont 2 archivés.')
    expect(phraseDuCompte(liste(dossier(1, { archive: true }), dossier(2, { archive: true }))))
      .toBe('2 dossiers archivés ont un RIB proposé qui attend votre confirmation.')
  })

  it('une ligne par dossier : son nom, sa marque, son jour, et l’avis de la Vue d’ensemble au caractère près', () => {
    const lu = liste(dossier(1, { archive: true }), dossier(2, { changement: { geste: 'change', ribEnVigueur: 'inchange' } }))
    expect(lignesDesDossiers(lu)).toEqual([
      { dossierId: lu.dossiers[0].dossierId, nom: 'Dossier fictif 1', archive: true, jour: '2026-10-16',
        avis: avisDuChangement(lu.dossiers[0].changement, 'cabinet') },
      { dossierId: lu.dossiers[1].dossierId, nom: 'Dossier fictif 2', archive: false, jour: '2026-10-16',
        avis: avisDuChangement(lu.dossiers[1].changement, 'cabinet') },
    ])
    expect(lignesDesDossiers(lu)[0].avis.phrase).toBe('Un accès client a proposé un RIB pour les factures le 16/10/2026 : il attend votre confirmation.')
    expect(lignesDesDossiers(lu)[1].avis.phrase).toBe('Un accès client a proposé un nouveau RIB pour les factures le 16/10/2026 : il attend votre confirmation.')
    expect(MENTION_DOSSIER_ARCHIVE).toBe('Dossier archivé')
  })

  it('ce que l’écran dit de la lecture : rien avant le retour, « aucun » d’une liste vide, la liste, ou la ligne discrète', () => {
    expect(ceQueDitLaListe(null)).toEqual({ genre: 'rien' })
    expect(ceQueDitLaListe({ etat: 'en_cours' })).toEqual({ genre: 'rien' })
    expect(ceQueDitLaListe({ etat: 'lue', lu: liste() })).toEqual({ genre: 'aucun', phrase: AUCUN_RIB_A_CONFIRMER })
    const lu = liste(dossier(1), dossier(2))
    expect(ceQueDitLaListe({ etat: 'lue', lu })).toEqual({ genre: 'liste', phrase: phraseDuCompte(lu), lignes: lignesDesDossiers(lu) })
    expect(ceQueDitLaListe({ etat: 'illisible' })).toEqual({ genre: 'lecture_manquee', phrase: LECTURE_MANQUEE_DE_LA_LISTE, motif: null })
    expect(ceQueDitLaListe({ etat: 'refusee', motif: 'Seul le cabinet lit les RIB à confirmer.' }))
      .toEqual({ genre: 'lecture_manquee', phrase: LECTURE_MANQUEE_DE_LA_LISTE, motif: 'Seul le cabinet lit les RIB à confirmer.' })
  })

  it('au cabinet, vouvoyé ; jamais un IBAN, un identifiant ni un mot du client', () => {
    const textes = [AUCUN_RIB_A_CONFIRMER, MENTION_DOSSIER_ARCHIVE, LECTURE_MANQUEE_DE_LA_LISTE,
      ...[0, 1, 2, 3].flatMap((k) => [phraseDuCompte(liste(...Array.from({ length: 3 }, (_, i) => dossier(i + 1, { archive: i < k }))))])]
    for (const t of textes) {
      expect(t, t).not.toMatch(/\b(tu|ton|ta|tes|toi)\b/i)
      expect(t, t).not.toMatch(/\b[A-Z]{2}\d{2}[A-Z0-9]{8,}|[0-9a-f]{8}-[0-9a-f]{4}-/)
    }
    // La ligne discrète dit où regarder, sans rien affirmer : jamais « aucun ».
    expect(LECTURE_MANQUEE_DE_LA_LISTE).not.toMatch(/aucun/i)
    expect(LECTURE_MANQUEE_DE_LA_LISTE).toContain('Vue d’ensemble')
    // Le cabinet est le lecteur : ces mots-là lui sont propres, et le garde des mots du client le voit.
    expect(motsDuCabinet(LECTURE_MANQUEE_DE_LA_LISTE).length).toBeGreaterThan(0)
  })
})

// ── 5. Le drapeau, et le texte de la fonction exportée ──────────────────────────────────────────────────────────────
describe('le module et la fonction exportée disent la même chose', () => {
  const exportee = fichiersDuSchema().some((f) => /create function public\.dossiers_au_rib_a_confirmer\(/.test(f.texte))

  it('le drapeau dit ce que porte l’export : faux tant que la migration n’y est pas', () => {
    expect(DOSSIERS_AU_RIB_A_CONFIRMER_EXPORTE, 'DOSSIERS_AU_RIB_A_CONFIRMER_EXPORTE ne dit plus ce que porte l’export').toBe(exportee)
  })

  it('exportée : la définition, l’accès d’abord — le cabinet seul —, puis les dossiers que admin_du_dossier ouvre', () => {
    if (!DOSSIERS_AU_RIB_A_CONFIRMER_EXPORTE) return
    const sql = derniereDefinitionSql('dossiers_au_rib_a_confirmer')
    expect(sql).toMatch(/dossiers_au_rib_a_confirmer\(\)\nreturns jsonb\nlanguage plpgsql\nstable\nsecurity definer\nset search_path = public/)
    const corps = sql.slice(sql.indexOf('\nbegin\n'))
    const acces = corps.indexOf("raise exception 'Seul le cabinet lit les RIB à confirmer.' using errcode = '42501'")
    expect(acces).toBeGreaterThan(0)
    expect(corps.slice(0, acces)).toMatch(/if not \(public\.is_super_admin\(\)\s+or exists \(select 1 from public\.cabinet_admins ca where ca\.user_id = auth\.uid\(\)\)\) then/)
    expect(corps.slice(0, acces)).not.toMatch(/public\.dossiers\b|dernier_changement_de_rib/)
    expect(corps.indexOf('from public.dossiers x where public.admin_du_dossier(x.id)')).toBeGreaterThan(acces)
  })

  it('exportée : une seule règle — dernier_changement_de_rib appelé pour chaque dossier, la table des paramètres jamais lue', () => {
    if (!DOSSIERS_AU_RIB_A_CONFIRMER_EXPORTE) return
    const sql = derniereDefinitionSql('dossiers_au_rib_a_confirmer')
    expect([...sql.matchAll(/dernier_changement_de_rib\(/g)]).toHaveLength(1)
    expect(sql).toContain("v_changement := public.dernier_changement_de_rib(d.id) -> 'changement';")
    expect(sql).toContain("if v_changement ->> 'etat' = 'propose' then")
    expect(sql).not.toMatch(/parametres_facturation/)
    expect(sql).not.toMatch(/\b(insert|update)\b/i)
  })

  it('exportée : chaque élément a les clés du module, le changement tel quel ; l’ordre, le jour puis la clé', () => {
    if (!DOSSIERS_AU_RIB_A_CONFIRMER_EXPORTE) return
    const sql = derniereDefinitionSql('dossiers_au_rib_a_confirmer')
    const debut = sql.indexOf('jsonb_build_array(jsonb_build_object(') + 'jsonb_build_array(jsonb_build_object('.length
    const args = decouper(sql.slice(debut, sql.indexOf('));', debut)))
    expect(args.filter((_, i) => i % 2 === 0).map((c) => c.replace(/'/g, ''))).toEqual([...CLES_DES_DOSSIERS_AU_RIB.dossier])
    expect(args.filter((_, i) => i % 2 === 1)).toEqual(['d.id', 'd.nom', 'd.archive', 'v_changement'])
    expect(sql).toContain("return jsonb_build_object('dossiers', coalesce(")
    expect(sql).toContain("jsonb_agg(e order by (e -> 'changement' ->> 'jour')::date, (e ->> 'dossier_id')::uuid)")
    expect(sql).toMatch(/'\[\]'::jsonb\)\);\nend/)
  })

  it('exportée : l’anonyme et PUBLIC n’exécutent pas la fonction ; les connectés, oui', () => {
    if (!DOSSIERS_AU_RIB_A_CONFIRMER_EXPORTE) return
    const texte = fichiersDuSchema().find((f) => /create function public\.dossiers_au_rib_a_confirmer\(/.test(f.texte))?.texte as string
    expect(texte).toContain('revoke execute on function public.dossiers_au_rib_a_confirmer() from public, anon;')
    expect(texte).toContain('grant execute on function public.dossiers_au_rib_a_confirmer() to authenticated;')
  })
})
