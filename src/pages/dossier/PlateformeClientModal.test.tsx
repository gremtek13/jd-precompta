import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PlateformeClientModal from './PlateformeClientModal'
import type {
  BilanReception, ConnexionPlateformeVue, DrapeauxPlateforme, FluxVu, ListeFlux, PlanReception,
} from '../../lib/receptionPlateforme'

// LA FENÊTRE « PLATEFORME DU CLIENT » (onglet Pièces, ligne 28.5, étape b). Ce qu'aucun test de `src/lib` ne voit :
//   - ce qui PART chez la plateforme, et quand — à l'ouverture, rien que la connexion lue en base et la synchronisation
//     Super PDP du dossier ; tester, chercher, importer, sur un clic ;
//   - ce qui S'IMPORTE : seulement après une recherche, jamais deux fois pour trois clics, et pas sans le SIRET du
//     dossier, qui vérifie que chaque facture le désigne ;
//   - ce qui SE DIT : une lecture refusée n'est pas « aucune plateforme reliée », un retrait nomme ce qui reste ouvert
//     chez la plateforme, un import dit les factures à vérifier.
// Le module de la réception est doublé : ses appels et leurs drapeaux sont éprouvés dans receptionPlateforme.test.ts.

const m = vi.hoisted(() => ({
  lireConnexionPlateforme: vi.fn(),
  lireSynchronisationSuperPdp: vi.fn(),
  enregistrerConnexionPlateforme: vi.fn(),
  testerConnexionPlateforme: vi.fn(),
  listerFlux: vi.fn(),
  preparerReception: vi.fn(),
  recevoirFactures: vi.fn(),
  repartirDuDebut: vi.fn(),
  retirerConnexionPlateforme: vi.fn(),
}))
vi.mock('../../lib/receptionPlateforme', () => m)
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ session: { user: { id: 'utilisateur-1' } } }) }))

const SANS: DrapeauxPlateforme = { definitif: false, raison: null, perimee: false, acces_refuse: false, identifiants_refuses: false }
const ok = <T,>(donnees: T) => ({ donnees, erreur: null, drapeaux: SANS })
const refus = (erreur: string, drapeaux: Partial<DrapeauxPlateforme> = {}) => ({ donnees: null, erreur, drapeaux: { ...SANS, ...drapeaux } })

// TYPÉS, et sans `as` : le compilateur confronte chaque champ à ce que le module rend.
function connexion(o: Partial<ConnexionPlateformeVue> = {}): ConnexionPlateformeVue {
  return {
    nom: 'Plateforme fictive', url_flux: 'https://pa.exemple.fr/afnor', url_jeton: 'https://pa.exemple.fr/jeton',
    hote: 'pa.exemple.fr', client_id: 'cabinet-42', organisation_id: null, portee: null, recherche_depuis: null,
    derniere_recuperation: null, created_at: '2026-10-07T09:00:00.000Z', version: 'v1', ...o,
  }
}
let numero = 0
function flux(o: Partial<FluxVu> = {}): FluxVu {
  numero += 1
  return {
    id: `flux-${numero}`, sens: 'achat', syntaxe: 'CII', direction: 'In', nom: `FA-${numero}.xml`,
    recu_le: '2026-10-01T10:00:00.000Z', mis_a_jour: '2026-10-01T10:00:00.000Z', etat: 'pret', ...o,
  }
}
function liste(o: Partial<ListeFlux> = {}): ListeFlux {
  return {
    hote: 'pa.exemple.fr', version: 'v1', depuis: null, flux: [], complete: true, motif: null, jusqua: null,
    ecartes: { autre_flux: 0, illisible: 0, format: 0, statut_inconnu: 0, doublons: 0 }, ...o,
  }
}
function plan(o: Partial<PlanReception> = {}): PlanReception {
  return { aImporter: [], dejaImportes: [], enAttente: [], rejetes: [], ...o }
}
function bilan(o: Partial<BilanReception> = {}): BilanReception {
  return { issues: [], pointDeReprise: null, erreurReprise: null, interruption: null, ...o }
}

const onImported = vi.fn()
const onClose = vi.fn()
const ouvrir = (siret: string | null = '12345678200010') =>
  render(<PlateformeClientModal dossierId="d1" dossierSiret={siret} onClose={onClose} onImported={onImported} />)

beforeEach(() => {
  numero = 0
  for (const f of Object.values(m)) f.mockReset()
  m.lireConnexionPlateforme.mockResolvedValue(ok({ connexion: connexion() }))
  m.lireSynchronisationSuperPdp.mockResolvedValue({ configuree: false, erreur: null })
  onImported.mockReset()
  onClose.mockReset()
})
afterEach(() => vi.restoreAllMocks())

/** Un bouton qui paraît après le chargement se cherche HORS de l'`act` : dedans, React retiendrait le rendu qui le
 * montre, et la recherche expirerait sur un écran qui fonctionne. */
async function cliquer(texte: string) {
  const bouton = await screen.findByText(texte)
  await act(async () => { bouton.click() })
}

/** Les fonctions du module appelées, dans l'ordre — la lecture de la connexion comprise. */
const appeles = () => Object.entries(m).filter(([, f]) => f.mock.calls.length > 0).map(([nom]) => nom).sort()

describe('l’ouverture', () => {
  it('ne lit que la connexion et la synchronisation Super PDP : rien ne part chez la plateforme', async () => {
    m.lireConnexionPlateforme.mockResolvedValue(ok({ connexion: null }))
    ouvrir()
    expect(await screen.findByText('Aucune plateforme n’est reliée à ce dossier.')).toBeTruthy()
    expect(appeles()).toEqual(['lireConnexionPlateforme', 'lireSynchronisationSuperPdp'])
    expect(m.lireConnexionPlateforme).toHaveBeenCalledWith('d1')
  })

  it('une lecture refusée n’est pas « aucune plateforme » : pas de formulaire, et « Réessayer » relit', async () => {
    m.lireConnexionPlateforme.mockResolvedValueOnce(refus('Accès refusé à ce dossier.'))
    ouvrir()
    expect(await screen.findByText('La connexion n’a pas pu être lue : Accès refusé à ce dossier.')).toBeTruthy()
    expect(screen.queryByText('Relier la plateforme du client')).toBeNull()
    expect(screen.queryByText('Aucune plateforme n’est reliée à ce dossier.')).toBeNull()

    m.lireConnexionPlateforme.mockResolvedValueOnce(ok({ connexion: null }))
    fireEvent.click(screen.getByText('Réessayer'))
    expect(await screen.findByText('Aucune plateforme n’est reliée à ce dossier.')).toBeTruthy()
    expect(screen.queryByText(/n’a pas pu être lue/)).toBeNull()
  })

  it('Super PDP configurée : l’écran prévient du double import ; illisible, il dit qu’il ne sait pas', async () => {
    m.lireSynchronisationSuperPdp.mockResolvedValue({ configuree: true, erreur: null })
    const { unmount } = ouvrir()
    expect(await screen.findByText(/une facture reçue par les deux chemins entrerait deux fois\. N’en gardez qu’un\./)).toBeTruthy()
    unmount()

    m.lireSynchronisationSuperPdp.mockResolvedValue({ configuree: null, erreur: 'Accès refusé.' })
    ouvrir()
    expect(await screen.findByText(/La synchronisation Super PDP du dossier n’a pas pu être lue \(Accès refusé\.\)/)).toBeTruthy()
  })

  it('sans synchronisation Super PDP, rien n’est dit', async () => {
    ouvrir()
    await screen.findByText('Chercher les nouvelles factures')
    expect(screen.queryByText(/entrerait deux fois/)).toBeNull()
  })
})

describe('relier la plateforme', () => {
  it('le préréglage Super PDP, le secret exigé, et rien ne part avant le clic', async () => {
    m.lireConnexionPlateforme.mockResolvedValue(ok({ connexion: null }))
    m.enregistrerConnexionPlateforme.mockResolvedValue(ok({ connexion: connexion({ nom: 'Super PDP', hote: 'api.superpdp.tech' }) }))
    ouvrir()
    fireEvent.click(await screen.findByText('Relier la plateforme du client'))
    const enregistrer = screen.getByText('Enregistrer') as HTMLButtonElement
    expect(enregistrer.disabled).toBe(true)

    fireEvent.click(screen.getByText('Préremplir pour Super PDP'))
    expect((screen.getByLabelText('Adresse du service des flux (API AFNOR)') as HTMLInputElement).value).toBe('https://api.superpdp.tech/afnor-flow')
    expect((screen.getByLabelText('Adresse des jetons (OAuth2)') as HTMLInputElement).value).toBe('https://api.superpdp.tech/oauth2/token')
    fireEvent.change(screen.getByLabelText('Identifiant (client_id)'), { target: { value: 'cabinet-42' } })
    // Sans secret, une première connexion ne s'enregistre pas.
    expect(enregistrer.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Secret (client_secret)'), { target: { value: 's3cr3t' } })
    expect(enregistrer.disabled).toBe(false)
    expect(m.enregistrerConnexionPlateforme).not.toHaveBeenCalled()

    await act(async () => { enregistrer.click() })
    expect(m.enregistrerConnexionPlateforme).toHaveBeenCalledWith('d1', {
      nom: 'Super PDP', url_flux: 'https://api.superpdp.tech/afnor-flow', url_jeton: 'https://api.superpdp.tech/oauth2/token',
      client_id: 'cabinet-42', client_secret: 's3cr3t', organisation_id: '', portee: '',
    })
    expect(await screen.findByText('Chercher les nouvelles factures')).toBeTruthy()
    expect(screen.getByText(/Connexion enregistrée/)).toBeTruthy()
  })

  it('une adresse en clair se dit avant le clic, et l’enregistrement reste fermé', async () => {
    m.lireConnexionPlateforme.mockResolvedValue(ok({ connexion: null }))
    ouvrir()
    fireEvent.click(await screen.findByText('Relier la plateforme du client'))
    fireEvent.change(screen.getByLabelText('Nom de la plateforme'), { target: { value: 'Plateforme' } })
    fireEvent.change(screen.getByLabelText('Adresse du service des flux (API AFNOR)'), { target: { value: 'http://pa.exemple.fr' } })
    fireEvent.change(screen.getByLabelText('Adresse des jetons (OAuth2)'), { target: { value: 'https://pa.exemple.fr/jeton' } })
    fireEvent.change(screen.getByLabelText('Identifiant (client_id)'), { target: { value: 'cabinet' } })
    fireEvent.change(screen.getByLabelText('Secret (client_secret)'), { target: { value: 'secret' } })
    expect(screen.getByText('L’adresse du service des flux doit commencer par https:// — la fonction y envoie un secret.')).toBeTruthy()
    expect((screen.getByText('Enregistrer') as HTMLButtonElement).disabled).toBe(true)
  })

  it('un formulaire qu’on commence à remplir ne crie pas', async () => {
    m.lireConnexionPlateforme.mockResolvedValue(ok({ connexion: null }))
    ouvrir()
    fireEvent.click(await screen.findByText('Relier la plateforme du client'))
    expect(document.querySelector('.error-text')).toBeNull()
  })

  it('modifier : le secret laissé vide garde celui qui est enregistré', async () => {
    m.lireConnexionPlateforme.mockResolvedValue(ok({ connexion: connexion({ organisation_id: 'org-1' }) }))
    m.enregistrerConnexionPlateforme.mockResolvedValue(ok({ connexion: connexion({ nom: 'Plateforme renommée' }) }))
    ouvrir()
    fireEvent.click(await screen.findByText('Modifier'))
    expect((screen.getByLabelText('Secret (client_secret)') as HTMLInputElement).value).toBe('')
    expect(screen.getByText('Laissé vide, le secret enregistré est gardé : il ne s’affiche jamais.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Nom de la plateforme'), { target: { value: 'Plateforme renommée' } })
    await act(async () => { (screen.getByText('Enregistrer') as HTMLButtonElement).click() })
    expect(m.enregistrerConnexionPlateforme).toHaveBeenCalledWith('d1', expect.objectContaining({
      nom: 'Plateforme renommée', client_secret: '', organisation_id: 'org-1', client_id: 'cabinet-42',
    }))
  })

  it('un refus de la fonction se dit, et le formulaire reste', async () => {
    m.lireConnexionPlateforme.mockResolvedValue(ok({ connexion: connexion() }))
    m.enregistrerConnexionPlateforme.mockResolvedValue(refus('L’adresse des jetons : « 10.0.0.1 » embarque une adresse IP.'))
    ouvrir()
    fireEvent.click(await screen.findByText('Modifier'))
    await act(async () => { (screen.getByText('Enregistrer') as HTMLButtonElement).click() })
    expect(screen.getByText('L’adresse des jetons : « 10.0.0.1 » embarque une adresse IP.')).toBeTruthy()
    expect(screen.getByLabelText('Nom de la plateforme')).toBeTruthy()
  })
})

describe('tester la connexion', () => {
  it('sur un clic seulement, et la réponse se dit', async () => {
    m.testerConnexionPlateforme.mockResolvedValueOnce(ok({ ok: true }))
    ouvrir()
    await cliquer('Tester la connexion')
    expect(m.testerConnexionPlateforme).toHaveBeenCalledWith('d1')
    expect(screen.getByText('La plateforme répond et accepte l’accès du cabinet.')).toBeTruthy()

    m.testerConnexionPlateforme.mockResolvedValueOnce(refus('La plateforme refuse l’identifiant ou le secret (401).', { identifiants_refuses: true }))
    await act(async () => { screen.getByText('Tester la connexion').click() })
    expect(screen.getByText('La plateforme refuse l’identifiant ou le secret (401).')).toBeTruthy()
  })
})

describe('chercher puis importer', () => {
  async function chercher(l: ListeFlux, p: PlanReception, siret?: string | null) {
    m.listerFlux.mockResolvedValue(ok(l))
    m.preparerReception.mockResolvedValue({ plan: p, hashsConnus: new Set(['h1']) })
    ouvrir(siret)
    await cliquer('Chercher les nouvelles factures')
  }

  it('le plan : à importer, déjà là, en attente, rejetées, et ce qui a été écarté', async () => {
    const a = flux(), b = flux({ sens: 'vente', nom: null, recu_le: null })
    await chercher(
      liste({ flux: [a, b], ecartes: { autre_flux: 2, illisible: 0, format: 1, statut_inconnu: 0, doublons: 0 } }),
      plan({ aImporter: [a, b], dejaImportes: [flux()], enAttente: [flux(), flux()], rejetes: [flux()] }),
    )
    expect(m.preparerReception).toHaveBeenCalledWith('d1', expect.objectContaining({ hote: 'pa.exemple.fr' }))
    expect(screen.getByText('2 factures à importer')).toBeTruthy()
    expect(screen.getByText('FA-1.xml', { exact: false })).toBeTruthy()
    expect(screen.getByText(`Facture ${b.id}`, { exact: false })).toBeTruthy()
    expect(screen.getByText('1 déjà importée : elle ne revient pas.')).toBeTruthy()
    expect(screen.getByText('2 encore en traitement chez la plateforme : elles reviendront à une prochaine recherche.')).toBeTruthy()
    expect(screen.getByText('1 rejetée par la plateforme : elle ne s’importe pas.')).toBeTruthy()
    expect(screen.getByText('2 messages écartés : ce ne sont pas des factures (statuts de cycle de vie, e-reporting).')).toBeTruthy()
    expect(screen.getByText('1 facture écartée : dans un format que l’application ne lit pas.')).toBeTruthy()
    expect(m.recevoirFactures).not.toHaveBeenCalled()
  })

  it('une liste incomplète le dit', async () => {
    const a = flux()
    await chercher(liste({ flux: [a], complete: false, motif: 'plus de 20 pages : relancez la récupération pour la suite' }), plan({ aImporter: [a] }))
    expect(screen.getByText(/Liste incomplète : plus de 20 pages : relancez la récupération pour la suite\./)).toBeTruthy()
  })

  it('rien de neuf : rien à importer, et aucun bouton pour le faire', async () => {
    await chercher(liste(), plan({ dejaImportes: [flux()] }))
    expect(screen.getByText('Aucune nouvelle facture à importer')).toBeTruthy()
    expect(screen.queryByText(/^Importer /)).toBeNull()
  })

  it('une préparation refusée (lecture partielle) se dit, et rien n’est proposé à l’import', async () => {
    m.listerFlux.mockResolvedValue(ok(liste({ flux: [flux()] })))
    m.preparerReception.mockResolvedValue({ refus: 'Les factures déjà importées n’ont pas pu être lues en entier (coupure).' })
    ouvrir()
    await cliquer('Chercher les nouvelles factures')
    expect(screen.getByText('Les factures déjà importées n’ont pas pu être lues en entier (coupure).')).toBeTruthy()
    expect(screen.queryByText(/^Importer /)).toBeNull()
  })

  it('une connexion changée depuis : la liste se relit, et on le dit', async () => {
    m.listerFlux.mockResolvedValue(refus('La connexion a changé.', { perimee: true }))
    ouvrir()
    await screen.findByText('Chercher les nouvelles factures')
    expect(m.lireConnexionPlateforme).toHaveBeenCalledTimes(1)
    await act(async () => { screen.getByText('Chercher les nouvelles factures').click() })
    expect(screen.getByText('La connexion a changé depuis : relancez la recherche.')).toBeTruthy()
    expect(m.lireConnexionPlateforme).toHaveBeenCalledTimes(2)
  })

  it('sans SIRET au dossier, l’import est fermé, et l’écran dit pourquoi', async () => {
    const a = flux()
    await chercher(liste({ flux: [a] }), plan({ aImporter: [a] }), null)
    expect(screen.getByText(/Renseignez le SIRET du dossier \(onglet Informations\) avant d’importer/)).toBeTruthy()
    expect((screen.getByText('Importer la facture') as HTMLButtonElement).disabled).toBe(true)
  })

  it('trois clics n’importent qu’une fois ; le bilan dit ce qu’il faut vérifier', async () => {
    const a = flux(), b = flux(), c = flux(), d = flux(), e = flux()
    const l = liste({ flux: [a, b, c, d, e] })
    await chercher(l, plan({ aImporter: [a, b, c, d, e] }))
    let terminer!: (b: BilanReception) => void
    m.recevoirFactures.mockImplementation(() => new Promise((r) => { terminer = r }))
    const bouton = screen.getByText('Importer les 5 factures') as HTMLButtonElement
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(m.recevoirFactures).toHaveBeenCalledTimes(1)
    expect(m.recevoirFactures).toHaveBeenCalledWith(
      { dossierId: 'd1', userId: 'utilisateur-1', version: 'v1', hote: 'pa.exemple.fr', sirenDossier: '123456782', hashsConnus: new Set(['h1']) },
      l, expect.objectContaining({ aImporter: [a, b, c, d, e] }), expect.any(Function),
    )
    // Fermer reste fermé pendant l'import : la fenêtre partirait avec son bilan.
    expect((screen.getByText('Fermer') as HTMLButtonElement).disabled).toBe(true)

    await act(async () => {
      terminer(bilan({
        issues: [
          { statut: 'importee', flux: a, pieceId: 'p1', avertissements: [] },
          { statut: 'importee', flux: b, pieceId: 'p2', avertissements: ['Total de la TVA absent.'] },
          { statut: 'autre_entreprise', flux: c, siren: '987654321' },
          { statut: 'deja_importee', flux: d },
          { statut: 'interrompu', flux: e, raison: 'acces', message: 'La plateforme refuse l’accès.' },
        ],
        interruption: { statut: 'interrompu', flux: e, raison: 'acces', message: 'La plateforme refuse l’accès.' },
      }))
    })
    expect(screen.getByText('2 factures importées, « à valider » dans Justificatifs.')).toBeTruthy()
    expect(screen.getByText('1 déjà dans le dossier.')).toBeTruthy()
    expect(screen.getByText(`${b.nom} : importée — à vérifier : Total de la TVA absent.`)).toBeTruthy()
    expect(screen.getByText(new RegExp(`^${c.nom} : adressée à l’entreprise de SIREN 987654321, pas à ce dossier`))).toBeTruthy()
    // Ni l'interruption (dite à part), ni « déjà dans le dossier » (compté), ni une importée sans remarque ne se
    // détaillent.
    expect(screen.queryByText(new RegExp(`^${a.nom} :`))).toBeNull()
    expect(screen.queryByText(new RegExp(`^${d.nom} :`))).toBeNull()
    expect(screen.queryByText(new RegExp(`^${e.nom} :`))).toBeNull()
    expect(screen.getByText(/Import interrompu : La plateforme refuse l’accès\. Les factures non faites reviendront/)).toBeTruthy()
    expect(onImported).toHaveBeenCalledTimes(1)
    // La connexion se relit : son point de reprise a bougé.
    expect(m.lireConnexionPlateforme).toHaveBeenCalledTimes(2)
  })

  it('rien d’importé : la liste des pièces ne se recharge pas', async () => {
    const a = flux()
    await chercher(liste({ flux: [a] }), plan({ aImporter: [a] }))
    m.recevoirFactures.mockResolvedValue(bilan({ issues: [{ statut: 'doublon', flux: a }] }))
    await act(async () => { screen.getByText('Importer la facture').click() })
    expect(screen.getByText(/son fichier est déjà au dossier/)).toBeTruthy()
    expect(onImported).not.toHaveBeenCalled()
  })

  it('un point de reprise refusé se dit : la prochaine recherche relira ces factures', async () => {
    const a = flux()
    await chercher(liste({ flux: [a] }), plan({ aImporter: [a] }))
    m.recevoirFactures.mockResolvedValue(bilan({
      issues: [{ statut: 'importee', flux: a, pieceId: 'p1', avertissements: [] }], erreurReprise: 'Indisponible.',
    }))
    await act(async () => { screen.getByText('Importer la facture').click() })
    expect(screen.getByText(/Le point de reprise n’a pas pu être enregistré \(Indisponible\.\)/)).toBeTruthy()
  })

  it('le verrou tient jusqu’à la relecture de la connexion : pas de seconde recherche sur un point qui bouge', async () => {
    const a = flux()
    await chercher(liste({ flux: [a] }), plan({ aImporter: [a] }))
    m.recevoirFactures.mockResolvedValue(bilan({ issues: [{ statut: 'importee', flux: a, pieceId: 'p1', avertissements: [] }] }))
    let relue!: () => void
    m.lireConnexionPlateforme.mockImplementationOnce(() => new Promise((r) => { relue = () => r(ok({ connexion: connexion({ recherche_depuis: '2026-10-01T10:00:00.000Z' }) })) }))
    await act(async () => { screen.getByText('Importer la facture').click() })
    expect((screen.getByText('Chercher les nouvelles factures') as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { relue() })
    expect((screen.getByText('Chercher les nouvelles factures') as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('reprendre du début et retirer', () => {
  it('« Reprendre du début » n’est offert que quand la recherche a avancé, et part avec la version lue', async () => {
    const { unmount } = ouvrir()
    await screen.findByText('Chercher les nouvelles factures')
    expect(screen.queryByText('Reprendre du début')).toBeNull()
    unmount()

    m.lireConnexionPlateforme.mockResolvedValue(ok({ connexion: connexion({ recherche_depuis: '2026-10-01T10:00:00.000Z', version: 'v7' }) }))
    m.repartirDuDebut.mockResolvedValue(ok({ recherche_depuis: null }))
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    ouvrir()
    await cliquer('Reprendre du début')
    expect(m.repartirDuDebut).not.toHaveBeenCalled()
    await act(async () => { screen.getByText('Reprendre du début').click() })
    expect(confirmer.mock.calls[1][0]).toMatch(/celles déjà importées seront reconnues et écartées/)
    expect(m.repartirDuDebut).toHaveBeenCalledWith('d1', 'v7')
    expect(screen.getByText('La prochaine recherche repartira du début.')).toBeTruthy()
  })

  it('retirer : la confirmation nomme ce qui part et ce qui reste ouvert ; refusée, rien ne part', async () => {
    m.retirerConnexionPlateforme.mockResolvedValue(ok({ ok: true }))
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    ouvrir()
    await cliquer('Retirer')
    expect(m.retirerConnexionPlateforme).not.toHaveBeenCalled()
    const texte = confirmer.mock.calls[0][0] as string
    expect(texte).toMatch(/plus aucune facture ne sera reçue par ce chemin/)
    expect(texte).toMatch(/les pièces déjà importées restent/)
    expect(texte).toMatch(/demandez-lui de le fermer/)

    await act(async () => { screen.getByText('Retirer').click() })
    expect(m.retirerConnexionPlateforme).toHaveBeenCalledWith('d1')
    expect(screen.getByText('Aucune plateforme n’est reliée à ce dossier.')).toBeTruthy()
    expect(screen.getByText('Connexion retirée.')).toBeTruthy()
  })

  it('un retrait refusé laisse la connexion affichée, et dit pourquoi', async () => {
    m.retirerConnexionPlateforme.mockResolvedValue(refus('Accès refusé à ce dossier.'))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    ouvrir()
    await cliquer('Retirer')
    expect(screen.getByText('Accès refusé à ce dossier.')).toBeTruthy()
    expect(screen.getByText('Chercher les nouvelles factures')).toBeTruthy()
  })
})
