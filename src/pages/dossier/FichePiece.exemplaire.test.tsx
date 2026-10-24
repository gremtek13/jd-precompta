import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FichePiece from './FichePiece'
import type { DonneesExemplaire } from './ExemplaireDeLaFacture'
import type { DonneesHorsDeFrance } from './FicheHorsDeFrance'
import type { FactureProposee } from '../../lib/exemplairesDesFacturesLecture'
import { REFUS_GARDE_JUMELLE, REFUS_VALIDATION_D_UNE_VENTE } from '../../lib/exemplairesDesFactures'
import { remplirModele } from '../../lib/encaissementsFactures'
import type { Piece } from '../../lib/types'
import { ECARTS_ET_DECLARATIONS_VIDES } from '../../test/ereportingDeLaPiece'

// CE QUE CETTE PIÈCE EST, DANS LA FICHE D'UNE PIÈCE (ligne 28.6 : étapes VF1b et VF6c) : ce que la fiche fait de ce que l'écran
// qui l'ouvre lui donne, et de ce qu'elle lit elle-même — le geste est offert sur une pièce de vente quand l'écran a lu les
// factures, jamais sans ; le formulaire d'une pièce DÉSIGNÉE ou DÉCLARÉE dit avant l'enregistrement que sa nature ne change
// pas ; « Valider » est retenu par ce que G3 refuserait, sous ses mots, et attend tant que la fiche ne sait pas si le dossier
// a basculé ; une pièce neuve de vente d'un dossier basculé s'enregistre à valider ; après un geste, la fiche relit LA pièce
// (sa marque), sa ligne dans l'onglet, et ce qu'elle est. Le geste lui-même (verrou, confirmation, refus) est gardé par
// ExemplaireDeLaFacture.test.tsx. Le faux client APPLIQUE les filtres et annonce un compte. Données FICTIVES.
const faux = vi.hoisted(() => ({
  majPieces: [] as unknown[],
  insertions: [] as unknown[],
  rpcs: [] as string[],
  demandes: [] as string[],
  tables: {} as Record<string, Record<string, unknown>[]>,
  refus: {} as Record<string, string>,
  // Les lectures retenues jusqu'à ce que le cas les libère.
  retenir: false,
  retenues: [] as (() => void)[],
}))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatIn } = await import('../../test/filtresPostgrest')
  const repondre = <T,>(valeur: T): Promise<T> => (faux.retenir
    ? new Promise((resolve) => { faux.retenues.push(() => resolve(valeur)) })
    : Promise.resolve(valeur))
  return {
    supabase: {
      from: (table: string) => {
        if (table === 'notes_internes' || table === 'piece_textes_ocr') {
          return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }
        }
        const predicats: ((l: Record<string, unknown>) => boolean)[] = []
        const lignes = () => filtrer(faux.tables[table] ?? [], predicats)
        const q: Record<string, unknown> = {
          select: () => { faux.demandes.push(table); return q },
          eq: (c: string, v: unknown) => { predicats.push(predicatEq(c, v)); return q },
          in: (c: string, v: unknown[]) => { predicats.push(predicatIn(c, v)); return q },
          order: () => q,
          range: (debut: number, fin: number) => {
            if (faux.refus[table]) return repondre({ data: null, error: { message: faux.refus[table] }, count: null })
            const toutes = lignes()
            return repondre({ data: toutes.slice(debut, fin + 1), error: null, count: toutes.length })
          },
          maybeSingle: () => {
            if (faux.refus[table]) return repondre({ data: null, error: { message: faux.refus[table] } })
            return repondre({ data: lignes()[0] ?? null, error: null })
          },
          update: (ligne: unknown) => { faux.majPieces.push(ligne); return { eq: () => Promise.resolve({ error: null }) } },
          insert: (ligne: unknown) => { faux.insertions.push(ligne); return Promise.resolve({ error: null }) },
        }
        return q
      },
      rpc: (nom: string) => { faux.rpcs.push(nom); return Promise.resolve({ error: null }) },
      storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: null, error: { message: 'non utilisé' } }) }) },
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
    },
  }
})
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ monCabinetId: null, session: { user: { id: 'u1' } } }) }))
vi.mock('../../lib/extraction', () => ({
  hashFichier: () => Promise.resolve('empreinte-de-test'),
  fichierDejaPresent: () => Promise.resolve(false),
  extractPiece: () => Promise.resolve({}),
}))

const D = 'd1'
const HORS_DE_FRANCE: DonneesHorsDeFrance = {
  lecture: { fiches: [], taux: [], motif: null }, relire: async () => {}, anneeFigeante: null, gelIncomplet: null, pieces: [],
  ...ECARTS_ET_DECLARATIONS_VIDES,
}
const FACTURE: FactureProposee = {
  id: 'f1', dossier_id: D, statut: 'validee', type: 'facture', numero: 'F2026-0007', date_emission: '2026-03-14',
  tiers_nom: 'CLIENT FICTIF SAS', montant_ttc: 1200, source_de_la_vente: false,
}
const relirePiece = vi.fn<(id: string) => Promise<string | null>>()
const EXEMPLAIRE: DonneesExemplaire = {
  factures: { lignes: [FACTURE], complete: true, motif: null },
  relireLesFactures: async () => {}, anneeFigeante: null, gelIncomplet: null, relirePiece,
}

function piece(o: Partial<Piece> = {}): Piece {
  return {
    id: 'p1', dossier_id: D, uploaded_by: null, source: 'upload',
    storage_path: 'd1/vente-0007.pdf', nom_fichier: 'vente-0007.pdf', storage_hash: null,
    date_piece: '2026-03-14', tiers: 'CLIENT FICTIF SAS', montant_ht: 1000, montant_tva: 200,
    montant_ttc: 1200, devise: 'EUR', montant_devise: null, taux_change: null,
    conversion_source: null, categorie_id: null, sous_dossier_id: null, type_piece: 'vente',
    statut: 'a_valider', notes: null, confiance: null, superpdp_invoice_id: null, flux_hote: null, flux_id: null, lisible_path: null,
    identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null, facture_id: null, vente_hors_des_factures: false,
    created_at: '2026-03-14T09:00:00Z', updated_at: '2026-03-14T09:00:00Z', ...o,
  }
}

function monter(p: Piece | null, exemplaire?: DonneesExemplaire | null, venteEmise?: React.ComponentProps<typeof FichePiece>['venteEmise']) {
  return render(
    <FichePiece
      dossierId={D} categories={[]} sousDossiers={[]} tiersCategories={[]} tiersCategoriesCabinet={[]} tiersConnus={[]}
      piece={p} commentaires={[]} onClose={() => {}} onSaved={() => {}} onCommentaireAjoute={() => {}} onCommentaireSupprime={() => {}}
      horsDeFrance={HORS_DE_FRANCE} exemplaire={exemplaire} venteEmise={venteEmise}
    />,
  )
}

const choisirLeType = (valeur: string) => act(async () => {
  fireEvent.change(document.querySelector('#type')!, { target: { value: valeur } })
})
const valider = () => screen.getByRole('button', { name: 'Valider' }) as HTMLButtonElement
const brouillon = () => screen.getByRole('button', { name: 'Enregistrer brouillon' }) as HTMLButtonElement
const basculer = (oui: boolean) => { faux.tables.dossiers = [{ id: D, nom: 'Dossier fictif', ventes_par_les_factures: oui }] }
const refusG3 = (cle: string, ...valeurs: string[]) =>
  remplirModele(REFUS_VALIDATION_D_UNE_VENTE.find((r) => r.cle === cle)?.modele ?? `(${cle})`, valeurs)

beforeEach(() => {
  faux.majPieces = []; faux.insertions = []; faux.rpcs = []; faux.demandes = []; faux.refus = {}
  faux.retenir = false; faux.retenues = []
  faux.tables = {
    factures_emises: [{ ...FACTURE, emetteur_siret: '12345678900012', superpdp_invoice_id: 4242 }],
    transmissions_factures: [], lignes_bancaires: [], reglements_groupes: [], ecritures_brouillon: [], lettrages_manuels: [],
    encaissements_factures: [], designations_des_pieces: [], cabinet_admins: [], pieces: [],
  }
  basculer(false)
  relirePiece.mockReset().mockResolvedValue(null)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('FichePiece — ce que la pièce est, selon ce que l’écran appelant a lu', () => {
  it('sans rien lu par l’appelant (aucun `exemplaire`), la fiche d’une pièce de vente n’offre aucun geste, ne lit rien, et la base juge seule', async () => {
    basculer(true)
    await act(async () => { monter(piece()) })
    expect(screen.queryByText('Ce que cette pièce est')).toBeNull()
    expect(screen.queryByRole('button', { name: /Désigner|Défaire|Déclarer/ })).toBeNull()
    expect(faux.demandes).toEqual([])
    expect(valider().disabled).toBe(false)
  })

  it('les factures lues par l’appelant : une pièce de vente peut être désignée', async () => {
    await act(async () => { monter(piece(), EXEMPLAIRE) })
    expect(screen.getByText('Ce que cette pièce est')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Désigner comme exemplaire' })).toBeTruthy()
  })

  it('la même fiche, sur un achat : rien, quoi que l’appelant ait lu, et rien de plus ne se lit', async () => {
    await act(async () => { monter(piece({ type_piece: 'achat' }), EXEMPLAIRE) })
    expect(screen.queryByText('Ce que cette pièce est')).toBeNull()
    expect(screen.queryByRole('button', { name: /Désigner|Défaire|Déclarer/ })).toBeNull()
    expect(faux.demandes).toEqual([])
  })

  it('une pièce désignée offre de défaire, et la vente comptée deux fois est transmise à la confirmation', async () => {
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await act(async () => {
      monter(piece({ facture_id: 'f1' }), EXEMPLAIRE, {
        genre: 'double', libelle: 'Comptée deux fois', explication: 'La facture F2026-0007 est portée par 2 pièces.', autres: ['facture-0007.xml'],
      })
    })
    await act(async () => { screen.getByRole('button', { name: 'Défaire la désignation' }).click() })
    expect(String(confirmation.mock.calls[0][0])).toContain('« facture-0007.xml »')
    expect(String(confirmation.mock.calls[0][0])).toContain('NE RETIRE PAS le double compte')
    expect(faux.rpcs).toEqual([])
  })

  it('une vente reconnue seulement (« Facture émise… ») ne fait pas dire à la confirmation qu’elle est comptée deux fois', async () => {
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await act(async () => {
      monter(piece({ facture_id: 'f1' }), EXEMPLAIRE, {
        genre: 'jumelle', libelle: 'Facture émise F2026-0007', explication: 'Cette pièce est un exemplaire de la facture F2026-0007.', autres: [],
      })
    })
    await act(async () => { screen.getByRole('button', { name: 'Défaire la désignation' }).click() })
    expect(String(confirmation.mock.calls[0][0])).not.toContain('NE RETIRE PAS')
  })

  it('un dossier qui n’a pas basculé : seuls le dossier et le journal se lisent', async () => {
    await act(async () => { monter(piece(), EXEMPLAIRE) })
    expect([...new Set(faux.demandes)].sort()).toEqual(['designations_des_pieces', 'dossiers'])
  })
})

describe('FichePiece — après un geste, LA pièce relue, sa ligne, ce qu’elle est', () => {
  it('la déclaration posée : la fiche relit sa marque et la montre, alors que l’onglet ne recopie que la désignation', async () => {
    basculer(true)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await act(async () => { monter(piece(), EXEMPLAIRE) })
    // La base l'a déclarée, et le journal en garde la ligne.
    faux.tables.pieces = [{ ...piece(), vente_hors_des_factures: true, updated_at: '2026-10-24T09:00:00Z' }]
    faux.tables.designations_des_pieces = [{
      id: 'j1', dossier_id: D, piece_id: 'p1', geste: 'declaration', facture_id: null, auteur_id: 'u1', fait_le: '2026-10-24T09:00:00Z',
    }]
    faux.demandes = []
    await act(async () => { screen.getByRole('button', { name: 'Déclarer vente hors des factures de l’application' }).click() })
    expect(faux.rpcs).toEqual(['declarer_vente_hors_des_factures'])
    expect(faux.demandes).toContain('pieces')
    expect(relirePiece).toHaveBeenCalledWith('p1')
    expect(screen.getByText(/Cette pièce est déclarée vente hors des factures de l’application : aucune facture validée/)).toBeTruthy()
    expect(screen.getByText(/Déclarée vente hors des factures de l’application — par vous, le 24\/10\/2026/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retirer la déclaration' })).toBeTruthy()
    // Et le formulaire le sait : sa nature ne change plus.
    await choisirLeType('achat')
    expect(screen.getByText(REFUS_GARDE_JUMELLE.find((r) => r.cle === 'declaree_change_de_nature')?.modele ?? '?')).toBeTruthy()
  })

  it('une lecture plus lente écrit en dernier : seule la dernière demandée s’inscrit', async () => {
    // La première lecture voit un dossier qui n'a pas basculé ; la seconde, demandée après, le voit basculé. La seconde
    // revient d'abord ; la première, plus lente, ne doit pas la recouvrir.
    faux.retenir = true
    await act(async () => { monter(piece({ type_piece: 'achat' }), EXEMPLAIRE) })
    await choisirLeType('vente')
    const premiere = faux.retenues.length
    basculer(true)
    await choisirLeType('achat')
    await choisirLeType('vente')
    const secondes = faux.retenues.splice(premiere)
    const premieres = faux.retenues.splice(0)
    expect(premieres.length).toBeGreaterThan(0)
    expect(secondes.length).toBeGreaterThan(0)
    faux.retenir = false
    await act(async () => { for (const r of secondes) r() })
    await waitFor(() => expect(screen.getByText(refusG3('ni_designee_ni_declaree', 'vente-0007.pdf'))).toBeTruthy())
    await act(async () => { for (const r of premieres) r() })
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(screen.getByText(refusG3('ni_designee_ni_declaree', 'vente-0007.pdf'))).toBeTruthy()
    expect(valider().disabled).toBe(true)
  })

  it('la relecture de la pièce refusée : la section le dit, et n’offre plus aucun geste', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await act(async () => { monter(piece(), EXEMPLAIRE) })
    faux.refus = { pieces: 'lecture refusée' }
    fireEvent.change(screen.getByLabelText('Facture dont cette pièce est l’exemplaire'), { target: { value: 'f1' } })
    await act(async () => { screen.getByRole('button', { name: 'Désigner comme exemplaire' }).click() })
    expect(screen.getByText(/La pièce n’a pas pu être relue après le dernier geste \(lecture refusée\)/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Désigner/ })).toBeNull()
  })
})

describe('FichePiece — « Valider » et G3', () => {
  it('avant que la fiche sache si le dossier a basculé : la validation d’une vente attend, le brouillon reste offert', async () => {
    faux.retenir = true
    await act(async () => { monter(piece(), EXEMPLAIRE) })
    expect(valider().disabled).toBe(true)
    expect(screen.getByText(/La validation d’une pièce de vente attend de savoir si les factures de ce dossier sont la source de leurs ventes/)).toBeTruthy()
    expect(brouillon().disabled).toBe(false)
    await act(async () => { fireEvent.submit(document.querySelector('form')!) })
    expect(faux.majPieces).toEqual([])
    faux.retenir = false
    await act(async () => { for (const r of faux.retenues.splice(0)) r() })
    await waitFor(() => expect(valider().disabled).toBe(false))
  })

  it('un dossier qui n’a pas basculé : la validation part comme hier', async () => {
    await act(async () => { monter(piece(), EXEMPLAIRE) })
    expect(valider().disabled).toBe(false)
    await act(async () => { fireEvent.submit(document.querySelector('form')!) })
    expect(faux.majPieces).toEqual([expect.objectContaining({ statut: 'validee' })])
  })

  it('basculé, une vente ni désignée ni déclarée : « Valider » retenu sous les mots de G3, la pièce nommée ; le brouillon part', async () => {
    basculer(true)
    await act(async () => { monter(piece(), EXEMPLAIRE) })
    expect(screen.getByText(refusG3('ni_designee_ni_declaree', 'vente-0007.pdf'))).toBeTruthy()
    expect(valider().disabled).toBe(true)
    await act(async () => { fireEvent.submit(document.querySelector('form')!) })
    expect(faux.majPieces).toEqual([])
    await act(async () => { brouillon().click() })
    expect(faux.majPieces).toEqual([expect.objectContaining({ statut: 'a_valider' })])
  })

  it('basculé, désignée ou déclarée : la validation part', async () => {
    basculer(true)
    for (const p of [piece({ facture_id: 'f1' }), piece({ vente_hors_des_factures: true })]) {
      faux.majPieces = []
      await act(async () => { monter(p, EXEMPLAIRE) })
      expect(valider().disabled).toBe(false)
      await act(async () => { fireEvent.submit(document.querySelector('form')!) })
      expect(faux.majPieces).toEqual([expect.objectContaining({ statut: 'validee' })])
      cleanup()
    }
  })

  it('basculé, le pont qui prouve une facture : la pièce déclarée ne se valide pas, la facture nommée (G3, point 3)', async () => {
    basculer(true)
    await act(async () => { monter(piece({ vente_hors_des_factures: true, superpdp_invoice_id: 4242 }), EXEMPLAIRE) })
    expect(screen.getByText(refusG3('pont_une_facture', 'vente-0007.pdf', 'F2026-0007'))).toBeTruthy()
    expect(valider().disabled).toBe(true)
  })

  it('basculé, le pont qui prouve une facture, les factures lues en partie : la validation attend, sans taire le numéro', async () => {
    basculer(true)
    await act(async () => {
      monter(piece({ superpdp_invoice_id: 4242 }), { ...EXEMPLAIRE, factures: { lignes: [], complete: false, motif: 'refusée' } })
    })
    expect(screen.getByText('La validation d’une pièce de vente attend les factures émises du dossier, lues en entier.')).toBeTruthy()
    expect(valider().disabled).toBe(true)
  })

  it('basculé, une vente validée avant, sous la même marque : G3 ne la rejuge pas (EC3-Q1), rien n’attend', async () => {
    basculer(true)
    faux.retenir = true
    await act(async () => { monter(piece({ statut: 'validee' }), EXEMPLAIRE) })
    expect(valider().disabled).toBe(false)
    expect(screen.queryByText(/La validation d’une pièce de vente attend/)).toBeNull()
  })

  it('basculé, un achat validé qui devient une vente : G3 juge ce passage', async () => {
    basculer(true)
    await act(async () => { monter(piece({ type_piece: 'achat', statut: 'validee' }), EXEMPLAIRE) })
    expect(valider().disabled).toBe(false)
    await choisirLeType('vente')
    await waitFor(() => expect(screen.getByText(refusG3('ni_designee_ni_declaree', 'vente-0007.pdf'))).toBeTruthy())
    expect(valider().disabled).toBe(true)
  })

  it('ce que la base dit du dossier, illisible : la validation attend, et — sans section — la fiche offre de relire', async () => {
    faux.refus = { dossiers: 'accès refusé' }
    await act(async () => { monter(piece({ type_piece: 'achat' }), EXEMPLAIRE) })
    await choisirLeType('vente')
    await waitFor(() => expect(screen.getByText(/La validation d’une pièce de vente attend : ce que la base dit de ce dossier n’a pas pu être lu en entier \(le dossier : accès refusé\)/)).toBeTruthy())
    expect(valider().disabled).toBe(true)
    faux.refus = {}
    faux.demandes = []
    await act(async () => { screen.getByRole('button', { name: 'Relire' }).click() })
    expect(faux.demandes).toContain('dossiers')
    await waitFor(() => expect(valider().disabled).toBe(false))
  })

  it('une pièce neuve de vente, dans un dossier basculé : elle naît à valider (G3, point 1) — « Valider » retenu, le brouillon part', async () => {
    basculer(true)
    await act(async () => { monter(null, EXEMPLAIRE) })
    await choisirLeType('vente')
    await waitFor(() => expect(screen.getByText(refusG3('nee_validee'))).toBeTruthy())
    expect(valider().disabled).toBe(true)
    expect(brouillon().disabled).toBe(false)
  })

  it('une pièce neuve d’achat, ou dans un dossier qui n’a pas basculé : rien ne retient la validation', async () => {
    basculer(true)
    await act(async () => { monter(null, EXEMPLAIRE) })
    expect(valider().disabled).toBe(false)
    cleanup()
    basculer(false)
    await act(async () => { monter(null, EXEMPLAIRE) })
    await choisirLeType('vente')
    await waitFor(() => expect(faux.demandes).toContain('dossiers'))
    await waitFor(() => expect(valider().disabled).toBe(false))
  })
})

describe('FichePiece — une pièce désignée ou déclarée reste une pièce de vente', () => {
  it('changer sa nature le dit avant l’enregistrement, sous les mots de la garde, sans toucher au reste de la saisie', async () => {
    await act(async () => { monter(piece({ facture_id: 'f1' }), EXEMPLAIRE) })
    fireEvent.change(document.querySelector('#tiers')!, { target: { value: 'AUTRE CLIENT' } })
    await choisirLeType('achat')
    expect(screen.getByText("Cette pièce est l'exemplaire de la facture F2026-0007 : elle reste une pièce de vente — défaire d'abord la désignation.")).toBeTruthy()
    // Le reste du formulaire est tel que saisi : ni le tiers ni le type choisi ne sont remis en place.
    expect((document.querySelector('#tiers') as HTMLInputElement).value).toBe('AUTRE CLIENT')
    expect((document.querySelector('#type') as HTMLSelectElement).value).toBe('achat')
    expect(valider().disabled).toBe(true)
    expect(brouillon().disabled).toBe(true)
  })

  it('déclarée : la même chose, sous les mots de la garde étendue', async () => {
    await act(async () => { monter(piece({ vente_hors_des_factures: true }), EXEMPLAIRE) })
    await choisirLeType('note_frais')
    expect(screen.getByText("Cette pièce est déclarée vente hors des factures de l'application : elle reste une pièce de vente — retirer d'abord la déclaration.")).toBeTruthy()
    expect(valider().disabled).toBe(true)
    expect(brouillon().disabled).toBe(true)
    await act(async () => { fireEvent.submit(document.querySelector('form')!) })
    await act(async () => { brouillon().click() })
    expect(faux.majPieces).toEqual([])
  })

  it('rien ne part tant que le refus tient, même par la touche Entrée du formulaire', async () => {
    await act(async () => { monter(piece({ facture_id: 'f1' }), EXEMPLAIRE) })
    await choisirLeType('note_frais')
    await act(async () => { fireEvent.submit(document.querySelector('form')!) })
    expect(faux.majPieces).toEqual([])
  })

  it('revenir à « Vente » retire le refus, et l’enregistrement part', async () => {
    await act(async () => { monter(piece({ facture_id: 'f1' }), EXEMPLAIRE) })
    await choisirLeType('autre')
    expect(screen.getByText(/elle reste une pièce de vente/)).toBeTruthy()
    await choisirLeType('vente')
    expect(screen.queryByText(/elle reste une pièce de vente/)).toBeNull()
    await act(async () => { fireEvent.submit(document.querySelector('form')!) })
    expect(faux.majPieces).toHaveLength(1)
  })

  it('le refus tient aussi quand l’appelant n’a rien lu : la marque se sait de la pièce, le numéro n’est pas inventé', async () => {
    await act(async () => { monter(piece({ facture_id: 'f1' })) })
    await choisirLeType('achat')
    expect(screen.getByText(/dont le numéro n’a pas pu être lu : elle reste une pièce de vente/)).toBeTruthy()
    expect(valider().disabled).toBe(true)
    cleanup()
    await act(async () => { monter(piece({ vente_hors_des_factures: true })) })
    await choisirLeType('achat')
    expect(screen.getByText(/retirer d'abord la déclaration/)).toBeTruthy()
  })

  it('une pièce que rien ne marque change de nature librement', async () => {
    await act(async () => { monter(piece(), EXEMPLAIRE) })
    await choisirLeType('achat')
    expect(screen.queryByText(/elle reste une pièce de vente/)).toBeNull()
    expect(valider().disabled).toBe(false)
  })
})
