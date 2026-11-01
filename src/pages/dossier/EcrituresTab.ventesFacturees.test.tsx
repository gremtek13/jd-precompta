import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContexteDossier } from '../../test/exercicesValides'
import type { Predicat } from '../../test/filtresPostgrest'
import type { ModeleComptable } from '../../lib/engagement'
import { PLAN_PAR_DEFAUT } from '../../lib/planComptable'
import { formatMoney } from '../../lib/format'
import EcrituresTab from './EcrituresTab'
import { CHAMPS_BNC_EXPORTES } from '../../lib/champsBncDuFec'

// LES VENTES FACTURÉES DANS L'ONGLET ÉCRITURES (ligne 28.6, chantier EC-Q3, étape VF4c1). L'état de chaque source est
// éprouvé à part (lib/ecrituresVentesFactureesEcran.test.ts) ; ce qui se joue ici est le CÂBLAGE : la section ne paraît
// que pour un dossier qui a basculé ; chaque geste passe sa fonction SQL seule, sur un clic confirmé qui nomme la source ;
// deux clics du même `act` n'écrivent qu'une fois, et le verrou ne se relâche qu'après la relecture ; une lecture partielle
// ou pas encore revenue n'offre aucun geste ; le refus du choix d'un compte se dit avant le clic, sur la saisie telle
// qu'elle part ; et les contrôles d'hier de l'onglet ne prennent pas les lignes d'une vente facturée pour des ruptures,
// des écritures sans objet ou à régénérer. Le faux client APPLIQUE les filtres, et la fonction d'écriture remplace les
// lignes proposées de sa source comme la vraie. Données FICTIVES.
const faux = vi.hoisted(() => ({
  parTable: {} as Record<string, Record<string, unknown>[]>,
  muet: {} as Record<string, number>,
  // Les lectures attendent cette promesse tant qu'elle est posée : la fenêtre d'une lecture pas encore revenue.
  attente: null as Promise<void> | null,
  relacher: null as (() => void) | null,
  // Après un appel de fonction, les lectures suivantes attendent : la fenêtre de la relecture.
  retenirApresRpc: false,
  rpcs: [] as { nom: string; args: Record<string, unknown> }[],
  erreurRpc: null as string | null,
  tables: [] as string[],
  // Ce que l'écran insère en direct — les écritures des pièces (étape VF5h : celle de l'exemplaire qu'un virement mixte paie).
  inserts: [] as { table: string; lignes: Record<string, unknown>[] }[],
}))

vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ isSuperAdmin: true }) }))

// Étape VF4c2 : `genererFec` et la piste restent les VRAIS, c'est leur contenu qu'on lit ; seul le téléchargement est
// remplacé — jsdom n'a pas d'URL d'objet.
const telecharge = vi.hoisted(() => ({ fichiers: [] as { nom: string; contenu: string }[] }))
vi.mock('../../lib/fec', async (vrai) => ({
  ...(await vrai<typeof import('../../lib/fec')>()),
  telechargerTexte: (nom: string, contenu: string) => { telecharge.fichiers.push({ nom, contenu }) },
}))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatNot, predicatOr } = await import('../../test/filtresPostgrest')
  function chaine(table: string) {
    faux.tables.push(table)
    const predicats: Predicat[] = []
    let colonnes: string[] | null = null
    let debut = 0
    let fin = Number.MAX_SAFE_INTEGER
    const c: Record<string, unknown> = {}
    const reponse = () => {
      const toutes = filtrer(faux.parTable[table] ?? [], predicats)
      const borne = faux.muet[table] == null ? toutes.length : Math.min(toutes.length, faux.muet[table])
      const rendu = toutes.slice(debut, Math.min(fin + 1, borne)).map((l) => (colonnes == null ? l : Object.fromEntries(colonnes.map((k) => [k, l[k]]))))
      return { data: rendu, error: null, count: toutes.length }
    }
    Object.assign(c, {
      select: (liste: string) => {
        if (liste !== '*') colonnes = liste.replace(/[a-z_]+!inner\([^)]*\)/g, '').split(',').map((x) => x.trim()).filter(Boolean)
        return c
      },
      order: () => c,
      eq: (colonne: string, valeur: unknown) => {
        if (colonne.startsWith('factures_emises.')) {
          const champ = colonne.slice('factures_emises.'.length)
          predicats.push((l) => (faux.parTable.factures_emises ?? []).some((f) => f.id === l.facture_id && f[champ] === valeur))
        } else predicats.push(predicatEq(colonne, valeur))
        return c
      },
      or: (expression: string) => { predicats.push(predicatOr(expression)); return c },
      not: (colonne: string, operateur: string, valeur: unknown) => { predicats.push(predicatNot(colonne, operateur, valeur)); return c },
      range: (d: number, f: number) => { debut = d; fin = f; return c },
      then: (suite: (r: unknown) => unknown) => (faux.attente ?? Promise.resolve()).then(reponse).then(suite),
      insert: (lignes: Record<string, unknown>[]) => {
        faux.inserts.push({ table, lignes })
        faux.parTable[table] = [...(faux.parTable[table] ?? []), ...lignes.map((l, i) => ({
          id: `ins-${faux.inserts.length}-${i}`, created_at: '2026-10-23T09:00:00Z', immobilisation_id: null, vehicule_id: null,
          declaration_tva_id: null, cotisation_id: null, facture_id: null, encaissement_id: null, ligne_bancaire_id: null, ...l,
        }))]
        return Promise.resolve({ data: null, error: null })
      },
    })
    return c
  }
  // Les lignes proposées d'une source (lib/ecritureVenteFacturee.ts, `lignesDeLaSource`), comme la vraie fonction les voit.
  const deLaSource = (l: Record<string, unknown>, source: string, id: unknown) =>
    source === 'encaissement' ? l.encaissement_id === id
      : source === 'mouvement' ? l.ligne_bancaire_id === id && l.facture_id == null && l.encaissement_id == null && l.piece_id == null
        : l.facture_id === id
  return {
    supabase: {
      from: (table: string) => chaine(table),
      rpc: (nom: string, args: Record<string, unknown>) => {
        faux.rpcs.push({ nom, args })
        if (faux.erreurRpc) return Promise.resolve({ data: null, error: { message: faux.erreurRpc } })
        const brouillon = faux.parTable.ecritures_brouillon ?? []
        if (nom === 'ecrire_vente_facturee' || nom === 'retirer_ecriture_vente_facturee') {
          const { p_source: source, p_source_id: id } = args
          const gardees = brouillon.filter((l) => !(l.statut === 'proposee' && deLaSource(l, String(source), id)))
          const ecrites = nom === 'retirer_ecriture_vente_facturee' ? [] : (args.p_lignes as Record<string, unknown>[]).map((l, i) => ({
            id: `vf-${faux.rpcs.length}-${i}`, dossier_id: args.p_dossier_id, piece_id: null, ligne_bancaire_id: l.ligne_bancaire_id,
            date: l.date, compte: l.compte, libelle: l.libelle, montant: l.montant, sens: l.sens, statut: 'proposee',
            created_at: '2026-10-20T09:00:00Z', immobilisation_id: null, vehicule_id: null, declaration_tva_id: null, cotisation_id: null,
            facture_id: source === 'facture' || source === 'avoir' ? id : null, encaissement_id: source === 'encaissement' ? id : null,
          }))
          faux.parTable.ecritures_brouillon = [...gardees, ...ecrites]
        }
        if (nom === 'choisir_compte_contrepartie') {
          faux.parTable.encaissements_factures = (faux.parTable.encaissements_factures ?? [])
            .map((e) => (e.id === args.p_encaissement_id ? { ...e, compte_contrepartie: args.p_compte } : e))
        }
        if (faux.retenirApresRpc) faux.attente = new Promise<void>((r) => { faux.relacher = r })
        return Promise.resolve({ data: null, error: null })
      },
    },
  }
})

const D = 'd1'
const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '455000', plan: PLAN_PAR_DEFAUT }
const ENGAGEMENT: ModeleComptable = { mode: 'engagement', compteNotesDeFrais: '455000', plan: PLAN_PAR_DEFAUT }

const facture = (o: Record<string, unknown> = {}) => ({
  id: 'f1', dossier_id: D, statut: 'validee', type: 'facture', numero: 'F2025-0001', date_emission: '2025-11-10',
  tiers_nom: 'Client fictif', facture_origine_id: null, source_de_la_vente: true, nature_operation: 'services',
  option_debits: false, date_prestation: null, montant_ttc: 120, ...o,
})
const ligneFacture = { id: 'l1', facture_id: 'f1', ordre: 1, designation: 'Prestation fictive', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20 }
const encaissement = (o: Record<string, unknown> = {}) => ({
  id: 'e1', dossier_id: D, facture_id: 'f1', date_encaissement: '2025-11-20', montant: 120, moyen: 'virement',
  ligne_bancaire_id: 'm1', annule_id: null, cree_le: '2025-11-20T10:00:00Z', retire_le: null, compte_contrepartie: null, ...o,
})
const part = (o: Record<string, unknown> = {}) => ({ encaissement_id: 'e1', dossier_id: D, taux: 20, montant: 120, ...o })
const mouvement = (o: Record<string, unknown> = {}) => ({
  id: 'm1', dossier_id: D, date: '2025-11-20', montant: 120, libelle: 'VIR CLIENT FICTIF', source_fichier: 'releve.csv',
  encaissements_de_factures: true, statut: 'rapprochee', piece_id: null, cotisation_id: null, categorie_id: null, emprunt_id: null,
  compte_bilan: null, declaration_tva_id: null, ventilee: false, reglement_groupe: false, prelevement_personnel: false, ...o,
})
const ecriture = (o: Record<string, unknown> = {}) => ({
  id: 'b1', dossier_id: D, piece_id: null, ligne_bancaire_id: null, date: '2025-11-20', compte: '706000', libelle: 'Encaissement',
  montant: 100, sens: 'credit', statut: 'proposee', created_at: '2025-11-21T09:00:00Z', immobilisation_id: null, vehicule_id: null,
  declaration_tva_id: null, cotisation_id: null, facture_id: null, encaissement_id: null, ...o,
})
// Les trois lignes que la vraie fonction écrit pour l'encaissement du même jour, en trésorerie.
const LIGNES_DE_E1 = [
  ecriture({ id: 'b1', compte: '512000', sens: 'debit', montant: 120, ligne_bancaire_id: 'm1', encaissement_id: 'e1' }),
  ecriture({ id: 'b2', compte: '706000', sens: 'credit', montant: 100, encaissement_id: 'e1' }),
  ecriture({ id: 'b3', compte: '445710', sens: 'credit', montant: 20, encaissement_id: 'e1' }),
]

function poser(tables: Partial<Record<string, Record<string, unknown>[]>> = {}) {
  faux.muet = {}
  faux.attente = null
  faux.relacher = null
  faux.retenirApresRpc = false
  faux.rpcs = []
  faux.erreurRpc = null
  faux.tables = []
  faux.inserts = []
  faux.parTable = {
    categories: [], pieces: [], ecritures_brouillon: [], immobilisations: [], natures_immobilisation: [], a_nouveaux: [],
    ventilations_bancaires: [], reglements_groupes: [], lettrages_manuels: [], declarations_tva: [], soldes_reportes: [],
    factures_emises: [facture()], facture_lignes: [ligneFacture], encaissements_factures: [encaissement()],
    encaissements_factures_taux: [part()], lignes_bancaires: [mouvement()],
    ...tables,
  }
}

function monter(o: { modele?: ModeleComptable; bascule?: boolean; valides?: readonly number[]; dossierId?: string; annee?: number } = {}) {
  const onglet = (dossierId: string) => (
    <ContexteDossier annee={o.annee ?? 'toutes'} valides={o.valides ?? []}>
      <EcrituresTab
        dossierId={dossierId} dossierNom="Dossier fictif" dossierSiret={null} assujettiTva modele={o.modele ?? TRESORERIE}
        ventesParLesFactures={o.bascule ?? true} onModeleUpdated={() => {}}
      />
    </ContexteDossier>
  )
  const rendu = render(onglet(o.dossierId ?? D))
  return { ...rendu, changerDeDossier: (id: string) => rendu.rerender(onglet(id)) }
}

const section = () => screen.getByRole('heading', { name: /^Ventes facturées/ }).closest('.card') as HTMLElement
const ligneDe = (texte: RegExp) => within(section()).getByText(texte).closest('tr') as HTMLElement
const NOM_E1 = /^L’encaissement du 20\/11\/2025 de la facture F2025-0001/

let confirmation: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  poser()
  confirmation = vi.spyOn(window, 'confirm').mockImplementation(() => true)
})
afterEach(() => { confirmation.mockRestore() })

describe('la section ne paraît que pour un dossier qui a basculé', () => {
  it('un dossier qui n’a pas basculé : ni section, ni lecture des ventes facturées', async () => {
    monter({ bascule: false })
    await screen.findByText(/Aucune écriture proposée pour l'instant/)
    expect(screen.queryByRole('heading', { name: /^Ventes facturées/ })).toBeNull()
    // Le drapeau des quatre champs levé (FEC22c2), le FEC d'un BNC lit les factures du dossier — leur numéro et le SIRET figé,
    // pour IdClient (lib/champsBncLecture.ts) —, jamais les ventes facturées : ni leurs lignes, ni leurs encaissements.
    const jamaisLues = ['facture_lignes', 'encaissements_factures', 'encaissements_factures_taux']
    for (const table of CHAMPS_BNC_EXPORTES === null ? ['factures_emises', ...jamaisLues] : jamaisLues) {
      expect(faux.tables, table).not.toContain(table)
    }
  })

  it('un dossier qui a basculé : chaque source dans son état, et la phrase sur le FEC', async () => {
    monter()
    const ligne = await waitFor(() => ligneDe(NOM_E1))
    expect(within(ligne).getByText('à écrire')).toBeTruthy()
    expect(within(ligne).getByRole('button', { name: 'Écrire' })).toBeTruthy()
    // Le montant se lit au `textContent` : il porte des espaces insécables, que le comparateur du texte normaliserait.
    expect(ligne.querySelector('[data-libelle="Montant"]')?.textContent).toBe(formatMoney(120))
    // Depuis l'étape VF4c2, une écriture à jour va au FEC et à la piste d'audit ; la phrase le dit, et dit ce qui reste hors.
    expect(within(section()).getByText(/Une écriture à jour va au FEC, sous la pièce de sa source, et à la piste d’audit/)).toBeTruthy()
  })
})

describe('Écrire, Réécrire, Retirer : la fonction seule, sur un clic confirmé', () => {
  it('« Écrire » : la confirmation nomme la source et ses lignes ; la fonction reçoit la composition ; la source devient « à jour »', async () => {
    monter()
    const ligne = await waitFor(() => ligneDe(NOM_E1))
    fireEvent.click(within(ligne).getByRole('button', { name: 'Écrire' }))
    await waitFor(() => expect(faux.rpcs).toHaveLength(1))
    const message = String(confirmation.mock.calls[0][0])
    expect(message).toMatch(/^Écrire l’encaissement du 20\/11\/2025 de la facture F2025-0001 \(Client fictif, virement, /)
    expect(message).toContain(`512000 au débit ${formatMoney(120)}`)
    expect(faux.rpcs[0]).toEqual({
      nom: 'ecrire_vente_facturee',
      args: {
        p_dossier_id: D, p_source: 'encaissement', p_source_id: 'e1',
        p_lignes: [
          { date: '2025-11-20', compte: '445710', sens: 'credit', montant: 20, ligne_bancaire_id: null, libelle: 'Encaissement, facture F2025-0001 — Client fictif' },
          { date: '2025-11-20', compte: '512000', sens: 'debit', montant: 120, ligne_bancaire_id: 'm1', libelle: 'Encaissement, facture F2025-0001 — Client fictif' },
          { date: '2025-11-20', compte: '706000', sens: 'credit', montant: 100, ligne_bancaire_id: null, libelle: 'Encaissement, facture F2025-0001 — Client fictif' },
        ],
      },
    })
    await waitFor(() => expect(within(ligneDe(NOM_E1)).getByText('à jour')).toBeTruthy())
    expect(within(ligneDe(NOM_E1)).queryByRole('button')).toBeNull()
  })

  it('une confirmation refusée n’écrit rien', async () => {
    confirmation.mockImplementation(() => false)
    monter()
    fireEvent.click(within(await waitFor(() => ligneDe(NOM_E1))).getByRole('button', { name: 'Écrire' }))
    await act(async () => {})
    expect(faux.rpcs).toEqual([])
  })

  it('deux clics du même `act` n’écrivent qu’une fois ; le verrou tient jusqu’au retour de la relecture', async () => {
    monter()
    const bouton = within(await waitFor(() => ligneDe(NOM_E1))).getByRole('button', { name: 'Écrire' })
    faux.retenirApresRpc = true
    await act(async () => {
      fireEvent.click(bouton)
      fireEvent.click(bouton)
    })
    expect(faux.rpcs).toHaveLength(1)
    // La relecture est retenue : la source reste affichée, son bouton grisé, et un troisième clic ne part pas davantage.
    const pendant = within(ligneDe(NOM_E1)).getByRole('button', { name: 'En cours…' })
    expect(pendant.hasAttribute('disabled')).toBe(true)
    await act(async () => { fireEvent.click(pendant) })
    expect(faux.rpcs).toHaveLength(1)
    faux.retenirApresRpc = false
    await act(async () => { faux.relacher?.(); faux.attente = null })
    await waitFor(() => expect(within(ligneDe(NOM_E1)).getByText('à jour')).toBeTruthy())
    expect(faux.rpcs).toHaveLength(1)
  })

  it('pendant la relecture, aucune AUTRE source n’offre son geste : les états affichés sont ceux d’avant', async () => {
    monter({ modele: ENGAGEMENT })
    const facture = await waitFor(() => ligneDe(/^La facture F2025-0001 \(Client fictif\)$/))
    expect(within(ligneDe(NOM_E1)).getByRole('button', { name: 'Écrire' }).hasAttribute('disabled')).toBe(false)
    faux.retenirApresRpc = true
    await act(async () => { fireEvent.click(within(facture).getByRole('button', { name: 'Écrire' })) })
    expect(faux.rpcs).toHaveLength(1)
    const autre = within(ligneDe(NOM_E1)).getByRole('button', { name: 'Écrire' })
    expect(autre.hasAttribute('disabled')).toBe(true)
    await act(async () => { fireEvent.click(autre) })
    expect(faux.rpcs).toHaveLength(1)
    faux.retenirApresRpc = false
    await act(async () => { faux.relacher?.(); faux.attente = null })
    await waitFor(() => expect(within(ligneDe(NOM_E1)).getByRole('button', { name: 'Écrire' }).hasAttribute('disabled')).toBe(false))
  })

  it('une écriture proposée périmée (R3) : « Réécrire » envoie la composition, qui remplace les lignes', async () => {
    poser({ ecritures_brouillon: [LIGNES_DE_E1[0], { ...LIGNES_DE_E1[1], montant: 90 }, { ...LIGNES_DE_E1[2], montant: 30 }] })
    monter()
    const ligne = await waitFor(() => ligneDe(NOM_E1))
    expect(within(ligne).getByText('à réécrire')).toBeTruthy()
    fireEvent.click(within(ligne).getByRole('button', { name: 'Réécrire' }))
    await waitFor(() => expect(faux.rpcs).toHaveLength(1))
    expect(String(confirmation.mock.calls[0][0])).toMatch(/^Réécrire l’encaissement .* \? Ses 3 lignes proposées sont remplacées par /)
    expect(faux.rpcs[0].nom).toBe('ecrire_vente_facturee')
    await waitFor(() => expect(within(ligneDe(NOM_E1)).getByText('à jour')).toBeTruthy())
  })

  it('un encaissement retiré qui garde ses lignes (R3) : « Retirer » passe la fonction du retrait, et la source s’en va', async () => {
    poser({ encaissements_factures: [encaissement({ retire_le: '2025-11-25T08:00:00Z' })], ecritures_brouillon: LIGNES_DE_E1 })
    monter()
    const ligne = await waitFor(() => ligneDe(NOM_E1))
    expect(within(ligne).getByText('à retirer')).toBeTruthy()
    fireEvent.click(within(ligne).getByRole('button', { name: 'Retirer' }))
    await waitFor(() => expect(faux.rpcs).toHaveLength(1))
    expect(String(confirmation.mock.calls[0][0])).toMatch(/^Retirer du brouillon les 3 lignes proposées de l’encaissement du 20\/11\/2025/)
    expect(faux.rpcs[0]).toEqual({ nom: 'retirer_ecriture_vente_facturee', args: { p_dossier_id: D, p_source: 'encaissement', p_source_id: 'e1' } })
    await screen.findByText('Aucune vente facturée n’a d’écriture à passer, à reprendre ou à dire.')
  })

  it('un refus de la base se dit, et le verrou se relâche : le geste se représente', async () => {
    monter()
    faux.erreurRpc = 'Le mot de la base, fictif.'
    fireEvent.click(within(await waitFor(() => ligneDe(NOM_E1))).getByRole('button', { name: 'Écrire' }))
    await within(section()).findByText('Le mot de la base, fictif.')
    expect(within(ligneDe(NOM_E1)).getByRole('button', { name: 'Écrire' }).hasAttribute('disabled')).toBe(false)
  })

  it('en engagement, la facture a sa propre source : la créance s’écrit par son geste à elle', async () => {
    monter({ modele: ENGAGEMENT })
    const ligne = await waitFor(() => ligneDe(/^La facture F2025-0001 \(Client fictif\)$/))
    fireEvent.click(within(ligne).getByRole('button', { name: 'Écrire' }))
    await waitFor(() => expect(faux.rpcs).toHaveLength(1))
    expect(faux.rpcs[0].args).toMatchObject({ p_source: 'facture', p_source_id: 'f1' })
    expect((faux.rpcs[0].args.p_lignes as { compte: string }[]).map((l) => l.compte)).toEqual(['411000', '445800', '706000'])
  })
})

describe('le compte de contrepartie d’une compensation', () => {
  const compensation = () => poser({
    encaissements_factures: [encaissement({ moyen: 'compensation', ligne_bancaire_id: null })], lignes_bancaires: [],
  })

  it('« compte à choisir » : le refus se dit sur la saisie telle qu’elle part, avant le clic ; le choix part sans espaces', async () => {
    compensation()
    monter()
    const ligne = await waitFor(() => ligneDe(NOM_E1))
    expect(within(ligne).getByText('ne s’écrit pas')).toBeTruthy()
    const champ = within(ligne).getByLabelText('Compte de contrepartie')
    const choisir = within(ligne).getByRole('button', { name: 'Choisir ce compte' })
    expect(choisir.hasAttribute('disabled')).toBe(true)
    fireEvent.change(champ, { target: { value: '411000' } })
    expect(within(ligne).getByText('Le compte des clients est celui que l’encaissement solde : il n’en est pas la contrepartie.')).toBeTruthy()
    expect(choisir.hasAttribute('disabled')).toBe(true)
    // Le clic sur un bouton grisé ne part pas, et la fonction elle-même relit le refus.
    fireEvent.click(choisir)
    expect(faux.rpcs).toEqual([])
    fireEvent.change(champ, { target: { value: '467 100' } })
    expect(within(ligne).getByText('Une fois choisi, il sera « à écrire ».')).toBeTruthy()
    expect(choisir.hasAttribute('disabled')).toBe(false)
    fireEvent.click(choisir)
    await waitFor(() => expect(faux.rpcs).toHaveLength(1))
    expect(String(confirmation.mock.calls[0][0])).toMatch(/^Choisir le compte 467100 comme contrepartie de l’encaissement du 20\/11\/2025 /)
    expect(faux.rpcs[0]).toEqual({ nom: 'choisir_compte_contrepartie', args: { p_dossier_id: D, p_encaissement_id: 'e1', p_compte: '467100' } })
    await waitFor(() => expect(within(ligneDe(NOM_E1)).getByText('à écrire')).toBeTruthy())
    expect(within(ligneDe(NOM_E1)).queryByLabelText('Compte de contrepartie')).toBeNull()
  })

  it('deux clics du même `act` sur « Choisir ce compte » ne l’envoient qu’une fois', async () => {
    compensation()
    monter()
    const ligne = await waitFor(() => ligneDe(NOM_E1))
    fireEvent.change(within(ligne).getByLabelText('Compte de contrepartie'), { target: { value: '467100' } })
    const choisir = within(ligne).getByRole('button', { name: 'Choisir ce compte' })
    await act(async () => {
      fireEvent.click(choisir)
      fireEvent.click(choisir)
    })
    await waitFor(() => expect(within(ligneDe(NOM_E1)).getByText('à écrire')).toBeTruthy())
    expect(faux.rpcs).toHaveLength(1)
  })

  // « CHANGER LE COMPTE » (VF4C1-Q1, étape VF4c3) : sur un encaissement par compensation dont le compte est choisi et accepté,
  // et dont l'écriture est passée — les trois lignes que la vraie fonction écrit sur le 467100.
  const changeable = () => poser({
    encaissements_factures: [encaissement({ moyen: 'compensation', ligne_bancaire_id: null, compte_contrepartie: '467100' })],
    lignes_bancaires: [],
    ecritures_brouillon: [
      ecriture({ id: 'b1', compte: '467100', sens: 'debit', montant: 120, encaissement_id: 'e1' }),
      ecriture({ id: 'b2', compte: '706000', sens: 'credit', montant: 100, encaissement_id: 'e1' }),
      ecriture({ id: 'b3', compte: '445710', sens: 'credit', montant: 20, encaissement_id: 'e1' }),
    ],
  })

  it('« Changer le compte » : le champ s’ouvre sur un clic, le refus se dit avant, la confirmation nomme l’ancien et le nouveau', async () => {
    changeable()
    monter()
    const ligne = await waitFor(() => ligneDe(NOM_E1))
    expect(within(ligne).getByText('à jour')).toBeTruthy()
    expect(within(ligne).queryByRole('textbox')).toBeNull()
    expect(within(ligne).getByText('Compte de contrepartie : 467100.')).toBeTruthy()
    fireEvent.click(within(ligne).getByRole('button', { name: 'Changer le compte' }))
    const champ = within(ligne).getByLabelText('Nouveau compte de contrepartie (aujourd’hui 467100)')
    const choisir = within(ligne).getByRole('button', { name: 'Choisir ce compte' })
    // Le même compte : rien ne part, et la ligne le dit.
    fireEvent.change(champ, { target: { value: '467 100' } })
    expect(within(ligne).getByText('C’est le compte qu’il porte déjà.')).toBeTruthy()
    expect(choisir.hasAttribute('disabled')).toBe(true)
    // Un compte refusé : le mot de la base, avant le clic.
    fireEvent.change(champ, { target: { value: '512000' } })
    expect(within(ligne).getByText('Un encaissement par la banque, par chèque ou en espèces se dit par son moyen de paiement, qui choisit son compte.')).toBeTruthy()
    expect(choisir.hasAttribute('disabled')).toBe(true)
    fireEvent.click(choisir)
    expect(faux.rpcs).toEqual([])
    fireEvent.change(champ, { target: { value: '467200' } })
    expect(within(ligne).getByText('Une fois changé, ses écritures proposées seront « à réécrire ».')).toBeTruthy()
    fireEvent.click(choisir)
    await waitFor(() => expect(faux.rpcs).toHaveLength(1))
    expect(String(confirmation.mock.calls[0][0])).toBe(
      `Changer le compte de contrepartie de l’encaissement du 20/11/2025 de la facture F2025-0001 (Client fictif, compensation, ${formatMoney(120)}), `
      + 'du 467100 au 467200 ? Son écriture déjà passée, sur le 467100, deviendra « à réécrire » : elle se réécrit ensuite d’ici, sur un clic.',
    )
    expect(faux.rpcs[0]).toEqual({ nom: 'choisir_compte_contrepartie', args: { p_dossier_id: D, p_encaissement_id: 'e1', p_compte: '467200' } })
    // Relu : l'écriture passée sur l'ancien compte est « à réécrire », et le champ s'est refermé.
    await waitFor(() => expect(within(ligneDe(NOM_E1)).getByText('à réécrire')).toBeTruthy())
    expect(within(ligneDe(NOM_E1)).queryByRole('textbox')).toBeNull()
    expect(within(ligneDe(NOM_E1)).getByText('Compte de contrepartie : 467200.')).toBeTruthy()
  })

  it('« Annuler » referme le champ sans rien envoyer ; une confirmation refusée n’envoie rien non plus', async () => {
    changeable()
    monter()
    const ligne = await waitFor(() => ligneDe(NOM_E1))
    fireEvent.click(within(ligne).getByRole('button', { name: 'Changer le compte' }))
    fireEvent.change(within(ligne).getByRole('textbox'), { target: { value: '467200' } })
    confirmation.mockImplementation(() => false)
    fireEvent.click(within(ligne).getByRole('button', { name: 'Choisir ce compte' }))
    fireEvent.click(within(ligne).getByRole('button', { name: 'Annuler' }))
    expect(within(ligne).queryByRole('textbox')).toBeNull()
    expect(faux.rpcs).toEqual([])
  })

  it('deux clics du même `act` sur le changement ne l’envoient qu’une fois', async () => {
    changeable()
    monter()
    const ligne = await waitFor(() => ligneDe(NOM_E1))
    fireEvent.click(within(ligne).getByRole('button', { name: 'Changer le compte' }))
    fireEvent.change(within(ligne).getByRole('textbox'), { target: { value: '467200' } })
    const choisir = within(ligne).getByRole('button', { name: 'Choisir ce compte' })
    await act(async () => {
      fireEvent.click(choisir)
      fireEvent.click(choisir)
    })
    await waitFor(() => expect(within(ligneDe(NOM_E1)).getByText('à réécrire')).toBeTruthy())
    expect(faux.rpcs).toHaveLength(1)
  })

  it('dans un exercice validé, le compte ne se change plus : aucun bouton', async () => {
    changeable()
    faux.parTable.ecritures_brouillon = (faux.parTable.ecritures_brouillon ?? []).map((l) => ({ ...l, statut: 'validee' }))
    monter({ valides: [2025] })
    const ligne = await waitFor(() => ligneDe(NOM_E1))
    expect(within(ligne).getByText('validée')).toBeTruthy()
    expect(within(ligne).queryByRole('button', { name: 'Changer le compte' })).toBeNull()
  })
})

describe('aucun geste sur une lecture partielle, refusée, ou pas encore revenue', () => {
  const sansGeste = () => {
    expect(within(section()).queryAllByRole('button')).toEqual([])
    expect(within(section()).queryAllByRole('textbox')).toEqual([])
  }

  it('pas encore revenue : « Chargement… », aucun geste ; revenue, les gestes paraissent', async () => {
    let relacher!: () => void
    faux.attente = new Promise<void>((r) => { relacher = r })
    monter()
    expect(within(section()).getByText('Chargement…')).toBeTruthy()
    sansGeste()
    await act(async () => { relacher(); faux.attente = null })
    await waitFor(() => expect(within(ligneDe(NOM_E1)).getByRole('button', { name: 'Écrire' })).toBeTruthy())
  })

  it.each(['encaissements_factures', 'encaissements_factures_taux', 'facture_lignes', 'factures_emises'])(
    'les ventes facturées lues en partie (%s) : la section le dit, et n’offre rien', async (table) => {
      faux.muet = { [table]: 0 }
      monter()
      await within(section()).findByText(/n’ont pas pu être lus en entier/)
      sansGeste()
      expect(within(section()).queryByRole('table')).toBeNull()
    },
  )

  it('le brouillon lu en partie : la section le dit aussi, et n’offre rien', async () => {
    poser({ ecritures_brouillon: LIGNES_DE_E1 })
    faux.muet = { ecritures_brouillon: 1 }
    monter()
    await within(section()).findByText(/n’ont pas pu être lus en entier \(1 ligne\(s\) lue\(s\) sur 3/)
    sansGeste()
  })

  it('un autre dossier ouvert pendant que ses lectures sont en cours : rien de l’ancien ne s’affiche ni ne s’offre', async () => {
    const { changerDeDossier } = monter()
    await waitFor(() => ligneDe(NOM_E1))
    faux.attente = new Promise<void>(() => {})
    changerDeDossier('d2')
    expect(within(section()).getByText('Chargement…')).toBeTruthy()
    sansGeste()
  })
})

// LE VIREMENT MIXTE (étape VF5h ; VF2-Q2, selon VF5-Q2) : le virement m1 de 179,50 € porte l'encaissement de la facture
// source (120 €, du jour) et celui d'une facture d'avant la bascule (60 €, du 18/11), dont la pièce pa est l'exemplaire
// désigné. Le CÂBLAGE : la section compose le mouvement avec les exemplaires lus — la part de la source et les frais —, la
// génération écrit l'exemplaire daté par le virement, sa banque sur lui ; sans l'exemplaire, le mouvement ne s'écrit pas et
// la section nomme la facture ; des ventes lues en partie retiennent la génération, et le bouton dit pourquoi.
describe('le virement mixte dans l’onglet Écritures (étape VF5h)', () => {
  const FACTURE_D_AVANT = facture({ id: 'fa', numero: 'F2025-0042', date_emission: '2025-09-30', source_de_la_vente: false, montant_ttc: 60 })
  const RECETTES = { id: 'c-rec', dossier_id: null, code: 'honoraires', libelle: 'Honoraires', ordre: 1, compte_comptable: '706000', poste_2035: 'Recettes' }
  const EXEMPLAIRE = {
    id: 'pa', dossier_id: D, nom_fichier: 'F2025-0042.pdf', storage_path: `${D}/pa.pdf`, statut: 'validee', type_piece: 'vente',
    date_piece: '2025-09-30', montant_ht: 50, montant_tva: 10, montant_ttc: 60, devise: 'EUR', tiers: 'CLIENT D’AVANT',
    categorie_id: 'c-rec', facture_id: 'fa', created_at: '2025-09-30T09:00:00Z',
  }
  const poserLeVirementMixte = (o: { designee?: boolean } = {}) => poser({
    categories: [RECETTES],
    pieces: [{ ...EXEMPLAIRE, facture_id: (o.designee ?? true) ? 'fa' : null }],
    factures_emises: [facture(), FACTURE_D_AVANT],
    encaissements_factures: [
      encaissement(),
      encaissement({ id: 'ea', facture_id: 'fa', date_encaissement: '2025-11-18', montant: 60, cree_le: '2025-11-18T10:00:00Z' }),
    ],
    encaissements_factures_taux: [part(), part({ encaissement_id: 'ea', montant: 60 })],
    lignes_bancaires: [mouvement({ montant: 179.5 })],
  })
  const NOM_M1 = /^Le mouvement du 20\/11\/2025/

  it('la section écrit la part de la source et les frais ; la génération date l’exemplaire par le virement, sa banque sur lui', async () => {
    poserLeVirementMixte()
    monter()
    const ligne = await waitFor(() => ligneDe(NOM_M1))
    expect(within(ligne).getByText('à écrire')).toBeTruthy()
    fireEvent.click(within(ligne).getByRole('button', { name: 'Écrire' }))
    await waitFor(() => expect(faux.rpcs).toHaveLength(1))
    expect(faux.rpcs[0].args.p_lignes).toEqual([
      { date: '2025-11-20', compte: '512000', sens: 'credit', montant: 0.5, ligne_bancaire_id: 'm1', libelle: expect.any(String) },
      { date: '2025-11-20', compte: '627000', sens: 'debit', montant: 0.5, ligne_bancaire_id: 'm1', libelle: expect.any(String) },
    ])
    const generer = await screen.findByRole('button', { name: /Générer les écritures manquantes \(1\)/ })
    expect(generer.hasAttribute('disabled')).toBe(false)
    await act(async () => { generer.click() })
    await waitFor(() => expect(faux.inserts).toHaveLength(1))
    const lignes = faux.inserts[0].lignes
    expect(lignes.every((l) => l.piece_id === 'pa' && l.date === '2025-11-20')).toBe(true)
    expect(lignes.map((l) => [l.compte, l.sens, l.montant, l.ligne_bancaire_id ?? null]).sort()).toEqual([
      ['445710', 'credit', 10, null], ['512000', 'debit', 60, 'm1'], ['706000', 'credit', 50, null],
    ])
  })

  it('sans l’exemplaire désigné : le mouvement ne s’écrit pas, la section nomme la facture et dit le geste qui manque', async () => {
    poserLeVirementMixte({ designee: false })
    monter()
    const ligne = await waitFor(() => ligneDe(NOM_M1))
    expect(within(ligne).getByText(/désignez d’abord cet exemplaire \(facture F2025-0042\)/)).toBeTruthy()
    expect(within(ligne).queryByRole('button', { name: 'Écrire' })).toBeNull()
  })

  it('les ventes facturées lues en partie : la génération des pièces est retenue, et le bouton dit pourquoi', async () => {
    poserLeVirementMixte()
    faux.muet = { encaissements_factures: 0 }
    monter()
    await within(section()).findByText(/n’ont pas pu être lus en entier/)
    const generer = await screen.findByRole('button', { name: /Générer les écritures manquantes \(1\)/ })
    expect(generer.hasAttribute('disabled')).toBe(true)
    // La garde des factures sources non lues (étape VF6a) est la seule : son titre dit aussi le virement mixte.
    expect(generer.getAttribute('title')).toMatch(
      /^Factures sources de leurs ventes non lues \(les encaissements : .*\) — générer maintenant pourrait écrire la vente d’un exemplaire à côté de celle de sa facture, ou mal dater une pièce qu’un virement mixte paie\.$/)
    await act(async () => { generer.click() })
    expect(faux.inserts).toEqual([])
  })
})

describe('les contrôles et les gestes d’hier ne jugent pas les lignes d’une vente facturée', () => {
  // Toutes les formes : la créance d'une facture en engagement, un encaissement (sa banque portant le mouvement), le
  // mouvement que ses encaissements classent, et les lignes d'un mouvement déclassé (R3).
  const LIGNES_DES_VENTES = [
    ecriture({ id: 'v1', date: '2025-11-10', compte: '411000', sens: 'debit', montant: 120, facture_id: 'f1' }),
    ecriture({ id: 'v2', date: '2025-11-10', compte: '706000', sens: 'credit', montant: 100, facture_id: 'f1' }),
    ecriture({ id: 'v3', date: '2025-11-10', compte: '445800', sens: 'credit', montant: 20, facture_id: 'f1' }),
    ecriture({ id: 'v4', compte: '512000', sens: 'debit', montant: 120, ligne_bancaire_id: 'm1', encaissement_id: 'e1' }),
    ecriture({ id: 'v5', compte: '411000', sens: 'credit', montant: 120, encaissement_id: 'e1' }),
    ecriture({ id: 'v6', date: '2025-11-22', compte: '512000', sens: 'debit', montant: 50, ligne_bancaire_id: 'm2' }),
    ecriture({ id: 'v7', date: '2025-11-22', compte: '511000', sens: 'credit', montant: 50, ligne_bancaire_id: 'm2' }),
    ecriture({ id: 'v8', date: '2025-11-23', compte: '512000', sens: 'debit', montant: 30, ligne_bancaire_id: 'm3' }),
    ecriture({ id: 'v9', date: '2025-11-23', compte: '511000', sens: 'credit', montant: 30, ligne_bancaire_id: 'm3' }),
  ]
  const jeu = () => poser({
    ecritures_brouillon: LIGNES_DES_VENTES,
    encaissements_factures: [
      encaissement(),
      encaissement({ id: 'e2', date_encaissement: '2025-11-21', montant: 50, moyen: 'cheque', ligne_bancaire_id: 'm2', cree_le: '2025-11-21T10:00:00Z' }),
      encaissement({ id: 'e3', date_encaissement: '2025-11-21', montant: 30, moyen: 'cheque', ligne_bancaire_id: 'm3', cree_le: '2025-11-21T11:00:00Z', retire_le: '2025-11-24T08:00:00Z' }),
    ],
    encaissements_factures_taux: [part(), part({ encaissement_id: 'e2', montant: 50 }), part({ encaissement_id: 'e3', montant: 30 })],
    lignes_bancaires: [
      mouvement(), mouvement({ id: 'm2', date: '2025-11-22', montant: 50 }),
      // Déclassé : libre, mais il garde ses lignes.
      mouvement({ id: 'm3', date: '2025-11-23', montant: 30, encaissements_de_factures: false, statut: 'non_rapprochee' }),
    ],
  })

  // Les lignes de la piste d'audit rompue, sans l'en-tête : la date et le compte de chacune.
  const ruptures = () => {
    const carte = screen.getByRole('heading', { name: /Piste d'audit rompue/ }).closest('.card') as HTMLElement
    return within(carte).getAllByRole('row').slice(1)
      .map((r) => `${r.querySelector('[data-libelle="Date"]')?.textContent} ${r.querySelector('[data-libelle="Compte"]')?.textContent}`)
  }

  it('aucune rupture d’une vente facturée, aucune écriture sans objet, à régénérer ni déséquilibrée, aucun geste d’hier', async () => {
    jeu()
    monter({ modele: ENGAGEMENT })
    await waitFor(() => ligneDe(/^Le mouvement du 23\/11\/2025/))
    // Seules les lignes du mouvement DÉCLASSÉ (R3) sont des ruptures : rien ne les justifie plus — ni pièce, ni classement.
    // La facture, l'encaissement et le mouvement que ses encaissements classent n'en sont pas.
    expect(ruptures().sort()).toEqual(['23/11/2025 511000', '23/11/2025 512000'])
    for (const titre of [
      /Écritures que la pièce ne justifie plus/, /Écritures à régénérer/, /Écritures déséquilibrées/,
      /Mouvements affectés à réaffecter/, /Mouvements ventilés à réécrire/, /compte de bilan à réécrire/, /Paiements de TVA à réécrire/,
    ]) {
      expect(screen.queryByRole('heading', { name: titre }), String(titre)).toBeNull()
    }
    for (const geste of [/^Régénérer$/, /^Retirer l'écriture$/, /^Réaffecter$/]) expect(screen.queryByRole('button', { name: geste })).toBeNull()
    // Le mouvement déclassé, lui, se dit « à retirer » — dans la section, par sa fonction.
    expect(within(ligneDe(/^Le mouvement du 23\/11\/2025/)).getByText('à retirer')).toBeTruthy()
    // Toutes les lignes restent au journal : elles comptent dans la balance. Depuis l'étape VF4c2, le FEC porte celles que
    // la composition rend telles quelles (la facture, le mouvement classé) ; le badge compte les autres — l'encaissement à
    // réécrire, le mouvement déclassé — et dit d'où elles viennent.
    expect(screen.getByText(/4 écritures ne seront pas dans ce FEC .* dont 4 d’une vente facturée, à réécrire ou à retirer/)).toBeTruthy()
  })

  it('le filtre ne rend pas le contrôle aveugle : une ligne sans pièce ni source reste une rupture', async () => {
    jeu()
    faux.parTable.ecritures_brouillon = [...LIGNES_DES_VENTES, ecriture({ id: 'orpheline', compte: '606100', sens: 'debit', montant: 12 })]
    monter({ modele: ENGAGEMENT })
    await screen.findByRole('heading', { name: /Piste d'audit rompue/ })
    expect(ruptures().sort()).toEqual(['20/11/2025 606100', '23/11/2025 511000', '23/11/2025 512000'])
  })
})

describe('le FEC, la piste d’audit et le lettrage d’un dossier qui a basculé (étape VF4c2)', () => {
  // La facture et son encaissement du même jour, en engagement, au brouillon exactement comme la fonction les écrit.
  const ECRITES = [
    ecriture({ id: 'w1', date: '2025-11-10', compte: '411000', sens: 'debit', montant: 120, facture_id: 'f1', libelle: 'Facture F2025-0001 — Client fictif' }),
    ecriture({ id: 'w2', date: '2025-11-10', compte: '706000', sens: 'credit', montant: 100, facture_id: 'f1', libelle: 'Facture F2025-0001 — Client fictif' }),
    ecriture({ id: 'w3', date: '2025-11-10', compte: '445800', sens: 'credit', montant: 20, facture_id: 'f1', libelle: 'Facture F2025-0001 — Client fictif' }),
    ecriture({ id: 'w4', compte: '512000', sens: 'debit', montant: 120, ligne_bancaire_id: 'm1', encaissement_id: 'e1' }),
    ecriture({ id: 'w5', compte: '411000', sens: 'credit', montant: 120, encaissement_id: 'e1' }),
    ecriture({ id: 'w6', compte: '445800', sens: 'debit', montant: 20, encaissement_id: 'e1' }),
    ecriture({ id: 'w7', compte: '445710', sens: 'credit', montant: 20, encaissement_id: 'e1' }),
  ]
  beforeEach(() => { telecharge.fichiers = [] })

  it('le FEC porte chaque écriture sous sa pièce, son journal et l’auxiliaire du client, lettrée par facture', async () => {
    poser({ ecritures_brouillon: ECRITES })
    monter({ modele: ENGAGEMENT, annee: 2025 })
    await waitFor(() => expect(within(ligneDe(/^La facture F2025-0001/)).getByText('à jour')).toBeTruthy())
    expect(screen.queryByText(/ne seront? pas dans ce FEC/)).toBeNull()
    // Ce qui ne se lettre pas se dit dans la section, facture par facture ; ici, elle l'est.
    expect(within(ligneDe(/^La facture F2025-0001/)).getByText(/^Lettrée A au 411000/)).toBeTruthy()
    await act(async () => { screen.getByRole('button', { name: /Exporter FEC 2025/ }).click() })
    expect(telecharge.fichiers).toHaveLength(1)
    const rangs = telecharge.fichiers[0].contenu.split('\r\n').slice(1).map((r) => r.split('\t'))
    expect(rangs.map((r) => [r[0], r[2], r[4], r[6], r[8], r[13]])).toEqual([
      ['VE', 'VE00001', '411000', 'CFICTIF', 'F2025-0001', 'A'],
      ['VE', 'VE00001', '445800', '', 'F2025-0001', ''],
      ['VE', 'VE00001', '706000', '', 'F2025-0001', ''],
      ['BQ', 'BQ00001', '445800', '', 'F2025-0001', ''],
      ['BQ', 'BQ00001', '512000', '', 'F2025-0001', ''],
      ['BQ', 'BQ00001', '411000', 'CFICTIF', 'F2025-0001', 'A'],
      ['BQ', 'BQ00001', '445710', '', 'F2025-0001', ''],
    ])
  })

  it('la piste d’audit justifie chaque ligne par sa facture, son registre et son mouvement, et lit les preuves sur le clic', async () => {
    poser({
      ecritures_brouillon: ECRITES,
      pieces: [{ id: 'p-ex', dossier_id: D, facture_id: 'f1', nom_fichier: 'F2025-0001.pdf', storage_hash: 'a'.repeat(64), statut: 'a_valider' }],
    })
    monter({ modele: ENGAGEMENT, annee: 2025 })
    await waitFor(() => expect(within(ligneDe(/^La facture F2025-0001/)).getByText('à jour')).toBeTruthy())
    faux.tables = []
    await act(async () => { screen.getByRole('button', { name: /Exporter la piste d'audit 2025/ }).click() })
    await waitFor(() => expect(telecharge.fichiers).toHaveLength(1))
    expect(faux.tables).toEqual(expect.arrayContaining(['pieces', 'transmissions_factures']))
    const corps = telecharge.fichiers[0].contenu.split('\r\n').slice(1)
    expect(corps).toHaveLength(ECRITES.length)
    expect(corps.filter((r) => r.includes('Facture F2025-0001 — exemplaire : F2025-0001.pdf;' + 'a'.repeat(64)))).toHaveLength(3)
    expect(corps.filter((r) => r.includes('Registre des encaissements : encaissement du 20/11/2025 (virement)'))).toHaveLength(4)
    // Rien ne manque : la dernière colonne est vide sur chaque ligne.
    for (const r of corps) expect(r.endsWith(';'), r).toBe(true)
  })

  it('une écriture à réécrire reste hors du FEC, et le badge le dit avec sa raison ; la facture dit pourquoi elle n’est pas lettrée', async () => {
    poser({ ecritures_brouillon: ECRITES.map((e) => (e.id === 'w7' ? { ...e, montant: 20.01 } : e.id === 'w6' ? { ...e, montant: 20.01 } : e)) })
    monter({ modele: ENGAGEMENT, annee: 2025 })
    await waitFor(() => expect(within(ligneDe(NOM_E1)).getByText('à réécrire')).toBeTruthy())
    expect(screen.getByText(/4 écritures ne seront pas dans ce FEC .* dont 4 d’une vente facturée, à réécrire ou à retirer/)).toBeTruthy()
    expect(within(ligneDe(/^La facture F2025-0001/)).getByText(/^Non lettrée au 411000 : ses lignes se soldent, mais une de ses écritures est à réécrire/)).toBeTruthy()
    await act(async () => { screen.getByRole('button', { name: /Exporter FEC 2025/ }).click() })
    expect(telecharge.fichiers[0].contenu).not.toContain('BQ00001')
    expect(telecharge.fichiers[0].contenu).toContain('VE00001')
  })

  it('des ventes facturées lues en partie : ni le FEC ni la piste ne s’exportent, et le bouton dit pourquoi', async () => {
    poser({ ecritures_brouillon: ECRITES })
    faux.muet = { encaissements_factures: 0 }
    monter({ modele: ENGAGEMENT, annee: 2025 })
    await within(section()).findByText(/n’ont pas pu être lus en entier/)
    for (const nom of [/Exporter FEC 2025/, /Exporter la piste d'audit 2025/]) {
      const bouton = screen.getByRole('button', { name: nom })
      expect(bouton.hasAttribute('disabled'), String(nom)).toBe(true)
      expect(bouton.getAttribute('title'), String(nom)).toMatch(/^Ventes facturées non lues en entier/)
    }
  })

  it('les preuves des factures lues en partie : la piste ne part pas, et l’écran dit pourquoi', async () => {
    poser({
      ecritures_brouillon: ECRITES,
      transmissions_factures: [{ id: 't1', dossier_id: D, facture_id: 'f1', etat: 'accepte', sha256: 'b'.repeat(64), hote: 'api.superpdp.tech' }],
    })
    monter({ modele: ENGAGEMENT, annee: 2025 })
    await waitFor(() => expect(within(ligneDe(/^La facture F2025-0001/)).getByText('à jour')).toBeTruthy())
    faux.muet = { transmissions_factures: 0 }
    await act(async () => { screen.getByRole('button', { name: /Exporter la piste d'audit 2025/ }).click() })
    expect(await screen.findByText(/Les preuves des factures n'ont pas pu être lues en entier/)).toBeTruthy()
    expect(telecharge.fichiers).toHaveLength(0)
  })

  it('pas encore lues : les deux exports attendent', async () => {
    poser({ ecritures_brouillon: ECRITES })
    faux.attente = new Promise<void>(() => {})
    monter({ modele: ENGAGEMENT, annee: 2025 })
    for (const nom of [/Exporter FEC 2025/, /Exporter la piste d'audit 2025/]) {
      expect(screen.getByRole('button', { name: nom }).hasAttribute('disabled'), String(nom)).toBe(true)
    }
  })
})
