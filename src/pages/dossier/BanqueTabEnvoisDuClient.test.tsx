import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContexteDossier } from '../../test/exercicesValides'
import BanqueTab from './BanqueTab'
import { EmplacementPanneauDroit, FournisseurPanneauDroit } from '../../components/PanneauDroit'
import type { JustificatifPropose, LigneBancaire, Piece, PrecisionMouvement } from '../../lib/types'
import type { ModeleComptable } from '../../lib/engagement'
import { PLAN_PAR_DEFAUT } from '../../lib/planComptable'

// « MA BANQUE », CÔTÉ CABINET (espace client, étape P9b) : ce que le client a envoyé pour un mouvement, dans sa fiche et
// dans l'onglet Banque. Ce que ces cas gardent et qu'aucun calcul pur ne voit : la pièce proposée EN TÊTE de la fiche,
// nommée et son auteur reconnu parmi les accès (un accès retiré n'est pas deviné) ; « Associer cette pièce » par le
// chemin du rapprochement, sous le verrou de l'écran (deux clics, puis trois, dans le même `act`) ; ce qu'il advient de la
// proposition une fois le mouvement rapproché, ou sa pièce payée ailleurs ; le fil et « Demander au client » par
// `ecrire_precision_mouvement` seule, sous le même verrou relâché après la relecture ; le filtre « Proposés par le client »,
// qui ne change que la liste affichée ; et sur une lecture partielle ou pas encore revenue, rien de dit ni d'offert.

const faux = vi.hoisted(() => ({
  lignes: [] as LigneBancaire[],
  pieces: [] as Piece[],
  propositions: [] as JustificatifPropose[],
  precisions: [] as PrecisionMouvement[],
  memberships: [] as { id: string; dossier_id: string; user_id: string; droit_banque: boolean; created_at: string }[],
  // Par table : le serveur ne rend que N lignes en annonçant le vrai total (une lecture INCOMPLÈTE).
  muet: {} as Record<string, number>,
  // Par table : la PROCHAINE lecture retenue jusqu'à `liberer` (une relecture pas encore revenue).
  retenir: {} as Record<string, boolean>,
  liberer: [] as (() => void)[],
  updatesLignes: [] as Record<string, unknown>[],
  retenirUpdate: false,
  resoudreUpdate: null as null | (() => void),
  rpcs: [] as { nom: string; args: Record<string, unknown> }[],
  retenirRpc: false,
  resoudreRpc: null as null | (() => void),
  erreurRpc: null as string | null,
}))

vi.mock('../../lib/pdfText', () => ({ extractPdfLignes: async () => [] }))
const justificatifs = vi.hoisted(() => ({ ouverts: [] as string[] }))
vi.mock('../../lib/depot', () => ({
  ouvrirJustificatif: async (chemin: string) => { justificatifs.ouverts.push(chemin) },
}))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatIn } = await import('../../test/filtresPostgrest')
  // Les tables que ces cas regardent : servies FILTRÉES et paginées comme la requête le demande. Les autres rendent une
  // liste lue, vide — rien de ce qu'elles portent n'intervient ici.
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
    let valeurMaj: Record<string, unknown> = {}
    let idFiltre: unknown = null
    const appels: [string, unknown[]][] = []
    let debut = 0
    let fin = Number.MAX_SAFE_INTEGER
    const c: Record<string, unknown> = {}
    const soi = () => c
    Object.assign(c, {
      select: soi, order: soi, neq: soi, gte: soi, lte: soi, lt: soi, gt: soi, is: soi, not: soi, or: soi, limit: soi,
      eq: (colonne: string, valeur: unknown) => { if (colonne === 'id') idFiltre = valeur; appels.push(['eq', [colonne, valeur]]); return c },
      in: (colonne: string, valeurs: unknown[]) => { appels.push(['in', [colonne, valeurs]]); return c },
      range: (d: number, f: number) => { debut = d; fin = f; return c },
      maybeSingle: () => { unique = true; return c },
      single: () => { unique = true; return c },
      update: (valeur: Record<string, unknown>) => { operation = 'update'; valeurMaj = valeur; return c },
      insert: () => { operation = 'insert'; return c },
      upsert: () => { operation = 'upsert'; return c },
      delete: () => { operation = 'delete'; return c },
      then: (suite: (r: unknown) => unknown, echec?: (e: unknown) => unknown) => {
        if (table === 'lignes_bancaires' && operation === 'update') {
          faux.updatesLignes.push(valeurMaj)
          const appliquer = () => {
            faux.lignes = faux.lignes.map((l) => (l.id === idFiltre ? { ...l, ...valeurMaj } as LigneBancaire : l))
          }
          if (faux.retenirUpdate) {
            return new Promise((resoudre) => {
              faux.resoudreUpdate = () => { appliquer(); resoudre({ data: null, error: null }) }
            }).then(suite, echec)
          }
          appliquer()
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
  // La seule fonction SQL que ces cas appellent : la question du cabinet, que le faux serveur ÉCRIT au fil comme la vraie
  // (origine déduite : le cabinet), pour que la relecture la montre.
  function rpc(nom: string, args: Record<string, unknown>) {
    faux.rpcs.push({ nom, args })
    if (nom !== 'ecrire_precision_mouvement') throw new Error(`Fonction non attendue dans ce test : ${nom}`)
    const repondre = () => {
      if (faux.erreurRpc) return { data: null, error: { message: faux.erreurRpc } }
      faux.precisions = [...faux.precisions, {
        id: `q-${faux.precisions.length + 1}`, dossier_id: String(args.p_dossier_id), ligne_bancaire_id: String(args.p_ligne_bancaire_id),
        auteur_id: 'cabinet-1', origine: 'cabinet', texte: String(args.p_texte), created_at: '2026-06-08T10:00:00Z',
      }]
      return { data: faux.precisions.at(-1), error: null }
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
    reglement_groupe: false, compte_bilan: null, declaration_tva_id: null, id_externe: null, created_at: '2026-06-02T09:00:00Z', ...o,
  }
}

function pieceDeTest(o: Partial<Piece> = {}): Piece {
  return {
    id: 'piece-p', dossier_id: 'dossier-de-test', uploaded_by: 'client-1', source: 'upload', storage_path: 'dossier/proposee.pdf',
    nom_fichier: 'proposee.pdf', storage_hash: null, date_piece: '2026-06-01', tiers: 'Atelier fictif', montant_ht: null, montant_tva: null,
    montant_ttc: 100, devise: 'EUR', montant_devise: null, taux_change: null, conversion_source: null, categorie_id: null,
    sous_dossier_id: null, type_piece: 'achat', statut: 'a_valider', notes: null, confiance: null, superpdp_invoice_id: null,
    flux_hote: null, flux_id: null, lisible_path: null, identite_numero: null, identite_siren_vendeur: null, identite_date: null,
    identite_nature: null, created_at: '2026-06-01T09:00:00Z', updated_at: '2026-06-01T09:00:00Z', ...o,
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
  faux.updatesLignes = []
  faux.retenirUpdate = false
  faux.resoudreUpdate = null
  faux.rpcs = []
  faux.retenirRpc = false
  faux.resoudreRpc = null
  faux.erreurRpc = null
  justificatifs.ouverts = []
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '455000', plan: PLAN_PAR_DEFAUT }

function rendre(valides: readonly number[] = []) {
  return render(
    <FournisseurPanneauDroit>
      <ContexteDossier annee="toutes" valides={valides}>
        <BanqueTab dossierId="dossier-de-test" modele={TRESORERIE} assujettiTva={false} />
      </ContexteDossier>
      <EmplacementPanneauDroit />
    </FournisseurPanneauDroit>,
  )
}

const volet = () => screen.getByRole('complementary', { name: 'Panneau contextuel' })
const texteDe = (e: Element) => (e.textContent ?? '').replace(/\s/g, ' ')

// Par la ligne du relevé, cherchée HORS de l'`act` (dedans, React retient le chargement).
async function ouvrir(libelle = 'PRLV SEPA FICTIF') {
  const cellules = await screen.findAllByText(libelle)
  const cellule = cellules.find((e) => e.closest('tr')?.classList.contains('clickable'))
  if (!cellule) throw new Error(`Aucune ligne du relevé ne porte « ${libelle} »`)
  await act(async () => { cellule.click() })
}

describe('la pièce proposée par le client, en tête de la fiche', () => {
  it('nommée, son auteur reconnu parmi les accès, avant ce que le rapprochement propose de lui-même', async () => {
    rendre()
    await ouvrir()
    const v = volet()
    const titre = within(v).getByRole('heading', { name: 'Pièce proposée par le client' })
    expect(within(v).getByText('Proposée par le client le 05/06/2026')).toBeTruthy()
    // En tête : avant le choix à la main, qui offre pourtant la même pièce.
    const choix = within(v).getByRole('heading', { name: 'Choisir une autre pièce' })
    // Une pièce proposée par le client n'est pas « aucune pièce proposée ».
    expect(within(v).queryByText('Aucune pièce proposée pour ce mouvement.')).toBeNull()
    expect(titre.compareDocumentPosition(choix) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(v).getByText('Pièce à valider : ses montants n’ont pas encore été relus')).toBeTruthy()
    expect(within(v).getByText('Même montant, au centime près')).toBeTruthy()
    expect(texteDe(within(v).getByText(/Dans « Ma banque »/))).toBe('Dans « Ma banque », le client voit ce mouvement « Justificatif envoyé ».')
    // La liste le marque aussi.
    expect(screen.getByText('Pièce proposée par le client', { selector: '.badge' })).toBeTruthy()
  })

  it('« Voir le justificatif » ouvre le fichier de la pièce proposée', async () => {
    rendre()
    await ouvrir()
    const carte = within(volet()).getByText('Proposée par le client le 05/06/2026').closest('.carte-rapprochement') as HTMLElement
    await act(async () => { within(carte).getByRole('button', { name: 'Voir le justificatif' }).click() })
    expect(justificatifs.ouverts).toEqual(['dossier/proposee.pdf'])
  })

  it('un accès retiré n’est pas deviné ; des accès lus en partie ne reconnaissent personne', async () => {
    faux.memberships = []
    rendre()
    await ouvrir()
    expect(within(volet()).getByText('Proposée depuis l’espace client le 05/06/2026, par un compte qui ne porte plus d’accès à ce dossier')).toBeTruthy()
    expect(within(volet()).queryByText(/Proposée par le client/)).toBeNull()
    cleanup()

    faux.memberships = [ACCES_CLIENT, { ...ACCES_CLIENT, id: 'm-2', user_id: 'client-2' }]
    faux.muet = { memberships: 1 }
    rendre()
    await ouvrir()
    expect(within(volet()).getByText(/^Proposée depuis l’espace client le 05\/06\/2026 \(les accès du dossier n’ont pas été lus en entier/)).toBeTruthy()
    expect(within(volet()).queryByText(/Proposée par le client/)).toBeNull()
  })

  it('une pièce déjà rapprochée d’un autre mouvement : dit, et rien à associer', async () => {
    faux.lignes = [ligneDeTest(), ligneDeTest({ id: 'ligne-2', libelle: 'PRLV AUTRE FICTIF', date: '2026-05-30', statut: 'rapprochee', piece_id: 'piece-p' })]
    rendre()
    await ouvrir()
    const v = volet()
    expect(texteDe(within(v).getByText(/déjà rapprochée d’un autre mouvement/)))
      .toBe('Cette pièce est déjà rapprochée d’un autre mouvement (30/05/2026, -100,00 €) : elle ne s’associe pas à celui-ci.')
    expect(within(v).queryByRole('button', { name: 'Associer cette pièce' })).toBeNull()
  })

  it('un mouvement figé par un exercice validé : rien à associer', async () => {
    rendre([2026])
    await ouvrir()
    expect(within(volet()).getByText(/ce mouvement ne se rapproche plus, la pièce proposée ne s’y associe pas/)).toBeTruthy()
    expect(within(volet()).queryByRole('button', { name: 'Associer cette pièce' })).toBeNull()
  })
})

describe('« Associer cette pièce » : le chemin du rapprochement, sous le verrou de l’écran', () => {
  it('deux clics dans le même act : une écriture ; puis trois : toujours une ; et la proposition se dit retenue', async () => {
    faux.retenirUpdate = true
    rendre()
    await ouvrir()
    const bouton = within(volet()).getByRole('button', { name: 'Associer cette pièce' })
    await act(async () => { bouton.click(); bouton.click() })
    expect(faux.updatesLignes).toEqual([{ statut: 'rapprochee', piece_id: 'piece-p' }])
    // Pendant l'écriture, le bouton se grise : le verrou ne se devine pas, il se voit.
    expect((bouton as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(faux.updatesLignes).toHaveLength(1)

    await act(async () => { faux.resoudreUpdate?.() })
    await waitFor(() => expect(within(volet()).getByText(/^Retenue : ce mouvement est rapproché de cette pièce/)).toBeTruthy())
    expect(faux.updatesLignes).toHaveLength(1)
    expect(within(volet()).queryByRole('button', { name: 'Associer cette pièce' })).toBeNull()
    expect(texteDe(within(volet()).getByText(/Dans « Ma banque »/))).toBe('Dans « Ma banque », le client voit ce mouvement « Justifié par une pièce ».')
  })
})

describe('une lecture partielle, ou pas encore revenue : rien n’est dit ni offert', () => {
  it('les propositions lues en partie : le motif, ni carte, ni « Associer », ni question, ni filtre, ni pastille', async () => {
    faux.propositions = [propositionDeTest(), propositionDeTest({ id: 'prop-2', piece_id: 'piece-x' })]
    faux.muet = { justificatifs_proposes: 1 }
    rendre()
    await ouvrir()
    const v = volet()
    expect(within(v).getAllByText(/^Rien n’est dit de ce que le client a envoyé : les pièces proposées n’ont pas été lues en entier/).length).toBeGreaterThan(0)
    expect(within(v).queryByText(/Proposée par le client/)).toBeNull()
    expect(within(v).queryByRole('button', { name: 'Associer cette pièce' })).toBeNull()
    expect((within(v).getByRole('button', { name: 'Demander au client' }) as HTMLButtonElement).disabled).toBe(true)
    // Le champ aussi : une question tapée sur un fil qu'on n'a pas lu ne partirait pas plus.
    expect((within(v).getByLabelText(/Ta question sur ce mouvement/) as HTMLTextAreaElement).disabled).toBe(true)
    expect(within(v).getByText(/Le fil de ce mouvement n’a pas été lu en entier/)).toBeTruthy()
    const caseFiltre = screen.getByRole('checkbox', { name: 'Proposés par le client' }) as HTMLInputElement
    expect(caseFiltre.disabled).toBe(true)
    expect(screen.queryByText('Pièce proposée par le client', { selector: '.badge' })).toBeNull()
  })

  it('le fil lu en partie : la même chose', async () => {
    faux.precisions = [precisionDeTest(), precisionDeTest({ id: 'q-b' })]
    faux.muet = { precisions_mouvements: 1 }
    rendre()
    await ouvrir()
    expect(within(volet()).queryByText(/Proposée par le client/)).toBeNull()
    expect(within(volet()).queryByText('À quoi correspond ce prélèvement ?')).toBeNull()
    expect((within(volet()).getByRole('button', { name: 'Demander au client' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('le fil et « Demander au client »', () => {
  it('les messages datés, leur auteur ; la question attend une réponse', async () => {
    faux.precisions = [
      precisionDeTest(),
      precisionDeTest({ id: 'q-b', origine: 'client', auteur_id: 'client-1', texte: 'Le logiciel du cabinet médical.', created_at: '2026-06-07T10:00:00Z' }),
    ]
    rendre()
    await ouvrir()
    const fil = within(volet()).getByRole('region', { name: 'Échanges avec le client' })
    // Chaque message porte son geste « Supprimer ce message » (P9b2, BanqueTabEcarterSupprimer.test.tsx) : le texte du
    // message est lu SANS lui.
    const messages = within(fil).getAllByRole('listitem').map((li) => texteDe(li).replace(/Supprimer ce message$/, ''))
    expect(messages).toEqual([
      'Le cabinet, le 06/06/2026 : À quoi correspond ce prélèvement ?',
      'Le client, le 07/06/2026 : Le logiciel du cabinet médical.',
    ])
    expect(within(fil).queryByText('La dernière question attend la réponse du client.')).toBeNull()
    // Le libellé dit qui lit la question.
    expect(within(fil).getByLabelText(/le client qui porte la case « Banque » la lit/)).toBeTruthy()
  })

  it('deux clics dans le même act : une question ; trois : une ; le brouillon s’efface après la relecture, qui la montre', async () => {
    faux.retenirRpc = true
    rendre()
    await ouvrir()
    const fil = within(volet()).getByRole('region', { name: 'Échanges avec le client' })
    const champ = within(fil).getByRole('textbox') as HTMLTextAreaElement
    const bouton = within(fil).getByRole('button', { name: 'Demander au client' }) as HTMLButtonElement
    expect(bouton.disabled).toBe(true)
    fireEvent.change(champ, { target: { value: 'Peux-tu envoyer la facture ?' } })
    expect(bouton.disabled).toBe(false)
    await act(async () => { bouton.click(); bouton.click() })
    expect(faux.rpcs).toEqual([{
      nom: 'ecrire_precision_mouvement',
      args: { p_dossier_id: 'dossier-de-test', p_ligne_bancaire_id: 'ligne-1', p_texte: 'Peux-tu envoyer la facture ?' },
    }])
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(faux.rpcs).toHaveLength(1)

    // La relecture retenue : le verrou tient, le fil se dit en cours, rien ne part.
    faux.retenir = { precisions_mouvements: true }
    await act(async () => { faux.resoudreRpc?.() })
    await waitFor(() => expect(within(volet()).getByText(/Le fil de ce mouvement est en cours de lecture/)).toBeTruthy())
    const boutonPendant = within(volet()).getByRole('button', { name: 'Demander au client' }) as HTMLButtonElement
    expect(boutonPendant.disabled).toBe(true)
    await act(async () => { boutonPendant.click() })
    expect(faux.rpcs).toHaveLength(1)
    expect(within(volet()).queryByRole('button', { name: 'Associer cette pièce' })).toBeNull()
    expect((screen.getByRole('checkbox', { name: 'Proposés par le client' }) as HTMLInputElement).disabled).toBe(true)

    await act(async () => { for (const f of faux.liberer.splice(0)) f() })
    const filApres = within(volet()).getByRole('region', { name: 'Échanges avec le client' })
    await waitFor(() => expect(within(filApres).getByText('Peux-tu envoyer la facture ?')).toBeTruthy())
    expect((within(filApres).getByRole('textbox') as HTMLTextAreaElement).value).toBe('')
    expect(within(filApres).getByText('La dernière question attend la réponse du client.')).toBeTruthy()
    expect((within(filApres).getByRole('button', { name: 'Demander au client' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('refusée par la base : dit, et le brouillon reste', async () => {
    faux.erreurRpc = 'Accès refusé à ce dossier.'
    const alerte = vi.spyOn(window, 'alert').mockImplementation(() => {})
    rendre()
    await ouvrir()
    const fil = within(volet()).getByRole('region', { name: 'Échanges avec le client' })
    fireEvent.change(within(fil).getByRole('textbox'), { target: { value: 'Une question' } })
    await act(async () => { within(fil).getByRole('button', { name: 'Demander au client' }).click() })
    await waitFor(() => expect(alerte).toHaveBeenCalledWith('La question n’a pas été enregistrée : Accès refusé à ce dossier.'))
    await waitFor(() => expect((within(volet()).getByRole('textbox') as HTMLTextAreaElement).value).toBe('Une question'))
  })

  it('les refus de la base dits avant le clic : vide, blancs, plus de 2 000 caractères', async () => {
    rendre()
    await ouvrir()
    const fil = within(volet()).getByRole('region', { name: 'Échanges avec le client' })
    const bouton = within(fil).getByRole('button', { name: 'Demander au client' }) as HTMLButtonElement
    fireEvent.change(within(fil).getByRole('textbox'), { target: { value: ' \n\t ' } })
    expect(bouton.disabled).toBe(true)
    fireEvent.change(within(fil).getByRole('textbox'), { target: { value: 'é'.repeat(2001) } })
    expect(bouton.disabled).toBe(true)
    expect(within(fil).getByText('Une précision tient en 2 000 caractères au plus.')).toBeTruthy()
    expect(faux.rpcs).toHaveLength(0)
  })

  it('aucun accès ne porte la case « Banque » : la question n’a pas de lecteur, et c’est dit', async () => {
    faux.memberships = [{ ...ACCES_CLIENT, droit_banque: false }]
    rendre()
    await ouvrir()
    expect(within(volet()).getByText(/^Aucun accès de ce dossier ne porte la case « Banque »/)).toBeTruthy()
  })
})

describe('le filtre « Proposés par le client »', () => {
  beforeEach(() => {
    faux.lignes = [ligneDeTest(), ligneDeTest({ id: 'ligne-2', libelle: 'PRLV AUTRE FICTIF', montant: -40, date: '2026-06-03' })]
  })

  it('ne change que la liste affichée : « N sur M » après lui, les totaux sur tout le relevé', async () => {
    rendre()
    await screen.findAllByText('PRLV AUTRE FICTIF')
    const total = () => texteDe(screen.getByText(/mouvement\(s\) bancaire\(s\) non rapproché\(s\)/))
    const avant = total()
    expect(avant).toContain('2 mouvement(s) bancaire(s) non rapproché(s) (-140,00 €)')
    const caseFiltre = screen.getByRole('checkbox', { name: 'Proposés par le client' }) as HTMLInputElement
    expect(caseFiltre.disabled).toBe(false)
    await act(async () => { caseFiltre.click() })
    expect(screen.queryAllByText('PRLV AUTRE FICTIF').filter((e) => e.closest('tr.clickable'))).toHaveLength(0)
    expect(screen.getAllByText('PRLV SEPA FICTIF').filter((e) => e.closest('tr.clickable'))).toHaveLength(1)
    expect(total()).toBe(avant)
    // « N sur M » : M après le filtre, avant la recherche.
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'PRLV' } })
    expect(screen.getByText('1 sur 1')).toBeTruthy()
    await act(async () => { caseFiltre.click() })
    expect(screen.getByText('2 sur 2')).toBeTruthy()
  })

  it('aucune ligne retenue : le dit « dans ce filtre »', async () => {
    faux.propositions = []
    rendre()
    await screen.findAllByText('PRLV AUTRE FICTIF')
    await act(async () => { (screen.getByRole('checkbox', { name: 'Proposés par le client' }) as HTMLInputElement).click() })
    expect(screen.getByText('Aucun mouvement bancaire dans ce filtre.')).toBeTruthy()
  })
})
