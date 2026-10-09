import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import type { FacturePourStatutRecu, MontantRecu } from './cdarRecu'
import { tirage } from '../test/encaissementsBatterie'
import { ECHOS_RECUS, EXEMPLES_RECUS, SIREN_VENDEUR_RECU, echoRecu, factureRecue, messageRecu } from '../test/cdarRecu'
import { fichiersDuSchema } from '../test/schema'

// `pointDeReprise` vit dans le module de la réception, qui parle à Supabase : on le confronte sans réseau.
vi.mock('./supabase', () => ({ supabase: {} }))
vi.mock('./factureX', () => ({ xmlDuFacturX: async () => ({ refus: 'aucune facture structurée' }) }))
const { pointDeReprise } = await import('./receptionPlateforme')

// LE RELEVÉ DES STATUTS DU CYCLE DE VIE DES FACTURES ÉMISES (`plateforme-agreee`, action « relever », ligne 28.5, étape
// d7) SE TESTE SUR SA VRAIE SOURCE, comme le reste de la fonction (plateformeAgreee.test.ts) : le bloc CYCLE DE VIE est
// EXTRAIT, transpilé et EXÉCUTÉ avec les blocs dont il se sert et les copies de src/lib — contre une base jouée en
// mémoire et une plateforme jouée par un faux `fetch`, sans aucun réseau. Les messages sont les statuts FICTIFS
// d'outils/facturation/cdar/recus/, qui passent au schéma CDAR D22B. Puis le CÂBLAGE de l'action, qui ne s'exécute pas
// ici : il se lit sur la source.

const SOURCE = readFileSync(new URL('../../supabase/functions/plateforme-agreee/index.ts', import.meta.url), 'utf8')

function bloc(nom: string): string {
  const debut = SOURCE.indexOf(`// ── DÉBUT ${nom} `)
  const fin = SOURCE.indexOf(`// ── FIN ${nom} `)
  expect(debut, `bornes « ${nom} » introuvables — garde-fou à remettre à jour`).toBeGreaterThan(-1)
  expect(fin).toBeGreaterThan(debut)
  return SOURCE.slice(debut, SOURCE.indexOf('\n', fin) + 1)
}

/**
 * Des blocs SEULS, transpilés et exécutés : tout nom qu'ils emprunteraient au reste du fichier lèverait. Les copies de
 * src/lib exportent leurs noms (en CommonJS, sur `exports`) ; les blocs de la fonction les gardent pour eux, et la
 * fabrique les rend nommément.
 */
function executer<T>(texte: string, noms: string[]): T {
  const js = ts.transpileModule(texte, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const exports: Record<string, unknown> = {}
  const locaux = new Function('exports', `${js}\nreturn { ${noms.join(', ')} }`)(exports) as Record<string, unknown>
  return { ...exports, ...locaux } as T
}

// ── Les types, tels que le bloc les rend ─────────────────────────────────────────────────────────────────────────

interface FluxDeStatut { id: string; recu_le: string | null; mis_a_jour: string; etat: 'pret' | 'en_attente' | 'en_erreur' }
interface ReponseFichier { statut: number; octets: Uint8Array | null; tropLourd: boolean; redirectionRefusee: boolean }
interface ReponseJson { statut: number; donnees: unknown; redirection: boolean }
interface Demande { updatedAfter: string | null; cursor: string | null }
interface LigneStatut {
  facture_id: string; flux_id: string; code: string; message_id: string | null; emis_le: string | null
  createur_role: string | null; date_statut: string | null; motifs: string | null; commentaire: string | null
  montants: MontantRecu[]
}
interface DetailStatut { reference: string; date_objet: string | null; motifs: string | null; commentaire: string | null }
type IssueStatut =
  | { flux: string; issue: 'garde'; facture_id: string; code: string; avertissements: string[] }
  | { flux: string; issue: 'deja_lu' }
  | { flux: string; issue: 'ecarte'; ecart: string; raison: string; code: string | null; detail: DetailStatut | null }
  | { flux: string; issue: 'echec'; raison: string; statut_http: number | null }
interface Dependances {
  page: (demande: Demande) => Promise<unknown>
  telecharger: (fluxId: string) => Promise<ReponseFichier>
  dejaLus: (fluxIds: string[]) => Promise<Set<string> | null>
  factureDuNumero: (numero: string) => Promise<{ facture: FacturePourStatutRecu | null } | { erreur: string }>
  ecrire: (ligne: LigneStatut) => Promise<'ecrit' | 'deja' | { refus: string } | { erreur: string }>
  maintenant: () => number
}
interface Bornes {
  taillePage: number; maxFlux: number; maxPages: number; echeanceRecherche: number; echeanceTelechargements: number
  maxTelechargements: number; maxOctets: number
}
interface Releve {
  issues: IssueStatut[]; ecartes: Record<string, number>; en_attente: number; en_erreur: number; reportes: number
  pages: number; complete: boolean; motif: string | null; jusqua: string | null
}
interface ClientPlateforme {
  jeton: () => Promise<unknown>
  appelJson: (methode: 'GET' | 'POST', chemin: string, corps?: unknown) => Promise<ReponseJson>
  fichier: (chemin: string) => Promise<ReponseFichier>
}

const B = executer<{
  fluxDeCycleDeVie: (brut: unknown) => { flux: FluxDeStatut } | { ecarte: string; misAJour: number | null }
  LECTURE_STATUTS: { objets: string; apresPlafond: string; relance: string }
  plateformeDuReleve: (plateforme: ClientPlateforme, taillePage: number) => Pick<Dependances, 'page' | 'telecharger'>
  releverStatuts: (deps: Dependances, depuis: string | null, siren: string | null, bornes: Bornes) => Promise<Releve>
  repriseDesStatuts: (recherche: { flux: { mis_a_jour: string }[]; jusqua: string | null }, restes: { mis_a_jour: string }[]) => string | null
  compteDuReleve: (r: Releve) => Record<string, number | string>
  clientPlateforme: (config: Record<string, unknown>, recuperer: (url: string, init: RequestInit) => Promise<Response>,
    options: { delaiMs: number; maxJson: number; maxFichier: number; maxRedirections: number }) => ClientPlateforme
  ErreurDePage: new (r: ReponseJson) => Error & { reponse: ReponseJson }
}>(
  ['ADRESSES', 'JETON', 'FLUX', 'RECHERCHE', 'FICHIER', 'HTTP', 'ERREURS', 'CYCLE DE VIE', 'COPIE montantsFacture',
    'COPIE statutTva', 'COPIE factureCii', 'COPIE cdarRecu'].map(bloc).join('\n'),
  ['fluxDeCycleDeVie', 'LECTURE_STATUTS', 'plateformeDuReleve', 'releverStatuts', 'repriseDesStatuts', 'compteDuReleve',
    'clientPlateforme', 'ErreurDePage'],
)

// ── Les flux, les messages, la base ────────────────────────────────────────────────────────────────────────────────

const T = (minute: number) => `2027-10-08T09:${String(minute).padStart(2, '0')}:00.000Z`

/** Un flux de la liste, tel que banqup le décrit (schéma `Flow`) : un statut du cycle de vie d'une facture émise, prêt. */
function statut(id: string, minute: number, o: Record<string, unknown> = {}) {
  return {
    flowId: id, flowType: 'CustomerInvoiceLC', flowDirection: 'In', flowSyntax: 'CDAR', flowProfile: 'Undefined',
    name: `${id}.xml`, processingRule: 'B2B', processingRuleSource: 'Computed', submittedAt: T(minute), updatedAt: T(minute),
    acknowledgement: { status: 'Ok' }, ...o,
  }
}

const octets = (texte: string) => new TextEncoder().encode(texte)
const fichier = (texte: string): ReponseFichier => ({ statut: 200, octets: octets(texte), tropLourd: false, redirectionRefusee: false })
const sans = (statutHttp: number): ReponseFichier => ({ statut: statutHttp, octets: null, tropLourd: false, redirectionRefusee: false })

const REFUS = messageRecu('refus-210.xml')
const REJET = messageRecu('rejet-213.xml')
const LITIGE = messageRecu('litige-207.xml')
const PAIEMENT = messageRecu('paiement-211.xml')
const REJET_601 = messageRecu('rejet-601.xml')
// Le refus d'une facture d'une AUTRE entreprise, que l'identité ouverte au cabinet sert aussi.
const AUTRE_VENDEUR = REFUS.replace(
  '<ram:GlobalID schemeID="0002">123456782</ram:GlobalID>\n        <ram:GlobalID schemeID="0009">12345678200010</ram:GlobalID>',
  '<ram:GlobalID schemeID="0002">111111118</ram:GlobalID>',
)

// Les factures validées du dossier : celles que les exemples désignent.
const FACTURES = [
  factureRecue(),
  factureRecue({ id: 'facture-43', numero: 'F2027-0043' }),
  factureRecue({ id: 'facture-44', numero: 'F2027-0044', date_emission: '2027-10-05' }),
]

/** La base, jouée en mémoire : les statuts déjà gardés, les factures du dossier, et ce que la base répondrait. */
function base(o: {
  dejaGardes?: string[]; dejaLusInconnus?: boolean; factureEnErreur?: boolean
  ecrire?: (ligne: LigneStatut) => 'ecrit' | 'deja' | { refus: string } | { erreur: string }
} = {}) {
  const lignes: LigneStatut[] = []
  const numeros: string[] = []
  const gardes = new Set(o.dejaGardes ?? [])
  return {
    lignes,
    numeros,
    dejaLus: async (ids: string[]) => (o.dejaLusInconnus ? null : new Set(ids.filter((i) => gardes.has(i)))),
    factureDuNumero: async (numero: string) => {
      numeros.push(numero)
      if (o.factureEnErreur) return { erreur: 'la base ne répond pas' }
      return { facture: FACTURES.find((f) => f.numero === numero) ?? null }
    },
    ecrire: async (ligne: LigneStatut) => {
      const issue = o.ecrire ? o.ecrire(ligne) : gardes.has(ligne.flux_id) ? 'deja' : 'ecrit'
      if (issue === 'ecrit') {
        gardes.add(ligne.flux_id)
        lignes.push(ligne)
      }
      return issue
    },
  }
}

/** Une plateforme jouée au niveau des dépendances : ses pages, puis l'original de chaque statut. */
function plateforme(pages: unknown[], fichiers: Record<string, ReponseFichier>) {
  const demandes: Demande[] = []
  const telecharges: string[] = []
  return {
    demandes,
    telecharges,
    page: async (demande: Demande) => {
      demandes.push(demande)
      if (pages.length === 0) throw new Error('page de trop demandée')
      return pages.shift()
    },
    telecharger: async (fluxId: string) => {
      telecharges.push(fluxId)
      return fichiers[fluxId] ?? sans(404)
    },
  }
}

const BORNES: Bornes = {
  taillePage: 10, maxFlux: 100, maxPages: 20, echeanceRecherche: Number.POSITIVE_INFINITY,
  echeanceTelechargements: Number.POSITIVE_INFINITY, maxTelechargements: 50, maxOctets: 1_000_000,
}

async function relever(
  p: ReturnType<typeof plateforme>, b: ReturnType<typeof base>, o: { depuis?: string | null; siren?: string | null; bornes?: Partial<Bornes>; maintenant?: () => number } = {},
) {
  return B.releverStatuts({ page: p.page, telecharger: p.telecharger, dejaLus: b.dejaLus, factureDuNumero: b.factureDuNumero,
    ecrire: b.ecrire, maintenant: o.maintenant ?? (() => 0) }, o.depuis ?? null, o.siren === undefined ? SIREN_VENDEUR_RECU : o.siren,
  { ...BORNES, ...o.bornes })
}

const issuesDe = (r: Releve) => r.issues.map((i) => `${i.flux}:${i.issue}${'ecart' in i ? `:${i.ecart}` : ''}`)

// ── Le flux d'un statut ────────────────────────────────────────────────────────────────────────────────────────────

describe('plateforme-agreee — un flux de la liste, lu comme un statut du cycle de vie', () => {
  it('un statut prêt, en attente ou rejeté par la plateforme : son identifiant, ses dates, son état', () => {
    expect(B.fluxDeCycleDeVie(statut('s1', 1))).toEqual({ flux: { id: 's1', recu_le: T(1), mis_a_jour: T(1), etat: 'pret' } })
    expect(B.fluxDeCycleDeVie(statut('s1', 1, { acknowledgement: { status: 'Pending' } }))).toMatchObject({ flux: { etat: 'en_attente' } })
    expect(B.fluxDeCycleDeVie(statut('s1', 1, { acknowledgement: { status: 'Error' } }))).toMatchObject({ flux: { etat: 'en_erreur' } })
    expect(B.fluxDeCycleDeVie(statut('s1', 1, { submittedAt: 'hier' }))).toMatchObject({ flux: { recu_le: null } })
  })

  it('écarte, en comptant : un autre type, un statut que le vendeur a émis, une autre syntaxe, l’illisible, l’inconnu', () => {
    const cas: [Record<string, unknown>, string][] = [
      [{ flowType: 'CustomerInvoice' }, 'autre_flux'],
      [{ flowType: 'SupplierInvoiceLC' }, 'autre_flux'],
      [{ flowType: 'StateCustomerInvoiceLC' }, 'autre_flux'],
      [{ flowType: undefined }, 'autre_flux'],
      [{ flowDirection: 'Out' }, 'autre_flux'],
      [{ flowDirection: undefined }, 'autre_flux'],
      [{ flowId: 'un flux' }, 'illisible'],
      [{ flowId: 'f'.repeat(201) }, 'illisible'],
      [{ flowId: 42 }, 'illisible'],
      [{ updatedAt: '2027-02-30T09:00:00Z' }, 'illisible'],
      [{ flowSyntax: 'CII' }, 'format'],
      [{ flowSyntax: undefined }, 'format'],
      [{ acknowledgement: { status: 'Ok?' } }, 'statut_inconnu'],
      [{ acknowledgement: null }, 'statut_inconnu'],
    ]
    for (const [o, ecart] of cas) expect(B.fluxDeCycleDeVie(statut('s1', 1, o)), JSON.stringify(o)).toMatchObject({ ecarte: ecart })
    // L'instant d'un flux écarté compte encore pour le point de reprise.
    expect(B.fluxDeCycleDeVie(statut('s1', 7, { flowSyntax: 'UBL' }))).toEqual({ ecarte: 'format', misAJour: Date.parse(T(7)) })
    expect(B.fluxDeCycleDeVie(null)).toEqual({ ecarte: 'autre_flux', misAJour: null })
  })

  it('les mots d’un arrêt de la recherche parlent de statuts et de lecture', () => {
    expect(B.LECTURE_STATUTS).toMatchObject({ objets: 'statuts', apresPlafond: 'relancez la lecture pour la suite', relance: 'relancez la lecture' })
  })
})

// ── Le relevé ──────────────────────────────────────────────────────────────────────────────────────────────────────

describe('plateforme-agreee — le relevé des statuts', () => {
  it('lit chaque statut prêt, le rattache à SA facture et l’écrit une fois, champ par champ', async () => {
    const p = plateforme([{ results: [statut('s210', 1), statut('s213', 2), statut('s207', 3), statut('s211', 4)] }], {
      s210: fichier(REFUS), s213: fichier(REJET), s207: fichier(LITIGE), s211: fichier(PAIEMENT),
    })
    const b = base()
    const r = await relever(p, b, { depuis: T(0) })
    expect(issuesDe(r)).toEqual(['s210:garde', 's213:garde', 's207:garde', 's211:garde'])
    expect(r).toMatchObject({ complete: true, motif: null, jusqua: T(4), reportes: 0, en_attente: 0, en_erreur: 0, pages: 1 })
    expect(p.demandes).toEqual([{ updatedAfter: T(0), cursor: null }])
    expect(b.lignes.map((l) => [l.flux_id, l.facture_id, l.code])).toEqual([
      ['s210', 'facture-42', '210'], ['s213', 'facture-43', '213'], ['s207', 'facture-44', '207'], ['s211', 'facture-42', '211'],
    ])
    // Ce que la ligne porte est ce que le message dit, tel que le module le lit — rien de plus, rien d'autre.
    const lu = EXEMPLES_RECUS.find((e) => e.fichier === 'refus-210.xml')!.lu
    expect(b.lignes[0]).toEqual({
      facture_id: 'facture-42', flux_id: 's210', code: '210', message_id: lu.messageId, emis_le: lu.emisLe,
      createur_role: lu.createurRole, date_statut: lu.dateStatut, motifs: lu.motifs, commentaire: lu.commentaire, montants: [],
    })
    expect(b.lignes[3].montants).toEqual([{ code: 'MPA', montant: '1200.00', devise: 'EUR', taux: null, date: '2027-10-13' }])
    expect(r.issues[0]).toEqual({ flux: 's210', issue: 'garde', facture_id: 'facture-42', code: '210', avertissements: [] })
  })

  it('les échos d’un statut « Encaissée » (212) se gardent aussi, montants par taux compris', async () => {
    const p = plateforme([{ results: ECHOS_RECUS.map((_, i) => statut(`e${i}`, i + 1)) }],
      Object.fromEntries(ECHOS_RECUS.map((e, i) => [`e${i}`, fichier(echoRecu(e.fichier))])))
    const b = base()
    const r = await relever(p, b)
    expect(issuesDe(r)).toEqual(['e0:garde', 'e1:garde', 'e2:garde'])
    expect(b.lignes.map((l) => l.montants)).toEqual(ECHOS_RECUS.map((e) => e.lu.montants))
  })

  it('les lignes écrites portent les colonnes de la table, et l’appelant y ajoute le dossier, l’hôte et le lecteur', () => {
    const migration = fichiersDuSchema().find((f) => f.texte.includes('create table public.statuts_factures_recus ('))?.texte ?? ''
    const corps = migration.slice(migration.indexOf('create table public.statuts_factures_recus ('), migration.indexOf('\n);', migration.indexOf('create table public.statuts_factures_recus (')))
    const colonnes = [...corps.matchAll(/^ {2}([a-z_]+) /gm)].map((m) => m[1]).filter((c) => c !== 'constraint')
    expect(colonnes).toContain('facture_id')
    const ecrites = ['facture_id', 'flux_id', 'code', 'message_id', 'emis_le', 'createur_role', 'date_statut', 'motifs', 'commentaire', 'montants']
    // `id` et `lu_le` prennent leur valeur par défaut : l'instant de la lecture est celui de la base.
    expect([...ecrites, 'dossier_id', 'hote', 'lu_par'].sort()).toEqual(colonnes.filter((c) => c !== 'id' && c !== 'lu_le').sort())
    const cycle = bloc('CYCLE DE VIE')
    for (const c of ecrites) expect(cycle, c).toMatch(new RegExp(`^ {2}${c}: `, 'm'))
  })

  it('un statut déjà gardé ne se télécharge pas ; un flux que la base reconnaît à l’écriture est « déjà lu »', async () => {
    const p = plateforme([{ results: [statut('s210', 1), statut('s213', 2)] }], { s210: fichier(REFUS), s213: fichier(REJET) })
    const b = base({ dejaGardes: ['s210'] })
    const r = await relever(p, b)
    expect(issuesDe(r)).toEqual(['s210:deja_lu', 's213:garde'])
    expect(p.telecharges).toEqual(['s213'])
    // On ne sait pas ce qui est déjà lu : tout se télécharge, et la base reconnaît le flux (23505).
    const p2 = plateforme([{ results: [statut('s210', 1)] }], { s210: fichier(REFUS) })
    const r2 = await relever(p2, base({ dejaGardes: ['s210'], dejaLusInconnus: true }))
    expect(issuesDe(r2)).toEqual(['s210:deja_lu'])
    expect(p2.telecharges).toEqual(['s210'])
    expect(r2).toMatchObject({ complete: true, jusqua: T(1) })
  })

  it('ce qui ne se rattache à rien ne s’écrit pas : il se dit, avec sa raison — un 601 du dossier, avec ce qu’il porte', async () => {
    const inconnue = REFUS.replace('<ram:IssuerAssignedID>F2027-0042</ram:IssuerAssignedID>', '<ram:IssuerAssignedID>F2027-0999</ram:IssuerAssignedID>')
    const p = plateforme([{ results: [statut('s601', 1), statut('autre', 2), statut('inconnue', 3), statut('pdf', 4), statut('vide', 5)] }], {
      s601: fichier(REJET_601), autre: fichier(AUTRE_VENDEUR), inconnue: fichier(inconnue), pdf: fichier('%PDF-1.7\n...'),
      vide: fichier('<?xml version="1.0"?><a/>'),
    })
    const b = base()
    const r = await relever(p, b)
    expect(issuesDe(r)).toEqual(['s601:ecarte:autre_objet', 'autre:ecarte:autre_vendeur', 'inconnue:ecarte:facture_inconnue',
      'pdf:ecarte:illisible', 'vide:ecarte:illisible'])
    expect(b.lignes).toEqual([])
    expect(r).toMatchObject({ complete: true, jusqua: T(5) })
    const lu601 = EXEMPLES_RECUS.find((e) => e.fichier === 'rejet-601.xml')!.lu
    expect(r.issues[0]).toEqual({
      flux: 's601', issue: 'ecarte', ecart: 'autre_objet', code: '601',
      raison: 'Un statut 601 porte sur un autre statut (un cycle de vie rejeté) : il ne désigne pas une facture.',
      detail: { reference: lu601.reference, date_objet: lu601.dateObjet, motifs: lu601.motifs, commentaire: lu601.commentaire },
    })
    // D'une autre entreprise : ni son numéro, ni son SIREN, ni rien de ce que son message porte.
    const autre = r.issues[1] as Extract<IssueStatut, { issue: 'ecarte' }>
    expect(autre.detail).toBeNull()
    expect(JSON.stringify(autre)).not.toMatch(/F2027|111111118|MONTANT|quantité/)
    expect((r.issues[2] as Extract<IssueStatut, { issue: 'ecarte' }>).raison).toBe('Aucune facture validée du dossier ne porte le numéro F2027-0999.')
    // Le numéro de la facture inconnue s'est cherché ; ceux du 601 et du PDF, non.
    expect(b.numeros).toEqual(['F2027-0042', 'F2027-0999'])
  })

  it('un code hors du tableau 8 pour une facture ne fait chercher aucune facture : il est écarté sans lecture en base', async () => {
    const s214 = REFUS.replace('<ram:ProcessConditionCode>210</ram:ProcessConditionCode>', '<ram:ProcessConditionCode>214</ram:ProcessConditionCode>')
    const sansSiren = REFUS.replace('<ram:GlobalID schemeID="0002">123456782</ram:GlobalID>\n        <ram:GlobalID schemeID="0009">', '<ram:GlobalID schemeID="0009">')
    const b = base()
    const r = await relever(plateforme([{ results: [statut('a', 1), statut('b', 2)] }], { a: fichier(s214), b: fichier(sansSiren) }), b)
    expect(issuesDe(r)).toEqual(['a:ecarte:statut_inconnu', 'b:ecarte:illisible'])
    expect(b.numeros).toEqual([])
  })

  it('un 601 qui ne concerne pas le dossier, ou un dossier sans SIREN, ne dit rien de ce qu’il porte', async () => {
    for (const siren of [null, '111111118']) {
      const p = plateforme([{ results: [statut('s601', 1)] }], { s601: fichier(REJET_601) })
      const r = await relever(p, base(), { siren })
      expect(r.issues[0], String(siren)).toMatchObject({ issue: 'ecarte', ecart: 'autre_objet', detail: null })
    }
  })

  it('un message illisible ou ambigu, trop lourd, introuvable, en UTF-16 ou refusé par la base : écarté pour de bon', async () => {
    const deuxCodes = REFUS.replace('<ram:ProcessConditionCode>210</ram:ProcessConditionCode>',
      '<ram:ProcessConditionCode>210</ram:ProcessConditionCode><ram:ProcessConditionCode>213</ram:ProcessConditionCode>')
    const utf16 = new Uint8Array([0xff, 0xfe, ...[...REFUS.slice(0, 200)].flatMap((c) => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8])])
    const latin1 = new Uint8Array([...octets('<?xml version="1.0"?><a>'), 0xe9, ...octets('</a>')])
    const p = plateforme([{ results: [1, 2, 3, 4, 5, 6, 7].map((m) => statut(`s${m}`, m)) }], {
      s1: fichier(deuxCodes), s2: { statut: 200, octets: null, tropLourd: true, redirectionRefusee: false },
      s3: fichier(`${REFUS}<!-- ${'x'.repeat(2_000)} -->`), s4: sans(404),
      s5: { statut: 200, octets: utf16, tropLourd: false, redirectionRefusee: false },
      s6: { statut: 200, octets: latin1, tropLourd: false, redirectionRefusee: false }, s7: fichier(REJET),
    })
    const b = base({ ecrire: () => ({ refus: 'Un statut lu désigne une facture validée de son dossier.' }) })
    const r = await relever(p, b, { bornes: { maxOctets: 2_000 + REFUS.length } })
    expect(issuesDe(r)).toEqual(['s1:ecarte:ambigu', 's2:ecarte:trop_lourd', 's3:ecarte:trop_lourd', 's4:ecarte:introuvable',
      's5:ecarte:illisible', 's6:ecarte:illisible', 's7:ecarte:refuse'])
    expect(r.issues[6]).toMatchObject({ raison: 'Un statut lu désigne une facture validée de son dossier.', code: '213' })
    expect((r.issues[5] as Extract<IssueStatut, { issue: 'ecarte' }>).raison).toBe('Le message n\'est pas écrit en UTF-8.')
    // Tous traités pour de bon : le point de reprise passe.
    expect(r).toMatchObject({ complete: true, jusqua: T(7) })
  })

  it('un échec passager retient le point de reprise avant le premier statut qu’il touche ; les suivants se lisent quand même', async () => {
    const p = plateforme([{ results: [statut('a', 1), statut('b', 2), statut('c', 3), statut('d', 4)] }], {
      a: fichier(REFUS), b: sans(503), c: fichier(REJET), d: { statut: 302, octets: null, tropLourd: false, redirectionRefusee: true },
    })
    const b = base()
    const r = await relever(p, b)
    expect(issuesDe(r)).toEqual(['a:garde', 'b:echec', 'c:garde', 'd:echec'])
    expect(r.issues[1]).toEqual({ flux: 'b', issue: 'echec', raison: 'La plateforme a répondu 503 (téléchargement d\'un statut).', statut_http: 503 })
    expect(r.issues[3]).toMatchObject({ statut_http: 302, raison: 'La plateforme renvoie ce statut vers une adresse que la fonction ne suit pas.' })
    expect(r).toMatchObject({ complete: false, jusqua: T(1), motif: 'des statuts n\'ont pas pu être lus : relancez la lecture pour les reprendre' })
    expect(p.telecharges).toEqual(['a', 'b', 'c', 'd'])
  })

  it('une facture qu’on ne peut pas chercher, une écriture qui échoue : des échecs passagers, eux aussi', async () => {
    const r1 = await relever(plateforme([{ results: [statut('a', 1), statut('b', 2)] }], { a: fichier(REFUS), b: fichier(REJET) }),
      base({ factureEnErreur: true }))
    expect(issuesDe(r1)).toEqual(['a:echec', 'b:echec'])
    expect(r1.issues[0]).toMatchObject({ raison: 'La facture que ce statut désigne n\'a pas pu être cherchée (la base ne répond pas).', statut_http: null })
    expect(r1).toMatchObject({ complete: false, jusqua: null })
    const r2 = await relever(plateforme([{ results: [statut('a', 1)] }], { a: fichier(REFUS) }), base({ ecrire: () => ({ erreur: 'délai dépassé' }) }))
    expect(r2.issues[0]).toMatchObject({ issue: 'echec', raison: 'Le statut n\'a pas pu être enregistré (délai dépassé).' })
  })

  it('un accès refusé par la plateforme arrête le relevé : les statuts suivants attendent le prochain', async () => {
    const p = plateforme([{ results: [statut('a', 1), statut('b', 2), statut('c', 3)] }], { a: fichier(REFUS), b: sans(403), c: fichier(REJET) })
    const r = await relever(p, base())
    expect(issuesDe(r)).toEqual(['a:garde', 'b:echec'])
    expect(p.telecharges).toEqual(['a', 'b'])
    expect(r.motif).toMatch(/^La plateforme refuse l'accès \(téléchargement d'un statut, 403\)/)
    expect(r).toMatchObject({ complete: false, reportes: 1, jusqua: T(1) })
  })

  it('cinquante statuts au plus, et rien après l’échéance : le reste attend, le point de reprise s’arrête avant', async () => {
    const quatre = () => plateforme([{ results: [statut('a', 1), statut('b', 2), statut('c', 3), statut('d', 4)] }],
      { a: fichier(REFUS), b: fichier(REJET), c: fichier(LITIGE), d: fichier(PAIEMENT) })
    const p = quatre()
    const r = await relever(p, base(), { bornes: { maxTelechargements: 2 } })
    expect(issuesDe(r)).toEqual(['a:garde', 'b:garde'])
    expect(r).toMatchObject({ complete: false, reportes: 2, jusqua: T(2), motif: 'plus de 2 statuts à lire à la fois : relancez la lecture pour la suite' })
    // Un statut déjà gardé ne compte pas dans le nombre : il ne se télécharge pas.
    const r2 = await relever(quatre(), base({ dejaGardes: ['a', 'b'] }), { bornes: { maxTelechargements: 2 } })
    expect(issuesDe(r2)).toEqual(['a:deja_lu', 'b:deja_lu', 'c:garde', 'd:garde'])
    expect(r2.complete).toBe(true)
    let horloge = 0
    const p3 = quatre()
    const r3 = await relever(p3, base(), { bornes: { echeanceTelechargements: 1 }, maintenant: () => horloge++ })
    expect(issuesDe(r3)).toEqual(['a:garde', 'b:garde'])
    expect(r3).toMatchObject({ complete: false, reportes: 2, motif: 'le temps d\'un appel est écoulé : relancez la lecture pour la suite' })
  })

  it('les statuts se lisent dans l’ordre de leur date, quel que soit celui de la page', async () => {
    const p = plateforme([{ results: [statut('c', 3), statut('a', 1), statut('b', 1)] }], { a: fichier(REFUS), b: fichier(REJET), c: sans(503) })
    const r = await relever(p, base())
    expect(p.telecharges).toEqual(['a', 'b', 'c'])
    // Une page dans le désordre mais complète : le point de reprise ne dépasse pas le premier statut resté à faire.
    expect(r).toMatchObject({ complete: false, jusqua: T(1) })
  })

  it('un statut que la plateforme n’a pas fini de traiter, ou qu’elle a rejeté, ne retient rien et ne se télécharge pas', async () => {
    const p = plateforme([{ results: [statut('a', 1, { acknowledgement: { status: 'Pending' } }), statut('b', 2, { acknowledgement: { status: 'Error' } }), statut('c', 3)] }],
      { c: fichier(REFUS) })
    const r = await relever(p, base())
    expect(issuesDe(r)).toEqual(['c:garde'])
    expect(p.telecharges).toEqual(['c'])
    expect(r).toMatchObject({ complete: true, en_attente: 1, en_erreur: 1, jusqua: T(3) })
  })

  it('la recherche : statuts entrants seulement, page à page ; un flux écarté compte pour la reprise ; une recherche incomplète le dit', async () => {
    const p = plateforme([{ results: [statut('a', 1), statut('x', 5, { flowType: 'SupplierInvoiceLC' }), statut('y', 6, { flowSyntax: 'UBL' })] }], { a: fichier(REFUS) })
    const r = await relever(p, base(), { bornes: { taillePage: 10 } })
    expect(r).toMatchObject({ complete: true, jusqua: T(6) })
    expect(r.ecartes).toEqual({ autre_flux: 1, illisible: 0, format: 1, statut_inconnu: 0, doublons: 0 })
    const plein = plateforme([{ results: [statut('a', 1), statut('b', 2), statut('c', 3)], nextCursor: 'k1' }], { a: fichier(REFUS), b: fichier(REJET), c: fichier(LITIGE) })
    const r2 = await relever(plein, base(), { bornes: { taillePage: 3, maxFlux: 3 } })
    expect(r2).toMatchObject({ complete: false, jusqua: T(2), motif: 'plus de 3 statuts à la fois : relancez la lecture pour la suite' })
    expect(issuesDe(r2)).toEqual(['a:garde', 'b:garde', 'c:garde'])
    // Rien de lu, rien à retenir ; et la base n'est pas interrogée pour une liste vide.
    let interrogee = false
    const vide = base()
    const r3 = await B.releverStatuts({ ...plateforme([{ results: [] }], {}), dejaLus: async (ids) => { interrogee = true; return vide.dejaLus(ids) },
      factureDuNumero: vide.factureDuNumero, ecrire: vide.ecrire, maintenant: () => 0 }, null, SIREN_VENDEUR_RECU, BORNES)
    expect(r3).toMatchObject({ complete: true, jusqua: null, issues: [] })
    expect(interrogee).toBe(false)
  })

  it('une page refusée LÈVE : le gestionnaire dit le refus, et rien n’a été écrit', async () => {
    const b = base()
    const page = async () => { throw new B.ErreurDePage({ statut: 401, donnees: null, redirection: false }) }
    await expect(B.releverStatuts({ page, telecharger: async () => sans(404), dejaLus: b.dejaLus, factureDuNumero: b.factureDuNumero,
      ecrire: b.ecrire, maintenant: () => 0 }, null, SIREN_VENDEUR_RECU, BORNES)).rejects.toMatchObject({ reponse: { statut: 401 } })
    expect(b.lignes).toEqual([])
  })
})

// ── Le point de reprise, confronté à celui de la réception ────────────────────────────────────────────────────────

describe('plateforme-agreee — le point de reprise des statuts suit la règle de la réception', () => {
  it('rend ce que rend `pointDeReprise` (src/lib/receptionPlateforme.ts) sur 5 000 listes tirées au sort', () => {
    const suivant = tirage(9102027)
    const entier = (n: number) => Math.floor(suivant() * n)
    let plusieurs = 0
    for (let k = 0; k < 5_000; k++) {
      const n = entier(8)
      const flux = Array.from({ length: n }, (_, i) => ({
        id: `f${i}`, sens: 'vente' as const, syntaxe: 'CDAR', direction: 'In' as const, nom: null, recu_le: null,
        mis_a_jour: T(entier(6)), etat: 'pret' as const,
      }))
      const jusqua = entier(4) === 0 ? null : T(entier(7))
      const restes = flux.filter(() => entier(3) === 0)
      if (restes.length > 1) plusieurs++
      const liste = { hote: 'pa.exemple.fr', version: 'v1', depuis: null, flux, ecartes: { autre_flux: 0, illisible: 0, format: 0, statut_inconnu: 0, doublons: 0 }, complete: true, motif: null, jusqua }
      expect(B.repriseDesStatuts({ flux, jusqua }, restes), JSON.stringify({ jusqua, flux: flux.map((f) => f.mis_a_jour), restes: restes.map((f) => f.mis_a_jour) }))
        .toBe(pointDeReprise(liste, restes))
    }
    expect(plusieurs).toBeGreaterThan(500)
  })
})

// ── Le journal ─────────────────────────────────────────────────────────────────────────────────────────────────────

describe('plateforme-agreee — ce que le journal dit d’un relevé', () => {
  it('des nombres, et les codes HTTP des échecs : ni flux, ni numéro, ni nom, ni montant', async () => {
    const p = plateforme([{ results: [statut('s210', 1), statut('b', 2), statut('c', 3), statut('d', 4, { acknowledgement: { status: 'Pending' } })] }],
      { s210: fichier(REFUS), b: sans(503), c: sans(0) })
    const r = await relever(p, base())
    const compte = B.compteDuReleve(r)
    expect(compte).toEqual({ pages: 1, gardes: 1, dejaLus: 0, ecartes: 0, echecs: 2, enAttente: 1, reportes: 0, codes: '0,503' })
    for (const [cle, valeur] of Object.entries(compte)) {
      expect(typeof valeur === 'number' || /^(aucun|\d+(,\d+)*)$/.test(valeur), cle).toBe(true)
    }
    expect(B.compteDuReleve({ ...r, issues: [] }).codes).toBe('aucun')
    // Les flux que la recherche a écartés (un autre type, un autre format) comptent parmi les écartés.
    const p2 = plateforme([{ results: [statut('x', 1, { flowType: 'SupplierInvoiceLC' }), statut('y', 2, { flowSyntax: 'UBL' }), statut('z', 3, { flowId: 'un flux' })] }], {})
    expect(B.compteDuReleve(await relever(p2, base())).ecartes).toBe(3)
  })
})

// ── Par le vrai client HTTP, contre un faux `fetch` ────────────────────────────────────────────────────────────────

const CONFIG_PA = {
  url_flux: 'https://pa.exemple.fr/afnor', url_jeton: 'https://pa.exemple.fr/oauth2/token', client_id: 'cabinet',
  client_secret: 'secret', organisation_id: 'ORG-1', portee: null,
}
const OPTIONS = { delaiMs: 5_000, maxJson: 100_000, maxFichier: 100_000, maxRedirections: 3 }
const reponseJson = (statutHttp: number, corps: unknown) =>
  new Response(JSON.stringify(corps), { status: statutHttp, headers: { 'content-type': 'application/json' } })

/** Une plateforme jouée au niveau du réseau : le jeton, la recherche, puis l'original de chaque flux. */
function reseau(pages: unknown[], originaux: Record<string, string>) {
  const appels: { methode: string; url: string; corps: unknown; entetes: Record<string, string> }[] = []
  const recuperer = async (url: string, init: RequestInit) => {
    const entetes = (init.headers ?? {}) as Record<string, string>
    appels.push({ methode: String(init.method), url, corps: typeof init.body === 'string' && url.endsWith('/search') ? JSON.parse(init.body) : null, entetes })
    if (url === CONFIG_PA.url_jeton) return reponseJson(200, { access_token: 'jeton-fictif', token_type: 'Bearer' })
    if (url === `${CONFIG_PA.url_flux}/v1/flows/search`) return reponseJson(200, pages.shift() ?? { results: [] })
    const m = /\/v1\/flows\/([^?]+)\?docType=Original$/.exec(url)
    if (m && originaux[decodeURIComponent(m[1])] !== undefined) return new Response(originaux[decodeURIComponent(m[1])], { status: 200 })
    return reponseJson(404, { errorCode: 'MISSING_RESOURCE' })
  }
  return { appels, recuperer }
}

describe('plateforme-agreee — le relevé, par le client d’une plateforme', () => {
  it('cherche les statuts entrants des factures émises, télécharge leur original et les garde', async () => {
    const r = reseau([{ results: [statut('s/210', 1), statut('s213', 2)] }], { 's/210': REFUS, s213: REJET })
    const client = B.clientPlateforme(CONFIG_PA, r.recuperer, OPTIONS)
    await client.jeton()
    const b = base()
    const releve = await B.releverStatuts({ ...B.plateformeDuReleve(client, 100), dejaLus: b.dejaLus,
      factureDuNumero: b.factureDuNumero, ecrire: b.ecrire, maintenant: () => 0 }, T(0), SIREN_VENDEUR_RECU, BORNES)
    expect(issuesDe(releve)).toEqual(['s/210:garde', 's213:garde'])
    expect(r.appels.map((a) => `${a.methode} ${a.url}`)).toEqual([
      'POST https://pa.exemple.fr/oauth2/token',
      'POST https://pa.exemple.fr/afnor/v1/flows/search',
      'GET https://pa.exemple.fr/afnor/v1/flows/s%2F210?docType=Original',
      'GET https://pa.exemple.fr/afnor/v1/flows/s213?docType=Original',
    ])
    // Le filtre que publie banqup (`SearchFlowFilters`) : le type et le sens, la date de reprise, cent par page.
    expect(r.appels[1].corps).toEqual({ where: { flowType: ['CustomerInvoiceLC'], flowDirection: ['In'], updatedAfter: T(0) }, limit: 100 })
    expect(r.appels[2].entetes).toMatchObject({ Authorization: 'Bearer jeton-fictif', 'Organization-Id': 'ORG-1' })
  })

  it('suit le curseur publié, et une page refusée lève avec la réponse de la plateforme', async () => {
    const r = reseau([{ results: [statut('a', 1)], nextCursor: 'k1' }, { results: [statut('b', 2)] }], { a: REFUS, b: REJET })
    const client = B.clientPlateforme(CONFIG_PA, r.recuperer, OPTIONS)
    await client.jeton()
    const dep = B.plateformeDuReleve(client, 1)
    expect(await dep.page({ updatedAfter: null, cursor: null })).toMatchObject({ nextCursor: 'k1' })
    await dep.page({ updatedAfter: null, cursor: 'k1' })
    expect(r.appels.filter((a) => a.url.endsWith('/search')).map((a) => a.corps)).toEqual([
      { where: { flowType: ['CustomerInvoiceLC'], flowDirection: ['In'] }, limit: 1 },
      { where: { flowType: ['CustomerInvoiceLC'], flowDirection: ['In'] }, limit: 1, cursor: 'k1' },
    ])
    const refus = B.plateformeDuReleve({ ...client, appelJson: async () => ({ statut: 403, donnees: { errorCode: 'FORBIDDEN_ACCESS' }, redirection: false }) }, 1)
    await expect(refus.page({ updatedAfter: null, cursor: null })).rejects.toMatchObject({ reponse: { statut: 403 } })
    const redirige = B.plateformeDuReleve({ ...client, appelJson: async () => ({ statut: 200, donnees: null, redirection: true }) }, 1)
    await expect(redirige.page({ updatedAfter: null, cursor: null })).rejects.toBeInstanceOf(B.ErreurDePage)
  })
})

// ── Le câblage de l'action ─────────────────────────────────────────────────────────────────────────────────────────

const GESTIONNAIRE = SOURCE.slice(SOURCE.indexOf('Deno.serve('))

function brancheDe(action: string): string {
  const debut = GESTIONNAIRE.indexOf(`if (action === "${action}") {`)
  expect(debut, `branche « ${action} » introuvable`).toBeGreaterThan(-1)
  let profondeur = 0
  for (let i = GESTIONNAIRE.indexOf('{', debut); i < GESTIONNAIRE.length; i++) {
    if (GESTIONNAIRE[i] === '{') profondeur++
    else if (GESTIONNAIRE[i] === '}') { profondeur--; if (profondeur === 0) return GESTIONNAIRE.slice(debut, i + 1) }
  }
  throw new Error('accolades non appariées')
}

describe('plateforme-agreee — le câblage de « relever »', () => {
  const branche = brancheDe('relever')
  const position = (texte: string) => {
    const i = branche.indexOf(texte)
    expect(i, `${texte} introuvable dans « relever »`).toBeGreaterThan(-1)
    return i
  }

  it('est une action de la fonction, sur clic, qui ne demande pas la version de la connexion', () => {
    expect(SOURCE).toMatch(/const ACTIONS = \[\n {2}"statut", [^\]]*"suivre", "relever",\n\]/)
    expect(GESTIONNAIRE).toContain('const versionPerimee = (action === "telecharger" || action === "retenir" || action === "repartir" || action === "deposer") &&')
    // La plateforme s'ouvre une fois, après le contrôle d'accès et la lecture de la connexion — le tronc commun.
    expect(GESTIONNAIRE.indexOf('if (action === "relever") {')).toBeGreaterThan(GESTIONNAIRE.indexOf('const acces = await plateforme.jeton()\n  if ("refus" in acces) return refusDuJeton(acces)\n\n  if (action === "tester")'))
    expect(branche).not.toMatch(/ouvrirPlateforme\(|clientPlateforme\(|fetch\(/)
  })

  it('lit le SIREN du dossier, vérifie sa lecture, puis relève — et ne rend la lecture qu’au clic « depuis le début »', () => {
    const etapes = [
      'const depuisLeDebut = payload.depuisLeDebut === true',
      'const { data: dossierLu, error: erreurDossier } = await admin.from("dossiers")\n      .select("siret").eq("id", dossierId).maybeSingle()',
      'if (erreurDossier || !dossierLu) {',
      'const actuel = depuisLeDebut ? null : connexion.cycle_vie_depuis',
      'releve = await releverStatuts({',
      'const retenu = curseurRetenu(actuel, releve.jusqua, Date.now())',
      '.update({ cycle_vie_depuis: retenu.curseur, ...(luLe ? { cycle_vie_lu_le: luLe } : {}) })',
      'return json({\n      hote,',
    ].map(position)
    expect(etapes).toEqual([...etapes].sort((a, b) => a - b))
    expect(branche).toContain('}, depuis === null ? null : isoMs(depuis), sirenDe(dossierLu.siret), {')
    expect(branche).toContain('const luLe = releve.complete ? new Date().toISOString() : null')
  })

  it('n’écrit que pour le dossier vérifié et l’hôte de sa connexion, et tient le flux pour l’identité du statut', () => {
    expect(branche).toContain('.select("flux_id", { count: "exact" }).eq("dossier_id", dossierId).eq("hote", hote).in("flux_id", fluxIds)')
    expect(branche).toContain('if (error || !lus || count !== lus.length) return null')
    expect(branche).toContain('.eq("dossier_id", dossierId).eq("numero", numero).maybeSingle()')
    // Les valeurs de l'appelant passent APRÈS la ligne : une clé de même nom venue du message ne les remplacerait pas.
    expect(branche).toContain('.insert({ ...ligne, dossier_id: dossierId, hote, lu_par: utilisateur })')
    expect(branche).toContain('if (error.code === "23505") return "deja"')
    expect(branche).toContain('if (error.code === "23514") return { refus: error.message }')
    expect(branche).toContain('.eq("dossier_id", dossierId).eq("updated_at", connexion.updated_at).select("dossier_id").maybeSingle()')
  })

  it('les budgets tiennent sous le mur de 150 s : la recherche à 40 s, aucun téléchargement après 95 s, chacun sous 25 s', () => {
    const constante = (nom: string) => Number((new RegExp(`const ${nom} = ([\\d_]+)\\n`).exec(SOURCE) as RegExpExecArray)[1].replace(/_/g, ''))
    expect(constante('BUDGET_RECHERCHE_STATUTS_MS')).toBe(40_000)
    expect(constante('BUDGET_TELECHARGEMENTS_STATUTS_MS')).toBe(95_000)
    expect(constante('MAX_STATUTS')).toBe(50)
    expect(constante('MAX_STATUT_OCTETS')).toBe(1_000_000)
    expect(constante('BUDGET_TELECHARGEMENTS_STATUTS_MS') + constante('DELAI_APPEL_MS') + 10_000).toBeLessThan(150_000)
    expect(branche).toContain('echeanceRecherche: debut + BUDGET_RECHERCHE_STATUTS_MS')
    expect(branche).toContain('echeanceTelechargements: debut + BUDGET_TELECHARGEMENTS_STATUTS_MS, maxTelechargements: MAX_STATUTS')
    expect(branche).toContain('maxOctets: MAX_STATUT_OCTETS')
  })

  it('une page refusée se dit en français, sans écho de la réponse ; une interruption aussi', () => {
    expect(branche).toContain('const erreur = erreurPlateforme("recherche des statuts", e.reponse)')
    expect(branche).toContain('return json({ error: "La lecture des statuts s\'est interrompue : réessayez." }, 500)')
  })
})
