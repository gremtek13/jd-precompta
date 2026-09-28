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

// Logo du cabinet : aucun par défaut. Le banc d'installabilité (installable.mjs) en pose un, par une
// clé du stockage local écrite avant le chargement, pour éprouver le manifeste que reçoit un cabinet
// qui a son logo — celui des deux qui n'était pas installable. La valeur est l'adresse du logo.
const LOGO_DU_BANC = typeof localStorage === 'undefined' ? null : localStorage.getItem('banc-logo')

const dossiers: Ligne[] = [
  ['d1', 'Cabinet infirmier Moreau', '12345678900012', '86.90D', 'Activités des infirmiers et des sages-femmes'],
  ['d2', 'Sophie Lambert', null, null, null],
  ['d3', 'Marc Petit', null, null, null],
  ['d4', 'Julie Roux', null, null, null],
  ['d5', 'SCM Les Oliviers', null, null, null],
  ['d6', 'Thomas Girard', null, null, null],
  // Le seul dossier assujetti à la TVA du banc : un conseil qui facture et encaisse par virement.
  // C'est lui que montre l'onglet TVA (voir TVA_D7 plus bas) ; le cabinet infirmier, exonéré comme
  // toute infirmière, n'a pas de déclaration à déposer.
  ['d7', 'Atelier Bernard Conseil', '98765432100015', '70.22Z', 'Conseil pour les affaires et autres conseils de gestion'],
].map(([id, nom, siret, code_naf, libelle_naf]) => ({
  id, nom, siret, code_naf, libelle_naf, cabinet_id: 'cab1', contact_nom: null, contact_email: null,
  notes: null, archive: false, created_at: '2026-01-05T09:00:00Z', code_email: id, assujetti_tva: id === 'd7', adresse: null,
  tva_periodicite: 'trimestrielle', tva_sur_debits: false,
}))

const categories: Ligne[] = [
  ['c1', 'Télécommunications', '626000', 'frais_postaux'],
  ['c2', 'Petit matériel médical', '606300', 'achats'],
  ['c3', 'Électricité', '606100', 'eau_gaz_electricite'],
  ['c4', 'Assurances', '616000', 'assurances'],
  ['c5', 'Entretien du véhicule', '615500', 'entretien'],
  ['c6', 'Loyer', '613200', 'loyer'],
  ['c7', 'Fournitures de bureau', '606400', 'fournitures'],
  ['c8', 'Logiciels et abonnements', '651000', 'frais_divers'],
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

// Les pièces du dossier assujetti (d7), sur les deuxième et troisième trimestres 2026 : la déclaration
// que l'onglet TVA propose dépend du jour où le banc tourne (la dernière période close), et chacun des
// deux trimestres porte des recettes, des achats, et le second une recette qu'aucun paiement ne date.
function pieceTva(id: string, date: string, tiers: string, ht: number, tva: number, type: 'achat' | 'vente'): Ligne {
  return {
    id, dossier_id: 'd7', uploaded_by: null, source: 'upload', storage_path: `d7/${id}.pdf`, nom_fichier: `${id}.pdf`,
    storage_hash: null, date_piece: date, tiers, montant_ht: ht, montant_tva: tva, montant_ttc: Math.round((ht + tva) * 100) / 100,
    devise: 'EUR', montant_devise: null, taux_change: null, conversion_source: null, categorie_id: null,
    sous_dossier_id: null, type_piece: type, statut: 'validee', notes: null, confiance: 'haute',
    superpdp_invoice_id: null, created_at: `${date}T10:00:00Z`, updated_at: MAINTENANT,
  }
}

function paiementTva(id: string, date: string, libelle: string, montant: number, pieceId: string): Ligne {
  return {
    id, dossier_id: 'd7', date, libelle, montant, statut: 'rapprochee', piece_id: pieceId, cotisation_id: null,
    prelevement_personnel: false, source_fichier: 'releve-2026.csv', libelle_brut: null, created_at: MAINTENANT,
  }
}

const TVA_D7 = {
  pieces: [
    pieceTva('v1', '2026-04-30', 'Société Delta', 4000, 800, 'vente'),
    pieceTva('a1', '2026-06-01', 'Espace Pro — loyer du bureau', 900, 180, 'achat'),
    pieceTva('a2', '2026-06-18', 'Techno Plus — ordinateur portable', 1500, 300, 'achat'),
    pieceTva('v2', '2026-07-31', 'Groupe Hélios', 2500, 500, 'vente'),
    pieceTva('a3', '2026-07-15', 'Logiciel de facturation', 50, 10, 'achat'),
    pieceTva('v3', '2026-09-10', 'Cabinet Vasseur', 1200, 240, 'vente'),
  ],
  lignes: [
    paiementTva('t1', '2026-05-15', 'VIR SOCIETE DELTA', 4800, 'v1'),
    paiementTva('t2', '2026-06-05', 'PRLV ESPACE PRO', -1080, 'a1'),
    paiementTva('t3', '2026-06-20', 'CB TECHNO PLUS', -1800, 'a2'),
    paiementTva('t4', '2026-08-14', 'VIR GROUPE HELIOS', 3000, 'v2'),
    paiementTva('t5', '2026-07-20', 'PRLV LOGICIEL FACTURATION', -60, 'a3'),
  ],
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

// Une ouverture reprise d'un autre logiciel (voir lib/aNouveaux.ts) : c'est elle qui fait paraître la
// note d'ouverture des Écritures et de la Balance des comptes, la ligne « Depuis l'ouverture » de la
// trésorerie et le bloc « Ouverture enregistrée » des Informations. Équilibrée au centime, comme la
// base l'exige.
function aNouveau(id: string, compte: string, compteOrigine: string, libelle: string, sens: 'debit' | 'credit', montant: number): Ligne {
  return {
    id, dossier_id: 'd1', date: '2026-01-01', compte, compte_origine: compteOrigine, libelle, sens, montant,
    source_nom: 'balance-2025.csv', source_empreinte: '0'.repeat(64), created_at: MAINTENANT,
  }
}

const TABLES: Record<string, Ligne[]> = {
  a_nouveaux: [
    aNouveau('an1', '512000', '51210000', 'Banque Populaire', 'debit', 8400),
    aNouveau('an2', '2154', '2154', 'Matériel médical', 'debit', 3200),
    aNouveau('an3', '28154', '28154', 'Amortissements du matériel médical', 'credit', 1280),
    aNouveau('an4', '164', '164', 'Emprunt matériel', 'credit', 2400),
    aNouveau('an5', '108', '108', 'Compte de l’exploitant', 'credit', 7920),
  ],
  agent_conversations: [
    message(1, 'user', 'Qu’est-ce qui reste à faire sur ce dossier ?'),
    message(2, 'assistant', '4 justificatifs sont à valider et 2 mouvements bancaires à rapprocher. Le prélèvement du 15/09 de Télécom Plus (39,99 €) correspond à la pièce du 12/09 : même montant, 3 jours d’écart.', ['points_a_traiter', 'lister_pieces']),
    message(3, 'user', 'Il reste une pièce sans catégorie ?'),
    message(4, 'assistant', 'Oui, une seule : LogiSoins, 29,00 € le 18/08/2026. C’est un abonnement de logiciel : une catégorie « Logiciels et abonnements » conviendrait.', ['lister_pieces']),
  ],
  cabinet_admins: [{ user_id: 'u1', cabinet_id: 'cab1', role: 'comptable_en_chef' }],
  cabinets: [{ id: 'cab1', nom: 'JD Consult', couleur_primaire: null, police_google_font: null, logo_storage_path: LOGO_DU_BANC ? 'cab1/logo.png' : null }],
  dossiers,
  categories,
  pieces: [...pieces, ...TVA_D7.pieces],
  // L'ordinateur du dossier d7 est immobilisé : sa TVA va en ligne 19 de la CA3, pas en 20.
  immobilisations: [{
    id: 'i-d7', dossier_id: 'd7', piece_id: 'a2', nature_id: null, libelle: 'Ordinateur portable', valeur: 1500,
    date_acquisition: '2026-06-18', duree_annees: 3, created_at: MAINTENANT,
  }],
  // La déclaration du premier trimestre, déposée : l'historique de l'onglet TVA la compare au calcul.
  declarations_tva: [{
    id: 'dt1', dossier_id: 'd7', periode_debut: '2026-01-01', periode_fin: '2026-03-31', tva_declaree: 0,
    credit_anterieur: 0, date_declaration: '2026-04-18', notes: null, created_at: '2026-04-18T09:00:00Z',
  }],
  // Le texte « lu » de la seule pièce sans catégorie : c'est ce qui fait offrir « Proposer une
  // catégorie » dans sa fiche. Écrit ici, fictif comme le reste.
  piece_textes_ocr: [{
    id: 't8', dossier_id: 'd1', piece_id: 'p8', document_id: null,
    texte: 'LOGISOINS SAS\nFacture n° 2026-0818\nAbonnement mensuel LogiSoins Premium — gestion des tournées et télétransmission\nTotal TTC 29,00 €',
  }],
  // Le volet social de l'exercice que Clôture affiche, déjà saisi : c'est ce qui fait paraître les
  // rubriques et l'estimation des cotisations dans les captures, au lieu d'un formulaire vide.
  volet_social_pamc: [{
    id: 'vs1', dossier_id: 'd1', annee: 2026, profession: 'auxiliaire_medical', remplacant: false,
    recettes_brutes: 64_000, honoraires_conventionnes: 61_500, depassements: 0, recettes_structures: null,
  }],
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
    ...TVA_D7.lignes,
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
      getPublicUrl: () => ({ data: { publicUrl: LOGO_DU_BANC ?? '' } }),
      createSignedUrl: () => Promise.resolve({ data: null, error: { message: 'maquette' } }),
      download: () => Promise.resolve({ data: null, error: { message: 'maquette' } }),
      list: () => Promise.resolve({ data: [], error: null }),
      upload: () => Promise.resolve({ data: null, error: { message: 'maquette' } }),
      remove: () => Promise.resolve({ data: null, error: null }),
    }),
  },
  // « Proposer une catégorie » répond une proposition retenue, avec un extrait LONG : c'est lui qui
  // éprouve le passage à la ligne dans le volet. Tout le reste reste une maquette.
  functions: {
    invoke: (nom: string) => Promise.resolve(nom === 'proposer-categorie'
      ? { data: { issue: 'retenue', categorieId: 'c8', indice: 'Abonnement mensuel LogiSoins Premium — gestion des tournées et télétransmission' }, error: null }
      : { data: null, error: { message: 'maquette' } }),
  },
}
