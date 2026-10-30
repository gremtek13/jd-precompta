import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CaisseTab from './CaisseTab'
import type { ValeurAnnee } from '../../components/AnneeTabs'
import { ecritureDeLOperation } from '../../lib/caisse'
import type { DonneesDeLaCaisse } from '../../lib/caisseEcran'
import type { LectureDeLaCaisseDuDossier } from '../../lib/caisseDuDossierLecture'
import type { ModeleComptable } from '../../lib/engagement'
import { PLAN_PAR_DEFAUT } from '../../lib/planComptable'
import type { Categorie, OperationCaisse } from '../../lib/types'
import { ContexteDossier } from '../../test/exercicesValides'

// L'ONGLET CAISSE, CÔTÉ CABINET (ligne 26.6, étape C4). Ce que ces cas gardent : rien avant le retour de la lecture ; la caisse
// jour par jour et son solde, les espèces des factures (lues, sans geste), l'origine d'une opération ; la lecture partielle qui
// le dit et n'offre AUCUN geste ; la saisie d'une opération telle qu'elle PART à la base (l'écriture que compose le module, l'ensemble
// du jour reconnu), son refus dit AVANT le clic sous les mots de la base ; la saisie d'un mois, tout ou rien ; le retrait (une
// confirmation qui NOMME ce qui part) et le remplacement ; un verrou qui ne laisse partir qu'un geste pour deux clics dans le même
// `act` ; un `{ error }` lu et dit ; une lecture refaite après chaque geste ; un dossier quitté qui ne laisse rien derrière lui.
// La lecture est doublée (elle est éprouvée à part, lib/caisseDuDossierLecture.test.ts) ; la base est un faux `rpc` qui applique ce
// que ses fonctions font. Des jeux FICTIFS, et un jour fixe : le 29/10/2026.

const D = 'dossier-1'
const HONORAIRES_ID = '00000000-0000-4000-8000-0000000000a1'
const LOYER_ID = '00000000-0000-4000-8000-0000000000a2'
const E1 = '00000000-0000-4000-8000-0000000000e1'
const CAISSE = PLAN_PAR_DEFAUT.caisse

const faux = vi.hoisted(() => ({
  donnees: null as null | DonneesDeLaCaisse,
  // La réponse de la lecture : l'état tel que le module le rend, pour le dossier demandé.
  reponse: null as null | ((dossierId: string) => LectureDeLaCaisseDuDossier),
  // Retient la réponse de la lecture jusqu'à `relacher()`.
  retenue: null as null | Promise<void>,
  relacher: null as null | (() => void),
  demandes: [] as string[],
  rpcs: [] as { nom: string; args: Record<string, unknown> }[],
  // La réponse de la base au prochain appel : un refus en clair, ou rien.
  refus: null as string | null,
  // Retient l'appel à la base lui-même : le geste est alors EN COURS d'écriture.
  retenirRpc: false,
  relacherRpc: null as null | (() => void),
  compteur: 0,
}))

vi.mock('../../lib/caisseDuDossierLecture', () => ({
  lireLaCaisseDuDossier: (dossierId: string) => {
    faux.demandes.push(dossierId)
    const rendre = () => (faux.reponse ? faux.reponse(dossierId) : { dossierId, etat: 'lue' as const, donnees: faux.donnees! })
    return faux.retenue ? faux.retenue.then(rendre) : Promise.resolve(rendre())
  },
}))

vi.mock('../../lib/supabase', () => {
  function appliquer(nom: string, args: Record<string, unknown>) {
    const d = faux.donnees!
    const nouvelle = (a: Record<string, unknown>, remplace: string | null): OperationCaisse => ({
      id: `n${++faux.compteur}`, dossier_id: D, genre: a.p_genre as OperationCaisse['genre'], date: a.p_date as string, montant: a.p_montant as number,
      categorie_id: (a.p_categorie_id as string | null) ?? null, taux_tva: (a.p_taux_tva as number | null) ?? null,
      encaissements_du_jour: (a.p_encaissements_du_jour as string[] | null) ?? null, piece_id: null, origine: 'cabinet', remplace_id: remplace,
      cree_le: '2026-10-29T08:00:00Z', cree_par: 'u', retire_le: null, retire_par: null,
    })
    if (nom === 'enregistrer_operation_caisse') faux.donnees = { ...d, operations: [...d.operations, nouvelle(args, null)] }
    if (nom === 'enregistrer_operations_de_caisse') {
      faux.donnees = { ...d, operations: [...d.operations, ...(args.p_operations as Record<string, unknown>[]).map((o) => nouvelle({
        p_genre: o.genre, p_date: o.date, p_montant: o.montant, p_categorie_id: o.categorie_id, p_taux_tva: o.taux_tva, p_encaissements_du_jour: o.encaissements_du_jour,
      }, null))] }
    }
    if (nom === 'retirer_operation_caisse') {
      faux.donnees = { ...d, operations: d.operations.map((o) => (o.id === args.p_operation_id ? { ...o, retire_le: '2026-10-29T09:00:00Z' } : o)) }
    }
    if (nom === 'remplacer_operation_caisse') {
      faux.donnees = { ...d, operations: [...d.operations.map((o) => (o.id === args.p_operation_id ? { ...o, retire_le: '2026-10-29T09:00:00Z' } : o)), nouvelle(args, args.p_operation_id as string)] }
    }
  }
  function executer(nom: string, args: Record<string, unknown>): Promise<{ data: null; error: { message: string } | null }> {
    faux.rpcs.push({ nom, args })
    if (faux.refus) return Promise.resolve({ data: null, error: { message: faux.refus } })
    appliquer(nom, args)
    return Promise.resolve({ data: null, error: null })
  }
  return {
    supabase: {
      rpc: (nom: string, args: Record<string, unknown>) => {
        if (faux.retenirRpc) {
          faux.retenirRpc = false
          return new Promise<void>((r) => { faux.relacherRpc = r }).then(() => executer(nom, args))
        }
        return executer(nom, args)
      },
    },
  }
})

const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '455000', plan: PLAN_PAR_DEFAUT }
const ENGAGEMENT: ModeleComptable = { mode: 'engagement', compteNotesDeFrais: '455000', plan: PLAN_PAR_DEFAUT }

const HONORAIRES: Categorie = { id: HONORAIRES_ID, dossier_id: null, code: 'honoraires', libelle: 'Honoraires', ordre: 1, compte_comptable: '706000', poste_2035: 'Recettes' }
const LOYER: Categorie = { id: LOYER_ID, dossier_id: D, code: 'loyer', libelle: 'Loyer', ordre: 2, compte_comptable: '613200', poste_2035: 'Loyers' }

function operation(o: Partial<OperationCaisse> & Pick<OperationCaisse, 'id'>): OperationCaisse {
  return {
    dossier_id: D, genre: 'apport', date: '2026-03-01', montant: 100, categorie_id: null, taux_tva: null, encaissements_du_jour: null,
    piece_id: null, origine: 'cabinet', remplace_id: null, cree_le: '2026-03-01T08:00:00Z', cree_par: 'u', retire_le: null, retire_par: null, ...o,
  }
}

// Mars 2026 : 50 € d'ouverture, un apport de 100 € le 1er, une recette de 85 € le 3, un prélèvement de 40 € le 4, un versement
// en banque de 120 € le 5 — et 30 € d'espèces d'une facture source le 10. Solde : 105 €. Plus une recette de 2025.
function mars(o: Partial<DonneesDeLaCaisse> = {}): DonneesDeLaCaisse {
  return {
    operations: [
      operation({ id: 'o1', genre: 'apport', date: '2026-03-01', montant: 100 }),
      operation({ id: 'o2', genre: 'recette', date: '2026-03-03', montant: 85, categorie_id: HONORAIRES_ID, encaissements_du_jour: [] }),
      operation({ id: 'o3', genre: 'prelevement', date: '2026-03-04', montant: 40 }),
      operation({ id: 'o0', genre: 'recette', date: '2025-06-10', montant: 20, categorie_id: HONORAIRES_ID, encaissements_du_jour: [] }),
    ],
    ouvertures: [{
      id: 'a1', dossier_id: D, date: '2025-01-01', compte: CAISSE, compte_origine: '530', libelle: 'Caisse', sens: 'debit', montant: 30,
      source_nom: 'balance.csv', source_empreinte: 'x', created_at: '2025-01-01T00:00:00Z', compte_lib: null, ecriture_lib: null,
    }],
    mouvements: [{ id: 'm1', date: '2026-03-05', montant: 120, libelle: 'VERSEMENT ESPECES', compte_bilan: CAISSE }],
    especes: {
      etat: 'lues',
      encaissements: [{ id: E1, facture_id: 'f1', date_encaissement: '2026-03-10', montant: 30, moyen: 'especes', ligne_bancaire_id: null, annule_id: null, retire_le: null }],
      factures: [{ id: 'f1', numero: 'F-2026-0012', source_de_la_vente: true }],
    },
    categories: [HONORAIRES, LOYER],
    ...o,
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-29T10:00:00Z'))
  faux.donnees = mars()
  faux.reponse = null
  faux.retenue = null
  faux.relacher = null
  faux.demandes = []
  faux.rpcs = []
  faux.refus = null
  faux.retenirRpc = false
  faux.relacherRpc = null
  faux.compteur = 0
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })

function rendre(o: { dossierId?: string; modele?: ModeleComptable; assujettiTva?: boolean; ventes?: boolean; annee?: ValeurAnnee; onNavigate?: () => void } = {}) {
  const vue = (p: { dossierId?: string }) => (
    <ContexteDossier annee={o.annee ?? 2026} valides={[]}>
      <CaisseTab
        dossierId={p.dossierId ?? o.dossierId ?? D} modele={o.modele ?? TRESORERIE} assujettiTva={o.assujettiTva ?? false}
        ventesParLesFactures={o.ventes ?? true} onNavigate={o.onNavigate ?? (() => {})}
      />
    </ContexteDossier>
  )
  const r = render(vue({}))
  return { ...r, versDossier: (dossierId: string) => r.rerender(vue({ dossierId })) }
}

const sans = (s: string | null) => (s ?? '').replace(/[  ]/g, ' ')
const texte = () => sans(document.body.textContent)
async function attendreLaLecture() { await screen.findByText(/Solde de la caisse/) }
function remplirLeFormulaire(o: { nature?: string; date?: string; montant?: string; categorie?: string; taux?: string }) {
  if (o.nature) fireEvent.change(screen.getByLabelText('Nature'), { target: { value: o.nature } })
  if (o.date) fireEvent.change(screen.getByLabelText('Jour'), { target: { value: o.date } })
  if (o.categorie) fireEvent.change(screen.getByLabelText('Catégorie de produit'), { target: { value: o.categorie } })
  if (o.taux) fireEvent.change(screen.getByLabelText('Taux de TVA'), { target: { value: o.taux } })
  if (o.montant) fireEvent.change(screen.getByLabelText(/^Montant/), { target: { value: o.montant } })
}
// La ligne du journal dont la nature dit ceci — une cellule du tableau, jamais l'option d'une liste du formulaire qui porte le même mot.
const ligneDeLaCaisse = (re: RegExp) => {
  const cellule = [...document.querySelectorAll('tbody td[data-libelle="Nature"]')].find((td) => re.test(td.textContent ?? ''))
  if (!cellule) throw new Error(`Aucune ligne de la caisse ne dit ${re}`)
  return cellule.closest('tr') as HTMLElement
}
// Un bouton du formulaire de saisie d'abord (« Remplacer » y est aussi le geste d'une ligne du journal), sinon de la page.
const bouton = (nom: string | RegExp) => {
  const formulaire = screen.queryByRole('form', { name: 'Saisie d’une opération' })
  const dedans = formulaire ? within(formulaire).queryAllByRole('button', { name: nom }) : []
  return (dedans.length === 1 ? dedans[0] : screen.getByRole('button', { name: nom })) as HTMLButtonElement
}

describe('rien avant le retour de la lecture', () => {
  it('retenue : « Chargement… », ni formulaire, ni total, ni geste ; revenue, l’onglet se montre', async () => {
    faux.retenue = new Promise<void>((r) => { faux.relacher = r })
    rendre()
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/Solde de la caisse|Saisir une opération|Aucune opération/)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(faux.demandes).toEqual([D])
    await act(async () => { faux.relacher!() })
    await attendreLaLecture()
    expect(screen.queryByText('Chargement…')).toBeNull()
    expect(screen.getByText('Saisir une opération')).toBeTruthy()
  })

  it('un dossier en comptabilité d’engagement : la phrase, aucune lecture, aucun geste', () => {
    rendre({ modele: ENGAGEMENT })
    expect(screen.getByText('La caisse ne se tient qu’en comptabilité de trésorerie.')).toBeTruthy()
    expect(faux.demandes).toEqual([])
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(document.body.textContent).not.toMatch(/Saisir une opération|Solde de la caisse/)
  })
})

describe('la lecture partielle, refusée ou rompue', () => {
  it('incomplète : le bandeau dit pourquoi, et rien ne se calcule ni ne s’offre — ni formulaire, ni total, ni tableau, ni geste', async () => {
    faux.reponse = (dossierId) => ({ dossierId, etat: 'incomplete', motif: 'les opérations de la caisse : 500 lignes lues sur 900' })
    rendre()
    await screen.findByText(/La caisse du dossier n'a pas pu être lue en entier \(les opérations de la caisse : 500 lignes lues sur 900\)/)
    expect(document.body.textContent).not.toMatch(/Solde de la caisse|Saisir|Aucune opération/)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(document.querySelector('table')).toBeNull()
  })

  it('absente (la caisse n’est pas en base) : une phrase, aucun geste', async () => {
    faux.reponse = (dossierId) => ({ dossierId, etat: 'absente' })
    rendre()
    await screen.findByText(/La caisse n’est pas encore en base/)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('d’un autre dossier : l’écran attend sa propre lecture', async () => {
    faux.reponse = () => ({ dossierId: 'autre', etat: 'lue', donnees: faux.donnees! })
    rendre()
    await act(async () => {})
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/Solde de la caisse/)
  })
})

describe('la caisse jour par jour', () => {
  it('chaque jour, son solde en fin de journée ; chaque ligne, sa nature et ce qu’elle apporte ou retire', async () => {
    rendre()
    await attendreLaLecture()
    const jours = [...document.querySelectorAll('tr.caisse-jour')].map((tr) => sans(tr.textContent))
    expect(jours).toEqual([
      '01/03/2026 — solde de la caisse en fin de journée : 150,00 €',
      '03/03/2026 — solde de la caisse en fin de journée : 235,00 €',
      '04/03/2026 — solde de la caisse en fin de journée : 195,00 €',
      '05/03/2026 — solde de la caisse en fin de journée : 75,00 €',
      '10/03/2026 — solde de la caisse en fin de journée : 105,00 €',
    ])
    const lignes = [...document.querySelectorAll('tbody tr:not(.caisse-jour)')].map((tr) => [...tr.querySelectorAll('td')].slice(0, 3).map((td) => sans(td.textContent)))
    expect(lignes).toEqual([
      ['Apport en caisse de l’exploitant', '100,00 €', ''],
      ['Recettes en espèces — Honoraires', '85,00 €', ''],
      ['Prélèvement en espèces de l’exploitant', '', '40,00 €'],
      ['Versement en banque — VERSEMENT ESPECES', '', '120,00 €'],
      ['Espèces reçues pour la facture F-2026-0012 Comptée par la facture', '30,00 €', ''],
    ])
  })

  it('le solde et les totaux de l’exercice affiché, et ceux de la fin de l’exercice précédent', async () => {
    const { unmount } = rendre({ annee: 2026 })
    await attendreLaLecture()
    expect(texte()).toMatch(/Solde de la caisse à la fin de 2026\s*105,00 €/)
    expect(texte()).toMatch(/Recettes en espèces\s*85,00 €/)
    expect(texte()).toMatch(/Prélèvements de l’exploitant\s*40,00 €/)
    expect(texte()).toMatch(/Versements en banque\s*120,00 €/)
    unmount()
    rendre({ annee: 2025 })
    await attendreLaLecture()
    // 30 € d'ouverture, 20 € de recette : 50 € à la fin de 2025 ; les jours de 2026 ne sont pas montrés.
    expect(texte()).toMatch(/Solde de la caisse à la fin de 2025\s*50,00 €/)
    expect([...document.querySelectorAll('tr.caisse-jour')].map((tr) => sans(tr.textContent))).toEqual([
      '01/01/2025 — solde de la caisse en fin de journée : 30,00 €',
      '10/06/2025 — solde de la caisse en fin de journée : 50,00 €',
    ])
    expect(texte()).toMatch(/Recettes en espèces\s*20,00 €/)
  })

  it('toutes les années : le solde de la caisse aujourd’hui, tous les jours', async () => {
    rendre({ annee: 'toutes' })
    await attendreLaLecture()
    expect(screen.getByText('Solde de la caisse')).toBeTruthy()
    expect(texte()).toMatch(/Solde de la caisse\s*105,00 €/)
    expect(document.querySelectorAll('tr.caisse-jour')).toHaveLength(7)
  })

  it('les espèces des factures se lisent sans geste ; une opération du cabinet n’est pas marquée, une opération du client l’est', async () => {
    faux.donnees = mars({
      operations: [
        operation({ id: 'c1', genre: 'apport', date: '2026-03-02', montant: 10, origine: 'client' }),
        operation({ id: 'c2', genre: 'apport', date: '2026-03-03', montant: 10, origine: 'client', remplace_id: 'c0' }),
        operation({ id: 'k1', genre: 'apport', date: '2026-03-04', montant: 10 }),
      ],
    })
    rendre()
    await attendreLaLecture()
    const ligneDe = (re: RegExp) => screen.getAllByText(re).map((e) => e.closest('tr') as HTMLElement)
    const ligneFacture = ligneDe(/Espèces reçues pour la facture F-2026-0012/)[0]
    expect(within(ligneFacture).queryAllByRole('button')).toHaveLength(0)
    const marques = [...document.querySelectorAll('.badge')].map((b) => b.textContent)
    expect(marques.filter((m) => m === 'saisie par le client')).toHaveLength(1)
    expect(marques.filter((m) => m === 'remplacée par le client')).toHaveLength(1)
    // Trois apports ce mois-ci, dont deux du client : le cabinet n'en est marqué qu'en creux.
    expect(document.querySelectorAll('tbody tr:not(.caisse-jour)').length).toBeGreaterThanOrEqual(4)
  })

  it('une catégorie qui n’est pas lue ne fait pas tomber la ligne : elle le dit', async () => {
    faux.donnees = mars({ categories: [] })
    rendre()
    await attendreLaLecture()
    expect(texte()).toContain('Recettes en espèces — catégorie non lue')
  })

  it('un exercice sans opération : le vide se dit, après la lecture', async () => {
    faux.donnees = mars({ operations: [], ouvertures: [], mouvements: [], especes: { etat: 'sans_objet' } })
    rendre()
    await attendreLaLecture()
    expect(screen.getByText('Aucune opération dans la caisse pour cet exercice.')).toBeTruthy()
    expect(texte()).toMatch(/Solde de la caisse à la fin de 2026\s*0,00 €/)
  })

  it('« Ouvrir Banque » mène au relevé, où se classe un versement d’espèces', async () => {
    const onNavigate = vi.fn()
    rendre({ onNavigate })
    await attendreLaLecture()
    fireEvent.click(bouton('Ouvrir Banque'))
    expect(onNavigate).toHaveBeenCalledWith('banque')
  })

  it('la recherche filtre les lignes affichées, jamais un total', async () => {
    rendre()
    await attendreLaLecture()
    fireEvent.change(screen.getByPlaceholderText(/Rechercher un jour/), { target: { value: 'prélèvement' } })
    expect([...document.querySelectorAll('tbody tr:not(.caisse-jour)')].map((tr) => sans(tr.querySelector('td')?.textContent ?? null))).toEqual(['Prélèvement en espèces de l’exploitant'])
    expect(texte()).toMatch(/Solde de la caisse à la fin de 2026\s*105,00 €/)
    expect(texte()).toMatch(/Recettes en espèces\s*85,00 €/)
    fireEvent.change(screen.getByPlaceholderText(/Rechercher un jour/), { target: { value: 'zzz' } })
    expect(screen.getByText(/Aucune ligne de la caisse ne correspond à « zzz »/)).toBeTruthy()
  })
})

describe('saisir une opération', () => {
  it('une recette : la saisie part telle que le module la compose — son écriture, son ensemble du jour — et la caisse est relue', async () => {
    rendre()
    await attendreLaLecture()
    expect(bouton('Enregistrer').disabled).toBe(true)
    remplirLeFormulaire({ date: '2026-03-12', categorie: HONORAIRES_ID, montant: '85,50' })
    expect(bouton('Enregistrer').disabled).toBe(false)
    expect(screen.queryByRole('alert')).toBeNull()
    await act(async () => { bouton('Enregistrer').click() })
    expect(faux.rpcs).toEqual([{
      nom: 'enregistrer_operation_caisse',
      args: {
        p_dossier_id: D, p_genre: 'recette', p_date: '2026-03-12', p_montant: 85.5, p_categorie_id: HONORAIRES_ID, p_taux_tva: null,
        p_encaissements_du_jour: [],
        p_ecritures: ecritureDeLOperation({ genre: 'recette', date: '2026-03-12', montant: 85.5, taux_tva: null, categorie: HONORAIRES }, TRESORERIE),
      },
    }])
    // La caisse est relue : la nouvelle recette est dans le journal, et le message le dit.
    await waitFor(() => expect(faux.demandes).toEqual([D, D]))
    await waitFor(() => expect(texte()).toContain('12/03/2026 — solde de la caisse en fin de journée : 190,50 €'))
    expect(screen.getByRole('status').textContent).toBe('Opération enregistrée le 12/03/2026.')
    // Le formulaire repart vide, au même jour et à la même nature : la saisie suivante est celle du même brouillard.
    expect((screen.getByLabelText(/^Montant/) as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Jour') as HTMLInputElement).value).toBe('2026-03-12')
  })

  it('un dossier assujetti : le taux se choisit, et part avec la saisie — le hors taxe et la TVA dans l’écriture', async () => {
    rendre({ assujettiTva: true })
    await attendreLaLecture()
    remplirLeFormulaire({ date: '2026-03-12', categorie: HONORAIRES_ID, montant: '120' })
    // Sans taux, la base refuse, et le dit avant le clic.
    expect(screen.getByRole('alert').textContent).toBe('Sur un dossier assujetti à la TVA, une recette porte son taux : choisis-le, ou « exonérée ».')
    expect(bouton('Enregistrer').disabled).toBe(true)
    remplirLeFormulaire({ taux: '20' })
    expect(screen.queryByRole('alert')).toBeNull()
    await act(async () => { bouton('Enregistrer').click() })
    const ecritures = faux.rpcs[0].args.p_ecritures
    expect(ecritures).toEqual(ecritureDeLOperation({ genre: 'recette', date: '2026-03-12', montant: 120, taux_tva: 20, categorie: HONORAIRES }, TRESORERIE))
    expect(faux.rpcs[0].args.p_taux_tva).toBe(20)
  })

  it('un dossier qui n’est pas assujetti ne propose aucun taux', async () => {
    rendre({ assujettiTva: false })
    await attendreLaLecture()
    expect(screen.queryByLabelText('Taux de TVA')).toBeNull()
  })

  it('un apport et un prélèvement : ni catégorie ni taux, et leur écriture face au compte de l’exploitant', async () => {
    rendre({ assujettiTva: true })
    await attendreLaLecture()
    remplirLeFormulaire({ nature: 'apport', date: '2026-03-12', montant: '60' })
    expect(screen.queryByLabelText('Catégorie de produit')).toBeNull()
    expect(screen.queryByLabelText('Taux de TVA')).toBeNull()
    await act(async () => { bouton('Enregistrer').click() })
    expect(faux.rpcs[0]).toEqual({
      nom: 'enregistrer_operation_caisse',
      args: {
        p_dossier_id: D, p_genre: 'apport', p_date: '2026-03-12', p_montant: 60, p_categorie_id: null, p_taux_tva: null, p_encaissements_du_jour: null,
        p_ecritures: ecritureDeLOperation({ genre: 'apport', date: '2026-03-12', montant: 60, taux_tva: null, categorie: null }, TRESORERIE),
      },
    })
  })

  it('le formulaire d’une recette NOMME les espèces des factures de son jour qu’il ne compte pas, et la saisie les reconnaît', async () => {
    rendre()
    await attendreLaLecture()
    remplirLeFormulaire({ date: '2026-03-10', categorie: HONORAIRES_ID, montant: '200' })
    expect(texte()).toContain('Les 30,00 € de la facture F-2026-0012, reçus ce jour-là, sont déjà dans la caisse : ce total ne les compte pas.')
    await act(async () => { bouton('Enregistrer').click() })
    expect(faux.rpcs[0].args.p_encaissements_du_jour).toEqual([E1])
    // Un jour sans espèces de facture : rien à nommer.
    remplirLeFormulaire({ date: '2026-03-11' })
    expect(texte()).not.toContain('sont déjà dans la caisse')
  })

  it('le refus se dit AVANT le clic, sous les mots de la base : le jour où la caisse passerait sous zéro', async () => {
    rendre()
    await attendreLaLecture()
    remplirLeFormulaire({ nature: 'prelevement', date: '2026-03-01', montant: '500' })
    const alerte = screen.getByRole('alert')
    expect(sans(alerte.textContent)).toBe(
      'Ce prélèvement de 500,00 € rendrait la caisse négative le 01/03/2026 (−350,00 €) : saisis d\'abord les recettes en espèces qui le précèdent.',
    )
    expect(bouton('Enregistrer').disabled).toBe(true)
    await act(async () => { bouton('Enregistrer').click() })
    expect(faux.rpcs).toEqual([])
  })

  it('le refus d’un jour : l’avenir, avant l’ouverture, un montant qui n’est pas un nombre — jamais un appel', async () => {
    rendre()
    await attendreLaLecture()
    remplirLeFormulaire({ nature: 'apport', date: '2026-11-02', montant: '10' })
    expect(screen.getByRole('alert').textContent).toBe('Une opération de caisse ne se date pas dans l\'avenir : nous sommes le 29/10/2026.')
    remplirLeFormulaire({ date: '2024-12-31' })
    expect(screen.getByRole('alert').textContent).toBe('Cette opération précède l\'ouverture du dossier, le 01/01/2025 : elle est dans les comptes repris.')
    remplirLeFormulaire({ date: '2026-03-12', montant: 'dix' })
    expect(screen.getByRole('alert').textContent).toContain('Le montant n’est pas un nombre')
    expect(bouton('Enregistrer').disabled).toBe(true)
    expect(faux.rpcs).toEqual([])
  })

  it('deux clics dans le même rendu ne partent qu’une fois', async () => {
    rendre()
    await attendreLaLecture()
    remplirLeFormulaire({ nature: 'apport', date: '2026-03-12', montant: '60' })
    faux.retenirRpc = true
    const b = bouton('Enregistrer')
    await act(async () => { b.click(); b.click() })
    expect(faux.rpcs).toEqual([])
    expect(bouton('Écriture…').disabled).toBe(true)
    await act(async () => { faux.relacherRpc!() })
    await waitFor(() => expect(faux.rpcs).toHaveLength(1))
    await screen.findByText('Opération enregistrée le 12/03/2026.')
  })

  it('un refus de la base est lu et dit — avec sa raison —, et la caisse est relue : elle répond souvent « relis la caisse »', async () => {
    rendre()
    await attendreLaLecture()
    remplirLeFormulaire({ nature: 'apport', date: '2026-03-12', montant: '60' })
    faux.refus = 'Cette opération a été retirée ou remplacée depuis ta lecture : relis ta caisse.'
    await act(async () => { bouton('Enregistrer').click() })
    const alerte = await screen.findByText(/L’opération n’a pas été enregistrée/)
    expect(alerte.textContent).toBe('L’opération n’a pas été enregistrée : Cette opération a été retirée ou remplacée depuis ta lecture : relis ta caisse.')
    expect(faux.demandes).toEqual([D, D])
    // Rien n'a été effacé du formulaire : le cabinet corrige et recommence.
    expect((screen.getByLabelText(/^Montant/) as HTMLInputElement).value).toBe('60')
    expect(bouton('Enregistrer').disabled).toBe(false)
  })

  it('une relecture qui échoue après l’écriture le dit : plus de solde, plus de geste', async () => {
    rendre()
    await attendreLaLecture()
    remplirLeFormulaire({ nature: 'apport', date: '2026-03-12', montant: '60' })
    faux.reponse = (dossierId) => ({ dossierId, etat: 'incomplete', motif: 'les opérations de la caisse : réseau coupé' })
    await act(async () => { bouton('Enregistrer').click() })
    await screen.findByText(/La caisse du dossier n'a pas pu être lue en entier/)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})

describe('saisir un mois', () => {
  async function ouvrirLeMois() {
    rendre()
    await attendreLaLecture()
    fireEvent.click(bouton('Saisir un mois…'))
  }
  const champ = (nom: string) => screen.getByLabelText(nom) as HTMLInputElement | HTMLSelectElement
  function ligne(n: number, o: { nature?: string; date?: string; montant?: string; categorie?: string }) {
    if (o.nature) fireEvent.change(champ(`Nature de la ligne ${n}`), { target: { value: o.nature } })
    if (o.date) fireEvent.change(champ(`Jour de la ligne ${n}`), { target: { value: o.date } })
    if (o.categorie) fireEvent.change(champ(`Catégorie de la ligne ${n}`), { target: { value: o.categorie } })
    if (o.montant) fireEvent.change(champ(`Montant de la ligne ${n}`), { target: { value: o.montant } })
  }

  it('replié à l’ouverture ; déplié, trois lignes vides et rien à envoyer', async () => {
    rendre()
    await attendreLaLecture()
    expect(screen.queryByLabelText('Jour de la ligne 1')).toBeNull()
    fireEvent.click(bouton('Saisir un mois…'))
    expect(screen.getByLabelText('Jour de la ligne 3')).toBeTruthy()
    expect(bouton(/^Enregistrer le mois/).disabled).toBe(true)
  })

  it('tout le mois part en un appel, une opération par ligne, chacune avec son écriture — les lignes vides en fin écartées', async () => {
    await ouvrirLeMois()
    ligne(1, { date: '2026-03-12', categorie: HONORAIRES_ID, montant: '85' })
    ligne(2, { nature: 'apport', date: '2026-03-13', montant: '40' })
    expect(bouton('Enregistrer le mois (2 opérations)').disabled).toBe(false)
    await act(async () => { bouton('Enregistrer le mois (2 opérations)').click() })
    expect(faux.rpcs).toHaveLength(1)
    expect(faux.rpcs[0].nom).toBe('enregistrer_operations_de_caisse')
    expect(faux.rpcs[0].args.p_dossier_id).toBe(D)
    const operations = faux.rpcs[0].args.p_operations as Record<string, unknown>[]
    expect(operations).toEqual([
      {
        genre: 'recette', date: '2026-03-12', montant: 85, categorie_id: HONORAIRES_ID, taux_tva: null, encaissements_du_jour: [],
        ecritures: ecritureDeLOperation({ genre: 'recette', date: '2026-03-12', montant: 85, taux_tva: null, categorie: HONORAIRES }, TRESORERIE),
      },
      {
        genre: 'apport', date: '2026-03-13', montant: 40, categorie_id: null, taux_tva: null, encaissements_du_jour: null,
        ecritures: ecritureDeLOperation({ genre: 'apport', date: '2026-03-13', montant: 40, taux_tva: null, categorie: null }, TRESORERIE),
      },
    ])
    await screen.findByText('2 opérations enregistrées.')
    // La caisse est relue, et la saisie du mois repart vide.
    expect(faux.demandes).toEqual([D, D])
    expect((champ('Montant de la ligne 1') as HTMLInputElement).value).toBe('')
  })

  it('tout ou rien : le premier refus se dit avant le clic, nommé par son rang et son jour, et rien ne part', async () => {
    await ouvrirLeMois()
    ligne(1, { date: '2026-03-12', categorie: HONORAIRES_ID, montant: '85' })
    ligne(2, { nature: 'apport', date: '2026-11-02', montant: '40' })
    const alerte = screen.getAllByRole('alert')[0]
    expect(alerte.textContent).toBe('Opération n° 2, du 02/11/2026 : Une opération de caisse ne se date pas dans l\'avenir : nous sommes le 29/10/2026.')
    expect(bouton(/^Enregistrer le mois/).disabled).toBe(true)
    await act(async () => { bouton(/^Enregistrer le mois/).click() })
    expect(faux.rpcs).toEqual([])
  })

  it('un montant qui n’est pas un nombre est nommé par son rang', async () => {
    await ouvrirLeMois()
    ligne(1, { date: '2026-03-12', categorie: HONORAIRES_ID, montant: 'beaucoup' })
    expect(screen.getAllByRole('alert')[0].textContent).toContain('Opération n° 1 : Le montant n’est pas un nombre')
  })

  it('la caisse jamais négative se juge à la fin du mois, sous les mots de la saisie d’un mois', async () => {
    await ouvrirLeMois()
    ligne(1, { nature: 'prelevement', date: '2026-02-10', montant: '500' })
    expect(sans(screen.getAllByRole('alert')[0].textContent)).toContain('La caisse serait négative le')
  })

  it('une ligne s’ajoute en reprenant le jour et la nature de la précédente ; elle se retire', async () => {
    await ouvrirLeMois()
    ligne(3, { nature: 'prelevement', date: '2026-03-20' })
    fireEvent.click(bouton('Ajouter une ligne'))
    expect((champ('Nature de la ligne 4') as HTMLSelectElement).value).toBe('prelevement')
    expect((champ('Jour de la ligne 4') as HTMLInputElement).value).toBe('2026-03-20')
    fireEvent.click(screen.getAllByRole('button', { name: 'Retirer la ligne' })[3])
    expect(screen.queryByLabelText('Jour de la ligne 4')).toBeNull()
  })

  it('un refus de la base est dit (le mois n’est pas écrit : tout ou rien) et la caisse relue', async () => {
    await ouvrirLeMois()
    ligne(1, { nature: 'apport', date: '2026-03-12', montant: '40' })
    faux.refus = 'Opération n° 1, du 12/03/2026 : relis la caisse'
    await act(async () => { bouton(/^Enregistrer le mois/).click() })
    await screen.findByText(/Le mois n’a pas été enregistré \(rien n’est écrit : tout ou rien\) : Opération n° 1/)
    expect(faux.demandes).toEqual([D, D])
  })

  it('deux clics dans le même rendu ne partent qu’une fois', async () => {
    await ouvrirLeMois()
    ligne(1, { nature: 'apport', date: '2026-03-12', montant: '40' })
    faux.retenirRpc = true
    const b = bouton(/^Enregistrer le mois/)
    await act(async () => { b.click(); b.click() })
    await act(async () => { faux.relacherRpc!() })
    await waitFor(() => expect(faux.rpcs).toHaveLength(1))
  })
})

describe('retirer une opération', () => {
  const ligneDe = ligneDeLaCaisse

  it('la confirmation NOMME ce qui part et dit la caisse du jour ; refusée, rien ne part et le verrou n’est pas posé', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    rendre()
    await attendreLaLecture()
    await act(async () => { within(ligneDe(/^Prélèvement en espèces/)).getByRole('button', { name: 'Retirer' }).click() })
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(sans(String(confirm.mock.calls[0][0]))).toBe(
      'Retirer le prélèvement du 04/03/2026 de 40,00 € ? Son écriture est retirée avec elle ; la caisse du 04/03/2026 passera à 235,00 €.',
    )
    expect(faux.rpcs).toEqual([])
    // Le verrou n'a pas été posé : le geste suivant part.
    confirm.mockReturnValue(true)
    await act(async () => { within(ligneDe(/^Prélèvement en espèces/)).getByRole('button', { name: 'Retirer' }).click() })
    expect(faux.rpcs).toHaveLength(1)
  })

  it('confirmée : la fonction de la base reçoit l’opération, la caisse est relue, le message nomme ce qui est parti', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    rendre()
    await attendreLaLecture()
    await act(async () => { within(ligneDe(/^Prélèvement en espèces/)).getByRole('button', { name: 'Retirer' }).click() })
    expect(faux.rpcs).toEqual([{ nom: 'retirer_operation_caisse', args: { p_dossier_id: D, p_operation_id: 'o3' } }])
    await screen.findByText(/^Retiré : le prélèvement du 04\/03\/2026 de 40,00/)
    expect([...document.querySelectorAll('tbody td[data-libelle="Nature"]')].some((td) => /^Prélèvement en espèces/.test(td.textContent ?? ''))).toBe(false)
    expect(faux.demandes).toEqual([D, D])
    // Elle reste lisible parmi les opérations retirées.
    expect(screen.getByText(/Opérations retirées ou remplacées \(1\)/)).toBeTruthy()
  })

  it('deux clics dans le même rendu ne partent qu’une fois, et ne demandent qu’une confirmation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    rendre()
    await attendreLaLecture()
    faux.retenirRpc = true
    const b = within(ligneDe(/^Prélèvement en espèces/)).getByRole('button', { name: 'Retirer' })
    await act(async () => { b.click(); b.click() })
    await act(async () => { faux.relacherRpc!() })
    await waitFor(() => expect(faux.rpcs).toHaveLength(1))
    expect(confirm).toHaveBeenCalledTimes(1)
  })

  it('le refus se dit AVANT le clic : un retrait qui viderait la caisse grise le bouton et dit le jour, sous les mots de la base', async () => {
    faux.donnees = mars({ operations: [
      operation({ id: 'a', genre: 'apport', date: '2026-03-01', montant: 100 }),
      operation({ id: 'p', genre: 'prelevement', date: '2026-03-02', montant: 130 }),
    ], mouvements: [], especes: { etat: 'sans_objet' } })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    rendre()
    await attendreLaLecture()
    const ligne = ligneDe(/^Apport en caisse/)
    const retirer = within(ligne).getByRole('button', { name: 'Retirer' }) as HTMLButtonElement
    expect(retirer.disabled).toBe(true)
    expect(sans(ligne.textContent)).toContain('Retirer cet apport de 100,00 € rendrait la caisse négative le 02/03/2026 (−100,00 €)')
    await act(async () => { retirer.click() })
    expect(confirm).not.toHaveBeenCalled()
    expect(faux.rpcs).toEqual([])
    // Un prélèvement ne fait que rendre des espèces : il se retire toujours.
    expect((within(ligneDe(/^Prélèvement en espèces/)).getByRole('button', { name: 'Retirer' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('la recette du 3 mars, dont dépend le versement du 5, ne se retire pas : le bouton est grisé et dit pourquoi', async () => {
    rendre()
    await attendreLaLecture()
    const ligne = ligneDe(/^Recettes en espèces — Honoraires/)
    expect((within(ligne).getByRole('button', { name: 'Retirer' }) as HTMLButtonElement).disabled).toBe(true)
    expect(sans(ligne.textContent)).toContain('Retirer cette recette de 85,00 € rendrait la caisse négative le 05/03/2026 (−10,00 €) : retire d\'abord les sorties d\'espèces qui la suivent.')
  })

  it('une opération des espèces d’une facture, un versement, l’ouverture : aucun geste', async () => {
    rendre()
    await attendreLaLecture()
    for (const re of [/^Versement en banque/, /^Espèces reçues pour la facture/]) {
      expect(within(ligneDe(re)).queryAllByRole('button')).toHaveLength(0)
    }
  })

  it('un refus de la base est lu et dit', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    rendre()
    await attendreLaLecture()
    faux.refus = 'Cette opération a été retirée ou remplacée depuis ta lecture : relis ta caisse.'
    await act(async () => { within(ligneDe(/^Prélèvement en espèces/)).getByRole('button', { name: 'Retirer' }).click() })
    await screen.findByText('L’opération n’a pas été retirée : Cette opération a été retirée ou remplacée depuis ta lecture : relis ta caisse.')
  })
})

describe('remplacer une opération', () => {
  const ligneDe = ligneDeLaCaisse

  it('« Remplacer » charge l’opération dans le formulaire ; le remplacement part par sa fonction, après une confirmation qui nomme l’ancienne et la nouvelle', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    rendre()
    await attendreLaLecture()
    await act(async () => { within(ligneDe(/^Recettes en espèces — Honoraires/)).getByRole('button', { name: 'Remplacer' }).click() })
    expect(screen.getByText('Remplacer la recette du 03/03/2026 de 85,00 € (Honoraires)', { exact: false })).toBeTruthy()
    expect((screen.getByLabelText('Jour') as HTMLInputElement).value).toBe('2026-03-03')
    expect((screen.getByLabelText(/^Montant/) as HTMLInputElement).value).toBe('85')
    expect((screen.getByLabelText('Catégorie de produit') as HTMLSelectElement).value).toBe(HONORAIRES_ID)
    remplirLeFormulaire({ montant: '90' })
    expect(bouton('Remplacer').disabled).toBe(false)
    await act(async () => { bouton('Remplacer').click() })
    expect(sans(String(confirm.mock.calls[0][0]))).toBe(
      'Remplacer la recette du 03/03/2026 de 85,00 € (Honoraires) par une recette du 03/03/2026 de 90,00 € (Honoraires) ? L’ancienne est retirée avec son écriture ; la nouvelle est écrite à sa place, et la caisse se rejoue.',
    )
    expect(faux.rpcs).toEqual([{
      nom: 'remplacer_operation_caisse',
      args: {
        p_dossier_id: D, p_operation_id: 'o2', p_genre: 'recette', p_date: '2026-03-03', p_montant: 90, p_categorie_id: HONORAIRES_ID, p_taux_tva: null,
        p_encaissements_du_jour: [],
        p_ecritures: ecritureDeLOperation({ genre: 'recette', date: '2026-03-03', montant: 90, taux_tva: null, categorie: HONORAIRES }, TRESORERIE),
      },
    }])
    await screen.findByText(/^Opération remplacée le 03\/03\/2026\./)
    // Le formulaire redevient celui d'une saisie neuve, et la version remplacée se retrouve parmi les opérations retirées.
    expect(screen.getByText('Saisir une opération')).toBeTruthy()
    expect(screen.getByText(/remplacée par l’opération du 03\/03\/2026/)).toBeTruthy()
  })

  it('refusée à la confirmation, rien ne part ; « Annuler le remplacement » rend le formulaire neuf', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    rendre()
    await attendreLaLecture()
    await act(async () => { within(ligneDe(/^Apport en caisse/)).getByRole('button', { name: 'Remplacer' }).click() })
    remplirLeFormulaire({ montant: '60' })
    await act(async () => { bouton('Remplacer').click() })
    expect(faux.rpcs).toEqual([])
    fireEvent.click(bouton('Annuler le remplacement'))
    expect(screen.getByText('Saisir une opération')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Annuler le remplacement' })).toBeNull()
  })

  it('le refus d’un remplacement se dit avant le clic, sous les mots de la base : l’ancienne retirée viderait la caisse', async () => {
    faux.donnees = mars({ operations: [
      operation({ id: 'a', genre: 'apport', date: '2026-03-01', montant: 100 }),
      operation({ id: 'p', genre: 'prelevement', date: '2026-03-02', montant: 80 }),
    ], mouvements: [], especes: { etat: 'sans_objet' } })
    rendre()
    await attendreLaLecture()
    await act(async () => { within(ligneDe(/^Apport en caisse/)).getByRole('button', { name: 'Remplacer' }).click() })
    remplirLeFormulaire({ montant: '10' })
    expect(sans(screen.getByRole('alert').textContent)).toBe(
      'Retirer cet apport de 100,00 € rendrait la caisse négative le 02/03/2026 (−40,00 €) : retire d\'abord les sorties d\'espèces qui le suivent.',
    )
    expect(bouton('Remplacer').disabled).toBe(true)
  })

  it('retirer l’opération qu’on était en train de remplacer rend le formulaire neuf', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    rendre()
    await attendreLaLecture()
    await act(async () => { within(ligneDe(/^Prélèvement en espèces/)).getByRole('button', { name: 'Remplacer' }).click() })
    await act(async () => { within(ligneDe(/^Prélèvement en espèces/)).getByRole('button', { name: 'Retirer' }).click() })
    await screen.findByText(/^Retiré : le prélèvement/)
    expect(screen.getByText('Saisir une opération')).toBeTruthy()
  })
})

describe('un dossier quitté ne laisse rien derrière lui', () => {
  it('le formulaire, la saisie du mois et la lecture repartent du nouveau dossier, qui attend sa propre lecture', async () => {
    const { versDossier } = rendre()
    await attendreLaLecture()
    remplirLeFormulaire({ nature: 'apport', date: '2026-03-12', montant: '60' })
    fireEvent.click(bouton('Saisir un mois…'))
    faux.retenue = new Promise<void>((r) => { faux.relacher = r })
    versDossier('dossier-2')
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/Solde de la caisse/)
    expect(faux.demandes).toEqual([D, 'dossier-2'])
    await act(async () => { faux.relacher!() })
    faux.reponse = (dossierId) => ({ dossierId, etat: 'lue', donnees: faux.donnees! })
    await screen.findByText(/Solde de la caisse/)
    expect((screen.getByLabelText(/^Montant/) as HTMLInputElement).value).toBe('')
    expect(screen.queryByLabelText('Jour de la ligne 1')).toBeNull()
  })

  it('la réponse tardive du dossier quitté ne prend pas la place', async () => {
    let relacherLAncien!: () => void
    faux.retenue = new Promise<void>((r) => { relacherLAncien = r })
    const { versDossier } = rendre()
    // Le premier dossier n'a pas répondu ; on passe au second, dont la lecture répond tout de suite.
    faux.retenue = null
    faux.reponse = (dossierId) => ({ dossierId, etat: 'lue', donnees: dossierId === D ? mars({ operations: [operation({ id: 'x', montant: 777 })] }) : mars() })
    versDossier('dossier-2')
    await attendreLaLecture()
    await act(async () => { relacherLAncien() })
    expect(texte()).not.toContain('777,00')
    expect(texte()).toMatch(/Solde de la caisse à la fin de 2026\s*105,00 €/)
  })
})
