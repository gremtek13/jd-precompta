// @vitest-environment jsdom
// L'import lit le XML des factures avec l'analyseur du navigateur (`DOMParser`) : ces tests tournent dans jsdom.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FluxVu, ListeFlux } from './receptionPlateforme'

// Un faux serveur : la fonction `plateforme-agreee` (une plateforme fictive, facture par facture), le cours de la BCE,
// le stockage et les tables que l'import lit et écrit. Les factures sont FICTIVES.
interface Document {
  octets: Uint8Array
  nature: 'pdf' | 'xml'
}
interface Refus {
  status: number
  corps: Record<string, unknown>
}
interface FactureFausse {
  flux: FluxVu
  original: Document | Refus
  lisible?: Document | Refus
}

const HOTE = 'pa.exemple.fr'
const VERSION = '2026-10-07T10:00:00.123456+00:00'

const etat = {
  factures: new Map<string, FactureFausse>(),
  /** Ce que la fonction rend à la place de la réponse attendue, pour un champ précis. */
  alteration: null as ((d: Record<string, unknown>) => Record<string, unknown>) | null,
  retenir: null as Refus | null,
  // Les pièces du DOSSIER et des autres : le faux client applique les filtres de la lecture (voir
  // src/test/filtresPostgrest.ts), pour qu'une lecture qui oublierait le dossier se voie.
  piecesFlux: [] as { dossier_id: string; flux_hote: string | null; flux_id: string | null }[],
  piecesHash: [] as { dossier_id: string; storage_hash: string | null }[],
  lectureFluxRefusee: false,
  lectureHashRefusee: false,
  cacheTauxRefuse: false,
  uploadRefuse: new Set<string>(),
  insertErreur: null as { code: string; message: string } | null,
  tauxBce: { taux: 1.1698, date_du_taux: '2026-09-15' } as Record<string, unknown> | null,
  /** Ce que rend `superpdp-credentials` : la configuration, ou un refus. */
  superPdp: { data: { configured: false }, error: null } as { data: unknown; error: unknown },
}
const journal = {
  appels: [] as Record<string, unknown>[],
  uploads: [] as { chemin: string; type: string | undefined; taille: number }[],
  retraits: [] as string[][],
  inserts: [] as Record<string, unknown>[],
  textes: [] as Record<string, unknown>[],
  /** Les cours demandés à la BCE : la devise et la DATE. */
  bce: [] as Record<string, unknown>[],
}

const base64 = (o: Uint8Array) => Buffer.from(o).toString('base64')
const refus = (status: number, corps: Record<string, unknown>) =>
  ({ data: null, error: { context: new Response(JSON.stringify(corps), { status }) } })

function plateforme(corps: Record<string, unknown>) {
  journal.appels.push(corps)
  if (corps.action === 'retenir') {
    if (etat.retenir) return refus(etat.retenir.status, etat.retenir.corps)
    return { data: { recherche_depuis: corps.jusqua ?? '2026-01-01T00:00:00.000Z', derniere_recuperation: '2026-10-07T12:00:00.000Z' }, error: null }
  }
  if (corps.action !== 'telecharger') return { data: { ok: true }, error: null }
  const facture = etat.factures.get(String(corps.flowId))
  if (!facture) return refus(404, { error: 'Cette facture n’existe plus chez la plateforme.', definitif: true, raison: 'introuvable' })
  const doc = corps.document === 'original' ? facture.original : facture.lisible
  if (!doc) return refus(404, { error: 'La plateforme ne rend pas de version lisible de cette facture.', definitif: true, raison: 'introuvable' })
  if ('status' in doc) return refus(doc.status, doc.corps)
  const reponse: Record<string, unknown> = {
    hote: HOTE, flux: facture.flux, document: corps.document, nature: doc.nature, octets: doc.octets.length, contenu: base64(doc.octets),
  }
  return { data: etat.alteration ? etat.alteration(reponse) : reponse, error: null }
}

vi.mock('./supabase', async () => {
  const { filtrer, predicatEq, predicatNot } = await import('../test/filtresPostgrest')
  type Ligne = Record<string, unknown>
  const lecture = (lignes: () => Ligne[], refusee: () => boolean) => {
    let debut = 0
    let fin = Number.MAX_SAFE_INTEGER
    const predicats: ((ligne: Ligne) => boolean)[] = []
    const chaine = {
      eq: (colonne: string, valeur: unknown) => { predicats.push(predicatEq(colonne, valeur)); return chaine },
      not: (colonne: string, operateur: string, valeur: unknown) => { predicats.push(predicatNot(colonne, operateur, valeur)); return chaine },
      order: () => chaine,
      // Le cache des taux de la BCE est vide dans ces tests : ses bornes de dates n'ont rien à écarter.
      gte: () => chaine,
      lte: () => chaine,
      range: (d: number, f: number) => { debut = d; fin = f; return chaine },
      then: (resoudre: (v: unknown) => unknown) => {
        if (refusee()) return Promise.resolve(resoudre({ data: null, error: { message: 'permission denied' }, count: null }))
        const retenues = filtrer(lignes(), predicats)
        return Promise.resolve(resoudre({ data: retenues.slice(debut, fin + 1), error: null, count: retenues.length }))
      },
    }
    return chaine
  }
  return {
    supabase: {
      functions: {
        invoke: async (nom: string, options: { body: Record<string, unknown> }) =>
          nom === 'taux-change-bce'
            ? (journal.bce.push(options.body), { data: etat.tauxBce, error: etat.tauxBce ? null : { message: 'BCE injoignable' } })
            : nom === 'superpdp-credentials'
              ? (journal.appels.push({ fonction: nom, ...options.body }), etat.superPdp)
              : plateforme(options.body),
      },
      from: (table: string) => ({
        select: (colonnes: string) => {
          if (table === 'pieces' && colonnes.startsWith('flux_hote')) return lecture(() => etat.piecesFlux, () => etat.lectureFluxRefusee)
          if (table === 'pieces') return lecture(() => etat.piecesHash, () => etat.lectureHashRefusee)
          if (table === 'taux_change_bce') return lecture(() => [], () => etat.cacheTauxRefuse)
          return lecture(() => [], () => false)
        },
        insert: (ligne: Record<string, unknown>) => ({
          select: () => ({
            single: async () => {
              journal.inserts.push(ligne)
              return etat.insertErreur ? { data: null, error: etat.insertErreur } : { data: { id: `piece-${journal.inserts.length}` }, error: null }
            },
          }),
        }),
        upsert: async (ligne: Record<string, unknown>) => {
          journal.textes.push(ligne)
          return { error: null }
        },
      }),
      storage: {
        from: () => ({
          upload: async (chemin: string, blob: Blob, options?: { contentType?: string }) => {
            journal.uploads.push({ chemin, type: options?.contentType, taille: blob.size })
            return { error: [...etat.uploadRefuse].some((m) => chemin.includes(m)) ? { message: 'stockage plein' } : null }
          },
          remove: async (chemins: string[]) => {
            journal.retraits.push(chemins)
            return { error: null }
          },
        }),
      },
    },
  }
})

const facturX = vi.hoisted(() => ({ reponse: null as { xml: string } | { refus: string } | null, appels: 0 }))
vi.mock('./factureX', () => ({
  xmlDuFacturX: async () => {
    facturX.appels++
    return facturX.reponse ?? { refus: 'Ce PDF ne porte pas de facture structurée (aucune pièce jointe « factur-x.xml »).' }
  },
}))

const {
  appelerPlateforme, cleFlux, estTermine, importerFlux, lireFluxImportes, lireSynchronisationSuperPdp, nomDuFichier,
  notesDImport, planReception, pointDeReprise, preparerReception, recevoirFactures, releverStatutsDesFactures,
} = await import('./receptionPlateforme')

// ── Les factures fictives ────────────────────────────────────────────────────────────────────────────────────────

const ESPACES = 'xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" ' +
  'xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" ' +
  'xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100"'

function cii(o: { numero?: string; type?: string; acheteur?: string; vendeur?: string; devise?: string; ttc?: string } = {}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice ${ESPACES}>
  <rsm:ExchangedDocument><ram:ID>${o.numero ?? 'F-42'}</ram:ID><ram:TypeCode>${o.type ?? '380'}</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">20260915</udt:DateTimeString></ram:IssueDateTime></rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty><ram:Name>Fournitures Martin</ram:Name>
        <ram:SpecifiedLegalOrganization><ram:ID schemeID="0002">${o.vendeur ?? '123456782'}</ram:ID></ram:SpecifiedLegalOrganization></ram:SellerTradeParty>
      <ram:BuyerTradeParty><ram:Name>Cabinet des Lilas</ram:Name>${o.acheteur ??
        '<ram:SpecifiedLegalOrganization><ram:ID schemeID="0002">987654321</ram:ID></ram:SpecifiedLegalOrganization>'}</ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeSettlement><ram:InvoiceCurrencyCode>${o.devise ?? 'EUR'}</ram:InvoiceCurrencyCode>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:TaxBasisTotalAmount>100.00</ram:TaxBasisTotalAmount><ram:TaxTotalAmount currencyID="${o.devise ?? 'EUR'}">20.00</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${o.ttc ?? '120.00'}</ram:GrandTotalAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation></ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`
}

const utf8 = (t: string) => new TextEncoder().encode(t)
const PDF = utf8('%PDF-1.7 version lisible')
const xml = (texte: string): Document => ({ octets: utf8(texte), nature: 'xml' })
const pdf = (texte = '%PDF-1.7 facture'): Document => ({ octets: utf8(texte), nature: 'pdf' })

let numero = 0
function flux(o: Partial<FluxVu> = {}): FluxVu {
  numero++
  return {
    id: `flux-${numero}`, sens: 'achat', syntaxe: 'CII', direction: 'In', nom: `facture-${numero}.xml`,
    recu_le: '2026-10-01T08:00:00.000Z', mis_a_jour: `2026-10-0${Math.min(numero, 9)}T08:00:00.000Z`, etat: 'pret', ...o,
  }
}

// Chaque facture a son propre numéro, donc son propre fichier : deux fichiers identiques seraient un doublon. `null`
// pour une facture que la plateforme ne rend pas en version lisible.
function deposer(f: FluxVu, original?: Document | Refus, lisible: Document | Refus | null = { octets: PDF, nature: 'pdf' }): FluxVu {
  etat.factures.set(f.id, { flux: f, original: original ?? xml(cii({ numero: `F-${f.id}` })), lisible: lisible ?? undefined })
  return f
}

const ctx = (o: Partial<{ hashsConnus: Set<string>; sirenDossier: string }> = {}) => ({
  dossierId: 'd1', userId: 'u1', version: VERSION, hote: HOTE, sirenDossier: o.sirenDossier ?? '987654321',
  hashsConnus: o.hashsConnus ?? new Set<string>(),
})

const liste = (flux: FluxVu[], o: Partial<ListeFlux> = {}): ListeFlux => ({
  hote: HOTE, version: VERSION, depuis: null, flux,
  ecartes: { autre_flux: 0, illisible: 0, format: 0, statut_inconnu: 0, doublons: 0 },
  complete: true, motif: null, jusqua: flux.length ? flux[flux.length - 1].mis_a_jour : null, ...o,
})

async function sha256(o: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new Uint8Array(o))
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

beforeEach(() => {
  numero = 0
  etat.factures.clear()
  etat.alteration = null
  etat.retenir = null
  etat.piecesFlux = []
  etat.piecesHash = []
  etat.lectureFluxRefusee = false
  etat.lectureHashRefusee = false
  etat.cacheTauxRefuse = false
  etat.uploadRefuse = new Set()
  etat.insertErreur = null
  etat.tauxBce = { taux: 1.1698, date_du_taux: '2026-09-15' }
  facturX.reponse = null
  facturX.appels = 0
  journal.appels = []
  journal.uploads = []
  journal.retraits = []
  journal.inserts = []
  journal.textes = []
  journal.bce = []
  etat.superPdp = { data: { configured: false }, error: null }
})

// ── Le plan et le point de reprise ───────────────────────────────────────────────────────────────────────────────

describe('planReception', () => {
  it('range chaque facture : déjà là, rejetée, en attente, ou à importer', () => {
    const a = flux(), b = flux({ etat: 'en_erreur' }), c = flux({ etat: 'en_attente' }), d = flux(), e = flux({ etat: 'en_erreur' })
    const plan = planReception(liste([a, b, c, d, e]), new Set([cleFlux(HOTE, d.id), cleFlux(HOTE, e.id)]))
    expect(plan.aImporter.map((f) => f.id)).toEqual([a.id])
    expect(plan.rejetes.map((f) => f.id)).toEqual([b.id])
    expect(plan.enAttente.map((f) => f.id)).toEqual([c.id])
    // Déjà là, même rejetée depuis : elle est traitée.
    expect(plan.dejaImportes.map((f) => f.id)).toEqual([d.id, e.id])
  })

  it('un même identifiant chez une autre plateforme n’est pas la même facture', () => {
    const a = flux()
    expect(planReception(liste([a]), new Set([cleFlux('autre.exemple.fr', a.id)])).aImporter).toHaveLength(1)
  })
})

describe('pointDeReprise', () => {
  const dates = ['2026-10-01T08:00:00.000Z', '2026-10-02T08:00:00.000Z', '2026-10-03T08:00:00.000Z', '2026-10-04T08:00:00.000Z']
  const fl = dates.map((d) => flux({ mis_a_jour: d }))

  it('tout traité : le point que la liste rend possible', () => {
    expect(pointDeReprise(liste(fl), [])).toBe(dates[3])
    expect(pointDeReprise(liste(fl, { jusqua: dates[2] }), [])).toBe(dates[2])
  })

  it('une facture restée à faire arrête le point juste avant elle', () => {
    expect(pointDeReprise(liste(fl), [fl[2]])).toBe(dates[1])
    expect(pointDeReprise(liste(fl), [fl[3], fl[2]])).toBe(dates[1])
    expect(pointDeReprise(liste(fl), [fl[2], fl[3]])).toBe(dates[1])
  })

  it('jamais à la date de la facture restée, ni au-delà de ce que la liste rend possible', () => {
    const memeDate = [...fl, flux({ mis_a_jour: dates[2] })]
    expect(pointDeReprise(liste(memeDate), [memeDate[4]])).toBe(dates[1])
    expect(pointDeReprise(liste(fl, { jusqua: dates[0] }), [fl[3]])).toBe(dates[0])
  })

  it('rien quand la première facture restée est la plus ancienne, ou quand la liste ne rend rien possible', () => {
    expect(pointDeReprise(liste(fl), [fl[0]])).toBeNull()
    expect(pointDeReprise(liste(fl, { jusqua: null }), [])).toBeNull()
  })
})

describe('estTermine', () => {
  const f = flux()
  it('dit ce que le point de reprise peut dépasser', () => {
    expect(estTermine({ statut: 'importee', flux: f, pieceId: 'p', avertissements: [] })).toBe(true)
    expect(estTermine({ statut: 'deja_importee', flux: f })).toBe(true)
    expect(estTermine({ statut: 'doublon', flux: f })).toBe(true)
    expect(estTermine({ statut: 'autre_entreprise', flux: f, siren: '111111111' })).toBe(true)
    expect(estTermine({ statut: 'echec', flux: f, definitif: true, message: '' })).toBe(true)
    expect(estTermine({ statut: 'echec', flux: f, definitif: false, message: '' })).toBe(false)
    expect(estTermine({ statut: 'interrompu', flux: f, raison: 'perimee', message: '' })).toBe(false)
  })
})

describe('nomDuFichier', () => {
  it('porte toujours l’extension de ce qu’est le fichier', () => {
    expect(nomDuFichier(flux({ nom: 'FA-2026.xml' }), null, 'xml')).toBe('FA-2026.xml')
    expect(nomDuFichier(flux({ nom: 'FA-2026.XML' }), null, 'xml')).toBe('FA-2026.XML')
    expect(nomDuFichier(flux({ nom: 'FA-2026' }), null, 'xml')).toBe('FA-2026.xml')
    expect(nomDuFichier(flux({ nom: 'FA-2026.xml' }), null, 'pdf')).toBe('FA-2026.xml.pdf')
    expect(nomDuFichier(flux({ id: 'abc', nom: null }), null, 'pdf')).toBe('facture abc.pdf')
  })
})

describe('appelerPlateforme', () => {
  it('rend la phrase de la fonction et ses drapeaux', async () => {
    const r = await appelerPlateforme({ action: 'telecharger', flowId: 'inconnu', document: 'original' }, 'repli')
    expect(r.erreur).toBe('Cette facture n’existe plus chez la plateforme.')
    expect(r.drapeaux).toEqual({ definitif: true, raison: 'introuvable', perimee: false, acces_refuse: false, identifiants_refuses: false })
  })
})

describe('releverStatutsDesFactures (étape d7)', () => {
  it('demande le relevé du dossier, depuis le point de reprise ou depuis le début, et rend ce que la fonction rend', async () => {
    expect((await releverStatutsDesFactures('d1', false)).erreur).toBeNull()
    await releverStatutsDesFactures('d1', true)
    expect(journal.appels).toEqual([
      { action: 'relever', dossierId: 'd1', depuisLeDebut: false },
      { action: 'relever', dossierId: 'd1', depuisLeDebut: true },
    ])
  })
})

describe('lireSynchronisationSuperPdp', () => {
  it('dit si la synchronisation Super PDP du dossier est configurée, sans rien demander d’autre que son statut', async () => {
    expect(await lireSynchronisationSuperPdp('d1')).toEqual({ configuree: false, erreur: null })
    etat.superPdp = { data: { configured: true }, error: null }
    expect(await lireSynchronisationSuperPdp('d1')).toEqual({ configuree: true, erreur: null })
    expect(journal.appels).toEqual([
      { fonction: 'superpdp-credentials', dossierId: 'd1', action: 'status' },
      { fonction: 'superpdp-credentials', dossierId: 'd1', action: 'status' },
    ])
  })

  it('une réponse qui ne dit pas « configurée » n’est pas prise pour oui', async () => {
    etat.superPdp = { data: { configured: 'true' }, error: null }
    expect(await lireSynchronisationSuperPdp('d1')).toEqual({ configuree: false, erreur: null })
  })

  it('illisible, on ne sait pas — et la raison de la fonction est rendue', async () => {
    etat.superPdp = refus(403, { error: 'Accès refusé à ce dossier.' })
    expect(await lireSynchronisationSuperPdp('d1')).toEqual({ configuree: null, erreur: 'Accès refusé à ce dossier.' })
  })
})

describe('notesDImport', () => {
  it('rien à dire : pas de note', () => {
    expect(notesDImport([])).toBeNull()
  })
})

describe('lireFluxImportes et preparerReception', () => {
  it('lit les flux déjà importés, et prépare le plan', async () => {
    const a = deposer(flux()), b = deposer(flux())
    etat.piecesFlux = [
      { dossier_id: 'd1', flux_hote: HOTE, flux_id: a.id },
      // Celle d'un autre dossier ne compte pas, ni une pièce déposée à la main.
      { dossier_id: 'd2', flux_hote: HOTE, flux_id: b.id },
      { dossier_id: 'd1', flux_hote: null, flux_id: null },
    ]
    expect((await lireFluxImportes('d1')).cles).toEqual(new Set([cleFlux(HOTE, a.id)]))
    etat.piecesHash = [
      { dossier_id: 'd1', storage_hash: 'empreinte-du-dossier' },
      { dossier_id: 'd2', storage_hash: 'empreinte-d-un-autre-dossier' },
      { dossier_id: 'd1', storage_hash: null },
    ]
    const prepare = await preparerReception('d1', liste([a, b]))
    expect('plan' in prepare && prepare.plan.aImporter.map((f) => f.id)).toEqual([b.id])
    // Les fichiers d'un autre dossier ne sont pas des doublons de celui-ci.
    expect('plan' in prepare && prepare.hashsConnus).toEqual(new Set(['empreinte-du-dossier']))
  })

  it('une lecture partielle suspend l’import', async () => {
    etat.lectureFluxRefusee = true
    const prepare = await preparerReception('d1', liste([flux()]))
    expect(prepare).toEqual({ refus: expect.stringMatching(/^Les factures déjà importées n’ont pas pu être lues en entier/) })
  })

  it('des empreintes illisibles suspendent l’import : un fichier déjà déposé à la main entrerait une seconde fois', async () => {
    etat.lectureHashRefusee = true
    const prepare = await preparerReception('d1', liste([flux()]))
    expect(prepare).toEqual({ refus: 'Empreintes des fichiers déjà importés illisibles : lecture interrompue après 0 ligne(s) : permission denied' })
  })
})

// ── L'import d'une facture ───────────────────────────────────────────────────────────────────────────────────────

describe('importerFlux', () => {
  it('importe un original XML : la pièce, ses deux fichiers, son texte lu', async () => {
    const f = deposer(flux({ nom: 'FA-42.xml' }), xml(cii()))
    const contexte = ctx()
    const issue = await importerFlux(contexte, f)
    expect(issue).toEqual({ statut: 'importee', flux: f, pieceId: 'piece-1', avertissements: [] })
    expect(journal.uploads).toEqual([
      { chemin: expect.stringMatching(/^d1\/\d+-FA_42\.xml$/), type: 'text/plain; charset=utf-8', taille: utf8(cii()).length },
      { chemin: expect.stringMatching(/^d1\/\d+-FA_42-lisible\.pdf$/), type: 'application/pdf', taille: PDF.length },
    ])
    const hash = await sha256(utf8(cii()))
    expect(journal.inserts).toEqual([{
      dossier_id: 'd1', uploaded_by: 'u1', source: 'plateforme',
      storage_path: journal.uploads[0].chemin, storage_hash: hash, nom_fichier: 'FA-42.xml', lisible_path: journal.uploads[1].chemin,
      flux_hote: HOTE, flux_id: f.id, type_piece: 'achat', statut: 'a_valider', date_piece: '2026-09-15', tiers: 'Fournitures Martin',
      montant_ht: 100, montant_tva: 20, montant_ttc: 120, devise: 'EUR', montant_devise: null, taux_change: null, conversion_source: null,
      confiance: 'haute', notes: null,
    }])
    expect(contexte.hashsConnus.has(hash)).toBe(true)
    expect(journal.textes).toHaveLength(1)
    expect(journal.textes[0]).toMatchObject({ dossier_id: 'd1', piece_id: 'piece-1' })
    expect(String(journal.textes[0].texte)).toContain('Numéro : F-42')
    // La version de la connexion qui a listé accompagne chaque téléchargement.
    expect(journal.appels.map((a) => [a.action, a.document, a.version])).toEqual([
      ['telecharger', 'original', VERSION], ['telecharger', 'lisible', VERSION],
    ])
  })

  it('un avoir entre en négatif', async () => {
    await importerFlux(ctx(), deposer(flux(), xml(cii({ type: '381' }))))
    expect(journal.inserts[0]).toMatchObject({ montant_ht: -100, montant_tva: -20, montant_ttc: -120 })
  })

  it('une vente a l’acheteur pour tiers, et le dossier pour vendeur', async () => {
    await importerFlux(ctx({ sirenDossier: '123456782' }), deposer(flux({ sens: 'vente' })))
    expect(journal.inserts[0]).toMatchObject({ type_piece: 'vente', tiers: 'Cabinet des Lilas', confiance: 'haute' })
  })

  it('le sens se relit dans la réponse au téléchargement, pas dans la liste', async () => {
    const f = flux()
    etat.factures.set(f.id, { flux: { ...f, sens: 'vente' }, original: xml(cii()), lisible: { octets: PDF, nature: 'pdf' } })
    await importerFlux(ctx({ sirenDossier: '123456782' }), f)
    expect(journal.inserts[0]).toMatchObject({ type_piece: 'vente' })
  })

  it('une facture adressée à une autre entreprise ne s’importe pas, et rien n’est déposé', async () => {
    const issue = await importerFlux(ctx({ sirenDossier: '111111111' }), deposer(flux()))
    expect(issue).toMatchObject({ statut: 'autre_entreprise', siren: '987654321' })
    expect(journal.uploads).toEqual([])
    expect(journal.inserts).toEqual([])
    expect(journal.appels.map((a) => a.document)).toEqual(['original'])
  })

  it('une facture sans SIREN d’acheteur s’importe, mais le dit et baisse sa confiance', async () => {
    const issue = await importerFlux(ctx(), deposer(flux(), xml(cii({ acheteur: '' }))))
    expect(issue).toMatchObject({
      statut: 'importee',
      avertissements: ['La facture ne dit pas le SIREN de son acheteur : rien ne vérifie qu’elle est adressée à ce dossier.'],
    })
    expect(journal.inserts[0]).toMatchObject({
      confiance: 'moyenne',
      // Dit aussi là où on valide la pièce : la fenêtre de l'import se referme, la fiche reste.
      notes: 'Reçue de la plateforme du client — à vérifier :\n'
        + '- La facture ne dit pas le SIREN de son acheteur : rien ne vérifie qu’elle est adressée à ce dossier.',
    })
  })

  it('un fichier déjà au dossier est un doublon : rien n’est déposé', async () => {
    const issue = await importerFlux(ctx({ hashsConnus: new Set([await sha256(utf8(cii()))]) }), deposer(flux(), xml(cii())))
    expect(issue.statut).toBe('doublon')
    expect(journal.uploads).toEqual([])
    expect(journal.appels).toHaveLength(1)
  })

  it('un original refusé : définitif ou à reprendre selon la fonction', async () => {
    const definitif = await importerFlux(ctx(), deposer(flux(), {
      status: 413, corps: { error: 'Ce document dépasse 10 Mo : récupérez-le sur la plateforme.', definitif: true, raison: 'trop_lourd' },
    }))
    expect(definitif).toMatchObject({ statut: 'echec', definitif: true, message: 'Ce document dépasse 10 Mo : récupérez-le sur la plateforme.' })
    const passager = await importerFlux(ctx(), deposer(flux(), { status: 502, corps: { error: 'La plateforme ne répond pas.' } }))
    expect(passager).toMatchObject({ statut: 'echec', definitif: false })
    expect(journal.uploads).toEqual([])
  })

  it('une connexion changée ou une identité refusée interrompt l’import', async () => {
    const perimee = await importerFlux(ctx(), deposer(flux(), { status: 409, corps: { error: 'changé', perimee: true } }))
    expect(perimee).toMatchObject({ statut: 'interrompu', raison: 'perimee', message: 'changé' })
    const acces = await importerFlux(ctx(), deposer(flux(), { status: 502, corps: { error: 'refusé', identifiants_refuses: true } }))
    expect(acces).toMatchObject({ statut: 'interrompu', raison: 'acces' })
    const interdit = await importerFlux(ctx(), deposer(flux(), { status: 403, corps: { error: 'interdit', acces_refuse: true } }))
    expect(interdit).toMatchObject({ statut: 'interrompu', raison: 'acces' })
  })

  it('sans version lisible pour de bon, la pièce s’importe sans elle', async () => {
    const issue = await importerFlux(ctx(), deposer(flux(), xml(cii()), null))
    expect(issue).toMatchObject({
      statut: 'importee', avertissements: ['Sans version lisible : La plateforme ne rend pas de version lisible de cette facture.'],
    })
    expect(journal.uploads).toHaveLength(1)
    expect(journal.inserts[0]).toMatchObject({ lisible_path: null, confiance: 'haute' })
  })

  it('les remarques de l’import se rangent une par ligne dans les notes de la pièce, dans l’ordre où elles sont dites', async () => {
    await importerFlux(ctx(), deposer(flux(), xml(cii({ acheteur: '' })), null))
    expect(journal.inserts[0].notes).toBe('Reçue de la plateforme du client — à vérifier :\n'
      + '- La facture ne dit pas le SIREN de son acheteur : rien ne vérifie qu’elle est adressée à ce dossier.\n'
      + '- Sans version lisible : La plateforme ne rend pas de version lisible de cette facture.')
  })

  it('une version lisible indisponible pour l’instant fait attendre la facture, et rien n’est déposé', async () => {
    const issue = await importerFlux(ctx(), deposer(flux(), xml(cii()), { status: 502, corps: { error: 'Indisponible.' } }))
    expect(issue).toMatchObject({ statut: 'echec', definitif: false, message: 'Indisponible.' })
    expect(journal.uploads).toEqual([])
    const perimee = await importerFlux(ctx(), deposer(flux(), xml(cii()), { status: 409, corps: { error: 'changé', perimee: true } }))
    expect(perimee).toMatchObject({ statut: 'interrompu', raison: 'perimee' })
  })

  it('une version lisible qui n’est pas un PDF n’est pas déposée', async () => {
    const issue = await importerFlux(ctx(), deposer(flux(), xml(cii()), xml('<a/>')))
    expect(issue).toMatchObject({ statut: 'echec', definitif: false, message: 'La version lisible reçue n’est pas un PDF.' })
    expect(journal.uploads).toEqual([])
  })

  it('un document qui ne correspond pas à la facture demandée n’entre pas', async () => {
    for (const alterer of [
      (d: Record<string, unknown>) => ({ ...d, hote: 'autre.exemple.fr' }),
      (d: Record<string, unknown>) => ({ ...d, flux: { ...(d.flux as FluxVu), id: 'autre' } }),
      (d: Record<string, unknown>) => ({ ...d, document: d.document === 'original' ? 'lisible' : 'original' }),
      (d: Record<string, unknown>) => ({ ...d, octets: Number(d.octets) + 1 }),
      (d: Record<string, unknown>) => ({ ...d, contenu: '%%% pas du base64 %%%' }),
      (d: Record<string, unknown>) => ({ ...d, nature: 'exe' }),
      // Annoncé vide, et vide : un document sans un octet n'est pas une facture. (Un base64 illisible et un document
      // vide sont refusés par la même vérification : rendre un contenu vide pour le premier n'y changerait rien.)
      (d: Record<string, unknown>) => ({ ...d, octets: 0, contenu: '' }),
    ]) {
      etat.alteration = alterer
      const issue = await importerFlux(ctx(), deposer(flux()))
      expect(issue).toMatchObject({ statut: 'echec', definitif: false, message: 'Le document reçu ne correspond pas à la facture demandée.' })
    }
    expect(journal.uploads).toEqual([])
  })

  it('Factur-X : le XML vient du PDF, et le PDF se lit tel quel', async () => {
    facturX.reponse = { xml: cii() }
    const f = deposer(flux({ syntaxe: 'Factur-X', nom: 'facture.pdf' }), pdf(), null)
    const issue = await importerFlux(ctx(), f)
    expect(issue).toMatchObject({ statut: 'importee', avertissements: [] })
    expect(facturX.appels).toBe(1)
    expect(journal.appels.map((a) => a.document)).toEqual(['original'])
    expect(journal.uploads).toEqual([{ chemin: expect.stringMatching(/^d1\/\d+-facture\.pdf$/), type: 'application/pdf', taille: pdf().octets.length }])
    expect(journal.inserts[0]).toMatchObject({ montant_ttc: 120, lisible_path: null, confiance: 'haute' })
  })

  it('une facture illisible s’importe sans montants, en confiance basse, et le dit', async () => {
    const f = deposer(flux({ syntaxe: 'Factur-X', nom: 'facture.pdf' }), pdf(), null)
    const issue = await importerFlux(ctx(), f)
    expect(issue).toMatchObject({
      statut: 'importee',
      avertissements: ['Facture illisible : Ce PDF ne porte pas de facture structurée (aucune pièce jointe « factur-x.xml »). Ses montants sont à saisir.'],
    })
    expect(journal.inserts[0]).toMatchObject({
      montant_ht: null, montant_tva: null, montant_ttc: null, devise: 'EUR', date_piece: null, tiers: null, confiance: 'basse',
      notes: 'Reçue de la plateforme du client — à vérifier :\n- Facture illisible : Ce PDF ne porte pas de facture structurée '
        + '(aucune pièce jointe « factur-x.xml »). Ses montants sont à saisir.',
    })
    // Aucun texte lu : la pièce n'en a pas, et « Proposer une catégorie » n'a rien à citer.
    expect(journal.textes).toEqual([])

    await importerFlux(ctx(), deposer(flux(), xml('<facture>pas une norme</facture>')))
    expect(journal.inserts[1]).toMatchObject({ montant_ttc: null, confiance: 'basse' })
    await importerFlux(ctx(), deposer(flux(), { octets: new Uint8Array([0x3c, 0x61, 0x3e, 0xe9, 0x3c, 0x2f, 0x61, 0x3e]), nature: 'xml' }))
    expect(journal.inserts[2]).toMatchObject({ montant_ttc: null, confiance: 'basse' })
  })

  it('une syntaxe annoncée qui n’est pas celle du fichier se dit', async () => {
    const issue = await importerFlux(ctx(), deposer(flux({ syntaxe: 'UBL' })))
    expect(issue).toMatchObject({ avertissements: ['La plateforme annonce une facture UBL, le fichier est en CII.'] })
    expect(journal.inserts[0]).toMatchObject({ confiance: 'moyenne' })
  })

  it('un type de document inconnu laisse la pièce sans montants', async () => {
    const issue = await importerFlux(ctx(), deposer(flux(), xml(cii({ type: '999' }))))
    expect(journal.inserts[0]).toMatchObject({ montant_ttc: null, devise: 'EUR', confiance: 'moyenne' })
    expect(issue).toMatchObject({ avertissements: ['Type de document inconnu (code 999) : le sens de ses montants n’est pas connu'] })
  })

  it('une facture en devise est convertie au cours de la BCE, comme un dépôt', async () => {
    await importerFlux(ctx(), deposer(flux(), xml(cii({ devise: 'USD' }))))
    expect(journal.inserts[0]).toMatchObject({
      devise: 'USD', montant_devise: 120, taux_change: 1.1698, conversion_source: 'bce', montant_ttc: 102.58,
    })
    // Au cours du jour de la facture, pas du jour de l'import.
    expect(journal.bce).toEqual([{ devise: 'USD', date: '2026-09-15' }])
  })

  it('une facture sans total TTC entre sans aucun montant, et le dit', async () => {
    const issue = await importerFlux(ctx(), deposer(flux(), xml(cii({ ttc: '' }))))
    expect(journal.inserts[0]).toMatchObject({ montant_ht: null, montant_tva: null, montant_ttc: null, devise: 'EUR' })
    expect(issue).toMatchObject({ statut: 'importee', avertissements: ['Total TTC absent'] })
  })

  it('un dépôt refusé : rien d’enregistré, et la version lisible refusée retire l’original', async () => {
    etat.uploadRefuse = new Set(['FA_1.xml'])
    expect(await importerFlux(ctx(), deposer(flux({ nom: 'FA-1.xml' })))).toMatchObject({ statut: 'echec', definitif: false })
    expect(journal.inserts).toEqual([])
    etat.uploadRefuse = new Set(['-lisible'])
    expect(await importerFlux(ctx(), deposer(flux({ nom: 'FA-2.xml' })))).toMatchObject({ statut: 'echec', definitif: false })
    expect(journal.retraits).toEqual([[expect.stringMatching(/FA_2\.xml$/)]])
    expect(journal.inserts).toEqual([])
  })

  it('une facture importée entre-temps : déjà là, et ses fichiers repartent', async () => {
    etat.insertErreur = { code: '23505', message: 'duplicate key value violates unique constraint "pieces_flux_unique"' }
    const contexte = ctx()
    expect(await importerFlux(contexte, deposer(flux()))).toMatchObject({ statut: 'deja_importee' })
    expect(journal.retraits).toEqual([[journal.uploads[0].chemin, journal.uploads[1].chemin]])
    expect(contexte.hashsConnus.size).toBe(0)
  })

  it('une autre écriture refusée est un échec à reprendre, et ses fichiers repartent', async () => {
    etat.insertErreur = { code: '42501', message: 'new row violates row-level security policy' }
    expect(await importerFlux(ctx(), deposer(flux()))).toMatchObject({
      statut: 'echec', definitif: false, message: 'new row violates row-level security policy',
    })
    expect(journal.retraits).toHaveLength(1)
    // Une autre contrainte unique n'est pas la facture déjà là.
    etat.insertErreur = { code: '23505', message: 'duplicate key value violates unique constraint "autre"' }
    expect(await importerFlux(ctx(), deposer(flux()))).toMatchObject({ statut: 'echec' })
  })
})

// ── La récupération entière ──────────────────────────────────────────────────────────────────────────────────────

describe('recevoirFactures', () => {
  it('importe chaque facture puis retient le point de reprise de la liste', async () => {
    const a = deposer(flux()), b = deposer(flux())
    const l = liste([a, b])
    const progres: [number, number][] = []
    const bilan = await recevoirFactures(ctx(), l, planReception(l, new Set()), (x, n) => progres.push([x, n]))
    expect(bilan.issues.map((i) => i.statut)).toEqual(['importee', 'importee'])
    expect(progres).toEqual([[0, 2], [1, 2], [2, 2]])
    expect(journal.appels.at(-1)).toEqual({ action: 'retenir', dossierId: 'd1', version: VERSION, jusqua: b.mis_a_jour })
    expect(bilan).toMatchObject({ pointDeReprise: b.mis_a_jour, erreurReprise: null, interruption: null })
  })

  it('le même fichier sous deux flux d’un même import n’entre qu’une fois', async () => {
    // Une plateforme peut transmettre deux fois la même facture : le second flux est un doublon du premier, que
    // l'import vient de déposer — l'empreinte retenue au fil de l'import le reconnaît.
    const meme = xml(cii({ numero: 'F-DOUBLE' }))
    const a = deposer(flux(), meme), b = deposer(flux(), meme)
    const l = liste([a, b])
    const bilan = await recevoirFactures(ctx(), l, planReception(l, new Set()))
    expect(bilan.issues.map((i) => i.statut)).toEqual(['importee', 'doublon'])
    expect(journal.inserts).toHaveLength(1)
    expect(journal.appels.at(-1)).toMatchObject({ action: 'retenir', jusqua: b.mis_a_jour })
  })

  it('une facture à reprendre arrête le point juste avant elle, et l’import continue après elle', async () => {
    const a = deposer(flux()), b = deposer(flux(), { status: 502, corps: { error: 'Indisponible.' } }), c = deposer(flux())
    const l = liste([a, b, c])
    const bilan = await recevoirFactures(ctx(), l, planReception(l, new Set()))
    expect(bilan.issues.map((i) => i.statut)).toEqual(['importee', 'echec', 'importee'])
    expect(journal.appels.at(-1)).toMatchObject({ action: 'retenir', jusqua: a.mis_a_jour })
  })

  it('une facture qui ne s’importera jamais ne retient pas le point', async () => {
    const a = deposer(flux({ etat: 'en_attente' })), b = deposer(flux(), {
      status: 413, corps: { error: 'trop lourd', definitif: true, raison: 'trop_lourd' },
    })
    const l = liste([a, b])
    await recevoirFactures(ctx(), l, planReception(l, new Set()))
    expect(journal.appels.at(-1)).toMatchObject({ action: 'retenir', jusqua: b.mis_a_jour })
  })

  it('une interruption arrête l’import et ne retient rien', async () => {
    const a = deposer(flux(), { status: 409, corps: { error: 'changé', perimee: true } }), b = deposer(flux())
    const l = liste([a, b])
    const bilan = await recevoirFactures(ctx(), l, planReception(l, new Set()))
    expect(bilan.issues).toHaveLength(1)
    expect(bilan.interruption).toMatchObject({ raison: 'perimee' })
    expect(journal.appels.map((x) => x.action)).not.toContain('retenir')
  })

  it('une exception pendant une facture est un échec à reprendre, et l’import continue', async () => {
    // Le cache des cours illisible fait LEVER la conversion d'une facture en devise (voir lib/tauxChange.ts).
    etat.cacheTauxRefuse = true
    const a = deposer(flux(), xml(cii({ numero: 'U-1', devise: 'USD' }))), b = deposer(flux())
    const l = liste([a, b])
    const bilan = await recevoirFactures(ctx(), l, planReception(l, new Set()))
    expect(bilan.issues.map((i) => i.statut)).toEqual(['echec', 'importee'])
    expect(bilan.issues[0]).toMatchObject({ definitif: false, message: 'Taux de change illisibles : permission denied' })
    expect(journal.inserts).toHaveLength(1)
    expect(journal.appels.at(-1)).toMatchObject({ action: 'retenir', jusqua: null })
  })

  it('un point de reprise refusé se dit, et les factures restent importées', async () => {
    etat.retenir = { status: 409, corps: { error: 'La connexion à la plateforme a changé entre-temps : relancez la récupération.', perimee: true } }
    const a = deposer(flux())
    const l = liste([a])
    const bilan = await recevoirFactures(ctx(), l, planReception(l, new Set()))
    expect(bilan).toMatchObject({
      pointDeReprise: null, erreurReprise: 'La connexion à la plateforme a changé entre-temps : relancez la récupération.',
    })
    expect(bilan.issues[0].statut).toBe('importee')
  })
})
