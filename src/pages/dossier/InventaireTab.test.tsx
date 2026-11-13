import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import InventaireTab from './InventaireTab'
import type { ValeurAnnee } from '../../components/AnneeTabs'
import type { ModeleComptable } from '../../lib/engagement'
import { MOTS_DES_REFUS, type ComptesDInventaire } from '../../lib/inventaire'
import type { LectureDeLInventaireDeLEcran } from '../../lib/inventaireDeLEcranLecture'
import { MOTS_DES_JUSTIFICATIFS, type JustificatifsDuDossier } from '../../lib/justificatifsDeLInventaire'
import type { LectureDesJustificatifs } from '../../lib/justificatifsDeLInventaireLecture'
import { euros, type DonneesDeLInventaire } from '../../lib/inventaireEcran'
import { PLAN_PAR_DEFAUT } from '../../lib/planComptable'
import type { InventaireDeclare, OperationInventaire, Provision } from '../../lib/types'
import { ContexteDossier } from '../../test/exercicesValides'
import { LIBELLES_PAR_DEFAUT, PREFIXES_PAR_DEFAUT } from '../../test/modeles'

// L'ONGLET INVENTAIRE, CÔTÉ CABINET (ligne 35, INV5). Ce que ces cas gardent : rien avant le retour de la lecture ; l'onglet
// d'un exercice (la saisie, les régularisations, les provisions, l'état) ; la lecture partielle ou refusée qui le dit et
// n'offre AUCUN geste ; la saisie TELLE QU'ELLE PART à la base (les arguments exacts de la fonction), son refus dit AVANT le
// clic sous les mots de la base ; une confirmation qui NOMME ce qui part ; un verrou qui ne laisse partir qu'un geste pour deux
// clics dans le même `act` ; un `{ error }` lu et dit ; une lecture refaite après chaque geste ; un dossier quitté qui ne laisse
// rien derrière lui ; l'état tiré en CSV et en PDF sous son verrou. La lecture est doublée (éprouvée à part,
// lib/inventaireDeLEcranLecture.test.ts), la base un faux `rpc` qui applique ce que ses fonctions font. Des jeux FICTIFS, et un
// jour fixe : le 12/11/2026.

const D = 'dossier-1'
const COMPTES: ComptesDInventaire = {
  charges_constatees_avance: '486100', produits_constates_avance: '487100', factures_non_parvenues: '408110', factures_a_etablir: '418110',
  tva_factures_non_parvenues: '445861', tva_factures_a_etablir: '445871', provisions_risques: '151110', depreciation_clients: '491100',
  dotations_provisions_exploitation: '681510', dotations_depreciations_actif_circulant: '681740',
  reprises_provisions_exploitation: '781510', reprises_depreciations_actif_circulant: '781740',
}

const faux = vi.hoisted(() => ({
  donnees: null as null | DonneesDeLInventaire,
  // La réponse de la lecture : l'état tel que le module le rend, pour le dossier demandé.
  reponse: null as null | ((dossierId: string) => LectureDeLInventaireDeLEcran),
  retenue: null as null | Promise<void>,
  relacher: null as null | (() => void),
  demandes: [] as string[],
  rpcs: [] as { nom: string; args: Record<string, unknown> }[],
  refus: null as string | null,
  retenirRpc: false,
  relacherRpc: null as null | (() => void),
  compteur: 0,
  telechargements: [] as { nom: string; contenu: string }[],
  pdfs: [] as string[],
  retenirLePdf: false,
  relacherLePdf: null as null | (() => void),
  // La lecture des pièces et factures à citer (INV5-Q1) : sa réponse, et sa retenue.
  justificatifs: null as null | ((dossierId: string) => LectureDesJustificatifs),
  retenueDesJustificatifs: null as null | Promise<void>,
  relacherLesJustificatifs: null as null | (() => void),
  demandesDesJustificatifs: [] as string[],
}))

vi.mock('../../lib/justificatifsDeLInventaireLecture', () => ({
  lireLesJustificatifsDuDossier: (dossierId: string) => {
    faux.demandesDesJustificatifs.push(dossierId)
    const rendre = () => faux.justificatifs!(dossierId)
    return faux.retenueDesJustificatifs ? faux.retenueDesJustificatifs.then(rendre) : Promise.resolve(rendre())
  },
}))

vi.mock('../../lib/inventaireDeLEcranLecture', () => ({
  lireLInventaireDuDossier: (dossierId: string) => {
    faux.demandes.push(dossierId)
    const rendre = () => (faux.reponse ? faux.reponse(dossierId) : { dossierId, etat: 'lue' as const, donnees: faux.donnees! })
    return faux.retenue ? faux.retenue.then(rendre) : Promise.resolve(rendre())
  },
}))

vi.mock('../../lib/fec', async (original) => {
  const vrai = await original<typeof import('../../lib/fec')>()
  return { ...vrai, telechargerTexte: (nom: string, contenu: string) => { faux.telechargements.push({ nom, contenu }) } }
})

vi.mock('../../lib/apercu', async (original) => {
  const vrai = await original<typeof import('../../lib/apercu')>()
  return { ...vrai, telechargerUnPdf: (_octets: Uint8Array, nom: string) => { faux.pdfs.push(nom); return { ok: true as const } } }
})

vi.mock('../../lib/inventaireEtat', async (original) => {
  const vrai = await original<typeof import('../../lib/inventaireEtat')>()
  return {
    ...vrai,
    pdfDeLEtat: () => (faux.retenirLePdf
      ? new Promise<Uint8Array>((r) => { faux.relacherLePdf = () => r(new Uint8Array([37, 80, 68, 70])) })
      : Promise.resolve(new Uint8Array([37, 80, 68, 70]))),
  }
})

vi.mock('../../lib/supabase', () => {
  const id = () => `n${++faux.compteur}`
  function appliquer(nom: string, args: Record<string, unknown>) {
    const d = faux.donnees!
    if (nom === 'enregistrer_operation_inventaire') {
      const o = args.p_operation as Record<string, unknown>
      const nouvelle: OperationInventaire = {
        id: (o.id as string | null) ?? id(), dossier_id: D, exercice: o.exercice as number, nature: o.nature as OperationInventaire['nature'],
        compte_resultat: o.compte_resultat as string, compte_regularisation: o.compte_regularisation as string,
        montant_centimes: o.montant_centimes as number, tva_centimes: o.tva_centimes as number, periode_debut: (o.periode_debut as string | null) ?? null,
        periode_fin: (o.periode_fin as string | null) ?? null, objet: o.objet as string, piece_citee_id: (o.piece_citee_id as string | null) ?? null,
        provision_id: null, version: ((args.p_version_lue as number | null) ?? 0) + 1, cree_par: 'u', cree_le: '2026-11-12T09:00:00Z', modifie_par: null, modifie_le: null,
      }
      faux.donnees = { ...d, operations: [...d.operations.filter((x) => x.id !== nouvelle.id), nouvelle] }
    }
    if (nom === 'retirer_operation_inventaire') faux.donnees = { ...d, operations: d.operations.filter((o) => o.id !== args.p_id) }
    if (nom === 'enregistrer_provision') {
      const p = args.p_provision as Record<string, unknown>
      const nouvelle: Provision = {
        id: id(), dossier_id: D, genre: p.genre as Provision['genre'], compte_provision: p.compte_provision as string, objet: p.objet as string,
        facture_id: (p.facture_id as string | null) ?? null, piece_citee_id: (p.piece_citee_id as string | null) ?? null, ouverte_en: p.ouverte_en as number, reprise_centimes: (p.reprise_centimes as number | null) ?? null,
        version: 1, cree_par: 'u', cree_le: '2026-11-12T09:00:00Z', modifie_par: null, modifie_le: null,
      }
      faux.donnees = { ...d, provisions: [...d.provisions, nouvelle] }
    }
    if (nom === 'retirer_provision') faux.donnees = { ...d, provisions: d.provisions.filter((p) => p.id !== args.p_id) }
    if (nom === 'enregistrer_evaluation_provision') {
      const e = args.p_evaluation as Record<string, unknown>
      const p = d.provisions.find((x) => x.id === e.provision_id)!
      const nouvelle: OperationInventaire = {
        id: id(), dossier_id: D, exercice: e.exercice as number, nature: 'provision', compte_resultat: '681510', compte_regularisation: p.compte_provision,
        montant_centimes: e.cible_centimes as number, tva_centimes: 0, periode_debut: null, periode_fin: null, objet: p.objet, piece_citee_id: null,
        provision_id: p.id, version: 1, cree_par: 'u', cree_le: '2026-11-12T09:00:00Z', modifie_par: null, modifie_le: null,
      }
      faux.donnees = { ...d, operations: [...d.operations.filter((x) => !(x.provision_id === p.id && x.exercice === nouvelle.exercice)), nouvelle] }
    }
    if (nom === 'declarer_inventaire') {
      const nouvelle: InventaireDeclare = {
        id: id(), dossier_id: D, exercice: args.p_exercice as number, declare_par: 'u', declare_le: '2026-11-12T09:30:00Z', retire_par: null, retire_le: null,
      }
      faux.donnees = { ...d, declarations: [...d.declarations, nouvelle] }
    }
    if (nom === 'retirer_declaration_inventaire') {
      faux.donnees = { ...d, declarations: d.declarations.map((x) => (x.id === args.p_id ? { ...x, retire_le: '2026-11-12T10:00:00Z', retire_par: 'u' } : x)) }
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

const ENGAGEMENT: ModeleComptable = { mode: 'engagement', compteNotesDeFrais: '455000', plan: PLAN_PAR_DEFAUT, libelles: LIBELLES_PAR_DEFAUT, prefixes: PREFIXES_PAR_DEFAUT }

const operation = (p: Partial<OperationInventaire> & Pick<OperationInventaire, 'id'>): OperationInventaire => ({
  dossier_id: D, exercice: 2025, nature: 'cca', compte_resultat: '616000', compte_regularisation: '486100', montant_centimes: 60_000, tva_centimes: 0,
  periode_debut: null, periode_fin: null, objet: 'Assurance du local', piece_citee_id: null, provision_id: null, version: 2,
  cree_par: 'u', cree_le: '2026-11-10T09:00:00Z', modifie_par: null, modifie_le: null, ...p,
})

const provision = (p: Partial<Provision> & Pick<Provision, 'id'>): Provision => ({
  dossier_id: D, genre: 'risque', compte_provision: '151110', objet: 'Litige avec un fournisseur', facture_id: null, piece_citee_id: null,
  ouverte_en: 2025, reprise_centimes: null, version: 1, cree_par: 'u', cree_le: '2026-11-10T09:00:00Z', modifie_par: null, modifie_le: null, ...p,
})

// Les pièces et factures du dossier, FICTIVES : une dépense, une recette, une facture émise validée et un avoir.
const JUSTIFICATIFS: JustificatifsDuDossier = {
  pieces: [
    { id: 'pa', dossier_id: D, nom_fichier: 'assurance-local-2025.pdf', date_piece: '2025-07-01', tiers: 'Assureur fictif', montant_ttc: 1200, type_piece: 'achat', statut: 'validee' },
    { id: 'pj', dossier_id: D, nom_fichier: 'honoraires-janvier.pdf', date_piece: '2026-01-15', tiers: 'Conseil fictif', montant_ttc: 600, type_piece: 'achat', statut: 'a_valider' },
    { id: 'pv', dossier_id: D, nom_fichier: 'vente-client.pdf', date_piece: '2025-09-01', tiers: null, montant_ttc: 3000, type_piece: 'vente', statut: 'validee' },
  ],
  factures: [
    { id: 'f1', dossier_id: D, numero: 'F2025-007', statut: 'validee', type: 'facture', date_emission: '2025-10-01', tiers_nom: 'Client fictif', montant_ttc: 3000 },
    { id: 'a1', dossier_id: D, numero: 'A2025-001', statut: 'validee', type: 'avoir', date_emission: '2025-11-01', tiers_nom: 'Client fictif', montant_ttc: -300 },
  ],
}

const donnees = (p: Partial<DonneesDeLInventaire> = {}): DonneesDeLInventaire => ({
  operations: [operation({ id: 'o1' })], provisions: [], declarations: [], lignes: [], comptes: COMPTES, premierExercice: 2024, ...p,
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-12T10:00:00Z'))
  faux.donnees = donnees()
  faux.reponse = null
  faux.retenue = null
  faux.relacher = null
  faux.demandes = []
  faux.rpcs = []
  faux.refus = null
  faux.retenirRpc = false
  faux.relacherRpc = null
  faux.compteur = 0
  faux.telechargements = []
  faux.pdfs = []
  faux.retenirLePdf = false
  faux.relacherLePdf = null
  faux.justificatifs = (dossierId) => ({ dossierId, etat: 'lue', justificatifs: JUSTIFICATIFS })
  faux.retenueDesJustificatifs = null
  faux.relacherLesJustificatifs = null
  faux.demandesDesJustificatifs = []
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })

function rendre(o: { dossierId?: string; modele?: ModeleComptable; assujettiTva?: boolean; annee?: ValeurAnnee; valides?: readonly number[] } = {}) {
  const vue = (p: { dossierId?: string }) => (
    <ContexteDossier annee={o.annee ?? 2025} valides={o.valides ?? []}>
      <InventaireTab dossierId={p.dossierId ?? o.dossierId ?? D} dossierNom="Société fictive" modele={o.modele ?? ENGAGEMENT} assujettiTva={o.assujettiTva ?? true} />
    </ContexteDossier>
  )
  const r = render(vue({}))
  return { ...r, versDossier: (dossierId: string) => r.rerender(vue({ dossierId })) }
}

const sans = (s: string | null | undefined) => (s ?? '').replace(/[\u00a0\u202f]/g, ' ')
const texte = () => sans(document.body.textContent)
async function attendreLaLecture() { await screen.findByRole('form', { name: 'Saisie d’une régularisation' }) }
const formulaire = () => screen.getByRole('form', { name: 'Saisie d’une régularisation' })
function remplir(o: { nature?: string; resultat?: string; regul?: string; montant?: string; tva?: string; objet?: string; debut?: string; fin?: string; piece?: string }) {
  if (o.nature) fireEvent.change(screen.getByLabelText('Nature'), { target: { value: o.nature } })
  if (o.resultat) fireEvent.change(screen.getByLabelText(/^Compte de (charge|produit)/), { target: { value: o.resultat } })
  if (o.regul) fireEvent.change(screen.getByLabelText('Compte de régularisation'), { target: { value: o.regul } })
  if (o.montant) fireEvent.change(screen.getByLabelText(/^Montant (hors taxes|toutes taxes comprises)$/), { target: { value: o.montant } })
  if (o.tva) fireEvent.change(screen.getByLabelText('TVA d’attente'), { target: { value: o.tva } })
  if (o.objet) fireEvent.change(screen.getByLabelText(/^Objet \(il part au FEC, dans/), { target: { value: o.objet } })
  if (o.debut) fireEvent.change(screen.getByLabelText('Période couverte, du'), { target: { value: o.debut } })
  if (o.fin) fireEvent.change(screen.getByLabelText('au'), { target: { value: o.fin } })
  if (o.piece) fireEvent.change(screen.getByLabelText('Montant de la pièce pour toute la période'), { target: { value: o.piece } })
}
const boutonDuFormulaire = (nom: string | RegExp) => within(formulaire()).getByRole('button', { name: nom }) as HTMLButtonElement
const bouton = (nom: string | RegExp) => screen.getByRole('button', { name: nom }) as HTMLButtonElement
const ligne = (re: RegExp) => {
  const cellule = [...document.querySelectorAll('tbody td[data-libelle="Objet"], tbody td[data-libelle="Provision"]')].find((td) => re.test(td.textContent ?? ''))
  if (!cellule) throw new Error(`Aucune ligne ne dit ${re}`)
  return cellule.closest('tr') as HTMLElement
}

describe('rien avant le retour de la lecture', () => {
  it('retenue : « Chargement… », ni formulaire ni geste ; revenue, l’onglet se montre', async () => {
    faux.retenue = new Promise<void>((r) => { faux.relacher = r })
    rendre()
    expect(screen.getByText('Chargement…')).toBeTruthy()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryByRole('form')).toBeNull()
    expect(document.body.textContent).not.toMatch(/Aucune régularisation|Non déclaré/)
    await act(async () => { faux.relacher!() })
    await attendreLaLecture()
    expect(faux.demandes).toEqual([D])
  })

  it('le drapeau baissé, la lecture rend « absente » : l’onglet dit que la base attend, sans formulaire ni geste', async () => {
    faux.reponse = (dossierId) => ({ dossierId, etat: 'absente' })
    rendre()
    await screen.findByText(/L’inventaire n’est pas encore en base/)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryByRole('form')).toBeNull()
  })

  it('un exercice « toutes » n’est choisi par personne à la place du cabinet : aucun geste', async () => {
    rendre({ annee: 'toutes' })
    await screen.findByText(/choisis un exercice dans le sélecteur de l’en-tête/)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryByRole('form')).toBeNull()
  })
})

describe('une lecture partielle, refusée ou rompue : le dit, et n’offre aucun geste', () => {
  it('le motif de la première lecture qui a manqué, ni formulaire, ni tableau, ni bouton', async () => {
    faux.reponse = (dossierId) => ({ dossierId, etat: 'incomplete', motif: 'les provisions : lecture interrompue après 0 ligne(s) : accès refusé' })
    rendre()
    await screen.findByText(/L’inventaire du dossier n.a pas pu être lu en entier \(les provisions : lecture interrompue/)
    expect(document.body.textContent).toContain('rien ne s’écrit d’ici')
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryByRole('form')).toBeNull()
    expect(document.body.textContent).not.toContain('Assurance du local')
  })
})

describe('l’onglet d’un exercice', () => {
  it('montre les régularisations de l’exercice affiché, leurs comptes, montants et écritures, et dit l’inventaire non déclaré', async () => {
    faux.donnees = donnees({
      operations: [
        operation({ id: 'o1' }), operation({ id: 'o2', nature: 'fnp', objet: 'Honoraires de décembre', montant_centimes: 100_000, tva_centimes: 20_000, compte_resultat: '622000', compte_regularisation: '408110' }),
        operation({ id: 'o9', exercice: 2024, objet: 'Autre exercice' }),
      ],
    })
    rendre()
    await attendreLaLecture()
    const t = texte()
    expect(t).toContain('Non déclaré')
    expect(t).toContain('Assurance du local')
    expect(t).toContain('Honoraires de décembre')
    expect(t).not.toContain('Autre exercice')
    expect(t).toContain('616000 / 486100')
    expect(t).toContain(`${euros(100_000)} + ${euros(20_000)} de TVA d’attente`.replace(/[\u00a0\u202f]/g, ' '))
    // Aucune ligne au brouillon : les écritures sont à recomposer.
    expect(within(ligne(/Assurance du local/)).getByText('À recomposer')).toBeTruthy()
  })

  it('un exercice sans régularisation le dit', async () => {
    faux.donnees = donnees({ operations: [] })
    rendre()
    await attendreLaLecture()
    expect(texte()).toContain('Aucune régularisation saisie sur l’exercice 2025.')
  })

  it('une régularisation d’un exercice validé ne se remplace ni ne se retire : le motif sur le bouton, dit', async () => {
    rendre({ valides: [2025] })
    await attendreLaLecture()
    const l = ligne(/Assurance du local/)
    expect(within(l).getByRole('button', { name: 'Retirer' }).hasAttribute('disabled')).toBe(true)
    expect(within(l).getByRole('button', { name: 'Remplacer' }).hasAttribute('disabled')).toBe(true)
    expect(sans(l.textContent)).toContain(MOTS_DES_REFUS.exerciceFige)
  })
})

describe('saisir une régularisation', () => {
  it('le compte de régularisation se propose depuis le plan, et le champ de TVA n’est offert qu’à une FNP ou une FAE', async () => {
    rendre()
    await attendreLaLecture()
    expect((screen.getByLabelText('Compte de régularisation') as HTMLInputElement).value).toBe('486100')
    expect(screen.queryByLabelText('TVA d’attente')).toBeNull()
    fireEvent.change(screen.getByLabelText('Nature'), { target: { value: 'fnp' } })
    expect((screen.getByLabelText('Compte de régularisation') as HTMLInputElement).value).toBe('408110')
    expect(screen.getByLabelText('TVA d’attente')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Nature'), { target: { value: 'charge_a_payer' } })
    expect((screen.getByLabelText('Compte de régularisation') as HTMLInputElement).value).toBe('')
    expect(screen.queryByLabelText('TVA d’attente')).toBeNull()
  })

  it('part telle que le module la compose : la fonction de la base reçoit l’opération, les deux écritures et aucune version lue', async () => {
    rendre()
    await attendreLaLecture()
    remplir({ resultat: '616000', montant: '1 200,50', objet: 'Assurance du local, juillet 2025 à juin 2026' })
    expect(boutonDuFormulaire('Enregistrer').disabled).toBe(false)
    await act(async () => { boutonDuFormulaire('Enregistrer').click() })
    expect(faux.rpcs).toHaveLength(1)
    const { nom, args } = faux.rpcs[0]
    expect(nom).toBe('enregistrer_operation_inventaire')
    expect(args.p_dossier_id).toBe(D)
    expect(args.p_version_lue).toBeNull()
    expect(args.p_operation).toEqual({
      id: null, exercice: 2025, nature: 'cca', compte_resultat: '616000', compte_regularisation: '486100', montant_centimes: 120_050, tva_centimes: 0,
      objet: 'Assurance du local, juillet 2025 à juin 2026', periode_debut: null, periode_fin: null, piece_citee_id: null,
    })
    expect(args.p_ecritures).toEqual([
      {
        date: '2025-12-31', journal: 'OD', libelle: 'CCA 31/12/2025 — Assurance du local, juillet 2025 à juin 2026',
        lignes: [{ compte: '486100', sens: 'debit', centimes: 120_050 }, { compte: '616000', sens: 'credit', centimes: 120_050 }],
      },
      {
        date: '2026-01-01', journal: 'OD', libelle: 'Extourne — CCA 31/12/2025 — Assurance du local, juillet 2025 à juin 2026',
        lignes: [{ compte: '486100', sens: 'credit', centimes: 120_050 }, { compte: '616000', sens: 'debit', centimes: 120_050 }],
      },
    ])
    await screen.findByText('Régularisation enregistrée : Assurance du local, juillet 2025 à juin 2026.')
    // Relue après le geste, la ligne paraît, et le formulaire est remis à vide.
    expect(faux.demandes).toEqual([D, D])
    expect(texte()).toContain('Assurance du local, juillet 2025 à juin 2026')
    expect((screen.getByLabelText(/^Montant (hors taxes|toutes taxes comprises)$/) as HTMLInputElement).value).toBe('')
  })

  it('la confirmation NOMME la paire d’écritures, et un refus de la confirmation n’écrit rien', async () => {
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(false)
    rendre()
    await attendreLaLecture()
    remplir({ resultat: '616000', montant: '600', objet: 'Assurance' })
    await act(async () => { boutonDuFormulaire('Enregistrer').click() })
    expect(confirmer).toHaveBeenCalledTimes(1)
    const demande = sans(confirmer.mock.calls[0][0])
    expect(demande).toContain('Au 31/12/2025 : Débit 486100 600,00 € ; Crédit 616000 600,00 €.')
    expect(demande).toContain('Au 01/01/2026 (extourne) : Crédit 486100 600,00 € ; Débit 616000 600,00 €.')
    expect(demande).toContain('« CCA 31/12/2025 — Assurance »')
    expect(faux.rpcs).toEqual([])
  })

  it('dit le refus AVANT le clic, sous les mots de la base : un montant illisible, un compte hors de sa classe', async () => {
    rendre()
    await attendreLaLecture()
    remplir({ resultat: '706000', montant: '12,345', objet: 'Assurance' })
    const alerte = screen.getByRole('alert')
    expect(alerte.textContent).toContain(MOTS_DES_REFUS.compteDeCharge)
    expect(alerte.textContent).toContain(MOTS_DES_REFUS.montant)
    expect(boutonDuFormulaire('Enregistrer').disabled).toBe(true)
    await act(async () => { fireEvent.submit(formulaire()) })
    expect(faux.rpcs).toEqual([])
    expect(window.confirm).not.toHaveBeenCalled()
  })

  it('en trésorerie, le module refuse tout avant la base (l’onglet ne se monte pas ainsi : DossierDetail, mais le refus tient)', async () => {
    rendre({ modele: { ...ENGAGEMENT, mode: 'tresorerie' } })
    await attendreLaLecture()
    remplir({ resultat: '616000', montant: '600', objet: 'Assurance' })
    expect(screen.getByRole('alert').textContent).toContain(MOTS_DES_REFUS.tresorerie)
    expect(boutonDuFormulaire('Enregistrer').disabled).toBe(true)
  })

  it('une FNP d’un dossier assujetti part avec sa TVA d’attente ; un exonéré n’a pas ce champ', async () => {
    rendre()
    await attendreLaLecture()
    remplir({ nature: 'fnp', resultat: '622000', montant: '1000', tva: '200', objet: 'Honoraires' })
    await act(async () => { boutonDuFormulaire('Enregistrer').click() })
    expect(faux.rpcs[0].args.p_operation).toMatchObject({ nature: 'fnp', montant_centimes: 100_000, tva_centimes: 20_000, compte_regularisation: '408110' })
    cleanup()
    rendre({ assujettiTva: false })
    await attendreLaLecture()
    fireEvent.change(screen.getByLabelText('Nature'), { target: { value: 'fnp' } })
    expect(screen.queryByLabelText('TVA d’attente')).toBeNull()
    expect(screen.getByLabelText('Montant toutes taxes comprises')).toBeTruthy()
  })

  it('le prorata se PROPOSE sur la pièce et sa période ; « Reprendre ce montant » le copie, le montant écrit reste celui du cabinet', async () => {
    rendre()
    await attendreLaLecture()
    remplir({ resultat: '616000', objet: 'Assurance', debut: '2025-07-01', fin: '2026-06-30', piece: '2 400,00' })
    expect(texte()).toMatch(/181 jour\(s\) sur 365 courent après le 31\/12\/2025 \(jours réels\)/)
    await act(async () => { bouton('Reprendre ce montant').click() })
    const proposee = (screen.getByLabelText(/^Montant (hors taxes|toutes taxes comprises)$/) as HTMLInputElement).value
    expect(proposee).toMatch(/^\d+,\d{2}$/)
    await act(async () => { boutonDuFormulaire('Enregistrer').click() })
    expect(faux.rpcs[0].args.p_operation).toMatchObject({ periode_debut: '2025-07-01', periode_fin: '2026-06-30' })
  })

  it('deux clics dans le même rendu ne partent qu’une fois, et ne demandent qu’une confirmation', async () => {
    rendre()
    await attendreLaLecture()
    remplir({ resultat: '616000', montant: '600', objet: 'Assurance' })
    faux.retenirRpc = true
    const b = boutonDuFormulaire('Enregistrer')
    await act(async () => { b.click(); b.click() })
    expect(faux.rpcs).toEqual([])
    expect(window.confirm).toHaveBeenCalledTimes(1)
    expect(boutonDuFormulaire('Écriture…').disabled).toBe(true)
    await act(async () => { faux.relacherRpc!() })
    await waitFor(() => expect(faux.rpcs).toHaveLength(1))
    await screen.findByText('Régularisation enregistrée : Assurance.')
  })

  it('un refus de la base est lu et dit avec sa raison, l’inventaire est relu, et la saisie reste pour être corrigée', async () => {
    rendre()
    await attendreLaLecture()
    remplir({ resultat: '616000', montant: '600', objet: 'Assurance' })
    faux.refus = 'Cet exercice est validé : ses écritures d’inventaire ne changent plus.'
    await act(async () => { boutonDuFormulaire('Enregistrer').click() })
    const alerte = await screen.findByText(/La régularisation n’a pas été enregistrée/)
    expect(alerte.textContent).toBe('La régularisation n’a pas été enregistrée : Cet exercice est validé : ses écritures d’inventaire ne changent plus.')
    expect(faux.demandes).toEqual([D, D])
    expect((screen.getByLabelText(/^Montant (hors taxes|toutes taxes comprises)$/) as HTMLInputElement).value).toBe('600')
    expect(boutonDuFormulaire('Enregistrer').disabled).toBe(false)
  })
})

describe('remplacer et retirer une régularisation', () => {
  it('« Remplacer » remplit le formulaire de ce que la base porte et retient sa version, son identifiant et sa pièce citée', async () => {
    faux.donnees = donnees({ operations: [operation({ id: 'o1', version: 4, piece_citee_id: 'pa', periode_debut: '2025-07-01', periode_fin: '2026-06-30' })] })
    rendre()
    await attendreLaLecture()
    await act(async () => { within(ligne(/Assurance du local/)).getByRole('button', { name: 'Remplacer' }).click() })
    expect(texte()).toContain('Remplacer « Assurance du local »')
    expect((screen.getByLabelText(/^Montant (hors taxes|toutes taxes comprises)$/) as HTMLInputElement).value).toBe('600,00')
    expect((screen.getByLabelText('Nature') as HTMLSelectElement).disabled).toBe(true)
    remplir({ montant: '700' })
    await act(async () => { boutonDuFormulaire('Remplacer').click() })
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Remplacer cette régularisation ?'))
    expect(faux.rpcs[0].nom).toBe('enregistrer_operation_inventaire')
    expect(faux.rpcs[0].args.p_version_lue).toBe(4)
    expect(faux.rpcs[0].args.p_operation).toMatchObject({ id: 'o1', piece_citee_id: 'pa', montant_centimes: 70_000, periode_debut: '2025-07-01' })
    await screen.findByText('Régularisation remplacée : Assurance du local.')
    expect(texte()).toContain('Saisir une régularisation')
  })

  it('« Annuler le remplacement » remet la saisie à zéro, sans écrire', async () => {
    rendre()
    await attendreLaLecture()
    await act(async () => { within(ligne(/Assurance du local/)).getByRole('button', { name: 'Remplacer' }).click() })
    await act(async () => { bouton('Annuler le remplacement').click() })
    expect(texte()).toContain('Saisir une régularisation')
    expect(faux.rpcs).toEqual([])
  })

  it('« Retirer » nomme ce qui part, passe l’identifiant et la version lue, et relit', async () => {
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValue(true)
    rendre()
    await attendreLaLecture()
    await act(async () => { within(ligne(/Assurance du local/)).getByRole('button', { name: 'Retirer' }).click() })
    const demande = sans(confirmer.mock.calls[0][0])
    expect(demande).toContain('« Assurance du local »')
    expect(demande).toContain('31/12/2025')
    expect(demande).toContain('01/01/2026')
    expect(faux.rpcs).toEqual([{ nom: 'retirer_operation_inventaire', args: { p_id: 'o1', p_version_lue: 2 } }])
    await screen.findByText('Retiré : Assurance du local.')
    expect(texte()).toContain('Aucune régularisation saisie')
  })

  it('une confirmation refusée n’écrit rien ; deux clics dans le même rendu ne partent qu’une fois', async () => {
    const confirmer = vi.spyOn(window, 'confirm').mockReturnValueOnce(false)
    rendre()
    await attendreLaLecture()
    await act(async () => { within(ligne(/Assurance du local/)).getByRole('button', { name: 'Retirer' }).click() })
    expect(faux.rpcs).toEqual([])
    confirmer.mockReturnValue(true)
    faux.retenirRpc = true
    const b = within(ligne(/Assurance du local/)).getByRole('button', { name: 'Retirer' })
    await act(async () => { b.click(); b.click() })
    await act(async () => { faux.relacherRpc!() })
    await waitFor(() => expect(faux.rpcs).toHaveLength(1))
  })
})

describe('les provisions', () => {
  const litige = provision({ id: 'p1' })

  it('ouvre une provision sur l’exercice affiché : le plan propose son compte, rien n’est écrit comme écriture', async () => {
    rendre()
    await attendreLaLecture()
    expect((screen.getByLabelText('Compte de la provision') as HTMLInputElement).value).toBe('151110')
    fireEvent.change(screen.getByLabelText(/^Objet \(il part au FEC\)$/), { target: { value: 'Litige avec un fournisseur' } })
    await act(async () => { bouton('Ouvrir la provision').click() })
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Aucune écriture ne part'))
    expect(faux.rpcs).toEqual([{
      nom: 'enregistrer_provision',
      args: {
        p_dossier_id: D, p_version_lue: null,
        p_provision: {
          id: null, genre: 'risque', compte_provision: '151110', objet: 'Litige avec un fournisseur', ouverte_en: 2025, facture_id: null,
          piece_citee_id: null, reprise_centimes: null,
        },
      },
    }])
    await screen.findByText('Provision ouverte : Litige avec un fournisseur.')
    expect(ligne(/Litige avec un fournisseur/)).toBeTruthy()
  })

  it('la part reprise du solde ne s’offre qu’au premier exercice du dossier', async () => {
    rendre()
    await attendreLaLecture()
    expect(screen.queryByLabelText('Part du solde repris de son compte')).toBeNull()
    cleanup()
    faux.donnees = donnees({ premierExercice: 2025 })
    rendre()
    await attendreLaLecture()
    expect(screen.getByLabelText('Part du solde repris de son compte')).toBeTruthy()
  })

  it('refuse avant le clic une provision hors de sa racine', async () => {
    rendre()
    await attendreLaLecture()
    fireEvent.change(screen.getByLabelText(/^Objet \(il part au FEC\)$/), { target: { value: 'Litige' } })
    fireEvent.change(screen.getByLabelText('Compte de la provision'), { target: { value: '491100' } })
    expect(texte()).toContain(MOTS_DES_REFUS.compteDeProvision.risque)
    expect(bouton('Ouvrir la provision').disabled).toBe(true)
  })

  it('évalue au 31 décembre : l’écart se dit avant le clic, et la base reçoit la cible et l’écriture par différence', async () => {
    faux.donnees = donnees({ provisions: [litige] })
    rendre()
    await attendreLaLecture()
    fireEvent.change(screen.getByLabelText('Cible de « Litige avec un fournisseur » au 31/12/2025'), { target: { value: '5 000,00' } })
    expect(texte()).toContain(`${euros(0)} au 31/12/2024 : dotation de ${euros(500_000)}.`.replace(/[\u00a0\u202f]/g, ' '))
    await act(async () => { bouton('Évaluer').click() })
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Débit 681510'))
    expect(faux.rpcs).toHaveLength(1)
    const { nom, args } = faux.rpcs[0]
    expect(nom).toBe('enregistrer_evaluation_provision')
    expect(args.p_evaluation).toEqual({ provision_id: 'p1', exercice: 2025, cible_centimes: 500_000 })
    expect(args.p_version_lue).toBeNull()
    expect(args.p_ecritures).toEqual([{
      date: '2025-12-31', journal: 'OD', libelle: 'Dotation 31/12/2025 — Provision pour risques — Litige avec un fournisseur',
      lignes: [{ compte: '681510', sens: 'debit', centimes: 500_000 }, { compte: '151110', sens: 'credit', centimes: 500_000 }],
    }])
    await screen.findByText('Provision évaluée : Litige avec un fournisseur.')
    expect(texte()).toContain(`Évaluée à ${euros(500_000)}`.replace(/[\u00a0\u202f]/g, ' '))
  })

  it('une cible illisible ou une provision soldée se dit avant le clic, et aucun geste ne part', async () => {
    faux.donnees = donnees({ provisions: [litige], operations: [operation({ id: 'e24', exercice: 2024, nature: 'provision', provision_id: 'p1', montant_centimes: 0 })] })
    rendre()
    await attendreLaLecture()
    const champ = screen.getByLabelText('Cible de « Litige avec un fournisseur » au 31/12/2025')
    fireEvent.change(champ, { target: { value: 'abc' } })
    expect(within(ligne(/Litige avec un fournisseur/)).getByRole('alert').textContent).toContain(MOTS_DES_REFUS.cible)
    fireEvent.change(champ, { target: { value: '100' } })
    expect(within(ligne(/Litige avec un fournisseur/)).getByRole('alert').textContent).toContain('soldée')
    expect((within(ligne(/Litige avec un fournisseur/)).getByRole('button', { name: 'Évaluer' }) as HTMLButtonElement).disabled).toBe(true)
    expect(faux.rpcs).toEqual([])
  })

  it('retire une évaluation puis la provision, chacune par sa fonction et sa version lue', async () => {
    faux.donnees = donnees({ provisions: [litige], operations: [operation({ id: 'e25', nature: 'provision', provision_id: 'p1', montant_centimes: 100_000, version: 3, objet: litige.objet })] })
    rendre()
    await attendreLaLecture()
    const l = () => ligne(/Litige avec un fournisseur/)
    // Évaluée : la provision ne se retire pas avant son évaluation.
    expect((within(l()).getByRole('button', { name: 'Retirer la provision' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { within(l()).getByRole('button', { name: 'Retirer l’évaluation' }).click() })
    expect(faux.rpcs[0]).toEqual({ nom: 'retirer_operation_inventaire', args: { p_id: 'e25', p_version_lue: 3 } })
    await screen.findByText('Retiré : Litige avec un fournisseur.')
    await act(async () => { within(l()).getByRole('button', { name: 'Retirer la provision' }).click() })
    expect(faux.rpcs[1]).toEqual({ nom: 'retirer_provision', args: { p_dossier_id: D, p_id: 'p1', p_version_lue: 1 } })
    await screen.findByText('Provision retirée : Litige avec un fournisseur.')
  })
})

describe('déclarer l’inventaire', () => {
  it('déclare l’exercice clos, sous confirmation qui compte ce qui est inventorié, et le dit déclaré', async () => {
    faux.donnees = donnees({ provisions: [provision({ id: 'p1' })] })
    rendre()
    await attendreLaLecture()
    await act(async () => { bouton('Déclarer l’inventaire fait').click() })
    expect(sans(vi.mocked(window.confirm).mock.calls[0][0])).toContain('Il porte 1 régularisation(s) et 1 provision(s) ouverte(s)')
    expect(faux.rpcs).toEqual([{ nom: 'declarer_inventaire', args: { p_dossier_id: D, p_exercice: 2025 } }])
    await screen.findByText('Inventaire de l’exercice 2025 déclaré.')
    expect(texte()).toContain('Déclaré fait le 12/11/2026.')
  })

  it('un exercice pas encore clos ne se déclare pas : le refus de la base, dit avant le clic', async () => {
    rendre({ annee: 2026 })
    await attendreLaLecture()
    const b = bouton('Déclarer l’inventaire fait')
    expect(b.disabled).toBe(true)
    expect(b.title).toContain('n’est pas clos')
    expect(texte()).toContain('n’est pas clos')
    await act(async () => { b.click() })
    expect(faux.rpcs).toEqual([])
  })

  it('se retire tant que l’exercice n’est pas validé ; validé, le bouton est refusé avec sa raison', async () => {
    faux.donnees = donnees({ declarations: [{ id: 'i1', dossier_id: D, exercice: 2025, declare_par: 'u', declare_le: '2026-11-11T10:00:00Z', retire_par: null, retire_le: null }] })
    rendre()
    await attendreLaLecture()
    expect(texte()).toContain('Déclaré fait le 11/11/2026.')
    await act(async () => { bouton('Retirer la déclaration').click() })
    expect(faux.rpcs).toEqual([{ nom: 'retirer_declaration_inventaire', args: { p_id: 'i1' } }])
    await screen.findByText('Déclaration retirée pour l’exercice 2025.')
    expect(texte()).toContain('Non déclaré')
    cleanup()
    faux.donnees = donnees({ declarations: [{ id: 'i1', dossier_id: D, exercice: 2025, declare_par: 'u', declare_le: '2026-11-11T10:00:00Z', retire_par: null, retire_le: null }] })
    rendre({ valides: [2025] })
    await attendreLaLecture()
    expect(bouton('Retirer la déclaration').disabled).toBe(true)
    expect(texte()).toContain('est validé')
  })

  it('deux clics dans le même rendu ne déclarent qu’une fois', async () => {
    rendre()
    await attendreLaLecture()
    faux.retenirRpc = true
    const b = bouton('Déclarer l’inventaire fait')
    await act(async () => { b.click(); b.click() })
    await act(async () => { faux.relacherRpc!() })
    await waitFor(() => expect(faux.rpcs).toHaveLength(1))
    expect(window.confirm).toHaveBeenCalledTimes(1)
  })
})

describe('l’état d’inventaire', () => {
  it('le CSV se télécharge : un BOM, le nom du fichier, les lignes de l’état — sans rien écrire en base', async () => {
    rendre()
    await attendreLaLecture()
    await act(async () => { bouton('Télécharger l’état (CSV)').click() })
    expect(faux.telechargements).toHaveLength(1)
    expect(faux.telechargements[0].nom).toBe('inventaire-2025-societe-fictive.csv')
    expect(faux.telechargements[0].contenu.charCodeAt(0)).toBe(0xfeff)
    expect(faux.telechargements[0].contenu).toContain('Assurance du local')
    expect(faux.rpcs).toEqual([])
  })

  it('le PDF se tire et se télécharge sous son verrou : deux clics dans le même rendu n’en tirent qu’un', async () => {
    rendre()
    await attendreLaLecture()
    faux.retenirLePdf = true
    const b = bouton('Télécharger l’état (PDF)')
    await act(async () => { b.click(); b.click() })
    expect(faux.pdfs).toEqual([])
    expect(bouton('Télécharger l’état (PDF)').disabled).toBe(true)
    await act(async () => { faux.relacherLePdf!() })
    await waitFor(() => expect(faux.pdfs).toEqual(['inventaire-2025-societe-fictive.pdf']))
    expect(faux.rpcs).toEqual([])
  })
})

describe('un dossier quitté ne laisse rien derrière lui', () => {
  it('la réponse d’un dossier quitté n’écrit rien sur le suivant, et le suivant se relit', async () => {
    faux.retenue = new Promise<void>((r) => { faux.relacher = r })
    const { versDossier } = rendre({ dossierId: 'dossier-A' })
    versDossier('dossier-B')
    expect(screen.getByText('Chargement…')).toBeTruthy()
    await act(async () => { faux.relacher!() })
    await attendreLaLecture()
    expect(faux.demandes).toEqual(['dossier-A', 'dossier-B'])
    expect(screen.queryAllByRole('form')).toHaveLength(2)
  })
})

// LA PIÈCE CITÉE (INV5-Q1 (B)) : la pièce d'une régularisation, la pièce ou la facture d'une provision, se choisissent dans
// l'onglet, parmi les pièces et factures du dossier lues EN ENTIER à part ; le choix part avec l'écriture, la confirmation le nomme.
describe('la pièce citée, choisie dans l’onglet', () => {
  const formulaireDeLaProvision = () => screen.getByRole('form', { name: 'Ouverture d’une provision' })

  it('avant le retour des pièces : « Chargement des pièces du dossier… », aucun choix ; la saisie reste offerte', async () => {
    faux.retenueDesJustificatifs = new Promise<void>((r) => { faux.relacherLesJustificatifs = r })
    rendre()
    await attendreLaLecture()
    expect(within(formulaire()).getByText('Chargement des pièces du dossier…')).toBeTruthy()
    expect(within(formulaire()).queryByRole('button', { name: 'Choisir une pièce' })).toBeNull()
    await act(async () => { faux.relacherLesJustificatifs!() })
    expect(within(formulaire()).getByRole('button', { name: 'Choisir une pièce' })).toBeTruthy()
    expect(faux.demandesDesJustificatifs).toEqual([D])
  })

  it('lues en partie : le dit, n’offre aucun choix, et une régularisation remplacée garde la pièce qu’elle cite', async () => {
    faux.justificatifs = (dossierId) => ({ dossierId, etat: 'incomplete', motif: 'les pièces : lecture interrompue après 500 ligne(s) : délai dépassé' })
    faux.donnees = donnees({ operations: [operation({ id: 'o1', piece_citee_id: 'pa' })] })
    rendre()
    await attendreLaLecture()
    expect(sans(formulaire().textContent)).toContain('Les pièces du dossier n\'ont pas pu être lues en entier (les pièces : lecture interrompue')
    expect(within(formulaire()).queryByRole('button', { name: /Choisir|Changer|Ne rien citer/ })).toBeNull()
    expect(texte()).toContain('Cite une pièce du dossier.')
    act(() => { within(ligne(/Assurance du local/)).getByRole('button', { name: 'Remplacer' }).click() })
    remplir({ montant: '700,00' })
    await act(async () => { boutonDuFormulaire('Remplacer').click() })
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Pièce citée : celle qui était déjà citée.'))
    expect((faux.rpcs[0].args.p_operation as Record<string, unknown>).piece_citee_id).toBe('pa')
  })

  it('une régularisation : toutes les pièces du dossier se proposent, la recherche commune les filtre, le choix part avec l’écriture', async () => {
    rendre()
    await attendreLaLecture()
    act(() => { within(formulaire()).getByRole('button', { name: 'Choisir une pièce' }).click() })
    const liste = within(formulaire()).getByRole('list', { name: 'Choisir une pièce' })
    // Les trois pièces, quel que soit leur sens ; aucune facture émise ; chaque nom de fichier sous `.nom-fichier`.
    expect([...liste.querySelectorAll('.nom-fichier')].map((n) => n.textContent)).toEqual(['honoraires-janvier.pdf', 'vente-client.pdf', 'assurance-local-2025.pdf'])
    expect(liste.textContent).not.toContain('F2025-007')
    fireEvent.change(within(formulaire()).getByRole('searchbox'), { target: { value: 'assureur' } })
    expect(within(formulaire()).getAllByRole('listitem')).toHaveLength(1)
    act(() => { within(formulaire()).getByRole('button', { name: /assurance-local-2025\.pdf/ }).click() })
    expect(within(formulaire()).queryByRole('list', { name: 'Choisir une pièce' })).toBeNull()
    expect(formulaire().querySelector('.nom-fichier')?.textContent).toBe('assurance-local-2025.pdf')
    remplir({ resultat: '616000', montant: '600,00', objet: 'Assurance du local, 2e semestre' })
    await act(async () => { boutonDuFormulaire('Enregistrer').click() })
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Pièce citée : « assurance-local-2025.pdf »'))
    expect((faux.rpcs[0].args.p_operation as Record<string, unknown>).piece_citee_id).toBe('pa')
    await screen.findByText('Régularisation enregistrée : Assurance du local, 2e semestre.')
    // Enregistrée, la saisie se vide ; la liste dit la pièce que la régularisation cite.
    expect(within(formulaire()).getByRole('button', { name: 'Choisir une pièce' })).toBeTruthy()
    expect(ligne(/2e semestre/).querySelector('.nom-fichier')?.textContent).toBe('assurance-local-2025.pdf')
  })

  it('une saisie qui remplace propose la pièce déjà citée ; « Ne rien citer » la retire de ce qui part', async () => {
    faux.donnees = donnees({ operations: [operation({ id: 'o1', piece_citee_id: 'pa' })] })
    rendre()
    await attendreLaLecture()
    act(() => { within(ligne(/Assurance du local/)).getByRole('button', { name: 'Remplacer' }).click() })
    expect(formulaire().querySelector('.nom-fichier')?.textContent).toBe('assurance-local-2025.pdf')
    expect(boutonDuFormulaire('Changer')).toBeTruthy()
    act(() => { boutonDuFormulaire('Ne rien citer').click() })
    expect(boutonDuFormulaire('Choisir une pièce')).toBeTruthy()
    await act(async () => { boutonDuFormulaire('Remplacer').click() })
    expect(faux.rpcs[0].args.p_operation).toMatchObject({ id: 'o1', piece_citee_id: null })
    expect(faux.rpcs[0].args.p_version_lue).toBe(2)
  })

  it('une provision pour risques se voit proposer les pièces, jamais une facture', async () => {
    rendre()
    await attendreLaLecture()
    act(() => { within(formulaireDeLaProvision()).getByRole('button', { name: 'Choisir une pièce' }).click() })
    const liste = within(formulaireDeLaProvision()).getByRole('list', { name: 'Choisir une pièce' })
    expect(within(liste).getAllByRole('listitem')).toHaveLength(3)
    expect(liste.textContent).not.toContain('Facture')
  })

  it('une dépréciation de créance : la facture validée et la pièce de vente, jamais un avoir ; la facture part dans `facture_id`', async () => {
    rendre()
    await attendreLaLecture()
    fireEvent.change(screen.getByLabelText('Genre'), { target: { value: 'depreciation_creance' } })
    fireEvent.change(screen.getByLabelText(/^Objet \(il part au FEC\)$/), { target: { value: 'Créance douteuse' } })
    act(() => { within(formulaireDeLaProvision()).getByRole('button', { name: 'Choisir une facture ou une pièce de vente' }).click() })
    const liste = within(formulaireDeLaProvision()).getByRole('list', { name: 'Choisir une facture ou une pièce de vente' })
    expect(within(liste).getAllByRole('listitem')).toHaveLength(2)
    expect(liste.textContent).toContain('Facture F2025-007')
    expect(liste.textContent).toContain('vente-client.pdf')
    expect(liste.textContent).not.toContain('A2025-001')
    act(() => { within(liste).getByRole('button', { name: /Facture F2025-007/ }).click() })
    await act(async () => { bouton('Ouvrir la provision').click() })
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Facture citée : Facture F2025-007'))
    expect(faux.rpcs[0].args.p_provision).toMatchObject({ genre: 'depreciation_creance', facture_id: 'f1', piece_citee_id: null })
    await screen.findByText('Provision ouverte : Créance douteuse.')
    expect(sans(ligne(/Créance douteuse/).textContent)).toContain('Cite la facture F2025-007')
  })

  it('une facture citée puis le genre ramené au risque : le refus de la base se dit avant le clic, rien ne part', async () => {
    rendre()
    await attendreLaLecture()
    fireEvent.change(screen.getByLabelText('Genre'), { target: { value: 'depreciation_creance' } })
    fireEvent.change(screen.getByLabelText(/^Objet \(il part au FEC\)$/), { target: { value: 'Créance douteuse' } })
    act(() => { within(formulaireDeLaProvision()).getByRole('button', { name: 'Choisir une facture ou une pièce de vente' }).click() })
    act(() => { within(formulaireDeLaProvision()).getByRole('button', { name: /Facture F2025-007/ }).click() })
    fireEvent.change(screen.getByLabelText('Genre'), { target: { value: 'risque' } })
    expect(sans(formulaireDeLaProvision().textContent)).toContain(MOTS_DES_JUSTIFICATIFS.factureHorsDeLaDepreciation)
    expect(bouton('Ouvrir la provision').disabled).toBe(true)
    await act(async () => { bouton('Ouvrir la provision').click() })
    expect(faux.rpcs).toEqual([])
  })
})
