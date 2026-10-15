import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { NOM_DANS_UN_REFUS_MAX } from './articles'
import { REFUS_ENREGISTREMENT_CONTACT, saisieQuiPart, type ContactPourSiret } from './contacts'
import {
  CHAMPS_D_UNE_LIGNE,
  IMPORT_CONTACTS_EXPORTE,
  LIGNES_PAR_IMPORT_MAX,
  PREFIXE_D_UNE_LIGNE,
  REFUS_DE_L_IMPORT,
  REFUS_D_UNE_LIGNE,
  refusDesLignes,
  refusDuNombreDeLignes,
  refusDUneLigne,
  refusImportContacts,
  type RefusImportContacts,
} from './contactsImport'
import type { ArticleExoneration } from './types'
import { lignesInserees } from '../test/essaiSql'
import { derniereDefinitionSql, fichiersDuSchema } from '../test/schema'

// LE MODULE DE L'IMPORT DES CONTACTS, CONFRONTÉ À LA BASE (espace client, étape A4b3a). Tant que l'export (supabase/schema)
// ne porte pas la migration `importer_contacts`, sa RÉFÉRENCE est l'essai `supabase/essais/importContacts.sql`, joué sur une
// réplique de la production munie de la migration : chacun de ses contrôles exige de la base un code ET des mots. Ce test
// exige que chaque refus propre du module y soit exigé de la fonction, et REJOUE dans le module les imports de l'essai,
// dans leur ordre, sur l'état que ses étapes gardées construisent : le même premier refus, ou aucun. Dès que l'export porte
// la migration, il la confronte aussi au texte même de la fonction.

const ESSAI = readFileSync(new URL('../../supabase/essais/importContacts.sql', import.meta.url), 'utf8')

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

// Un modèle du module, en expression régulière : chaque « % » une valeur.
const modeleEnRegex = (modele: string) =>
  new RegExp(`^${modele.split('%').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s\\S]*')}$`)

const ETAPES = etapesDeLEssai(ESSAI)
const etape = (num: string) => {
  const e = ETAPES.find((x) => x.num === num)
  if (!e) throw new Error(`étape ${num} introuvable dans importContacts.sql`)
  return e
}

// ── L'appel d'une étape : le dossier et les lignes, lus comme la base les reçoit ─────────────────────────────────────
interface Appel {
  fonction: 'importer_contacts' | 'enregistrer_contact'
  dossier: string
  lignes: unknown
}

// L'argument d'un import : `null`, un littéral `'…'::jsonb`, ou une série de lignes identiques
// (`(select jsonb_agg('…'::jsonb) from generate_series(1, N))`), précédée ou non d'un littéral (`'[…]'::jsonb || (…)`).
function argumentImport(source: string): unknown {
  const s = source.trim()
  if (s === 'null') return null
  const litteral = /^'((?:[^']|'')*)'::jsonb$/.exec(s)
  if (litteral) return JSON.parse(sansDoubles(litteral[1]))
  const serie = /^(?:'((?:[^']|'')*)'::jsonb \|\| )?\(select jsonb_agg\('((?:[^']|'')*)'::jsonb\) from generate_series\(1, (\d+)\)\)$/.exec(s)
  if (!serie) throw new Error(`argument d'import illisible : ${s.slice(0, 120)}`)
  const tete = serie[1] === undefined ? [] : JSON.parse(sansDoubles(serie[1])) as unknown[]
  const ligne = sansDoubles(serie[2])
  return [...tete, ...Array.from({ length: Number(serie[3]) }, () => JSON.parse(ligne) as unknown)]
}

function appelDe(ordre: string): Appel | null {
  const compte = /^select array_length\(public\.importer_contacts\('\{(\w+)\}', ([\s\S]*)\), 1\)::text$/.exec(ordre)
  const rendu = /^select public\.importer_contacts\('\{(\w+)\}', ([\s\S]*)\)::text$/.exec(ordre)
  const importer = compte ?? rendu
  if (importer) return { fonction: 'importer_contacts', dossier: importer[1], lignes: argumentImport(importer[2]) }
  const enregistrer = /^select c\.id::text from public\.enregistrer_contact\('\{(\w+)\}', null, '((?:[^']|'')*)'::jsonb\) c$/.exec(ordre)
  if (enregistrer) return { fonction: 'enregistrer_contact', dossier: enregistrer[1], lignes: JSON.parse(sansDoubles(enregistrer[2])) }
  return null
}

describe('l’essai, lu', () => {
  it('ses étapes, toutes : deux de jeu, 72 jugées — le soixante-treizième verdict est le bilan « rien n’est resté »', () => {
    // Le plancher qui distingue « aucun écart » d'« aveugle » : un motif qui ne reconnaîtrait plus les étapes rendrait une
    // liste vide, et toutes les confrontations ci-dessous passeraient sans rien confronter.
    const ouvertes = [...ESSAI.matchAll(/^\s*\('\w+', '(?:jeu|controle|fait|valeur|mutation)'/gm)].length
    expect(ETAPES).toHaveLength(ouvertes)
    expect(ETAPES.filter((e) => e.genre === 'jeu')).toHaveLength(2)
    expect(ETAPES.filter((e) => e.genre !== 'jeu')).toHaveLength(72)
    expect(ETAPES.filter((e) => e.genre === 'mutation')).toHaveLength(12)
    expect(new Set(ETAPES.map((e) => e.num)).size).toBe(ETAPES.length)
  })

  it('chaque appel de l’essai se lit : les imports, et le contact rangé avant eux', () => {
    const appels = ETAPES.filter((e) => ['controle', 'fait', 'mutation'].includes(e.genre)
      && /public\.(importer_contacts|enregistrer_contact)\('/.test(e.ordre))
    for (const e of appels) expect(appelDe(e.ordre), e.num).not.toBeNull()
    expect(appels.length).toBeGreaterThanOrEqual(55)
  })
})

// ── 1. Chaque refus du module est exigé de la base par l'essai, sous ses mots et son code ─────────────────────────────

describe('les refus du module sont ceux que la base rend', () => {
  const exiges = ETAPES.filter((e) => (e.genre === 'controle' || e.genre === 'mutation') && e.code !== 'OK' && e.attendu != null)

  it('chaque refus de l’import entier est exigé par un contrôle, sous son code et ses mots', () => {
    for (const r of REFUS_DE_L_IMPORT) {
      const temoins = exiges.filter((e) => modeleEnRegex(r.modele).test(e.attendu as string))
      expect(temoins.length, `le refus « ${r.cle} » n'est exigé par aucun contrôle de importContacts.sql`).toBeGreaterThan(0)
      for (const e of temoins) expect(e.code, `contrôle ${e.num}`).toBe(r.code)
    }
  })

  it('chaque refus d’une ligne est exigé par un contrôle, « Ligne N : » en tête, sous son code et ses mots', () => {
    for (const r of REFUS_D_UNE_LIGNE) {
      const motif = modeleEnRegex(PREFIXE_D_UNE_LIGNE + r.modele)
      const temoins = exiges.filter((e) => motif.test(e.attendu as string))
      expect(temoins.length, `le refus « ${r.cle} » n'est exigé par aucun contrôle de importContacts.sql`).toBeGreaterThan(0)
      for (const e of temoins) expect(e.code, `contrôle ${e.num}`).toBe(r.code)
    }
  })

  it('l’accès d’abord : avant l’import vide, avant ce qui n’est pas un tableau, avant la borne', () => {
    for (const num of ['6d', '6e', '6f']) expect([etape(num).code, etape(num).attendu]).toEqual(['42501', REFUS_DE_L_IMPORT[0].modele])
  })

  it('la borne : celle de l’essai, comprise (mille passent, mille et une non) ; le message la dit en lettres', () => {
    expect(etape('0e').attendu).toBe(String(LIGNES_PAR_IMPORT_MAX))
    expect([etape('22b').code, etape('22b').attendu]).toEqual(['OK', String(LIGNES_PAR_IMPORT_MAX)])
    expect(etape('22').attendu).toContain(`en porte ${LIGNES_PAR_IMPORT_MAX + 1} :`)
    expect(LIGNES_PAR_IMPORT_MAX).toBe(1000)
    expect(REFUS_DE_L_IMPORT[3].modele.startsWith('Un import range mille lignes au plus ;')).toBe(true)
  })

  it('les champs d’une ligne : ceux de l’essai, que la base confronte à ce qu’enregistrer_contact lit', () => {
    const [juge, liste] = (etape('0c').attendu as string).split(' ')
    expect(juge).toBe('true')
    const enOctets = [...CHAMPS_D_UNE_LIGNE].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    expect(liste.split(',')).toEqual(enOctets)
    // Et ceux qu'enregistrer_contact lit dans l'export, au caractère près.
    const lus = new Set([...derniereDefinitionSql('enregistrer_contact').matchAll(/p_contact->>?'(\w+)'/g)].map((m) => m[1]))
    expect([...lus].sort()).toEqual([...CHAMPS_D_UNE_LIGNE].sort())
  })

  it('la saisie telle qu’elle part (`saisieQuiPart`) ne porte que des champs d’une ligne', () => {
    const saisie = saisieQuiPart({
      nom: 'Essai', typeClient: 'assujetti', adresse: 'Adresse fictive', siren: '123456782', siret: '12345678200010',
      adresseElectronique: '', codeService: '', email: '', delai: '30', observations: '',
    })
    expect(Object.keys(saisie).sort()).toEqual([...CHAMPS_D_UNE_LIGNE].sort())
  })
})

// ── 2. Les imports de l'essai, rejoués dans le module, sur l'état que ses étapes gardées construisent ────────────────

const DOSSIERS = ['DA', 'DB', 'DC'] as const
const NOMS = new Map<string, string>([...DOSSIERS, 'CAB'].map((n) => [n, n]))

function articlesDuJeu(): Map<string, ArticleExoneration | null> {
  const lignes = lignesInserees(etape('j1').ordre, 'dossiers', NOMS)
  return new Map(lignes.map((l) => [l.id as string, (l.article_exoneration as ArticleExoneration | null) ?? null]))
}

// Qui a accès, comme la base le juge : le chef (super-administrateur) sur un dossier jetable, le client qui porte « Ventes »
// sur le dossier A, le membre affecté sur le dossier B. Le module ne juge pas l'accès : ces étapes-là seules se rejouent.
const aAcces = (e: EtapeDeLEssai, dossier: string) =>
  (e.qui === 'chef' && (DOSSIERS as readonly string[]).includes(dossier))
  || (e.qui === 'client' && (e.droits === 'ventes' || e.droits === 'deux') && dossier === 'DA')
  || (e.qui === 'membre_affecte' && dossier === 'DB')

interface Rejeu {
  etape: EtapeDeLEssai
  refus: RefusImportContacts | null
}

function rejouer(): { rejeux: Rejeu[]; sansAcces: EtapeDeLEssai[] } {
  const articles = articlesDuJeu()
  const etat = new Map<string, ContactPourSiret[]>(DOSSIERS.map((d) => [d, []]))
  const rejeux: Rejeu[] = []
  const sansAcces: EtapeDeLEssai[] = []
  for (const e of ETAPES) {
    if (!['controle', 'fait', 'mutation'].includes(e.genre)) continue
    const appel = appelDe(e.ordre)
    if (!appel) continue
    if (!aAcces(e, appel.dossier)) {
      sansAcces.push(e)
      continue
    }
    const contacts = etat.get(appel.dossier) ?? []
    const article = articles.get(appel.dossier) ?? null
    if (appel.fonction === 'enregistrer_contact') {
      // Le contact rangé avant les imports (étape 7) entre dans l'état ; le module de l'étape A4a le juge, son test le rejoue.
      const ligne = appel.lignes as { nom: string; siret?: string }
      if (e.genre === 'fait') contacts.push({ id: e.num, dossier_id: appel.dossier, siret: ligne.siret ?? null, nom: ligne.nom, retire_le: null })
      continue
    }
    const refus = refusImportContacts(appel.dossier, article, appel.lignes, contacts)
    rejeux.push({ etape: e, refus })
    // Un import gardé et accepté range ses lignes.
    if (e.genre === 'fait' && e.code === 'OK' && !refus) {
      for (const [i, l] of (appel.lignes as { nom: string; siret?: string }[]).entries()) {
        contacts.push({ id: `${e.num}-${i + 1}`, dossier_id: appel.dossier, siret: l.siret ?? null, nom: l.nom, retire_le: null })
      }
    }
  }
  return { rejeux, sansAcces }
}

describe('les imports de l’essai, rejoués dans le module', () => {
  const { rejeux: REJEUX, sansAcces: SANS_ACCES } = rejouer()

  it('assez d’imports pour juger : acceptés et refusés, chaque refus propre de l’import et des refus d’enregistrer_contact', () => {
    expect(REJEUX.length).toBeGreaterThanOrEqual(45)
    expect(REJEUX.filter((r) => r.etape.code === 'OK').length).toBeGreaterThanOrEqual(15)
    const cles = new Set(REJEUX.flatMap((r) => (r.refus ? [r.refus.cle] : [])))
    for (const r of [...REFUS_DE_L_IMPORT, ...REFUS_D_UNE_LIGNE]) if (r.cle !== 'acces') expect(cles.has(r.cle), r.cle).toBe(true)
    for (const cle of ['siret_pris', 'soins_particulier', 'soins_etranger', 'email_invalide', 'nom_absent', 'siret_sans_siren',
      'delai_invalide', 'type_inconnu', 'siren_cle'] as const) {
      expect(cles.has(cle), cle).toBe(true)
    }
  })

  it('les étapes que le module ne rejoue pas sont celles de l’accès, et elles exigent toutes le refus d’accès', () => {
    expect(SANS_ACCES.length).toBeGreaterThanOrEqual(10)
    for (const e of SANS_ACCES) {
      expect([e.code, e.attendu], e.num).toSatisfy(([code, attendu]) =>
        code === '42501' && (attendu === REFUS_DE_L_IMPORT[0].modele || attendu === 'permission denied for function importer_contacts'))
    }
    // Et aucun import rejoué n'attend un refus d'accès : le module ne le juge pas.
    expect(REJEUX.filter((r) => r.etape.code === '42501').map((r) => r.etape.num)).toEqual([])
  })

  it('chaque import : le même premier refus que la base, sous le même code et à la même ligne — ou aucun quand elle range', () => {
    const ecarts: string[] = []
    for (const { etape: e, refus } of REJEUX) {
      if (e.code === 'OK') {
        if (refus) ecarts.push(`${e.num} : la base range, le module refuse « ${refus.message} »`)
      } else if (!refus) {
        ecarts.push(`${e.num} : la base refuse (${e.code}), le module range`)
      } else if (!likeEnRegex(e.attendu as string).test(refus.message) || refus.code !== e.code) {
        ecarts.push(`${e.num} : la base « ${e.code} ${e.attendu} », le module « ${refus.code} ${refus.message} »`)
      } else if (refus.ligne != null && !(e.attendu as string).startsWith(`Ligne ${refus.ligne} : `)) {
        ecarts.push(`${e.num} : la ligne ${refus.ligne} au lieu de « ${e.attendu} »`)
      }
    }
    expect(ecarts).toEqual([])
  })

  it('le premier refus de `refusDesLignes` est celui de l’import, pour chaque import rejoué dont le tableau passe', () => {
    const articles = articlesDuJeu()
    let compares = 0
    for (const { etape: e, refus } of REJEUX) {
      const appel = appelDe(e.ordre) as Appel
      if (!Array.isArray(appel.lignes) || appel.lignes.length === 0 || appel.lignes.length > LIGNES_PAR_IMPORT_MAX) continue
      // L'état d'avant cette étape : celui que le rejeu a construit jusqu'à elle — rejoué ici depuis le début.
      const avant = etatAvant(e.num)
      const premier = refusDesLignes(appel.dossier, articles.get(appel.dossier) ?? null, appel.lignes, avant).find((r) => r) ?? null
      expect(premier, e.num).toEqual(refus)
      compares++
    }
    expect(compares).toBeGreaterThanOrEqual(35)
  })
})

// L'état du dossier de l'étape `num`, juste avant elle : les contacts des étapes gardées ET acceptées qui la précèdent (une
// étape gardée que la base refuse ne range rien).
function etatAvant(num: string): ContactPourSiret[] {
  const contacts: ContactPourSiret[] = []
  const cible = appelDe(etape(num).ordre) as Appel
  for (const e of ETAPES) {
    if (e.num === num) break
    if (e.genre !== 'fait' || e.code !== 'OK') continue
    const appel = appelDe(e.ordre)
    if (!appel || appel.dossier !== cible.dossier) continue
    const lignes = (appel.fonction === 'enregistrer_contact' ? [appel.lignes] : appel.lignes) as { nom: string; siret?: string }[]
    for (const [i, l] of lignes.entries()) {
      contacts.push({ id: `${e.num}-${i + 1}`, dossier_id: appel.dossier, siret: l.siret ?? null, nom: l.nom, retire_le: null })
    }
  }
  return contacts
}

// ── 3. Ce que le module lit, comme la base le lit ────────────────────────────────────────────────────────────────────

const DA = 'DA'
const LIGNE = { nom: 'Société Essai', type_client: 'assujetti', adresse: 'Adresse fictive' }
const PARTICULIER = { nom: 'Particulier Essai', type_client: 'non_assujetti', adresse: 'Adresse fictive' }
const premier = (lignes: unknown, contacts: readonly ContactPourSiret[] = [], article: ArticleExoneration | null = null) =>
  refusImportContacts(DA, article, lignes, contacts)
const pourSiret = (o: Partial<ContactPourSiret> & { id: string }): ContactPourSiret => ({
  dossier_id: DA, siret: null, nom: 'Société Essai', retire_le: null, ...o,
})

describe('l’import entier : un tableau, d’au moins une ligne, de mille lignes au plus', () => {
  it('un import juste passe : aucun refus', () => {
    expect(premier([LIGNE, PARTICULIER])).toBeNull()
  })

  it('ce qui n’est pas un tableau — un objet, un texte, un nombre, nul, indéfini — est refusé, sans ligne', () => {
    for (const valeur of [LIGNE, 'Essai', 12, null, undefined]) {
      expect(premier(valeur), String(valeur)).toEqual({ cle: 'pas_un_tableau', ligne: null, code: '22023', message: REFUS_DE_L_IMPORT[1].modele })
    }
  })

  it('un tableau vide est refusé', () => {
    expect(premier([])).toEqual({ cle: 'vide', ligne: null, code: '22023', message: "L'import ne porte aucune ligne." })
  })

  it('la borne est comprise : mille lignes passent, mille et une non — la borne avant les lignes', () => {
    const lignes = (n: number) => Array.from({ length: n }, (_, i) => ({ ...PARTICULIER, nom: `Particulier ${i + 1}` }))
    expect(premier(lignes(LIGNES_PAR_IMPORT_MAX))).toBeNull()
    expect(premier(lignes(LIGNES_PAR_IMPORT_MAX + 1))).toEqual({
      cle: 'trop_de_lignes', ligne: null, code: '22023',
      message: `Un import range mille lignes au plus ; celui-ci en porte ${LIGNES_PAR_IMPORT_MAX + 1} : le partager en plusieurs fichiers.`,
    })
    expect(premier(['pas un objet', ...lignes(LIGNES_PAR_IMPORT_MAX)])?.cle).toBe('trop_de_lignes')
  })
})

describe('une ligne : un objet, aux champs d’un contact, puis ce qu’enregistrer_contact refuse', () => {
  it('une ligne qui n’est pas un objet : « Ligne N : », comptée depuis un', () => {
    for (const ligne of ['Essai', ['Essai'], null, 7]) {
      expect(premier([LIGNE, ligne]), String(ligne)).toEqual({
        cle: 'pas_un_objet', ligne: 2, code: '22023', message: "Ligne 2 : Une ligne de l'import est un objet JSON aux champs d'un contact.",
      })
    }
  })

  it('l’aller-retour par JSON : une ligne indéfinie devient nulle, une clé indéfinie disparaît, NaN devient nul', () => {
    // Le tableau entier est jugé tel qu'il part : un objet qui s'écrit en tableau (`toJSON`) en est un pour la base.
    expect(premier({ toJSON: () => [LIGNE] })).toBeNull()
    expect(premier({ toJSON: () => 'texte' })?.cle).toBe('pas_un_tableau')
    expect(premier([LIGNE, undefined])?.cle).toBe('pas_un_objet')
    expect(premier([{ ...LIGNE, telephone: undefined }])).toBeNull()
    expect(premier([{ ...LIGNE, delai_paiement_jours: Number.NaN }])).toBeNull()
  })

  it('un champ qu’un contact n’a pas se nomme ; « id » n’en est pas un : l’import ne vise aucun contact existant', () => {
    expect(premier([{ ...LIGNE, telephone: '0000000000' }])?.message).toBe("Ligne 1 : « telephone » n'est pas un champ d'un contact.")
    expect(premier([{ ...LIGNE, id: 'c4b30000-0000-4000-8000-000000000001' }])?.message).toBe("Ligne 1 : « id » n'est pas un champ d'un contact.")
  })

  it('le premier champ inconnu dans l’ordre des points de code — celui des octets de la base, quelle que soit sa collation', () => {
    // La majuscule avant la minuscule : l'ordre d'une collation de langue mettrait « fax » d'abord.
    expect(premier([{ ...LIGNE, telephone: '0', fax: '0', Naissance: '0' }])?.message).toBe("Ligne 1 : « Naissance » n'est pas un champ d'un contact.")
    // U+FFFD avant U+1F600 : en unités UTF-16, la comparaison de JavaScript rangerait l'émoji d'abord.
    expect(premier([{ ...LIGNE, '\u{1F600}': '0', '�': '0' }])?.message).toBe("Ligne 1 : « � » n'est pas un champ d'un contact.")
    // Un préfixe avant ce qu'il commence.
    expect(premier([{ ...LIGNE, telephones: '0', telephone: '0' }])?.message).toBe("Ligne 1 : « telephone » n'est pas un champ d'un contact.")
  })

  it('un champ inconnu de plus de quatre-vingts caractères se nomme coupé, comme un contact dans un refus — par point de code', () => {
    const cle = (n: number, c = 'x') => c.repeat(n)
    expect(NOM_DANS_UN_REFUS_MAX).toBe(80)
    expect(premier([{ ...LIGNE, [cle(80)]: '0' }])?.message).toBe(`Ligne 1 : « ${cle(80)} » n'est pas un champ d'un contact.`)
    expect(premier([{ ...LIGNE, [cle(81)]: '0' }])?.message).toBe(`Ligne 1 : « ${cle(79)}… » n'est pas un champ d'un contact.`)
    expect(premier([{ ...LIGNE, [cle(81, '\u{1F600}')]: '0' }])?.message)
      .toBe(`Ligne 1 : « ${cle(79, '\u{1F600}')}… » n'est pas un champ d'un contact.`)
  })

  it('le champ inconnu avant ce qu’enregistrer_contact refuse ; puis ses refus, sous ses mots et son code', () => {
    expect(premier([{ type_client: 'inconnu', telephone: '0' }])?.cle).toBe('champ_inconnu')
    const refus = premier([LIGNE, { ...LIGNE, email: 'pas une adresse' }]) as RefusImportContacts
    const modele = REFUS_ENREGISTREMENT_CONTACT.find((r) => r.cle === 'email_invalide') as (typeof REFUS_ENREGISTREMENT_CONTACT)[number]
    expect(refus).toEqual({ cle: 'email_invalide', ligne: 2, code: modele.code, message: `Ligne 2 : ${modele.modele}` })
  })

  it('une clé absente vaut nul : le nom, l’adresse et le type manquants se refusent sous les mots d’enregistrer_contact', () => {
    expect(premier([{ type_client: 'assujetti', adresse: 'Adresse fictive' }])?.message).toBe('Ligne 1 : Le nom du contact est à renseigner.')
    expect(premier([{ nom: 'Essai', type_client: 'assujetti' }])?.message).toBe("Ligne 1 : L'adresse du contact est à renseigner.")
    expect(premier([{ nom: 'Essai', adresse: 'Adresse fictive' }])?.cle).toBe('type_inconnu')
  })

  it('une ligne se juge à son rang, contre les contacts vus jusqu’à elle', () => {
    expect(refusDUneLigne(DA, null, LIGNE, 7, [])).toBeNull()
    expect(refusDUneLigne(DA, null, 'Essai', 7, [])?.message).toBe("Ligne 7 : Une ligne de l'import est un objet JSON aux champs d'un contact.")
    const vu = pourSiret({ id: 'ligne 3 de l’import', siret: '12345678200010', nom: 'Ligne trois' })
    expect(refusDUneLigne(DA, null, { ...LIGNE, siren: '123456782', siret: '12345678200010' }, 12, [vu])?.message)
      .toBe("Ligne 12 : Le SIRET « 12345678200010 » est déjà celui du contact « Ligne trois » : un établissement ne se range qu'une fois par dossier.")
  })

  it('le premier refus du fichier l’emporte', () => {
    const refus = premier([LIGNE, { ...LIGNE, email: 'x' }, { ...LIGNE, siren: '987654321' }])
    expect([refus?.ligne, refus?.cle]).toEqual([2, 'email_invalide'])
  })

  it('la règle des soins : un particulier ou un client établi hors de France, dans un dossier de soins', () => {
    const soins: ArticleExoneration = 'cgi_261_4_1'
    expect(premier([LIGNE, PARTICULIER], [], soins)?.cle).toBe('soins_particulier')
    expect(premier([LIGNE, { ...LIGNE, type_client: 'etranger' }], [], soins)?.cle).toBe('soins_etranger')
    expect(premier([{ ...PARTICULIER, siren: '111111118' }], [], soins)).toBeNull()
  })
})

describe('le SIRET d’une ligne : contre la liste lue, augmentée des lignes qui la précèdent', () => {
  const AVEC_SIRET = { ...LIGNE, siren: '123456782', siret: '12345678200010' }

  it('un SIRET porté par un contact lu : le contact nommé, dit retiré s’il l’est', () => {
    expect(premier([PARTICULIER, AVEC_SIRET], [pourSiret({ id: 'c1', siret: '12345678200010', nom: 'Contact lu' })]))
      .toEqual({
        cle: 'siret_pris', ligne: 2, code: '23505',
        message: "Ligne 2 : Le SIRET « 12345678200010 » est déjà celui du contact « Contact lu » : un établissement ne se range qu'une fois par dossier.",
      })
    expect(premier([AVEC_SIRET], [pourSiret({ id: 'c1', siret: '12345678200010', nom: 'Contact lu', retire_le: '2026-10-15T08:00:00Z' })])?.message)
      .toContain('« Contact lu » (retiré) :')
    // Le SIRET d'un autre dossier ne compte pas.
    expect(premier([AVEC_SIRET], [pourSiret({ id: 'c1', siret: '12345678200010', dossier_id: 'DB' })])).toBeNull()
  })

  it('un SIRET déjà porté par une ligne précédente du même import : le nom de cette ligne, coupé comme la base le coupe', () => {
    const long = 'N'.repeat(100)
    const refus = premier([{ ...AVEC_SIRET, nom: long }, PARTICULIER, { ...AVEC_SIRET, nom: 'Autre' }])
    expect([refus?.ligne, refus?.code]).toEqual([3, '23505'])
    expect(refus?.message).toBe(`Ligne 3 : Le SIRET « 12345678200010 » est déjà celui du contact « ${'N'.repeat(79)}… » : un établissement ne se range qu'une fois par dossier.`)
  })

  it('une ligne sans SIRET ne prend le SIRET de personne', () => {
    expect(premier([AVEC_SIRET, { ...LIGNE, siren: '123456782' }, PARTICULIER])).toBeNull()
  })
})

describe('refusDesLignes : chaque ligne, comme si les lignes refusées avant elle étaient ôtées', () => {
  const AVEC_SIRET = { ...LIGNE, siren: '123456782', siret: '12345678200010' }

  it('une ligne par ligne ; une ligne refusée ne compte pas pour les suivantes, une ligne acceptée compte', () => {
    const AUTRE = { ...LIGNE, siren: '987654324', siret: '98765432400019' }
    const refus = refusDesLignes(DA, null, [AVEC_SIRET, { ...AUTRE, email: 'x' }, AUTRE, AVEC_SIRET, PARTICULIER, 'texte'], [])
    // La ligne 2 est refusée (son e-mail) : son SIRET n'est pas rangé, la ligne 3 le prend ; la ligne 4 reprend celui de la 1.
    expect(refus.map((r) => r?.cle ?? null)).toEqual([null, 'email_invalide', null, 'siret_pris', null, 'pas_un_objet'])
    expect(refus.map((r) => r?.ligne ?? null)).toEqual([null, 2, null, 4, null, 6])
    // La ligne 2, refusée, ne range pas son SIRET : sans la ligne 1, la ligne 3 passerait.
    expect(refusDesLignes(DA, null, [{ ...AVEC_SIRET, email: 'x' }, AVEC_SIRET], []).map((r) => r?.cle ?? null)).toEqual(['email_invalide', null])
  })

  it('son premier refus est celui de l’import ; elle ne juge ni le tableau, ni le vide, ni la borne', () => {
    const lignes = [PARTICULIER, { ...LIGNE, type_client: 'entreprise' }, AVEC_SIRET]
    expect(refusDesLignes(DA, null, lignes, []).find((r) => r)).toEqual(premier(lignes))
    expect(refusDesLignes(DA, null, [], [])).toEqual([])
  })
})

// ── 4. Le drapeau et l'export ─────────────────────────────────────────────────────────────────────────────────────────

describe('IMPORT_CONTACTS_EXPORTE dit ce que porte l’export', () => {
  const portee = fichiersDuSchema().some((f) => /create function public\.importer_contacts\(/.test(f.texte))

  it('le drapeau, et la migration avec lui', () => {
    expect(portee, 'IMPORT_CONTACTS_EXPORTE ne dit plus ce que porte l’export').toBe(IMPORT_CONTACTS_EXPORTE)
  })

  // La migration elle-même, dès qu'elle est dans l'export : UN fichier, à la version que l'historique lui a donnée.
  const migration = () => {
    const schema = new URL('../../supabase/schema/', import.meta.url)
    const noms = readdirSync(schema).filter((nom) => /^\d{14}_importer_contacts\.sql$/.test(nom))
    expect(noms, 'la migration importer_contacts doit être UNE dans l’export').toHaveLength(1)
    return readFileSync(new URL(noms[0], schema), 'utf8')
  }
  const messagesSql = (texte: string) => [...texte.matchAll(/raise exception '((?:[^']|'')*)'/g)].map((m) => sansDoubles(m[1]))
  const codesSql = (texte: string) => [...texte.matchAll(/using errcode = '(\w+)'/g)].map((m) => m[1])

  it('exportée, la fonction dit les refus du module, dans le même ordre et sous les mêmes codes, puis « Ligne N : »', () => {
    if (!IMPORT_CONTACTS_EXPORTE) return
    const corps = derniereDefinitionSql('importer_contacts')
    expect(messagesSql(corps)).toEqual([...[...REFUS_DE_L_IMPORT, ...REFUS_D_UNE_LIGNE].map((r): string => r.modele), 'Ligne % : %'])
    expect(codesSql(corps)).toEqual([...REFUS_DE_L_IMPORT, ...REFUS_D_UNE_LIGNE].map((r) => r.code))
    expect(corps).toContain("raise exception 'Ligne % : %', v_ligne, v_message using errcode = v_code;")
    expect(PREFIXE_D_UNE_LIGNE).toBe('Ligne % : ')
  })

  it('exportée, ses valeurs sont celles du module : la borne, les champs, l’ordre des octets, le nom coupé', () => {
    if (!IMPORT_CONTACTS_EXPORTE) return
    const corps = derniereDefinitionSql('importer_contacts')
    expect([...corps.matchAll(/jsonb_array_length\(p_contacts\) > (\d+)/g)].map((m) => Number(m[1]))).toEqual([LIGNES_PAR_IMPORT_MAX])
    const champs = [...(/k not in \(([^)]*)\)/.exec(corps)?.[1] ?? '').matchAll(/'(\w+)'/g)].map((m) => m[1])
    expect(champs).toEqual([...CHAMPS_D_UNE_LIGNE])
    expect(corps).toContain('select min(k collate "C") into v_cle from jsonb_object_keys(v_contact) as k')
    expect(corps).toContain(`case when char_length(v_cle) > ${NOM_DANS_UN_REFUS_MAX} then left(v_cle, ${NOM_DANS_UN_REFUS_MAX - 1}) || '…' else v_cle end`)
    // Chaque ligne par enregistrer_contact, un contact NEUF : l'import ne vise aucun contact existant.
    expect(corps).toContain('select c.id into v_id from public.enregistrer_contact(p_dossier_id, null, v_contact) c;')
  })

  it('exportée, qui l’exécute : les connectés, l’accès d’abord ; rien n’y retire quoi que ce soit, rien n’y est écrit en direct', () => {
    if (!IMPORT_CONTACTS_EXPORTE) return
    const texte = migration()
    expect(texte).toContain('revoke execute on function public.importer_contacts(uuid, jsonb) from public, anon;')
    expect(texte).toContain('grant execute on function public.importer_contacts(uuid, jsonb) to authenticated;')
    expect(derniereDefinitionSql('importer_contacts'))
      .toMatch(/\$\$\ndeclare[\s\S]*?\nbegin\n(?: {2}--[^\n]*\n)* {2}if not public\.gere_les_ventes\(p_dossier_id\) or not exists/)
    const instructions = texte.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')
    expect(instructions).not.toMatch(/\b(delete|drop|truncate|insert|update|alter)\b/i)
    expect([...texte.matchAll(/create (or replace )?(function|table|policy|trigger)\b/g)].map((m) => m[2])).toEqual(['function'])
  })
})

describe('le refus du seul nombre de lignes (ajouté pour l’écran, étape A4b3b)', () => {
  it('celui de `refusImportContacts` sur un tableau de cette longueur : aucune ligne, plus de mille ; rien entre les deux', () => {
    const lignes = (n: number) => Array.from({ length: n }, () => ({}))
    for (const n of [0, 1, LIGNES_PAR_IMPORT_MAX, LIGNES_PAR_IMPORT_MAX + 1, 2500]) {
      const attendu = n === 0 || n > LIGNES_PAR_IMPORT_MAX ? refusImportContacts('d1', null, lignes(n), []) : null
      expect(refusDuNombreDeLignes(n), String(n)).toEqual(attendu)
    }
    expect(refusDuNombreDeLignes(0)?.cle).toBe('vide')
    expect(refusDuNombreDeLignes(LIGNES_PAR_IMPORT_MAX + 1)?.message).toContain('celui-ci en porte 1001')
  })
})
