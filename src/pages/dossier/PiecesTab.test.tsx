import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AnneeProvider } from '../../context/AnneeContext'
import { EmplacementPanneauDroit, FournisseurPanneauDroit } from '../../components/PanneauDroit'
import PiecesTab from './PiecesTab'
import type { Piece, PieceCommentaire } from '../../lib/types'
import { AVERTISSEMENT_RAPPROCHEMENT_DEFAIT } from '../../lib/controles'

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
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const chaine: Record<string, unknown> = {}
      let operation = 'select'
      let debut = 0
      let fin = Number.MAX_SAFE_INTEGER
      let valeurMaj: Record<string, unknown> = {}
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
        not: () => chaine,
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
          const toutes = faux.parTable[table] ?? []
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
      from: () => ({ createSignedUrl: () => Promise.resolve({ data: null, error: { message: 'non utilisé' } }) }),
    },
  },
}))

// `PiecesTab` lit `monCabinetId` du contexte d'authentification, pour la règle tiers → catégorie
// partagée par le cabinet. Monter un AuthProvider complet ferait dépendre ce test d'une session
// Supabase ; la doublure dit exactement ce dont l'écran a besoin, et rien de plus.
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ monCabinetId: 'cabinet-de-test' }) }))
vi.mock('../../lib/doublonsTexte', () => ({ chargerDoublonsDeTexte: async () => [] }))
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
    notes: null, superpdp_invoice_id: null, updated_at: '2026-09-16T09:00:00Z',
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

    expect(message).toContain(AVERTISSEMENT_RAPPROCHEMENT_DEFAIT)
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
