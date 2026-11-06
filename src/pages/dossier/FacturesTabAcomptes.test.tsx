import { createHash } from 'node:crypto'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FacturesTab from './FacturesTab'
import { facture as factureCii, SIRET_VENDEUR } from '../../test/facturesCii'
import { NON_BASCULE } from '../../test/factures'
import { motsDuCabinet } from '../../lib/espaceVentes'
import {
  REFUS_FINALE_ACOMPTE_EN_BROUILLON, refusAcompteRepris, refusCumulDesAcomptes,
} from '../../lib/acomptesDesFactures'

// LA FACTURE D'ACOMPTE ET LA FINALE DANS L'ONGLET DES FACTURES (étape P5b5b), avec le VRAI onglet, son formulaire et sa
// fenêtre d'avoir, et un faux client qui APPLIQUE les filtres, projette les colonnes demandées et annonce un compte. Ce que
// ces cas gardent, dans les deux espaces : le drapeau baissé, l'onglet d'hier au caractère près et aucune colonne neuve
// nommée ; levé, la marque « Acompte » ou « Finale » et la recherche qui la trouve ; le brouillon d'un acompte sans retouche
// de ses lignes, qui repartent telles quelles ; la validation refusée avant le clic ; la confirmation d'une finale et sa
// reprise envoyée, deux clics du même `act` n'écrivant qu'une fois ; l'avoir d'un acompte refusé tant que la finale le
// reprend, permis une fois celle-ci créditée en entier ; une lecture refusée qui n'offre rien. Données FICTIVES.

const faux = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  lectures: [] as { table: string; colonnes: string }[],
  appels: [] as { nom: string; args: Record<string, unknown> }[],
  // Une table dont toute lecture est refusée.
  refusee: null as string | null,
  acomptes: false,
}))

vi.mock('../../lib/devis', async (original) => ({
  ...(await original<typeof import('../../lib/devis')>()),
  get ACOMPTES_PREVUS() { return faux.acomptes },
}))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatIn, predicatOr } = await import('../../test/filtresPostgrest')
  type Predicat = (ligne: Record<string, unknown>) => boolean
  return {
    supabase: {
      rpc: async (nom: string, args: Record<string, unknown>) => {
        faux.appels.push({ nom, args })
        await Promise.resolve()
        if (nom === 'enregistrer_facture') return { data: [{ facture_id: args.p_facture_id ?? 'f-neuve', numero: args.p_valider ? 'F2026-0099' : null }], error: null }
        return { data: null, error: { message: `Appel non attendu : ${nom}` } }
      },
      functions: {
        invoke: async (nom: string, options: { body: Record<string, unknown> }) => {
          if (nom === 'plateforme-agreee' && options.body.action === 'statut') return { data: { connexion: null }, error: null }
          if (nom === 'superpdp-credentials' && options.body.action === 'status') return { data: { configured: false }, error: null }
          throw new Error(`Appel non attendu : ${nom}`)
        },
      },
      from: (table: string) => {
        if (!(table in faux.tables)) throw new Error(`Table non attendue dans ce test : ${table}`)
        const predicats: Predicat[] = []
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        let liste = '*'
        const partir = () => {
          faux.lectures.push({ table, colonnes: liste })
          if (faux.refusee === table) return { data: null, error: { message: 'permission denied' }, count: null }
          const colonnes = liste === '*' ? null : liste.split(',').map((x) => x.trim()).filter((x) => !x.includes('('))
          const toutes = filtrer(faux.tables[table], predicats)
          const rendu = toutes.slice(debut, fin + 1).map((l) => (colonnes ? Object.fromEntries(colonnes.map((k) => [k, l[k]])) : l))
          return { data: rendu, error: null, count: toutes.length }
        }
        const c: Record<string, unknown> = {}
        Object.assign(c, {
          select: (l?: string) => { liste = l ?? '*'; return c },
          eq: (colonne: string, valeur: unknown) => {
            predicats.push(colonne === 'factures_emises.dossier_id'
              ? (l) => faux.tables.factures_emises.some((f) => f.id === l.facture_id && f.dossier_id === valeur)
              : predicatEq(colonne, valeur))
            return c
          },
          in: (colonne: string, valeurs: unknown[]) => { predicats.push(predicatIn(colonne, valeurs)); return c },
          or: (expression: string) => { predicats.push(predicatOr(expression)); return c },
          order: () => c,
          range: (d: number, f: number) => { debut = d; fin = f; return c },
          maybeSingle: () => Promise.resolve().then(partir).then((r) => ({ data: r.data?.[0] ?? null, error: r.error })),
          then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => Promise.resolve().then(partir).then(suite, echec),
        })
        return c
      },
    },
  }
})

// Un devis de 1 000 € HT à 20 % ; son acompte validé de 300 € HT (F2026-0010), et sa finale en brouillon qui le reprend. Un
// second devis et son acompte en brouillon de 200 € HT. Une facture ordinaire validée.
const DEVIS = [
  { id: 'dv1', dossier_id: 'd1', numero: 'D2026-0001', lignes: [{ designation: 'Mission fictive', quantite: 1, prix_unitaire_ht: 1000, taux_tva: 20 }] },
  { id: 'dv2', dossier_id: 'd1', numero: 'D2026-0002', lignes: [{ designation: 'Audit fictif', quantite: 1, prix_unitaire_ht: 1000, taux_tva: 20 }] },
]
const ligne = (id: string, factureId: string, ordre: number, designation: string, quantite: number, prix: number, reprise: string | null = null) => ({
  id, facture_id: factureId, ordre, designation, quantite, prix_unitaire_ht: prix, taux_tva: 20, unite: 'C62', reference: null,
  article_id: null, nature: null, reprise_facture_id: reprise,
})
const base = (id: string, lignes: { quantite: number; prix_unitaire_ht: number }[], p: Record<string, unknown>) => ({
  ...factureCii(lignes.map((l, i) => ({ ordre: i, designation: 'x', taux_tva: 20, ...l })), {
    id, date_emission: '2026-10-10', emetteur_nom: 'Atelier fictif', emetteur_adresse: '1 rue Fictive', tiers_nom: 'Client Fictif SAS',
  }),
  acompte: false, date_versement_acompte: null, contact_id: null, ...p,
})
const ACOMPTE = () => base('fa1', [{ quantite: 1, prix_unitaire_ht: 300 }], { numero: 'F2026-0010', acompte: true, date_versement_acompte: '2026-10-05' })
const FINALE = (p: Record<string, unknown> = {}) =>
  base('ff1', [{ quantite: 1, prix_unitaire_ht: 1000 }, { quantite: -1, prix_unitaire_ht: 300 }], { numero: null, statut: 'brouillon', date_emission: '2026-10-20', validated_at: null, ...p })
const BROUILLON_D_ACOMPTE = (prix = 200) => base('fb2', [{ quantite: 1, prix_unitaire_ht: prix }], { numero: null, statut: 'brouillon', acompte: true, validated_at: null })
const ORDINAIRE = () => base('f1', [{ quantite: 1, prix_unitaire_ht: 500 }], { numero: 'F2026-0001', date_emission: '2026-10-01', tiers_nom: 'Client Ordinaire SARL' })
const lienDe = (id: string, devis: string, factureId: string, role: string, cree_le = '2026-10-10T08:00:00Z') =>
  ({ id, dossier_id: 'd1', devis_id: devis, facture_id: factureId, cree_le, role })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  // 10 h UTC : le 4 novembre dans les quatre fuseaux de `test:fuseaux` (23 h à Auckland, 5 h à New York). À 11 h UTC, il
  // était déjà minuit le 5 à Auckland, et la fenêtre d'avoir, qui affiche la date du jour, changeait d'empreinte.
  vi.setSystemTime(new Date('2026-11-04T10:00:00Z'))
  faux.acomptes = false
  faux.lectures = []
  faux.appels = []
  faux.refusee = null
  faux.tables = {
    dossiers: [{
      id: 'd1', cabinet_id: 'c1', siret: SIRET_VENDEUR, adresse: '1 rue Fictive', statut_tva: 'redevable', article_exoneration: null, numero_tva_attribue: false,
      denomination_imprimee: 'Atelier fictif SAS', forme_juridique: '5710', capital: null, rcs_ville: null, mentions_identite: null,
      mode_comptable: 'tresorerie',
    }],
    // Le nom du cabinet, que la validation du cabinet fige comme mandataire (P4) : lu avec le dossier.
    cabinets: [{ id: 'c1', nom: 'Cabinet Fictif' }],
    factures_emises: [ORDINAIRE(), ACOMPTE(), FINALE(), BROUILLON_D_ACOMPTE()],
    facture_lignes: [
      ligne('lo', 'f1', 0, 'Conseil fictif', 1, 500),
      ligne('la1', 'fa1', 0, 'Acompte de 30 % sur le devis D2026-0001', 1, 300),
      ligne('lf1', 'ff1', 0, 'Mission fictive', 1, 1000),
      ligne('lf2', 'ff1', 1, 'Reprise de l’acompte F2026-0010 du 10/10/2026', -1, 300, 'fa1'),
      ligne('lb1', 'fb2', 0, 'Acompte de 20 % sur le devis D2026-0002', 1, 200),
    ],
    devis: DEVIS.map((d) => ({ ...d })),
    devis_factures: [lienDe('l1', 'dv1', 'fa1', 'acompte'), lienDe('l2', 'dv1', 'ff1', 'finale', '2026-10-20T08:00:00Z'), lienDe('l3', 'dv2', 'fb2', 'acompte')],
    transmissions_factures: [],
    facture_superpdp_events: [],
    encaissements_factures: [],
    encaissements_factures_taux: [],
    transmissions_encaissements: [],
    statuts_factures_recus: [],
    lignes_bancaires: [],
    reglements_groupes: [],
    pieces: [],
    memberships: [],
    articles: [],
    contacts: [],
    parametres_facturation: [],
  }
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function monter(espace: 'cabinet' | 'client') {
  const commun = {
    dossierId: 'd1', dossierNom: 'Atelier fictif', dossierSiret: SIRET_VENDEUR, dossierAdresse: '1 rue Fictive',
    statutTva: 'redevable' as const, articleExoneration: null, numeroTvaAttribue: false, tvaSurDebits: false,
  }
  const rendu = render(espace === 'client'
    ? <FacturesTab reglageDesVentes={NON_BASCULE} espace="client" banque={false} {...commun} />
    : <FacturesTab reglageDesVentes={NON_BASCULE} espace="cabinet" compteCaisse="530000" onAdresseUpdated={() => {}} {...commun} />)
  await screen.findByText('F2026-0001')
  return rendu
}

const ligneDe = (texte: string) => screen.getAllByRole('row').find((r) => r.textContent?.includes(texte)) as HTMLElement
const lignesBrouillon = () => screen.getAllByRole('row').filter((r) => r.textContent?.includes('Brouillon'))
const empreinte = (html: string) => createHash('sha256').update(html).digest('hex')
const texte = (el: Element) => (el.textContent ?? '').replace(/\s/g, ' ')
const sansMotsDuCabinet = (espace: 'cabinet' | 'client', t: string) => {
  if (espace === 'client') expect(motsDuCabinet(t)).toEqual([])
}
// Le formulaire ouvert sur un brouillon, ses lectures revenues (le bouton de validation n'attend plus).
async function ouvrirLeBrouillon(montant: string) {
  fireEvent.click(lignesBrouillon().find((r) => texte(r).includes(montant)) as HTMLElement)
  await screen.findByRole('button', { name: /Valider la facture/ })
  await vi.waitFor(() => expect(screen.queryByText(/Chargement…/)).toBeNull())
}

// Les empreintes du rendu, drapeau baissé, relevées sur le code d'AVANT l'étape P5b5b (commit 76a3631) : la liste, le
// formulaire ouvert sur le brouillon d'acompte, et la fenêtre d'avoir de l'acompte validé : ceux d'hier, au caractère près.
const RENDU_D_HIER: Record<'cabinet' | 'client', { liste: string; formulaire: string; avoir: string }> = {
  cabinet: {
    liste: '51f14f58c02a81e62f620a95a36048fe84e82a5c1008e367a48d8b6cdb2afd51',
    formulaire: '5f938153030ce6facc034a3eb28e9b96f870afbcd1f46c972be45cfe643e2b53',
    avoir: 'b6d23dda933cc830547c53eef991f437fa764aad65c10fe622a181e17bb46a34',
  },
  client: {
    liste: '3cdf8d0d5eca1201974e36d28f8bc88c99420d729ac2468eb1a6167adcf51c9f',
    formulaire: 'cd81cee349dfcd309ce61f0539874c018e88ce4f296ee3832119e17e6dac4797',
    avoir: '5d35e361293cf020e22efbd286e91c027424be78aec578d13e9453fc712f9135',
  },
}

describe.each(['cabinet', 'client'] as const)('Acompte et finale dans l’onglet des factures — %s', (espace) => {
  it('le drapeau baissé : l’onglet, le formulaire et l’avoir d’hier au caractère près, aucune colonne neuve nommée', async () => {
    const { container } = await monter(espace)
    const liste = empreinte(container.innerHTML)
    await ouvrirLeBrouillon('240,00')
    const formulaire = empreinte(document.body.innerHTML)
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }))
    fireEvent.click(within(ligneDe('F2026-0010')).getByRole('button', { name: 'Avoir' }))
    await screen.findByRole('button', { name: 'Valider l\'avoir' })
    await vi.waitFor(() => expect(screen.queryByText(/Chargement…/)).toBeNull())
    const avoir = empreinte(document.body.innerHTML)
    expect({ liste, formulaire, avoir }).toEqual(RENDU_D_HIER[espace])
    expect(faux.lectures.map((l) => l.table)).not.toContain('devis')
    expect(faux.lectures.map((l) => l.table)).not.toContain('devis_factures')
    expect(faux.lectures.filter((l) => /\b(role|acompte|date_versement_acompte|reprise_facture_id|mode_comptable)\b/.test(l.colonnes))).toEqual([])
  })
})

describe.each(['cabinet', 'client'] as const)('Acompte et finale, drapeau levé — %s', (espace) => {
  beforeEach(() => { faux.acomptes = true })

  it('la marque « Acompte » ou « Finale » sur la ligne, et la recherche qui la trouve', async () => {
    await monter(espace)
    await vi.waitFor(() => expect(within(ligneDe('F2026-0010')).queryByText('Acompte')).not.toBeNull())
    expect(within(ligneDe('F2026-0001')).queryByText('Acompte')).toBeNull()
    expect(lignesBrouillon().filter((r) => within(r).queryByText('Finale'))).toHaveLength(1)
    fireEvent.change(screen.getByPlaceholderText(/Rechercher/), { target: { value: 'facture finale' } })
    expect(screen.getAllByRole('row').slice(1)).toHaveLength(1)
    fireEvent.change(screen.getByPlaceholderText(/Rechercher/), { target: { value: 'acompte' } })
    expect(screen.getAllByRole('row').slice(1).map(texte).every((t) => t.includes('Acompte'))).toBe(true)
    expect(screen.getAllByRole('row').slice(1)).toHaveLength(2)
  })

  it('le brouillon d’un acompte : ses lignes ne se retouchent pas, la date du versement se lit, il repart tel quel', async () => {
    faux.tables.factures_emises.find((f) => f.id === 'fb2')!.date_versement_acompte = '2026-10-03'
    await monter(espace)
    await vi.waitFor(() => expect(lignesBrouillon().some((r) => within(r).queryByText('Acompte'))).toBe(true))
    await ouvrirLeBrouillon('240,00')
    const designation = screen.getByDisplayValue('Acompte de 20 % sur le devis D2026-0002') as HTMLInputElement
    expect(designation.disabled).toBe(true)
    expect(screen.queryByRole('button', { name: '+ Ligne' })).toBeNull()
    expect(screen.queryByRole('button', { name: '✕' })).toBeNull()
    const note = screen.getByText(/Les lignes et les montants d’une facture d’acompte se calculent du devis/)
    sansMotsDuCabinet(espace, texte(note))
    expect(screen.getByText(/acompte versé le 03\/10\/2026/)).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le brouillon' })) })
    const appel = faux.appels.find((a) => a.nom === 'enregistrer_facture')!
    expect(appel.args.p_lignes).toEqual([{
      designation: 'Acompte de 20 % sur le devis D2026-0002', quantite: 1, prix_unitaire_ht: 200, taux_tva: 20, unite: 'C62', reference: null,
      article_id: null, nature: null,
    }])
    expect((appel.args.p_facture as Record<string, unknown>).montant_ttc).toBe(240)
  })

  it('la validation d’un acompte qui dépasse le devis se refuse avant le clic, aux mots de la base', async () => {
    faux.tables.factures_emises = faux.tables.factures_emises.map((f) => (f.id === 'fb2' ? BROUILLON_D_ACOMPTE(1100) : f))
    faux.tables.facture_lignes = faux.tables.facture_lignes.map((l) => (l.id === 'lb1' ? { ...l, prix_unitaire_ht: 1100 } : l))
    await monter(espace)
    await vi.waitFor(() => expect(lignesBrouillon().some((r) => within(r).queryByText('Acompte'))).toBe(true))
    await ouvrirLeBrouillon('1 320,00')
    const refus = refusCumulDesAcomptes('D2026-0002', 20)
    expect(screen.getByText(refus)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Valider la facture' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('la finale : sa reprise montrée et figée, la confirmation qui nomme l’acompte repris et le net, un seul envoi pour deux clics', async () => {
    await monter(espace)
    await vi.waitFor(() => expect(lignesBrouillon().some((r) => within(r).queryByText('Finale'))).toBe(true))
    await ouvrirLeBrouillon('840,00')
    const reprise = screen.getByDisplayValue('Reprise de l’acompte F2026-0010 du 10/10/2026') as HTMLInputElement
    expect(reprise.disabled).toBe(true)
    expect((screen.getByDisplayValue('Mission fictive') as HTMLInputElement).disabled).toBe(false)
    // Une ligne retirable (celle du devis, grisée car seule) et aucune croix sur la reprise.
    expect(screen.getAllByRole('button', { name: '✕' })).toHaveLength(1)
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const valider = screen.getByRole('button', { name: 'Valider la facture' })
    await act(async () => {
      fireEvent.click(valider)
      fireEvent.click(valider)
    })
    const question = confirmer.mock.calls[0][0] as string
    expect(question.replace(/\s/g, ' ')).toContain('C’est la FACTURE FINALE du devis D2026-0001. Elle reprend en déduction l’acompte '
      + 'F2026-0010 du 10/10/2026 (360,00 € TTC) : net à payer 840,00 € TTC.')
    sansMotsDuCabinet(espace, question)
    const appels = faux.appels.filter((a) => a.nom === 'enregistrer_facture')
    expect(appels).toHaveLength(1)
    expect(appels[0].args.p_valider).toBe(true)
    expect((appels[0].args.p_lignes as Record<string, unknown>[])[1]).toMatchObject({ quantite: -1, prix_unitaire_ht: 300, reprise_facture_id: 'fa1' })
  })

  it('la finale d’un devis dont un acompte est en brouillon se refuse avant le clic', async () => {
    faux.tables.devis_factures.push(lienDe('l4', 'dv1', 'fb2', 'acompte'))
    faux.tables.devis_factures = faux.tables.devis_factures.filter((l) => l.id !== 'l3')
    await monter(espace)
    await vi.waitFor(() => expect(lignesBrouillon().some((r) => within(r).queryByText('Finale'))).toBe(true))
    await ouvrirLeBrouillon('840,00')
    expect(screen.getByText(REFUS_FINALE_ACOMPTE_EN_BROUILLON)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Valider la facture' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('l’avoir d’un acompte : refusé tant que la finale validée le reprend, permis une fois la finale créditée en entier', async () => {
    faux.tables.factures_emises = faux.tables.factures_emises.map((f) => (f.id === 'ff1'
      ? FINALE({ numero: 'F2026-0020', statut: 'validee', validated_at: '2026-10-20T09:00:00Z' }) : f))
    await monter(espace)
    await vi.waitFor(() => expect(within(ligneDe('F2026-0010')).queryByText('Acompte')).not.toBeNull())
    fireEvent.click(within(ligneDe('F2026-0010')).getByRole('button', { name: 'Avoir' }))
    const valider = await screen.findByRole('button', { name: 'Valider l\'avoir' }) as HTMLButtonElement
    await vi.waitFor(() => expect(screen.getByText(refusAcompteRepris('F2026-0010', 'F2026-0020'))).toBeTruthy())
    expect(valider.disabled).toBe(true)
    expect((screen.getByDisplayValue('Acompte de 30 % sur le devis D2026-0001') as HTMLInputElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }))
  })

  it('l’avoir d’un acompte dont la finale est créditée en entier : permis, un seul envoi pour deux clics', async () => {
    faux.tables.factures_emises = faux.tables.factures_emises.map((f) => (f.id === 'ff1'
      ? FINALE({ numero: 'F2026-0020', statut: 'validee', validated_at: '2026-10-20T09:00:00Z' }) : f))
    faux.tables.factures_emises.push(base('av1', [{ quantite: 1, prix_unitaire_ht: 1000 }, { quantite: -1, prix_unitaire_ht: 300 }], {
      numero: 'A2026-0001', type: 'avoir', facture_origine_id: 'ff1', date_emission: '2026-10-25', montant_ht: -700, montant_tva: -140, montant_ttc: -840,
    }))
    await monter(espace)
    await vi.waitFor(() => expect(within(ligneDe('F2026-0010')).queryByText('Acompte')).not.toBeNull())
    fireEvent.click(within(ligneDe('F2026-0010')).getByRole('button', { name: 'Avoir' }))
    const valider = await screen.findByRole('button', { name: 'Valider l\'avoir' }) as HTMLButtonElement
    await vi.waitFor(() => expect(valider.disabled).toBe(false))
    sansMotsDuCabinet(espace, texte(screen.getByText(/L’avoir d’une facture d’acompte la crédite en entier/)))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await act(async () => {
      fireEvent.click(valider)
      fireEvent.click(valider)
    })
    const appels = faux.appels.filter((a) => a.nom === 'enregistrer_facture')
    expect(appels).toHaveLength(1)
    expect((appels[0].args.p_lignes as Record<string, unknown>[])).toMatchObject([{ quantite: -1, prix_unitaire_ht: 300 }])
  })

  it('une lecture des acomptes refusée : le bandeau le dit, aucun avoir ni aucun formulaire ne s’offre', async () => {
    faux.refusee = 'devis'
    await monter(espace)
    await screen.findByText(/Les acomptes des devis n'ont pas pu être lus en entier/)
    const avoir = within(ligneDe('F2026-0010')).getByRole('button', { name: 'Avoir' }) as HTMLButtonElement
    expect(avoir.disabled).toBe(true)
    expect((within(ligneDe('F2026-0001')).getByRole('button', { name: 'Avoir' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(lignesBrouillon()[0])
    expect(await screen.findByText(/Les acomptes des devis n’ont pas pu être lus/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Valider la facture' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Enregistrer le brouillon' })).toBeNull()
    expect(faux.appels).toEqual([])
  })
})

// LE MANDAT DE FACTURATION DANS L'ONGLET (étape P4) : le cabinet lit UNE fois le nom du cabinet du dossier (`cabinets.nom` du
// `cabinet_id` du dossier, comme la base le lit en validant) et le passe aux fenêtres, dont la confirmation NOMME la mention que la
// facture imprimera ; refusée, la lecture retient la validation. Le client « Ventes » n'en lit rien. Même monde que ci-dessus.
describe('le mandat de facturation dans l’onglet (P4)', () => {
  beforeEach(() => { faux.acomptes = true })
  const ouvrirLaFinale = async () => {
    await vi.waitFor(() => expect(lignesBrouillon().some((r) => within(r).queryByText('Finale'))).toBe(true))
    await ouvrirLeBrouillon('840,00')
  }

  it('le cabinet : le nom du cabinet DU dossier est lu, et la confirmation de validation nomme la mention', async () => {
    faux.tables.cabinets.push({ id: 'c2', nom: 'Autre Cabinet' })
    await monter('cabinet')
    await ouvrirLaFinale()
    expect(faux.lectures.filter((l) => l.table === 'cabinets')).toEqual([{ table: 'cabinets', colonnes: 'nom' }])
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Valider la facture' })) })
    expect(confirmer.mock.calls[0][0]).toContain('– la mention « Facture établie par Cabinet Fictif au nom et pour le compte de Atelier fictif SAS »')
    expect(confirmer.mock.calls[0][0]).not.toContain('Autre Cabinet')
    expect(faux.appels).toEqual([])
  })

  it('la lecture du cabinet refusée : la validation n’est pas offerte, l’écran le dit, le brouillon s’enregistre', async () => {
    faux.refusee = 'cabinets'
    await monter('cabinet')
    await vi.waitFor(() => expect(lignesBrouillon().some((r) => within(r).queryByText('Finale'))).toBe(true))
    fireEvent.click(lignesBrouillon().find((r) => texte(r).includes('840,00')) as HTMLElement)
    await screen.findByRole('button', { name: /Valider la facture/ })
    expect(await screen.findByText(/Le nom du cabinet, que la facture imprimera comme celui qui l’établit, n’a pas pu être lu/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Valider la facture' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Enregistrer le brouillon' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('le client « Ventes » : ni le cabinet ni le dossier ne sont lus pour le mandat, et la confirmation n’en dit rien', async () => {
    await monter('client')
    await ouvrirLaFinale()
    expect(faux.lectures.map((l) => l.table)).not.toContain('cabinets')
    expect(faux.lectures.filter((l) => l.colonnes === 'cabinet_id')).toEqual([])
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Valider la facture' })) })
    expect(confirmer.mock.calls[0][0]).not.toContain('Facture établie par')
  })
})
