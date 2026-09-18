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
  erreur: null as Error | null,
  // Faire échouer UNE table et pas toutes : une erreur globale n'atteint jamais la lecture des
  // tables, la première requête sur `dossiers` s'arrêtant avant.
  erreurParTable: {} as Record<string, Error>,
}
const journal: { table: string; filtres: string[]; tri: string[] }[] = []

function appliquerFiltre(lignes: Ligne[], filtre: string): Ligne[] {
  const [type, reste] = [filtre.slice(0, filtre.indexOf(':')), filtre.slice(filtre.indexOf(':') + 1)]
  if (type === 'eq') {
    const [colonne, valeur] = reste.split('=')
    return lignes.filter((l) => String(l[colonne]) === valeur)
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
    const total = base.compteAnnonce[table] ?? lignes.length
    return Promise.resolve({ data: lignes.slice(debut, fin + 1), error: null, count: total })
  }
  const chaine = {
    eq: (colonne: string, valeur: unknown) => { filtres.push(`eq:${colonne}=${String(valeur)}`); return chaine },
    or: (expression: string) => { filtres.push(`or:${expression}`); return chaine },
    in: (colonne: string, valeurs: string[]) => { filtres.push(`in:${colonne}=${valeurs.join('|')}`); return chaine },
    order: (colonne: string) => { tri.push(colonne); return chaine },
    range: executer,
    maybeSingle: async () => {
      const { data, error } = await executer(0, 0)
      return { data: data?.[0] ?? null, error }
    },
  }
  return chaine
}

vi.mock('./supabase', () => ({
  supabase: { from: (table: string) => ({ select: () => constructeur(table) }) },
}))

const { exporterDossier, TAILLE_PAGE } = await import('./sauvegardeDonnees')

const DOSSIER = 'd1'
const CABINET = 'cab1'

beforeEach(() => {
  base.tables = { dossiers: [{ id: DOSSIER, nom: 'Cabinet Martin', cabinet_id: CABINET }] }
  base.compteAnnonce = {}
  base.erreur = null
  base.erreurParTable = {}
  journal.length = 0
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
