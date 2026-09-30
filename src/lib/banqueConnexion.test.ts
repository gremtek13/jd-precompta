import { createHash, generateKeyPairSync, verify as verifierSignature } from 'node:crypto'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'

// LA CONNEXION BANCAIRE (`banque-connexion`, ligne 24 de la feuille de route) SE TESTE SUR SA VRAIE SOURCE.
//
// Une Edge Function ne s'appelle pas depuis ce dépôt, et celle-ci parle à un prestataire qu'aucun test ne
// joint. Ce qui décide de sa justesse vit donc dans quatre blocs bornés (`── DÉBUT/FIN …`), qu'on EXTRAIT
// de la vraie source, qu'on transpile avec le compilateur du projet et qu'on EXÉCUTE — l'idiome
// d'`extractPiecePagination` et d'`extractPieceAppelant` :
//   - JETON         la signature RS256 de chaque appel, vérifiée ici avec la clé PUBLIQUE d'une vraie
//                   paire RSA générée pour l'essai — une signature fausse serait refusée par le prestataire,
//                   et rien d'autre ne le dirait avant le premier clic du cabinet ;
//   - MOUVEMENTS    ce qu'un mouvement de banque devient : son signe, son montant au centime, sa période,
//                   son libellé, et l'identifiant externe qui le dédoublonne d'une récupération à l'autre ;
//   - PAGES BANQUE  la lecture page à page et ses trois bornes ;
//   - RÈGLES        les comptes retenus, la durée d'accord, la période demandée, ce que voit l'écran.
// Puis le CÂBLAGE du gestionnaire, qui ne s'exécute pas ici : l'ordre des contrôles se lit sur la source,
// comme pour `extract-piece`.

const SOURCE = readFileSync(new URL('../../supabase/functions/banque-connexion/index.ts', import.meta.url), 'utf8')

function bloc(nom: string): string {
  const debut = SOURCE.indexOf(`// ── DÉBUT ${nom} `)
  const fin = SOURCE.indexOf(`// ── FIN ${nom} `)
  expect(debut, `bornes « ${nom} » introuvables — garde-fou à remettre à jour`).toBeGreaterThan(-1)
  expect(fin).toBeGreaterThan(debut)
  return SOURCE.slice(debut, fin)
}

/** Le bloc SEUL, transpilé et exécuté : tout nom qu'il emprunterait au reste du fichier lèverait. */
function executer<T>(texte: string, noms: string[]): T {
  const js = ts.transpileModule(texte, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(`${js}\nreturn { ${noms.join(', ')} }`)() as T
}

// ── JETON ────────────────────────────────────────────────────────────────────────────────────────────

const { jetonApplication, derDepuisPem } = executer<{
  jetonApplication: (pem: string, applicationId: string, maintenantS: number) => Promise<string>
  derDepuisPem: (pem: string) => Uint8Array
}>(bloc('JETON'), ['jetonApplication', 'derDepuisPem'])

const paire = generateKeyPairSync('rsa', { modulusLength: 2048 })
const PKCS8 = paire.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
const PKCS1 = paire.privateKey.export({ type: 'pkcs1', format: 'pem' }) as string
const corpsSeul = (pem: string) => pem.split('\n').filter((l) => l !== '' && !l.startsWith('-----')).join('')

function lireJeton(jeton: string) {
  const parties = jeton.split('.')
  expect(parties).toHaveLength(3)
  const [entete, corps, signature] = parties
  return {
    parties,
    entete: JSON.parse(Buffer.from(entete, 'base64url').toString('utf8')),
    corps: JSON.parse(Buffer.from(corps, 'base64url').toString('utf8')),
    signatureValide: verifierSignature('sha256', Buffer.from(`${entete}.${corps}`), paire.publicKey,
      Buffer.from(signature, 'base64url')),
  }
}

describe('banque-connexion — le jeton qui signe chaque appel', () => {
  it('signe en RS256 un jeton que la clé PUBLIQUE vérifie, avec les revendications du prestataire', async () => {
    const lu = lireJeton(await jetonApplication(PKCS8, 'application-fictive', 1_000_000))
    expect(lu.signatureValide).toBe(true)
    expect(lu.entete).toEqual({ typ: 'JWT', alg: 'RS256', kid: 'application-fictive' })
    expect(lu.corps).toEqual({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: 1_000_000, exp: 1_003_600 })
  })

  it('reste sous les 24 heures qu’admet le prestataire, et s’écrit en base64url sans remplissage', async () => {
    const lu = lireJeton(await jetonApplication(PKCS8, 'application-fictive', 1_000_000))
    expect(lu.corps.exp - lu.corps.iat).toBeLessThanOrEqual(86_400)
    expect(lu.corps.exp).toBeGreaterThan(lu.corps.iat)
    for (const partie of lu.parties) expect(partie).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('une signature d’une AUTRE clé ne passe pas — le garde symétrique de la vérification', async () => {
    // Sans lui, « la signature se vérifie » serait satisfait par un vérificateur qui accepte tout.
    const autre = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const jeton = await jetonApplication(autre.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, 'x', 1)
    expect(lireJeton(jeton).signatureValide).toBe(false)
  })

  it('une clé PKCS#1 est enveloppée en PKCS#8 à l’octet près, et signe de même', async () => {
    expect(Buffer.from(derDepuisPem(PKCS1))).toEqual(Buffer.from(derDepuisPem(PKCS8)))
    expect(lireJeton(await jetonApplication(PKCS1, 'x', 1)).signatureValide).toBe(true)
  })

  it('tolère les « \\n » écrits, les fins de ligne Windows, les blancs autour et une clé réduite à son corps', async () => {
    const variantes = [
      PKCS8.replace(/\n/g, '\\n'),
      PKCS8.replace(/\n/g, '\r\n'),
      `  \n${PKCS8}\n  `,
      corpsSeul(PKCS8),
      corpsSeul(PKCS1),
      PKCS1.replace(/\n/g, '\\n'),
    ]
    for (const pem of variantes) {
      expect(lireJeton(await jetonApplication(pem, 'x', 1)).signatureValide, JSON.stringify(pem.slice(0, 40))).toBe(true)
    }
  })

  it('refuse une clé chiffrée ou d’un autre algorithme, en le disant', async () => {
    expect(() => derDepuisPem('-----BEGIN ENCRYPTED PRIVATE KEY-----\nMIIBvTBXBgkqhkiG\n-----END ENCRYPTED PRIVATE KEY-----'))
      .toThrow(/pas une clé RSA en clair/)
    const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    expect(() => derDepuisPem(ec.privateKey.export({ type: 'sec1', format: 'pem' }) as string)).toThrow(/pas une clé RSA en clair/)
    // Une clé EC au format PKCS#8 a la structure attendue : c'est l'import RSA qui la refuse, et le jeton avec lui.
    await expect(jetonApplication(ec.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, 'x', 1)).rejects.toThrow()
  })

  it('refuse ce qui n’est pas une clé privée — un texte, une clé PUBLIQUE, rien — en disant quoi coller', () => {
    const publique = paire.publicKey.export({ type: 'spki', format: 'pem' }) as string
    for (const faux of ['', 'bonjour', '-----BEGIN PRIVATE KEY-----\n-----END PRIVATE KEY-----', publique, 'QUJD']) {
      expect(() => derDepuisPem(faux), JSON.stringify(faux.slice(0, 30))).toThrow(/illisible.*\.pem/)
    }
  })
})

// ── MOUVEMENTS ───────────────────────────────────────────────────────────────────────────────────────

interface Mouvement { id_externe: string; date: string; libelle: string; montant: number }
interface Ecartes { non_comptabilises: number; autre_devise: number; hors_periode: number; illisibles: number; doublons: number }

const { mouvementsDuCompte, centimesDe } = executer<{
  mouvementsDuCompte: (t: unknown[], empreinte: string, du: string, au: string) => Promise<{ mouvements: Mouvement[]; ecartes: Ecartes }>
  centimesDe: (montant: unknown) => number | null
}>(bloc('MOUVEMENTS'), ['mouvementsDuCompte', 'centimesDe'])

const EMPREINTE = 'WwpbCiJhY2NvdW50Ii5maWN0aWYiXQpd.Q29tcHRlRmljdGlmPQ=='
const AUTRE_COMPTE = 'WwpbCiJhdXRyZSJdCl0=.QXV0cmVDb21wdGU='
const sha = (texte: string) => createHash('sha256').update(texte, 'utf8').digest('hex')

/** Un mouvement comptabilisé de 12,34 € payé à un fournisseur fictif — chaque test le déforme. */
function transaction(o: Record<string, unknown> = {}) {
  return {
    entry_reference: 'REF-1',
    transaction_amount: { currency: 'EUR', amount: '12.34' },
    credit_debit_indicator: 'DBIT',
    status: 'BOOK',
    booking_date: '2026-06-02',
    value_date: '2026-06-03',
    transaction_date: '2026-06-01',
    remittance_information: ['PRLV SEPA FOURNISSEUR FICTIF', 'FACTURE 42'],
    creditor: { name: 'Fournisseur Fictif' },
    debtor: { name: 'Cabinet Fictif' },
    ...o,
  }
}

const lire = (transactions: unknown[], du = '2026-01-01', au = '2026-12-31', empreinte = EMPREINTE) =>
  mouvementsDuCompte(transactions, empreinte, du, au)

describe('banque-connexion — un mouvement de banque devient une ligne de relevé', () => {
  it('un paiement est NÉGATIF, un encaissement positif — le sens vient de l’indicateur, pas du signe écrit', async () => {
    const { mouvements } = await lire([
      transaction(),
      transaction({ entry_reference: 'REF-2', credit_debit_indicator: 'CRDT', transaction_amount: { currency: 'EUR', amount: '100.00' } }),
      transaction({ entry_reference: 'REF-3', transaction_amount: { currency: 'EUR', amount: '-5.00' } }),
    ])
    expect(mouvements.map((m) => m.montant)).toEqual([-12.34, 100, -5])
  })

  it('le montant se lit sur la chaîne, au centime, sans produit de flottants', () => {
    expect(centimesDe('12.34')).toBe(1234)
    expect(centimesDe('12.3')).toBe(1230)
    expect(centimesDe('7')).toBe(700)
    expect(centimesDe(' 0.1 ')).toBe(10)
    expect(centimesDe('1234567.89')).toBe(123456789)
    // 1.005 × 100 vaut 100,49999… en flottant : la chaîne, elle, dit 1,005, arrondi à 1,01.
    expect(centimesDe('1.005')).toBe(101)
    expect(centimesDe('1.004')).toBe(100)
    expect(centimesDe('-12.00')).toBe(1200)
    for (const illisible of ['12,34', 'abc', '', '1e3', '12.', 12.34, null, undefined]) {
      expect(centimesDe(illisible), String(illisible)).toBeNull()
    }
  })

  it('seuls les mouvements COMPTABILISÉS en euros et lisibles entrent — les autres sont comptés, un par motif', async () => {
    const { mouvements, ecartes } = await lire([
      transaction(),
      transaction({ entry_reference: 'P', status: 'PDNG' }),
      transaction({ entry_reference: 'H', status: 'HOLD' }),
      transaction({ entry_reference: 'S', status: undefined }),
      transaction({ entry_reference: 'U', transaction_amount: { currency: 'USD', amount: '12.34' } }),
      transaction({ entry_reference: 'I', credit_debit_indicator: undefined }),
      transaction({ entry_reference: 'M', transaction_amount: { currency: 'EUR', amount: 'douze' } }),
      transaction({ entry_reference: 'Z', transaction_amount: { currency: 'EUR', amount: '0.00' } }),
      transaction({ entry_reference: 'D', booking_date: null, value_date: '02/06/2026', transaction_date: undefined }),
      null,
    ])
    expect(mouvements).toHaveLength(1)
    expect(ecartes).toEqual({ non_comptabilises: 4, autre_devise: 1, hors_periode: 0, illisibles: 4, doublons: 0 })
  })

  it('la date est celle de comptabilisation, à défaut la date de valeur, puis celle de l’opération', async () => {
    const { mouvements } = await lire([
      transaction({ entry_reference: 'A' }),
      transaction({ entry_reference: 'B', booking_date: undefined }),
      transaction({ entry_reference: 'C', booking_date: undefined, value_date: undefined }),
    ])
    expect(mouvements.map((m) => m.date).sort()).toEqual(['2026-06-01', '2026-06-02', '2026-06-03'])
  })

  it('la période est REFILTRÉE : une banque qui ignore les dates ne fait pas entrer un autre mois', async () => {
    const { mouvements, ecartes } = await lire([
      transaction({ entry_reference: 'AVANT', booking_date: '2026-05-31' }),
      transaction({ entry_reference: 'DEBUT', booking_date: '2026-06-01' }),
      transaction({ entry_reference: 'FIN', booking_date: '2026-06-30' }),
      transaction({ entry_reference: 'APRES', booking_date: '2026-07-01' }),
    ], '2026-06-01', '2026-06-30')
    // Les deux bornes sont COMPRISES.
    expect(mouvements.map((m) => m.date)).toEqual(['2026-06-01', '2026-06-30'])
    expect(ecartes.hors_periode).toBe(2)
  })

  it('le libellé : le motif du paiement, puis la contrepartie quand elle n’y figure pas déjà', async () => {
    const { mouvements } = await lire([
      transaction({ entry_reference: '1', creditor: { name: 'Energie Fictive' } }),
      transaction({ entry_reference: '2', credit_debit_indicator: 'CRDT', remittance_information: ['VIR SEPA HONORAIRES'] }),
      transaction({ entry_reference: '3', remittance_information: ['PRLV FOURNISSEUR FICTIF'] }),
      transaction({ entry_reference: '4', remittance_information: [] }),
      transaction({ entry_reference: '5', remittance_information: undefined, creditor: null, bank_transaction_code: { description: 'Frais de tenue de compte' } }),
      transaction({ entry_reference: '6', remittance_information: ['  ', ''], creditor: {}, bank_transaction_code: null }),
      transaction({ entry_reference: '7', remittance_information: ['  CB   BOULANGERIE\n FICTIVE  '], creditor: null }),
      transaction({ entry_reference: '8' }),
    ])
    const libelles = Object.fromEntries(mouvements.map((m) => [m.id_externe, m.libelle]))
    const par = (reference: string) => libelles[`eb:r:${sha(`${EMPREINTE}|${reference}`)}`]
    expect(par('1')).toBe('PRLV SEPA FOURNISSEUR FICTIF FACTURE 42 — Energie Fictive')
    // Un ENCAISSEMENT nomme le payeur (débiteur), pas le bénéficiaire.
    expect(par('2')).toBe('VIR SEPA HONORAIRES — Cabinet Fictif')
    // Déjà dans le motif, sans égard à la casse : pas répété.
    expect(par('3')).toBe('PRLV FOURNISSEUR FICTIF')
    expect(par('8')).toBe('PRLV SEPA FOURNISSEUR FICTIF FACTURE 42')
    expect(par('4')).toBe('Fournisseur Fictif')
    expect(par('5')).toBe('Frais de tenue de compte')
    expect(par('6')).toBe('Mouvement bancaire')
    expect(par('7')).toBe('CB BOULANGERIE FICTIVE')
  })

  it('un libellé démesuré est borné à 500 caractères', async () => {
    const { mouvements } = await lire([transaction({ remittance_information: ['X'.repeat(800)], creditor: null })])
    expect(mouvements[0].libelle).toHaveLength(500)
  })

  it('avec la référence de la banque, l’identifiant est celle-ci PRÉFIXÉE de l’empreinte du compte', async () => {
    const [ici, ailleurs] = await Promise.all([lire([transaction()]), lire([transaction()], undefined, undefined, AUTRE_COMPTE)])
    expect(ici.mouvements[0].id_externe).toBe(`eb:r:${sha(`${EMPREINTE}|REF-1`)}`)
    // La même référence sur un autre compte est un autre mouvement : la banque ne la garantit pas unique
    // d'un compte à l'autre.
    expect(ailleurs.mouvements[0].id_externe).not.toBe(ici.mouvements[0].id_externe)
    // Et relire redonne le même identifiant — c'est tout ce qui dédoublonne une récupération de la suivante.
    expect((await lire([transaction()])).mouvements[0].id_externe).toBe(ici.mouvements[0].id_externe)
  })

  it('un mouvement rendu deux fois par la banque n’entre qu’une fois, et le doublon est compté', async () => {
    const { mouvements, ecartes } = await lire([transaction(), transaction()])
    expect(mouvements).toHaveLength(1)
    expect(ecartes.doublons).toBe(1)
  })

  it('sans référence, deux mouvements identiques restent deux, et relire la période redonne les MÊMES', async () => {
    const cafe = () => transaction({ entry_reference: undefined, remittance_information: ['CB CAFE FICTIF'], creditor: null,
      transaction_amount: { currency: 'EUR', amount: '2.50' } })
    const premiere = await lire([cafe(), cafe(), transaction()])
    const ids = premiere.mouvements.map((m) => m.id_externe)
    expect(new Set(ids).size).toBe(3)
    expect(ids.filter((id) => id.startsWith('eb:e:'))).toHaveLength(2)
    // Relus dans un autre ordre : le même ENSEMBLE d'identifiants, donc aucun doublon à l'import.
    const seconde = await lire([transaction(), cafe(), cafe()])
    expect(new Set(seconde.mouvements.map((m) => m.id_externe))).toEqual(new Set(ids))
  })

  it('sans référence, l’identifiant ne tient qu’à ce que la banque a DONNÉ — la formule est figée ici', async () => {
    // Changer cette formule change l'identifiant de chaque mouvement sans référence : la récupération
    // suivante les réimporterait tous. Elle ne se touche qu'avec une reprise des identifiants.
    const { mouvements } = await lire([transaction({ entry_reference: '' })])
    const cle = [EMPREINTE, '2026-06-02', '-1234', 'PRLV SEPA FOURNISSEUR FICTIF\nFACTURE 42', 'Fournisseur Fictif'].join('|')
    expect(mouvements[0].id_externe).toBe(`eb:e:${sha(`${cle}|0`)}`)
  })

  it('rend du plus ancien au plus récent — la banque rend souvent l’inverse —, sans rien d’autre que quatre champs', async () => {
    const { mouvements } = await lire([
      transaction({ entry_reference: 'C', booking_date: '2026-06-03' }),
      transaction({ entry_reference: 'B2', booking_date: '2026-06-02', remittance_information: ['SECOND'] }),
      transaction({ entry_reference: 'B1', booking_date: '2026-06-02', remittance_information: ['PREMIER'] }),
      transaction({ entry_reference: 'A', booking_date: '2026-06-01' }),
    ])
    expect(mouvements.map((m) => m.date)).toEqual(['2026-06-01', '2026-06-02', '2026-06-02', '2026-06-03'])
    // À date égale, l'ordre de la banque est gardé.
    expect(mouvements[1].libelle.startsWith('SECOND')).toBe(true)
    for (const m of mouvements) expect(Object.keys(m).sort()).toEqual(['date', 'id_externe', 'libelle', 'montant'])
  })
})

// ── PAGES BANQUE ─────────────────────────────────────────────────────────────────────────────────────

type Lecture = { transactions: unknown[]; pages: number; complete: boolean; motif: string | null }
const { toutesLesPages } = executer<{
  toutesLesPages: (
    page: (cle: string | null) => Promise<unknown>,
    bornes: { maxPages: number; echeance: number; maintenant: () => number },
  ) => Promise<Lecture>
}>(bloc('PAGES BANQUE'), ['toutesLesPages'])

/** Un faux prestataire qui sert des pages dans l'ordre et note les clés qu'on lui présente. */
function serveur(pages: { transactions?: unknown; continuation_key?: unknown }[]) {
  const cles: (string | null)[] = []
  const page = vi.fn(async (cle: string | null) => {
    cles.push(cle)
    const reponse = pages[cles.length - 1]
    if (!reponse) throw new Error('page demandée au-delà de la dernière')
    return reponse
  })
  return { page, cles }
}
const SANS_LIMITE = { maxPages: 50, echeance: Number.POSITIVE_INFINITY, maintenant: () => 0 }

describe('banque-connexion — la lecture page à page', () => {
  it('une page sans clé de suite : lecture complète', async () => {
    const { page } = serveur([{ transactions: [1, 2] }])
    expect(await toutesLesPages(page, SANS_LIMITE)).toEqual({ transactions: [1, 2], pages: 1, complete: true, motif: null })
  })

  it('suit la clé de suite dans l’ordre, en commençant sans clé', async () => {
    const { page, cles } = serveur([
      { transactions: [1, 2], continuation_key: 'a' },
      { transactions: [3], continuation_key: 'b' },
      { transactions: [4], continuation_key: null },
    ])
    const lecture = await toutesLesPages(page, SANS_LIMITE)
    expect(lecture).toEqual({ transactions: [1, 2, 3, 4], pages: 3, complete: true, motif: null })
    expect(cles).toEqual([null, 'a', 'b'])
  })

  it('une page VIDE qui porte une clé de suite n’est pas la fin', async () => {
    const { page } = serveur([{ transactions: [], continuation_key: 'a' }, { transactions: [1] }])
    expect(await toutesLesPages(page, SANS_LIMITE)).toMatchObject({ transactions: [1], complete: true })
  })

  it('une clé de suite vide vaut la fin', async () => {
    const { page } = serveur([{ transactions: [1], continuation_key: '' }])
    expect(await toutesLesPages(page, SANS_LIMITE)).toMatchObject({ complete: true, pages: 1 })
  })

  it('une clé déjà servie rend la lecture INCOMPLÈTE au lieu de tourner sans fin', async () => {
    const { page, cles } = serveur([
      { transactions: [1], continuation_key: 'a' },
      { transactions: [2], continuation_key: 'b' },
      { transactions: [3], continuation_key: 'a' },
    ])
    const lecture = await toutesLesPages(page, SANS_LIMITE)
    expect(lecture).toMatchObject({ transactions: [1, 2, 3], complete: false })
    expect(lecture.motif).toMatch(/deux fois la même page/)
    expect(cles).toHaveLength(3)
  })

  it('au-delà du nombre de pages permis : incomplète, et elle le dit', async () => {
    let n = 0
    const page = async () => ({ transactions: [n], continuation_key: `cle-${++n}` })
    const lecture = await toutesLesPages(page, { ...SANS_LIMITE, maxPages: 3 })
    expect(lecture).toMatchObject({ transactions: [0, 1, 2], pages: 3, complete: false })
    expect(lecture.motif).toMatch(/plus de 3 pages/)
  })

  it('le budget de temps arrête la lecture avant le mur de la plateforme — la première page est toujours lue', async () => {
    const { page, cles } = serveur([{ transactions: [1], continuation_key: 'a' }, { transactions: [2] }])
    const lecture = await toutesLesPages(page, { maxPages: 50, echeance: 100, maintenant: () => 101 })
    expect(lecture).toMatchObject({ transactions: [1], pages: 1, complete: false })
    expect(lecture.motif).toMatch(/trop de temps/)
    expect(cles).toEqual([null])
  })

  it('une page illisible rend la lecture incomplète', async () => {
    const { page } = serveur([{ transactions: [1], continuation_key: 'a' }, { transactions: 'rien' }])
    const lecture = await toutesLesPages(page, SANS_LIMITE)
    expect(lecture).toMatchObject({ transactions: [1], complete: false })
    expect(lecture.motif).toMatch(/illisible/)
  })

  it('une page refusée LÈVE : c’est à l’appelant de dire pourquoi', async () => {
    const page = async (cle: string | null) => {
      if (cle) throw new Error('refusée par la banque')
      return { transactions: [1], continuation_key: 'a' }
    }
    await expect(toutesLesPages(page, SANS_LIMITE)).rejects.toThrow('refusée par la banque')
  })
})

// ── RÈGLES ───────────────────────────────────────────────────────────────────────────────────────────

interface Compte { uid: string | null; empreinte: string; nom: string | null; devise: string | null; iban_fin: string | null }
const R = executer<{
  comptesDeLaSession: (accounts: unknown) => Compte[]
  comptesGardes: (valeur: unknown) => Compte[]
  finAccordDemandee: (maxBanqueS: unknown, maintenantMs: number) => string
  aujourdHuiCabinet: (maintenant: Date) => string
  refusPeriode: (du: unknown, au: unknown, aujourdHui: string) => string | null
  messageDuPrestataire: (donnees: unknown) => string | null
  periodeRefusee: (statut: number, donnees: unknown) => boolean
  PERIODE_REFUSEE: string
  banquesDeLaListe: (donnees: unknown) => { nom: string; pays: string; types_acces: string[]; accord_jours: number | null }[]
  vuePublique: (c: Record<string, unknown> | null) => Record<string, unknown> | null
}>(bloc('RÈGLES'), ['comptesDeLaSession', 'comptesGardes', 'finAccordDemandee', 'aujourdHuiCabinet', 'refusPeriode',
  'messageDuPrestataire', 'periodeRefusee', 'PERIODE_REFUSEE', 'banquesDeLaListe', 'vuePublique'])

const JOUR_S = 86_400

describe('banque-connexion — les comptes qu’ouvre un accord', () => {
  const compte = (o: Record<string, unknown> = {}) => ({
    uid: 'uid-de-session-1',
    identification_hash: EMPREINTE,
    account_id: { iban: 'FR76 3000 6000 0112 3456 7890 189' },
    name: 'TITULAIRE FICTIF',
    details: 'Compte professionnel',
    product: 'Offre Pro',
    currency: 'EUR',
    ...o,
  })

  it('ne garde que ce qui sert à choisir — ni le nom du titulaire, ni l’IBAN entier', () => {
    const [c] = R.comptesDeLaSession([compte()])
    expect(c).toEqual({ uid: 'uid-de-session-1', empreinte: EMPREINTE, nom: 'Compte professionnel', devise: 'EUR', iban_fin: '0189' })
    expect(JSON.stringify(R.comptesDeLaSession([compte()]))).not.toMatch(/TITULAIRE|3000 6000|300060000112/)
  })

  it('l’intitulé vient de la description, sinon du produit, sinon de rien', () => {
    expect(R.comptesDeLaSession([compte({ details: undefined })])[0].nom).toBe('Offre Pro')
    expect(R.comptesDeLaSession([compte({ details: '  ', product: undefined })])[0].nom).toBeNull()
  })

  it('un compte sans empreinte n’est pas proposé ; sans identifiant, il l’est, sans mouvements lisibles', () => {
    const comptes = R.comptesDeLaSession([compte({ identification_hash: '' }), compte({ uid: undefined }), null, 'x'])
    expect(comptes).toHaveLength(1)
    expect(comptes[0].uid).toBeNull()
    expect(R.comptesDeLaSession('pas une liste')).toEqual([])
  })

  it('relus de la table, les comptes sont revérifiés', () => {
    expect(R.comptesGardes([{ empreinte: 'e1', uid: 'u1', nom: 'N', devise: 'EUR', iban_fin: '1234' }, { uid: 'sans-empreinte' }, null]))
      .toEqual([{ empreinte: 'e1', uid: 'u1', nom: 'N', devise: 'EUR', iban_fin: '1234' }])
    expect(R.comptesGardes({})).toEqual([])
  })
})

describe('banque-connexion — la durée d’accord demandée', () => {
  const maintenant = Date.UTC(2026, 8, 30, 12, 0, 0)
  const dans = (secondes: number) => new Date(maintenant + secondes * 1000).toISOString()

  it('la durée qu’admet la banque, moins une heure pour les horloges', () => {
    expect(R.finAccordDemandee(90 * JOUR_S, maintenant)).toBe(dans(90 * JOUR_S - 3600))
  })

  it('jamais au-delà des 180 jours de la DSP2, même si la banque admet plus', () => {
    expect(R.finAccordDemandee(365 * JOUR_S, maintenant)).toBe(dans(180 * JOUR_S - 3600))
  })

  it('une durée absente ou absurde retombe sur 180 jours', () => {
    for (const absurde of [undefined, null, 0, -5, Number.NaN, '90']) {
      expect(R.finAccordDemandee(absurde, maintenant), String(absurde)).toBe(dans(180 * JOUR_S - 3600))
    }
  })

  it('une banque qui n’accorde que quelques minutes garde une durée positive', () => {
    expect(R.finAccordDemandee(600, maintenant)).toBe(dans(540))
  })
})

describe('banque-connexion — la période demandée', () => {
  it('aujourd’hui est la date du CABINET, pas celle du serveur', () => {
    expect(R.aujourdHuiCabinet(new Date('2026-09-30T22:30:00Z'))).toBe('2026-10-01')
    expect(R.aujourdHuiCabinet(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01')
    expect(R.aujourdHuiCabinet(new Date('2026-06-15T10:00:00Z'))).toBe('2026-06-15')
  })

  it('deux dates civiles, dans l’ordre, sans avenir — aujourd’hui compris', () => {
    const aujourdHui = '2026-09-30'
    expect(R.refusPeriode('2026-06-01', '2026-06-30', aujourdHui)).toBeNull()
    expect(R.refusPeriode('2026-09-30', '2026-09-30', aujourdHui)).toBeNull()
    expect(R.refusPeriode('2026-06-30', '2026-06-01', aujourdHui)).toMatch(/commence après sa fin/)
    expect(R.refusPeriode('2026-09-01', '2026-10-01', aujourdHui)).toMatch(/après aujourd'hui/)
    for (const [du, au] of [['2026-02-30', '2026-03-01'], ['2026-6-01', '2026-06-30'], [undefined, '2026-06-30'], [20260601, '2026-06-30']]) {
      expect(R.refusPeriode(du, au, aujourdHui), `${du} → ${au}`).toMatch(/deux dates valides/)
    }
  })
})

describe('banque-connexion — ce que disent le prestataire et la liste des banques', () => {
  it('le message d’erreur du prestataire, borné, sans rien d’autre', () => {
    expect(R.messageDuPrestataire({ message: 'Required PSU header is not provided', detail: 'psuIpAddress', code: 422 }))
      .toBe('Required PSU header is not provided — psuIpAddress')
    expect(R.messageDuPrestataire({ message: 'm', detail: { objet: true } })).toBe('m')
    expect(R.messageDuPrestataire({ message: 'x'.repeat(400) })).toHaveLength(300)
    for (const vide of [null, undefined, {}, 'texte', { message: '  ' }]) expect(R.messageDuPrestataire(vide)).toBeNull()
  })

  // Le 422 du 30/09/2026 (bac à sable de BBVA) : la même période rendue à la lecture qui suivait l'accord,
  // refusée à la suivante. Reconnue au statut ET au message — un 422 dit aussi un en-tête manquant.
  it('une période refusée se reconnaît au statut ET au message, et se dit en français avec ses deux remèdes', () => {
    expect(R.periodeRefusee(422, { code: 422, message: 'Wrong transactions period requested' })).toBe(true)
    expect(R.periodeRefusee(422, { message: 'Wrong transaction period' })).toBe(true)
    expect(R.periodeRefusee(422, { message: 'Required PSU header is not provided', detail: 'psuIpAddress' })).toBe(false)
    expect(R.periodeRefusee(400, { message: 'Wrong transactions period requested' })).toBe(false)
    expect(R.periodeRefusee(422, null)).toBe(false)
    expect(R.PERIODE_REFUSEE).toMatch(/90 derniers jours/)
    expect(R.PERIODE_REFUSEE).toMatch(/Ramène la date « Du »/)
    expect(R.PERIODE_REFUSEE).toMatch(/renouvelle l'accord/)
  })

  it('les banques proposées : un espace de connexion au moins, par ordre alphabétique', () => {
    const banques = R.banquesDeLaListe({ aspsps: [
      { name: 'Zeta Banque', country: 'FR', psu_types: ['personal'], maximum_consent_validity: 90 * JOUR_S },
      { name: 'Alpha Banque', country: 'FR', psu_types: ['business', 'personal', 'autre'], maximum_consent_validity: 400 * JOUR_S },
      { name: 'Sans Espace', country: 'FR', psu_types: ['corporate'] },
      { name: '', country: 'FR', psu_types: ['business'] },
      { name: 'Sans Durée', country: 'FR', psu_types: ['business'] },
      null,
    ] })
    expect(banques).toEqual([
      { nom: 'Alpha Banque', pays: 'FR', types_acces: ['business', 'personal'], accord_jours: 180 },
      { nom: 'Sans Durée', pays: 'FR', types_acces: ['business'], accord_jours: null },
      { nom: 'Zeta Banque', pays: 'FR', types_acces: ['personal'], accord_jours: 90 },
    ])
    expect(R.banquesDeLaListe(null)).toEqual([])
  })
})

describe('banque-connexion — ce que voit l’écran', () => {
  const ligne = {
    id: 'id-de-ligne', dossier_id: 'dossier', banque_nom: 'Mock ASPSP', banque_pays: 'FR', type_acces: 'business',
    environnement: 'SANDBOX', etat: 'active', jeton_etat: 'JETON-SECRET-DE-RETOUR', session_id: 'SESSION-SECRETE',
    valide_jusqu_au: '2027-03-29T12:00:00+00:00', compte_uid: 'UID-SECRET', compte_empreinte: 'e1',
    derniere_recuperation: null, created_at: '2026-09-30T10:00:00+00:00',
    comptes: [{ uid: 'UID-SECRET', empreinte: 'e1', nom: 'Compte pro', devise: 'EUR', iban_fin: '0189' },
      { uid: null, empreinte: 'e2', nom: 'Compte fermé', devise: 'EUR', iban_fin: '0001' }],
  }

  it('rien de ce qui ouvre le compte : ni session, ni jeton de retour, ni identifiant de compte', () => {
    const vue = JSON.stringify(R.vuePublique(ligne))
    expect(vue).not.toMatch(/SECRET|id-de-ligne/)
    expect(vue).not.toMatch(/"uid"|session_id|jeton_etat|compte_uid|dossier_id/)
  })

  it('de quoi afficher et choisir, et si la banque rend les mouvements de chaque compte', () => {
    expect(R.vuePublique(ligne)).toEqual({
      banque_nom: 'Mock ASPSP', banque_pays: 'FR', type_acces: 'business', environnement: 'SANDBOX', etat: 'active',
      valide_jusqu_au: '2027-03-29T12:00:00+00:00', derniere_recuperation: null, created_at: '2026-09-30T10:00:00+00:00',
      compte_empreinte: 'e1',
      comptes: [
        { empreinte: 'e1', nom: 'Compte pro', devise: 'EUR', iban_fin: '0189', mouvements_lisibles: true },
        { empreinte: 'e2', nom: 'Compte fermé', devise: 'EUR', iban_fin: '0001', mouvements_lisibles: false },
      ],
    })
    expect(R.vuePublique(null)).toBeNull()
  })
})

// ── CÂBLAGE ──────────────────────────────────────────────────────────────────────────────────────────

const GESTIONNAIRE = SOURCE.slice(SOURCE.indexOf('Deno.serve('))

/** Le texte de l'appel qui commence à `debut` (parenthèses appariées). */
function appelA(texte: string, debut: number): string {
  let profondeur = 0
  for (let i = texte.indexOf('(', debut); i < texte.length; i++) {
    if (texte[i] === '(') profondeur++
    else if (texte[i] === ')') { profondeur--; if (profondeur === 0) return texte.slice(debut, i + 1) }
  }
  throw new Error('parenthèses non appariées')
}

/**
 * Le DERNIER bloc `if (action === "…") { … }` du gestionnaire — celui qui traite l'action. « finaliser »
 * en a deux : le premier ne fait que retrouver la demande, avant le contrôle d'accès.
 */
function brancheDe(action: string): string {
  const debut = GESTIONNAIRE.lastIndexOf(`if (action === "${action}") {`)
  expect(debut, `branche « ${action} » introuvable — garde-fou à remettre à jour`).toBeGreaterThan(-1)
  let profondeur = 0
  for (let i = GESTIONNAIRE.indexOf('{', debut); i < GESTIONNAIRE.length; i++) {
    if (GESTIONNAIRE[i] === '{') profondeur++
    else if (GESTIONNAIRE[i] === '}') { profondeur--; if (profondeur === 0) return GESTIONNAIRE.slice(debut, i + 1) }
  }
  throw new Error('accolades non appariées')
}

describe('banque-connexion — le câblage du gestionnaire', () => {
  const acces = GESTIONNAIRE.indexOf('rpc("admin_du_dossier"')

  it('l’accès au dossier se vérifie AVANT toute signature et tout appel au prestataire', () => {
    expect(acces).toBeGreaterThan(-1)
    for (const appel of ['jetonApplication(', 'signer()', 'appeler(']) {
      const position = GESTIONNAIRE.indexOf(appel)
      expect(position, `${appel} introuvable dans le gestionnaire`).toBeGreaterThan(-1)
      expect(position, `${appel} précède le contrôle d’accès`).toBeGreaterThan(acces)
    }
  })

  it('l’accès se lit avec le jeton de l’APPELANT, et son échec refuse', () => {
    expect(GESTIONNAIRE).toMatch(/const \{ data: aAcces, error: erreurAcces \} = await supabaseAsCaller\.rpc\("admin_du_dossier", \{ p_dossier_id: dossierId \}\)/)
    expect(GESTIONNAIRE).toMatch(/if \(erreurAcces\) return json\(/)
    expect(GESTIONNAIRE).toMatch(/if \(!aAcces\) return json\(\{ error: "Dossier introuvable\." \}, 404\)/)
  })

  it('au retour de la banque, le dossier vient de la DEMANDE, et c’est sur lui que l’accès se vérifie', () => {
    const recherche = GESTIONNAIRE.indexOf('.eq("jeton_etat", etatRetour)')
    const dossier = GESTIONNAIRE.indexOf('dossierId = String(data.dossier_id)')
    expect(recherche).toBeGreaterThan(-1)
    expect(dossier).toBeGreaterThan(recherche)
    expect(acces).toBeGreaterThan(dossier)
  })

  it('« statut » répond sans rien demander au prestataire', () => {
    const statut = brancheDe('statut')
    expect(statut).not.toMatch(/appeler\(|signer\(|jetonApplication\(/)
    expect(GESTIONNAIRE.indexOf(statut)).toBeLessThan(GESTIONNAIRE.indexOf('signer()'))
    expect(statut).toContain('vuePublique(connexion)')
  })

  it('le jeton de retour ne sert qu’une fois, et seulement s’il est toujours celui de la demande', () => {
    const finaliser = brancheDe('finaliser')
    expect(finaliser).toMatch(/jeton_etat: crypto\.randomUUID\(\)/)
    expect(finaliser).toMatch(/\.eq\("jeton_etat", String\(connexion!\.jeton_etat\)\)/)
  })

  it('une session ouverte que rien n’enregistre est refermée chez la banque', () => {
    const finaliser = brancheDe('finaliser')
    const echec = finaliser.indexOf('if (majErreur || !majData) {')
    expect(echec).toBeGreaterThan(-1)
    expect(finaliser.indexOf('appeler(action, "DELETE", `/sessions/${encodeURIComponent(sessionId)}`', echec)).toBeGreaterThan(echec)
  })

  it('le retrait referme l’accord chez la banque AVANT de supprimer la connexion', () => {
    const retirer = brancheDe('retirer')
    const fermeture = retirer.indexOf('appeler(action, "DELETE"')
    const suppression = retirer.indexOf('.delete().eq("id", connexion.id)')
    expect(fermeture).toBeGreaterThan(-1)
    expect(suppression).toBeGreaterThan(fermeture)
  })

  it('une période refusée par la banque se dit avec son drapeau, AVANT la réponse d’erreur générale', () => {
    const reconnue = GESTIONNAIRE.indexOf('if (periodeRefusee(e.reponse.statut, e.reponse.donnees)) return json({ error: PERIODE_REFUSEE, periode_refusee: true }, 422)')
    expect(reconnue, 'refus de période non reconnu dans le gestionnaire').toBeGreaterThan(-1)
    expect(GESTIONNAIRE.indexOf('return erreurPrestataire(e.reponse)', reconnue)).toBeGreaterThan(reconnue)
  })

  it('un accord neuf efface la dernière récupération : la lecture qui le suit peut remonter plus loin', () => {
    const finaliser = brancheDe('finaliser')
    const mise = finaliser.indexOf('.update({')
    expect(finaliser.indexOf('derniere_recuperation: null', mise)).toBeGreaterThan(mise)
    expect(finaliser.indexOf('derniere_recuperation: null', mise)).toBeLessThan(finaliser.indexOf('})', mise))
  })

  it('la période part vers la banque ET se refiltre ici, et une lecture incomplète ne date pas de récupération', () => {
    expect(GESTIONNAIRE).toMatch(/date_from: String\(du\), date_to: String\(au\)/)
    expect(GESTIONNAIRE).toMatch(/mouvementsDuCompte\(lecture\.transactions, compteEmpreinte, String\(du\), String\(au\)\)/)
    const complete = GESTIONNAIRE.indexOf('if (lecture.complete) {')
    expect(complete).toBeGreaterThan(-1)
    expect(GESTIONNAIRE.indexOf('derniere_recuperation: new Date()')).toBeGreaterThan(complete)
  })

  it('aucune réponse ne porte ce qui ouvre le compte', () => {
    let n = 0
    for (let i = GESTIONNAIRE.indexOf('json('); i > -1; i = GESTIONNAIRE.indexOf('json(', i + 1)) {
      const appel = appelA(GESTIONNAIRE, i)
      n++
      expect(appel, appel.slice(0, 80)).not.toMatch(/session_id|sessionId|compte_uid|compteUid|jeton_etat|jetonEtat|\buid\b|clePrivee/)
    }
    // Le plancher : sans lui, un balayage devenu aveugle passerait cette règle à vide.
    expect(n).toBeGreaterThan(30)
  })

  it('les journaux ne portent ni libellé, ni montant, ni identifiant — des nombres et des codes', () => {
    const journaux = [...SOURCE.matchAll(/console\.(?:log|error|warn)\(/g)].map((m) => appelA(SOURCE, m.index!))
    expect(journaux.length).toBeGreaterThan(4)
    for (const j of journaux) {
      // Ce qu'un journal INSÈRE : les expressions `${…}` de ses gabarits. Le texte fixe, lui, peut nommer
      // les mouvements ; une valeur, non — sauf un compte (`.length`).
      const inserees = [...j.matchAll(/\$\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g)].map((m) => m[1].replace(/\b\w+\.length\b/g, ''))
      for (const expression of inserees) {
        expect(expression, j).not.toMatch(
          /\b(libelle|montant|mouvements|transactions|comptes|chemin|sessionId|ancienneSession|compteUid|compteEmpreinte|empreinte|iban|code|donnees|payload|clePrivee|jeton|message)\b/)
      }
      // Et rien d'autre qu'un texte : une valeur passée hors gabarit échapperait au contrôle ci-dessus.
      const horsTexte = j.slice(j.indexOf('(') + 1, -1).replace(/`(?:\\.|\$\{[^}]*(?:\{[^}]*\}[^}]*)*\}|[^`\\])*`|"(?:\\.|[^"\\])*"/g, '')
      expect(horsTexte.replace(/[\s+]/g, ''), j).toBe('')
    }
  })

  it('la clé privée et l’identifiant d’application viennent de l’environnement, l’adresse de retour est celle déclarée', () => {
    expect(SOURCE).toMatch(/Deno\.env\.get\("ENABLE_BANKING_CLE_PRIVEE"\)/)
    expect(SOURCE).toMatch(/Deno\.env\.get\("ENABLE_BANKING_APPLICATION_ID"\)\?\.trim\(\) \|\| APPLICATION_BAC_A_SABLE/)
    expect(SOURCE).toMatch(/const URL_RETOUR = "https:\/\/compta\.jdarnis\.fr\/retour-banque\.html"/)
  })
})

// L'ADRESSE DE RETOUR MÈNE BIEN QUELQUE PART. Déclarée chez le prestataire et dans la fonction, elle doit
// exister sur le site servi — sinon la banque renvoie le titulaire sur une page 404, après son accord, et
// le code d'autorisation se perd sans que rien ne le dise.
describe('le retour de la banque arrive dans l’application', () => {
  const urlRetour = new URL(/const URL_RETOUR = "([^"]+)"/.exec(SOURCE)![1])

  it('la page de retour est servie à l’adresse déclarée, sur le domaine du site', () => {
    const domaine = readFileSync(new URL('../../public/CNAME', import.meta.url), 'utf8').trim()
    expect(urlRetour.protocol).toBe('https:')
    expect(urlRetour.hostname).toBe(domaine)
    const page = readFileSync(new URL(`../../public${urlRetour.pathname}`, import.meta.url), 'utf8')
    // Les paramètres de la banque passent derrière le « # », et la page se REMPLACE dans l'historique.
    expect(page).toMatch(/location\.replace\('\/#\/retour-banque' \+ location\.search\)/)
    // Rien d'autre ne se charge sur cette page : pas de ressource tierce qui verrait passer le code.
    expect(page).not.toMatch(/<script[^>]*\bsrc=|<link[^>]*\bhref=|<img\b/)
  })

  it('l’application porte l’écran qui remet le code à la fonction', () => {
    const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
    expect(app).toMatch(/<Route path="\/retour-banque" element=\{<RetourBanque \/>\} \/>/)
    const ecran = readFileSync(new URL('../pages/RetourBanque.tsx', import.meta.url), 'utf8')
    expect(ecran).toMatch(/action: 'finaliser', code, state: etat/)
  })
})
