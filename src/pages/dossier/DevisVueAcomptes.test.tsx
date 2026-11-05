import { createHash } from 'node:crypto'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DevisVue from './DevisVue'
import { devis, lienDevisFacture } from '../../test/devis'
import { motsDuCabinet } from '../../lib/espaceVentes'
import { REFUS_ACOMPTE } from '../../lib/acompteDevis'
import { REFUS_ACOMPTE_DE_BIENS } from '../../lib/acomptesDuDevis'

// « FACTURER UN ACOMPTE » ET « FACTURER LE SOLDE » DANS LA VUE « DEVIS » (étape P5b5a), avec la VRAIE vue et un faux client
// qui APPLIQUE les filtres, projette les colonnes demandées et annonce un compte. Ce que ces cas gardent, dans les deux
// espaces : le drapeau baissé, la vue d'hier au caractère près et aucune colonne neuve nommée ; levé, les deux gestes sur un
// devis accepté, leurs refus avant le clic (ceux de la base, le devis de biens, la date du versement), la confirmation qui
// nomme le devis, le client, le TTC exact et la date du versement, l'appel par `facturer_acompte_devis` sous un verrou ;
// une lecture refusée n'offre rien. Données FICTIVES.

const faux = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  lectures: [] as { table: string; colonnes: string }[],
  appels: [] as { nom: string; args: Record<string, unknown> }[],
  refus: null as { message: string } | null,
  // Une colonne que la base ne connaît pas (la production sans la migration) : toute lecture qui la nomme est refusée.
  colonneInconnue: null as string | null,
  acomptes: false,
}))

vi.mock('../../lib/devis', async (original) => ({
  ...(await original<typeof import('../../lib/devis')>()),
  get ACOMPTES_PREVUS() { return faux.acomptes },
  get ENVOI_DES_DEVIS_OFFERT() { return false },
}))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatIn } = await import('../../test/filtresPostgrest')
  type Predicat = (ligne: Record<string, unknown>) => boolean
  return {
    supabase: {
      rpc: async (nom: string, args: Record<string, unknown>) => {
        faux.appels.push({ nom, args })
        await Promise.resolve()
        if (faux.refus) return { data: null, error: faux.refus }
        const d = faux.tables.devis.find((x) => x.id === args.p_devis_id) as Record<string, unknown>
        const neuve = (id: string, acompte: boolean, role: string) => {
          faux.tables.factures_emises.push({
            id, dossier_id: 'd1', numero: null, statut: 'brouillon', type: 'facture', date_emission: '2026-11-04',
            montant_ttc: 1, acompte, facture_origine_id: null,
          })
          faux.tables.devis_factures.push({ ...lienDevisFacture({ id: `df-${id}`, devis_id: String(d.id), facture_id: id, cree_le: '2026-11-04T10:00:00Z' }), role })
          return { data: id, error: null }
        }
        if (nom === 'facturer_acompte_devis') return neuve('f-acompte', true, 'acompte')
        if (nom === 'facturer_devis') return neuve('f-finale', false, 'finale')
        return { data: null, error: { message: `Appel non attendu : ${nom}` } }
      },
      from: (table: string) => {
        if (!(table in faux.tables)) throw new Error(`Table non attendue dans ce test : ${table}`)
        const predicats: Predicat[] = []
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        let liste = '*'
        const partir = () => {
          faux.lectures.push({ table, colonnes: liste })
          const colonnes = liste === '*' ? null : liste.split(',').map((x) => x.trim())
          if (faux.colonneInconnue && colonnes?.includes(faux.colonneInconnue)) {
            return { data: null, error: { message: `column ${faux.colonneInconnue} does not exist` }, count: null }
          }
          const toutes = filtrer(faux.tables[table], predicats)
          const rendu = toutes.slice(debut, fin + 1).map((l) => (colonnes ? Object.fromEntries(colonnes.map((k) => [k, l[k]])) : l))
          return { data: rendu, error: null, count: toutes.length }
        }
        const c: Record<string, unknown> = {}
        Object.assign(c, {
          select: (l?: string) => { liste = l ?? '*'; return c },
          eq: (colonne: string, valeur: unknown) => { predicats.push(predicatEq(colonne, valeur)); return c },
          in: (colonne: string, valeurs: unknown[]) => { predicats.push(predicatIn(colonne, valeurs)); return c },
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

// Trois devis acceptés : un de services sans facture, un de biens, et un d'hier facturé par sa finale (le lien d'hier).
const ACCEPTE = devis({
  id: 'dv5', numero: 'D2026-0004', statut: 'emis', reponse: 'acceptee', date_reponse: '2026-10-25', tiers_nom: 'Accepté Fictif',
  date_emission: '2026-10-15', date_validite: '2026-11-15', cree_le: '2026-10-15T08:00:00Z', nature_operation: 'services',
})
const BIENS = devis({
  id: 'dv6', numero: 'D2026-0005', statut: 'emis', reponse: 'acceptee', date_reponse: '2026-10-26', tiers_nom: 'Biens Fictifs SARL',
  date_emission: '2026-10-16', date_validite: '2026-11-16', cree_le: '2026-10-16T08:00:00Z', nature_operation: 'biens',
})
const FACTURE_HIER = devis({
  id: 'dv4', numero: 'D2026-0003', statut: 'emis', reponse: 'acceptee', date_reponse: '2026-09-10', tiers_nom: 'Facturé Fictif',
  date_emission: '2026-09-05', date_validite: '2026-10-05', emetteur_nom: 'Émetteur Fictif',
})

const FACTURE = (p: Record<string, unknown>) => ({
  id: 'f1', dossier_id: 'd1', numero: 'F2026-0001', statut: 'validee', type: 'facture', date_emission: '2026-10-01',
  montant_ttc: 1200, acompte: false, facture_origine_id: null, ...p,
})
// Un acompte validé de 300,00 € HT à 20 % sur le devis accepté.
const ACOMPTE_VALIDE = FACTURE({ id: 'fa1', numero: 'F2026-0010', date_emission: '2026-10-28', montant_ttc: 360, acompte: true })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-04T11:00:00Z'))
  faux.acomptes = false
  faux.lectures = []
  faux.appels = []
  faux.refus = null
  faux.colonneInconnue = null
  faux.tables = {
    dossiers: [{
      id: 'd1', nom: 'Atelier fictif', siret: '12345678200010', adresse: '1 rue Fictive', forme_juridique: '5710',
      denomination_imprimee: 'Atelier fictif SAS', mode_comptable: 'tresorerie',
    }],
    devis: [ACCEPTE, BIENS, FACTURE_HIER].map((d) => ({ ...d })),
    devis_factures: [{ ...lienDevisFacture({ devis_id: 'dv4' }), role: 'finale' }],
    factures_emises: [FACTURE({})],
    facture_lignes: [],
  }
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function monter(espace: 'cabinet' | 'client') {
  const ouvrir = vi.fn()
  const rendu = render(
    <DevisVue
      espace={espace} dossierId="d1" dossierNom="Atelier fictif" dossierSiret={null} dossierAdresse={null}
      statutTva="redevable" articleExoneration={null} numeroTvaAttribue={false} onOuvrirFacture={ouvrir}
    />,
  )
  const tableau = await screen.findByRole('table', { name: 'Devis' })
  return { ...rendu, tableau, ouvrir }
}

const ligneDe = (tableau: HTMLElement, texte: string) =>
  within(tableau).getAllByRole('row').find((r) => r.textContent?.includes(texte)) as HTMLElement
const boutonsDe = (ligne: HTMLElement) => within(ligne).getAllByRole('button').map((b) => b.textContent)
const sansMotsDuCabinet = (espace: 'cabinet' | 'client', texte: string) => {
  if (espace === 'client') expect(motsDuCabinet(texte)).toEqual([])
}
const empreinte = (html: string) => createHash('sha256').update(html).digest('hex')

// L'empreinte du rendu de la vue, drapeau baissé, relevée sur le code d'AVANT l'étape P5b5a (commit 6c353ca) : la vue
// d'hier, au caractère près.
const RENDU_D_HIER: Record<'cabinet' | 'client', string> = {
  cabinet: '41eb018435c721b7f18e6a0ccdc5ac3d6505a12a55cc665ad39812eb9f0884e5',
  client: '3bf0411e47056a2c05ec2c72b359659a61b5d0dbde08ab8a296e56f272ac697f',
}

describe.each(['cabinet', 'client'] as const)('Acomptes d’un devis — %s', (espace) => {
  it('le drapeau baissé : la vue d’hier au caractère près, aucune colonne neuve nommée, aucune ligne de facture lue', async () => {
    const { container, tableau } = await monter(espace)
    expect(empreinte(container.innerHTML)).toBe(RENDU_D_HIER[espace])
    expect(boutonsDe(ligneDe(tableau, 'D2026-0004'))).toEqual(['Aperçu', 'Transformer en facture'])
    expect(faux.lectures.map((l) => l.table)).not.toContain('facture_lignes')
    expect(faux.lectures.filter((l) => /\b(role|acompte|mode_comptable)\b/.test(l.colonnes))).toEqual([])
  })
})

// Un acompte validé du devis accepté, et ses lignes ; ou un acompte encore en brouillon.
function avecAcompteValide() {
  faux.tables.factures_emises.push({ ...ACOMPTE_VALIDE })
  faux.tables.devis_factures.push({ ...lienDevisFacture({ id: 'df-a1', devis_id: 'dv5', facture_id: 'fa1', cree_le: '2026-10-28T08:00:00Z' }), role: 'acompte' })
  faux.tables.facture_lignes.push({
    id: 'la1', facture_id: 'fa1', ordre: 1, designation: 'Acompte de 30 % sur le devis D2026-0004', quantite: 1,
    prix_unitaire_ht: 300, taux_tva: 20, nature: null,
  })
}
function avecAcompteEnBrouillon() {
  faux.tables.factures_emises.push(FACTURE({ id: 'fb1', numero: null, statut: 'brouillon', montant_ttc: 360, acompte: true }))
  faux.tables.devis_factures.push({ ...lienDevisFacture({ id: 'df-b1', devis_id: 'dv5', facture_id: 'fb1', cree_le: '2026-10-29T08:00:00Z' }), role: 'acompte' })
}

describe.each(['cabinet', 'client'] as const)('Acomptes d’un devis, drapeau levé — %s', (espace) => {
  beforeEach(() => { faux.acomptes = true })

  async function ouvrirLAcompte(numero = 'D2026-0004') {
    const monte = await monter(espace)
    fireEvent.click(within(ligneDe(monte.tableau, numero)).getByRole('button', { name: 'Facturer un acompte' }))
    return { ...monte, fenetre: screen.getByRole('dialog') }
  }
  const saisir = (fenetre: HTMLElement, libelle: string | RegExp, valeur: string) =>
    fireEvent.change(within(fenetre).getByLabelText(libelle), { target: { value: valeur } })
  const facturer = (fenetre: HTMLElement) => within(fenetre).getByRole('button', { name: 'Facturer l’acompte' }) as HTMLButtonElement
  const texte = (el: HTMLElement) => (el.textContent ?? '').replace(/\s/g, ' ')

  it('un devis accepté offre l’acompte et le solde, plus « Transformer en facture » ; la finale d’hier le dit facturé', async () => {
    const { tableau } = await monter(espace)
    expect(boutonsDe(ligneDe(tableau, 'D2026-0004'))).toEqual(['Aperçu', 'Facturer un acompte', 'Facturer le solde'])
    const hier = ligneDe(tableau, 'D2026-0003')
    expect(hier.textContent).toContain('Facturé')
    expect(boutonsDe(hier)).toEqual(['Aperçu'])
    expect(within(hier).getByText('F2026-0001')).toBeTruthy()
    // Les colonnes neuves, nommées drapeau levé seulement.
    expect(faux.lectures.some((l) => l.table === 'devis_factures' && l.colonnes.includes('role'))).toBe(true)
    expect(faux.lectures.some((l) => l.table === 'factures_emises' && l.colonnes.includes('acompte'))).toBe(true)
  })

  it('un acompte tiré : le TTC exact avant le clic, la date du versement à venir refusée, la confirmation nomme ce qui part', async () => {
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { fenetre, tableau } = await ouvrirLAcompte()
    // Rien de saisi : le refus de la base, avant le clic.
    expect(within(fenetre).getByText(REFUS_ACOMPTE.pourcentageHorsBornes)).toBeTruthy()
    expect(facturer(fenetre).disabled).toBe(true)
    saisir(fenetre, 'Pourcentage du devis (%)', '30')
    expect(texte(within(fenetre).getByLabelText('L’acompte calculé'))).toContain('360,00 € TTC exactement (300,00 € HT, 60,00 € de TVA)')
    saisir(fenetre, 'Date du versement (facultative)', '2026-11-05')
    expect(within(fenetre).getByText('Le versement ne se date pas dans l’avenir : nous sommes le 04/11/2026.')).toBeTruthy()
    expect(facturer(fenetre).disabled).toBe(true)
    saisir(fenetre, 'Date du versement (facultative)', '2026-11-02')
    expect(facturer(fenetre).disabled).toBe(false)
    fireEvent.click(facturer(fenetre))
    const dit = (confirmer.mock.calls[0][0] as string).replace(/\s/g, ' ')
    expect(dit).toContain('Facturer un acompte (30 % du devis) sur le devis D2026-0004 pour « Accepté Fictif »')
    expect(dit).toContain('360,00 € TTC exactement')
    expect(dit).toContain('versé le 02/11/2026')
    sansMotsDuCabinet(espace, dit)
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(faux.appels).toEqual([{
      nom: 'facturer_acompte_devis',
      args: { p_dossier_id: 'd1', p_devis_id: 'dv5', p_demande: { mode: 'pourcentage', pourcentage: 30 }, p_date_versement: '2026-11-02' },
    }])
    expect(texte(screen.getByRole('status'))).toBe('Brouillon de facture d’acompte tiré du devis D2026-0004 : 360,00 € TTC.')
    // Relue : l'acompte en brouillon dit, le devis reste accepté.
    const ligne = ligneDe(tableau, 'D2026-0004')
    expect(ligne.textContent).toContain('Acompte en brouillon')
    expect(ligne.textContent).toContain('Accepté')
  })

  it('un montant TTC : le plus proche du TTC demandé, rendu exact ; sans date, aucune date ne part', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { fenetre } = await ouvrirLAcompte()
    fireEvent.click(within(fenetre).getByLabelText('Un montant TTC'))
    saisir(fenetre, 'Montant TTC (€)', '100,001')
    expect(within(fenetre).getByText(REFUS_ACOMPTE.montantTropPrecis)).toBeTruthy()
    saisir(fenetre, 'Montant TTC (€)', '100')
    expect(texte(within(fenetre).getByLabelText('L’acompte calculé'))).toContain('100,00 € TTC exactement (83,33 € HT')
    fireEvent.click(facturer(fenetre))
    await vi.waitFor(() => expect(faux.appels).toHaveLength(1))
    expect(faux.appels[0].args).toMatchObject({ p_demande: { mode: 'ttc', ttcCentimes: 10000 }, p_date_versement: null })
  })

  it('les refus avant le clic : tout le devis, un devis de biens, un acompte en brouillon, l’engagement', async () => {
    const { fenetre, unmount } = await ouvrirLAcompte()
    saisir(fenetre, 'Pourcentage du devis (%)', '100')
    expect(within(fenetre).getByText(REFUS_ACOMPTE.couvreToutLeDevis)).toBeTruthy()
    expect(facturer(fenetre).disabled).toBe(true)
    unmount()

    const biens = await ouvrirLAcompte('D2026-0005')
    expect(within(biens.fenetre).getByText(REFUS_ACOMPTE_DE_BIENS)).toBeTruthy()
    expect(facturer(biens.fenetre).disabled).toBe(true)
    biens.unmount()

    avecAcompteEnBrouillon()
    const brouillon = await ouvrirLAcompte()
    const attendu = espace === 'client'
      ? 'Un acompte de ce devis est encore en brouillon : valide-le ou supprime-le avant d’en tirer un autre.'
      : REFUS_ACOMPTE.acompteEnBrouillon
    expect(within(brouillon.fenetre).getByText(attendu)).toBeTruthy()
    brouillon.unmount()

    faux.tables.factures_emises = faux.tables.factures_emises.filter((f) => f.id !== 'fb1')
    faux.tables.devis_factures = faux.tables.devis_factures.filter((l) => l.id !== 'df-b1')
    faux.tables.dossiers[0].mode_comptable = 'engagement'
    const engagement = await ouvrirLAcompte()
    expect(within(engagement.fenetre).getByText(REFUS_ACOMPTE.engagement)).toBeTruthy()
    expect(faux.appels).toEqual([])
  })

  it('deux clics du même act sur « Facturer l’acompte » n’appellent qu’une fois ; le refus de la base se dit dans la fenêtre', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    faux.refus = { message: 'Le devis a déjà sa facture finale : il ne s’en tire plus d’acompte.' }
    const { fenetre } = await ouvrirLAcompte()
    saisir(fenetre, 'Pourcentage du devis (%)', '30')
    const lectures = faux.lectures.filter((l) => l.table === 'devis').length
    act(() => {
      fireEvent.click(facturer(fenetre))
      fireEvent.click(facturer(fenetre))
    })
    expect(await within(fenetre).findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe('Le devis a déjà sa facture finale : il ne s’en tire plus d’acompte.')
    expect(faux.appels.map((a) => a.nom)).toEqual(['facturer_acompte_devis'])
    // Relue après le refus, puis le verrou relâché.
    expect(faux.lectures.filter((l) => l.table === 'devis').length).toBe(lectures + 1)
  })

  it('une lecture refusée (la colonne de la marque inconnue) : le bandeau, et aucun geste', async () => {
    faux.colonneInconnue = 'acompte'
    const { tableau } = await monter(espace)
    const bandeau = screen.getByText(/Aucun geste n’est donc offert/)
    // Le motif technique, au cabinet en clair, au client dans l'infobulle.
    const motif = espace === 'cabinet' ? bandeau.textContent : bandeau.getAttribute('title')
    expect(motif).toContain('les factures du dossier n’ont pas été lues en entier')
    expect(within(tableau).queryByRole('button', { name: 'Facturer un acompte' })).toBeNull()
    expect(within(tableau).queryByRole('button', { name: 'Facturer le solde' })).toBeNull()
    expect(screen.queryByRole('button', { name: '+ Nouveau devis' })).toBeNull()
  })

  it('le solde : la confirmation nomme l’acompte repris et le net ; la finale tirée s’ouvre, le devis est facturé', async () => {
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(true)
    avecAcompteValide()
    const { tableau, ouvrir } = await monter(espace)
    expect(ligneDe(tableau, 'D2026-0004').textContent).toContain('Acompte F2026-0010')
    fireEvent.click(within(ligneDe(tableau, 'D2026-0004')).getByRole('button', { name: 'Facturer le solde' }))
    const dit = (confirmer.mock.calls[0][0] as string).replace(/\s/g, ' ')
    expect(dit).toContain('Facturer le solde du devis D2026-0004 pour « Accepté Fictif » (1 200,00 € TTC)')
    expect(dit).toContain('l’acompte F2026-0010 du 28/10/2026 (360,00 € TTC), repris au signe opposé : net à payer 840,00 € TTC.')
    sansMotsDuCabinet(espace, dit)
    await vi.waitFor(() => expect(ouvrir).toHaveBeenCalledWith('f-finale'))
    expect(faux.appels).toEqual([{ nom: 'facturer_devis', args: { p_dossier_id: 'd1', p_devis_id: 'dv5' } }])
    const ligne = ligneDe(screen.getByRole('table', { name: 'Devis' }), 'D2026-0004')
    expect(ligne.textContent).toContain('Facturé')
    expect(ligne.textContent).toContain('Acompte F2026-0010 ; Finale Brouillon de facture')
  })

  it('le solde sous un acompte en brouillon : le refus de la base, sans appel', async () => {
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(true)
    avecAcompteEnBrouillon()
    const { tableau } = await monter(espace)
    fireEvent.click(within(ligneDe(tableau, 'D2026-0004')).getByRole('button', { name: 'Facturer le solde' }))
    expect(screen.getByRole('alert').textContent).toBe(espace === 'client'
      ? 'Un acompte de ce devis est encore en brouillon : valide-le ou supprime-le avant d’en tirer la facture finale.'
      : 'Un acompte de ce devis est encore en brouillon : validez-le ou supprimez-le avant d’en tirer la facture finale.')
    expect(confirmer).not.toHaveBeenCalled()
    expect(faux.appels).toEqual([])
  })
})
