import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContexteDossier } from '../../test/exercicesValides'
import BanqueTab from './BanqueTab'
import { EmplacementPanneauDroit, FournisseurPanneauDroit } from '../../components/PanneauDroit'
import type { JustificatifPropose, LigneBancaire, Piece, PrecisionMouvement } from '../../lib/types'
import type { ModeleComptable } from '../../lib/engagement'
import { PLAN_PAR_DEFAUT } from '../../lib/planComptable'

// « ÉCARTER CETTE PROPOSITION » et « SUPPRIMER CE MESSAGE » (espace client, étape P9b2), dans la fiche d'un mouvement. Ce que
// ces cas gardent et qu'aucun calcul pur ne voit : le bouton sur la pièce que le CLIENT a proposée (pas sur une pièce du
// cabinet, pas quand le mouvement la retient) ; la confirmation, qui dit ce que le client verra et nomme ce qu'on supprime ;
// une confirmation refusée n'écrit rien ; `retirer_proposition` SEULE pour l'écart, la suppression directe filtrée sur
// l'identifiant ET le dossier et RELUE (zéro ligne n'est pas une erreur) ; le verrou des écritures de l'écran (deux clics
// dans le même `act`, puis trois) relâché après la relecture ; l'erreur de la base dite ; et rien d'offert sur des envois lus
// en partie ou pas encore revenus.

const faux = vi.hoisted(() => ({
  lignes: [] as LigneBancaire[],
  pieces: [] as Piece[],
  propositions: [] as JustificatifPropose[],
  precisions: [] as PrecisionMouvement[],
  memberships: [] as { id: string; dossier_id: string; user_id: string; droit_banque: boolean; created_at: string }[],
  muet: {} as Record<string, number>,
  retenir: {} as Record<string, boolean>,
  liberer: [] as (() => void)[],
  rpcs: [] as { nom: string; args: Record<string, unknown> }[],
  retenirRpc: false,
  resoudreRpc: null as null | (() => void),
  erreurRpc: null as string | null,
  // Les suppressions directes : ce que la requête demandait, et ce que la base y répond.
  suppressions: [] as { table: string; filtres: [string, unknown][]; colonnesRelues: string | null }[],
  retenirSuppression: false,
  resoudreSuppression: null as null | (() => void),
  erreurSuppression: null as string | null,
  // La policy écarte la ligne SANS LEVER : zéro ligne supprimée, aucune erreur.
  ligneEcartee: false,
}))

vi.mock('../../lib/pdfText', () => ({ extractPdfLignes: async () => [] }))
vi.mock('../../lib/depot', () => ({ ouvrirJustificatif: async () => {} }))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatIn } = await import('../../test/filtresPostgrest')
  const servies = (table: string): Record<string, unknown>[] | null => {
    switch (table) {
      case 'lignes_bancaires': return faux.lignes as unknown as Record<string, unknown>[]
      case 'pieces': return faux.pieces as unknown as Record<string, unknown>[]
      case 'justificatifs_proposes': return faux.propositions as unknown as Record<string, unknown>[]
      case 'precisions_mouvements': return faux.precisions as unknown as Record<string, unknown>[]
      case 'memberships': return faux.memberships
      default: return null
    }
  }
  function chaine(table: string) {
    let operation = 'select'
    let unique = false
    let colonnesRelues: string | null = null
    let valeurMaj: Record<string, unknown> = {}
    const appels: [string, unknown[]][] = []
    let debut = 0
    let fin = Number.MAX_SAFE_INTEGER
    const c: Record<string, unknown> = {}
    const soi = () => c
    Object.assign(c, {
      order: soi, neq: soi, gte: soi, lte: soi, lt: soi, gt: soi, is: soi, not: soi, or: soi, limit: soi,
      select: (colonnes?: string) => { if (operation === 'delete') colonnesRelues = colonnes ?? '*'; return c },
      eq: (colonne: string, valeur: unknown) => { appels.push(['eq', [colonne, valeur]]); return c },
      in: (colonne: string, valeurs: unknown[]) => { appels.push(['in', [colonne, valeurs]]); return c },
      range: (d: number, f: number) => { debut = d; fin = f; return c },
      maybeSingle: () => { unique = true; return c },
      single: () => { unique = true; return c },
      update: (valeur: Record<string, unknown>) => { operation = 'update'; valeurMaj = valeur; return c },
      insert: () => { operation = 'insert'; return c },
      upsert: () => { operation = 'upsert'; return c },
      delete: () => { operation = 'delete'; return c },
      then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => {
        if (operation === 'delete') {
          const filtres = appels.map(([, [colonne, valeur]]) => [colonne as string, valeur] as [string, unknown])
          faux.suppressions.push({ table, filtres, colonnesRelues })
          const repondre = () => {
            if (faux.erreurSuppression) return { data: null, error: { message: faux.erreurSuppression } }
            if (faux.ligneEcartee) return { data: null, error: null }
            const cibles = filtrer(faux.precisions as unknown as Record<string, unknown>[], appels.map(([, [colonne, valeur]]) => predicatEq(colonne as string, valeur)))
            faux.precisions = faux.precisions.filter((p) => !cibles.includes(p as unknown as Record<string, unknown>))
            return { data: cibles.length > 0 ? { id: (cibles[0] as { id: string }).id } : null, error: null }
          }
          if (faux.retenirSuppression) {
            return new Promise((resoudre) => { faux.resoudreSuppression = () => resoudre(repondre()) }).then(suite, echec)
          }
          return Promise.resolve(repondre()).then(suite, echec)
        }
        if (table === 'lignes_bancaires' && operation === 'update') {
          const id = appels.find(([, [colonne]]) => colonne === 'id')?.[1][1]
          faux.lignes = faux.lignes.map((l) => (l.id === id ? { ...l, ...valeurMaj } as LigneBancaire : l))
          return Promise.resolve({ data: null, error: null }).then(suite, echec)
        }
        if (operation !== 'select') return Promise.resolve({ data: null, error: null }).then(suite, echec)
        if (unique) return Promise.resolve({ data: null, error: null }).then(suite, echec)
        const source = servies(table)
        if (source === null) return Promise.resolve({ data: [], error: null, count: 0 }).then(suite, echec)
        const predicats = appels.map(([nom, [colonne, valeur]]) =>
          nom === 'eq' ? predicatEq(colonne as string, valeur) : predicatIn(colonne as string, valeur as unknown[]))
        const toutes = filtrer(source, predicats)
        const muet = faux.muet[table]
        const rendu = toutes.slice(debut, Math.min(fin + 1, muet ?? Number.MAX_SAFE_INTEGER))
        const reponse = { data: rendu, error: null, count: toutes.length }
        if (faux.retenir[table]) {
          faux.retenir[table] = false
          return new Promise((resoudre) => { faux.liberer.push(() => resoudre(reponse)) }).then(suite, echec)
        }
        return Promise.resolve(reponse).then(suite, echec)
      },
    })
    return c
  }
  // La seule fonction SQL de ces cas : `retirer_proposition`, que le faux serveur applique comme la vraie (la proposition
  // reste, datée) pour que la relecture la montre retirée.
  function rpc(nom: string, args: Record<string, unknown>) {
    faux.rpcs.push({ nom, args })
    if (nom !== 'retirer_proposition') throw new Error(`Fonction non attendue dans ce test : ${nom}`)
    const repondre = () => {
      if (faux.erreurRpc) return { data: null, error: { message: faux.erreurRpc } }
      faux.propositions = faux.propositions.map((p) =>
        p.id === args.p_proposition_id ? { ...p, retire_le: '2026-06-08T10:00:00Z', retire_par: 'cabinet-1' } : p)
      return { data: faux.propositions.find((p) => p.id === args.p_proposition_id), error: null }
    }
    if (faux.retenirRpc) return new Promise((resoudre) => { faux.resoudreRpc = () => resoudre(repondre()) })
    return Promise.resolve(repondre())
  }
  const functions = {
    invoke: async (nom: string) => {
      if (nom === 'banque-connexion') return { data: { configuree: false, connexion: null }, error: null }
      throw new Error(`Appel de fonction non attendu : ${nom}`)
    },
  }
  return { supabase: { from: (table: string) => chaine(table), rpc, functions } }
})

function ligneDeTest(o: Partial<LigneBancaire> = {}): LigneBancaire {
  return {
    id: 'ligne-1', dossier_id: 'dossier-de-test', date: '2026-06-02', montant: -100, libelle: 'PRLV SEPA FICTIF', libelle_brut: null,
    statut: 'non_rapprochee', piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
    source_fichier: null, emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false,
    reglement_groupe: false, compte_bilan: null, declaration_tva_id: null, id_externe: null, created_at: '2026-06-02T09:00:00Z', encaissements_de_factures: false, ...o,
  }
}

function pieceDeTest(o: Partial<Piece> = {}): Piece {
  return {
    id: 'piece-p', dossier_id: 'dossier-de-test', uploaded_by: 'client-1', source: 'upload', storage_path: 'dossier/proposee.pdf',
    nom_fichier: 'proposee.pdf', storage_hash: null, date_piece: '2026-06-01', tiers: 'Atelier fictif', montant_ht: null, montant_tva: null,
    montant_ttc: 100, devise: 'EUR', montant_devise: null, taux_change: null, conversion_source: null, categorie_id: null,
    sous_dossier_id: null, type_piece: 'achat', statut: 'a_valider', notes: null, confiance: null, superpdp_invoice_id: null,
    flux_hote: null, flux_id: null, lisible_path: null, identite_numero: null, identite_siren_vendeur: null, identite_date: null,
    identite_nature: null, facture_id: null, created_at: '2026-06-01T09:00:00Z', updated_at: '2026-06-01T09:00:00Z', ...o,
  }
}

function propositionDeTest(o: Partial<JustificatifPropose> = {}): JustificatifPropose {
  return {
    id: 'prop-1', dossier_id: 'dossier-de-test', ligne_bancaire_id: 'ligne-1', piece_id: 'piece-p', auteur_id: 'client-1',
    origine: 'client', created_at: '2026-06-05T10:00:00Z', retire_le: null, retire_par: null, ...o,
  }
}

function precisionDeTest(o: Partial<PrecisionMouvement> = {}): PrecisionMouvement {
  return {
    id: 'q-a', dossier_id: 'dossier-de-test', ligne_bancaire_id: 'ligne-1', auteur_id: 'cabinet-1', origine: 'cabinet',
    texte: 'À quoi correspond ce prélèvement ?', created_at: '2026-06-06T10:00:00Z', ...o,
  }
}

const ACCES_CLIENT = { id: 'm-1', dossier_id: 'dossier-de-test', user_id: 'client-1', droit_banque: true, created_at: '2026-01-01T00:00:00Z' }

beforeEach(() => {
  faux.lignes = [ligneDeTest()]
  faux.pieces = [pieceDeTest()]
  faux.propositions = [propositionDeTest()]
  faux.precisions = []
  faux.memberships = [ACCES_CLIENT]
  faux.muet = {}
  faux.retenir = {}
  faux.liberer = []
  faux.rpcs = []
  faux.retenirRpc = false
  faux.resoudreRpc = null
  faux.erreurRpc = null
  faux.suppressions = []
  faux.retenirSuppression = false
  faux.resoudreSuppression = null
  faux.erreurSuppression = null
  faux.ligneEcartee = false
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '455000', plan: PLAN_PAR_DEFAUT }

function rendre() {
  return render(
    <FournisseurPanneauDroit>
      <ContexteDossier annee="toutes" valides={[]}>
        <BanqueTab dossierId="dossier-de-test" modele={TRESORERIE} assujettiTva={false} ventesParLesFactures={false} />
      </ContexteDossier>
      <EmplacementPanneauDroit />
    </FournisseurPanneauDroit>,
  )
}

const volet = () => screen.getByRole('complementary', { name: 'Panneau contextuel' })
const texteDe = (e: Element | null) => (e?.textContent ?? '').replace(/\s/g, ' ')

async function ouvrir(libelle = 'PRLV SEPA FICTIF') {
  const cellules = await screen.findAllByText(libelle)
  const cellule = cellules.find((e) => e.closest('tr')?.classList.contains('clickable'))
  if (!cellule) throw new Error(`Aucune ligne du relevé ne porte « ${libelle} »`)
  await act(async () => { cellule.click() })
}

const BOUTON_ECARTER = 'Écarter cette proposition'
const BOUTON_SUPPRIMER = 'Supprimer ce message'

describe('« Écarter cette proposition » : offert sur la pièce proposée par le client', () => {
  it('sur sa carte, avec « Associer » ; pas sur une pièce proposée par le cabinet, ni quand le mouvement la retient', async () => {
    faux.propositions = [propositionDeTest(), propositionDeTest({ id: 'prop-c', piece_id: 'piece-c', origine: 'cabinet', auteur_id: 'cabinet-1' })]
    faux.pieces = [pieceDeTest(), pieceDeTest({ id: 'piece-c', nom_fichier: 'cabinet.pdf', storage_path: 'dossier/cabinet.pdf', tiers: 'Cabinet fictif' })]
    rendre()
    await ouvrir()
    const cartes = Array.from(volet().querySelectorAll('.carte-proposee')) as HTMLElement[]
    expect(cartes).toHaveLength(2)
    const duClient = cartes.find((c) => c.textContent?.includes('Atelier fictif')) as HTMLElement
    const duCabinet = cartes.find((c) => c.textContent?.includes('Cabinet fictif')) as HTMLElement
    expect(within(duClient).getByRole('button', { name: BOUTON_ECARTER })).toBeTruthy()
    expect(within(duClient).getByRole('button', { name: 'Associer cette pièce' })).toBeTruthy()
    expect(within(duCabinet).queryByRole('button', { name: BOUTON_ECARTER })).toBeNull()
  })

  it('une fois le mouvement rapproché de cette pièce, elle est retenue : rien à écarter', async () => {
    rendre()
    await ouvrir()
    expect(within(volet()).getByRole('button', { name: BOUTON_ECARTER })).toBeTruthy()
    await act(async () => { within(volet()).getByRole('button', { name: 'Associer cette pièce' }).click() })
    await waitFor(() => expect(within(volet()).getByText(/^Retenue : ce mouvement est rapproché de cette pièce/)).toBeTruthy())
    expect(within(volet()).queryByRole('button', { name: BOUTON_ECARTER })).toBeNull()
  })

  it('la confirmation nomme la pièce, dit ce que le client verra ensuite, que la pièce reste, et où lui écrire', async () => {
    const confirme = vi.spyOn(window, 'confirm').mockReturnValue(false)
    rendre()
    await ouvrir()
    await act(async () => { within(volet()).getByRole('button', { name: BOUTON_ECARTER }).click() })
    expect(confirme).toHaveBeenCalledTimes(1)
    const texte = confirme.mock.calls[0][0] as string
    expect(texte).toContain('Écarter la pièce « Atelier fictif », proposée par le client, pour ce mouvement ?')
    expect(texte).toContain('le client verra ensuite ce mouvement « Sans justificatif » (il le voit aujourd’hui « Justificatif envoyé »)')
    expect(texte).toContain('La pièce reste dans ses pièces')
    expect(texte).toContain('écris-lui dans le fil')
  })

  it('une confirmation refusée n’écrit rien', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    rendre()
    await ouvrir()
    await act(async () => { within(volet()).getByRole('button', { name: BOUTON_ECARTER }).click() })
    expect(faux.rpcs).toEqual([])
    expect(within(volet()).getByText('Pièce proposée par le client', { selector: 'h3' })).toBeTruthy()
  })

  it('confirmée : retirer_proposition seule, puis la relecture montre la proposition retirée et le mouvement « Sans justificatif »', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    rendre()
    await ouvrir()
    await act(async () => { within(volet()).getByRole('button', { name: BOUTON_ECARTER }).click() })
    expect(faux.rpcs).toEqual([{ nom: 'retirer_proposition', args: { p_dossier_id: 'dossier-de-test', p_proposition_id: 'prop-1' } }])
    await waitFor(() => expect(within(volet()).queryByRole('button', { name: BOUTON_ECARTER })).toBeNull())
    expect(within(volet()).queryByRole('heading', { name: 'Pièce proposée par le client' })).toBeNull()
    const retiree = within(volet()).getByText(/^Proposition retirée :/)
    expect(texteDe(retiree)).toBe('Proposition retirée : Atelier fictif — Proposée par le client le 05/06/2026, retirée le 08/06/2026 par le cabinet.')
    expect(texteDe(within(volet()).getByText(/Dans « Ma banque »/))).toBe('Dans « Ma banque », le client voit ce mouvement « Sans justificatif ».')
    // La liste ne marque plus le mouvement, et le filtre ne le retient plus.
    expect(screen.queryByText('Pièce proposée par le client', { selector: '.badge' })).toBeNull()
  })

  it('deux clics dans le même act : un appel ; puis trois : toujours un ; le bouton se grise ; le verrou tient jusqu’à la relecture', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    faux.retenirRpc = true
    rendre()
    await ouvrir()
    const bouton = within(volet()).getByRole('button', { name: BOUTON_ECARTER }) as HTMLButtonElement
    await act(async () => { bouton.click(); bouton.click() })
    expect(faux.rpcs).toHaveLength(1)
    expect(bouton.disabled).toBe(true)
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(faux.rpcs).toHaveLength(1)

    // La relecture retenue : le verrou tient encore, la fiche dit « en cours de lecture » et n'offre plus rien.
    faux.retenir = { justificatifs_proposes: true }
    await act(async () => { faux.resoudreRpc?.() })
    await waitFor(() => expect(within(volet()).getByText(/^Les pièces proposées par le client et le fil sont en cours de lecture/)).toBeTruthy())
    expect(within(volet()).queryByRole('button', { name: BOUTON_ECARTER })).toBeNull()
    expect(within(volet()).queryByRole('button', { name: BOUTON_SUPPRIMER })).toBeNull()
    await act(async () => { for (const f of faux.liberer.splice(0)) f() })
    await waitFor(() => expect(within(volet()).getByText(/^Proposition retirée :/)).toBeTruthy())
    expect(faux.rpcs).toHaveLength(1)
  })

  it('refusée par la base : dit avec les mots de la base, et la fiche est relue (la proposition déjà retirée disparaît)', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const alerte = vi.spyOn(window, 'alert').mockImplementation(() => {})
    faux.erreurRpc = 'Cette proposition est déjà retirée, depuis le 07/06/2026.'
    rendre()
    await ouvrir()
    // Le client l'a retirée entre-temps : la base la rend retirée à la relecture, malgré le refus.
    faux.propositions = [propositionDeTest({ retire_le: '2026-06-07T10:00:00Z', retire_par: 'client-1' })]
    await act(async () => { within(volet()).getByRole('button', { name: BOUTON_ECARTER }).click() })
    await waitFor(() => expect(alerte).toHaveBeenCalledWith('La proposition n’a pas été écartée : Cette proposition est déjà retirée, depuis le 07/06/2026.'))
    await waitFor(() => expect(within(volet()).queryByRole('button', { name: BOUTON_ECARTER })).toBeNull())
    expect(within(volet()).getByText(/^Proposition retirée :/)).toBeTruthy()
  })

  it('des propositions lues en partie, ou pas encore revenues : aucun bouton', async () => {
    faux.propositions = [propositionDeTest(), propositionDeTest({ id: 'prop-2', piece_id: 'piece-x' })]
    faux.muet = { justificatifs_proposes: 1 }
    rendre()
    await ouvrir()
    expect(within(volet()).queryByRole('button', { name: BOUTON_ECARTER })).toBeNull()
    expect(within(volet()).queryByRole('button', { name: BOUTON_SUPPRIMER })).toBeNull()
  })
})

describe('« Supprimer ce message » : le fil, côté cabinet', () => {
  beforeEach(() => {
    faux.propositions = []
    faux.precisions = [
      precisionDeTest(),
      precisionDeTest({ id: 'q-b', origine: 'client', auteur_id: 'client-1', texte: 'Le logiciel du cabinet médical.', created_at: '2026-06-07T10:00:00Z' }),
    ]
  })

  const boutons = () => within(within(volet()).getByRole('region', { name: 'Échanges avec le client' })).getAllByRole('button', { name: BOUTON_SUPPRIMER })

  it('un bouton par message du fil, du cabinet comme du client', async () => {
    rendre()
    await ouvrir()
    expect(boutons()).toHaveLength(2)
  })

  it('la confirmation NOMME le message, dit que le client ne le verra plus et que c’est définitif', async () => {
    const confirme = vi.spyOn(window, 'confirm').mockReturnValue(false)
    rendre()
    await ouvrir()
    await act(async () => { boutons()[1].click() })
    const texte = confirme.mock.calls[0][0] as string
    expect(texte).toContain('Supprimer ce message du fil ?')
    expect(texte).toContain('Le client, le 07/06/2026 : « Le logiciel du cabinet médical. »')
    expect(texte).toContain('Le client ne le verra plus.')
    expect(texte).toContain('La suppression est définitive')
  })

  it('une confirmation refusée n’écrit rien', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    rendre()
    await ouvrir()
    await act(async () => { boutons()[0].click() })
    expect(faux.suppressions).toEqual([])
    expect(boutons()).toHaveLength(2)
  })

  it('confirmée : suppression filtrée sur l’identifiant ET le dossier, ligne supprimée RELUE, et le fil relu sans lui', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    rendre()
    await ouvrir()
    await act(async () => { boutons()[0].click() })
    expect(faux.suppressions).toEqual([{
      table: 'precisions_mouvements', filtres: [['id', 'q-a'], ['dossier_id', 'dossier-de-test']], colonnesRelues: 'id',
    }])
    await waitFor(() => expect(boutons()).toHaveLength(1))
    const fil = within(volet()).getByRole('region', { name: 'Échanges avec le client' })
    expect(within(fil).queryByText('À quoi correspond ce prélèvement ?')).toBeNull()
    expect(within(fil).getByText('Le logiciel du cabinet médical.')).toBeTruthy()
    expect(faux.rpcs).toEqual([])
  })

  it('deux clics dans le même act : une suppression ; puis trois : une ; grisé pendant l’écriture, verrou tenu jusqu’à la relecture', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    faux.retenirSuppression = true
    rendre()
    await ouvrir()
    const bouton = boutons()[0] as HTMLButtonElement
    await act(async () => { bouton.click(); bouton.click() })
    expect(faux.suppressions).toHaveLength(1)
    expect(boutons().every((b) => (b as HTMLButtonElement).disabled)).toBe(true)
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(faux.suppressions).toHaveLength(1)

    faux.retenir = { precisions_mouvements: true }
    await act(async () => { faux.resoudreSuppression?.() })
    await waitFor(() => expect(within(volet()).getByText(/Le fil de ce mouvement est en cours de lecture/)).toBeTruthy())
    expect(within(volet()).queryByRole('button', { name: BOUTON_SUPPRIMER })).toBeNull()
    await act(async () => { for (const f of faux.liberer.splice(0)) f() })
    await waitFor(() => expect(boutons()).toHaveLength(1))
    expect(faux.suppressions).toHaveLength(1)
  })

  it('zéro ligne supprimée (la policy écarte sans lever) : « rien n’a été supprimé », dit, et le fil relu', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const alerte = vi.spyOn(window, 'alert').mockImplementation(() => {})
    faux.ligneEcartee = true
    rendre()
    await ouvrir()
    await act(async () => { boutons()[0].click() })
    await waitFor(() => expect(alerte).toHaveBeenCalledWith('Rien n’a été supprimé : le message n’existe plus, ou n’est pas un message de ce dossier.'))
    await waitFor(() => expect(boutons()).toHaveLength(2))
  })

  it('une erreur de la base : dite avec ses mots, rien ne disparaît', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const alerte = vi.spyOn(window, 'alert').mockImplementation(() => {})
    faux.erreurSuppression = 'permission denied for table precisions_mouvements'
    rendre()
    await ouvrir()
    await act(async () => { boutons()[0].click() })
    await waitFor(() => expect(alerte).toHaveBeenCalledWith('Le message n’a pas été supprimé : permission denied for table precisions_mouvements'))
    await waitFor(() => expect(boutons()).toHaveLength(2))
    expect(alerte).toHaveBeenCalledTimes(1)
  })

  it('un fil lu en partie, ou pas encore revenu : aucun bouton', async () => {
    faux.precisions = [precisionDeTest(), precisionDeTest({ id: 'q-b' })]
    faux.muet = { precisions_mouvements: 1 }
    rendre()
    await ouvrir()
    expect(within(volet()).queryByRole('button', { name: BOUTON_SUPPRIMER })).toBeNull()
  })
})
