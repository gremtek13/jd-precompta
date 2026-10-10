import { act, cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import FicheHorsDeFrance, { type DonneesHorsDeFrance } from './FicheHorsDeFrance'
import { remplirModele } from '../../lib/encaissementsFactures'
import { REFUS_FICHE_HORS_DE_FRANCE, REFUS_RETRAIT_FICHE, type CleRefusFiche, type CleRefusRetraitFiche } from '../../lib/piecesHorsDeFrance'
import type { LectureFichesHorsDeFrance } from '../../lib/propositionsHorsDeFrance'
import type { Piece, PieceHorsDeFrance, PieceHorsDeFranceTaux } from '../../lib/types'

// LA FICHE « FOURNISSEUR ÉTABLI HORS DE FRANCE » À L'ÉCRAN (ligne 28.5, e-reporting, étape e3). Ce que le module ne
// voit pas, et que ce test garde : rien n'est montré ni offert sur une lecture pas encore revenue ou partielle ; les refus
// des deux fonctions se disent AVANT le clic, dans leur ordre ; le verrou d'écriture ferme le deuxième et le troisième
// clic du même rendu et ne se relâche qu'APRÈS la relecture ; une proposition ne remplit rien sans un clic ; les
// paramètres envoyés sont ceux de la signature. Les jeux d'essai sont FICTIFS.

const faux = vi.hoisted(() => ({
  // Ce que rend la lecture du texte de la pièce ; null la laisse en attente.
  texte: { data: null, error: null } as null | { data: unknown; error: unknown },
  lecturesTexte: [] as unknown[],
  // Les appels aux fonctions de la base, dans l'ordre, et de quoi rendre chacun quand le test le décide.
  appels: [] as { nom: string; args: unknown }[],
  reponses: [] as ((v: { data: unknown; error: unknown }) => void)[],
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table !== 'piece_textes_ocr') throw new Error(`Table non attendue dans ce test : ${table}`)
      return {
        select: () => ({
          eq: (_colonne: string, valeur: unknown) => ({
            maybeSingle: () => {
              faux.lecturesTexte.push(valeur)
              return faux.texte ? Promise.resolve(faux.texte) : new Promise(() => {})
            },
          }),
        }),
      }
    },
    rpc: (nom: string, args: unknown) => {
      faux.appels.push({ nom, args })
      return new Promise((resolve) => { faux.reponses.push(resolve) })
    },
  },
}))

function piece(o: Partial<Piece> = {}): Piece {
  return {
    id: 'p1', dossier_id: 'd1', uploaded_by: null, source: 'upload', storage_path: 'd1/facture.pdf', nom_fichier: 'facture.pdf',
    storage_hash: null, date_piece: '2026-09-02', tiers: 'Nuage Logiciel Ltd', montant_ht: null, montant_tva: null,
    montant_ttc: 120, devise: 'EUR', montant_devise: null, taux_change: null, conversion_source: null, categorie_id: null,
    sous_dossier_id: null, type_piece: 'achat', statut: 'a_valider', notes: null, confiance: 'haute', superpdp_invoice_id: null,
    flux_hote: null, flux_id: null, lisible_path: null, identite_numero: null, identite_siren_vendeur: null, identite_date: null,
    identite_nature: null, created_at: '2026-09-02T09:00:00Z', updated_at: '2026-09-02T09:00:00Z', ...o,
  }
}

function fiche(o: Partial<PieceHorsDeFrance> = {}): PieceHorsDeFrance {
  return {
    id: 'f1', dossier_id: 'd1', piece_id: 'p1', remplace_id: null, numero: 'INV-2026-0042', date_facture: '2026-09-01',
    type_document: '380', facture_origine_numero: null, facture_origine_date: null, devise: 'EUR', pays: 'IE',
    schema_identifiant: '0223', identifiant: 'IE1234567WA', nature: 'services', autoliquidation: true,
    date_operation: null, periode_debut: null, periode_fin: null, cree_par: null, cree_le: '2026-10-05T08:00:00Z',
    retire_le: null, retire_par: null, ...o,
  }
}

function ligne(o: Partial<PieceHorsDeFranceTaux> = {}): PieceHorsDeFranceTaux {
  return { fiche_id: 'f1', dossier_id: 'd1', code_tva: 'AE', taux: 0, base: 120, tva: 0, motif_code: null, motif_texte: null, ...o }
}

const VIDE: LectureFichesHorsDeFrance = { fiches: [], taux: [], motif: null }
const AVEC_FICHE: LectureFichesHorsDeFrance = { fiches: [fiche()], taux: [ligne()], motif: null }

function message(cle: CleRefusFiche, ...valeurs: string[]): string {
  return remplirModele(REFUS_FICHE_HORS_DE_FRANCE.find((r) => r.cle === cle)!.modele, valeurs)
}
function messageRetrait(cle: CleRefusRetraitFiche, ...valeurs: string[]): string {
  return remplirModele(REFUS_RETRAIT_FICHE.find((r) => r.cle === cle)!.modele, valeurs)
}

interface Montage {
  piece?: Partial<Piece>
  donnees?: Partial<DonneesHorsDeFrance>
  pieceModifiee?: boolean
  sansTexteLu?: boolean
}

function elements(o: Montage) {
  const relire = vi.fn<() => Promise<void>>(() => Promise.resolve())
  const donnees: DonneesHorsDeFrance = { lecture: VIDE, relire, anneeFigeante: null, gelIncomplet: null, pieces: [], ...o.donnees }
  return {
    donnees,
    jsx: (
      <FicheHorsDeFrance
        dossierId="d1" piece={piece(o.piece)} pieceModifiee={o.pieceModifiee ?? false} donnees={donnees} sansTexteLu={o.sansTexteLu ?? false}
      />
    ),
  }
}

async function monter(o: Montage = {}) {
  const { donnees, jsx } = elements(o)
  const vue = render(jsx)
  await act(async () => {})
  return { ...vue, donnees }
}

const bouton = (nom: string | RegExp) => screen.queryByRole('button', { name: nom })
const refusAffiche = () => screen.queryByRole('status')?.textContent ?? null
const champ = (libelle: string | RegExp) => screen.getByLabelText(libelle) as HTMLInputElement | HTMLSelectElement
function saisir(libelle: string | RegExp, valeur: string) {
  fireEvent.change(champ(libelle), { target: { value: valeur } })
}

// La saisie qu'une base accepterait, pour la pièce d'achat de 120 € : un fournisseur irlandais, autoliquidée.
function remplirUneFicheValable() {
  saisir('Numéro de la facture', 'INV-2026-0042')
  saisir('Sa date', '2026-09-01')
  saisir('Pays du fournisseur', 'IE')
  saisir(/Son numéro de TVA/, 'IE1234567WA')
  saisir('Nature de l’achat', 'services')
  saisir('Le dossier autoliquide-t-il la TVA ?', 'oui')
  saisir('Code de TVA', 'AE')
  saisir('Base (EUR)', '120')
}

const ATTENDUS = {
  p_dossier_id: 'd1', p_piece_id: 'p1', p_remplace_id: null, p_numero: 'INV-2026-0042', p_date_facture: '2026-09-01',
  p_type_document: '380', p_facture_origine_numero: null, p_facture_origine_date: null, p_pays: 'IE', p_schema_identifiant: '0223',
  p_identifiant: 'IE1234567WA', p_nature: 'services', p_autoliquidation: true, p_date_operation: null, p_periode_debut: null,
  p_periode_fin: null, p_taux: [{ code: 'AE', taux: 0, base: 120, tva: 0 }],
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-10T10:00:00Z'))
})
afterAll(() => { vi.useRealTimers() })
beforeEach(() => {
  faux.texte = { data: null, error: null }
  faux.lecturesTexte = []
  faux.appels = []
  faux.reponses = []
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('FicheHorsDeFrance — rien sur une lecture qui n’est pas revenue entière', () => {
  it('avant la lecture des fiches, n’offre rien et dit qu’elle lit', async () => {
    await monter({ donnees: { lecture: null } })
    expect(screen.queryAllByRole('button')).toEqual([])
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
  })

  it('sur une lecture partielle, ne montre aucune fiche et n’offre que de relire', async () => {
    const { donnees } = await monter({ donnees: { lecture: { ...AVEC_FICHE, motif: 'lecture interrompue après 0 ligne(s)' } } })
    expect(screen.getByText(/n’ont pas pu être lues en entier \(lecture interrompue après 0 ligne\(s\)\)/)).toBeTruthy()
    expect(screen.queryByText(/INV-2026-0042/)).toBeNull()
    expect(screen.queryAllByRole('button').map((b) => b.textContent)).toEqual(['Relire les fiches'])
    await act(async () => { bouton('Relire les fiches')!.click() })
    expect(donnees.relire).toHaveBeenCalledTimes(1)
  })

  it('ne paraît pas sur une pièce qui n’est pas un achat et n’a pas de fiche', async () => {
    const { container } = await monter({ piece: { type_piece: 'vente' } })
    expect(container.innerHTML).toBe('')
    // Ni ne lit son texte : elle n'en proposerait rien.
    expect(faux.lecturesTexte).toEqual([])
  })

  it('ne lit pas le texte d’une pièce que l’onglet sait sans texte', async () => {
    await monter({ sansTexteLu: true })
    expect(faux.lecturesTexte).toEqual([])
    await monter({})
    expect(faux.lecturesTexte).toEqual(['p1'])
  })

  it('suspend toute écriture quand on ne sait pas si la pièce est figée', async () => {
    await monter({ donnees: { lecture: AVEC_FICHE, gelIncomplet: 'lecture interrompue' } })
    expect(screen.getByText(/La liste des écritures validées n’a pas pu être lue en entier \(lecture interrompue\)/)).toBeTruthy()
    expect(bouton(/Saisir/)).toBeNull()
    expect(bouton('Retirer la fiche')).toBeNull()
  })
})

describe('FicheHorsDeFrance — les refus de la base, dits avant le clic', () => {
  it('dit le refus de la pièce (une TVA facturée, hypothèse Q7) et n’offre pas de saisie', async () => {
    await monter({ piece: { montant_tva: 20, montant_ttc: 120 } })
    expect(screen.getByText(message('tva_sur_la_piece', '20,00'))).toBeTruthy()
    expect(bouton('Saisir la fiche')).toBeNull()
  })

  it('dit le gel d’une pièce figée, et n’offre ni nouvelle version ni retrait', async () => {
    await monter({ donnees: { lecture: AVEC_FICHE, anneeFigeante: 2025 } })
    expect(screen.getByText(message('piece_figee', '2025'))).toBeTruthy()
    expect(screen.getByText(messageRetrait('figee', '2025'))).toBeTruthy()
    expect(bouton(/Saisir/)).toBeNull()
    expect(bouton('Retirer la fiche')).toBeNull()
  })

  it('dit d’enregistrer d’abord une pièce dont le type ou les montants portent une saisie', async () => {
    await monter({ pieceModifiee: true })
    expect(screen.getByText(/Enregistrez d’abord la pièce/)).toBeTruthy()
    expect(bouton('Saisir la fiche')).toBeNull()
  })

  it('dit chaque refus dans l’ordre de la fonction, le bouton fermé, puis l’ouvre sur une saisie acceptable', async () => {
    await monter()
    await act(async () => { bouton('Saisir la fiche')!.click() })
    const enregistrer = () => bouton('Enregistrer la fiche') as HTMLButtonElement
    const etapes: [() => void, string][] = [
      [() => {}, message('numero_absent')],
      [() => saisir('Numéro de la facture', 'INV-2026-0042'), message('date_absente')],
      [() => saisir('Sa date', '2026-10-11'), message('date_future', '10/10/2026')],
      [() => saisir('Sa date', '2026-09-01'), message('pays_inconnu')],
      [() => saisir('Pays du fournisseur', 'MC'), message('pays_monaco')],
      [() => saisir('Pays du fournisseur', 'IE'), message('identifiant_absent')],
      [() => saisir(/Son numéro de TVA/, 'DE123456789'), message('numero_tva_invalide', 'IE', 'IE')],
      [() => saisir(/Son numéro de TVA/, 'IE1234567WA'), message('nature')],
      [() => saisir('Nature de l’achat', 'services'), message('autoliquidation_absente')],
      // Une base vide n'est pas un nombre : la ventilation est illisible avant d'avoir un code.
      [() => saisir('Le dossier autoliquide-t-il la TVA ?', 'non'), message('ventilation_illisible')],
      [() => saisir('Base (EUR)', '100'), message('code_inconnu', '')],
      [() => saisir('Code de TVA', 'AE'), message('autoliquidation_requise')],
      [() => saisir('Le dossier autoliquide-t-il la TVA ?', 'oui'), message('ventilation_hors_ttc', '100,00', 'EUR', '120,00', 'EUR')],
    ]
    for (const [geste, attendu] of etapes) {
      act(() => geste())
      expect(refusAffiche()).toBe(attendu)
      expect(enregistrer().disabled).toBe(true)
    }
    act(() => saisir('Base (EUR)', '120'))
    expect(refusAffiche()).toBeNull()
    expect(enregistrer().disabled).toBe(false)
    // Rien n'est parti pendant la saisie.
    expect(faux.appels).toEqual([])
  })

  it('dit la même facture déjà décrite sur une autre pièce du dossier', async () => {
    await monter({ donnees: { lecture: { fiches: [fiche({ id: 'autre', piece_id: 'p9' })], taux: [], motif: null } } })
    await act(async () => { bouton('Saisir la fiche')!.click() })
    act(() => remplirUneFicheValable())
    expect(refusAffiche()).toBe(message('facture_deja_decrite'))
  })

  it('dit qu’une autre version a été enregistrée depuis, et offre d’en repartir', async () => {
    const { donnees, rerender } = await monter({ donnees: { lecture: AVEC_FICHE } })
    await act(async () => { bouton('Saisir une nouvelle version')!.click() })
    expect(refusAffiche()).toBeNull()
    // Relue entre-temps : une version f2 remplace f1, la courante sur laquelle la saisie s'était ouverte.
    const relue: LectureFichesHorsDeFrance = {
      fiches: [fiche(), fiche({ id: 'f2', remplace_id: 'f1', numero: 'INV-2026-0043' })], taux: [ligne(), ligne({ fiche_id: 'f2' })], motif: null,
    }
    rerender(<FicheHorsDeFrance dossierId="d1" piece={piece()} pieceModifiee={false} donnees={{ ...donnees, lecture: relue }} sansTexteLu={false} />)
    expect(refusAffiche()).toBe(message('fiche_changee'))
    await act(async () => { bouton('Repartir de la version enregistrée')!.click() })
    expect(refusAffiche()).toBeNull()
    expect((champ('Numéro de la facture') as HTMLInputElement).value).toBe('INV-2026-0043')
  })
})

describe('FicheHorsDeFrance — l’écriture, sous son verrou', () => {
  async function ouvrirEtRemplir(o: Montage = {}) {
    const vue = await monter(o)
    await act(async () => { bouton('Saisir la fiche')!.click() })
    act(() => remplirUneFicheValable())
    return vue
  }

  it('envoie les paramètres de la signature, puis relit, puis referme la saisie', async () => {
    const { donnees } = await ouvrirEtRemplir()
    await act(async () => { bouton('Enregistrer la fiche')!.click() })
    expect(faux.appels).toEqual([{ nom: 'enregistrer_fiche_hors_de_france', args: ATTENDUS }])
    expect(donnees.relire).not.toHaveBeenCalled()
    await act(async () => { faux.reponses[0]({ data: null, error: null }) })
    expect(donnees.relire).toHaveBeenCalledTimes(1)
    expect(bouton('Enregistrer la fiche')).toBeNull()
  })

  it('n’envoie qu’une fiche pour deux, puis trois clics du même rendu', async () => {
    await ouvrirEtRemplir()
    const b = bouton('Enregistrer la fiche')!
    await act(async () => { b.click(); b.click() })
    expect(faux.appels).toHaveLength(1)
    // Le troisième : un verrou posé DANS le `try` serait relâché par le `return` du deuxième.
    await act(async () => { b.click() })
    expect(faux.appels).toHaveLength(1)
  })

  it('ne relâche le verrou qu’après la relecture, et dit le refus de la base sous ses mots', async () => {
    let finirRelecture = () => {}
    const { donnees } = await ouvrirEtRemplir({
      donnees: { relire: vi.fn(() => new Promise<void>((resolve) => { finirRelecture = resolve })) },
    })
    const b = bouton('Enregistrer la fiche')!
    await act(async () => { b.click() })
    await act(async () => { faux.reponses[0]({ data: null, error: { message: 'Une autre fiche a été enregistrée pour cette pièce depuis : relire avant d’enregistrer.' } }) })
    // Refusée : la saisie reste, la relecture est partie et n'est pas revenue — un clic de plus ne part pas.
    expect(donnees.relire).toHaveBeenCalledTimes(1)
    await act(async () => { b.click() })
    expect(faux.appels).toHaveLength(1)
    await act(async () => { finirRelecture() })
    expect(screen.getByText('Une autre fiche a été enregistrée pour cette pièce depuis : relire avant d’enregistrer.')).toBeTruthy()
    await act(async () => { bouton('Enregistrer la fiche')!.click() })
    expect(faux.appels).toHaveLength(2)
  })

  it('n’envoie rien qu’un refus dit avant le clic : le bouton est fermé', async () => {
    await monter()
    await act(async () => { bouton('Saisir la fiche')!.click() })
    const b = bouton('Enregistrer la fiche') as HTMLButtonElement
    expect(b.disabled).toBe(true)
    await act(async () => { b.click() })
    expect(faux.appels).toEqual([])
  })

  it('retire la fiche courante après une confirmation qui la nomme, une seule fois pour deux clics', async () => {
    let question = ''
    vi.spyOn(window, 'confirm').mockImplementation((m?: string) => { question = m ?? ''; return true })
    const { donnees } = await monter({ donnees: { lecture: AVEC_FICHE } })
    const b = bouton('Retirer la fiche')!
    await act(async () => { b.click(); b.click() })
    expect(question).toContain('la facture n° INV-2026-0042 du 01/09/2026 (Irlande)')
    expect(question).toContain('Elle reste dans l’historique, marquée retirée')
    expect(faux.appels).toEqual([{ nom: 'retirer_fiche_hors_de_france', args: { p_dossier_id: 'd1', p_fiche_id: 'f1' } }])
    await act(async () => { faux.reponses[0]({ data: null, error: null }) })
    expect(donnees.relire).toHaveBeenCalledTimes(1)
  })

  it('ne retire rien quand la confirmation est refusée', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    await monter({ donnees: { lecture: AVEC_FICHE } })
    await act(async () => { bouton('Retirer la fiche')!.click() })
    expect(faux.appels).toEqual([])
  })

  it('un Entrée dans un champ ne soumet pas le formulaire de la pièce qui l’entoure', async () => {
    await monter()
    await act(async () => { bouton('Saisir la fiche')!.click() })
    const evenement = createEvent.keyDown(champ('Numéro de la facture'), { key: 'Enter' })
    fireEvent(champ('Numéro de la facture'), evenement)
    expect(evenement.defaultPrevented).toBe(true)
  })
})

describe('FicheHorsDeFrance — la fiche enregistrée', () => {
  it('montre la version courante, ses versions précédentes, et offre d’en saisir une nouvelle ou de la retirer', async () => {
    const lecture: LectureFichesHorsDeFrance = {
      fiches: [fiche({ cree_le: '2026-10-01T08:00:00Z', numero: 'INV-1' }), fiche({ id: 'f2', remplace_id: 'f1' })],
      taux: [ligne({ fiche_id: 'f2' })],
      motif: null,
    }
    await monter({ donnees: { lecture } })
    expect(screen.getByText(/n° INV-2026-0042 du 01\/09\/2026/)).toBeTruthy()
    expect(screen.getByText(/Version 2, enregistrée le 05\/10\/2026/)).toBeTruthy()
    expect(screen.getByText('Versions précédentes (1)')).toBeTruthy()
    expect(screen.getByText(/la facture n° INV-1 du 01\/09\/2026 \(Irlande\)/)).toBeTruthy()
    expect(bouton('Saisir une nouvelle version')).not.toBeNull()
    expect(bouton('Retirer la fiche')).not.toBeNull()
    // Les signaux ne s'adressent qu'à une pièce sans fiche.
    expect(screen.queryByText(/déjà une fiche/)).toBeNull()
  })

  it('reprend la version courante dans une saisie nouvelle, qui la remplace', async () => {
    await monter({ donnees: { lecture: AVEC_FICHE } })
    await act(async () => { bouton('Saisir une nouvelle version')!.click() })
    expect((champ('Numéro de la facture') as HTMLInputElement).value).toBe('INV-2026-0042')
    expect((champ('Base (EUR)') as HTMLInputElement).value).toBe('120,00')
    await act(async () => { bouton('Enregistrer cette version')!.click() })
    expect(faux.appels).toEqual([{ nom: 'enregistrer_fiche_hors_de_france', args: { ...ATTENDUS, p_remplace_id: 'f1' } }])
  })

  it('dit une fiche que la pièce, changée depuis, ne porte plus', async () => {
    await monter({ donnees: { lecture: { ...AVEC_FICHE, taux: [ligne({ base: 100 })] } } })
    expect(screen.getByText(/ne passerait plus les contrôles de la base/).textContent)
      .toContain(message('ventilation_hors_ttc', '100,00', 'EUR', '120,00', 'EUR'))
  })

  it('reste visible sur une pièce passée en vente, qui ne la porte plus, et se retire', async () => {
    await monter({ piece: { type_piece: 'vente' }, donnees: { lecture: AVEC_FICHE } })
    expect(screen.getByText(/ne passerait plus les contrôles de la base/).textContent).toContain(message('pas_un_achat'))
    expect(bouton(/Saisir/)).toBeNull()
    expect(bouton('Retirer la fiche')).not.toBeNull()
  })

  it('dit une fiche retirée, sans offrir de la retirer encore, et offre une nouvelle fiche', async () => {
    await monter({ donnees: { lecture: { ...AVEC_FICHE, fiches: [fiche({ retire_le: '2026-10-06T08:00:00Z' })] } } })
    expect(screen.getByText(/Retirée le 06\/10\/2026/)).toBeTruthy()
    expect(bouton('Retirer la fiche')).toBeNull()
    expect(bouton('Saisir une nouvelle fiche')).not.toBeNull()
  })
})

describe('FicheHorsDeFrance — les signaux et les propositions', () => {
  const TEXTE = 'NUAGE LOGICIEL LTD\nVAT IE 1234567WA\nInvoice number: INV-2026-0042\nReverse charge'

  it('dit les signaux lus dans le texte et sur la pièce, sans rien poser', async () => {
    faux.texte = { data: { texte: TEXTE }, error: null }
    await monter({ piece: { devise: 'USD', montant_devise: 130, taux_change: 0.92 } })
    expect(screen.getByText('Le document est en USD.')).toBeTruthy()
    expect(screen.getByText('Son texte porte un numéro de TVA d’un autre État de l’Union (Irlande) : « IE 1234567WA ».')).toBeTruthy()
    expect(screen.getByText('Son texte porte une mention d’autoliquidation : « Reverse charge ».')).toBeTruthy()
    expect(faux.appels).toEqual([])
  })

  it('montre chaque proposition avec sa source, et ne remplit un champ qu’au clic', async () => {
    faux.texte = { data: { texte: TEXTE }, error: null }
    await monter()
    await act(async () => { bouton('Saisir la fiche')!.click() })
    expect(screen.getByText(/aucune n’est reprise sans vous/)).toBeTruthy()
    const numero = screen.getByText('INV-2026-0042').closest('li')!
    expect(numero.textContent).toContain('lu dans le texte du document : « Invoice number: INV-2026-0042 »')
    // Rien n'est rempli d'office.
    expect((champ('Numéro de la facture') as HTMLInputElement).value).toBe('')
    expect((champ('Pays du fournisseur') as HTMLSelectElement).value).toBe('')
    await act(async () => { (numero.querySelector('button') as HTMLButtonElement).click() })
    expect((champ('Numéro de la facture') as HTMLInputElement).value).toBe('INV-2026-0042')
    // Reprise, elle ne se propose plus.
    expect(screen.queryByText('INV-2026-0042')).toBeNull()
    const ventilation = screen.getByText(/une ligne AE de/).closest('li')!
    await act(async () => { (ventilation.querySelector('button') as HTMLButtonElement).click() })
    expect((champ('Code de TVA') as HTMLSelectElement).value).toBe('AE')
    expect((champ('Base (EUR)') as HTMLInputElement).value).toBe('120,00')
    expect(faux.appels).toEqual([])
  })

  it('dit un texte dont la lecture est refusée, au lieu de le tenir pour vide', async () => {
    faux.texte = { data: null, error: { message: 'permission denied for table piece_textes_ocr' } }
    await monter()
    await act(async () => { bouton('Saisir la fiche')!.click() })
    expect(screen.getByText(/Le texte lu sur le document n’a pas pu être relu \(permission denied for table piece_textes_ocr\)/)).toBeTruthy()
  })

  it('ne propose l’identifiant d’un fournisseur hors de l’Union qu’une fois son pays choisi', async () => {
    await monter()
    await act(async () => { bouton('Saisir la fiche')!.click() })
    expect(screen.queryByText('USNuage Logiciel L')).toBeNull()
    act(() => saisir('Pays du fournisseur', 'US'))
    expect(screen.getByText('USNuage Logiciel L')).toBeTruthy()
    expect(screen.getByLabelText('Code du pays et début du nom')).toBeTruthy()
  })
})
