import { beforeEach, describe, expect, it, vi } from 'vitest'

// Le client Supabase est simulé, mais pas en rendant des réponses toutes faites : le faux client
// ci-dessous est un petit moteur qui filtre, trie et découpe pour de bon. C'est la seule façon de
// prouver ce qui compte ici — qu'une lecture en tranches recolle sans doublon ni trou, qu'un tri sur
// la mauvaise colonne se voie, et qu'un filtre écartant les lignes partagées se voie aussi. Un faux
// client rendant des tableaux figés testerait la forme des appels, pas leur résultat.

type Ligne = Record<string, unknown>

const base = {
  tables: {} as Record<string, Ligne[]>,
  // Permet de faire mentir la base sur son propre compte, ce qu'une écriture concurrente produit.
  compteAnnonce: {} as Record<string, number>,
  // Et permet de la faire TAIRE sur son propre compte, ce qu'aucun test n'exerçait : `compteAnnonce`
  // ne sait dire qu'un nombre, et le faux retombait sur `lignes.length`. Or « la base n'annonce
  // rien » est un cas distinct de « la base annonce autre chose », et c'est celui qui laissait
  // passer une sauvegarde amputée.
  sansCompte: new Set<string>(),
  erreur: null as Error | null,
  // Faire échouer UNE table et pas toutes : une erreur globale n'atteint jamais la lecture des
  // tables, la première requête sur `dossiers` s'arrêtant avant.
  erreurParTable: {} as Record<string, Error>,
}
const journal: { table: string; filtres: string[]; tri: string[] }[] = []
// Les écritures, à part : le contrôle qui compte sur un refus est « RIEN n'a été écrit », et un
// journal de lectures ne peut pas le dire.
const ecritures: { table: string; action: 'insert' | 'update'; nb: number }[] = []

function appliquerFiltre(lignes: Ligne[], filtre: string): Ligne[] {
  const [type, reste] = [filtre.slice(0, filtre.indexOf(':')), filtre.slice(filtre.indexOf(':') + 1)]
  if (type === 'eq') {
    const [colonne, valeur] = reste.split('=')
    return lignes.filter((l) => String(l[colonne]) === valeur)
  }
  if (type === 'is') {
    const [colonne] = reste.split('=')
    return lignes.filter((l) => l[colonne] == null)
  }
  if (type === 'in') {
    const [colonne, valeurs] = reste.split('=')
    const admis = new Set(valeurs.split('|'))
    return lignes.filter((l) => admis.has(String(l[colonne])))
  }
  // `or` : la syntaxe PostgREST « colonne.op.valeur,colonne.op.valeur ».
  const conditions = reste.split(',')
  return lignes.filter((l) =>
    conditions.some((c) => {
      const [colonne, op, valeur] = c.split('.')
      if (op === 'is' && valeur === 'null') return l[colonne] == null
      return String(l[colonne]) === valeur
    }),
  )
}

function constructeur(table: string) {
  const filtres: string[] = []
  const tri: string[] = []
  const executer = (debut: number, fin: number) => {
    const erreur = base.erreurParTable[table] ?? base.erreur
    if (erreur) return Promise.resolve({ data: null, error: erreur, count: null })
    journal.push({ table, filtres: [...filtres], tri: [...tri] })
    let lignes = base.tables[table] ?? []
    for (const f of filtres) lignes = appliquerFiltre(lignes, f)
    // Tri UNIQUEMENT sur les colonnes demandées : si le code sous test trie sur une colonne qui
    // n'existe pas, l'ordre reste celui du tableau et les tranches se chevauchent, exactement comme
    // le ferait Postgres. C'est ce qui rend le défaut visible au lieu de le masquer.
    if (tri.length > 0) {
      lignes = [...lignes].sort((a, b) =>
        tri.map((c) => String(a[c] ?? '')).join('\u0000').localeCompare(tri.map((c) => String(b[c] ?? '')).join('\u0000')),
      )
    }
    const total = base.sansCompte.has(table) ? null : base.compteAnnonce[table] ?? lignes.length
    return Promise.resolve({ data: lignes.slice(debut, fin + 1), error: null, count: total })
  }
  const chaine = {
    eq: (colonne: string, valeur: unknown) => { filtres.push(`eq:${colonne}=${String(valeur)}`); return chaine },
    or: (expression: string) => { filtres.push(`or:${expression}`); return chaine },
    in: (colonne: string, valeurs: string[]) => { filtres.push(`in:${colonne}=${valeurs.join('|')}`); return chaine },
    is: (colonne: string) => { filtres.push(`is:${colonne}=null`); return chaine },
    order: (colonne: string) => { tri.push(colonne); return chaine },
    range: executer,
    maybeSingle: async () => {
      const { data, error } = await executer(0, 0)
      return { data: data?.[0] ?? null, error }
    },
  }
  return chaine
}

// L'écriture du faux client modifie vraiment ses tables : c'est ce qui permet de faire tourner un
// aller-retour complet — exporter, vider, restaurer, puis vérifier par une relecture. Un faux client
// qui se contente de noter les appels ne peut pas prouver qu'une restauration rend le dossier
// d'origine ; il ne prouve que la forme des requêtes.
function ecrivain(table: string) {
  return {
    insert: (lignes: Ligne[]) => {
      const erreur = base.erreurParTable[table] ?? base.erreur
      if (erreur) return Promise.resolve({ error: erreur })
      ecritures.push({ table, action: 'insert', nb: lignes.length })
      base.tables[table] = [...(base.tables[table] ?? []), ...lignes.map((l) => ({ ...l }))]
      return Promise.resolve({ error: null })
    },
    update: (patch: Ligne) => ({
      eq: (colonne: string, valeur: unknown) => {
        const erreur = base.erreurParTable[table] ?? base.erreur
        if (erreur) return Promise.resolve({ error: erreur })
        ecritures.push({ table, action: 'update', nb: 1 })
        for (const ligne of base.tables[table] ?? []) {
          if (String(ligne[colonne]) === String(valeur)) Object.assign(ligne, patch)
        }
        return Promise.resolve({ error: null })
      },
    }),
  }
}

vi.mock('./supabase', () => ({
  supabase: { from: (table: string) => ({ select: () => constructeur(table), ...ecrivain(table) }) },
}))

const { exporterDossier, restaurerSauvegarde, verifierRestauration, TAILLE_PAGE, VERSION_SAUVEGARDE } =
  await import('./sauvegardeDonnees')

const DOSSIER = 'd1'
const CABINET = 'cab1'

beforeEach(() => {
  base.tables = { dossiers: [{ id: DOSSIER, nom: 'Cabinet Martin', cabinet_id: CABINET }] }
  base.compteAnnonce = {}
  base.sansCompte = new Set()
  base.erreur = null
  base.erreurParTable = {}
  journal.length = 0
  ecritures.length = 0
})

describe('export d’un dossier', () => {
  it('rend un manifeste qui dit ce qu’il a lu et ce qu’il n’a pas lu', async () => {
    base.tables.pieces = [{ id: 'p1', dossier_id: DOSSIER, uploaded_by: 'u1' }]
    const { manifeste, contenu } = await exporterDossier(DOSSIER)

    expect(manifeste.dossierNom).toBe('Cabinet Martin')
    expect(manifeste.cabinetId).toBe(CABINET)
    expect(manifeste.lignesParTable.pieces).toBe(1)
    expect(contenu.pieces).toHaveLength(1)
    // Ce qu'une sauvegarde de données ne remplace pas doit être écrit, pas sous-entendu : les
    // fichiers, les comptes et la ligne du cabinet.
    expect(manifeste.horsPerimetre).toHaveLength(3)
    expect(manifeste.comptes.facultatifs).toEqual(['u1'])
    expect(manifeste.referencesExternes).toEqual([
      { table: 'dossiers', colonne: 'cabinet_id', parent: 'cabinets', valeurs: [CABINET] },
    ])
  })

  it('recolle une table plus grande qu’une tranche, sans doublon ni trou', async () => {
    // Le cas que la production atteint déjà : 954 mouvements bancaires sur le dossier réel, pour une
    // tranche de 500. Les identifiants sont numérotés à largeur fixe pour que le tri lexicographique
    // du faux client corresponde à un ordre total, comme en base.
    const total = TAILLE_PAGE * 2 + 37
    base.tables.lignes_bancaires = Array.from({ length: total }, (_, i) => ({
      id: `l${String(i).padStart(6, '0')}`,
      dossier_id: DOSSIER,
    }))

    const { contenu } = await exporterDossier(DOSSIER)
    expect(contenu.lignes_bancaires).toHaveLength(total)
    expect(new Set(contenu.lignes_bancaires.map((l) => l.id)).size).toBe(total)
  })

  it('trie sur la clé primaire réelle, pas sur « id »', async () => {
    // Trois tables du plan n'ont pas de colonne `id` du tout. Trier dessus rendrait un ordre
    // arbitraire, donc des tranches qui se chevauchent — et en base, une erreur PostgREST.
    base.tables.superpdp_credentials = [{ dossier_id: DOSSIER, client_id: 'x' }]
    await exporterDossier(DOSSIER)
    expect(journal.find((a) => a.table === 'superpdp_credentials')?.tri).toEqual(['dossier_id'])
    expect(journal.find((a) => a.table === 'facture_numerotation')?.tri).toEqual(['dossier_id', 'annee', 'type'])
    expect(journal.find((a) => a.table === 'pieces')?.tri).toEqual(['id'])
  })

  it('emporte les catégories partagées que le dossier utilise', async () => {
    // Le défaut corrigé, vérifié de bout en bout : les catégories du cabinet portent un `dossier_id`
    // nul. Lues avec un `eq`, elles sortent toutes de l'export, et la restauration bute sur les
    // pièces qui les pointent.
    base.tables.categories = [
      { id: 'c-partagee', dossier_id: null, nom: 'Honoraires' },
      // Le schéma autorise aussi une catégorie propre au dossier, même si le cabinet réel n'en a
      // aucune aujourd'hui. Ne lire QUE les partagées la perdrait — l'envers exact du défaut.
      { id: 'c-du-dossier', dossier_id: DOSSIER, nom: 'Propre à ce dossier' },
      { id: 'c-autre-dossier', dossier_id: 'd2', nom: 'Propre à un autre' },
    ]
    base.tables.pieces = [{ id: 'p1', dossier_id: DOSSIER, categorie_id: 'c-partagee' }]

    const { contenu, manifeste } = await exporterDossier(DOSSIER)
    expect(contenu.categories.map((c) => c.id).sort()).toEqual(['c-du-dossier', 'c-partagee'])
    // Et la preuve que ça suffit : aucun lien perdu, donc la restauration ne butera pas.
    expect(manifeste.liensPerdus).toEqual([])
  })

  it('signale la catégorie manquante plutôt que de la taire', async () => {
    // Si malgré tout une pièce pointait une catégorie absente, le manifeste doit le porter — c'est le
    // seul moment où quelqu'un le lira avant qu'il ne soit trop tard.
    base.tables.pieces = [{ id: 'p1', dossier_id: DOSSIER, categorie_id: 'c-disparue' }]
    base.tables.categories = []
    const { manifeste } = await exporterDossier(DOSSIER)
    expect(manifeste.liensPerdus).toEqual([
      { table: 'pieces', colonne: 'categorie_id', parent: 'categories', valeur: 'c-disparue', effacable: false },
    ])
  })

  it('lit les lignes de facture par leurs factures, qu’il vient de lire', async () => {
    // `facture_lignes` n'a pas de `dossier_id`. Lue « en direct », elle rendrait zéro ligne sans
    // erreur : toutes les lignes de facture perdues, en silence.
    base.tables.factures_emises = [{ id: 'f1', dossier_id: DOSSIER }]
    base.tables.facture_lignes = [
      { id: 'fl1', facture_id: 'f1' },
      { id: 'fl2', facture_id: 'f-autre-dossier' },
    ]
    const { contenu } = await exporterDossier(DOSSIER)
    expect(contenu.facture_lignes.map((l) => l.id)).toEqual(['fl1'])
  })

  it('découpe la liste des parents, et recolle les tranches', async () => {
    // PostgREST passe les valeurs d'un `in` dans l'URL : une liste de plusieurs centaines produit une
    // requête que le serveur refuse. Le découpage ne doit décider de rien — ni du nombre de lignes
    // rendues, ni du succès.
    const nbFactures = 470
    base.tables.factures_emises = Array.from({ length: nbFactures }, (_, i) => ({
      id: `f${String(i).padStart(6, '0')}`,
      dossier_id: DOSSIER,
    }))
    base.tables.facture_lignes = base.tables.factures_emises.map((f, i) => ({
      id: `fl${String(i).padStart(6, '0')}`,
      facture_id: f.id,
    }))

    const { contenu } = await exporterDossier(DOSSIER)
    expect(contenu.facture_lignes).toHaveLength(nbFactures)
    expect(new Set(contenu.facture_lignes.map((l) => l.id)).size).toBe(nbFactures)
    // Trois tranches de 200 au plus, donc au moins trois requêtes : la preuve que le découpage a bien
    // eu lieu, et pas qu'une liste entière est passée d'un coup.
    expect(journal.filter((a) => a.table === 'facture_lignes').length).toBeGreaterThanOrEqual(3)
  })

  it('n’interroge pas la base pour une table dont le parent est vide', async () => {
    // Un `in` sur une liste vide est une requête inutile, et surtout un `in ()` que PostgREST peut
    // refuser. Le dossier sans facture est le cas courant, pas l'exception.
    base.tables.factures_emises = []
    await exporterDossier(DOSSIER)
    expect(journal.some((a) => a.table === 'facture_lignes')).toBe(false)
  })

  it('refuse une sauvegarde que la base ne confirme pas', async () => {
    // Une écriture pendant la lecture rend un instantané déchiré, cohérent nulle part. Le compte
    // annoncé et le nombre de lignes recollées doivent coïncider, sinon on recommence. Une sauvegarde
    // qu'on ne peut pas dire complète est pire qu'une absence de sauvegarde : elle rassure.
    base.tables.pieces = [{ id: 'p1', dossier_id: DOSSIER }]
    base.compteAnnonce.pieces = 2
    await expect(exporterDossier(DOSSIER)).rejects.toThrow(/annonce 2 lignes et 1 ont été lues/)
  })

  it('refuse une sauvegarde dont la base n’a annoncé AUCUN total', async () => {
    // LE DÉFAUT D'ORIGINE (22/09/2026) : le contrôle voisin ne se déclenchait QUE sur un compte
    // annoncé (`annonce != null && annonce !== lignes.length`). Sans total, la boucle s'arrête sur
    // une tranche plus courte que demandée — un indice de fin FAIBLE, qu'un plafond serveur plus bas
    // que `TAILLE_PAGE` produit aussi — et la sauvegarde repartait amputée sans un mot.
    //
    // `lireTout` tranchait déjà ce cas dans l'autre sens depuis toujours (`complete: false`) : le
    // dépôt était donc plus strict sur un BANDEAU d'écran que sur le fichier dont on restaure.
    base.tables.pieces = [{ id: 'p1', dossier_id: DOSSIER }]
    base.sansCompte.add('pieces')
    await expect(exporterDossier(DOSSIER)).rejects.toThrow(/n'a annoncé aucun total/)
  })

  it('n’exige pas de compte là où la base en donne un, même à zéro', async () => {
    // GARDE SYMÉTRIQUE, et elle est indispensable : sans elle, « refuse ce qu'elle ne peut pas dire
    // complet » serait satisfait par un socle qui refuse TOUTE sauvegarde. Une table vide annonce
    // bien `0`, ce qui n'est pas « rien annoncé ».
    base.tables.pieces = []
    await expect(exporterDossier(DOSSIER)).resolves.toBeDefined()
  })

  it('refuse un dossier introuvable au lieu de rendre un fichier vide', async () => {
    // Une lecture refusée par RLS rend `null` sans erreur, exactement comme un dossier inexistant.
    // Sans ce test, l'export produirait une sauvegarde vide en se disant réussi — et on ne s'en
    // apercevrait qu'en essayant de la restaurer.
    await expect(exporterDossier('d-inconnu')).rejects.toThrow(/introuvable ou inaccessible/)
  })

  it('remonte l’erreur de la base plutôt que de l’avaler', async () => {
    // L'erreur porte sur UNE table, pas sur toutes : une erreur globale arrêterait l'export sur la
    // première requête et ne prouverait rien de ce qui se passe au milieu d'une lecture. Or c'est
    // exactement là que le danger est : une table refusée par RLS, avalée, rendrait une sauvegarde
    // amputée de cette table-là et se dirait réussie.
    base.tables.pieces = [{ id: 'p1', dossier_id: DOSSIER }]
    base.erreurParTable.pieces = new Error('permission denied for table pieces')
    await expect(exporterDossier(DOSSIER)).rejects.toThrow(/permission denied/)
  })

  it('annonce sa progression table par table', async () => {
    const vues: string[] = []
    await exporterDossier(DOSSIER, (_fait, _total, table) => { if (table) vues.push(table) })
    expect(vues[0]).toBe('dossiers')
    expect(vues).toContain('pieces')
    // Le parent avant l'enfant, sans quoi la lecture par parent se ferait sur une liste vide.
    expect(vues.indexOf('factures_emises')).toBeLessThan(vues.indexOf('facture_lignes'))
  })
})

describe('restauration', () => {
  // La base « d'arrivée » : le cabinet existe, le dossier non. C'est la situation réelle d'une
  // reprise — on recrée le cabinet, puis on remet ses dossiers.
  function baseVide() {
    base.tables = { cabinets: [{ id: CABINET, nom: 'JD Consult' }], dossiers: [] }
  }

  it('refait le dossier à l’identique, et le prouve en le relisant', async () => {
    // L'aller-retour complet, et le seul verdict qui compte : exporter, vider, restaurer, relire.
    // La vérification passe par le chemin d'export plutôt que par un compteur tenu pendant
    // l'écriture — un compteur ne mesure que ce que le code croit avoir fait.
    base.tables.categories = [{ id: 'c1', dossier_id: null, nom: 'Honoraires' }]
    base.tables.pieces = [
      { id: 'p1', dossier_id: DOSSIER, categorie_id: 'c1', montant_ttc: 120 },
      { id: 'p2', dossier_id: DOSSIER, categorie_id: null, montant_ttc: 45 },
    ]
    base.tables.lignes_bancaires = [{ id: 'l1', dossier_id: DOSSIER, piece_id: 'p1', montant: -120 }]
    base.tables.ecritures_brouillon = [{ id: 'e1', dossier_id: DOSSIER, piece_id: 'p1', ligne_bancaire_id: 'l1' }]
    const sauvegarde = await exporterDossier(DOSSIER)

    const categoriesAvant = base.tables.categories
    baseVide()
    // La catégorie partagée survit à la perte du dossier : elle appartient au cabinet.
    base.tables.categories = categoriesAvant

    const resultat = await restaurerSauvegarde(sauvegarde)
    expect(resultat.lignesParTable.pieces).toBe(2)
    expect(resultat.partageesConservees).toBe(1)
    // Et surtout : la catégorie déjà là n'est pas réécrite. Une catégorie renommée depuis la
    // sauvegarde sert tous les dossiers du cabinet — restaurer un client n'est pas une raison de la
    // ramener en arrière pour les autres.
    expect(resultat.lignesParTable.categories).toBe(0)
    expect(base.tables.categories).toHaveLength(1)
    expect(await verifierRestauration(sauvegarde)).toEqual([])
  })

  it('repose le lien d’un avoir vers sa facture en second passage', async () => {
    // La double passe. La facture d'origine et l'avoir partent tous deux avec le lien à NULL, puis
    // le lien revient — de sorte que le résultat ne dépende d'aucune taille de lot.
    base.tables.factures_emises = [
      { id: 'f2', dossier_id: DOSSIER, numero: 2, facture_origine_id: 'f1' },
      { id: 'f1', dossier_id: DOSSIER, numero: 1, facture_origine_id: null },
    ]
    const sauvegarde = await exporterDossier(DOSSIER)
    baseVide()

    const resultat = await restaurerSauvegarde(sauvegarde)
    expect(resultat.liensReposes).toBe(1)
    // L'insertion a bien eu lieu sans le lien, et la mise à jour l'a reposé après coup.
    expect(ecritures.filter((e) => e.table === 'factures_emises' && e.action === 'update')).toHaveLength(1)
    expect(base.tables.factures_emises.find((f) => f.id === 'f2')?.facture_origine_id).toBe('f1')
    expect(await verifierRestauration(sauvegarde)).toEqual([])
  })

  it('voit qu’une seconde passe oubliée n’a rien changé au compte de lignes', async () => {
    // Le piège que le compte de lignes ne peut PAS voir : toutes les factures sont là, et l'avoir ne
    // désigne plus rien. Seule la comparaison du lien lui-même le dit.
    base.tables.factures_emises = [
      { id: 'f2', dossier_id: DOSSIER, numero: 2, facture_origine_id: 'f1' },
      { id: 'f1', dossier_id: DOSSIER, numero: 1, facture_origine_id: null },
    ]
    const sauvegarde = await exporterDossier(DOSSIER)
    baseVide()
    // Une restauration où seule la première passe a eu lieu.
    base.tables.factures_emises = [
      { id: 'f2', dossier_id: DOSSIER, numero: 2, facture_origine_id: null },
      { id: 'f1', dossier_id: DOSSIER, numero: 1, facture_origine_id: null },
    ]
    base.tables.dossiers = [{ id: DOSSIER, nom: 'Cabinet Martin', cabinet_id: CABINET }]

    expect(await verifierRestauration(sauvegarde)).toEqual([
      { table: 'factures_emises', motif: 'lien_non_repose', identite: 'f2' },
    ])
  })

  it('refuse un lien perdu au lieu de l’effacer pour passer', async () => {
    // Le refus central. `lignes_bancaires.piece_id` accepte NULL : y écrire NULL ferait aboutir la
    // restauration en ayant défait le rapprochement bancaire, sans une alerte.
    baseVide()
    const sauvegarde = {
      manifeste: { ...manifesteVide(), dossierId: DOSSIER, cabinetId: CABINET },
      contenu: {
        dossiers: [{ id: DOSSIER, cabinet_id: CABINET }],
        pieces: [],
        lignes_bancaires: [{ id: 'l1', dossier_id: DOSSIER, piece_id: 'p-disparue' }],
      },
    }
    await expect(restaurerSauvegarde(sauvegarde)).rejects.toThrow(/le lien pourrait être effacé/)
    expect(ecritures).toEqual([])
  })

  it('refuse d’écrire par-dessus un dossier qui existe déjà', async () => {
    // Soit on se trompe de base, soit quelqu'un a recréé le dossier entre-temps. Dans les deux cas,
    // écrire dessus détruit ce qui existe, et c'est irréversible.
    base.tables.pieces = []
    const sauvegarde = await exporterDossier(DOSSIER)
    await expect(restaurerSauvegarde(sauvegarde)).rejects.toThrow(/existe déjà/)
    expect(ecritures).toEqual([])
  })

  it('refuse quand le cabinet n’est pas dans la base d’arrivée', async () => {
    // La ligne `cabinets` est un prérequis, pas une donnée de la sauvegarde. Sans cette lecture,
    // son absence se découvrirait sur la toute première écriture.
    const sauvegarde = await exporterDossier(DOSSIER)
    base.tables = { cabinets: [], dossiers: [] }
    await expect(restaurerSauvegarde(sauvegarde)).rejects.toThrow(/doit exister dans la base d'arrivée/)
    expect(ecritures).toEqual([])
  })

  it('refuse une sauvegarde d’un format plus récent que le code qui la lit', async () => {
    baseVide()
    const sauvegarde = {
      manifeste: { ...manifesteVide(), version: VERSION_SAUVEGARDE + 1, dossierId: DOSSIER, cabinetId: CABINET },
      contenu: { dossiers: [{ id: DOSSIER, cabinet_id: CABINET }] },
    }
    await expect(restaurerSauvegarde(sauvegarde)).rejects.toThrow(/ce code n'en connaît que/)
    expect(ecritures).toEqual([])
  })

  it('refuse une table qu’il ne saurait pas où écrire', async () => {
    baseVide()
    const sauvegarde = {
      manifeste: { ...manifesteVide(), dossierId: DOSSIER, cabinetId: CABINET },
      contenu: {
        dossiers: [{ id: DOSSIER, cabinet_id: CABINET }],
        table_ajoutee_depuis: [{ id: 'x1' }],
      },
    }
    await expect(restaurerSauvegarde(sauvegarde)).rejects.toThrow(/ne serait écrite nulle part/)
    expect(ecritures).toEqual([])
  })

  it('écrit les parents avant leurs enfants', async () => {
    base.tables.pieces = [{ id: 'p1', dossier_id: DOSSIER }]
    base.tables.lignes_bancaires = [{ id: 'l1', dossier_id: DOSSIER, piece_id: 'p1' }]
    const sauvegarde = await exporterDossier(DOSSIER)
    baseVide()

    await restaurerSauvegarde(sauvegarde)
    const ordre = ecritures.filter((e) => e.action === 'insert').map((e) => e.table)
    expect(ordre.indexOf('dossiers')).toBeLessThan(ordre.indexOf('pieces'))
    expect(ordre.indexOf('pieces')).toBeLessThan(ordre.indexOf('lignes_bancaires'))
  })

  it('découpe les grosses tables en lots, sans que le lot change le résultat', async () => {
    base.tables.lignes_bancaires = Array.from({ length: 450 }, (_, i) => ({
      id: `l${String(i).padStart(6, '0')}`, dossier_id: DOSSIER,
    }))
    const sauvegarde = await exporterDossier(DOSSIER)
    baseVide()

    await restaurerSauvegarde(sauvegarde)
    expect(ecritures.filter((e) => e.table === 'lignes_bancaires').length).toBeGreaterThanOrEqual(3)
    expect(await verifierRestauration(sauvegarde)).toEqual([])
  })

  it('s’arrête bruyamment quand la base refuse une écriture', async () => {
    // `supabase.from(...)` ne lève pas : l'erreur se lit dans `{ error }`. Un `await` sans
    // destructuration rendrait une base amputée en se disant réussie.
    base.tables.pieces = [{ id: 'p1', dossier_id: DOSSIER }]
    const sauvegarde = await exporterDossier(DOSSIER)
    baseVide()
    base.erreurParTable.pieces = new Error('new row violates row-level security policy')

    await expect(restaurerSauvegarde(sauvegarde)).rejects.toThrow(/Restauration interrompue sur « pieces »/)
  })

  it('voit une ligne qui manque à l’appel après restauration', async () => {
    base.tables.pieces = [{ id: 'p1', dossier_id: DOSSIER }, { id: 'p2', dossier_id: DOSSIER }]
    const sauvegarde = await exporterDossier(DOSSIER)
    baseVide()
    base.tables.dossiers = [{ id: DOSSIER, nom: 'Cabinet Martin', cabinet_id: CABINET }]
    base.tables.pieces = [{ id: 'p1', dossier_id: DOSSIER }]

    expect(await verifierRestauration(sauvegarde)).toEqual([
      { table: 'pieces', motif: 'ligne_absente', identite: 'p2' },
    ])
  })

  it('voit une ligne en trop, que rien d’autre ne signalerait', async () => {
    // Une restauration rejouée deux fois, ou une base qui n'était pas vide : le dossier a plus de
    // lignes que la sauvegarde. Le compte de lignes attendues, lui, serait satisfait.
    base.tables.pieces = [{ id: 'p1', dossier_id: DOSSIER }]
    const sauvegarde = await exporterDossier(DOSSIER)
    base.tables.pieces.push({ id: 'p-intruse', dossier_id: DOSSIER })

    expect(await verifierRestauration(sauvegarde)).toEqual([
      { table: 'pieces', motif: 'ligne_en_trop', identite: 'p-intruse' },
    ])
  })
})

function manifesteVide() {
  return {
    version: VERSION_SAUVEGARDE,
    dossierId: '',
    dossierNom: '',
    cabinetId: '',
    faiteLe: '2026-09-18T12:00:00.000Z',
    lignesParTable: {},
    comptes: { obligatoires: [], facultatifs: [] },
    referencesExternes: [],
    liensPerdus: [],
    horsPerimetre: [],
  }
}
