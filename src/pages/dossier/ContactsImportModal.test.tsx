import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ContactsVue from './ContactsVue'
import { motsDuCabinet } from '../../lib/espaceVentes'
import type { AccesDuDossier } from '../../lib/auteursVentes'
import { contact } from '../../test/contacts'
import type { ArticleExoneration, Contact } from '../../lib/types'

// « IMPORTER DES CLIENTS » (espace client, étape A4b3b) : la fenêtre de la vue « Clients », montée par la vue elle-même, pour le
// cabinet et pour le client « Ventes », sous un faux client qui APPLIQUE les filtres (src/test/filtresPostgrest.ts) et dont
// `importer_contacts` range la table d'essai, tout ou rien. Ce que ces cas gardent, et qu'aucun calcul pur ne voit :
//  1. le geste n'existe que sur une liste lue EN ENTIER — ni avant la lecture, ni lue en partie, ni refusée ;
//  2. le fichier : la borne jugée avant toute lecture, l'encodage DIT, le caractère nul refusé avant tout envoi, le séparateur
//     proposé et changé, l'en-tête ;
//  3. la correspondance : « proposé », « à choisir » qui fait attendre l'aperçu, « Ne pas importer » nommé ; le type par colonne
//     (une valeur non reconnue refuse SA ligne) ou unique ;
//  4. l'aperçu : les refus du module « Ligne N : », « Importer » offert sans aucun refus seulement, plus de mille lignes refusées
//     avant tout ;
//  5. l'import : `importer_contacts` seule, ce qu'elle reçoit, la liste relue, le bilan ; le refus de la base dit, la fenêtre
//     ouverte, la liste relue ;
//  6. le verrou des quatre gestes : deux puis trois clics du même rendu, une écriture ; relâché après la relecture ; exclusif ;
//  7. les mots du client : tutoiement, aucun mot du cabinet.
// Données FICTIVES.

const faux = vi.hoisted(() => ({
  contacts: [] as Record<string, unknown>[],
  muetApres: Infinity,
  leve: false,
  lectures: 0,
  rpcs: [] as { nom: string; params: Record<string, unknown> }[],
  refus: {} as Record<string, string>,
  renduImport: null as unknown,
  retenirLecture: false,
  lecturesEnAttente: [] as (() => void)[],
  retenirRpc: false,
  rpcEnAttente: [] as (() => void)[],
  drapeau: true,
}))

// Le drapeau de l'import, lu à chaque accès : son état baissé reste éprouvé tant que son code existe (CLAUDE.md, « Tests »).
vi.mock('../../lib/contactsImport', async (importOriginal) => {
  const vrai = await importOriginal<typeof import('../../lib/contactsImport')>()
  return { ...vrai, get IMPORT_CONTACTS_EXPORTE() { return faux.drapeau } }
})

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq } = await import('../../test/filtresPostgrest')
  type Predicat = (ligne: Record<string, unknown>) => boolean
  const instant = '2027-11-20T10:00:00Z'
  return {
    supabase: {
      rpc: async (nom: string, params: Record<string, unknown>) => {
        faux.rpcs.push({ nom, params })
        if (faux.retenirRpc) await new Promise<void>((r) => { faux.rpcEnAttente.push(r) })
        const refus = faux.refus[nom]
        if (refus) return { data: null, error: { message: refus } }
        if (nom === 'importer_contacts') {
          if (faux.renduImport !== null) return { data: faux.renduImport, error: null }
          const lignes = params.p_contacts as Record<string, unknown>[]
          const neufs = lignes.map((l, i) => ({
            id: `imp-${faux.contacts.length + i + 1}`, dossier_id: params.p_dossier_id, genre: 'client', retire_le: null, retire_par: null,
            efface_le: null, efface_par: null, cree_par: 'u-moi', cree_le: instant, modifie_par: null, modifie_le: null, ...l,
          }))
          faux.contacts = [...faux.contacts, ...neufs]
          return { data: neufs.map((n) => n.id), error: null }
        }
        const id = params.p_contact_id as string | null
        const existant = faux.contacts.find((c) => c.id === id)
        if (!existant) return { data: null, error: { message: 'Contact introuvable dans ce dossier.' } }
        const ecrit = { ...existant, retire_le: instant, retire_par: 'u-moi' }
        faux.contacts = faux.contacts.map((c) => (c.id === id ? ecrit : c))
        return { data: ecrit, error: null }
      },
      from: (table: string) => {
        if (table !== 'contacts') throw new Error(`Table non attendue dans ce test : ${table}`)
        const predicats: Predicat[] = []
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        const partir = () => {
          if (faux.leve) throw new Error('réseau coupé')
          faux.lectures += 1
          const toutes = filtrer(faux.contacts, predicats)
          return { data: toutes.slice(debut, Math.min(fin + 1, toutes.length, faux.muetApres)), error: null, count: toutes.length }
        }
        const c: Record<string, unknown> = {}
        Object.assign(c, {
          select: () => c,
          eq: (colonne: string, valeur: unknown) => { predicats.push(predicatEq(colonne, valeur)); return c },
          order: () => c,
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => {
            if (faux.retenirLecture) {
              return new Promise<void>((r) => { faux.lecturesEnAttente.push(r) }).then(partir).then(suite, echec)
            }
            return Promise.resolve().then(partir).then(suite, echec)
          },
        })
        return c
      },
    },
  }
})

// ── Le jeu d'essai ───────────────────────────────────────────────────────────────────────────────────────────────────
// Les identifiants sont ceux des jeux d'essai du dépôt (`src/test/contacts.ts`) : 123456782 et son établissement 12345678200010,
// 987654324. Aucune donnée réelle.
const nues = (lignes: readonly Contact[]): Record<string, unknown>[] => lignes.map((l) => ({ ...l }))
const C1 = contact({ id: 'c1', nom: 'Société Essai' })
const C2 = contact({ id: 'c2', nom: 'Association Fictive', type_client: 'non_assujetti', siren: '987654324', siret: null })
const ACCES_LUS: AccesDuDossier = { etat: 'lus', comptes: ['u-client'] }
const SOINS: ArticleExoneration = 'cgi_261_4_1'

const arbre = (espace: 'cabinet' | 'client', article: ArticleExoneration | null = null) => (espace === 'client'
  ? <ContactsVue espace="client" dossierId="d1" articleExoneration={article} />
  : <ContactsVue espace="cabinet" acces={ACCES_LUS} dossierId="d1" articleExoneration={article} />)

async function monter(espace: 'cabinet' | 'client' = 'cabinet', article: ArticleExoneration | null = null) {
  render(arbre(espace, article))
  await screen.findByRole('table', { name: 'Clients' })
}

const bouton = (nom: string | RegExp) => screen.getByRole('button', { name: nom }) as HTMLButtonElement
const fenetre = () => screen.getByRole('dialog')
const lisible = (t: string | null) => (t ?? '').replace(/[\u00a0\u202f]/g, ' ')
const utf8 = (t: string) => new TextEncoder().encode(t)

// jsdom fournit File mais pas toujours `arrayBuffer()` : on le pose, en gardant les OCTETS exacts (comme BalanceCard.test.tsx).
// `taille` : la taille que le navigateur annoncerait, sans fabriquer un fichier de dix mébioctets.
function fichier(octets: Uint8Array, taille?: number): File & { lu: number } {
  const f = new File([octets as Uint8Array<ArrayBuffer>], 'clients.csv', { type: 'text/csv' }) as File & { lu: number }
  f.lu = 0
  Object.defineProperty(f, 'arrayBuffer', {
    value: async () => { f.lu += 1; return octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.byteLength) },
  })
  if (taille !== undefined) Object.defineProperty(f, 'size', { value: taille })
  return f
}

async function ouvrir() {
  fireEvent.click(bouton('Importer des clients'))
  return fenetre()
}

async function deposer(f: File) {
  const entree = within(fenetre()).getByLabelText(/^Fichier CSV/) as HTMLInputElement
  Object.defineProperty(entree, 'files', { value: [f], configurable: true })
  await act(async () => { fireEvent.change(entree) })
}

const choisirChamp = (colonne: string, valeur: string) =>
  fireEvent.change(within(fenetre()).getByLabelText(`Champ de la colonne « ${colonne} »`), { target: { value: valeur } })

// Un fichier où tout est proposé, sauf le type : deux clients prêts.
const FICHIER_PRET = 'Nom;Adresse;SIREN;SIRET;E-mail;Délai\n'
  + 'Client Un;1 rue Fictive;;;un@exemple.fr;30\n'
  + 'Client Deux;2 rue Fictive;100 000 207;100 000 207 00017;;\n'

beforeEach(() => {
  faux.contacts = nues([C1, C2])
  faux.muetApres = Infinity
  faux.leve = false
  faux.lectures = 0
  faux.rpcs = []
  faux.refus = {}
  faux.renduImport = null
  faux.retenirLecture = false
  faux.lecturesEnAttente = []
  faux.retenirRpc = false
  faux.rpcEnAttente = []
  faux.drapeau = true
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Importer des clients — sur une liste lue en entier seulement', () => {
  it('avant la lecture : ni le bouton, ni la fenêtre', () => {
    faux.retenirLecture = true
    render(arbre('cabinet'))
    expect(screen.queryByRole('button', { name: 'Importer des clients' })).toBeNull()
  })

  it('lue en partie : le bandeau, et pas d’import', async () => {
    faux.muetApres = 1
    render(arbre('cabinet'))
    expect(await screen.findByText(/Aucun geste n’est donc offert/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Importer des clients' })).toBeNull()
  })

  it('une lecture qui lève : le message, pas d’import', async () => {
    faux.leve = true
    render(arbre('client'))
    expect(await screen.findByText(/^Tes clients ne s’affichent pas/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Importer des clients' })).toBeNull()
  })

  it('le drapeau baissé : ni le bouton, ni la fenêtre — « Nouveau client » reste', async () => {
    faux.drapeau = false
    await monter()
    expect(bouton(/Nouveau client/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Importer des clients' })).toBeNull()
  })

  it('la relecture d’après un refus revient en partie : la fenêtre se ferme, le bandeau le dit, aucun geste', async () => {
    await monter()
    await ouvrir()
    await deposer(fichier(utf8(FICHIER_PRET)))
    fireEvent.change(within(fenetre()).getByLabelText(/^Aucune colonne ne donne le type/), { target: { value: 'assujetti' } })
    faux.refus.importer_contacts = 'Accès refusé à ce dossier.'
    faux.muetApres = 1
    fireEvent.click(bouton('Importer 2 clients'))
    expect(await screen.findByText(/Aucun geste n’est donc offert/)).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Importer des clients' })).toBeNull()
  })

  it('lue en entier : le bouton, à côté de « Nouveau client » ; la fenêtre s’ouvre sans rien lire ni écrire', async () => {
    await monter()
    const lectures = faux.lectures
    await ouvrir()
    expect(within(fenetre()).getByRole('heading', { name: 'Importer des clients' })).toBeTruthy()
    expect(within(fenetre()).getByText(/lu ici, dans le navigateur : il ne part nulle part/)).toBeTruthy()
    expect(faux.lectures).toBe(lectures)
    expect(faux.rpcs).toEqual([])
    // Rien n'est importable avant un fichier.
    expect(bouton('Importer').disabled).toBe(true)
    fireEvent.click(bouton('Annuler'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('Importer des clients — le fichier', () => {
  it('trop lourd : la borne dite, le fichier jamais lu', async () => {
    await monter()
    await ouvrir()
    const f = fichier(utf8('Nom\nA\n'), 10 * 1024 * 1024 + 1)
    await deposer(f)
    expect(lisible(within(fenetre()).getByRole('alert').textContent)).toMatch(/^Ce fichier pèse 10 485 761 octets, au-delà des 10 485 760 octets/)
    expect(f.lu).toBe(0)
    expect(screen.queryByRole('table', { name: 'Colonnes du fichier' })).toBeNull()
  })

  it('l’encodage est dit : UTF-8 sans marque, windows-1252, UTF-16 annoncé par sa marque', async () => {
    await monter()
    await ouvrir()
    await deposer(fichier(utf8('Nom;Adresse\nÉté;Rue\n')))
    expect(within(fenetre()).getByText(/encodage UTF-8 \(sans marque d’ordre : ses octets en sont\)/)).toBeTruthy()
    await deposer(fichier(new Uint8Array([0x4e, 0x6f, 0x6d, 0x0a, 0xc9, 0x74, 0xe9, 0x0a])))
    expect(within(fenetre()).getByText(/encodage windows-1252/)).toBeTruthy()
    // La valeur lue en windows-1252 est la bonne : « Été ».
    expect(within(screen.getByRole('table', { name: 'Colonnes du fichier' })).getByText('Été')).toBeTruthy()
    const corps = 'Nom\nA\n'
    const le = new Uint8Array(2 + corps.length * 2)
    le.set([0xff, 0xfe])
    for (let i = 0; i < corps.length; i++) le[2 + 2 * i] = corps.charCodeAt(i)
    await deposer(fichier(le))
    expect(within(fenetre()).getByText(/encodage UTF-16 \(petit-boutiste\), annoncé par sa marque d’ordre/)).toBeTruthy()
  })

  it('un caractère nul (UTF-16 sans marque) : refusé avant tout envoi, en français, avec sa cause probable', async () => {
    await monter()
    await ouvrir()
    await deposer(fichier(new Uint8Array([0x4e, 0x00, 0x6f, 0x00, 0x6d, 0x00])))
    expect(within(fenetre()).getByRole('alert').textContent).toMatch(/^Ce fichier porte un caractère nul \(U\+0000\) à la ligne 1 : il a sans doute été enregistré en UTF-16 sans marque d’ordre/)
    expect(screen.queryByRole('table', { name: 'Colonnes du fichier' })).toBeNull()
    expect(faux.rpcs).toEqual([])
  })

  it('le séparateur est proposé d’après la première ligne, dit, et se change ; l’en-tête se décoche', async () => {
    await monter()
    await ouvrir()
    await deposer(fichier(utf8('Nom,"Adresse; bâtiment"\nA,B\n')))
    const separateur = within(fenetre()).getByLabelText(/^Séparateur des colonnes \(proposé d’après la première ligne : la virgule\)/) as HTMLSelectElement
    expect(separateur.value).toBe(',')
    const colonnes = () => within(screen.getByRole('table', { name: 'Colonnes du fichier' })).getAllByRole('row').slice(1).map((r) => (r as HTMLTableRowElement).cells[0].textContent)
    expect(colonnes()).toEqual(['Nom', 'Adresse; bâtiment'])
    fireEvent.change(separateur, { target: { value: ';' } })
    expect(colonnes()).toEqual(['Nom,"Adresse', 'bâtiment"'])
    fireEvent.change(separateur, { target: { value: ',' } })
    expect(within(fenetre()).getByText('1 ligne de clients, l’en-tête ôté.')).toBeTruthy()
    fireEvent.click(within(fenetre()).getByLabelText(/La première ligne est un en-tête/))
    expect(colonnes()).toEqual(['Colonne 1', 'Colonne 2'])
    expect(within(fenetre()).getByText('2 lignes de clients.')).toBeTruthy()
  })

  it('la correspondance est gardée avec la structure du fichier : un autre séparateur repart des propositions', async () => {
    await monter()
    await ouvrir()
    await deposer(fichier(utf8('Nom;Fax\nA;1\n')))
    choisirChamp('Fax', 'ne_pas_importer')
    fireEvent.change(within(fenetre()).getByLabelText(/^Séparateur des colonnes/), { target: { value: ',' } })
    // Une seule colonne, « Nom;Fax », que rien ne propose : à choisir, pas le « Nom » de l'autre structure.
    expect((within(fenetre()).getByLabelText('Champ de la colonne « Nom;Fax »') as HTMLSelectElement).value).toBe('')
    // Revenu au point-virgule, la correspondance faite pour lui revient.
    fireEvent.change(within(fenetre()).getByLabelText(/^Séparateur des colonnes/), { target: { value: ';' } })
    expect((within(fenetre()).getByLabelText('Champ de la colonne « Fax »') as HTMLSelectElement).value).toBe('ne_pas_importer')
  })

  it('un fichier remplacé pendant sa lecture : sa lecture, revenue après, ne s’inscrit pas', async () => {
    await monter()
    await ouvrir()
    let liberer: (() => void) | null = null
    const lent = new File([utf8('Lent;Adresse\nA;B\n') as Uint8Array<ArrayBuffer>], 'lent.csv', { type: 'text/csv' })
    Object.defineProperty(lent, 'arrayBuffer', {
      value: () => new Promise<ArrayBuffer>((r) => { liberer = () => r(utf8('Lent;Adresse\nA;B\n').buffer as ArrayBuffer) }),
    })
    await deposer(lent)
    expect(within(fenetre()).getByText('Lecture du fichier…')).toBeTruthy()
    await deposer(fichier(utf8('Rapide;Adresse\nA;B\n')))
    expect(within(fenetre()).getByLabelText('Champ de la colonne « Rapide »')).toBeTruthy()
    await act(async () => { (liberer as unknown as () => void)() })
    expect(within(fenetre()).queryByLabelText('Champ de la colonne « Lent »')).toBeNull()
    expect(within(fenetre()).getByLabelText('Champ de la colonne « Rapide »')).toBeTruthy()
    expect(within(fenetre()).queryByText('Lecture du fichier…')).toBeNull()
  })

  it('un guillemet jamais fermé : le refus, la ligne nommée, aucune colonne', async () => {
    await monter()
    await ouvrir()
    await deposer(fichier(utf8('Nom;Adresse\n"A;B\n')))
    expect(within(fenetre()).getByRole('alert').textContent).toMatch(/^Un guillemet ouvert à la ligne 2 du fichier n’est jamais fermé/)
    expect(screen.queryByRole('table', { name: 'Colonnes du fichier' })).toBeNull()
  })

  it('les lignes blanches sont comptées et dites ; plus de mille lignes : le refus du module, avant toute correspondance', async () => {
    await monter()
    await ouvrir()
    await deposer(fichier(utf8('Nom\nA\n\n;\nB\n')))
    expect(within(fenetre()).getByText('2 lignes de clients, l’en-tête ôté ; 2 lignes blanches, ignorées.')).toBeTruthy()
    await deposer(fichier(utf8(`Nom\n${Array.from({ length: 1001 }, (_, i) => `Client ${i}`).join('\n')}\n`)))
    expect(within(fenetre()).getByRole('alert').textContent)
      .toBe('Un import range mille lignes au plus ; celui-ci en porte 1001 : le partager en plusieurs fichiers.')
    expect(screen.queryByRole('table', { name: 'Colonnes du fichier' })).toBeNull()
    // L'en-tête seul : aucune ligne.
    await deposer(fichier(utf8('Nom;Adresse\n')))
    expect(within(fenetre()).getByRole('alert').textContent).toBe("L'import ne porte aucune ligne.")
  })
})

describe('Importer des clients — la correspondance et l’aperçu', () => {
  it('« proposé » d’après les libellés de l’application ; une colonne inconnue « à choisir » fait attendre l’aperçu', async () => {
    await monter()
    await ouvrir()
    await deposer(fichier(utf8('Nom;Fax;Adresse\nA;01;Rue\n')))
    const table = screen.getByRole('table', { name: 'Colonnes du fichier' })
    const rangs = within(table).getAllByRole('row').slice(1)
    expect(rangs.map((r) => within(r).queryByText('proposé') != null)).toEqual([true, false, true])
    expect((within(fenetre()).getByLabelText('Champ de la colonne « Fax »') as HTMLSelectElement).value).toBe('')
    expect(within(fenetre()).getByText('L’aperçu attend : la colonne « Fax » à choisir ; le type à choisir.')).toBeTruthy()
    expect(screen.queryByRole('table', { name: 'Aperçu de l’import' })).toBeNull()
    expect(bouton('Importer').disabled).toBe(true)
    // « Ne pas importer », explicitement : la colonne est nommée non importée.
    choisirChamp('Fax', 'ne_pas_importer')
    fireEvent.change(within(fenetre()).getByLabelText(/^Aucune colonne ne donne le type/), { target: { value: 'assujetti' } })
    expect(within(fenetre()).getByText(/Non importée : « Fax »\./)).toBeTruthy()
    expect(bouton('Importer 1 client').disabled).toBe(false)
  })

  it('un champ ne sert qu’une fois : le choisir pour une colonne le retire à celle qui l’avait', async () => {
    await monter()
    await ouvrir()
    await deposer(fichier(utf8('Nom;Raison sociale\nA;B\n')))
    choisirChamp('Raison sociale', 'nom')
    expect((within(fenetre()).getByLabelText('Champ de la colonne « Nom »') as HTMLSelectElement).value).toBe('')
    expect((within(fenetre()).getByLabelText('Champ de la colonne « Raison sociale »') as HTMLSelectElement).value).toBe('nom')
    // Un choix fait à la main n'est pas « proposé ».
    expect(within(screen.getByRole('table', { name: 'Colonnes du fichier' })).queryByText('proposé')).toBeNull()
  })

  it('le type par colonne : chaque valeur se fait correspondre ; une valeur non reconnue refuse SA ligne, nommée', async () => {
    await monter()
    await ouvrir()
    await deposer(fichier(utf8('Nom;Type;Adresse;SIREN\nA;assujetti;Rue;\nB;Pro;Rue;\nC;Pro;Rue;\n')))
    const valeurs = screen.getByRole('table', { name: 'Valeurs du type' })
    expect(within(valeurs).getAllByRole('row').slice(1).map((r) => [(r as HTMLTableRowElement).cells[0].textContent, (r as HTMLTableRowElement).cells[1].textContent])).toEqual([['assujetti', '1'], ['Pro', '2']])
    expect((within(fenetre()).getByLabelText('Type de la valeur « assujetti »') as HTMLSelectElement).value).toBe('assujetti')
    expect((within(fenetre()).getByLabelText('Type de la valeur « Pro »') as HTMLSelectElement).value).toBe('non_reconnue')
    // Les deux lignes « Pro » refusées, sous les mots du module, la valeur nommée.
    const alerte = within(fenetre()).getAllByRole('alert')[0]
    expect(alerte.textContent).toContain('Ligne 2 : Le type du contact est l\'un des quatre de la facture')
    expect(alerte.textContent).toContain('(ligne 3 du fichier, type « Pro » non reconnu)')
    expect(alerte.textContent).toContain('Ligne 3 : ')
    expect(within(fenetre()).getByText(/^3 lignes, 2 refusées\./)).toBeTruthy()
    expect(bouton('Importer').disabled).toBe(true)
    fireEvent.change(within(fenetre()).getByLabelText('Type de la valeur « Pro »'), { target: { value: 'non_assujetti' } })
    expect(bouton('Importer 3 clients').disabled).toBe(false)
  })

  it('les refus du module ligne par ligne : SIRET déjà rangé, répété dans le fichier, adresse absente — rien d’importable', async () => {
    await monter()
    await ouvrir()
    await deposer(fichier(utf8(
      'Nom;Adresse;SIREN;SIRET\nNeuf;Rue;123456782;12345678200010\nAutre;;;\nBis;Rue;100000207;10000020700017\nTer;Rue;100000207;10000020700017\n',
    )))
    fireEvent.change(within(fenetre()).getByLabelText(/^Aucune colonne ne donne le type/), { target: { value: 'assujetti' } })
    const alerte = within(fenetre()).getAllByRole('alert')[0]
    const items = within(alerte).getAllByRole('listitem').map((li) => li.textContent)
    expect(items[0]).toMatch(/^Ligne 1 : Le SIRET « 12345678200010 » est déjà celui du contact « Société Essai »/)
    expect(items[1]).toBe("Ligne 2 : L'adresse du contact est à renseigner. (ligne 3 du fichier)")
    expect(items.some((t) => /^Ligne 4 : Le SIRET « 10000020700017 » est déjà celui du contact « Bis »/.test(t ?? ''))).toBe(true)
    expect(alerte.textContent).toContain('Rien ne s’importe tant qu’une ligne est refusée')
    expect(bouton('Importer').disabled).toBe(true)
    const apercu = screen.getByRole('table', { name: 'Aperçu de l’import' })
    expect(within(apercu).getAllByText('Refusée')).toHaveLength(items.length)
  })

  it('un dossier de soins : le refus d’un particulier, au cabinet sous les mots de la base', async () => {
    await monter('cabinet', SOINS)
    await ouvrir()
    await deposer(fichier(utf8('Nom;Adresse\nA;Rue\n')))
    fireEvent.change(within(fenetre()).getByLabelText(/^Aucune colonne ne donne le type/), { target: { value: 'non_assujetti' } })
    expect(within(fenetre()).getAllByRole('alert')[0].textContent).toContain('Ligne 1 : Un dossier qui dispense des soins exonérés')
  })
})

describe('Importer des clients — l’import', () => {
  async function pret(espace: 'cabinet' | 'client' = 'cabinet') {
    await monter(espace)
    await ouvrir()
    await deposer(fichier(utf8(FICHIER_PRET)))
    fireEvent.change(within(fenetre()).getByLabelText(/^Aucune colonne ne donne le type/), { target: { value: 'assujetti' } })
  }

  it('prêt : le compte et « ne se défait pas » dits ; `importer_contacts` seule reçoit les lignes telles qu’elles partent ; la liste relue', async () => {
    await pret()
    expect(within(fenetre()).getByRole('status').textContent).toMatch(/^Prêt : 2 clients s’ajouteront au fichier des clients du dossier, d’un seul tenant\. Un import ne se défait pas/)
    expect(within(fenetre()).getByText(/Toutes les colonnes sont importées\./)).toBeTruthy()
    const lectures = faux.lectures
    fireEvent.click(bouton('Importer 2 clients'))
    expect(await screen.findByText('2 clients importés.')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(faux.rpcs).toEqual([{
      nom: 'importer_contacts',
      params: {
        p_dossier_id: 'd1',
        p_contacts: [
          {
            nom: 'Client Un', type_client: 'assujetti', adresse: '1 rue Fictive', siren: null, siret: null, adresse_electronique: null,
            code_service: null, email: 'un@exemple.fr', delai_paiement_jours: 30, observations: null,
          },
          {
            nom: 'Client Deux', type_client: 'assujetti', adresse: '2 rue Fictive', siren: '100000207', siret: '10000020700017',
            adresse_electronique: null, code_service: null, email: null, delai_paiement_jours: null, observations: null,
          },
        ],
      },
    }])
    expect(faux.lectures).toBe(lectures + 1)
    const noms = within(screen.getByRole('table', { name: 'Clients' })).getAllByRole('row').slice(1).map((r) => (r as HTMLTableRowElement).cells[0].textContent)
    expect(noms).toEqual(expect.arrayContaining(['Client Un', 'Client Deux']))
  })

  it('le refus de la base : dit tel quel DANS la fenêtre, qui reste ouverte ; la liste relue', async () => {
    await pret()
    faux.refus.importer_contacts = 'Ligne 2 : Le SIRET « 12345678200010 » est déjà celui du contact « Arrivé entre-temps » : un établissement ne se range qu\'une fois par dossier.'
    const lectures = faux.lectures
    fireEvent.click(bouton('Importer 2 clients'))
    expect(await within(fenetre()).findByText(faux.refus.importer_contacts)).toBeTruthy()
    // Dit UNE fois, dans la fenêtre : pas une seconde fois sous elle, dans la vue.
    expect(screen.getAllByText(faux.refus.importer_contacts)).toHaveLength(1)
    expect(faux.lectures).toBe(lectures + 1)
    expect(screen.queryByText(/importés\./)).toBeNull()
  })

  it('une réponse qui n’est pas un identifiant par ligne : dite, rien de prétendu importé', async () => {
    await pret()
    faux.renduImport = ['un seul']
    fireEvent.click(bouton('Importer 2 clients'))
    expect(await within(fenetre()).findByText('La base n’a pas rendu les clients importés : relis la liste avant de recommencer.')).toBeTruthy()
  })

  it('deux clics, puis trois, du même rendu : UNE écriture ; le verrou ne tombe qu’après la relecture', async () => {
    await pret()
    faux.retenirRpc = true
    const importer = bouton('Importer 2 clients')
    act(() => { fireEvent.click(importer); fireEvent.click(importer) })
    act(() => { fireEvent.click(importer); fireEvent.click(importer); fireEvent.click(importer) })
    await vi.waitFor(() => expect(faux.rpcs).toHaveLength(1))
    expect(bouton('Import…').disabled).toBe(true)
    expect(bouton('Annuler').disabled).toBe(true)
    faux.retenirLecture = true
    await act(async () => { faux.retenirRpc = false; for (const r of faux.rpcEnAttente.splice(0)) r() })
    await vi.waitFor(() => expect(faux.lecturesEnAttente.length).toBeGreaterThan(0))
    // L'écriture est revenue, la relecture non : la fenêtre est encore là, grisée, et les quatre gestes derrière elle aussi.
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(bouton('Import…').disabled).toBe(true)
    expect(bouton(/Nouveau client/).disabled).toBe(true)
    for (const b of screen.getAllByRole('button', { name: /^(Modifier|Retirer|Effacer)$/ })) expect((b as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { faux.retenirLecture = false; for (const r of faux.lecturesEnAttente.splice(0)) r() })
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(faux.rpcs).toHaveLength(1)
    expect(bouton('Importer des clients').disabled).toBe(false)
  })

  it('exclusif des quatre gestes : un retrait en cours grise « Importer des clients »', async () => {
    await monter()
    faux.retenirRpc = true
    const ligne = within(screen.getByRole('table', { name: 'Clients' })).getAllByRole('row').find((r) => r.textContent?.includes('Société Essai')) as HTMLElement
    fireEvent.click(within(ligne).getByRole('button', { name: 'Retirer' }))
    await vi.waitFor(() => expect(faux.rpcs).toHaveLength(1))
    expect(bouton('Importer des clients').disabled).toBe(true)
    await act(async () => { faux.retenirRpc = false; for (const r of faux.rpcEnAttente.splice(0)) r() })
    await vi.waitFor(() => expect(bouton('Importer des clients').disabled).toBe(false))
  })
})

describe('Importer des clients — dans l’espace du client', () => {
  it('le même chemin, la même fonction, aux mots du client : tutoiement, aucun mot du cabinet', async () => {
    await monter('client')
    await ouvrir()
    await deposer(fichier(utf8('Nom;Adresse;Fax\nA;Rue;01\nB;;02\n')))
    expect(within(fenetre()).getByText(/lu ici, dans ton navigateur : il ne part nulle part/)).toBeTruthy()
    expect(within(fenetre()).getByLabelText('Aucune colonne ne donne le type : choisis-en un pour tout le fichier')).toBeTruthy()
    choisirChamp('Fax', 'ne_pas_importer')
    fireEvent.change(within(fenetre()).getByLabelText(/^Aucune colonne ne donne le type/), { target: { value: 'assujetti' } })
    expect(within(fenetre()).getAllByRole('alert')[0].textContent).toContain('Corrige le fichier ou la correspondance, puis reprends-le.')
    expect(motsDuCabinet(fenetre().textContent ?? '')).toEqual([])
    // Corrigé : la ligne sans adresse retirée.
    await deposer(fichier(utf8('Nom;Adresse;Fax\nA;Rue;01\n')))
    choisirChamp('Fax', 'ne_pas_importer')
    fireEvent.change(within(fenetre()).getByLabelText(/^Aucune colonne ne donne le type/), { target: { value: 'assujetti' } })
    expect(within(fenetre()).getByRole('status').textContent).toMatch(/^Prêt : 1 client s’ajoutera à tes clients, .*un client importé se retire ou s’efface ensuite, un par un\.$/)
    expect(motsDuCabinet(fenetre().textContent ?? '')).toEqual([])
    fireEvent.click(bouton('Importer 1 client'))
    expect(await screen.findByText('1 client importé.')).toBeTruthy()
    expect(faux.rpcs.map((r) => r.nom)).toEqual(['importer_contacts'])
  })

  it('au client, le refus des soins se lit réécrit : « Ta société… », jamais « Un dossier… »', async () => {
    await monter('client', SOINS)
    await ouvrir()
    await deposer(fichier(utf8('Nom;Adresse\nA;Rue\n')))
    fireEvent.change(within(fenetre()).getByLabelText(/^Aucune colonne ne donne le type/), { target: { value: 'etranger' } })
    const texte = within(fenetre()).getAllByRole('alert')[0].textContent ?? ''
    expect(texte).toContain('Ligne 1 : Ta société dispense des soins exonérés')
    expect(texte).not.toContain('Un dossier')
    expect(motsDuCabinet(fenetre().textContent ?? '')).toEqual([])
  })
})
