import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AnneeProvider } from '../../context/AnneeContext'
import { EmplacementPanneauDroit, FournisseurPanneauDroit } from '../../components/PanneauDroit'
import PiecesTab from './PiecesTab'
import type { Piece, PieceCommentaire } from '../../lib/types'
import type { Predicat } from '../../test/filtresPostgrest'
import { AVERTISSEMENT_PAIEMENT_DEFAIT } from '../../lib/controles'

// L'ÉCRAN OÙ LA PIÈCE SE CORRIGE. Cinq contrôles de la famille « donnée démontrée fausse » y
// envoient l'opérateur depuis la Checklist (`cible: 'pieces'`), et trois seulement marquaient la
// ligne : une date postérieure au dépôt et une devise non convertie annonçaient « 1 pièce,
// corrigez-la » puis renvoyaient vers une liste où RIEN ne la désigne.
//
// Ce test garde la PRÉSENCE du badge, ce qu'aucun test de `src/lib` ne peut faire : les deux
// contrôles étaient justes, ils n'étaient simplement branchés nulle part ici.
const faux = vi.hoisted(() => ({
  parTable: {} as Record<string, unknown[]>,
  // Par table, le rang au-delà duquel le serveur ne rend plus rien TOUT EN annonçant le vrai
  // total : c'est ce qui produit une lecture incomplète, pas une tranche plus courte (que
  // `lireTout` recolle, à juste titre).
  muetApres: {} as Record<string, number>,
  suppressions: [] as unknown[],
  // La base REFUSE la suppression : c'est le seul chemin qui allume l'alerte de fin de lot, et
  // c'est elle qui inventait une cause (« liées à un rapprochement bancaire ou à un pack déjà
  // généré ») au lieu de rendre la raison.
  refusSuppression: null as string | null,
  // Les mises à jour de pièces envoyées par la fiche, et de quoi retenir la réponse : c'est la
  // fenêtre pendant laquelle l'opérateur peut ouvrir une autre pièce.
  majPieces: [] as { id: unknown; valeur: Record<string, unknown> }[],
  retenueMaj: null as Promise<void> | null,
  // Les pièces dont le texte OCR est en base, et l'échec éventuel de cette lecture.
  avecTexte: new Set<string>(),
  erreurPresence: null as string | null,
  // Les fichiers retirés du stockage, appel par appel.
  retraits: [] as string[][],
}))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatNot } = await import('../../test/filtresPostgrest')
  return {
  supabase: {
    from: (table: string) => {
      const chaine: Record<string, unknown> = {}
      let operation = 'select'
      let debut = 0
      let fin = Number.MAX_SAFE_INTEGER
      let valeurMaj: Record<string, unknown> = {}
      // `.not` est APPLIQUÉ à la lecture (voir src/test/filtresPostgrest.ts) : accepté sans effet, il laissait
      // ce test vert avec la lecture des mouvements rapprochés restreinte à ceux qui portent une pièce — le
      // filtre qui cachait les pièces payées par la part d'un virement groupé (ligne 26).
      const predicats: Predicat[] = []
      Object.assign(chaine, {
        select: () => chaine,
        delete: () => { operation = 'delete'; return chaine },
        update: (valeur: Record<string, unknown>) => { operation = 'update'; valeurMaj = valeur; return chaine },
        eq: (colonne: string, valeur: unknown) => {
          if (operation === 'delete' && colonne === 'id') faux.suppressions.push(valeur)
          if (operation === 'update' && colonne === 'id') faux.majPieces.push({ id: valeur, valeur: valeurMaj })
          return chaine
        },
        is: () => chaine,
        not: (colonne: string, operateur: string, valeur: unknown) => { predicats.push(predicatNot(colonne, operateur, valeur)); return chaine },
        or: () => chaine,
        order: () => chaine,
        range: (d: number, f: number) => { debut = d; fin = f; return chaine },
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        then: (suite: (r: { data: unknown[]; error: { message: string } | null; count: number }) => unknown) => {
          if (operation === 'delete') {
            const erreur = faux.refusSuppression ? { message: faux.refusSuppression } : null
            if (!erreur) {
              faux.parTable[table] = (faux.parTable[table] ?? []).filter((l) => !faux.suppressions.includes((l as { id: unknown }).id))
            }
            return Promise.resolve({ data: [], error: erreur, count: 0 }).then(suite)
          }
          if (operation === 'update') {
            // Le serveur applique vraiment la mise à jour, pour que la relecture qui suit la voie.
            const derniere = faux.majPieces[faux.majPieces.length - 1]
            return (faux.retenueMaj ?? Promise.resolve()).then(() => {
              faux.parTable[table] = (faux.parTable[table] ?? []).map((l) => (
                (l as { id: unknown }).id === derniere.id ? { ...(l as object), ...derniere.valeur } : l
              ))
              return { data: [], error: null, count: 0 }
            }).then(suite)
          }
          const toutes = filtrer(faux.parTable[table] ?? [], predicats)
          const plafond = faux.muetApres[table]
          const finReelle = plafond === undefined ? debut + (fin - debut + 1) : Math.min(debut + (fin - debut + 1), plafond)
          return Promise.resolve({
            data: toutes.slice(debut, finReelle),
            error: null,
            count: toutes.length,
          }).then(suite)
        },
      })
      return chaine
    },
    // La fiche d'une pièce enregistre sous l'identité de l'utilisateur, et son aperçu demande une URL
    // signée : les deux répondent sans rien faire ici.
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
    storage: {
      from: () => ({
        createSignedUrl: () => Promise.resolve({ data: null, error: { message: 'non utilisé' } }),
        remove: (chemins: string[]) => {
          faux.retraits.push(chemins)
          return Promise.resolve({ error: null })
        },
      }),
    },
  },
  }
})

// `PiecesTab` lit `monCabinetId` du contexte d'authentification, pour la règle tiers → catégorie
// partagée par le cabinet. Monter un AuthProvider complet ferait dépendre ce test d'une session
// Supabase ; la doublure dit exactement ce dont l'écran a besoin, et rien de plus.
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ monCabinetId: 'cabinet-de-test' }) }))
vi.mock('../../lib/doublonsTexte', () => ({ chargerDoublonsDeTexte: async () => [] }))
// La fenêtre de la plateforme du client a ses propres tests : ici, seulement ce que l'onglet lui passe.
vi.mock('./PlateformeClientModal', () => ({
  default: (p: { dossierId: string; dossierSiret: string | null }) => (
    <div>Fenêtre de la plateforme — dossier {p.dossierId}, SIRET {p.dossierSiret ?? 'aucun'}</div>
  ),
}))
// La forme exacte de `PresenceTexteOcr` compte — `{ avecTexte: Set, erreur: string | null }` : le
// premier est lu en `.has()` à chaque ligne, le second décide de l'affichage du bouton de
// relecture (une lecture refusée retire le bouton, parce que sa présence coûte des appels Textract
// facturés). Une doublure qui invente ses champs fait planter l'écran avant le premier test.
vi.mock('../../lib/texteOcr', () => ({
  piecesAvecTexteOcr: async () => ({ avecTexte: faux.avecTexte, erreur: faux.erreurPresence }),
  texteOcrDeLaPiece: async () => null,
}))

// Typé `Piece` SANS `as` : le compilateur vérifie alors chaque champ contre la table, à chaque
// build et exhaustivement. C'est le remède déjà appliqué à ChecklistTab et BanqueTab après un
// `devise: null` qui faisait compter CHAQUE pièce comme « devise non convertie » — un jeu d'essai
// infidèle ne fait pas qu'affaiblir un test, il lui fait prouver autre chose.
function piece(o: Partial<Piece> = {}): Piece {
  return {
    id: 'p1', dossier_id: 'dossier-de-test', nom_fichier: 'justificatif.pdf', statut: 'a_valider',
    type_piece: 'achat', date_piece: '2026-03-10', montant_ht: null, montant_tva: null,
    montant_ttc: 120, tiers: 'FOURNISSEUR', categorie_id: null, confiance: 'haute',
    devise: 'EUR', montant_devise: null, taux_change: null, sous_dossier_id: null,
    storage_path: 'dossier-de-test/justificatif.pdf', storage_hash: null,
    // CINQ colonnes que ce jeu d'essai omettait, et que le typage a sorties une par une dès les
    // premières compilations : `uploaded_by`, `source` (`'cabinet'` n'existe pas — c'est déjà
    // l'infidélité qu'un autre écran portait), `conversion_source`, `notes` et
    // `superpdp_invoice_id`. Aucune n'était visible en relisant.
    uploaded_by: null, source: 'upload', conversion_source: null,
    notes: null, superpdp_invoice_id: null, flux_hote: null, flux_id: null, lisible_path: null, updated_at: '2026-09-16T09:00:00Z',
    created_at: '2026-09-16T09:00:00Z', ...o,
  }
}

function poser(pieces: unknown[], commentaires: PieceCommentaire[] = []) {
  faux.muetApres = {}
  faux.suppressions = []
  faux.refusSuppression = null
  faux.majPieces = []
  faux.retenueMaj = null
  faux.avecTexte = new Set()
  faux.erreurPresence = null
  faux.retraits = []
  faux.parTable = {
    pieces, categories: [], sous_dossiers: [], tiers_categories: [],
    tiers_categories_cabinet: [], piece_commentaires: commentaires, lignes_bancaires: [],
  }
}

// Dans la coque du panneau de droite : la fiche d'une pièce s'y ouvre, et `usePanneauDroit` lève hors
// d'elle plutôt que d'offrir des lignes qui ne feraient rien.
function monter(annee: number | 'toutes') {
  return render(
    <FournisseurPanneauDroit>
      <AnneeProvider defaut={annee}>
        <PiecesTab dossierId="dossier-de-test" />
      </AnneeProvider>
      <EmplacementPanneauDroit />
    </FournisseurPanneauDroit>,
  )
}

describe('PiecesTab — les badges des données démontrées fausses', () => {
  it('marque la ligne d’une pièce datée après son dépôt', async () => {
    // Le cas réel, reconstruit : datée de 2028, déposée en 2026.
    poser([piece({ id: 'futur', date_piece: '2028-09-27' })])
    monter('toutes')

    expect(await screen.findByText('Date impossible')).toBeDefined()
  })

  it('marque la ligne d’une pièce en devise sans taux de change', async () => {
    poser([piece({ id: 'devise', devise: 'USD', montant_devise: 140, taux_change: null })])
    monter('toutes')

    expect(await screen.findByText('Devise non convertie')).toBeDefined()
  })

  it('ne marque rien sur une pièce datée avant son dépôt et libellée en euros', async () => {
    poser([piece({ id: 'saine' })])
    monter('toutes')

    // Ancré sur le tiers, qui est présent : vérifier une ABSENCE sur un écran encore en chargement
    // rendrait ce test vert pour une raison fausse.
    await screen.findByText('FOURNISSEUR')
    expect(screen.queryByText('Date impossible')).toBeNull()
    expect(screen.queryByText('Devise non convertie')).toBeNull()
  })
})

describe('PiecesTab — une précision manquante ne doit pas ressembler à un client silencieux', () => {
  const commentaire = (i: number): PieceCommentaire => ({
    id: `c${i}`, dossier_id: 'dossier-de-test', piece_id: 'p1', document_id: null,
    auteur_id: 'u1', origine: 'client', texte: `précision ${i}`,
    created_at: '2026-09-16T10:00:00Z',
  })

  it('DIT que le fil des précisions est tronqué', async () => {
    // `chargerCommentaires` portait depuis toujours la mise en garde — « la précision du client
    // disparaît sur les pièces les plus récentes, précisément celles qu'on arbitre » — au-dessus
    // d'un code qui jetait le drapeau permettant de la voir. Une liste plus courte est
    // indiscernable d'un client qui n'a rien écrit, et c'est l'appel téléphonique que ces
    // précisions existent pour éviter.
    poser([piece()], [commentaire(1), commentaire(2), commentaire(3), commentaire(4)])
    faux.muetApres = { piece_commentaires: 2 }
    monter('toutes')

    expect(await screen.findByText(/Les précisions déposées par le client/)).toBeDefined()
  })

  it('ne dit rien quand le fil a été lu en entier', async () => {
    // Le garde SYMÉTRIQUE : sans lui, « le bandeau apparaît » serait satisfait par un bandeau
    // permanent, qu'on cesserait de lire — et il emporterait ses voisins dans son discrédit.
    poser([piece()], [commentaire(1), commentaire(2)])
    monter('toutes')

    // Ancré sur le tiers, qui est présent : vérifier une ABSENCE sur un écran encore en chargement
    // rendrait ce test vert pour une raison fausse.
    await screen.findByText('FOURNISSEUR')
    expect(screen.queryAllByText(/Les précisions déposées par le client/)).toHaveLength(0)
  })

  it('n’annonce pas les précisions tronquées quand ce sont les PIÈCES qui le sont', async () => {
    // Deux bandeaux, deux conséquences : les fondre en un seul afficherait, sur l'un des deux cas,
    // une phrase qui n'est pas la sienne.
    poser([piece({ id: 'p1' }), piece({ id: 'p2' }), piece({ id: 'p3' })], [commentaire(1)])
    faux.muetApres = { pieces: 1 }
    monter('toutes')

    expect(await screen.findByText(/Les pièces du dossier/)).toBeDefined()
    expect(screen.queryAllByText(/Les précisions déposées par le client/)).toHaveLength(0)
  })
})

// SUPPRIMER UNE SÉLECTION DISAIT LE CONTRAIRE DE CE QU'ELLE FAIT. Le message annonçait que les
// pièces « liées à un rapprochement bancaire ou à un pack déjà généré » n'avaient pas pu être
// supprimées, et envoyait « retirer d'abord ce lien ». Mesuré le 23/09/2026 : les CINQ clés
// étrangères entrantes de `pieces` sont en SET NULL ou CASCADE, aucune en NO ACTION — une
// suppression de pièce ne peut donc JAMAIS lever 23503 —, et `packs` n'a plus aucune clé entrante,
// `pack_pieces` ayant été supprimée. La vraie conséquence, elle, n'était nommée nulle part : le
// mouvement rapproché sur cette pièce garde `statut = 'rapprochee'` et ne désigne plus rien.
describe('PiecesTab — supprimer une sélection dit ce que ça défait', () => {
  async function selectionner() {
    monter(2026)
    const cases = await screen.findAllByRole('checkbox')
    // La première case est « tout sélectionner » (en-tête) ; celle de la ligne vient après.
    await act(async () => { fireEvent.click(cases[cases.length - 1]) })
    return screen.findByRole('button', { name: /Supprimer la sélection/ })
  }

  it('nomme le rapprochement bancaire défait dans la confirmation', async () => {
    poser([piece({ id: 'p1' })])
    let message = ''
    vi.spyOn(window, 'confirm').mockImplementation((m?: string) => { message = m ?? ''; return false })

    const bouton = await selectionner()
    await act(async () => { bouton.click() })

    expect(message).toContain(AVERTISSEMENT_PAIEMENT_DEFAIT)
    expect(faux.suppressions).toHaveLength(0)
    expect(message).not.toMatch(/pack déjà généré/)
  })

  // GARDE SYMÉTRIQUE : sans elle, « la confirmation nomme ce qu'on perd » serait satisfait par un
  // bouton qui ne supprime JAMAIS.
  it('supprime bien quand on confirme', async () => {
    poser([piece({ id: 'p1' })])
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    const bouton = await selectionner()
    await act(async () => { bouton.click() })

    expect(faux.suppressions).toEqual(['p1'])
  })

  it("rend la RAISON d'un échec au lieu d'en inventer une", async () => {
    poser([piece({ id: 'p1' })])
    faux.refusSuppression = 'new row violates row-level security policy'
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    let alerte = ''
    vi.spyOn(window, 'alert').mockImplementation((m?: unknown) => { alerte = String(m ?? '') })

    const bouton = await selectionner()
    await act(async () => { bouton.click() })

    expect(alerte).toContain('new row violates row-level security policy')
    // La cause inventée d'avant : un lien qui ne bloque rien, et une table qui n'existe plus.
    expect(alerte).not.toMatch(/pack déjà généré/)
  })
})

// LA FICHE D'UNE PIÈCE DANS LE PANNEAU DE DROITE (étape 2 de l'interface d'ordinateur). La liste
// reste visible et CLIQUABLE à côté — c'est le gain, et c'est aussi ce que la fenêtre modale d'avant
// interdisait : une autre ligne, « suivante » ou la croix peuvent maintenant chasser une saisie. Ce
// qui la ferait mentir : une fiche qui n'est pas celle de la ligne cliquée, un parcours qui sort de la
// liste affichée, une saisie qui part sans un mot, une validation qui n'enchaîne pas — ou qui
// enchaîne depuis une pièce que l'opérateur a déjà quittée.
// UNE FACTURE REÇUE DE LA PLATEFORME DU CLIENT (ligne 28.5) : la fenêtre qui les reçoit, ce que la ligne en dit, et ce
// qu'une suppression emporte — l'original ET sa version lisible.
describe('PiecesTab — les factures reçues de la plateforme du client', () => {
  const recue = (o: Partial<Piece> = {}) => piece({
    id: 'p-recue', source: 'plateforme', storage_path: 'dossier-de-test/fa.xml', nom_fichier: 'fa.xml',
    lisible_path: 'dossier-de-test/fa-lisible.pdf', flux_hote: 'pa.exemple.fr', flux_id: 'flux-1', tiers: 'FOURNISSEUR RECU', ...o,
  })

  it('« Plateforme du client » ouvre la fenêtre, avec le SIRET du dossier', async () => {
    poser([piece()])
    render(
      <FournisseurPanneauDroit>
        <AnneeProvider defaut="toutes">
          <PiecesTab dossierId="dossier-de-test" dossierSiret="12345678200010" />
        </AnneeProvider>
        <EmplacementPanneauDroit />
      </FournisseurPanneauDroit>,
    )
    await screen.findByText('FOURNISSEUR')
    expect(screen.queryByText(/Fenêtre de la plateforme/)).toBeNull()
    await act(async () => { screen.getByRole('button', { name: 'Plateforme du client' }).click() })
    expect(screen.getByText('Fenêtre de la plateforme — dossier dossier-de-test, SIRET 12345678200010')).toBeTruthy()
  })

  it('une facture reçue le dit sur sa ligne ; une pièce déposée, non', async () => {
    poser([recue(), piece({ id: 'p-deposee', tiers: 'FOURNISSEUR DEPOSE' })])
    monter('toutes')
    await screen.findByText('FOURNISSEUR DEPOSE')
    expect(screen.getAllByText('facture électronique')).toHaveLength(1)
    const ligne = screen.getByText('FOURNISSEUR RECU').closest('tr')!
    expect(within(ligne).getByText('facture électronique')).toBeTruthy()
  })

  it('supprimée en lot, elle emporte ses deux fichiers ; une pièce déposée, son seul fichier', async () => {
    poser([recue(), piece({ id: 'p-deposee', tiers: 'FOURNISSEUR DEPOSE' })])
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    monter('toutes')
    await screen.findByText('FOURNISSEUR DEPOSE')
    const cases = screen.getAllByRole('checkbox')
    await act(async () => { fireEvent.click(cases[cases.length - 2]) })
    await act(async () => { fireEvent.click(cases[cases.length - 1]) })
    await act(async () => { (await screen.findByRole('button', { name: /Supprimer la sélection/ })).click() })
    expect([...faux.suppressions].sort()).toEqual(['p-deposee', 'p-recue'])
    expect(faux.retraits).toEqual(expect.arrayContaining([
      ['dossier-de-test/fa.xml', 'dossier-de-test/fa-lisible.pdf'],
      ['dossier-de-test/justificatif.pdf'],
    ]))
    expect(faux.retraits).toHaveLength(2)
  })
})

describe('PiecesTab — la fiche d’une pièce dans le panneau de droite', () => {
  const trois = () => [
    piece({ id: 'p1', tiers: 'ALPHA', date_piece: '2026-03-01' }),
    piece({ id: 'p2', tiers: 'BETA', date_piece: '2026-03-02', statut: 'validee' }),
    piece({ id: 'p3', tiers: 'GAMMA', date_piece: '2026-03-03' }),
  ]
  const volet = () => screen.getByRole('complementary', { name: 'Panneau contextuel' })
  const titreFiche = () => within(volet()).queryByRole('heading', { level: 2 })?.textContent ?? null
  async function ouvrir(tiers: string) {
    const cellule = await screen.findByText(tiers, { selector: 'td' })
    await act(async () => { fireEvent.click(cellule) })
  }
  const ttc = () => within(volet()).getByLabelText('Montant TTC') as HTMLInputElement

  it('ouvre la fiche de la ligne cliquée, avec sa place dans la liste affichée', async () => {
    poser(trois())
    monter('toutes')
    await ouvrir('BETA')

    expect(titreFiche()).toBe('Justificatif 2 sur 3')
    expect(within(volet()).getByText('BETA')).toBeTruthy()
    expect(screen.getByText('BETA', { selector: 'td' }).closest('tr')!.className).toContain('ligne-ouverte')
  })

  it('« précédent » et « suivant » parcourent la liste affichée, et s’arrêtent à ses bouts', async () => {
    poser(trois())
    monter('toutes')
    await ouvrir('BETA')

    await act(async () => { fireEvent.click(within(volet()).getByRole('button', { name: 'Justificatif suivant' })) })
    expect(titreFiche()).toBe('Justificatif 3 sur 3')
    expect(within(volet()).getByRole('button', { name: 'Justificatif suivant' })).toHaveProperty('disabled', true)

    const precedent = () => within(volet()).getByRole('button', { name: 'Justificatif précédent' })
    await act(async () => { fireEvent.click(precedent()) })
    await act(async () => { fireEvent.click(precedent()) })
    expect(titreFiche()).toBe('Justificatif 1 sur 3')
    expect(precedent()).toHaveProperty('disabled', true)
  })

  it('une saisie non enregistrée ne part pas sans un mot — et la suivante repart de SES valeurs', async () => {
    poser(trois())
    monter('toutes')
    await ouvrir('ALPHA')
    await act(async () => { fireEvent.change(ttc(), { target: { value: '99.99' } }) })

    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false)
    try {
      await act(async () => { fireEvent.click(within(volet()).getByRole('button', { name: 'Justificatif suivant' })) })
      expect(confirmation).toHaveBeenCalledTimes(1)
      expect(titreFiche()).toBe('Justificatif 1 sur 3')
      expect(ttc().value).toBe('99.99')

      // Une autre LIGNE passe par la même garde que « suivant ».
      await ouvrir('GAMMA')
      expect(confirmation).toHaveBeenCalledTimes(2)
      expect(titreFiche()).toBe('Justificatif 1 sur 3')

      confirmation.mockReturnValue(true)
      await act(async () => { fireEvent.click(within(volet()).getByRole('button', { name: 'Justificatif suivant' })) })
      expect(titreFiche()).toBe('Justificatif 2 sur 3')
      expect(ttc().value).toBe('120')
    } finally {
      confirmation.mockRestore()
    }
  })

  it('sans saisie, on passe d’une pièce à l’autre sans qu’on demande rien', async () => {
    // Garde SYMÉTRIQUE : sans elle, « la saisie ne part pas sans un mot » serait satisfait par une
    // fiche qui demande à chaque pas — une question posée à tort finit par ne plus être lue.
    poser(trois())
    monter('toutes')
    await ouvrir('ALPHA')
    const confirmation = vi.spyOn(window, 'confirm')
    try {
      await act(async () => { fireEvent.click(within(volet()).getByRole('button', { name: 'Justificatif suivant' })) })
      expect(titreFiche()).toBe('Justificatif 2 sur 3')
      expect(confirmation).not.toHaveBeenCalled()
    } finally {
      confirmation.mockRestore()
    }
  })

  it('« Valider » enchaîne sur la prochaine pièce À VALIDER de la liste', async () => {
    poser(trois())
    monter('toutes')
    await ouvrir('ALPHA')
    await act(async () => { fireEvent.click(within(volet()).getByRole('button', { name: 'Valider' })) })

    expect(faux.majPieces.map((m) => [m.id, m.valeur.statut])).toEqual([['p1', 'validee']])
    // BETA est déjà validée : l'enchaînement la saute.
    expect(await within(volet()).findByText('GAMMA')).toBeTruthy()
  })

  it('plus aucune pièce à valider : la fiche se ferme', async () => {
    poser([piece({ id: 'p1', tiers: 'ALPHA' }), piece({ id: 'p2', tiers: 'BETA', statut: 'validee' })])
    monter('toutes')
    await ouvrir('ALPHA')
    await act(async () => { fireEvent.click(within(volet()).getByRole('button', { name: 'Valider' })) })

    expect(faux.majPieces).toHaveLength(1)
    expect(volet().childElementCount).toBe(0)
  })

  it('un brouillon enregistré ferme la fiche sans demander d’abandonner ce qui vient d’être enregistré', async () => {
    poser(trois())
    monter('toutes')
    await ouvrir('ALPHA')
    await act(async () => { fireEvent.change(ttc(), { target: { value: '99.99' } }) })
    const confirmation = vi.spyOn(window, 'confirm')
    try {
      await act(async () => { fireEvent.click(within(volet()).getByRole('button', { name: 'Enregistrer brouillon' })) })
      expect(faux.majPieces).toHaveLength(1)
      expect(confirmation).not.toHaveBeenCalled()
      expect(volet().childElementCount).toBe(0)
    } finally {
      confirmation.mockRestore()
    }
  })

  it('la croix passe par la même garde : une saisie non enregistrée n’est pas fermée sans un mot', async () => {
    poser(trois())
    monter('toutes')
    await ouvrir('ALPHA')
    await act(async () => { fireEvent.change(ttc(), { target: { value: '99.99' } }) })
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false)
    try {
      await act(async () => { fireEvent.click(within(volet()).getByRole('button', { name: 'Fermer le panneau' })) })
      expect(confirmation).toHaveBeenCalledTimes(1)
      expect(titreFiche()).toBe('Justificatif 1 sur 3')
    } finally {
      confirmation.mockRestore()
    }
  })

  it('pendant un enregistrement, « précédent » et « suivant » sont grisés', async () => {
    // La fiche changerait de pièce sous une réponse encore attendue, et l'enchaînement qui suit une
    // validation partirait de la mauvaise.
    poser(trois())
    let relacher: () => void = () => {}
    faux.retenueMaj = new Promise<void>((resolve) => { relacher = resolve })
    monter('toutes')
    await ouvrir('BETA')
    await act(async () => { fireEvent.click(within(volet()).getByRole('button', { name: 'Valider' })) })

    expect(within(volet()).getByRole('button', { name: 'Justificatif suivant' })).toHaveProperty('disabled', true)
    expect(within(volet()).getByRole('button', { name: 'Justificatif précédent' })).toHaveProperty('disabled', true)
    await act(async () => { relacher() })
  })

  it('une pièce supprimée depuis la liste emporte sa fiche', async () => {
    // Possible maintenant que la liste reste cliquable à côté de la fiche — et une fiche restée
    // ouverte sur une pièce disparue enregistrerait dans le vide : une mise à jour qui ne touche
    // aucune ligne ne lève rien.
    poser(trois())
    monter('toutes')
    await ouvrir('ALPHA')
    const caseAlpha = within(screen.getByText('ALPHA', { selector: 'td' }).closest('tr')!).getByRole('checkbox')
    await act(async () => { fireEvent.click(caseAlpha) })
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(true)
    try {
      await act(async () => { screen.getByRole('button', { name: /Supprimer la sélection/ }).click() })
      expect(faux.suppressions).toEqual(['p1'])
      expect(volet().childElementCount).toBe(0)
    } finally {
      confirmation.mockRestore()
    }
  })

  it('une validation qui répond après qu’on a ouvert une autre pièce ne déplace pas la fiche', async () => {
    poser(trois())
    let relacher: () => void = () => {}
    faux.retenueMaj = new Promise<void>((resolve) => { relacher = resolve })
    monter('toutes')
    await ouvrir('ALPHA')
    await act(async () => { fireEvent.click(within(volet()).getByRole('button', { name: 'Valider' })) })

    // Pendant l'enregistrement, l'opérateur ouvre une autre ligne : la liste reste cliquable.
    await ouvrir('BETA')
    expect(titreFiche()).toBe('Justificatif 2 sur 3')

    await act(async () => { relacher() })
    expect(titreFiche()).toBe('Justificatif 2 sur 3')
    expect(within(volet()).getByText('BETA')).toBeTruthy()
  })
})

// « PROPOSER UNE CATÉGORIE » n'a de sens que sur une pièce dont le texte a été lu : c'est lui que le
// modèle cite. L'écran le SAIT par la liste des textes présents, et c'est ce câblage-là qu'aucun test
// de la fiche ne peut voir — la fiche reçoit un booléen, elle ne sait pas d'où il vient.
describe('PiecesTab — la fiche n’offre la proposition de catégorie que si elle a quelque chose à citer', () => {
  const volet = () => screen.getByRole('complementary', { name: 'Panneau contextuel' })
  const proposer = () => within(volet()).queryByRole('button', { name: /Proposer une catégorie/ })
  async function ouvrir(tiers: string) {
    const cellule = await screen.findByText(tiers, { selector: 'td' })
    await act(async () => { fireEvent.click(cellule) })
  }

  it('l’offre sur une pièce dont le texte est lu', async () => {
    poser([piece({ id: 'p1', tiers: 'ALPHA' })])
    faux.avecTexte = new Set(['p1'])
    monter('toutes')
    await ouvrir('ALPHA')
    expect(proposer()).toBeTruthy()
  })

  it('ne l’offre pas sur une pièce qui n’en a pas — le bouton n’aurait rien à citer', async () => {
    poser([piece({ id: 'p1', tiers: 'ALPHA' })])
    monter('toutes')
    await ouvrir('ALPHA')
    expect(within(volet()).getByLabelText('Montant TTC')).toBeTruthy()
    expect(proposer()).toBeNull()
  })

  it('l’offre dans le doute, quand la liste des textes n’a pas pu être lue', async () => {
    // Refuser ici coûterait une fonctionnalité sur une panne de lecture ; laisser le bouton ne coûte
    // rien de plus — la fonction refuse une pièce sans texte AVANT d'appeler le modèle.
    poser([piece({ id: 'p1', tiers: 'ALPHA' })])
    faux.erreurPresence = 'lecture refusée'
    monter('toutes')
    await ouvrir('ALPHA')
    expect(proposer()).toBeTruthy()
  })
})

// UNE PIÈCE PAYÉE PAR LA PART D'UN VIREMENT GROUPÉ (ligne 26). Le virement ne porte aucune pièce : elles sont
// dans ses parts. Lu comme avant — les seuls mouvements qui portent une pièce —, l'écran dirait « Non
// rapprochée » d'une facture payée, et l'opérateur irait chercher un paiement qui existe.
describe('PiecesTab — une pièce réglée par un virement groupé', () => {
  const ligneDe = async (tiers: string) => {
    const cellules = await screen.findAllByText(tiers)
    const ligne = cellules.map((c) => c.closest('tr')).find((tr) => tr !== null)
    if (!ligne) throw new Error(`Aucune ligne ne porte « ${tiers} »`)
    return ligne
  }

  it('est dite « Rapprochée » comme une autre, et celle que rien ne paie reste « Non rapprochée »', async () => {
    poser([piece({ id: 'p-groupe', statut: 'validee', tiers: 'ALPHA' }), piece({ id: 'p-libre', statut: 'validee', tiers: 'BETA' })])
    faux.parTable.lignes_bancaires = [{ id: 'vir', piece_id: null, date: '2026-03-15', montant: -240, statut: 'rapprochee', reglement_groupe: true }]
    faux.parTable.reglements_groupes = [{ ligne_bancaire_id: 'vir', piece_id: 'p-groupe', montant: -120 }]
    monter('toutes')

    expect(within(await ligneDe('ALPHA')).getByText('Rapprochée')).toBeTruthy()
    expect(within(await ligneDe('BETA')).getByText('Non rapprochée')).toBeTruthy()
  })

  it('des parts lues en partie : l’écran le dit, au lieu de laisser la pièce « non rapprochée » sans un mot', async () => {
    poser([piece({ id: 'p-groupe', statut: 'validee', tiers: 'ALPHA' })])
    faux.parTable.lignes_bancaires = [{ id: 'vir', piece_id: null, date: '2026-03-15', montant: -240, statut: 'rapprochee', reglement_groupe: true }]
    faux.parTable.reglements_groupes = [{ ligne_bancaire_id: 'vir', piece_id: 'p-groupe', montant: -120 }]
    faux.muetApres = { reglements_groupes: 0 }
    monter('toutes')

    expect(await screen.findByText(/Les listes de référence du dossier n'ont pas pu être lues en entier/)).toBeTruthy()
  })
})

// UNE PIÈCE QU'UN EXERCICE VALIDÉ A FIGÉE (lib/piecesFigeesLecture.ts) : celle qui porte une écriture validée, ou qui
// justifie un bien dont une écriture l'est. La base refuse d'en changer autre chose que les notes et le sous-dossier, et
// de la supprimer (`garder_piece_validee`). L'onglet le dit avant elle : la fiche n'offre que ce qui reste libre, une
// sélection l'écarte de la suppression, et les lots de catégorisation la laissent.
describe('PiecesTab — une pièce figée par un exercice validé', () => {
  const volet = () => screen.getByRole('complementary', { name: 'Panneau contextuel' })
  async function ouvrir(tiers: string) {
    const cellule = await screen.findByText(tiers, { selector: 'td' })
    await act(async () => { fireEvent.click(cellule) })
  }
  const validee = (o: { piece_id?: string; immobilisation_id?: string; date?: string }) => ({
    id: `ev-${o.piece_id ?? o.immobilisation_id}`, statut: 'validee', date: o.date ?? '2025-12-30',
    piece_id: o.piece_id ?? null, immobilisation_id: o.immobilisation_id ?? null,
  })
  const deux = () => [
    piece({ id: 'p-figee', tiers: 'ALPHA', statut: 'validee', date_piece: '2025-12-30' }),
    piece({ id: 'p-libre', tiers: 'BETA', statut: 'validee' }),
  ]

  it('la fiche d’une pièce qui porte une écriture validée le dit, et n’offre que ce qui reste libre', async () => {
    poser(deux())
    faux.parTable.ecritures_brouillon = [validee({ piece_id: 'p-figee' })]
    monter('toutes')
    await ouvrir('ALPHA')
    expect(within(volet()).getByText(/L'exercice 2025 est validé : cette pièce justifie une écriture validée/)).toBeTruthy()
    expect(within(volet()).getByRole('button', { name: 'Enregistrer' })).toBeTruthy()
    expect(within(volet()).queryByRole('button', { name: 'Supprimer' })).toBeNull()

    // Le garde symétrique : la pièce voisine, que rien ne fige, garde tous ses gestes.
    await ouvrir('BETA')
    expect(within(volet()).queryByText(/cette pièce justifie une écriture validée/)).toBeNull()
    expect(within(volet()).getByRole('button', { name: 'Valider' })).toBeTruthy()
  })

  it('une pièce figée par le seul bien qu’elle justifie l’est aussi', async () => {
    poser(deux())
    faux.parTable.immobilisations = [{ id: 'bien-1', piece_id: 'p-figee' }]
    faux.parTable.ecritures_brouillon = [validee({ immobilisation_id: 'bien-1', date: '2025-12-31' })]
    monter('toutes')
    await ouvrir('ALPHA')
    expect(within(volet()).getByText(/L'exercice 2025 est validé : cette pièce justifie une écriture validée/)).toBeTruthy()
  })

  it('une sélection écarte la pièce figée, et la confirmation le dit', async () => {
    poser(deux())
    faux.parTable.ecritures_brouillon = [validee({ piece_id: 'p-figee' })]
    let message = ''
    vi.spyOn(window, 'confirm').mockImplementation((m?: string) => { message = m ?? ''; return true })
    monter('toutes')
    const cases = await screen.findAllByRole('checkbox')
    // Les cases des deux lignes, les dernières de l'écran.
    await act(async () => { fireEvent.click(cases[cases.length - 2]) })
    await act(async () => { fireEvent.click(cases[cases.length - 1]) })
    await act(async () => { (await screen.findByRole('button', { name: /Supprimer la sélection/ })).click() })

    expect(message).toMatch(/^Supprimer définitivement 1 pièce\(s\) \?/)
    expect(message).toMatch(/Une pièce de la sélection justifie une écriture validée : elle ne se supprime plus, et reste\.$/)
    expect(faux.suppressions).toEqual(['p-libre'])
  })

  it('une sélection faite de la seule pièce figée ne demande rien, et dit pourquoi', async () => {
    poser([deux()[0]])
    faux.parTable.ecritures_brouillon = [validee({ piece_id: 'p-figee' })]
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(true)
    let alerte = ''
    vi.spyOn(window, 'alert').mockImplementation((m?: unknown) => { alerte = String(m ?? '') })
    monter('toutes')
    const cases = await screen.findAllByRole('checkbox')
    await act(async () => { fireEvent.click(cases[cases.length - 1]) })
    await act(async () => { (await screen.findByRole('button', { name: /Supprimer la sélection/ })).click() })

    expect(alerte).toBe('Cette pièce justifie une écriture validée : elle ne se supprime plus. Une erreur trouvée après la validation se corrige sur l’exercice suivant.')
    expect(confirmation).not.toHaveBeenCalled()
    expect(faux.suppressions).toEqual([])
  })

  const regle = (tiers: string) => ({
    id: `r-${tiers}`, dossier_id: 'dossier-de-test', tiers_normalise: tiers, categorie_id: 'cat-x', updated_at: '2026-01-01T09:00:00Z',
  })
  function sansCategorie(figee: boolean) {
    poser([
      piece({ id: 'p-figee', tiers: 'TRANSMEDICAL', statut: 'validee' }),
      piece({ id: 'p-libre', tiers: 'BOULANGER', statut: 'validee' }),
    ])
    faux.parTable.tiers_categories = [regle('transmedical'), regle('boulanger')]
    if (figee) faux.parTable.ecritures_brouillon = [validee({ piece_id: 'p-figee' })]
  }

  it('les lots de catégorisation laissent la pièce figée', async () => {
    sansCategorie(true)
    monter('toutes')
    expect(await screen.findByRole('button', { name: 'Appliquer les suggestions (1)' })).toBeTruthy()
    // La fenêtre de catégorisation par fournisseur ne la montre pas non plus : elle montre l'autre.
    const avant = { figee: screen.getAllByText(/TRANSMEDICAL/).length, libre: screen.getAllByText(/BOULANGER/).length }
    await act(async () => { screen.getByRole('button', { name: 'Catégoriser par fournisseur (1)' }).click() })
    expect(screen.getAllByText(/TRANSMEDICAL/)).toHaveLength(avant.figee)
    expect(screen.getAllByText(/BOULANGER/).length).toBeGreaterThan(avant.libre)
  })

  // Le garde symétrique : sans écriture validée, les deux pièces y sont.
  it('sans écriture validée, les lots comptent les deux pièces', async () => {
    sansCategorie(false)
    monter('toutes')
    expect(await screen.findByRole('button', { name: 'Appliquer les suggestions (2)' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Catégoriser par fournisseur (2)' })).toBeTruthy()
  })

  it('une lecture partielle des pièces figées le dit', async () => {
    poser(deux())
    faux.parTable.immobilisations = [{ id: 'bien-1', piece_id: null }, { id: 'bien-2', piece_id: null }]
    faux.muetApres = { immobilisations: 1 }
    monter('toutes')
    expect(await screen.findByText(/Les écritures validées et les immobilisations du dossier n'ont pas pu être lues en entier/)).toBeTruthy()
    expect(screen.getByText(/Une pièce qu’un exercice validé a figée peut donc paraître modifiable/)).toBeTruthy()
  })
})
