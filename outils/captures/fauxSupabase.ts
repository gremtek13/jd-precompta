// Faux client Supabase du banc de capture (voir vite.config.ts, vitrine.mjs) — données FICTIVES
// uniquement : aucun nom, aucun montant de ce fichier ne vient d'un dossier réel, et ce doit rester
// vrai (les vrais dossiers porteront des données de patients).
//
// Il ne simule que ce qu'un écran LIT : les filtres `eq`/`in`/`is`/`gte`/`lte` s'appliquent quand la
// colonne existe dans la ligne, `range` pagine et `count` annonce le total — sans quoi `lireTout`
// déclarerait chaque lecture incomplète et les écrans afficheraient leur bandeau au lieu de leurs
// données. Les écritures ne font rien. Une table absente d'ici est lue vide.
type Ligne = Record<string, unknown>

const MAINTENANT = '2026-09-25T08:00:00Z'

const dossiers: Ligne[] = [
  ['d1', 'Cabinet infirmier Moreau', '12345678900012', '86.90D', 'Activités des infirmiers et des sages-femmes'],
  ['d2', 'Sophie Lambert', null, null, null],
  ['d3', 'Marc Petit', null, null, null],
  ['d4', 'Julie Roux', null, null, null],
  ['d5', 'SCM Les Oliviers', null, null, null],
  ['d6', 'Thomas Girard', null, null, null],
].map(([id, nom, siret, code_naf, libelle_naf]) => ({
  id, nom, siret, code_naf, libelle_naf, cabinet_id: 'cab1', contact_nom: null, contact_email: null,
  notes: null, archive: false, created_at: '2026-01-05T09:00:00Z', code_email: id, assujetti_tva: false, adresse: null,
}))

const categories: Ligne[] = [
  ['c1', 'Télécommunications', '626000', 'frais_postaux'],
  ['c2', 'Petit matériel médical', '606300', 'achats'],
  ['c3', 'Électricité', '606100', 'eau_gaz_electricite'],
  ['c4', 'Assurances', '616000', 'assurances'],
  ['c5', 'Entretien du véhicule', '615500', 'entretien'],
  ['c6', 'Loyer', '613200', 'loyer'],
  ['c7', 'Fournitures de bureau', '606400', 'fournitures'],
].map(([id, libelle, compte_comptable, poste_2035], i) => ({
  id, libelle, compte_comptable, poste_2035, code: String(id), dossier_id: null, ordre: i,
}))

function piece(id: string, date: string, tiers: string, ttc: number, tva: number, categorie: string | null, statut: string): Ligne {
  return {
    id, dossier_id: 'd1', uploaded_by: null, source: 'upload', storage_path: `d1/${id}.pdf`, nom_fichier: `${id}.pdf`,
    storage_hash: null, date_piece: date, tiers, montant_ht: Math.round((ttc - tva) * 100) / 100, montant_tva: tva,
    montant_ttc: ttc, devise: 'EUR', montant_devise: null, taux_change: null, conversion_source: null,
    categorie_id: categorie, sous_dossier_id: null, type_piece: 'achat', statut, notes: null, confiance: 'haute',
    superpdp_invoice_id: null, created_at: `${date}T10:00:00Z`, updated_at: MAINTENANT,
  }
}

const pieces: Ligne[] = [
  piece('p1', '2026-09-12', 'Télécom Plus', 39.99, 6.67, 'c1', 'a_valider'),
  piece('p2', '2026-09-10', 'Pharma Distrib Sud', 186.4, 31.07, 'c2', 'a_valider'),
  piece('p3', '2026-09-05', 'Énergie Services', 84.2, 14.03, 'c3', 'validee'),
  piece('p4', '2026-09-02', 'Assurance Pro Santé', 312, 0, 'c4', 'validee'),
  piece('p5', '2026-08-28', 'Garage du Centre', 245.6, 40.93, 'c5', 'a_valider'),
  piece('p6', '2026-08-25', 'SCI Les Tilleuls', 650, 0, 'c6', 'validee'),
  piece('p7', '2026-08-21', 'Papeterie Moderne', 27.35, 4.56, 'c7', 'validee'),
  piece('p8', '2026-08-18', 'LogiSoins', 29, 4.83, null, 'a_valider'),
]

function ligne(id: string, date: string, libelle: string, montant: number, statut: string, pieceId: string | null): Ligne {
  return {
    id, dossier_id: 'd1', date, libelle, montant, statut, piece_id: pieceId, cotisation_id: null,
    prelevement_personnel: false, source_fichier: 'releve-septembre.csv', libelle_brut: null, created_at: MAINTENANT,
  }
}

// Une conversation d'assistant, pour photographier le panneau de droite ouvert — mêmes données
// fictives que le reste (Télécom Plus, LogiSoins) : le texte des réponses est écrit ici, jamais tiré
// d'un vrai échange.
function message(n: number, role: 'user' | 'assistant', texte: string, outils: string[] | null = null): Ligne {
  return {
    id: `m${n}`, dossier_id: 'd1', conversation_id: 'c1', role, texte, outils_utilises: outils,
    tokens_entree: null, tokens_sortie: null, created_by: 'u1', created_at: `2026-09-25T07:5${n}:00Z`,
  }
}

const TABLES: Record<string, Ligne[]> = {
  agent_conversations: [
    message(1, 'user', 'Qu’est-ce qui reste à faire sur ce dossier ?'),
    message(2, 'assistant', '4 justificatifs sont à valider et 2 mouvements bancaires à rapprocher. Le prélèvement du 15/09 de Télécom Plus (39,99 €) correspond à la pièce du 12/09 : même montant, 3 jours d’écart.', ['points_a_traiter', 'lister_pieces']),
    message(3, 'user', 'Il reste une pièce sans catégorie ?'),
    message(4, 'assistant', 'Oui, une seule : LogiSoins, 29,00 € le 18/08/2026. C’est un abonnement de logiciel : une catégorie « Logiciels et abonnements » conviendrait.', ['lister_pieces']),
  ],
  cabinet_admins: [{ user_id: 'u1', cabinet_id: 'cab1', role: 'comptable_en_chef' }],
  cabinets: [{ id: 'cab1', nom: 'JD Consult', couleur_primaire: null, police_google_font: null, logo_storage_path: null }],
  dossiers,
  categories,
  pieces,
  lignes_bancaires: [
    ligne('l1', '2026-09-15', 'PRLV SEPA TELECOM PLUS', -39.99, 'non_rapprochee', null),
    ligne('l2', '2026-09-11', 'CB PHARMA DISTRIB SUD', -186.4, 'non_rapprochee', null),
    ligne('l3', '2026-09-08', 'VIR CPAM TIERS PAYANT', 2418.6, 'non_rapprochee', null),
    ligne('l4', '2026-09-06', 'PRLV ENERGIE SERVICES', -84.2, 'rapprochee', 'p3'),
    ligne('l5', '2026-09-03', 'PRLV ASSURANCE PRO SANTE', -312, 'rapprochee', 'p4'),
    ligne('l6', '2026-09-01', 'PRLV SCI LES TILLEULS', -650, 'rapprochee', 'p6'),
    // Face à une pièce VALIDÉE (p7) : c'est la seule forme d'une « Pièce proposée » dans le panneau
    // d'un mouvement, une proposition ne portant que sur ce que le cabinet a relu.
    ligne('l7', '2026-08-24', 'CB PAPETERIE MODERNE', -27.35, 'non_rapprochee', null),
  ],
}

type Filtre = (l: Ligne) => boolean

function requete(table: string) {
  const filtres: Filtre[] = []
  let tete = false
  let unique: 'single' | 'maybe' | null = null
  let debut = 0
  let fin = Number.MAX_SAFE_INTEGER
  const sur = (col: string, test: (v: unknown) => boolean): Filtre => (l) => !(col in l) || test(l[col])
  const chaine: Record<string, unknown> = {}
  const soi = () => chaine
  Object.assign(chaine, {
    select: (_c?: string, options?: { head?: boolean }) => { tete = !!options?.head; return chaine },
    insert: soi, update: soi, upsert: soi, delete: soi,
    eq: (c: string, v: unknown) => { filtres.push(sur(c, (x) => x === v)); return chaine },
    neq: (c: string, v: unknown) => { filtres.push(sur(c, (x) => x !== v)); return chaine },
    in: (c: string, vs: unknown[]) => { filtres.push(sur(c, (x) => vs.includes(x))); return chaine },
    is: (c: string, v: unknown) => { filtres.push(sur(c, (x) => x === v)); return chaine },
    not: (c: string, op: string, v: unknown) => { filtres.push(sur(c, (x) => (op === 'is' ? x !== v : true))); return chaine },
    gte: (c: string, v: string) => { filtres.push(sur(c, (x) => x == null || String(x) >= v)); return chaine },
    lte: (c: string, v: string) => { filtres.push(sur(c, (x) => x == null || String(x) <= v)); return chaine },
    gt: soi, lt: soi, like: soi, ilike: soi, or: soi, filter: soi, match: soi, contains: soi, order: soi, limit: soi,
    range: (d: number, f: number) => { debut = d; fin = f; return chaine },
    single: () => { unique = 'single'; return chaine },
    maybeSingle: () => { unique = 'maybe'; return chaine },
    then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => {
      const lignes = (TABLES[table] ?? []).filter((l) => filtres.every((f) => f(l)))
      let reponse: unknown
      if (unique) reponse = { data: lignes[0] ?? null, error: null }
      else if (tete) reponse = { data: null, error: null, count: lignes.length }
      else reponse = { data: lignes.slice(debut, fin + 1), error: null, count: lignes.length }
      return Promise.resolve(reponse).then(suite, echec)
    },
  })
  return chaine
}

const session = { user: { id: 'u1', email: 'cabinet@exemple.fr' }, access_token: 'faux' }

export const supabase = {
  auth: {
    getSession: () => Promise.resolve({ data: { session }, error: null }),
    getUser: () => Promise.resolve({ data: { user: session.user }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: () => Promise.resolve({ error: null }),
  },
  rpc: () => Promise.resolve({ data: false, error: null }),
  from: (table: string) => requete(table),
  storage: {
    from: () => ({
      getPublicUrl: () => ({ data: { publicUrl: '' } }),
      createSignedUrl: () => Promise.resolve({ data: null, error: { message: 'maquette' } }),
      download: () => Promise.resolve({ data: null, error: { message: 'maquette' } }),
      list: () => Promise.resolve({ data: [], error: null }),
      upload: () => Promise.resolve({ data: null, error: { message: 'maquette' } }),
      remove: () => Promise.resolve({ data: null, error: null }),
    }),
  },
  functions: { invoke: () => Promise.resolve({ data: null, error: { message: 'maquette' } }) },
}
