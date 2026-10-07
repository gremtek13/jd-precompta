import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ContexteDossier } from '../../test/exercicesValides'
import type { ValeurAnnee } from '../../components/AnneeTabs'
import type { ModeleComptable } from '../../lib/engagement'
import type { Predicat } from '../../test/filtresPostgrest'
import EcrituresTab from './EcrituresTab'

// L'ONGLET QUI PRODUIT LES DEUX FICHIERS OFFICIELS du projet — le FEC et la piste d'audit. Un défaut
// ici ne reste pas à l'écran : il part chez un vérificateur. Ce test vise donc les trois choses
// qu'aucun test de `src/lib` ne peut voir, parce qu'elles vivent dans le CÂBLAGE et non dans le
// calcul :
//
//  1. le contrôle branché sur le bon sous-ensemble (le piège que le projet a déjà connu une fois,
//     avec moisEnDoubleSurAbonnement câblé sur les seules pièces validées) ;
//  2. le FEC exporté sur l'exercice entier et non sur ce qu'une recherche a retenu ;
//  3. les deux exports qui se REFUSENT quand le brouillon n'a pas pu être lu en entier.

const faux = vi.hoisted(() => ({
  parTable: {} as Record<string, unknown[]>,
  // Plafond « Max rows » de PostgREST : nombre maximum de lignes rendues PAR REQUÊTE, qui ne se
  // signale pas (voir lib/lectureComplete.ts). `lireTout` le recolle tranche par tranche.
  plafond: null as number | null,
  // Le serveur cesse de rendre quoi que ce soit au-delà de cette position, tout en continuant
  // d'annoncer le vrai total. C'est LE cas qui produit une lecture incomplète : la boucle s'arrête
  // sur une tranche vide, et le compte annoncé fait foi.
  muetApres: null as number | null,
  // Une suppression refusée par la base. Le faux client rend alors l'erreur SANS rien retirer, ce
  // qui est le comportement réel : `supabase.from(...).delete()` ne lève pas, l'échec se lit dans
  // `{ error }`.
  refusSuppression: null as string | null,
  // Même panne que `muetApres`, sur UNE table seulement : c'est ce qui sépare « le brouillon a
  // manqué » de « tout a manqué », et la génération ne se trompe que dans le premier cas.
  muetParTable: {} as Record<string, number>,
  // Les insertions réellement envoyées, dans l'ordre. Elles MORDENT sur la table du faux, comme la
  // suppression : la relecture qui suit voit les écritures créées.
  insertions: [] as { table: string; lignes: Record<string, unknown>[] }[],
  // Retient les LECTURES qui suivent une insertion jusqu'à ce que le test relâche : c'est la fenêtre
  // de la relecture, pendant laquelle un second clic ne doit rien renvoyer.
  retenirApresInsertion: false,
  retenue: null as Promise<void> | null,
  relacher: null as (() => void) | null,
  // Les mises à jour envoyées, dans l'ordre — celle du modèle comptable sur `dossiers` comprise.
  misesAJour: [] as { table: string; valeurs: Record<string, unknown> }[],
  // Une mise à jour refusée par la base : le déclencheur qui verrouille le modèle, par exemple.
  refusMiseAJour: null as string | null,
  // Les suppressions envoyées, avec leurs filtres : c'est ce qui dit QUELLES lignes une régénération
  // retire.
  suppressions: [] as { table: string; filtres: [string, unknown][] }[],
  // Les appels à la fonction SQL de l'affectation (ligne 26.6) — que le faux serveur APPLIQUE : il
  // remplace l'écriture du mouvement, comme la vraie, pour que la relecture la voie. Il la refuse à la
  // demande, et peut retenir les lectures qui la suivent : c'est la fenêtre de la relecture.
  rpcs: [] as { nom: string; args: Record<string, unknown> }[],
  erreurRpc: null as string | null,
  retenirApresRpc: false,
}))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatNot, predicatOr } = await import('../../test/filtresPostgrest')
  // Un filtre d'écriture : `!colonne` pour `.neq`, `>colonne` pour `.gt` (des dates AAAA-MM-JJ, comparées en chaînes).
  const correspond = (ligne: Record<string, unknown>, colonne: string, valeur: unknown) =>
    colonne.startsWith('!') ? ligne[colonne.slice(1)] !== valeur
      : colonne.startsWith('>') ? String(ligne[colonne.slice(1)]) > String(valeur)
        : ligne[colonne] === valeur
  return {
    supabase: {
      rpc: (nom: string, args: Record<string, unknown>) => {
        faux.rpcs.push({ nom, args })
        if (faux.erreurRpc) return Promise.resolve({ data: null, error: { message: faux.erreurRpc } })
        if (faux.retenirApresRpc) {
          faux.retenue = new Promise<void>((r) => { faux.relacher = r })
        }
        // La liquidation d'une déclaration de TVA (lib/liquidationTva.ts) : la vraie fonction remplace les écritures de la
        // déclaration, au dernier jour de sa période ; le faux aussi, pour que la relecture les voie.
        if (nom === 'ecrire_liquidation_tva') {
          const declaration = (faux.parTable.declarations_tva ?? [])
            .find((d) => (d as { id: string }).id === args.p_declaration_id) as { periode_fin: string } | undefined
          const ecrites = (args.p_ecriture as Record<string, unknown>[]).map((e, i) => ({
            id: `rpc-${faux.rpcs.length}-${i}`, dossier_id: 'dossier-de-test', piece_id: null, ligne_bancaire_id: null,
            declaration_tva_id: args.p_declaration_id, date: declaration?.periode_fin, statut: 'proposee',
            created_at: '2025-04-02T09:00:00Z', ...e,
          }))
          faux.parTable.ecritures_brouillon = [
            ...(faux.parTable.ecritures_brouillon ?? [])
              .filter((e) => (e as { declaration_tva_id?: string | null }).declaration_tva_id !== args.p_declaration_id),
            ...ecrites,
          ]
          return Promise.resolve({ data: ecrites.length, error: null })
        }
        const id = args.p_ligne_bancaire_id
        const ligne = (faux.parTable.lignes_bancaires ?? []).find((l) => (l as { id: string }).id === id) as { date: string } | undefined
        // `p_ecritures` pour les classements, `p_ecriture` pour le paiement d'une déclaration de TVA.
        const ecrites = ((args.p_ecritures ?? args.p_ecriture) as Record<string, unknown>[]).map((e, i) => ({
          id: `rpc-${faux.rpcs.length}-${i}`, dossier_id: 'dossier-de-test', piece_id: null, ligne_bancaire_id: id,
          date: ligne?.date, statut: 'proposee', created_at: '2025-04-02T09:00:00Z', ...e,
        }))
        faux.parTable.ecritures_brouillon = [
          ...(faux.parTable.ecritures_brouillon ?? []).filter((e) => {
            const ecr = e as { piece_id: string | null; ligne_bancaire_id: string | null }
            return !(ecr.piece_id == null && ecr.ligne_bancaire_id === id)
          }),
          ...ecrites,
        ]
        return Promise.resolve({ data: ecrites.length, error: null })
      },
      from: (table: string) => {
        const chaine: Record<string, unknown> = {}
        let debut = 0
        let fin = Number.MAX_SAFE_INTEGER
        // La suppression MORD vraiment sur la table du faux : après elle, le `load()` de l'écran relit
        // un jeu réellement amputé. C'est ce qui rend les assertions de bout en bout — « le panneau
        // disparaît » plutôt que « la bonne méthode a été appelée » — et ce qui permet de voir qu'une
        // ligne oubliée en produit une autre, ailleurs.
        let suppression = false
        let insertion: Record<string, unknown>[] | null = null
        let miseAJour: Record<string, unknown> | null = null
        const filtres: [string, unknown][] = []
        // `.not` et `.or` sont APPLIQUÉS à la lecture (voir src/test/filtresPostgrest.ts) : acceptés sans
        // effet, ils laissaient ce test vert avec la lecture des mouvements rapprochés restreinte à ceux
        // qui portent une pièce, c'est-à-dire le défaut même que l'affectation (ligne 26.6) corrige.
        const predicats: Predicat[] = []
        Object.assign(chaine, {
          select: () => chaine,
          delete: () => { suppression = true; return chaine },
          // La mise à jour MORD aussi, comme la suppression : c'est la date que la contrepartie banque
          // réécrit sur les lignes d'une pièce rapprochée (voir lib/contrepartieBanque.ts).
          update: (valeurs: Record<string, unknown>) => { miseAJour = valeurs; return chaine },
          insert: (lignes: Record<string, unknown> | Record<string, unknown>[]) => {
            insertion = Array.isArray(lignes) ? lignes : [lignes]
            return chaine
          },
          eq: (colonne: string, valeur: unknown) => { filtres.push([colonne, valeur]); return chaine },
          neq: (colonne: string, valeur: unknown) => { filtres.push([`!${colonne}`, valeur]); return chaine },
          // Une régénération ou un retrait ne reprend que la part d'après la frontière de validation : la base refuse
          // de toucher à celle d'un exercice validé (lib/validationExercice.ts).
          gt: (colonne: string, valeur: unknown) => { filtres.push([`>${colonne}`, valeur]); return chaine },
          is: () => chaine,
          not: (colonne: string, operateur: string, valeur: unknown) => { predicats.push(predicatNot(colonne, operateur, valeur)); return chaine },
          or: (expression: string) => { predicats.push(predicatOr(expression)); return chaine },
          order: () => chaine,
          range: (d: number, f: number) => { debut = d; fin = f; return chaine },
          then: (suite: (r: { data: unknown[] | null; error: unknown; count: number }) => unknown) => {
            if (insertion) {
              faux.insertions.push({ table, lignes: insertion })
              // La base pose l'identifiant et la date de création de chaque ligne (`default now()`) : le faux aussi, sans
              // quoi une ligne relue après une génération n'aurait pas de date de création, ce qu'aucune ligne n'a jamais.
              faux.parTable[table] = [...(faux.parTable[table] ?? []), ...insertion.map((l, i) => ({
                id: `ins-${faux.insertions.length}-${i}`, created_at: '2025-06-01T09:00:00Z', ...l,
              }))]
              if (faux.retenirApresInsertion) {
                faux.retenue = new Promise<void>((r) => { faux.relacher = r })
              }
              return Promise.resolve({ data: null, error: null, count: 0 }).then(suite)
            }
            if (miseAJour) {
              faux.misesAJour.push({ table, valeurs: miseAJour })
              if (faux.refusMiseAJour) {
                return Promise.resolve({ data: null, error: { message: faux.refusMiseAJour }, count: 0 }).then(suite)
              }
              const vise = (ligne: Record<string, unknown>) => filtres.every(([colonne, valeur]) => correspond(ligne, colonne, valeur))
              faux.parTable[table] = (faux.parTable[table] ?? []).map((l) =>
                vise(l as Record<string, unknown>) ? { ...(l as Record<string, unknown>), ...miseAJour } : l)
              return Promise.resolve({ data: null, error: null, count: 0 }).then(suite)
            }
            if (suppression) {
              faux.suppressions.push({ table, filtres: [...filtres] })
              if (faux.refusSuppression) {
                return Promise.resolve({ data: null, error: { message: faux.refusSuppression }, count: 0 }).then(suite)
              }
              const garde = (ligne: Record<string, unknown>) => !filtres.every(([colonne, valeur]) => correspond(ligne, colonne, valeur))
              faux.parTable[table] = (faux.parTable[table] ?? []).filter((l) => garde(l as Record<string, unknown>))
              return Promise.resolve({ data: null, error: null, count: 0 }).then(suite)
            }
            // Les `.eq` d'une LECTURE s'appliquent aussi, sauf le cadrage par dossier, que le jeu d'essai
            // ne renseigne pas : sans cela, la lecture des mouvements restreinte aux seuls rapprochés
            // restait verte en cachant les virements personnels, dont l'écriture va au FEC. SAUF pour les
            // natures, que le jeu d'essai renseigne : celles du cabinet n'appartiennent à aucun dossier, et
            // une lecture qui ne demanderait que celles du dossier les perdrait toutes — avec elles le compte
            // de chaque bien, dont l'acquisition ne s'écrirait plus. Le cadrage ignoré, ce test restait vert
            // avec cette lecture-là.
            const egalites = filtres
              .filter(([colonne]) => (colonne !== 'dossier_id' || table === 'natures_immobilisation') && !/^[!>]/.test(colonne))
              .map(([colonne, valeur]) => predicatEq(colonne, valeur))
            const toutes = filtrer(faux.parTable[table] ?? [], [...predicats, ...egalites])
            const demande = fin - debut + 1
            const taille = faux.plafond == null ? demande : Math.min(demande, faux.plafond)
            const muet = faux.muetParTable[table] ?? faux.muetApres
            const rendu = muet == null
              ? toutes.slice(debut, debut + taille)
              : toutes.slice(debut, Math.min(debut + taille, muet))
            const reponse = { data: rendu, error: null, count: toutes.length }
            return (faux.retenue ?? Promise.resolve()).then(() => reponse).then(suite)
          },
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        })
        return chaine
      },
    },
  }
})

// `genererFec` reste le VRAI : c'est son résultat qu'on veut inspecter. Seul le téléchargement est
// remplacé — jsdom n'a pas d'URL.createObjectURL, et c'est le CONTENU qui est en cause.
const telecharge = vi.hoisted(() => ({ fichiers: [] as { nom: string; contenu: string }[] }))
vi.mock('../../lib/fec', async (vrai) => ({
  ...(await vrai<typeof import('../../lib/fec')>()),
  telechargerTexte: (nom: string, contenu: string) => { telecharge.fichiers.push({ nom, contenu }) },
}))

const CATEGORIE_ACHATS = {
  id: 'cat-achats', dossier_id: null, code: 'achats_fournisseurs', libelle: 'Achats',
  ordre: 1, compte_comptable: '606100', poste_2035: 'Achats',
}

function piece(o: Record<string, unknown> = {}) {
  return {
    id: 'p1', dossier_id: 'dossier-de-test', nom_fichier: 'facture.pdf', statut: 'validee',
    type_piece: 'achat', date_piece: '2025-03-10', montant_ht: null, montant_tva: null,
    montant_ttc: 120, tiers: 'FOURNISSEUR MARSEILLE', categorie_id: 'cat-achats',
    confiance: 'haute', storage_path: 'dossier-de-test/facture.pdf', storage_hash: null,
    created_at: '2025-03-10T09:00:00Z', ...o,
  }
}

function ecriture(o: Record<string, unknown> = {}) {
  return {
    id: 'e1', dossier_id: 'dossier-de-test', piece_id: 'p1', ligne_bancaire_id: null,
    date: '2025-03-10', libelle: 'FOURNISSEUR MARSEILLE', sens: 'debit', statut: 'proposee',
    compte: '606100', montant: 120, created_at: '2025-03-10T09:00:00Z', ...o,
  }
}

function poser(tables: Partial<Record<string, unknown[]>>) {
  telecharge.fichiers = []
  faux.plafond = null
  faux.muetApres = null
  faux.refusSuppression = null
  faux.muetParTable = {}
  faux.insertions = []
  faux.retenirApresInsertion = false
  faux.retenue = null
  faux.relacher = null
  faux.misesAJour = []
  faux.refusMiseAJour = null
  faux.suppressions = []
  faux.rpcs = []
  faux.erreurRpc = null
  faux.retenirApresRpc = false
  faux.parTable = {
    categories: [CATEGORIE_ACHATS], pieces: [], ecritures_brouillon: [],
    immobilisations: [], natures_immobilisation: [], lignes_bancaires: [], declarations_tva: [], a_nouveaux: [], reglements_groupes: [],
    soldes_reportes: [],
    ...tables,
  } as Record<string, unknown[]>
}

const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '455000' }
const ENGAGEMENT: ModeleComptable = { mode: 'engagement', compteNotesDeFrais: '455000' }

// Le modèle vit dans la page du dossier, qui le remet à l'onglet après l'enregistrement : ce porteur
// joue ce rôle, sans quoi un changement de modèle ne se verrait jamais à l'écran.
function Onglet({ assujettiTva, modeleInitial, annee, valides }: {
  assujettiTva: boolean; modeleInitial: ModeleComptable; annee: ValeurAnnee; valides: readonly number[]
}) {
  const [modele, setModele] = useState(modeleInitial)
  return (
    <ContexteDossier annee={annee} valides={valides}>
      <EcrituresTab
        dossierId="dossier-de-test" dossierNom="Dossier de test" dossierSiret="12345678901234" assujettiTva={assujettiTva}
        modele={modele}
        onModeleUpdated={(m) => setModele((avant) => ({
          mode: m.mode_comptable ?? avant.mode, compteNotesDeFrais: m.compte_notes_de_frais ?? avant.compteNotesDeFrais,
        }))}
      />
    </ContexteDossier>
  )
}

// `valides` : les exercices validés que la page du dossier fournit à ses onglets (DossierDetail).
function monter(assujettiTva = false, modele: ModeleComptable = TRESORERIE, annee: ValeurAnnee = 2025, valides: readonly number[] = []) {
  return render(<Onglet assujettiTva={assujettiTva} modeleInitial={modele} annee={annee} valides={valides} />)
}

describe('EcrituresTab — écritures que la pièce ne justifie plus', () => {
  it("voit la charge d'une pièce devenue un bien sans nature, que les trois autres contrôles manquent", async () => {
    // Le geste réel : la pièce est validée, catégorisée, son écriture est générée — PUIS le cabinet
    // l'enregistre en immobilisation depuis l'autre onglet. Rien ne retire l'écriture, et la dépense
    // part alors en charge ET en amortissement.
    //
    // Ce que ce test garde et qu'aucun test de lib ne peut garder : le contrôle reçoit bien
    // `piecesValidees` (toutes) et non le sous-ensemble comptabilisable — le branchant sur ce
    // dernier, il serait MUET pour toujours, la pièce venant précisément d'en sortir. C'est mot pour
    // mot le piège de moisEnDoubleSurAbonnement câblé sur le mauvais `pieces`.
    // L'écriture est COMPLÈTE et ÉQUILIBRÉE (charge + contrepartie banque) : c'est ce qui la rend
    // invisible. Les deux autres contrôles partent bien des écritures, mais ils cherchent une
    // contrepartie manquante ou un solde non nul — ce groupe n'a ni l'un ni l'autre. Rien ne cloche
    // dans sa FORME ; c'est la pièce qui ne la justifie plus.
    poser({
      pieces: [piece()],
      ecritures_brouillon: [
        ecriture({ id: 'e1', compte: '606100', sens: 'debit', montant: 120 }),
        ecriture({ id: 'e2', compte: '512000', sens: 'credit', montant: 120 }),
      ],
      // SANS NATURE : son compte d'immobilisation n'est pas connu, donc rien ne sait réécrire la pièce. Avec
      // une nature, c'est « à régénérer » (voir l'écriture d'acquisition, plus bas).
      immobilisations: [{ id: 'i1', dossier_id: 'dossier-de-test', piece_id: 'p1', nature_id: null }],
    })
    monter()

    await screen.findByText('Écritures que la pièce ne justifie plus')
    expect(screen.getByText(/Enregistrée en immobilisation, sans nature/)).toBeDefined()
    expect(screen.getByText(/Choisir sa nature dans l'onglet Immobilisations, puis régénérer/)).toBeDefined()
    // Et les trois contrôles qui partent de la pièce ne disent rien : c'est bien lui, et lui seul
    // qui voit cette charge. Les badges du pied de page sont le signal le plus court de leur
    // silence — `queryByText` lit le TEXTE rendu, jamais le balisage.
    expect(screen.queryByText('Écritures à régénérer')).toBeNull()
    expect(screen.queryByText(/à régénérer$/)).toBeNull()
    expect(screen.queryAllByText(/déséquilibrée/)).toHaveLength(0)
    expect(screen.queryByText(/en attente de rapprochement bancaire/)).toBeNull()
  })

  it('se tait quand la pièce justifie toujours son écriture', async () => {
    poser({ pieces: [piece()], ecritures_brouillon: [ecriture()] })
    monter()

    await screen.findByText(/1 écriture proposée/)
    expect(screen.queryByText('Écritures que la pièce ne justifie plus')).toBeNull()
  })
})

// LA NOTE DE FRAIS EN TRÉSORERIE s'écrit face au compte de l'exploitant (lib/ecritures.ts) : sans cette contrepartie,
// son écriture restait déséquilibrée et la validation de son exercice impossible. Ce que ces tests gardent : que la
// génération et « Régénérer » l'écrivent, et que l'écriture d'avant se dise à régénérer, pas « en attente de
// rapprochement » — le dirigeant l'a payée de sa poche, aucun mouvement ne viendra.
describe('EcrituresTab — la note de frais en trésorerie', () => {
  const note = (o: Record<string, unknown> = {}) => piece({ id: 'p-note', type_piece: 'note_frais', montant_ttc: 40, tiers: 'RESTAURANT', ...o })

  it('génère la charge et sa contrepartie au 108000', async () => {
    poser({ pieces: [note()] })
    monter()
    const bouton = await screen.findByRole('button', { name: /Générer les écritures manquantes \(1\)/ })
    await act(async () => { bouton.click() })
    expect(faux.insertions[0].lignes.map((l) => [l.compte, l.sens, l.montant])).toEqual([['606100', 'debit', 40], ['108000', 'credit', 40]])
  })

  it('dit l’écriture d’avant à régénérer, pas en attente de rapprochement, et la régénère avec sa contrepartie', async () => {
    poser({ pieces: [note()], ecritures_brouillon: [ecriture({ piece_id: 'p-note', montant: 40, libelle: 'RESTAURANT' })] })
    monter()
    await screen.findByText('1 à régénérer')
    expect(screen.queryByText(/en attente de rapprochement bancaire/)).toBeNull()
    await act(async () => { screen.getByRole('button', { name: 'Régénérer' }).click() })
    await waitFor(() => expect(faux.insertions).toHaveLength(1))
    expect(faux.insertions[0].lignes.map((l) => [l.compte, l.sens, l.montant])).toEqual([['606100', 'debit', 40], ['108000', 'credit', 40]])
  })
})

// L'ÉCRITURE D'ACQUISITION (ligne 26.6, étape b) : la facture d'un bien s'écrit sur le compte d'immobilisation
// de sa NATURE — lue avec celles du cabinet —, sa TVA au 445620. Ce que ces tests gardent et qu'aucun test de
// lib ne voit : l'écran LIT les natures, les passe à la génération, à la régénération et aux contrôles, et
// suspend la génération quand elles sont lues en partie.
describe('EcrituresTab — l’écriture d’acquisition d’un bien', () => {
  const NATURE = { id: 'n1', dossier_id: null, libelle: 'Matériel informatique', duree_annees_defaut: 3, ordre: 1, compte_immobilisation: '218300' }
  const BIEN = { id: 'i1', dossier_id: 'dossier-de-test', piece_id: 'p1', nature_id: 'n1' }
  const facture = (o: Record<string, unknown> = {}) => piece({ montant_ht: 100, montant_tva: 20, montant_ttc: 120, ...o })

  it('génère l’acquisition sur le compte du bien et sa TVA en 445620, pas la charge de sa catégorie', async () => {
    poser({ pieces: [facture()], immobilisations: [BIEN], natures_immobilisation: [NATURE] })
    monter(true)
    const bouton = await screen.findByRole('button', { name: /Générer les écritures manquantes \(1\)/ })
    await act(async () => { bouton.click() })
    expect(faux.insertions[0].lignes.map((l) => [l.compte, l.montant])).toEqual([['218300', 100], ['445620', 20]])
  })

  it('génère l’acquisition d’un bien sans catégorie, et ne le compte pas parmi les pièces sans catégorie', async () => {
    poser({ pieces: [facture({ categorie_id: null })], immobilisations: [BIEN], natures_immobilisation: [NATURE] })
    monter(true)
    const bouton = await screen.findByRole('button', { name: /Générer les écritures manquantes \(1\)/ })
    expect(screen.queryByText('Pièces validées sans catégorie')).toBeNull()
    await act(async () => { bouton.click() })
    expect(faux.insertions[0].lignes.map((l) => l.compte)).toEqual(['218300', '445620'])
  })

  // Sa catégorie ne décide de rien : la facture d'un bien s'écrit sur le compte de sa nature. Réclamer un compte
  // pour elle enverrait compléter une catégorie qui n'écrit rien.
  it('ne réclame pas de compte pour la catégorie de la facture d’un bien', async () => {
    const sansCompte = { ...CATEGORIE_ACHATS, id: 'cat-sans-compte', code: 'divers', libelle: 'À classer', compte_comptable: null }
    poser({
      pieces: [facture({ categorie_id: 'cat-sans-compte' })], categories: [CATEGORIE_ACHATS, sansCompte],
      immobilisations: [BIEN], natures_immobilisation: [NATURE],
    })
    monter(true)
    await screen.findByRole('button', { name: /Générer les écritures manquantes \(1\)/ })
    expect(screen.queryByText('Comptes manquants')).toBeNull()
  })

  it('réclame toujours le compte de la catégorie d’une pièce qui n’est pas un bien', async () => {
    // Le garde symétrique : sans lui, « le bien n'est pas réclamé » serait satisfait par une carte qui ne
    // réclame plus rien.
    const sansCompte = { ...CATEGORIE_ACHATS, id: 'cat-sans-compte', code: 'divers', libelle: 'À classer', compte_comptable: null }
    poser({ pieces: [facture({ categorie_id: 'cat-sans-compte' })], categories: [CATEGORIE_ACHATS, sansCompte], natures_immobilisation: [NATURE] })
    monter(true)
    await screen.findByText('Comptes manquants')
  })

  it('n’écrit pas un bien sans nature : ni sur le compte d’un bien, ni en charge', async () => {
    poser({ pieces: [facture()], immobilisations: [{ ...BIEN, nature_id: null }], natures_immobilisation: [NATURE] })
    monter(true)
    // Attendre la FIN du chargement : le compte « 0 écriture proposée » s'affiche dès le premier rendu.
    await screen.findByText("Aucune écriture proposée pour l'instant.")
    expect(screen.queryByRole('button', { name: /Générer les écritures manquantes \(1\)/ })).toBeNull()
    expect(screen.queryByText(/en attente de génération/)).toBeNull()
  })

  it('dit « à régénérer » la charge d’une pièce immobilisée après coup, et Régénérer la passe sur le compte du bien', async () => {
    poser({
      pieces: [facture()], immobilisations: [BIEN], natures_immobilisation: [NATURE],
      ecritures_brouillon: [ecriture({ id: 'e1', montant: 100 }), ecriture({ id: 'e2', compte: '445660', montant: 20 })],
    })
    monter(true)
    await screen.findByText('Écritures à régénérer')
    // Le bien a une nature : l'écriture n'est pas « sans objet », elle est à réécrire.
    expect(screen.queryByText('Écritures que la pièce ne justifie plus')).toBeNull()
    await act(async () => { screen.getByRole('button', { name: 'Régénérer' }).click() })
    expect(faux.insertions.at(-1)!.lignes.map((l) => [l.compte, l.montant])).toEqual([['218300', 100], ['445620', 20]])
  })

  it('se tait sur une acquisition déjà écrite comme la génération l’écrit', async () => {
    poser({
      pieces: [facture()], immobilisations: [BIEN], natures_immobilisation: [NATURE],
      ecritures_brouillon: [ecriture({ id: 'e1', compte: '218300', montant: 100 }), ecriture({ id: 'e2', compte: '445620', montant: 20 })],
    })
    monter(true)
    await screen.findByText(/2 écritures proposées/)
    expect(screen.queryAllByText(/à régénérer/)).toHaveLength(0)
    expect(screen.queryByText('Écritures que la pièce ne justifie plus')).toBeNull()
    // Et sa TVA, au 445620, compte dans la TVA déductible : elle se déduit comme celle d'un achat.
    expect(screen.getByText('TVA déductible (achats)').parentElement?.textContent).toMatch(/20,00\s€/)
  })

  it('suspend la génération quand les natures sont lues en partie : un bien paraîtrait sans nature', async () => {
    poser({ pieces: [facture()], immobilisations: [BIEN], natures_immobilisation: [NATURE, { ...NATURE, id: 'n2' }] })
    faux.muetParTable = { natures_immobilisation: 1 }
    monter(true)
    await screen.findByText(/La génération est suspendue/)
    const bouton = screen.getByRole('button', { name: /Générer les écritures manquantes/ })
    expect(bouton.hasAttribute('disabled')).toBe(true)
    await act(async () => { bouton.click() })
    expect(faux.insertions).toHaveLength(0)
  })

  // UN DOSSIER REPRIS (lib/aNouveaux.ts) : la balance reprise porte déjà, en classe 2, la valeur brute des
  // biens acquis avant son ouverture. Écrire encore leur acquisition la compterait deux fois.
  const OUVERTURE = [
    {
      id: 'an-1', dossier_id: 'dossier-de-test', date: '2026-01-01', compte: '218300', compte_origine: '2183',
      libelle: 'Matériel informatique', sens: 'debit', montant: 1200, source_nom: 'balance-2025.csv',
      source_empreinte: 'b'.repeat(64), created_at: '2026-09-26T10:00:00Z',
    },
    {
      id: 'an-2', dossier_id: 'dossier-de-test', date: '2026-01-01', compte: '108000', compte_origine: '108',
      libelle: 'Compte de l’exploitant', sens: 'credit', montant: 1200, source_nom: 'balance-2025.csv',
      source_empreinte: 'b'.repeat(64), created_at: '2026-09-26T10:00:00Z',
    },
  ]
  const BIEN_REPRIS = { ...BIEN, date_acquisition: '2025-03-10' }
  const acquisitionEcrite = () => [
    ecriture({ id: 'e1', compte: '218300', montant: 100 }),
    ecriture({ id: 'e2', compte: '445620', montant: 20 }),
    ecriture({ id: 'e3', compte: '512000', sens: 'credit', montant: 120 }),
  ]

  it('n’écrit pas l’acquisition d’un bien acquis avant l’ouverture du dossier', async () => {
    poser({ pieces: [facture()], immobilisations: [BIEN_REPRIS], natures_immobilisation: [NATURE], a_nouveaux: OUVERTURE })
    monter(true)
    await screen.findByText("Aucune écriture proposée pour l'instant.")
    expect(screen.queryByRole('button', { name: /Générer les écritures manquantes \(1\)/ })).toBeNull()
    expect(screen.queryByText(/en attente de génération/)).toBeNull()
  })

  // GARDE SYMÉTRIQUE : la balance reprise est celle de la veille de l'ouverture. Un bien acquis le jour même
  // n'y est pas, et son acquisition s'écrit.
  it('écrit celle d’un bien acquis le jour de l’ouverture', async () => {
    poser({
      pieces: [facture({ date_piece: '2026-01-01' })], immobilisations: [{ ...BIEN, date_acquisition: '2026-01-01' }],
      natures_immobilisation: [NATURE], a_nouveaux: OUVERTURE,
    })
    monter(true, TRESORERIE, 2026)
    const bouton = await screen.findByRole('button', { name: /Générer les écritures manquantes \(1\)/ })
    await act(async () => { bouton.click() })
    expect(faux.insertions[0].lignes.map((l) => [l.compte, l.montant])).toEqual([['218300', 100], ['445620', 20]])
  })

  it('voit l’écriture d’un bien repris, et la retire en entier en disant que la balance reprise le porte', async () => {
    let message = ''
    vi.stubGlobal('confirm', (m: string) => { message = m; return true })
    poser({
      pieces: [facture()], immobilisations: [BIEN_REPRIS], natures_immobilisation: [NATURE], a_nouveaux: OUVERTURE,
      ecritures_brouillon: acquisitionEcrite(),
    })
    monter(true)
    await screen.findByText('Écritures que la pièce ne justifie plus')
    expect(screen.getByText(/Bien acquis avant l'ouverture du dossier : la balance reprise porte déjà sa valeur/)).toBeDefined()
    // Ce n'est pas une écriture à réécrire : rien ne doit s'écrire.
    expect(screen.queryByText('Écritures à régénérer')).toBeNull()
    await act(async () => { screen.getByRole('button', { name: /Retirer l'écriture/ }).click() })
    expect(message).toMatch(/la balance reprise porte déjà son acquisition/)
    expect(message).not.toMatch(/une fois sa nature choisie/)
    expect(faux.parTable.ecritures_brouillon).toEqual([])
    vi.unstubAllGlobals()
  })

  it('dit la nature à choisir, pas la balance reprise, dans la confirmation du retrait d’un bien sans nature', async () => {
    let message = ''
    vi.stubGlobal('confirm', (m: string) => { message = m; return false })
    poser({
      pieces: [facture()], immobilisations: [{ ...BIEN, nature_id: null }], natures_immobilisation: [NATURE],
      ecritures_brouillon: acquisitionEcrite().map((e) => (e.compte === '218300' ? { ...e, compte: '606100' } : e)),
    })
    monter(true)
    await screen.findByText('Écritures que la pièce ne justifie plus')
    await act(async () => { screen.getByRole('button', { name: /Retirer l'écriture/ }).click() })
    expect(message).toMatch(/une fois sa nature choisie/)
    expect(message).not.toMatch(/balance reprise/)
    vi.unstubAllGlobals()
  })

  // C'EST L'OUVERTURE QUI DIT SI UN BIEN EST REPRIS : lue en partie, la génération attend dès qu'un bien est
  // en attente — l'écrire pourrait compter une seconde fois ce que la balance reprise porte.
  it('suspend la génération d’un bien quand l’ouverture est lue en partie, et dit pourquoi', async () => {
    poser({
      pieces: [facture()], immobilisations: [{ ...BIEN, date_acquisition: '2026-02-01' }], natures_immobilisation: [NATURE],
      a_nouveaux: OUVERTURE,
    })
    faux.muetParTable = { a_nouveaux: 1 }
    monter(true)
    await screen.findByText(/Les à-nouveaux du dossier n'ont pas pu être lus en entier/)
    expect(screen.getByText(/elle attend donc une lecture complète tant qu’un bien est en attente/)).toBeDefined()
    const bouton = screen.getByRole('button', { name: /Générer les écritures manquantes/ })
    expect(bouton.hasAttribute('disabled')).toBe(true)
    expect(bouton.getAttribute('title')).toMatch(/À-nouveaux lus incomplètement/)
    await act(async () => { bouton.click() })
    expect(faux.insertions).toHaveLength(0)
  })

  it('suspend « Régénérer » sur la facture d’un bien quand l’ouverture est lue en partie', async () => {
    poser({
      pieces: [facture()], immobilisations: [{ ...BIEN, date_acquisition: '2026-02-01' }], natures_immobilisation: [NATURE],
      a_nouveaux: OUVERTURE,
      ecritures_brouillon: [ecriture({ id: 'e1', montant: 100 }), ecriture({ id: 'e2', compte: '445660', montant: 20 })],
    })
    faux.muetParTable = { a_nouveaux: 1 }
    monter(true)
    await screen.findByText('Écritures à régénérer')
    const bouton = screen.getByRole('button', { name: 'Régénérer' })
    expect(bouton.hasAttribute('disabled')).toBe(true)
    expect(bouton.getAttribute('title')).toMatch(/si la balance reprise porte déjà ce bien/)
    await act(async () => { bouton.click() })
    expect(faux.suppressions).toHaveLength(0)
    expect(faux.insertions).toHaveLength(0)
  })
})

describe('EcrituresTab — une recherche filtre l’affichage, jamais le FEC', () => {
  it("exporte l'exercice entier alors que le tableau n'en montre qu'une ligne", async () => {
    poser({
      pieces: [piece()],
      ecritures_brouillon: [
        ecriture({ id: 'e1', compte: '606100', montant: 100 }),
        ecriture({ id: 'e2', compte: '445660', montant: 20 }),
      ],
    })
    monter()

    await screen.findByText('606100')
    const champ = screen.getByRole('searchbox', { name: /Rechercher un compte/ })
    await act(async () => { fireEvent.change(champ, { target: { value: '606' } }) })

    // Le tableau se réduit…
    expect(screen.queryByText('445660')).toBeNull()
    expect(screen.getByText('1 sur 2')).toBeDefined()

    // …et le fichier fiscal, lui, porte les DEUX comptes. Un FEC amputé des lignes ne
    // correspondant pas au texte tapé est un fichier faux, et son format n'a pas de place pour
    // le dire.
    await act(async () => { screen.getByRole('button', { name: /Exporter FEC/ }).click() })
    expect(telecharge.fichiers).toHaveLength(1)
    expect(telecharge.fichiers[0].contenu).toContain('606100')
    expect(telecharge.fichiers[0].contenu).toContain('445660')
  })
})

describe('EcrituresTab — un export se refuse sur une lecture partielle', () => {
  it('grise les deux exports et dit pourquoi, plutôt que de produire un fichier amputé', async () => {
    // Le serveur annonce deux écritures et n'en rend qu'une, puis ne rend plus rien — et la réponse
    // reste une liste parfaitement valide, simplement plus courte que la réalité. C'est le plafond
    // « Max rows » de PostgREST, qui ne se signale pas.
    poser({
      pieces: [piece()],
      ecritures_brouillon: [ecriture({ id: 'e1' }), ecriture({ id: 'e2', compte: '445660', montant: 20 })],
    })
    faux.muetApres = 1
    monter()

    await screen.findByText(/Le brouillon n'a pas pu être lu en entier/)
    expect(screen.getByRole('button', { name: /Exporter FEC/ }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: /Exporter la piste d'audit/ }).hasAttribute('disabled')).toBe(true)
  })
})

describe("EcrituresTab — retrait d'une écriture sans objet", () => {
  // Le SEUL geste destructeur de cet onglet, et le seul dont l'absence rendait le panneau ci-dessus
  // purement déclaratif : il nommait l'action (« Retirer l'écriture ») sans que rien ne puisse la
  // faire. Ce que ces tests gardent est la FORME du retrait, qu'aucun test de lib ne peut voir —
  // le module ne supprime rien, c'est l'écran qui parle à la base.

  function poserImmobilisee() {
    poser({
      pieces: [piece()],
      ecritures_brouillon: [
        ecriture({ id: 'e1', compte: '606100', sens: 'debit', montant: 120 }),
        ecriture({ id: 'e2', compte: '512000', sens: 'credit', montant: 120, ligne_bancaire_id: 'l1' }),
      ],
      immobilisations: [{ id: 'i1', dossier_id: 'dossier-de-test', piece_id: 'p1' }],
      lignes_bancaires: [{
        id: 'l1', dossier_id: 'dossier-de-test', date: '2025-03-10', libelle: 'ACHAT',
        montant: -120, statut: 'rapprochee', piece_id: 'p1', cotisation_id: null, categorie_id: null, taux_tva: null,
        prelevement_personnel: false, source_fichier: null, libelle_brut: null, created_at: '2025-03-10T09:00:00Z',
      }],
    })
  }

  it('retire TOUTES les lignes, contrepartie banque comprise — sans allumer une autre alerte', async () => {
    // LE point du test. N'ôter que la charge (comme le fait `regenererEcriture`, dont le `.neq` est
    // juste POUR LUI) laisserait la ligne banque seule dans son groupe : un groupe qui porte une
    // contrepartie et dont le solde vaut −120, c'est-à-dire exactement ce que `groupesDesequilibres`
    // signale — et qu'aucun geste ne pourrait plus éteindre. On aurait échangé une alerte vraie
    // contre une alerte fausse et définitive.
    vi.stubGlobal('confirm', () => true)
    poserImmobilisee()
    monter()

    await screen.findByText('Écritures que la pièce ne justifie plus')
    await act(async () => { screen.getByRole('button', { name: /Retirer l'écriture/ }).click() })

    expect(screen.queryByText('Écritures que la pièce ne justifie plus')).toBeNull()
    expect(faux.parTable.ecritures_brouillon).toEqual([])
    // La seconde moitié, celle qui mord sur le `.neq` : aucune alerte n'a pris la place de l'autre.
    expect(screen.queryAllByText(/déséquilibrée/)).toHaveLength(0)
    vi.unstubAllGlobals()
  })

  it("n'offre ce bouton qu'à une pièce immobilisée, jamais aux trois autres motifs", async () => {
    // Pour « catégorie retirée », « catégorie sans compte » et « montant effacé », l'écriture DOIT
    // revenir une fois la pièce corrigée en amont. Un bouton « Retirer » y ferait disparaître une
    // charge réelle d'un clic, sans trace — et personne ne la chercherait, le panneau étant vide.
    poser({
      pieces: [piece({ categorie_id: null })],
      ecritures_brouillon: [
        ecriture({ id: 'e1', compte: '606100', sens: 'debit', montant: 120 }),
        ecriture({ id: 'e2', compte: '512000', sens: 'credit', montant: 120 }),
      ],
    })
    monter()

    // L'ancre : le panneau est bien là, avec SON motif. Sans elle, un écran encore en chargement
    // rendrait ce test vert pour une raison fausse.
    await screen.findByText('Écritures que la pièce ne justifie plus')
    expect(screen.getByText(/La catégorie a été retirée/)).toBeDefined()
    expect(screen.queryByRole('button', { name: /Retirer l'écriture/ })).toBeNull()
  })

  it('un refus de la base se dit, et les lignes restent en place', async () => {
    // Le défaut de `SuperPdpModal.retirer()`, transposé : muette, une suppression refusée laisse le
    // panneau tel quel — donc indiscernable d'un bouton qui n'a rien fait, et le réflexe (recliquer)
    // rend le même silence. Ici il faut en plus que les lignes soient TOUJOURS là : un écran qui
    // afficherait l'erreur mais aurait vidé sa liste mentirait deux fois.
    vi.stubGlobal('confirm', () => true)
    poserImmobilisee()
    faux.refusSuppression = 'permission denied for table ecritures_brouillon'
    monter()

    await screen.findByText('Écritures que la pièce ne justifie plus')
    await act(async () => { screen.getByRole('button', { name: /Retirer l'écriture/ }).click() })

    expect(screen.getByText(/permission denied for table ecritures_brouillon/)).toBeDefined()
    expect(faux.parTable.ecritures_brouillon).toHaveLength(2)
    expect(screen.getByText('Écritures que la pièce ne justifie plus')).toBeDefined()
    vi.unstubAllGlobals()
  })

  it("une confirmation refusée ne supprime rien", async () => {
    vi.stubGlobal('confirm', () => false)
    poserImmobilisee()
    monter()

    await screen.findByText('Écritures que la pièce ne justifie plus')
    await act(async () => { screen.getByRole('button', { name: /Retirer l'écriture/ }).click() })

    expect(faux.parTable.ecritures_brouillon).toHaveLength(2)
    vi.unstubAllGlobals()
  })
})

describe('EcrituresTab — une lecture partielle ne commande pas la génération', () => {
  // `enAttente`, ce sont les pièces à comptabiliser MOINS celles dont on a LU l'écriture. Sur un
  // brouillon lu à moitié, il porte donc des pièces déjà comptabilisées — et « Générer » doublait
  // leur charge dans le FEC et la balance. Les exports se refusaient déjà sur cette lecture ; la
  // génération, qui ÉCRIT, restait ouverte.
  function poserDeuxPiecesComptabilisees() {
    poser({
      pieces: [piece({ id: 'p1' }), piece({ id: 'p2', tiers: 'SECOND FOURNISSEUR' })],
      ecritures_brouillon: [ecriture({ id: 'e1', piece_id: 'p1' }), ecriture({ id: 'e2', piece_id: 'p2', libelle: 'SECOND FOURNISSEUR' })],
    })
  }

  it("grise la génération sur un brouillon lu à moitié, et n'écrit rien", async () => {
    poserDeuxPiecesComptabilisees()
    // Le serveur rend l'écriture de p1 et se tait sur celle de p2 : p2 a l'air « en attente ».
    faux.muetParTable = { ecritures_brouillon: 1 }
    monter()

    await screen.findByText(/La génération est suspendue/)
    const bouton = screen.getByRole('button', { name: /Générer les écritures manquantes/ })
    expect(bouton.hasAttribute('disabled')).toBe(true)
    // Le compte se tait plutôt que d'annoncer une pièce « en attente » qui ne l'est pas.
    expect(bouton.textContent).not.toMatch(/\(\d+\)/)
    expect(screen.queryByText(/en attente de génération/)).toBeNull()

    await act(async () => { bouton.click() })
    expect(faux.insertions).toHaveLength(0)
  })

  it('génère, sur une lecture complète, les écritures de la seule pièce qui en manque', async () => {
    // Le garde symétrique : sans lui, « on ne génère pas sur une lecture partielle » serait satisfait
    // par un bouton qui ne génère JAMAIS.
    poser({
      pieces: [piece({ id: 'p1' }), piece({ id: 'p2', tiers: 'SECOND FOURNISSEUR' })],
      ecritures_brouillon: [ecriture({ id: 'e1', piece_id: 'p1' })],
    })
    monter()

    const bouton = await screen.findByRole('button', { name: /Générer les écritures manquantes \(1\)/ })
    await act(async () => { bouton.click() })

    expect(faux.insertions).toHaveLength(1)
    expect(faux.insertions[0].table).toBe('ecritures_brouillon')
    expect(faux.insertions[0].lignes.every((l) => l.piece_id === 'p2')).toBe(true)
  })

  it("date au PAIEMENT l'écriture d'une pièce déjà rapprochée, contrepartie comprise", async () => {
    // Une facture de décembre 2024 réglée en janvier 2025 : la 2035 la compte en 2025, et son
    // écriture doit tomber dans le même exercice — charge ET banque, une seule date, une écriture
    // équilibrée dans un seul FEC (lib/rattachement.ts).
    poser({
      pieces: [piece({ id: 'p1', date_piece: '2024-12-20' })],
      ecritures_brouillon: [],
      lignes_bancaires: [{
        id: 'l1', dossier_id: 'dossier-de-test', date: '2025-01-06', libelle: 'PRLV FOURNISSEUR',
        montant: -120, statut: 'rapprochee', piece_id: 'p1', cotisation_id: null, prelevement_personnel: false,
        source_fichier: null, libelle_brut: null, created_at: '2025-01-07T09:00:00Z',
      }],
    })
    monter()

    const bouton = await screen.findByRole('button', { name: /Générer les écritures manquantes \(1\)/ })
    await act(async () => { bouton.click() })

    const dates = (faux.parTable.ecritures_brouillon as { compte: string; date: string }[]).map((e) => [e.compte, e.date])
    expect(dates).toEqual([['606100', '2025-01-06'], ['512000', '2025-01-06']])
  })

  it("répartit l'écriture d'une pièce réglée en partie entre la facture et le paiement", async () => {
    // 120 € dont 48 € rapprochés : la part payée au paiement, le reste à la date de facture. Le
    // rapprochement ne redate pas un paiement partiel, c'est donc la génération qui doit le faire.
    poser({
      pieces: [piece({ id: 'p1', date_piece: '2024-12-20' })],
      ecritures_brouillon: [],
      lignes_bancaires: [{
        id: 'l1', dossier_id: 'dossier-de-test', date: '2025-01-06', libelle: 'PRLV FOURNISSEUR',
        montant: -48, statut: 'rapprochee', piece_id: 'p1', cotisation_id: null, prelevement_personnel: false,
        source_fichier: null, libelle_brut: null, created_at: '2025-01-07T09:00:00Z',
      }],
    })
    monter()

    const bouton = await screen.findByRole('button', { name: /Générer les écritures manquantes \(1\)/ })
    await act(async () => { bouton.click() })

    const charges = (faux.parTable.ecritures_brouillon as { compte: string; date: string; montant: number }[])
      .filter((e) => e.compte === '606100').map((e) => [e.date, e.montant])
    expect(charges).toEqual([['2024-12-20', 72], ['2025-01-06', 48]])
  })

  it("trois clics rapprochés ne génèrent qu'une fois", async () => {
    // Trois et non deux : un verrou posé DANS le `try` serait relâché par le `finally` du deuxième
    // clic, refusé, et laisserait passer le troisième.
    poser({ pieces: [piece({ id: 'p1' })], ecritures_brouillon: [] })
    monter()

    const bouton = await screen.findByRole('button', { name: /Générer les écritures manquantes \(1\)/ })
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })

    expect(faux.insertions).toHaveLength(1)
  })

  it('reste fermée pendant la relecture qui suit une génération', async () => {
    // Relâché avant la relecture, le bouton redevenait cliquable sur un `enAttente` qui portait
    // encore la pièce qu'on venait de comptabiliser : un clic à ce moment la générait une seconde fois.
    poser({ pieces: [piece({ id: 'p1' })], ecritures_brouillon: [] })
    faux.retenirApresInsertion = true
    monter()

    const bouton = await screen.findByRole('button', { name: /Générer les écritures manquantes \(1\)/ })
    await act(async () => { bouton.click() })
    expect(faux.insertions).toHaveLength(1)

    // La relecture est retenue : l'écran n'a pas encore vu l'écriture créée.
    await act(async () => { screen.getByRole('button', { name: /Génération…|Générer les écritures manquantes/ }).click() })
    expect(faux.insertions).toHaveLength(1)

    faux.retenirApresInsertion = false
    await act(async () => { faux.relacher?.() })
    faux.retenue = null
    expect(faux.insertions).toHaveLength(1)
  })
})

// L'OUVERTURE D'UN DOSSIER REPRIS (ligne 29, décision du cabinet du 26/09/2026). Les à-nouveaux ne
// sont pas des écritures du brouillon ; ils ouvrent pourtant le FEC et la piste d'audit de l'exercice
// qu'ils ouvrent. Le format est testé dans `lib/fec.ts` ; ce qui se joue ici est le CÂBLAGE — la
// lecture, le filtre d'exercice, et les deux refus sur une lecture partielle.
describe('EcrituresTab — les à-nouveaux ouvrent les exports de leur exercice', () => {
  function aNouveau(o: Record<string, unknown> = {}) {
    return {
      id: 'an-1', dossier_id: 'dossier-de-test', date: '2025-01-01', compte: '512000', compte_origine: '51210000',
      libelle: 'Banque Populaire', sens: 'debit', montant: 4000, source_nom: 'balance-2024.csv',
      source_empreinte: 'b'.repeat(64), created_at: '2026-09-26T10:00:00Z', ...o,
    }
  }
  const OUVERTURE = [
    aNouveau(),
    aNouveau({ id: 'an-2', compte: '108', compte_origine: '108', libelle: 'Compte de l’exploitant', sens: 'credit' }),
  ]

  it('ouvre le FEC de l’exercice par le journal AN, et le dit à l’écran', async () => {
    poser({ pieces: [piece()], ecritures_brouillon: [ecriture()], a_nouveaux: OUVERTURE })
    monter()

    await screen.findByText(/Exercice ouvert par 2 à-nouveaux au 01\/01\/2025, repris de balance-2024\.csv/)
    await act(async () => { screen.getByRole('button', { name: /Exporter FEC/ }).click() })
    const lignes = telecharge.fichiers[0].contenu.split('\r\n').map((l) => l.split('\t'))
    expect(lignes.slice(1).map((l) => [l[0], l[4]])).toEqual([['AN', '108'], ['AN', '512000'], ['AC', '606100']])
  })

  it('s’exporte même quand l’exercice n’a encore que son ouverture', async () => {
    poser({ a_nouveaux: OUVERTURE })
    monter()

    await screen.findByText(/Exercice ouvert par 2 à-nouveaux/)
    const bouton = screen.getByRole('button', { name: /Exporter FEC/ })
    expect(bouton.hasAttribute('disabled')).toBe(false)
    await act(async () => { bouton.click() })
    expect(telecharge.fichiers[0].contenu.split('\r\n')).toHaveLength(3)
  })

  // GARDE SYMÉTRIQUE : sans elle, « le FEC s'ouvre par ses à-nouveaux » serait satisfait par un
  // écran qui les colle en tête de TOUS les exercices.
  it('ne les met pas dans le FEC d’un autre exercice', async () => {
    poser({ pieces: [piece()], ecritures_brouillon: [ecriture()], a_nouveaux: OUVERTURE.map((a) => ({ ...a, date: '2026-01-01' })) })
    monter()

    await screen.findByText('606100')
    expect(screen.queryAllByText(/Exercice ouvert par/)).toHaveLength(0)
    await act(async () => { screen.getByRole('button', { name: /Exporter FEC/ }).click() })
    expect(telecharge.fichiers[0].contenu).not.toContain('\nAN\t')
  })

  it('les porte dans la piste d’audit, justifiés par la balance et son empreinte', async () => {
    poser({ pieces: [piece()], ecritures_brouillon: [ecriture()], a_nouveaux: OUVERTURE })
    monter()

    await screen.findByText(/Exercice ouvert par 2 à-nouveaux/)
    await act(async () => { screen.getByRole('button', { name: /Exporter la piste d'audit/ }).click() })
    const csv = telecharge.fichiers.find((f) => f.nom.startsWith('piste-audit'))!.contenu
    expect(csv).toContain(`2025-01-01;512000;À-nouveau 51210000 Banque Populaire;4000,00;0,00;;;;balance-2024.csv;${'b'.repeat(64)}`)
  })

  it('refuse les deux exports quand l’ouverture n’a été lue qu’à moitié, sans suspendre la génération', async () => {
    // Une pièce validée attend son écriture : la génération n'a aucune raison de s'arrêter pour une
    // ouverture illisible, qu'elle ne lit pas.
    poser({ pieces: [piece()], a_nouveaux: OUVERTURE })
    faux.muetParTable = { a_nouveaux: 1 }
    monter()

    await screen.findByText(/Les à-nouveaux du dossier n'ont pas pu être lus en entier/)
    expect(screen.queryAllByText(/Le brouillon n'a pas pu être lu en entier/)).toHaveLength(0)
    expect(screen.getByRole('button', { name: /Exporter FEC/ }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: /Exporter la piste d'audit/ }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: /Générer les écritures manquantes/ }).hasAttribute('disabled')).toBe(false)
  })
})

// LE REPORT DES SOLDES (ligne 34, décision du cabinet du 06/10/2026). La validation d'un exercice écrit l'ouverture du
// suivant — les soldes reportés, à part des à-nouveaux de la reprise —, et tant qu'un exercice n'est pas validé, le suivant
// n'a pas d'ouverture : l'écran le dit. Le calcul est testé dans lib/reportDesSoldes.ts ; ce qui se joue ici est le CÂBLAGE :
// la lecture, l'exercice qu'ils ouvrent, la phrase de chaque état, et les refus sur une lecture partielle.
describe('EcrituresTab — les soldes reportés ouvrent l’exercice qui suit un exercice validé', () => {
  function reporte(o: Record<string, unknown> = {}) {
    return {
      id: 'sr-1', dossier_id: 'dossier-de-test', date: '2026-01-01', compte: '512000', libelle: 'Banque', sens: 'debit',
      montant: 2800, source_nom: 'Exercice 2025 validé', source_empreinte: 'c'.repeat(64), created_at: '2026-03-01T10:00:00Z',
      compte_lib: null, ecriture_lib: null, ...o,
    }
  }
  const REPORT = [
    reporte(),
    reporte({ id: 'sr-2', compte: '101000', libelle: 'Capital individuel', sens: 'credit' }),
  ]
  // Une écriture de 2025, validée : ce que la validation a figé, pour que l'exercice 2025 s'exporte tel qu'elle l'a fait.
  const FIGE_2025 = {
    statut: 'validee', valide_le: '2026-03-01T10:00:00Z', journal_code: 'AC', numero_ecriture: 1, piece_ref: 'facture.pdf',
    piece_date: '2025-03-10', compte_lib: 'Achats', comp_aux_num: null, comp_aux_lib: null,
  }

  it('ouvre le FEC de l’exercice suivant par le journal AN, et le dit à l’écran', async () => {
    poser({ pieces: [piece({ id: 'p2', date_piece: '2026-02-10' })], ecritures_brouillon: [ecriture({ piece_id: 'p2', date: '2026-02-10' })], soldes_reportes: REPORT })
    monter(false, TRESORERIE, 2026, [2025])

    await screen.findByText(/Exercice ouvert par 2 soldes reportés de l’exercice 2025 validé, au 01\/01\/2026 : ils ouvrent le FEC et la piste d’audit de 2026 \(journal AN\)/)
    await act(async () => { screen.getByRole('button', { name: 'Exporter FEC 2026' }).click() })
    const lignes = telecharge.fichiers[0].contenu.split('\r\n').map((l) => l.split('\t'))
    expect(lignes.slice(1).map((l) => [l[0], l[3], l[4], l[8], l[10]])).toEqual([
      ['AN', '20260101', '101000', 'Exercice 2025 validé', 'À-nouveau Capital individuel'],
      ['AN', '20260101', '512000', 'Exercice 2025 validé', 'À-nouveau Banque'],
      ['AC', '20260210', '606100', 'facture.pdf', 'FOURNISSEUR MARSEILLE'],
    ])
    expect(lignes[1][12]).toBe('2800,00')
  })

  it('les porte dans la piste d’audit, justifiés par l’exercice validé et son empreinte', async () => {
    poser({ soldes_reportes: REPORT })
    monter(false, TRESORERIE, 2026, [2025])

    await screen.findByText(/Exercice ouvert par 2 soldes reportés/)
    await act(async () => { screen.getByRole('button', { name: /Exporter la piste d'audit/ }).click() })
    const csv = telecharge.fichiers.find((f) => f.nom.startsWith('piste-audit'))!.contenu
    expect(csv).toContain(`2026-01-01;512000;À-nouveau Banque;2800,00;0,00;;;;Exercice 2025 validé;${'c'.repeat(64)}`)
    expect(csv).toContain(`2026-01-01;101000;À-nouveau Capital individuel;0,00;2800,00;;;;Exercice 2025 validé;${'c'.repeat(64)}`)
  })

  // GARDE SYMÉTRIQUE : les soldes reportés n'ouvrent que l'exercice de leur date. Ré-exporté, le FEC de l'exercice validé
  // ne les porte pas — ils sont sa clôture, pas son ouverture.
  it('ne les met pas dans le FEC de l’exercice validé qui les a écrits', async () => {
    poser({ pieces: [piece()], ecritures_brouillon: [ecriture({ id: 'f1', ...FIGE_2025 }), ecriture({ id: 'f2', compte: '512000', sens: 'credit', ...FIGE_2025, compte_lib: 'Banque' })], soldes_reportes: REPORT })
    monter(false, TRESORERIE, 2025, [2025])

    await screen.findByText(/2 validées/)
    expect(screen.queryAllByText(/soldes reportés|n’a pas encore d’ouverture/)).toHaveLength(0)
    await act(async () => { screen.getByRole('button', { name: 'Exporter FEC 2025 (validé)' }).click() })
    expect(telecharge.fichiers[0].contenu).not.toContain('\nAN\t')
  })

  it('dit qu’un exercice n’a pas encore d’ouverture tant que le précédent n’est pas validé', async () => {
    poser({
      pieces: [piece(), piece({ id: 'p2', date_piece: '2026-02-10' })],
      ecritures_brouillon: [ecriture(), ecriture({ id: 'e2', piece_id: 'p2', date: '2026-02-10' })],
    })
    monter(false, TRESORERIE, 2026)

    await screen.findByText(/L’exercice 2026 n’a pas encore d’ouverture : elle s’écrira à la validation de l’exercice 2025 \(Clôture\)\. Jusque-là, son FEC et sa piste d’audit s’ouvrent sans à-nouveaux, et ses comptes de bilan y partent de zéro\./)
    await act(async () => { screen.getByRole('button', { name: 'Exporter FEC 2026' }).click() })
    expect(telecharge.fichiers[0].contenu).not.toContain('\nAN\t')
  })

  it('dit qu’un exercice validé dont tous les comptes étaient soldés n’a rien reporté', async () => {
    poser({ pieces: [piece({ id: 'p2', date_piece: '2026-02-10' })], ecritures_brouillon: [ecriture({ piece_id: 'p2', date: '2026-02-10' })] })
    monter(false, TRESORERIE, 2026, [2025])

    await screen.findByText(/L’exercice 2025 validé n’a rien reporté : tous ses comptes de bilan étaient soldés, et le FEC de 2026 s’ouvre sans à-nouveaux\./)
  })

  // GARDE SYMÉTRIQUE : le premier exercice d'une activité n'attend aucune ouverture — le dire en attente crierait au loup
  // sur chaque dossier neuf.
  it('ne dit rien du premier exercice d’une activité', async () => {
    poser({ pieces: [piece()], ecritures_brouillon: [ecriture()] })
    monter(false, TRESORERIE, 2025)

    await screen.findByText('606100')
    expect(screen.queryAllByText(/ouverture|ouvert par|n’a rien reporté/)).toHaveLength(0)
  })

  it('refuse les deux exports quand les soldes reportés n’ont été lus qu’à moitié, sans suspendre la génération', async () => {
    poser({ pieces: [piece({ id: 'p2', date_piece: '2026-02-10' })], soldes_reportes: REPORT })
    faux.muetParTable = { soldes_reportes: 1 }
    monter(false, TRESORERIE, 2026, [2025])

    await screen.findByText(/Les soldes reportés des exercices validés n'ont pas pu être lus en entier/)
    expect(screen.queryAllByText(/Le brouillon n'a pas pu être lu en entier/)).toHaveLength(0)
    // Un compte fait sur une lecture partielle serait faux : la phrase se tait, le bandeau parle.
    expect(screen.queryAllByText(/soldes? reportés? de l’exercice|n’a rien reporté/)).toHaveLength(0)
    expect(screen.getByRole('button', { name: /Exporter FEC/ }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: /Exporter la piste d'audit/ }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: /Générer les écritures manquantes/ }).hasAttribute('disabled')).toBe(false)
  })
})

// UN DOSSIER EXONÉRÉ NE VENTILE PAS LA TVA (voir lib/montantRetenu.ts) : sa charge est le TTC, sur
// une seule ligne. Ce que ce test garde, et qu'aucun test de `src/lib` ne peut garder : que l'onglet
// passe SON statut à la génération, à la régénération ET au contrôle des écritures à régénérer.
describe('EcrituresTab — le statut TVA du dossier décide de la ventilation', () => {
  const pieceAvecTva = () => piece({ id: 'p1', montant_ht: 100, montant_tva: 20, montant_ttc: 120 })

  it('un dossier exonéré génère la charge TTC sur une seule ligne, sans 445660', async () => {
    poser({ pieces: [pieceAvecTva()], ecritures_brouillon: [] })
    monter(false)
    const bouton = await screen.findByRole('button', { name: /Générer les écritures manquantes \(1\)/ })
    await act(async () => { bouton.click() })
    expect(faux.insertions[0].lignes.map((l) => [l.compte, l.montant])).toEqual([['606100', 120]])
  })

  it('un dossier assujetti ventile la TVA en 445660', async () => {
    poser({ pieces: [pieceAvecTva()], ecritures_brouillon: [] })
    monter(true)
    const bouton = await screen.findByRole('button', { name: /Générer les écritures manquantes \(1\)/ })
    await act(async () => { bouton.click() })
    expect(faux.insertions[0].lignes.map((l) => [l.compte, l.montant])).toEqual([['606100', 100], ['445660', 20]])
  })

  it('sur un dossier exonéré, une TVA encore ventilée est « à régénérer », et la régénération la retire', async () => {
    poser({
      pieces: [pieceAvecTva()],
      ecritures_brouillon: [
        ecriture({ id: 'e1', montant: 100 }),
        ecriture({ id: 'e2', compte: '445660', montant: 20 }),
      ],
    })
    monter(false)
    await screen.findByText('Écritures à régénérer')
    await act(async () => { screen.getByRole('button', { name: 'Régénérer' }).click() })
    expect(faux.insertions.at(-1)!.lignes.map((l) => [l.compte, l.montant])).toEqual([['606100', 120]])
  })

  it('sur un dossier exonéré, la charge TTC sur une seule ligne n’est pas « à régénérer »', async () => {
    // Le garde symétrique : sans lui, le test ci-dessus serait satisfait par un contrôle qui signale
    // toute pièce portant de la TVA.
    poser({ pieces: [pieceAvecTva()], ecritures_brouillon: [ecriture({ id: 'e1', montant: 120 })] })
    monter(false)
    await screen.findByText(/1 écriture proposée/)
    expect(screen.queryByText('Écritures à régénérer')).toBeNull()
  })
})

// LIGNE 26.6 (d) : CE QU'UN EXERCICE VALIDÉ A FIGÉ NE SE COMPARE PLUS. La page du dossier fournit la frontière
// (DossierDetail) ; le calcul est testé à part (lib/ecritures.ts, lib/affectationBanque.ts, lib/ventilationBanque.ts),
// ici c'est le CÂBLAGE — que l'onglet la passe à ses quatre contrôles. Une écriture validée que sa source ne produirait
// plus n'est proposée ni à régénérer, ni à réaffecter, ni à réécrire, ni à retirer : la base refuse ces quatre gestes.
describe('EcrituresTab — ce qu’un exercice validé a figé ne se compare plus', () => {
  // Tout est de 2025, écrit puis validé avec 2025 ; les catégories ont changé de compte depuis.
  const mouvement = (o: Record<string, unknown>) => ({
    id: 'l1', dossier_id: 'dossier-de-test', date: '2025-03-12', libelle: 'PRLV FOURNISSEUR', montant: -120,
    statut: 'rapprochee', piece_id: 'p1', cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
    emprunt_id: null, ventilee: false, reglement_groupe: false, compte_bilan: null, declaration_tva_id: null, source_fichier: 'releve-2025.pdf', libelle_brut: null,
    created_at: '2025-03-13T09:00:00Z', ...o,
  })
  const validee = (o: Record<string, unknown>) => ecriture({ statut: 'validee', ...o })
  const jeu = () => ({
    categories: [
      { ...CATEGORIE_ACHATS, compte_comptable: '606300' },
      { id: 'cat-frais', dossier_id: null, code: 'frais_bancaires', libelle: 'Frais bancaires', ordre: 2, compte_comptable: '627100', poste_2035: 'Frais financiers' },
      { id: 'cat-tel', dossier_id: null, code: 'telephone', libelle: 'Téléphone', ordre: 3, compte_comptable: '626100', poste_2035: 'Frais postaux' },
    ],
    // La seconde pièce n'a plus de catégorie : son écriture validée n'a plus d'objet. Cas défensif — la base fige la
    // catégorie d'une pièce validée.
    pieces: [piece(), piece({ id: 'p2', date_piece: '2025-04-10', montant_ttc: 50, categorie_id: null })],
    lignes_bancaires: [
      mouvement({}),
      mouvement({ id: 'l-aff', date: '2025-05-12', montant: -8.5, piece_id: null, categorie_id: 'cat-frais', libelle: 'FRAIS' }),
      mouvement({ id: 'l-ven', date: '2025-06-12', piece_id: null, ventilee: true, libelle: 'OPERATEUR' }),
    ],
    ventilations_bancaires: [
      { id: 'v1', dossier_id: 'dossier-de-test', ligne_bancaire_id: 'l-ven', categorie_id: 'cat-tel', part_personnelle: false, montant: -84, taux_tva: null, created_at: '2025-06-13T09:00:00Z' },
      { id: 'v2', dossier_id: 'dossier-de-test', ligne_bancaire_id: 'l-ven', categorie_id: null, part_personnelle: true, montant: -36, taux_tva: null, created_at: '2025-06-13T09:00:00Z' },
    ],
    ecritures_brouillon: [
      validee({ id: 'e1', date: '2025-03-12' }),
      validee({ id: 'e2', date: '2025-03-12', compte: '512000', sens: 'credit', ligne_bancaire_id: 'l1' }),
      validee({ id: 'e3', piece_id: 'p2', date: '2025-04-10', montant: 50 }),
      validee({ id: 'e4', piece_id: null, ligne_bancaire_id: 'l-aff', date: '2025-05-12', compte: '627000', montant: 8.5 }),
      validee({ id: 'e5', piece_id: null, ligne_bancaire_id: 'l-aff', date: '2025-05-12', compte: '512000', sens: 'credit', montant: 8.5 }),
      validee({ id: 'e6', piece_id: null, ligne_bancaire_id: 'l-ven', date: '2025-06-12', compte: '626000', montant: 84 }),
      validee({ id: 'e7', piece_id: null, ligne_bancaire_id: 'l-ven', date: '2025-06-12', compte: '108000', montant: 36 }),
      validee({ id: 'e8', piece_id: null, ligne_bancaire_id: 'l-ven', date: '2025-06-12', compte: '512000', sens: 'credit', montant: 120 }),
    ],
  })
  const PANNEAUX = ['Écritures à régénérer', 'Mouvements affectés à réaffecter', 'Mouvements ventilés à réécrire', 'Écritures que la pièce ne justifie plus']

  it('ne les propose plus quand leur exercice est validé', async () => {
    poser(jeu())
    monter(false, TRESORERIE, 2025, [2025])
    // Une écriture validée n'est plus « proposée » : le compte le dit, et chaque ligne le porte.
    await screen.findByText(/0 écriture proposée — 8 validées/)
    expect(screen.getAllByText('validée')).toHaveLength(8)
    for (const panneau of PANNEAUX) expect(screen.queryByText(panneau)).toBeNull()
  })

  // Le garde symétrique : sans exercice validé, chacun des quatre panneaux paraît — le jeu les déclenche bien tous.
  it('les propose tous quand aucun exercice n’est validé', async () => {
    poser(jeu())
    monter(false, TRESORERIE, 2025, [])
    for (const panneau of PANNEAUX) await screen.findByText(panneau)
  })
})

// LIGNE 26.6 (d) : LES GESTES SUR UN EXERCICE VALIDÉ. La base refuse toute écriture au plus tard à la frontière, et
// refuse de modifier ou de retirer celles qui y sont (lib/validationExercice.ts) : la génération n'écrit que la part
// d'après, « Régénérer » et « Retirer » ne reprennent qu'elle, et le FEC d'un exercice validé se relit tel que la
// validation l'a figé. Le calcul est testé à part (lib/ecritures.ts, lib/fec.ts) ; ici, le CÂBLAGE.
describe('EcrituresTab — les gestes sur un exercice validé', () => {
  const mouvement = (o: Record<string, unknown>) => ({
    id: 'l-dec', dossier_id: 'dossier-de-test', date: '2025-12-10', libelle: 'PRLV FOURNISSEUR', montant: -400,
    statut: 'rapprochee', piece_id: 'p1', cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
    emprunt_id: null, ventilee: false, reglement_groupe: false, compte_bilan: null, declaration_tva_id: null, source_fichier: 'releve.pdf', libelle_brut: null,
    created_at: '2025-12-11T09:00:00Z', ...o,
  })
  // Une facture de novembre 2025 payée 400 € en décembre — dans l'exercice validé — et 600 € en février.
  const coupee = piece({ id: 'p1', date_piece: '2025-11-15', montant_ttc: 1000 })
  const PAIEMENTS = [mouvement({}), mouvement({ id: 'l-fev', date: '2026-02-10', montant: -600, created_at: '2026-02-11T09:00:00Z' })]
  const PART_VALIDEE = [
    ecriture({ id: 'v1', date: '2025-12-10', montant: 400, statut: 'validee' }),
    ecriture({ id: 'v2', date: '2025-12-10', compte: '512000', sens: 'credit', montant: 400, ligne_bancaire_id: 'l-dec', statut: 'validee' }),
  ]
  const PART_OUVERTE = [
    ecriture({ id: 'o1', date: '2026-02-10', montant: 600 }),
    ecriture({ id: 'o2', date: '2026-02-10', compte: '512000', sens: 'credit', montant: 600, ligne_bancaire_id: 'l-fev' }),
  ]

  it('n’écrit que la part d’après la frontière, et nomme la pièce', async () => {
    poser({ pieces: [coupee], lignes_bancaires: PAIEMENTS })
    monter(false, TRESORERIE, 2026, [2025])
    const bouton = await screen.findByRole('button', { name: /Générer les écritures manquantes \(1\)/ })
    expect(screen.getByText('Pièces datées d’un exercice validé')).toBeDefined()
    expect(screen.getByText('Seule sa part datée après le 31/12/2025.')).toBeDefined()
    await act(async () => { bouton.click() })
    expect(faux.insertions[0].lignes.map((l) => [l.date, l.compte, l.montant])).toEqual([
      ['2026-02-10', '606100', 600], ['2026-02-10', '512000', 600],
    ])
  })

  it('n’écrit rien d’une pièce entièrement figée, et le dit', async () => {
    const tardive = piece({ id: 'p-tard', date_piece: '2025-06-10', montant_ttc: 80, tiers: 'FACTURE EN RETARD' })
    poser({ pieces: [tardive, piece({ id: 'p-ouv', date_piece: '2026-03-10', montant_ttc: 50, tiers: 'OUVERTE' })] })
    monter(false, TRESORERIE, 2026, [2025])
    const bouton = await screen.findByRole('button', { name: /Générer les écritures manquantes \(1\)/ })
    expect(screen.getByText(/Rien pour l’instant : ce qui reste à payer s’écrira à la date de son paiement/)).toBeDefined()
    expect(screen.getByText('FACTURE EN RETARD')).toBeDefined()
    await act(async () => { bouton.click() })
    expect(faux.insertions[0].lignes.map((l) => l.piece_id)).toEqual(['p-ouv'])
  })

  // Une note de frais compte à sa date, et une pièce payée dans l'exercice validé y reste : ni l'une ni l'autre ne
  // s'écrira, et l'écran ne le promet pas (lib/ecritures.ts, `ecrituresAGenerer`).
  it('ne promet pas d’écrire une note de frais ni une pièce payée dans l’exercice validé', async () => {
    poser({
      pieces: [
        piece({ id: 'p-note', date_piece: '2025-06-12', montant_ttc: 40, tiers: 'NOTE DE FRAIS', type_piece: 'note_frais' }),
        piece({ id: 'p1', date_piece: '2025-11-15', montant_ttc: 400, tiers: 'PAYÉE EN DÉCEMBRE' }),
      ],
      lignes_bancaires: [mouvement({})],
    })
    monter(false, TRESORERIE, 2026, [2025])
    await screen.findByText('Pièces datées d’un exercice validé')
    expect(screen.getByText('Rien : une note de frais compte à sa date, qui tombe dans un exercice validé.')).toBeDefined()
    expect(screen.getByText('Rien : elle a été payée dans un exercice validé.')).toBeDefined()
    expect(screen.queryByText(/Rien pour l’instant/)).toBeNull()
  })

  // En engagement, la facture d'une pièce entièrement figée ne s'écrira jamais : son règlement seul le pourrait.
  it('dit en engagement que la facture tombe dans un exercice validé', async () => {
    poser({ pieces: [piece({ id: 'p-tard', date_piece: '2025-06-10', montant_ttc: 80, tiers: 'FACTURE EN RETARD' })] })
    monter(false, ENGAGEMENT, 2026, [2025])
    await screen.findByText('Pièces datées d’un exercice validé')
    expect(screen.getByText('Rien : sa facture tombe dans un exercice validé.')).toBeDefined()
    expect(screen.queryByText(/Rien pour l’instant/)).toBeNull()
  })

  // Le garde symétrique : sans exercice validé, la même pièce s'écrit en entier et rien n'est nommé.
  it('écrit tout, sans rien nommer, quand aucun exercice n’est validé', async () => {
    poser({ pieces: [coupee], lignes_bancaires: PAIEMENTS })
    monter(false, TRESORERIE, 2026, [])
    const bouton = await screen.findByRole('button', { name: /Générer les écritures manquantes \(1\)/ })
    expect(screen.queryByText('Pièces datées d’un exercice validé')).toBeNull()
    await act(async () => { bouton.click() })
    expect(faux.insertions[0].lignes).toHaveLength(4)
  })

  it('ne régénère que la part d’après la frontière, et le dit', async () => {
    // La catégorie est passée au 606300 depuis la validation ; la part ouverte est encore sur l'ancien compte.
    poser({
      categories: [{ ...CATEGORIE_ACHATS, compte_comptable: '606300' }], pieces: [coupee], lignes_bancaires: PAIEMENTS,
      ecritures_brouillon: [...PART_VALIDEE, ...PART_OUVERTE],
    })
    monter(false, TRESORERIE, 2026, [2025])
    await screen.findByText('Écritures à régénérer')
    expect(screen.getByText(/Une partie de ces écritures est datée d’un exercice validé/)).toBeDefined()
    await act(async () => { screen.getByRole('button', { name: 'Régénérer' }).click() })
    expect(faux.suppressions[0].filtres).toEqual([['piece_id', 'p1'], ['>date', '2025-12-31']])
    expect(faux.insertions[0].lignes.map((l) => [l.date, l.compte, l.montant])).toEqual([
      ['2026-02-10', '606300', 600], ['2026-02-10', '512000', 600],
    ])
    // La part validée est restée, sur l'ancien compte ; la part ouverte suit la catégorie, et rien n'est plus à régénérer.
    await waitFor(() => expect(screen.queryByText('Écritures à régénérer')).toBeNull())
    expect((faux.parTable.ecritures_brouillon as { id: string }[]).map((e) => e.id).filter((id) => id.startsWith('v'))).toEqual(['v1', 'v2'])
  })

  // Une pièce dont la date a été corrigée vers un exercice validé, après la génération : tout ce qu'elle doit écrire
  // tombe désormais derrière la frontière. « Régénérer » retire son écriture et n'en insère aucune — la génération
  // la nomme ensuite.
  it('ne régénère rien d’une pièce que sa date a fait passer dans un exercice validé', async () => {
    poser({
      pieces: [piece({ id: 'p1', date_piece: '2025-06-10', montant_ttc: 120, tiers: 'DATE CORRIGÉE' })],
      ecritures_brouillon: [ecriture({ id: 'o1', date: '2026-03-10' })],
    })
    monter(false, TRESORERIE, 2026, [2025])
    await screen.findByText('Écritures à régénérer')
    await act(async () => { screen.getByRole('button', { name: 'Régénérer' }).click() })
    expect(faux.suppressions[0].filtres).toEqual([['piece_id', 'p1'], ['>date', '2025-12-31']])
    expect(faux.insertions).toEqual([])
    await screen.findByText('Pièces datées d’un exercice validé')
    expect(screen.getByText('DATE CORRIGÉE')).toBeDefined()
  })

  it('ne retire que la part d’après la frontière, et la confirmation le dit', async () => {
    let message = ''
    vi.stubGlobal('confirm', (m: string) => { message = m; return true })
    // Cas défensif : un bien sans nature sur une pièce que la frontière coupe — la base fige le registre d'un exercice
    // validé, mais l'écran doit rester juste si l'état se présente.
    poser({
      pieces: [coupee], lignes_bancaires: PAIEMENTS, ecritures_brouillon: [...PART_VALIDEE, ...PART_OUVERTE],
      immobilisations: [{ id: 'i1', dossier_id: 'dossier-de-test', piece_id: 'p1', nature_id: null }],
    })
    monter(false, TRESORERIE, 2026, [2025])
    await screen.findByText('Écritures que la pièce ne justifie plus')
    await act(async () => { screen.getByRole('button', { name: /Retirer l'écriture/ }).click() })
    expect(message).toMatch(/Sa part datée d’un exercice validé, au plus tard le 31\/12\/2025, reste : elle ne se retire plus\./)
    expect(faux.suppressions[0].filtres).toEqual([['piece_id', 'p1'], ['>date', '2025-12-31']])
    expect((faux.parTable.ecritures_brouillon as { id: string }[]).map((e) => e.id)).toEqual(['v1', 'v2'])
    vi.unstubAllGlobals()
  })

  // Le FEC d'un exercice validé se relit depuis ce que la validation a figé : son journal et ses numéros, ses libellés —
  // pas ceux que la numérotation d'aujourd'hui donnerait.
  it('exporte le FEC d’un exercice validé tel que la validation l’a figé', async () => {
    const fige = {
      statut: 'validee', valide_le: '2026-03-01T10:00:00Z', journal_code: 'AC', numero_ecriture: 7, piece_ref: 'FACT-007',
      piece_date: '2025-03-10', compte_lib: 'Achats figés', comp_aux_num: null, comp_aux_lib: null,
    }
    poser({
      pieces: [piece()],
      ecritures_brouillon: [
        ecriture({ id: 'f1', ...fige }),
        ecriture({ id: 'f2', compte: '512000', sens: 'credit', ...fige, compte_lib: 'Banque figée' }),
      ],
    })
    monter(false, TRESORERIE, 2025, [2025])
    // Le bouton paraît avant la fin de la lecture, grisé : l'ancre est ce que la lecture apporte.
    await screen.findByText(/0 écriture proposée — 2 validées/)
    await act(async () => { screen.getByRole('button', { name: 'Exporter FEC 2025 (validé)' }).click() })
    const contenu = telecharge.fichiers[0].contenu
    expect(contenu).toContain('AC00007')
    expect(contenu).toContain('Achats figés')
    expect(contenu).toContain('FACT-007')
    expect(contenu).not.toContain('AC00001')
  })

  // LE LETTRAGE NE SE FIGE PAS (lib/lettrage.ts) : la facture d'un exercice validé que l'exercice suivant règle se
  // lettre ce jour-là, et le FEC validé, relu depuis ce que la validation a figé, porte ce lettrage.
  it('porte dans le FEC d’un exercice validé le lettrage d’une facture réglée l’exercice suivant', async () => {
    const fige = {
      statut: 'validee', valide_le: '2026-03-01T10:00:00Z', journal_code: 'AC', numero_ecriture: 1, piece_ref: 'FACT-001',
      piece_date: '2025-12-20', compte_lib: 'Achats', comp_aux_num: null, comp_aux_lib: null, date: '2025-12-20',
    }
    poser({
      pieces: [piece({ date_piece: '2025-12-20' })],
      ecritures_brouillon: [
        ecriture({ id: 'f1', ...fige }),
        ecriture({ id: 'f2', compte: '401000', sens: 'credit', ...fige, compte_lib: 'Fournisseurs', comp_aux_num: 'FFOURNISSEUR', comp_aux_lib: 'FOURNISSEUR MARSEILLE' }),
        ecriture({ id: 'r1', date: '2026-01-08', compte: '401000', sens: 'debit', ligne_bancaire_id: 'l1', created_at: '2026-01-09T09:00:00Z' }),
        ecriture({ id: 'r2', date: '2026-01-08', compte: '512000', sens: 'credit', ligne_bancaire_id: 'l1', created_at: '2026-01-09T09:00:00Z' }),
      ],
    })
    monter(false, ENGAGEMENT, 2025, [2025])
    await screen.findByText(/2 validées/)
    await act(async () => { screen.getByRole('button', { name: 'Exporter FEC 2025 (validé)' }).click() })
    const lignes = telecharge.fichiers[0].contenu.split('\r\n').map((l) => l.split('\t'))
    expect(lignes.filter((r) => r[4] === '401000').map((r) => [r[2], r[13], r[14]])).toEqual([['AC00001', 'A', '20260109']])
  })

  // Le garde symétrique : l'exercice d'après, qui n'est pas validé, se numérote comme avant.
  it('numérote comme avant l’exercice qui suit la frontière', async () => {
    poser({ pieces: [piece({ date_piece: '2026-03-10' })], ecritures_brouillon: [ecriture({ date: '2026-03-10' })] })
    monter(false, TRESORERIE, 2026, [2025])
    await screen.findByText(/1 écriture proposée/)
    await act(async () => { screen.getByRole('button', { name: 'Exporter FEC 2026' }).click() })
    expect(telecharge.fichiers[0].contenu).toContain('AC00001')
  })
})

// L'ÉCRITURE D'UNE PIÈCE PAYÉE EST DATÉE À SON PAIEMENT (lib/rattachement.ts). Le calcul est testé à
// part ; ici c'est le CÂBLAGE — que le contrôle, la régénération et la piste d'audit reçoivent les
// paiements que l'écran a lus.
describe('EcrituresTab — la date du paiement', () => {
  const PAYEE_EN_JANVIER = {
    id: 'l1', dossier_id: 'dossier-de-test', date: '2025-01-06', libelle: 'PRLV FOURNISSEUR',
    montant: -120, statut: 'rapprochee', piece_id: 'p1', cotisation_id: null, prelevement_personnel: false,
    source_fichier: null, libelle_brut: null, created_at: '2025-01-07T09:00:00Z',
  }
  const FACTURE_DE_DECEMBRE = piece({ id: 'p1', date_piece: '2024-12-20' })

  it('ne dit pas « à régénérer » une écriture datée à son paiement', async () => {
    poser({
      pieces: [FACTURE_DE_DECEMBRE],
      ecritures_brouillon: [
        ecriture({ id: 'e1', date: '2025-01-06' }),
        ecriture({ id: 'e2', date: '2025-01-06', compte: '512000', sens: 'credit', ligne_bancaire_id: 'l1' }),
      ],
      lignes_bancaires: [PAYEE_EN_JANVIER],
    })
    monter()

    // Ancré sur ce que ce jeu produit forcément une fois chargé : les deux lignes de l'écriture.
    await screen.findByText(/2 écritures proposées/)
    expect(screen.queryAllByText(/à régénérer/)).toHaveLength(0)
  })

  it('régénère au paiement une écriture restée à la date de facture', async () => {
    poser({
      pieces: [FACTURE_DE_DECEMBRE],
      ecritures_brouillon: [
        ecriture({ id: 'e1', date: '2024-12-20' }),
        ecriture({ id: 'e2', date: '2025-01-06', compte: '512000', sens: 'credit', ligne_bancaire_id: 'l1' }),
      ],
      lignes_bancaires: [PAYEE_EN_JANVIER],
    })
    monter(false, TRESORERIE, 'toutes')

    const regenerer = await screen.findByRole('button', { name: /Régénérer/ })
    await act(async () => { regenerer.click() })

    const charges = (faux.parTable.ecritures_brouillon as { compte: string; date: string }[])
      .filter((e) => e.compte === '606100').map((e) => e.date)
    expect(charges).toEqual(['2025-01-06'])
  })

  it("porte la pièce dans la piste d'audit de l'exercice de son paiement", async () => {
    // Sans quoi l'écriture de janvier désignerait un justificatif « hors du jeu chargé », et la
    // piste de décembre le compterait comme un justificatif que rien ne comptabilise.
    poser({
      pieces: [FACTURE_DE_DECEMBRE],
      ecritures_brouillon: [
        ecriture({ id: 'e1', date: '2025-01-06' }),
        ecriture({ id: 'e2', date: '2025-01-06', compte: '512000', sens: 'credit', ligne_bancaire_id: 'l1' }),
      ],
      lignes_bancaires: [PAYEE_EN_JANVIER],
    })
    monter()

    await screen.findByText(/2 écritures proposées/)
    await act(async () => { screen.getByRole('button', { name: /Exporter la piste d'audit/ }).click() })
    const csv = telecharge.fichiers.find((f) => f.nom.startsWith('piste-audit'))!.contenu
    expect(csv).not.toMatch(/hors du jeu chargé/)
    expect(csv).toMatch(/facture\.pdf/)
  })
})

// LE MODÈLE COMPTABLE (lib/engagement.ts) se règle dans cet onglet, tant que le brouillon est vide.
// UN VIREMENT QUI RÈGLE PLUSIEURS PIÈCES (ligne 26) : chaque part est un paiement de sa pièce. La génération
// écrit donc, pour chacune, sa charge à la date du virement et UNE contrepartie de banque au montant de sa
// part — et une pièce payée en deux fois, une contrepartie par paiement. Le virement ne porte aucune pièce :
// elles sont dans ses parts, que l'écran doit lire, sans quoi ces pièces paraîtraient impayées.
describe('EcrituresTab — un virement qui règle plusieurs pièces', () => {
  const VIREMENT = {
    id: 'g', dossier_id: 'dossier-de-test', date: '2025-01-06', libelle: 'VIR FOURNISSEURS', montant: -200,
    statut: 'rapprochee', piece_id: null, cotisation_id: null, reglement_groupe: true, prelevement_personnel: false,
    source_fichier: null, libelle_brut: null, created_at: '2025-01-07T09:00:00Z',
  }
  const part = (id: string, pieceId: string, montant: number, ligneId = 'g') => ({
    id, dossier_id: 'dossier-de-test', ligne_bancaire_id: ligneId, piece_id: pieceId, montant, created_at: '2025-01-07T09:00:00Z',
  })
  const P1 = piece({ id: 'p1', date_piece: '2024-12-20' })
  const P2 = piece({ id: 'p2', date_piece: '2024-12-22', tiers: 'SECOND FOURNISSEUR', montant_ttc: 80 })
  const lignesDe = (pieceId: string) => (faux.parTable.ecritures_brouillon as Record<string, unknown>[])
    .filter((e) => e.piece_id === pieceId).map((e) => [e.compte, e.date, e.montant, e.ligne_bancaire_id ?? null])

  it('génère, pour chaque pièce, sa charge à la date du virement et la contrepartie de sa part', async () => {
    poser({ pieces: [P1, P2], lignes_bancaires: [VIREMENT], reglements_groupes: [part('g1', 'p1', -120), part('g2', 'p2', -80)] })
    monter()

    const bouton = await screen.findByRole('button', { name: /Générer les écritures manquantes \(2\)/ })
    await act(async () => { bouton.click() })

    expect(lignesDe('p1')).toEqual([['606100', '2025-01-06', 120, null], ['512000', '2025-01-06', 120, 'g']])
    expect(lignesDe('p2')).toEqual([['606100', '2025-01-06', 80, null], ['512000', '2025-01-06', 80, 'g']])
  })

  it('une pièce payée en deux fois reçoit une contrepartie par paiement, et sa charge se répartit entre eux', async () => {
    // 48 € prélevés seuls le 6 janvier, puis les 72 € restants dans un virement qui règle aussi une autre pièce.
    const ACOMPTE = { ...VIREMENT, id: 'l1', montant: -48, piece_id: 'p1', reglement_groupe: false, compte_bilan: null, declaration_tva_id: null }
    const SOLDE = { ...VIREMENT, id: 'g2', date: '2025-02-10', montant: -152 }
    poser({
      pieces: [P1, P2], lignes_bancaires: [ACOMPTE, SOLDE],
      reglements_groupes: [part('s1', 'p1', -72, 'g2'), part('s2', 'p2', -80, 'g2')],
    })
    monter()

    const bouton = await screen.findByRole('button', { name: /Générer les écritures manquantes \(2\)/ })
    await act(async () => { bouton.click() })

    expect(lignesDe('p1')).toEqual([
      ['606100', '2025-01-06', 48, null], ['606100', '2025-02-10', 72, null],
      ['512000', '2025-01-06', 48, 'l1'], ['512000', '2025-02-10', 72, 'g2'],
    ])
  })

  it('ne dit pas « à régénérer » une écriture qui suit la part de son virement', async () => {
    poser({
      pieces: [P1],
      lignes_bancaires: [{ ...VIREMENT, montant: -120 }],
      reglements_groupes: [part('g1', 'p1', -120)],
      ecritures_brouillon: [
        ecriture({ id: 'e1', date: '2025-01-06' }),
        ecriture({ id: 'e2', date: '2025-01-06', compte: '512000', sens: 'credit', ligne_bancaire_id: 'g' }),
      ],
    })
    monter()

    await screen.findByText(/2 écritures proposées/)
    expect(screen.queryAllByText(/à régénérer/)).toHaveLength(0)
    expect(screen.queryAllByText(/sans contrepartie/)).toHaveLength(0)
  })

  it('suspend la génération et les exports quand les parts sont lues en partie', async () => {
    poser({ pieces: [P1, P2], lignes_bancaires: [VIREMENT], reglements_groupes: [part('g1', 'p1', -120), part('g2', 'p2', -80)] })
    faux.muetParTable = { reglements_groupes: 1 }
    monter()

    await screen.findByText(/La génération est suspendue/)
    expect(screen.getByRole('button', { name: /Générer les écritures manquantes/ }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: /Exporter FEC/ }).hasAttribute('disabled')).toBe(true)
  })
})

describe('EcrituresTab — le modèle comptable', () => {
  it('offre le choix sur un brouillon vide, l’enregistre sur le dossier, et montre alors les comptes de note de frais', async () => {
    poser({})
    monter()

    const engagement = await screen.findByRole('button', { name: 'Engagement (BIC, IS)' })
    expect(screen.getByRole('button', { name: 'Trésorerie (BNC, 2035)' }).getAttribute('aria-pressed')).toBe('true')
    // En trésorerie, rien à choisir pour les notes de frais : ce que l'exploitant a payé de sa poche passe toujours à
    // son compte, et l'explication du modèle le dit (lib/ecritures.ts, `ligneContrepartieDirigeant`).
    expect(screen.queryByText(/Note de frais payée personnellement/)).toBeNull()
    expect(screen.getByText(/Une note de frais que l’exploitant a payée de sa poche s’écrit au 108 – Compte de l’exploitant/)).toBeTruthy()

    await act(async () => { engagement.click() })
    expect(faux.misesAJour).toEqual([{ table: 'dossiers', valeurs: { mode_comptable: 'engagement' } }])
    expect(engagement.getAttribute('aria-pressed')).toBe('true')

    // Les mots du cabinet, à l'écran.
    await screen.findByText(/Note de frais payée personnellement par le dirigeant/)
    expect(screen.getByText(/Quand la société rembourse le dirigeant, depuis son compte bancaire : débit 455, crédit 512 Banque/)).toBeTruthy()
    // Le même compte reçoit les virements personnels du dirigeant (lib/virementPersonnel.ts) : le
    // choix engage les deux, et l'écran le dit avant qu'on le fasse.
    expect(screen.getByText(/Ce compte reçoit aussi les virements entre le compte de l’entreprise et le compte personnel/)).toBeTruthy()
    await act(async () => { screen.getByRole('button', { name: /^108 – Compte de l’exploitant/ }).click() })
    expect(faux.misesAJour.at(-1)).toEqual({ table: 'dossiers', valeurs: { compte_notes_de_frais: '108000' } })
  })

  it('n’enregistre rien sur un clic du modèle déjà en place', async () => {
    poser({})
    monter()
    const bouton1 = await screen.findByRole('button', { name: 'Trésorerie (BNC, 2035)' })
    await act(async () => { bouton1.click() })
    expect(faux.misesAJour).toEqual([])
  })

  it('ne l’offre plus quand le brouillon porte des écritures, et dit pourquoi', async () => {
    poser({ pieces: [piece()], ecritures_brouillon: [ecriture()] })
    monter()

    await screen.findByText(/Il ne se change plus : le brouillon porte 1 écriture/)
    expect(screen.queryByRole('button', { name: 'Engagement (BIC, IS)' })).toBeNull()
  })

  // Le compte du dirigeant, dit dans les deux modèles : en trésorerie, le 108 de l'exploitant quel que soit le compte
  // des notes de frais enregistré sur le dossier — celui-là ne vaut qu'en engagement (lib/virementPersonnel.ts).
  it('rappelle le compte du dirigeant : le 108 en trésorerie, le compte choisi en engagement', async () => {
    poser({ pieces: [piece()], ecritures_brouillon: [ecriture()] })
    const { unmount } = monter()
    await screen.findByText(/notes de frais et virements personnels du dirigeant en 108 – Compte de l’exploitant\./)
    unmount()
    monter(false, ENGAGEMENT)
    await screen.findByText(/notes de frais et virements personnels du dirigeant en 455 – Compte courant d’associé\./)
  })

  it('ne l’offre pas sur une lecture partielle du brouillon — il pourrait porter des écritures qu’on ne voit pas', async () => {
    poser({ pieces: [piece()], ecritures_brouillon: [ecriture()] })
    faux.muetParTable = { ecritures_brouillon: 0 }
    monter()

    await screen.findByText(/Il ne se change pas sur une lecture partielle du brouillon/)
    expect(screen.queryByRole('button', { name: 'Engagement (BIC, IS)' })).toBeNull()
  })

  it("trois clics rapprochés n'enregistrent le modèle qu'une fois", async () => {
    // Trois et non deux : un verrou posé DANS le `try` serait relâché par le `finally` du deuxième.
    poser({})
    monter()
    const engagement = await screen.findByRole('button', { name: 'Engagement (BIC, IS)' })
    await act(async () => { engagement.click(); engagement.click(); engagement.click() })
    expect(faux.misesAJour).toEqual([{ table: 'dossiers', valeurs: { mode_comptable: 'engagement' } }])
  })

  it('le changement de modèle suspend la génération', async () => {
    // Générer pendant que le modèle change écrirait des écritures d'un modèle sous l'étiquette de
    // l'autre — celles que le déclencheur de la base refuse justement de laisser se mélanger.
    poser({ pieces: [piece()], ecritures_brouillon: [] })
    monter()
    const engagement = await screen.findByRole('button', { name: 'Engagement (BIC, IS)' })
    const generer = screen.getByRole('button', { name: /Générer les écritures manquantes \(1\)/ })
    await act(async () => { engagement.click(); generer.click() })
    expect(faux.misesAJour).toHaveLength(1)
    expect(faux.insertions).toHaveLength(0)
  })

  it('la génération suspend le changement de modèle', async () => {
    poser({ pieces: [piece()], ecritures_brouillon: [] })
    monter()
    const engagement = await screen.findByRole('button', { name: 'Engagement (BIC, IS)' })
    const generer = screen.getByRole('button', { name: /Générer les écritures manquantes \(1\)/ })
    await act(async () => { generer.click(); engagement.click() })
    expect(faux.insertions).toHaveLength(1)
    expect(faux.misesAJour).toEqual([])
  })

  it('dit le refus de la base, et garde le modèle en place', async () => {
    poser({})
    faux.refusMiseAJour = 'Le modèle comptable d’un dossier ne se change que tant que son brouillon d’écritures est vide.'
    monter()

    const bouton2 = await screen.findByRole('button', { name: 'Engagement (BIC, IS)' })

    await act(async () => { bouton2.click() })
    expect(screen.getByText(/ne se change que tant que son brouillon d’écritures est vide/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Trésorerie (BNC, 2035)' }).getAttribute('aria-pressed')).toBe('true')
  })
})

describe('EcrituresTab — en engagement', () => {
  const REGLEE_EN_JANVIER = {
    id: 'l1', dossier_id: 'dossier-de-test', date: '2025-01-06', libelle: 'PRLV FOURNISSEUR',
    montant: -120, statut: 'rapprochee', piece_id: 'p1', cotisation_id: null, prelevement_personnel: false,
    source_fichier: null, libelle_brut: null, created_at: '2025-01-07T09:00:00Z',
  }

  it('génère la facture à SA date et le règlement au mouvement, en une seule écriture de la base', async () => {
    poser({ pieces: [piece({ id: 'p1', date_piece: '2024-12-20' })], ecritures_brouillon: [], lignes_bancaires: [REGLEE_EN_JANVIER] })
    monter(false, ENGAGEMENT)

    const bouton3 = await screen.findByRole('button', { name: /Générer les écritures manquantes \(1\)/ })

    await act(async () => { bouton3.click() })

    // Une seule insertion : la contrepartie de la trésorerie n'est pas appelée en plus — elle
    // doublerait la banque.
    expect(faux.insertions).toHaveLength(1)
    const lignes = (faux.parTable.ecritures_brouillon as { compte: string; sens: string; date: string; ligne_bancaire_id?: string }[])
      .map((e) => [e.compte, e.sens, e.date, e.ligne_bancaire_id ?? null])
    expect(lignes).toEqual([
      ['606100', 'debit', '2024-12-20', null],
      ['401000', 'credit', '2024-12-20', null],
      ['401000', 'debit', '2025-01-06', 'l1'],
      ['512000', 'credit', '2025-01-06', 'l1'],
    ])
  })

  it('ne dit pas « à régénérer » les écritures qu’il vient de générer, et compte une facture sans règlement', async () => {
    poser({ pieces: [piece({ id: 'p1', date_piece: '2024-12-20' })], ecritures_brouillon: [], lignes_bancaires: [] })
    monter(false, ENGAGEMENT, 'toutes')

    const bouton4 = await screen.findByRole('button', { name: /Générer les écritures manquantes \(1\)/ })

    await act(async () => { bouton4.click() })
    await screen.findByText(/2 écritures proposées/)
    expect(screen.queryAllByText(/à régénérer/)).toHaveLength(0)
    expect(screen.getByText('1 facture sans règlement rapproché')).toBeTruthy()
  })

  it('régénère TOUT — la facture et ses règlements — quand une pièce devient note de frais', async () => {
    // Le règlement passé au 401 doit suivre la dette au 455 : sinon le 401 garderait un débit sans
    // facture, et le 455 un crédit que rien ne solde.
    poser({
      pieces: [piece({ id: 'p1', date_piece: '2024-12-20', type_piece: 'note_frais' })],
      ecritures_brouillon: [
        ecriture({ id: 'e1', date: '2024-12-20' }),
        ecriture({ id: 'e2', date: '2024-12-20', compte: '401000', sens: 'credit' }),
        ecriture({ id: 'e3', date: '2025-01-06', compte: '401000', sens: 'debit', ligne_bancaire_id: 'l1' }),
        ecriture({ id: 'e4', date: '2025-01-06', compte: '512000', sens: 'credit', ligne_bancaire_id: 'l1' }),
      ],
      lignes_bancaires: [REGLEE_EN_JANVIER],
    })
    monter(false, ENGAGEMENT, 'toutes')

    const bouton5 = await screen.findByRole('button', { name: /Régénérer/ })

    await act(async () => { bouton5.click() })

    // Toutes les lignes de la pièce, sans le filtre de la trésorerie qui épargne la banque.
    expect(faux.suppressions).toEqual([{ table: 'ecritures_brouillon', filtres: [['piece_id', 'p1']] }])
    const lignes = (faux.parTable.ecritures_brouillon as { compte: string; sens: string }[]).map((e) => [e.compte, e.sens])
    expect(lignes).toEqual([['606100', 'debit'], ['455000', 'credit'], ['455000', 'debit'], ['512000', 'credit']])
  })

  it('exporte un FEC où le règlement a son journal de banque et le fournisseur son compte auxiliaire', async () => {
    poser({
      pieces: [piece({ id: 'p1', date_piece: '2025-03-10' })],
      ecritures_brouillon: [
        ecriture({ id: 'e1' }),
        ecriture({ id: 'e2', compte: '401000', sens: 'credit' }),
        ecriture({ id: 'e3', date: '2025-04-02', compte: '401000', sens: 'debit', ligne_bancaire_id: 'l1' }),
        ecriture({ id: 'e4', date: '2025-04-02', compte: '512000', sens: 'credit', ligne_bancaire_id: 'l1' }),
      ],
      lignes_bancaires: [{ ...REGLEE_EN_JANVIER, date: '2025-04-02' }],
    })
    monter(false, ENGAGEMENT)

    await screen.findByText(/4 écritures proposées/)
    await act(async () => { screen.getByRole('button', { name: /Exporter FEC/ }).click() })
    const fec = telecharge.fichiers.find((f) => f.nom.includes('FEC'))!.contenu
    expect(fec).toMatch(/^BQ\tBanque\tBQ00001\t20250402\t401000\tFournisseurs\tFFOURNISSEUR\tFOURNISSEUR MARSEILLE\t/m)
    expect(fec).toMatch(/^AC\tAchats\tAC00001\t20250310\t606100\t/m)
  })

  // LE LETTRAGE se calcule sur TOUT le brouillon (lib/lettrage.ts) : le FEC de 2024 porte le code de la facture de
  // décembre que le règlement de janvier 2025 solde. Calculé sur l'exercice affiché, il n'y verrait qu'une facture ouverte.
  it('lettre dans le FEC de l’exercice la facture que l’exercice suivant solde', async () => {
    poser({
      pieces: [piece({ id: 'p1', date_piece: '2024-12-20' })],
      ecritures_brouillon: [
        ecriture({ id: 'e1', date: '2024-12-20', created_at: '2024-12-21T09:00:00Z' }),
        ecriture({ id: 'e2', date: '2024-12-20', compte: '401000', sens: 'credit', created_at: '2024-12-21T09:00:00Z' }),
        ecriture({ id: 'e3', date: '2025-01-06', compte: '401000', sens: 'debit', ligne_bancaire_id: 'l1', created_at: '2025-01-07T09:00:00Z' }),
        ecriture({ id: 'e4', date: '2025-01-06', compte: '512000', sens: 'credit', ligne_bancaire_id: 'l1', created_at: '2025-01-07T09:00:00Z' }),
      ],
      lignes_bancaires: [REGLEE_EN_JANVIER],
    })
    monter(false, ENGAGEMENT, 2024)

    await screen.findByText(/4 écritures proposées/)
    await act(async () => { screen.getByRole('button', { name: /Exporter FEC/ }).click() })
    const fec = telecharge.fichiers.find((f) => f.nom.includes('FEC'))!.contenu
    const tiers = fec.split('\r\n').map((l) => l.split('\t')).filter((r) => r[4] === '401000')
    expect(tiers.map((r) => [r[2], r[13], r[14]])).toEqual([['AC00001', 'A', '20250107']])
  })

  // LE LETTRAGE FAIT À LA MAIN (seconde brique) : une facture et l'avoir qui la solde, sans mouvement bancaire. Le FEC
  // lettre leurs deux lignes de tiers sous le même code, au jour où le cabinet a lettré — c'est la table que l'onglet lit.
  const FACTURE_ET_AVOIR = {
    pieces: [
      piece({ id: 'p1', date_piece: '2025-03-10', tiers: 'GARAGE MARTIN' }),
      piece({ id: 'p2', date_piece: '2025-03-20', tiers: 'Garage Martin', montant_ttc: -120, nom_fichier: 'avoir.pdf' }),
    ],
    ecritures_brouillon: [
      ecriture({ id: 'f1', piece_id: 'p1' }),
      ecriture({ id: 'f2', piece_id: 'p1', compte: '401000', sens: 'credit' }),
      ecriture({ id: 'a1', piece_id: 'p2', date: '2025-03-20', sens: 'credit' }),
      ecriture({ id: 'a2', piece_id: 'p2', date: '2025-03-20', compte: '401000', sens: 'debit' }),
    ],
    lettrages_manuels: ['p1', 'p2'].map((id) => ({
      id: `lm-${id}`, dossier_id: 'dossier-de-test', groupe: 'g1', piece_id: id, compte: '401000', created_at: '2025-04-01T09:00:00Z',
    })),
  }

  it('porte dans le FEC le lettrage fait à la main d’une facture et de son avoir', async () => {
    poser(FACTURE_ET_AVOIR)
    monter(false, ENGAGEMENT)

    await screen.findByText(/4 écritures proposées/)
    expect(screen.getAllByText('lettrage A')).toHaveLength(2)
    await act(async () => { screen.getByRole('button', { name: /Exporter FEC/ }).click() })
    const fec = telecharge.fichiers.find((f) => f.nom.includes('FEC'))!.contenu
    const tiers = fec.split('\r\n').map((l) => l.split('\t')).filter((r) => r[4] === '401000')
    expect(tiers.map((r) => [r[2], r[13], r[14]])).toEqual([['AC00001', 'A', '20250401'], ['AC00002', 'A', '20250401']])
  })

  // Lettrées ensemble, la facture et l'avoir n'attendent aucun règlement : l'avoir solde la facture sans que l'argent
  // circule. Les dire « sans règlement rapproché » enverrait chercher à la banque un paiement qui n'existe pas.
  it('ne compte pas sans règlement les pièces d’un lettrage fait à la main qui se solde', async () => {
    poser(FACTURE_ET_AVOIR)
    monter(false, ENGAGEMENT)

    await screen.findByText(/4 écritures proposées/)
    expect(screen.queryAllByText(/sans règlement rapproché/)).toHaveLength(0)
  })

  // GARDE SYMÉTRIQUE : sans le lettrage, les deux mêmes pièces sont bien sans règlement — c'est lui qui les retire.
  it('compte sans règlement la facture et l’avoir que rien ne lettre', async () => {
    poser({ ...FACTURE_ET_AVOIR, lettrages_manuels: [] })
    monter(false, ENGAGEMENT)

    expect(await screen.findByText('2 factures sans règlement rapproché')).toBeTruthy()
  })

  // Lus en partie, ils manqueraient au FEC sans qu'il puisse le dire : une facture lettrée y paraîtrait ouverte.
  it('refuse d’exporter le FEC d’un dossier en engagement sur des lettrages faits à la main lus en partie', async () => {
    poser(FACTURE_ET_AVOIR)
    faux.muetParTable = { lettrages_manuels: 0 }
    monter(false, ENGAGEMENT)

    expect(await screen.findByText(/Les lettrages faits à la main n'ont pas pu être lus en entier/)).toBeTruthy()
    expect((screen.getByRole('button', { name: /Exporter FEC/ }) as HTMLButtonElement).disabled).toBe(true)
    // La piste d'audit ne porte pas de lettrage : elle reste ouverte.
    expect((screen.getByRole('button', { name: /Exporter la piste d'audit/ }) as HTMLButtonElement).disabled).toBe(false)
  })

  // GARDE SYMÉTRIQUE : en trésorerie rien ne se lettre, et une lecture ratée de ces lignes ne doit rien bloquer.
  it('ne bloque rien en trésorerie sur des lettrages faits à la main lus en partie', async () => {
    poser(FACTURE_ET_AVOIR)
    faux.muetParTable = { lettrages_manuels: 0 }
    monter(false, TRESORERIE)

    await screen.findByText(/4 écritures proposées/)
    expect(screen.queryAllByText(/Les lettrages faits à la main n'ont pas pu être lus/)).toHaveLength(0)
    expect((screen.getByRole('button', { name: /Exporter FEC/ }) as HTMLButtonElement).disabled).toBe(false)
  })

  // Le journal montre le code que porte le FEC : sans lui, le lettrage ne se verrait que dans un fichier exporté.
  it('montre dans le journal le lettrage des lignes de tiers soldées, et d’elles seules', async () => {
    poser({
      pieces: [piece({ id: 'p1', date_piece: '2024-12-20' })],
      ecritures_brouillon: [
        ecriture({ id: 'e1', date: '2024-12-20', created_at: '2024-12-21T09:00:00Z' }),
        ecriture({ id: 'e2', date: '2024-12-20', compte: '401000', sens: 'credit', created_at: '2024-12-21T09:00:00Z' }),
        ecriture({ id: 'e3', date: '2025-01-06', compte: '401000', sens: 'debit', ligne_bancaire_id: 'l1', created_at: '2025-01-07T09:00:00Z' }),
        ecriture({ id: 'e4', date: '2025-01-06', compte: '512000', sens: 'credit', ligne_bancaire_id: 'l1', created_at: '2025-01-07T09:00:00Z' }),
      ],
      lignes_bancaires: [REGLEE_EN_JANVIER],
    })
    monter(false, ENGAGEMENT, 'toutes')

    await screen.findByText(/4 écritures proposées/)
    const badges = screen.getAllByText('lettrage A')
    expect(badges.map((b) => b.closest('tr')!.children[1].textContent)).toEqual(['401000 lettrage A', '401000 lettrage A'])
    expect(badges[0].getAttribute('title')).toBe('Lettrée le 07/01/2025 : les lignes de ce code se soldent sur ce compte — une facture et ses règlements, ou les pièces lettrées à la main.')
  })

  it('nomme la dette et les règlements dans la confirmation de retrait d’une facture immobilisée', async () => {
    const messages: string[] = []
    vi.stubGlobal('confirm', (m: string) => { messages.push(m); return false })
    poser({
      pieces: [piece()],
      ecritures_brouillon: [ecriture({ id: 'e1' }), ecriture({ id: 'e2', compte: '401000', sens: 'credit' })],
      immobilisations: [{ id: 'i1', dossier_id: 'dossier-de-test', piece_id: 'p1' }],
    })
    monter(false, ENGAGEMENT)

    const bouton6 = await screen.findByRole('button', { name: /Retirer l'écriture/ })

    await act(async () => { bouton6.click() })
    expect(messages[0]).toMatch(/sa dette envers le fournisseur et ses règlements partent ensemble/)
    expect(messages[0]).not.toMatch(/contrepartie banque/)
  })
})

describe('EcrituresTab — la régénération', () => {
  it('se suspend sur une lecture partielle : elle daterait mal, ou retirerait des règlements', async () => {
    poser({
      pieces: [piece({ montant_ttc: 150 })],
      ecritures_brouillon: [ecriture()],
      lignes_bancaires: [{
        id: 'l1', dossier_id: 'dossier-de-test', date: '2025-03-12', libelle: 'PRLV', montant: -150, statut: 'rapprochee',
        piece_id: 'p1', cotisation_id: null, prelevement_personnel: false, source_fichier: null, libelle_brut: null,
        created_at: '2025-03-12T09:00:00Z',
      }],
    })
    faux.muetParTable = { lignes_bancaires: 0 }
    monter()

    const bouton = await screen.findByRole('button', { name: /Régénérer/ })
    expect(bouton.hasAttribute('disabled')).toBe(true)
    await act(async () => { bouton.click() })
    expect(faux.suppressions).toEqual([])
    expect(faux.insertions).toEqual([])
  })

  it('régénère sur une lecture complète — le garde symétrique', async () => {
    poser({ pieces: [piece({ montant_ttc: 150 })], ecritures_brouillon: [ecriture()] })
    monter()

    const bouton7 = await screen.findByRole('button', { name: /Régénérer/ })

    await act(async () => { bouton7.click() })
    expect(faux.insertions).toHaveLength(1)
  })

  it("deux clics rapprochés ne régénèrent qu'une fois", async () => {
    poser({ pieces: [piece({ montant_ttc: 150 })], ecritures_brouillon: [ecriture()] })
    monter()

    const bouton = await screen.findByRole('button', { name: /Régénérer/ })
    await act(async () => { bouton.click(); bouton.click() })
    expect(faux.suppressions).toHaveLength(1)
    expect(faux.insertions).toHaveLength(1)
  })
})

// Le compte d'une catégorie est le seul compte que l'application laisse taper à la main, et il part
// tel quel dans chaque écriture puis dans le FEC. L'outil de contrôle de la DGFiP refuse un CompteNum
// dont les trois premiers caractères ne sont pas des chiffres.
describe('EcrituresTab — un compte saisi commence par trois chiffres', () => {
  const CATEGORIE_LIBRE = {
    id: 'cat-libre', dossier_id: null, code: 'sans_suggestion', libelle: 'Catégorie libre',
    ordre: 2, compte_comptable: null, poste_2035: 'Achats',
  }

  async function saisir(valeur: string) {
    const champ = await screen.findByPlaceholderText('ex. 606100')
    await act(async () => { fireEvent.change(champ, { target: { value: valeur } }) })
    await act(async () => { screen.getByRole('button', { name: 'Enregistrer' }).click() })
  }

  it('refuse un compte qui ne commence pas par trois chiffres, et le dit', async () => {
    poser({ categories: [CATEGORIE_LIBRE], pieces: [piece({ categorie_id: 'cat-libre' })] })
    monter()

    await saisir('Honoraires')
    expect(screen.getByText(/« Honoraires » n'est pas un numéro de compte/)).toBeTruthy()
    expect(faux.misesAJour).toEqual([])
  })

  // GARDE SYMÉTRIQUE : sans lui, « refuse un compte mal formé » serait satisfait par un champ qui
  // refuse tout. Les espaces tapées disparaissent, et le refus précédent ne reste pas affiché.
  it('enregistre un compte bien formé, sans ses espaces, et efface le refus précédent', async () => {
    poser({ categories: [CATEGORIE_LIBRE], pieces: [piece({ categorie_id: 'cat-libre' })] })
    monter()

    // Des chiffres, mais pas en tête : c'est le début du numéro que la DGFiP contrôle.
    await saisir('C606')
    expect(screen.getByText(/« C606 » n'est pas un numéro de compte/)).toBeTruthy()
    await saisir(' 622 600 ')
    expect(faux.misesAJour).toEqual([{ table: 'categories', valeurs: { compte_comptable: '622600' } }])
    expect(screen.queryAllByText(/n'est pas un numéro de compte/)).toHaveLength(0)
  })
})

// LIGNE 26.6 : un mouvement du relevé affecté à une catégorie porte une écriture SANS pièce. Ce que ce
// bloc garde et qu'aucun test de `src/lib` ne peut voir : que l'onglet lise les mouvements affectés
// (et pas seulement ceux d'une pièce), donc qu'il ne crie pas à la rupture sur ces écritures, qu'il
// les porte au FEC et à la piste d'audit, et qu'il sache les réécrire quand leur catégorie change.
describe('EcrituresTab — les mouvements affectés sans justificatif', () => {
  const FRAIS = {
    id: 'cat-frais', dossier_id: null, code: 'frais_bancaires', libelle: 'Frais bancaires', ordre: 70,
    compte_comptable: '627000', poste_2035: 'Frais financiers',
  }
  function mouvement(o: Record<string, unknown> = {}) {
    return {
      id: 'l-frais', dossier_id: 'dossier-de-test', date: '2025-03-31', libelle: 'FRAIS TENUE DE COMPTE', montant: -8.5,
      statut: 'rapprochee', piece_id: null, cotisation_id: null, categorie_id: 'cat-frais', taux_tva: null, prelevement_personnel: false,
      source_fichier: 'releve-mars-2025.pdf', libelle_brut: null, created_at: '2025-04-02T09:00:00Z', ...o,
    }
  }
  const ECRITURE_FRAIS = [
    ecriture({ id: 'm1', piece_id: null, ligne_bancaire_id: 'l-frais', date: '2025-03-31', compte: '627000', sens: 'debit', montant: 8.5, libelle: 'FRAIS TENUE DE COMPTE' }),
    ecriture({ id: 'm2', piece_id: null, ligne_bancaire_id: 'l-frais', date: '2025-03-31', compte: '512000', sens: 'credit', montant: 8.5, libelle: 'FRAIS TENUE DE COMPTE' }),
  ]

  it('ne crie pas à la rupture, et porte l’écriture au FEC, au journal de banque, le relevé pour pièce', async () => {
    poser({ categories: [CATEGORIE_ACHATS, FRAIS], lignes_bancaires: [mouvement()], ecritures_brouillon: ECRITURE_FRAIS })
    monter()
    await screen.findByText(/2 écritures proposées/)
    expect(screen.queryByText("Piste d'audit rompue")).toBeNull()
    expect(screen.queryByText(/pas dans ce FEC/)).toBeNull()
    expect(screen.queryByText('Mouvements affectés à réaffecter')).toBeNull()

    await act(async () => { screen.getByRole('button', { name: /Exporter FEC/ }).click() })
    const lignes = telecharge.fichiers[0].contenu.split('\r\n').map((l) => l.split('\t')).slice(1)
    expect(lignes.map((l) => [l[0], l[2], l[8], l[9]])).toEqual([
      ['BQ', 'BQ00001', 'releve-mars-2025.pdf', '20250331'],
      ['BQ', 'BQ00001', 'releve-mars-2025.pdf', '20250331'],
    ])
    expect(lignes.map((l) => l[4]).sort()).toEqual(['512000', '627000'])
  })

  it('le garde symétrique : sans affectation, les mêmes écritures sont une rupture et sortent du FEC', async () => {
    poser({
      categories: [CATEGORIE_ACHATS, FRAIS],
      lignes_bancaires: [mouvement({ categorie_id: null, statut: 'non_rapprochee' })],
      ecritures_brouillon: ECRITURE_FRAIS,
    })
    monter()
    expect(await screen.findByText("Piste d'audit rompue")).toBeTruthy()
    expect(screen.getByText(/2 écritures ne seront pas dans ce FEC/)).toBeTruthy()
  })

  it('donne le relevé pour justificatif dans la piste d’audit', async () => {
    poser({ categories: [CATEGORIE_ACHATS, FRAIS], lignes_bancaires: [mouvement()], ecritures_brouillon: ECRITURE_FRAIS })
    monter()
    await screen.findByText(/2 écritures proposées/)
    await act(async () => { screen.getByRole('button', { name: /Exporter la piste d'audit/ }).click() })
    const csv = telecharge.fichiers.find((f) => f.nom.startsWith('piste-audit'))!.contenu
    expect(csv).toMatch(/Relevé bancaire : releve-mars-2025\.pdf/)
    expect(csv).not.toMatch(/;justificatif(\r\n|$)/)
  })

  it('propose de réaffecter un mouvement dont la catégorie a changé de compte, et le réécrit par la base', async () => {
    poser({
      categories: [CATEGORIE_ACHATS, { ...FRAIS, compte_comptable: '627100' }],
      lignes_bancaires: [mouvement()],
      ecritures_brouillon: ECRITURE_FRAIS,
    })
    monter()
    expect(await screen.findByText('Mouvements affectés à réaffecter')).toBeTruthy()
    await act(async () => { screen.getByRole('button', { name: 'Réaffecter' }).click() })
    expect(faux.rpcs).toEqual([{
      nom: 'affecter_mouvement_bancaire',
      args: {
        p_ligne_bancaire_id: 'l-frais',
        p_categorie_id: 'cat-frais',
        p_ecritures: [
          { compte: '627100', sens: 'debit', montant: 8.5, libelle: 'FRAIS TENUE DE COMPTE' },
          { compte: '512000', sens: 'credit', montant: 8.5, libelle: 'FRAIS TENUE DE COMPTE' },
        ],
        p_taux_tva: null,
      },
    }])
    // Relue, l'écriture suit la catégorie : le panneau disparaît.
    await waitFor(() => expect(screen.queryByText('Mouvements affectés à réaffecter')).toBeNull())
  })

  // Trois clics dans le MÊME rendu, et pas deux : un verrou posé DANS le `try` laisse le refus du
  // deuxième sortir par le `finally`, qui relâche le verrou du premier — le troisième passe alors
  // (voir CLAUDE.md, « Le verrou se pose AVANT le `try` »). Avec deux clics, ce test restait vert.
  it("trois clics rapprochés ne réaffectent qu'une fois", async () => {
    poser({
      categories: [CATEGORIE_ACHATS, { ...FRAIS, compte_comptable: '627100' }],
      lignes_bancaires: [mouvement()],
      ecritures_brouillon: ECRITURE_FRAIS,
    })
    monter()
    const bouton = await screen.findByRole('button', { name: 'Réaffecter' })
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(faux.rpcs).toHaveLength(1)
  })

  // Le verrou d'un mouvement tient jusqu'à la RELECTURE, pas seulement jusqu'à l'appel : réaffecter un
  // second mouvement rend son bouton au premier (l'état n'en retient qu'un), et le premier, encore
  // porté par la liste le temps que la relecture revienne, se réaffecterait une seconde fois.
  it('ne réaffecte pas deux fois un mouvement dont la relecture n’est pas revenue', async () => {
    poser({
      categories: [CATEGORIE_ACHATS, { ...FRAIS, compte_comptable: '627100' }],
      lignes_bancaires: [mouvement(), mouvement({ id: 'l-frais-2', date: '2025-04-30' })],
      ecritures_brouillon: [
        ...ECRITURE_FRAIS,
        ecriture({ id: 'm3', piece_id: null, ligne_bancaire_id: 'l-frais-2', date: '2025-04-30', compte: '627000', sens: 'debit', montant: 8.5, libelle: 'FRAIS TENUE DE COMPTE' }),
        ecriture({ id: 'm4', piece_id: null, ligne_bancaire_id: 'l-frais-2', date: '2025-04-30', compte: '512000', sens: 'credit', montant: 8.5, libelle: 'FRAIS TENUE DE COMPTE' }),
      ],
    })
    monter()
    const [premier, second] = await screen.findAllByRole('button', { name: 'Réaffecter' })
    faux.retenirApresRpc = true
    await act(async () => { premier.click() })
    await act(async () => { second.click() })
    await waitFor(() => expect(premier.hasAttribute('disabled')).toBe(false))
    await act(async () => { premier.click() })
    expect(faux.rpcs.map((r) => r.args.p_ligne_bancaire_id)).toEqual(['l-frais', 'l-frais-2'])

    await act(async () => { faux.relacher?.() })
    await waitFor(() => expect(screen.queryByText('Mouvements affectés à réaffecter')).toBeNull())
  })

  it('dit une réaffectation que la base refuse, et garde le mouvement à réaffecter', async () => {
    poser({
      categories: [CATEGORIE_ACHATS, { ...FRAIS, compte_comptable: '627100' }],
      lignes_bancaires: [mouvement()],
      ecritures_brouillon: ECRITURE_FRAIS,
    })
    faux.erreurRpc = 'refus simulé'
    monter()
    const bouton = await screen.findByRole('button', { name: 'Réaffecter' })
    await act(async () => { bouton.click() })
    expect(await screen.findByText('refus simulé')).toBeTruthy()
    expect(screen.getByText('Mouvements affectés à réaffecter')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Réaffecter' }).hasAttribute('disabled')).toBe(false)
  })

  it('ne propose pas de réaffecter sur une catégorie sortie des comptes de résultat, et dit où aller', async () => {
    poser({
      categories: [CATEGORIE_ACHATS, { ...FRAIS, compte_comptable: '108000' }],
      lignes_bancaires: [mouvement()],
      ecritures_brouillon: ECRITURE_FRAIS,
    })
    monter()
    const bouton = await screen.findByRole('button', { name: 'Réaffecter' })
    expect(bouton.hasAttribute('disabled')).toBe(true)
    expect(bouton.getAttribute('title')).toMatch(/choisis une autre catégorie dans Banque/)
  })

  // LES RECETTES DU RELEVÉ PORTENT LEUR TAUX DE TVA sur un dossier assujetti (lib/tvaDuReleve.ts), et le
  // taux qui s'applique est celui du statut ACTUEL du dossier.
  const RECETTES = {
    id: 'cat-recettes', dossier_id: null, code: 'ventes_prestations', libelle: 'Ventes / prestations', ordre: 10,
    compte_comptable: '706000', poste_2035: 'Recettes',
  }
  const recette = (o: Record<string, unknown> = {}) => mouvement({
    id: 'l-cpam', libelle: 'VIR CPAM', montant: 120, categorie_id: 'cat-recettes', ...o,
  })
  const ECRITURE_TAXEE = [
    ecriture({ id: 'r1', piece_id: null, ligne_bancaire_id: 'l-cpam', date: '2025-03-31', compte: '706000', sens: 'credit', montant: 100, libelle: 'VIR CPAM' }),
    ecriture({ id: 'r2', piece_id: null, ligne_bancaire_id: 'l-cpam', date: '2025-03-31', compte: '445710', sens: 'credit', montant: 20, libelle: 'VIR CPAM' }),
    ecriture({ id: 'r3', piece_id: null, ligne_bancaire_id: 'l-cpam', date: '2025-03-31', compte: '512000', sens: 'debit', montant: 120, libelle: 'VIR CPAM' }),
  ]

  it('se tait sur une recette taxée d’un dossier assujetti dont l’écriture porte sa TVA', async () => {
    poser({ categories: [CATEGORIE_ACHATS, RECETTES], lignes_bancaires: [recette({ taux_tva: 20 })], ecritures_brouillon: ECRITURE_TAXEE })
    monter(true)
    await screen.findByText(/3 écritures proposées/)
    expect(screen.queryByText('Mouvements affectés à réaffecter')).toBeNull()
  })

  it('un dossier qui a cessé d’être assujetti : la recette écrite avec sa TVA est à réaffecter, au TTC et sans taux', async () => {
    poser({ categories: [CATEGORIE_ACHATS, RECETTES], lignes_bancaires: [recette({ taux_tva: 20 })], ecritures_brouillon: ECRITURE_TAXEE })
    monter(false)
    expect(await screen.findByText('Mouvements affectés à réaffecter')).toBeTruthy()
    // Le taux gardé ne s'applique plus : la ligne ne le montre pas.
    expect(screen.queryByText(/· TVA 20 %/)).toBeNull()
    await act(async () => { screen.getByRole('button', { name: 'Réaffecter' }).click() })
    expect(faux.rpcs).toEqual([{
      nom: 'affecter_mouvement_bancaire',
      args: {
        p_ligne_bancaire_id: 'l-cpam',
        p_categorie_id: 'cat-recettes',
        p_ecritures: [
          { compte: '706000', sens: 'credit', montant: 120, libelle: 'VIR CPAM' },
          { compte: '512000', sens: 'debit', montant: 120, libelle: 'VIR CPAM' },
        ],
        p_taux_tva: null,
      },
    }])
  })

  it('réaffecte une recette taxée dont la catégorie a changé de compte, avec son taux', async () => {
    poser({
      categories: [CATEGORIE_ACHATS, { ...RECETTES, compte_comptable: '706100' }],
      lignes_bancaires: [recette({ taux_tva: 20 })],
      ecritures_brouillon: ECRITURE_TAXEE,
    })
    monter(true)
    expect(await screen.findByText('Mouvements affectés à réaffecter')).toBeTruthy()
    expect(screen.getByText(/· TVA 20 %/)).toBeTruthy()
    await act(async () => { screen.getByRole('button', { name: 'Réaffecter' }).click() })
    expect(faux.rpcs[0].args).toEqual({
      p_ligne_bancaire_id: 'l-cpam',
      p_categorie_id: 'cat-recettes',
      p_ecritures: [
        { compte: '706100', sens: 'credit', montant: 100, libelle: 'VIR CPAM' },
        { compte: '445710', sens: 'credit', montant: 20, libelle: 'VIR CPAM' },
        { compte: '512000', sens: 'debit', montant: 120, libelle: 'VIR CPAM' },
      ],
      p_taux_tva: 20,
    })
  })

  it('une recette sans taux d’un dossier assujetti ne se réaffecte pas d’ici : son taux se choisit dans Banque', async () => {
    poser({
      categories: [CATEGORIE_ACHATS, { ...RECETTES, compte_comptable: '706100' }],
      lignes_bancaires: [recette()],
      ecritures_brouillon: [
        ecriture({ id: 'r1', piece_id: null, ligne_bancaire_id: 'l-cpam', date: '2025-03-31', compte: '706000', sens: 'credit', montant: 120, libelle: 'VIR CPAM' }),
        ecriture({ id: 'r3', piece_id: null, ligne_bancaire_id: 'l-cpam', date: '2025-03-31', compte: '512000', sens: 'debit', montant: 120, libelle: 'VIR CPAM' }),
      ],
    })
    monter(true)
    const bouton = await screen.findByRole('button', { name: 'Réaffecter' })
    expect(bouton.hasAttribute('disabled')).toBe(true)
    expect(bouton.getAttribute('title')).toMatch(/une recette porte son taux.*Depuis la fiche du mouvement, dans Banque/)
    await act(async () => { bouton.click() })
    expect(faux.rpcs).toEqual([])
  })
})

describe('EcrituresTab — ce que le FEC ne contiendra pas, bien accordé', () => {
  // L'alerte s'écrivait « ne seraont pas dans ce FEC » au pluriel : une faute dans le message qui
  // dit ce que le fichier fiscal ne contiendra pas le fait passer pour une négligence.
  it('au singulier comme au pluriel', async () => {
    poser({ ecritures_brouillon: [ecriture({ id: 'o1', piece_id: null })] })
    const { unmount } = monter()
    expect(await screen.findByText(/^1 écriture ne sera pas dans ce FEC/)).toBeTruthy()
    unmount()
    poser({ ecritures_brouillon: [ecriture({ id: 'o1', piece_id: null }), ecriture({ id: 'o2', piece_id: null })] })
    monter()
    expect(await screen.findByText(/^2 écritures ne seront pas dans ce FEC/)).toBeTruthy()
  })
})

// UN VIREMENT PERSONNEL (lib/virementPersonnel.ts) est classé « ignoré », et porte pourtant une
// écriture : le compte du dirigeant face à la banque. Ce que ce bloc garde et qu'aucun test de
// `src/lib` ne peut voir : que l'onglet lise ces mouvements-là aussi — ils ne sont pas « rapprochés » —,
// donc qu'il ne crie pas à la rupture sur leur écriture et qu'il la porte au FEC.
describe('EcrituresTab — les virements personnels', () => {
  function virement(o: Record<string, unknown> = {}) {
    return {
      id: 'l-perso', dossier_id: 'dossier-de-test', date: '2025-03-20', libelle: 'VIR PERSO', montant: -500,
      statut: 'ignoree', piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: true,
      source_fichier: 'releve-mars-2025.pdf', libelle_brut: null, created_at: '2025-04-02T09:00:00Z', ...o,
    }
  }
  const ECRITURE_PERSO = [
    ecriture({ id: 'v1', piece_id: null, ligne_bancaire_id: 'l-perso', date: '2025-03-20', compte: '108000', sens: 'debit', montant: 500, libelle: 'VIR PERSO' }),
    ecriture({ id: 'v2', piece_id: null, ligne_bancaire_id: 'l-perso', date: '2025-03-20', compte: '512000', sens: 'credit', montant: 500, libelle: 'VIR PERSO' }),
  ]

  it('ne crie pas à la rupture, et porte l’écriture au FEC, au journal de banque, sur le compte de l’exploitant', async () => {
    poser({ categories: [CATEGORIE_ACHATS], lignes_bancaires: [virement()], ecritures_brouillon: ECRITURE_PERSO })
    monter()
    await screen.findByText(/2 écritures proposées/)
    expect(screen.queryByText("Piste d'audit rompue")).toBeNull()
    expect(screen.queryByText(/pas dans ce FEC/)).toBeNull()

    await act(async () => { screen.getByRole('button', { name: /Exporter FEC/ }).click() })
    const lignes = telecharge.fichiers[0].contenu.split('\r\n').map((l) => l.split('\t')).slice(1)
    expect(lignes.map((l) => [l[0], l[2], l[8], l[9]])).toEqual([
      ['BQ', 'BQ00001', 'releve-mars-2025.pdf', '20250320'],
      ['BQ', 'BQ00001', 'releve-mars-2025.pdf', '20250320'],
    ])
    expect(lignes.map((l) => `${l[4]} ${l[5]}`).sort()).toEqual(["108000 Compte de l'exploitant", '512000 Banque'])
  })

  it('le garde symétrique : remis à traiter, ses écritures sont une rupture et sortent du FEC', async () => {
    poser({
      categories: [CATEGORIE_ACHATS],
      lignes_bancaires: [virement({ statut: 'non_rapprochee', prelevement_personnel: false })],
      ecritures_brouillon: ECRITURE_PERSO,
    })
    monter()
    expect(await screen.findByText("Piste d'audit rompue")).toBeTruthy()
    expect(screen.getByText(/2 écritures ne seront pas dans ce FEC/)).toBeTruthy()
  })
})

// L'ÉCHÉANCE D'EMPRUNT RAPPROCHÉE (lib/echeanceEmprunt.ts) : son écriture n'a pas de pièce, par
// construction — le relevé la justifie. Ce que le module ne peut pas voir : que l'écran LISE le mouvement
// rapproché d'un emprunt, pour ne pas crier à la rupture et porter l'écriture au FEC.
describe('EcrituresTab — les échéances d’emprunt', () => {
  function echeance(o: Record<string, unknown> = {}) {
    return {
      id: 'l-ech', dossier_id: 'dossier-de-test', date: '2025-03-06', libelle: 'PRLV ECHEANCE PRET', montant: -540,
      statut: 'rapprochee', piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
      emprunt_id: 'emp-1', emprunt_echeance: 2, emprunt_interets: 34.55, emprunt_assurance: 21.03,
      source_fichier: 'releve-mars-2025.pdf', libelle_brut: null, created_at: '2025-04-02T09:00:00Z', ...o,
    }
  }
  const ECRITURE_ECHEANCE = [
    ecriture({ id: 'x1', piece_id: null, ligne_bancaire_id: 'l-ech', date: '2025-03-06', compte: '164000', sens: 'debit', montant: 484.42, libelle: 'PRLV ECHEANCE PRET' }),
    ecriture({ id: 'x2', piece_id: null, ligne_bancaire_id: 'l-ech', date: '2025-03-06', compte: '661100', sens: 'debit', montant: 34.55, libelle: 'PRLV ECHEANCE PRET' }),
    ecriture({ id: 'x3', piece_id: null, ligne_bancaire_id: 'l-ech', date: '2025-03-06', compte: '616800', sens: 'debit', montant: 21.03, libelle: 'PRLV ECHEANCE PRET' }),
    ecriture({ id: 'x4', piece_id: null, ligne_bancaire_id: 'l-ech', date: '2025-03-06', compte: '512000', sens: 'credit', montant: 540, libelle: 'PRLV ECHEANCE PRET' }),
  ]

  it('ne crie pas à la rupture, et porte l’écriture au FEC, au journal de banque, le relevé pour pièce', async () => {
    poser({ categories: [CATEGORIE_ACHATS], lignes_bancaires: [echeance()], ecritures_brouillon: ECRITURE_ECHEANCE })
    monter()
    await screen.findByText(/4 écritures proposées/)
    expect(screen.queryByText("Piste d'audit rompue")).toBeNull()
    expect(screen.queryByText(/pas dans ce FEC/)).toBeNull()

    await act(async () => { screen.getByRole('button', { name: /Exporter FEC/ }).click() })
    const lignes = telecharge.fichiers[0].contenu.split('\r\n').map((l) => l.split('\t')).slice(1)
    expect(lignes.map((l) => [l[0], l[2], l[8], l[9]])).toEqual(Array(4).fill(['BQ', 'BQ00001', 'releve-mars-2025.pdf', '20250306']))
    expect(lignes.map((l) => l[4]).sort()).toEqual(['164000', '512000', '616800', '661100'])
  })

  it('le garde symétrique : le rapprochement retiré, ses écritures sont une rupture et sortent du FEC', async () => {
    poser({
      categories: [CATEGORIE_ACHATS],
      lignes_bancaires: [echeance({ statut: 'non_rapprochee', emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null })],
      ecritures_brouillon: ECRITURE_ECHEANCE,
    })
    monter()
    expect(await screen.findByText("Piste d'audit rompue")).toBeTruthy()
    expect(screen.getByText(/4 écritures ne seront pas dans ce FEC/)).toBeTruthy()
  })
})

// UN MOUVEMENT VENTILÉ SUR PLUSIEURS COMPTES (lib/ventilationBanque.ts). Son écriture, sans pièce, face au
// 512000, est justifiée par le relevé comme celle d'un mouvement affecté : ni rupture, ni absence du FEC.
// Ce que ce bloc garde et qu'aucun test de `src/lib` ne peut voir : que l'écran LISE les parts, propose de
// réécrire une écriture qui ne les suit plus, en renvoyant les MÊMES parts — jamais sur une lecture
// partielle, qui les remplacerait par ce qu'on en a lu.
describe('EcrituresTab — les mouvements ventilés sur plusieurs comptes', () => {
  const TELEPHONE = {
    id: 'cat-tel', dossier_id: null, code: 'telephone', libelle: 'Téléphone', ordre: 40,
    compte_comptable: '626000', poste_2035: 'Frais postaux et de télécommunications',
  }
  function mouvement(o: Record<string, unknown> = {}) {
    return {
      id: 'l-v', dossier_id: 'dossier-de-test', date: '2025-03-31', libelle: 'PRLV OPERATEUR MOBILE', montant: -120,
      statut: 'rapprochee', piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
      ventilee: true, source_fichier: 'releve-mars-2025.pdf', libelle_brut: null, created_at: '2025-04-02T09:00:00Z', ...o,
    }
  }
  function part(id: string, categorieId: string | null, montant: number, ligneId = 'l-v') {
    return {
      id, dossier_id: 'dossier-de-test', ligne_bancaire_id: ligneId, categorie_id: categorieId,
      part_personnelle: categorieId === null, montant, taux_tva: null as number | null, created_at: '2025-04-02T09:00:00Z',
    }
  }
  const PARTS = [part('v1', 'cat-tel', -84), part('v2', null, -36)]
  function ecrituresDe(ligneId: string, date: string, compteTel = '626000') {
    return [
      ecriture({ id: `${ligneId}-1`, piece_id: null, ligne_bancaire_id: ligneId, date, compte: compteTel, sens: 'debit', montant: 84, libelle: 'PRLV OPERATEUR MOBILE' }),
      ecriture({ id: `${ligneId}-2`, piece_id: null, ligne_bancaire_id: ligneId, date, compte: '108000', sens: 'debit', montant: 36, libelle: 'PRLV OPERATEUR MOBILE' }),
      ecriture({ id: `${ligneId}-3`, piece_id: null, ligne_bancaire_id: ligneId, date, compte: '512000', sens: 'credit', montant: 120, libelle: 'PRLV OPERATEUR MOBILE' }),
    ]
  }
  // Une catégorie dont le compte a changé depuis la ventilation : l'écriture reste sur l'ancien.
  const RECOMPTEE = { ...TELEPHONE, compte_comptable: '626100' }

  it('ne crie pas à la rupture, et porte l’écriture au FEC, au journal de banque, le relevé pour pièce', async () => {
    poser({ categories: [CATEGORIE_ACHATS, TELEPHONE], lignes_bancaires: [mouvement()], ventilations_bancaires: PARTS, ecritures_brouillon: ecrituresDe('l-v', '2025-03-31') })
    monter()
    await screen.findByText(/3 écritures proposées/)
    expect(screen.queryByText("Piste d'audit rompue")).toBeNull()
    expect(screen.queryByText(/pas dans ce FEC/)).toBeNull()
    expect(screen.queryByText('Mouvements ventilés à réécrire')).toBeNull()

    await act(async () => { screen.getByRole('button', { name: /Exporter FEC/ }).click() })
    const lignes = telecharge.fichiers[0].contenu.split('\r\n').map((l) => l.split('\t')).slice(1)
    expect(lignes.map((l) => [l[0], l[2], l[8]])).toEqual([
      ['BQ', 'BQ00001', 'releve-mars-2025.pdf'],
      ['BQ', 'BQ00001', 'releve-mars-2025.pdf'],
      ['BQ', 'BQ00001', 'releve-mars-2025.pdf'],
    ])
  })

  it('compte parmi les catégories sans compte celle qu’une part désigne', async () => {
    poser({ categories: [CATEGORIE_ACHATS, { ...TELEPHONE, compte_comptable: null }], lignes_bancaires: [mouvement()], ventilations_bancaires: PARTS })
    monter()
    const titre = await screen.findByText('Comptes manquants')
    expect(titre.closest('.card')!.textContent).toMatch(/Téléphone/)
  })

  it('propose de réécrire l’écriture qui ne suit plus les parts, et renvoie les MÊMES parts', async () => {
    poser({ categories: [CATEGORIE_ACHATS, RECOMPTEE], lignes_bancaires: [mouvement()], ventilations_bancaires: PARTS, ecritures_brouillon: ecrituresDe('l-v', '2025-03-31') })
    monter()
    expect(await screen.findByText('Mouvements ventilés à réécrire')).toBeTruthy()
    await act(async () => { screen.getByRole('button', { name: 'Réécrire' }).click() })
    expect(faux.rpcs).toEqual([{
      nom: 'ventiler_mouvement_bancaire',
      args: {
        p_ligne_bancaire_id: 'l-v',
        p_parts: [
          { categorie_id: 'cat-tel', part_personnelle: false, montant: -84, taux_tva: null },
          { categorie_id: null, part_personnelle: true, montant: -36, taux_tva: null },
        ],
        p_ecritures: [
          { compte: '626100', sens: 'debit', montant: 84, libelle: 'PRLV OPERATEUR MOBILE' },
          { compte: '108000', sens: 'debit', montant: 36, libelle: 'PRLV OPERATEUR MOBILE' },
          { compte: '512000', sens: 'credit', montant: 120, libelle: 'PRLV OPERATEUR MOBILE' },
        ],
      },
    }])
    // Relue, l'écriture suit les parts : le panneau disparaît.
    await waitFor(() => expect(screen.queryByText('Mouvements ventilés à réécrire')).toBeNull())
  })

  it('en engagement, la part personnelle se réécrit sur le compte choisi pour le dirigeant', async () => {
    poser({ categories: [CATEGORIE_ACHATS, RECOMPTEE], lignes_bancaires: [mouvement()], ventilations_bancaires: PARTS, ecritures_brouillon: ecrituresDe('l-v', '2025-03-31') })
    monter(false, ENGAGEMENT)
    const bouton = await screen.findByRole('button', { name: 'Réécrire' })
    await act(async () => { bouton.click() })
    expect(faux.rpcs[0].args.p_ecritures).toEqual(expect.arrayContaining([
      { compte: '455000', sens: 'debit', montant: 36, libelle: 'PRLV OPERATEUR MOBILE' },
    ]))
  })

  it("trois clics rapprochés ne réécrivent qu'une fois", async () => {
    poser({ categories: [CATEGORIE_ACHATS, RECOMPTEE], lignes_bancaires: [mouvement()], ventilations_bancaires: PARTS, ecritures_brouillon: ecrituresDe('l-v', '2025-03-31') })
    monter()
    const bouton = await screen.findByRole('button', { name: 'Réécrire' })
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(faux.rpcs).toHaveLength(1)
  })

  // Le verrou tient jusqu'à la RELECTURE : réécrire un second mouvement rend son bouton au premier (l'état
  // n'en retient qu'un), et le premier, encore porté par la liste le temps que la relecture revienne, se
  // réécrirait une seconde fois.
  it('ne réécrit pas deux fois un mouvement dont la relecture n’est pas revenue', async () => {
    poser({
      categories: [CATEGORIE_ACHATS, RECOMPTEE],
      lignes_bancaires: [mouvement(), mouvement({ id: 'l-v2', date: '2025-04-30' })],
      ventilations_bancaires: [...PARTS, part('w1', 'cat-tel', -84, 'l-v2'), part('w2', null, -36, 'l-v2')],
      ecritures_brouillon: [...ecrituresDe('l-v', '2025-03-31'), ...ecrituresDe('l-v2', '2025-04-30')],
    })
    monter()
    const [premier, second] = await screen.findAllByRole('button', { name: 'Réécrire' })
    faux.retenirApresRpc = true
    await act(async () => { premier.click() })
    await act(async () => { second.click() })
    await waitFor(() => expect(premier.hasAttribute('disabled')).toBe(false))
    await act(async () => { premier.click() })
    expect(faux.rpcs.map((r) => r.args.p_ligne_bancaire_id)).toEqual(['l-v', 'l-v2'])

    await act(async () => { faux.relacher?.() })
    await waitFor(() => expect(screen.queryByText('Mouvements ventilés à réécrire')).toBeNull())
  })

  it('dit une réécriture que la base refuse, et garde le mouvement à réécrire', async () => {
    poser({ categories: [CATEGORIE_ACHATS, RECOMPTEE], lignes_bancaires: [mouvement()], ventilations_bancaires: PARTS, ecritures_brouillon: ecrituresDe('l-v', '2025-03-31') })
    faux.erreurRpc = 'refus simulé'
    monter()
    const bouton = await screen.findByRole('button', { name: 'Réécrire' })
    await act(async () => { bouton.click() })
    expect(await screen.findByText('refus simulé')).toBeTruthy()
    expect(screen.getByText('Mouvements ventilés à réécrire')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Réécrire' }).hasAttribute('disabled')).toBe(false)
  })

  it('ne propose pas de réécrire sur une catégorie sortie des comptes de résultat, et dit où aller', async () => {
    poser({ categories: [CATEGORIE_ACHATS, { ...TELEPHONE, compte_comptable: '108000' }], lignes_bancaires: [mouvement()], ventilations_bancaires: PARTS, ecritures_brouillon: ecrituresDe('l-v', '2025-03-31') })
    monter()
    const bouton = await screen.findByRole('button', { name: 'Réécrire' })
    expect(bouton.hasAttribute('disabled')).toBe(true)
    expect(bouton.getAttribute('title')).toMatch(/« Téléphone » n’a pas de compte de charge ou de produit.*Modifie la ventilation depuis la fiche du mouvement, dans Banque/)
  })

  // LES PARTS DE RECETTE PORTENT LEUR TAUX sur un dossier assujetti, et « Réécrire » renvoie le taux qui
  // s'applique AUJOURD'HUI (`partsAReecrire`).
  const RECETTES = {
    id: 'cat-recettes', dossier_id: null, code: 'ventes_prestations', libelle: 'Ventes / prestations', ordre: 10,
    compte_comptable: '706000', poste_2035: 'Recettes',
  }
  const FRAIS = {
    id: 'cat-frais', dossier_id: null, code: 'frais_bancaires', libelle: 'Frais bancaires', ordre: 70,
    compte_comptable: '627000', poste_2035: 'Frais financiers',
  }
  const remise = () => mouvement({ id: 'l-r', libelle: 'REMISE CB', montant: 95 })
  const partsRemise = (taux: number | null) => [
    { ...part('r1', 'cat-recettes', 100, 'l-r'), taux_tva: taux },
    part('r2', 'cat-frais', -5, 'l-r'),
  ]
  const ecritureRemise = (compteRecette: string, taxee: boolean) => [
    ecriture({ id: 'e1', piece_id: null, ligne_bancaire_id: 'l-r', date: '2025-03-31', compte: compteRecette, sens: 'credit', montant: taxee ? 83.33 : 100, libelle: 'REMISE CB' }),
    ...(taxee ? [ecriture({ id: 'e2', piece_id: null, ligne_bancaire_id: 'l-r', date: '2025-03-31', compte: '445710', sens: 'credit', montant: 16.67, libelle: 'REMISE CB' })] : []),
    ecriture({ id: 'e3', piece_id: null, ligne_bancaire_id: 'l-r', date: '2025-03-31', compte: '627000', sens: 'debit', montant: 5, libelle: 'REMISE CB' }),
    ecriture({ id: 'e4', piece_id: null, ligne_bancaire_id: 'l-r', date: '2025-03-31', compte: '512000', sens: 'debit', montant: 95, libelle: 'REMISE CB' }),
  ]

  it('se tait sur une remise taxée d’un dossier assujetti dont l’écriture porte la TVA de sa part de recette', async () => {
    poser({ categories: [CATEGORIE_ACHATS, RECETTES, FRAIS], lignes_bancaires: [remise()], ventilations_bancaires: partsRemise(20), ecritures_brouillon: ecritureRemise('706000', true) })
    monter(true)
    await screen.findByText(/4 écritures proposées/)
    expect(screen.queryByText('Mouvements ventilés à réécrire')).toBeNull()
  })

  it('un dossier qui a cessé d’être assujetti : la remise est à réécrire, au TTC et sans taux', async () => {
    poser({ categories: [CATEGORIE_ACHATS, RECETTES, FRAIS], lignes_bancaires: [remise()], ventilations_bancaires: partsRemise(20), ecritures_brouillon: ecritureRemise('706000', true) })
    monter(false)
    expect(await screen.findByText('Mouvements ventilés à réécrire')).toBeTruthy()
    await act(async () => { screen.getByRole('button', { name: 'Réécrire' }).click() })
    expect(faux.rpcs[0].args).toEqual({
      p_ligne_bancaire_id: 'l-r',
      p_parts: [
        { categorie_id: 'cat-recettes', part_personnelle: false, montant: 100, taux_tva: null },
        { categorie_id: 'cat-frais', part_personnelle: false, montant: -5, taux_tva: null },
      ],
      p_ecritures: [
        { compte: '706000', sens: 'credit', montant: 100, libelle: 'REMISE CB' },
        { compte: '627000', sens: 'debit', montant: 5, libelle: 'REMISE CB' },
        { compte: '512000', sens: 'debit', montant: 95, libelle: 'REMISE CB' },
      ],
    })
  })

  it('réécrit une remise taxée dont la catégorie a changé de compte, avec le taux de sa part', async () => {
    poser({
      categories: [CATEGORIE_ACHATS, { ...RECETTES, compte_comptable: '706100' }, FRAIS],
      lignes_bancaires: [remise()], ventilations_bancaires: partsRemise(20), ecritures_brouillon: ecritureRemise('706000', true),
    })
    monter(true)
    // Cherché HORS de l'`act` : dedans, React retient les mises à jour jusqu'à la sortie.
    const bouton = await screen.findByRole('button', { name: 'Réécrire' })
    await act(async () => { bouton.click() })
    expect((faux.rpcs[0].args.p_parts as { taux_tva: number | null }[]).map((p) => p.taux_tva)).toEqual([20, null])
    expect(faux.rpcs[0].args.p_ecritures).toEqual([
      { compte: '706100', sens: 'credit', montant: 83.33, libelle: 'REMISE CB' },
      { compte: '445710', sens: 'credit', montant: 16.67, libelle: 'REMISE CB' },
      { compte: '627000', sens: 'debit', montant: 5, libelle: 'REMISE CB' },
      { compte: '512000', sens: 'debit', montant: 95, libelle: 'REMISE CB' },
    ])
  })

  it('une part de recette sans taux d’un dossier assujetti ne se réécrit pas d’ici : son taux se choisit dans Banque', async () => {
    poser({
      categories: [CATEGORIE_ACHATS, { ...RECETTES, compte_comptable: '706100' }, FRAIS],
      lignes_bancaires: [remise()], ventilations_bancaires: partsRemise(null), ecritures_brouillon: ecritureRemise('706000', false),
    })
    monter(true)
    const bouton = await screen.findByRole('button', { name: 'Réécrire' })
    expect(bouton.hasAttribute('disabled')).toBe(true)
    expect(bouton.getAttribute('title')).toMatch(/la part « Ventes \/ prestations » est une recette : choisis son taux.*Modifie la ventilation depuis la fiche du mouvement, dans Banque/)
    await act(async () => { bouton.click() })
    expect(faux.rpcs).toEqual([])
  })

  // Trouvé par mutation : le premier test de lecture partielle ne coupait que les parts du mouvement à
  // réécrire, qui devenaient alors « incohérentes » et sortaient du panneau d'elles-mêmes. Coupées sur un
  // AUTRE mouvement, les parts du premier sont lues en entier : sans la garde, le panneau le proposerait,
  // et « Réécrire » — suspendu sur une lecture partielle — ne ferait rien au clic.
  it('ne propose rien sur une lecture partielle, même d’un mouvement dont les parts sont toutes lues', async () => {
    poser({
      categories: [CATEGORIE_ACHATS, RECOMPTEE],
      lignes_bancaires: [mouvement(), mouvement({ id: 'l-v2', date: '2025-04-30' })],
      ventilations_bancaires: [...PARTS, part('w1', 'cat-tel', -84, 'l-v2'), part('w2', null, -36, 'l-v2')],
      ecritures_brouillon: [...ecrituresDe('l-v', '2025-03-31'), ...ecrituresDe('l-v2', '2025-04-30')],
    })
    faux.muetParTable = { ventilations_bancaires: 3 }
    monter()
    expect(await screen.findByText(/Les parts des mouvements ventilés/)).toBeTruthy()
    expect(screen.queryByText('Mouvements ventilés à réécrire')).toBeNull()
  })

  it('sur des parts lues en partie, le dit, ne propose rien et laisse le FEC s’exporter', async () => {
    poser({ categories: [CATEGORIE_ACHATS, RECOMPTEE], lignes_bancaires: [mouvement()], ventilations_bancaires: PARTS, ecritures_brouillon: ecrituresDe('l-v', '2025-03-31') })
    faux.muetParTable = { ventilations_bancaires: 1 }
    monter()
    expect(await screen.findByText(/Les parts des mouvements ventilés/)).toBeTruthy()
    expect(screen.queryByText('Mouvements ventilés à réécrire')).toBeNull()
    await act(async () => { screen.getByRole('button', { name: /Exporter FEC/ }).click() })
    expect(telecharge.fichiers).toHaveLength(1)
  })
})

// LIGNE 26.7 : UN MOUVEMENT ÉCRIT SUR UN COMPTE DE BILAN (lib/compteDeBilan.ts). Son écriture, sans pièce, face au
// 512000, est justifiée par le relevé : ni rupture, ni absence du FEC. Ce que ce bloc garde et qu'aucun test de
// `src/lib` ne peut voir : que l'écran LISE le mouvement — rapproché sans pièce —, et propose de réécrire une écriture
// qui ne suivrait plus le compte, par la même fonction que son classement. Défensif : la base écrit le compte et
// l'écriture ensemble.
describe('EcrituresTab — les mouvements écrits sur un compte de bilan', () => {
  function mouvement(o: Record<string, unknown> = {}) {
    return {
      id: 'l-b', dossier_id: 'dossier-de-test', date: '2025-03-15', libelle: 'VIR VERS LIVRET A', montant: -1000,
      statut: 'rapprochee', piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
      compte_bilan: '580000', source_fichier: 'releve-mars-2025.pdf', libelle_brut: null, created_at: '2025-04-02T09:00:00Z', ...o,
    }
  }
  function ecrituresDu(montant = 1000) {
    return [
      ecriture({ id: 'b1', piece_id: null, ligne_bancaire_id: 'l-b', date: '2025-03-15', compte: '580000', sens: 'debit', montant, libelle: 'VIR VERS LIVRET A' }),
      ecriture({ id: 'b2', piece_id: null, ligne_bancaire_id: 'l-b', date: '2025-03-15', compte: '512000', sens: 'credit', montant, libelle: 'VIR VERS LIVRET A' }),
    ]
  }

  it('ne crie pas à la rupture, et porte l’écriture au FEC, au journal de banque, le relevé pour pièce', async () => {
    poser({ categories: [CATEGORIE_ACHATS], lignes_bancaires: [mouvement()], ecritures_brouillon: ecrituresDu() })
    monter()
    await screen.findByText(/2 écritures proposées/)
    expect(screen.queryByText("Piste d'audit rompue")).toBeNull()
    expect(screen.queryByText(/pas dans ce FEC/)).toBeNull()
    expect(screen.queryByText('Mouvements écrits sur un compte de bilan à réécrire')).toBeNull()

    await act(async () => { screen.getByRole('button', { name: /Exporter FEC/ }).click() })
    const lignes = telecharge.fichiers[0].contenu.split('\r\n').map((l) => l.split('\t')).slice(1)
    expect(lignes.map((l) => [l[0], l[2], l[8], l[9]])).toEqual([
      ['BQ', 'BQ00001', 'releve-mars-2025.pdf', '20250315'],
      ['BQ', 'BQ00001', 'releve-mars-2025.pdf', '20250315'],
    ])
    expect(lignes.map((l) => `${l[4]} ${l[5]}`).sort()).toEqual(['512000 Banque', '580000 Virements internes'])
  })

  it('le garde symétrique : remis à traiter, ses écritures sont une rupture et sortent du FEC', async () => {
    poser({
      categories: [CATEGORIE_ACHATS],
      lignes_bancaires: [mouvement({ statut: 'non_rapprochee', compte_bilan: null, declaration_tva_id: null })],
      ecritures_brouillon: ecrituresDu(),
    })
    monter()
    expect(await screen.findByText("Piste d'audit rompue")).toBeTruthy()
    expect(screen.getByText(/2 écritures ne seront pas dans ce FEC/)).toBeTruthy()
  })

  it('propose de réécrire une écriture qui ne suit plus le compte, par la même fonction', async () => {
    poser({ categories: [CATEGORIE_ACHATS], lignes_bancaires: [mouvement()], ecritures_brouillon: ecrituresDu(900) })
    monter()
    expect(await screen.findByText('Mouvements écrits sur un compte de bilan à réécrire')).toBeTruthy()
    await act(async () => { screen.getByRole('button', { name: 'Réécrire' }).click() })
    expect(faux.rpcs).toEqual([{
      nom: 'ecrire_mouvement_compte_bilan',
      args: {
        p_ligne_bancaire_id: 'l-b',
        p_compte: '580000',
        p_ecritures: [
          { compte: '580000', sens: 'debit', montant: 1000, libelle: 'VIR VERS LIVRET A' },
          { compte: '512000', sens: 'credit', montant: 1000, libelle: 'VIR VERS LIVRET A' },
        ],
      },
    }])
    // Relue, l'écriture suit le compte : le panneau disparaît.
    await waitFor(() => expect(screen.queryByText('Mouvements écrits sur un compte de bilan à réécrire')).toBeNull())
  })

  it('une écriture absente se propose aussi', async () => {
    poser({ categories: [CATEGORIE_ACHATS], lignes_bancaires: [mouvement()], ecritures_brouillon: [] })
    monter()
    expect(await screen.findByText('Mouvements écrits sur un compte de bilan à réécrire')).toBeTruthy()
  })

  it("trois clics rapprochés ne réécrivent qu'une fois", async () => {
    poser({ categories: [CATEGORIE_ACHATS], lignes_bancaires: [mouvement()], ecritures_brouillon: ecrituresDu(900) })
    monter()
    const bouton = await screen.findByRole('button', { name: 'Réécrire' })
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(faux.rpcs).toHaveLength(1)
  })

  // Le verrou tient jusqu'à la RELECTURE : réécrire un second mouvement rend son bouton au premier (l'état n'en retient
  // qu'un), et le premier, encore porté par la liste le temps que la relecture revienne, se réécrirait une seconde fois.
  it('ne réécrit pas deux fois un mouvement dont la relecture n’est pas revenue', async () => {
    const second = mouvement({ id: 'l-b2', date: '2025-04-15', libelle: 'DEPOT DE GARANTIE', compte_bilan: '275000' })
    poser({ categories: [CATEGORIE_ACHATS], lignes_bancaires: [mouvement(), second], ecritures_brouillon: ecrituresDu(900) })
    monter()
    const [premier, autre] = await screen.findAllByRole('button', { name: 'Réécrire' })
    faux.retenirApresRpc = true
    await act(async () => { premier.click() })
    await act(async () => { autre.click() })
    await waitFor(() => expect(premier.hasAttribute('disabled')).toBe(false))
    await act(async () => { premier.click() })
    expect(faux.rpcs.map((r) => r.args.p_ligne_bancaire_id)).toEqual(['l-b', 'l-b2'])

    await act(async () => { faux.relacher?.() })
    await waitFor(() => expect(screen.queryByText('Mouvements écrits sur un compte de bilan à réécrire')).toBeNull())
  })

  // Un compte que la base refuserait aujourd'hui — ici le compte du dirigeant d'un dossier passé en engagement, que
  // « Virement personnel » tient — ne se réécrit pas d'un clic : le bouton le dit et renvoie à la fiche du mouvement.
  it('ne propose pas de réécrire sur un compte que la base refuserait, et dit où aller', async () => {
    poser({ categories: [CATEGORIE_ACHATS], lignes_bancaires: [mouvement({ compte_bilan: '455000' })], ecritures_brouillon: [] })
    monter(false, ENGAGEMENT)
    const bouton = await screen.findByRole('button', { name: 'Réécrire' })
    expect(bouton.hasAttribute('disabled')).toBe(true)
    expect(bouton.getAttribute('title')).toMatch(/« Virement personnel ».*Depuis la fiche du mouvement, dans Banque/)
  })

  it('dit une réécriture que la base refuse, et garde le mouvement à réécrire', async () => {
    poser({ categories: [CATEGORIE_ACHATS], lignes_bancaires: [mouvement()], ecritures_brouillon: ecrituresDu(900) })
    faux.erreurRpc = 'refus simulé'
    monter()
    const bouton = await screen.findByRole('button', { name: 'Réécrire' })
    await act(async () => { bouton.click() })
    expect(await screen.findByText('refus simulé')).toBeTruthy()
    expect(screen.getByText('Mouvements écrits sur un compte de bilan à réécrire')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Réécrire' }).hasAttribute('disabled')).toBe(false)
  })

  // Le même jeu que « propose de réécrire », l'exercice validé : la base refuse de réécrire une écriture validée.
  it('ne propose rien d’un exercice validé, que la base refuse de réécrire', async () => {
    poser({
      categories: [CATEGORIE_ACHATS], lignes_bancaires: [mouvement()],
      ecritures_brouillon: ecrituresDu(900).map((e) => ({ ...e, statut: 'validee' })),
    })
    monter(false, TRESORERIE, 2025, [2025])
    await screen.findByText(/0 écriture proposée — 2 validées/)
    expect(screen.queryByText('Mouvements écrits sur un compte de bilan à réécrire')).toBeNull()
  })
})

// LIGNE 26.8 : LA TVA SE LIQUIDE, SON PAIEMENT S'ÉCRIT (lib/liquidationTva.ts). La base écrit une déclaration et sa
// liquidation ensemble, un rapprochement et son écriture ensemble : un écart ne devrait pas exister. Ce que ce bloc garde
// et qu'aucun test de `src/lib` ne voit : que l'onglet porte la liquidation au FEC sans crier à la rupture, qu'il dise un
// écart s'il en paraît un, et qu'il le répare par la base — la liquidation depuis ce que la déclaration a ENREGISTRÉ, sans
// la retirer, et le paiement par la fonction de son rapprochement.
describe('EcrituresTab — la TVA liquidée et payée', () => {
  function declarationTva(o: Record<string, unknown> = {}) {
    return {
      id: 'decl-t1', dossier_id: 'dossier-de-test', periode_debut: '2025-01-01', periode_fin: '2025-03-31',
      tva_declaree: 79, credit_anterieur: 0, remboursement_demande: 0, date_declaration: '2025-04-15', notes: null,
      created_at: '2025-04-15T10:00:00Z',
      cases: { l16: 100, l19: 0, l20: 21, l21: 0, l22: 0, l23: 21, l25: 0, l26: 0, l27: 0, l28: 79, l32: 79 },
      tva_collectee: 100.40, tva_deductible: 20.60, tva_deductible_immobilisations: 0, ...o,
    }
  }
  const LIQUIDATION = [
    { compte: '445710', sens: 'debit', montant: 100.40 },
    { compte: '445660', sens: 'credit', montant: 20.60 },
    { compte: '445510', sens: 'credit', montant: 79 },
    { compte: '758000', sens: 'credit', montant: 0.80 },
  ]
  function liquidation(montant445510 = 79) {
    return LIQUIDATION.map((l, i) => ecriture({
      id: `lq${i}`, piece_id: null, declaration_tva_id: 'decl-t1', date: '2025-03-31', libelle: 'CA3 1er trimestre 2025', ...l,
      ...(l.compte === '445510' ? { montant: montant445510 } : {}),
    }))
  }
  function prelevement(o: Record<string, unknown> = {}) {
    return {
      id: 'l-tva', dossier_id: 'dossier-de-test', date: '2025-04-28', libelle: 'PRLV SEPA DGFIP TVA', montant: -79,
      statut: 'rapprochee', piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
      compte_bilan: null, declaration_tva_id: 'decl-t1', source_fichier: 'releve-avril-2025.pdf', libelle_brut: null,
      created_at: '2025-05-02T09:00:00Z', ...o,
    }
  }
  function paiement(montant = 79) {
    return [
      ecriture({ id: 'pt1', piece_id: null, ligne_bancaire_id: 'l-tva', date: '2025-04-28', compte: '512000', sens: 'credit', montant, libelle: 'PRLV SEPA DGFIP TVA' }),
      ecriture({ id: 'pt2', piece_id: null, ligne_bancaire_id: 'l-tva', date: '2025-04-28', compte: '445510', sens: 'debit', montant, libelle: 'PRLV SEPA DGFIP TVA' }),
    ]
  }

  it('une liquidation et un paiement conformes ne se signalent pas, et partent au FEC', async () => {
    poser({ declarations_tva: [declarationTva()], lignes_bancaires: [prelevement()], ecritures_brouillon: [...liquidation(), ...paiement()] })
    monter(true)
    await screen.findByText(/6 écritures proposées/)
    expect(screen.queryByText('Liquidations de TVA à réécrire')).toBeNull()
    expect(screen.queryByText('Paiements de TVA à réécrire')).toBeNull()
    expect(screen.queryByText("Piste d'audit rompue")).toBeNull()
    expect(screen.queryByText(/pas dans ce FEC/)).toBeNull()

    await act(async () => { screen.getByRole('button', { name: /Exporter FEC/ }).click() })
    const lignes = telecharge.fichiers[0].contenu.split('\r\n').map((l) => l.split('\t')).slice(1)
    // La liquidation au journal des opérations diverses, la déclaration pour pièce ; le prélèvement au journal de banque.
    expect(lignes.filter((l) => l[0] === 'OD').map((l) => [l[4], l[8], l[9]])).toEqual(expect.arrayContaining([
      ['445710', 'CA3 au 31/03/2025', '20250331'], ['445510', 'CA3 au 31/03/2025', '20250331'],
    ]))
    expect(lignes.filter((l) => l[0] === 'OD')).toHaveLength(4)
    expect(lignes.filter((l) => l[0] === 'BQ').map((l) => l[4]).sort()).toEqual(['445510', '512000'])
  })

  it('propose de réécrire une liquidation qui ne suit plus sa déclaration, depuis ce qu’elle a enregistré', async () => {
    poser({ declarations_tva: [declarationTva()], ecritures_brouillon: liquidation(80) })
    monter(true)
    expect(await screen.findByText('Liquidations de TVA à réécrire')).toBeTruthy()
    expect(screen.getByText('1er trimestre 2025')).toBeTruthy()
    await act(async () => { screen.getByRole('button', { name: 'Réécrire' }).click() })
    expect(faux.rpcs).toEqual([{
      nom: 'ecrire_liquidation_tva',
      args: {
        p_declaration_id: 'decl-t1',
        p_ecriture: LIQUIDATION.map((l) => ({ ...l, libelle: 'CA3 1er trimestre 2025' })),
      },
    }])
    // Ni retirée, ni réenregistrée : la déclaration déposée reste celle qu'elle est.
    expect(faux.suppressions).toEqual([])
    await waitFor(() => expect(screen.queryByText('Liquidations de TVA à réécrire')).toBeNull())
  })

  it('une liquidation absente se propose aussi', async () => {
    poser({ declarations_tva: [declarationTva()], ecritures_brouillon: [] })
    monter(true)
    expect(await screen.findByText('Liquidations de TVA à réécrire')).toBeTruthy()
  })

  // Une déclaration saisie à la main n'écrit pas de liquidation : une écriture qui la désigne ne se réécrit pas, elle se
  // retire avec la déclaration.
  it('une déclaration saisie à la main ne se réécrit pas, et le bouton dit où aller', async () => {
    poser({
      declarations_tva: [declarationTva({ cases: null, tva_collectee: null, tva_deductible: null, tva_deductible_immobilisations: null })],
      ecritures_brouillon: liquidation(),
    })
    monter(true)
    const bouton = await screen.findByRole('button', { name: 'Réécrire' })
    expect(bouton.hasAttribute('disabled')).toBe(true)
    expect(bouton.getAttribute('title')).toMatch(/saisie à la main.*dans l’onglet TVA/)
  })

  // Un écart de plus de dix euros entre la TVA des comptes et la TVA déclarée n'est pas un arrondi : la base refuserait la
  // liquidation, et le bouton le dit au lieu de laisser cliquer pour un refus.
  it('une liquidation dont l’arrondi n’en est pas un ne se réécrit pas, et le bouton le dit', async () => {
    poser({ declarations_tva: [declarationTva({ tva_collectee: 120.40 })], ecritures_brouillon: liquidation(80) })
    monter(true)
    const bouton = await screen.findByRole('button', { name: 'Réécrire' })
    expect(bouton.hasAttribute('disabled')).toBe(true)
    expect(bouton.getAttribute('title')).toMatch(/n’est pas un arrondi : la base refuserait cette liquidation/)
  })

  // Sur des déclarations lues en partie, celles qui sont lues se jugent sur elles-mêmes ; les autres ne se jugent pas —
  // sans écriture de liquidation, la seconde crierait sinon « absente » —, le paiement d'une déclaration non lue ne se
  // réécrit pas, et l'écran le dit.
  it('sur des déclarations lues en partie, seules les déclarations lues se jugent, et l’écran le dit', async () => {
    poser({
      declarations_tva: [
        declarationTva(),
        declarationTva({ id: 'decl-t2', periode_debut: '2025-04-01', periode_fin: '2025-06-30', date_declaration: '2025-07-15' }),
      ],
      lignes_bancaires: [prelevement({ id: 'l-t2', date: '2025-07-28', declaration_tva_id: 'decl-t2' })],
      ecritures_brouillon: [
        ...liquidation(80),
        ecriture({ id: 'pt3', piece_id: null, ligne_bancaire_id: 'l-t2', date: '2025-07-28', compte: '512000', sens: 'credit', montant: 70, libelle: 'PRLV SEPA DGFIP TVA' }),
        ecriture({ id: 'pt4', piece_id: null, ligne_bancaire_id: 'l-t2', date: '2025-07-28', compte: '445510', sens: 'debit', montant: 70, libelle: 'PRLV SEPA DGFIP TVA' }),
      ],
    })
    faux.muetParTable = { declarations_tva: 1 }
    monter(true)
    expect(await screen.findByText(/Les déclarations de TVA n'ont pas pu être lues en entier/)).toBeTruthy()
    const liquidations = screen.getByText('Liquidations de TVA à réécrire').closest('.card') as HTMLElement
    expect(within(liquidations).getByText('1er trimestre 2025')).toBeTruthy()
    expect(within(liquidations).queryByText('2e trimestre 2025')).toBeNull()
    const paiements = screen.getByText('Paiements de TVA à réécrire').closest('.card') as HTMLElement
    const bouton = within(paiements).getByRole('button', { name: 'Réécrire' })
    expect(bouton.hasAttribute('disabled')).toBe(true)
    expect(bouton.getAttribute('title')).toBe('Les déclarations de TVA n’ont pas pu être lues en entier : recharge la page.')
  })

  it('propose de réécrire un paiement qui ne suit plus son mouvement, par la fonction de son rapprochement', async () => {
    poser({ declarations_tva: [declarationTva()], lignes_bancaires: [prelevement()], ecritures_brouillon: [...liquidation(), ...paiement(70)] })
    monter(true)
    expect(await screen.findByText('Paiements de TVA à réécrire')).toBeTruthy()
    // Trois clics rapprochés : un seul appel.
    const bouton = screen.getByRole('button', { name: 'Réécrire' })
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(faux.rpcs).toEqual([{
      nom: 'rapprocher_declaration_tva',
      args: {
        p_ligne_bancaire_id: 'l-tva',
        p_declaration_id: 'decl-t1',
        p_ecriture: [
          { compte: '512000', sens: 'credit', montant: 79, libelle: 'PRLV SEPA DGFIP TVA' },
          { compte: '445510', sens: 'debit', montant: 79, libelle: 'PRLV SEPA DGFIP TVA' },
        ],
      },
    }])
    await waitFor(() => expect(screen.queryByText('Paiements de TVA à réécrire')).toBeNull())
  })

  it('un paiement dont la déclaration n’a pas été lue ne se réécrit pas, et le bouton le dit', async () => {
    poser({ declarations_tva: [], lignes_bancaires: [prelevement()], ecritures_brouillon: paiement(70) })
    monter(true)
    const bouton = await screen.findByRole('button', { name: 'Réécrire' })
    expect(bouton.hasAttribute('disabled')).toBe(true)
    expect(bouton.getAttribute('title')).toBe('La déclaration que ce mouvement paie ne figure pas parmi les déclarations lues.')
  })

  it("trois clics rapprochés ne réécrivent qu'une fois", async () => {
    poser({ declarations_tva: [declarationTva()], ecritures_brouillon: liquidation(80) })
    monter(true)
    const bouton = await screen.findByRole('button', { name: 'Réécrire' })
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(faux.rpcs).toHaveLength(1)
  })

  // Le verrou se relâche APRÈS la relecture : relâché avant, la liquidation qu'on vient de réécrire se proposerait encore
  // le temps que la relecture revienne, et un second clic la réécrirait une seconde fois.
  it('le verrou tient pendant la relecture qui suit une réécriture', async () => {
    poser({ declarations_tva: [declarationTva()], lignes_bancaires: [prelevement()], ecritures_brouillon: [...liquidation(80), ...paiement(70)] })
    monter(true)
    const [liquider, payer] = await screen.findAllByRole('button', { name: 'Réécrire' })
    faux.retenirApresRpc = true
    await act(async () => { liquider.click() })
    await act(async () => { payer.click() })
    // Le second geste a pris l'état de l'écran : le premier bouton paraît de nouveau libre, son verrou ne l'est pas.
    await waitFor(() => expect(liquider.hasAttribute('disabled')).toBe(false))
    await act(async () => { liquider.click() })
    expect(faux.rpcs.map((r) => r.nom)).toEqual(['ecrire_liquidation_tva', 'rapprocher_declaration_tva'])

    await act(async () => { faux.relacher?.() })
    await waitFor(() => expect(screen.queryByText('Liquidations de TVA à réécrire')).toBeNull())
    expect(screen.queryByText('Paiements de TVA à réécrire')).toBeNull()
  })

  it('dit une réécriture que la base refuse, et garde la liquidation à réécrire', async () => {
    poser({ declarations_tva: [declarationTva()], ecritures_brouillon: liquidation(80) })
    faux.erreurRpc = 'refus simulé'
    monter(true)
    // Cherché HORS de l'`act` : dedans, React retient les mises à jour jusqu'à la sortie, et la recherche expirerait.
    const bouton = await screen.findByRole('button', { name: 'Réécrire' })
    await act(async () => { bouton.click() })
    expect(await screen.findByText('refus simulé')).toBeTruthy()
    expect(screen.getByText('Liquidations de TVA à réécrire')).toBeTruthy()
  })

  // La base refuse de réécrire une écriture validée : rien ne se propose d'un exercice validé.
  it('ne propose rien d’un exercice validé', async () => {
    poser({
      declarations_tva: [declarationTva()], lignes_bancaires: [prelevement()],
      ecritures_brouillon: [...liquidation(80), ...paiement(70)].map((e) => ({ ...e, statut: 'validee' })),
    })
    monter(true, TRESORERIE, 2025, [2025])
    await screen.findByText(/0 écriture proposée — 6 validées/)
    expect(screen.queryByText('Liquidations de TVA à réécrire')).toBeNull()
    expect(screen.queryByText('Paiements de TVA à réécrire')).toBeNull()
  })
})

// LIGNE 26.6, ÉTAPE B : la dotation aux amortissements s'écrit sans pièce ni mouvement, au 31 décembre,
// depuis l'onglet Immobilisations. Ce que ce bloc garde et qu'aucun test de `src/lib` ne peut voir : que
// l'onglet ne crie pas à la rupture sur elle, qu'il la porte au FEC au journal des opérations diverses, et
// que sa piste d'audit retrouve la facture d'un bien acheté UN AUTRE exercice — elle se cherchait parmi les
// pièces de l'exercice exporté, et manquait donc à chaque dotation après la première.
describe('EcrituresTab — les dotations aux amortissements', () => {
  const FACTURE = piece({
    id: 'p-ordi', nom_fichier: 'facture-ordinateur.pdf', date_piece: '2025-07-01', montant_ttc: 1200, storage_hash: 'f'.repeat(64),
    tiers: 'BOULANGER',
  })
  const BIEN = {
    id: 'i1', dossier_id: 'dossier-de-test', piece_id: 'p-ordi', nature_id: 'n1', libelle: 'Ordinateur', valeur: 1200,
    date_acquisition: '2025-07-01', date_mise_en_service: null, duree_annees: 3, created_at: '2025-07-02T09:00:00Z',
  }
  const DOTATION_2026 = [
    ecriture({ id: 'd1', piece_id: null, immobilisation_id: 'i1', date: '2026-12-31', compte: '681100', sens: 'debit', montant: 400, libelle: 'Dotation 2026 — Ordinateur' }),
    ecriture({ id: 'd2', piece_id: null, immobilisation_id: 'i1', date: '2026-12-31', compte: '281830', sens: 'credit', montant: 400, libelle: 'Dotation 2026 — Ordinateur' }),
  ]

  it('ne crie pas à la rupture, et porte la dotation au FEC, au journal des opérations diverses', async () => {
    poser({ pieces: [FACTURE], immobilisations: [BIEN], ecritures_brouillon: DOTATION_2026 })
    monter(false, TRESORERIE, 2026)
    await screen.findByText(/2 écritures proposées/)
    expect(screen.queryByText("Piste d'audit rompue")).toBeNull()
    expect(screen.queryByText(/pas dans ce FEC/)).toBeNull()

    await act(async () => { screen.getByRole('button', { name: /Exporter FEC/ }).click() })
    const lignes = telecharge.fichiers[0].contenu.split('\r\n').map((l) => l.split('\t')).slice(1)
    expect(lignes.map((l) => [l[0], l[2], l[8], l[9]])).toEqual([
      ['OD', 'OD00001', "Tableau d'amortissement 2026", '20261231'],
      ['OD', 'OD00001', "Tableau d'amortissement 2026", '20261231'],
    ])
  })

  it('le garde symétrique : la même écriture sans son bien est une rupture, et sort du FEC', async () => {
    poser({ pieces: [FACTURE], immobilisations: [BIEN], ecritures_brouillon: DOTATION_2026.map((e) => ({ ...e, immobilisation_id: null })) })
    monter(false, TRESORERIE, 2026)
    expect(await screen.findByText("Piste d'audit rompue")).toBeTruthy()
    expect(screen.getByText(/2 écritures ne seront pas dans ce FEC/)).toBeTruthy()
  })

  it('retrouve la facture d’un bien acheté un autre exercice dans la piste d’audit', async () => {
    poser({ pieces: [FACTURE], immobilisations: [BIEN], ecritures_brouillon: DOTATION_2026 })
    monter(false, TRESORERIE, 2026)
    await screen.findByText(/2 écritures proposées/)
    await act(async () => { screen.getByRole('button', { name: /Exporter la piste d'audit/ }).click() })
    const csv = telecharge.fichiers.find((f) => f.nom.startsWith('piste-audit'))!.contenu
    expect(csv).toMatch(/Tableau d'amortissement : Ordinateur — facture facture-ordinateur\.pdf;f{64}/)
    expect(csv).not.toMatch(/hors du jeu chargé/)
  })
})

// LIGNE 26.6, ÉTAPE B : le forfait kilométrique s'écrit sans pièce ni mouvement, au 31 décembre, depuis la
// carte Véhicules (onglet Informations). Ce que ce bloc garde et qu'aucun test de `src/lib` ne peut voir : que
// l'onglet ne crie pas à la rupture sur lui, qu'il le porte au FEC au journal des opérations diverses, et que
// l'export de la piste d'audit lise les lignes du cadre 7 — elles seules nomment le véhicule et le kilométrage
// que le barème justifie — et se refuse quand il ne les a lues qu'en partie.
describe('EcrituresTab — les forfaits kilométriques', () => {
  const VEHICULE = {
    id: 've1', dossier_id: 'dossier-de-test', annee: 2025, modele: 'Peugeot 308', type: 'voiture', puissance_fiscale: 5,
    motorisation: 'thermique', carburant: 'diesel', km_professionnel: 12000, created_at: '2025-01-05T09:00:00Z',
  }
  // 12 000 km × 0,357 + 1 395 € : le barème 2025 d'une voiture de 5 CV.
  const FORFAIT_2025 = [
    ecriture({ id: 'k1', piece_id: null, vehicule_id: 've1', declaration_tva_id: null, date: '2025-12-31', compte: '625110', sens: 'debit', montant: 5679, libelle: 'Indemnités kilométriques 2025 — Peugeot 308' }),
    ecriture({ id: 'k2', piece_id: null, vehicule_id: 've1', declaration_tva_id: null, date: '2025-12-31', compte: '108000', sens: 'credit', montant: 5679, libelle: 'Indemnités kilométriques 2025 — Peugeot 308' }),
  ]

  it('ne crie pas à la rupture, et porte le forfait au FEC, au journal des opérations diverses', async () => {
    poser({ vehicules: [VEHICULE], ecritures_brouillon: FORFAIT_2025 })
    monter()
    await screen.findByText(/2 écritures proposées/)
    expect(screen.queryByText("Piste d'audit rompue")).toBeNull()
    expect(screen.queryByText(/pas dans ce FEC/)).toBeNull()

    await act(async () => { screen.getByRole('button', { name: /Exporter FEC/ }).click() })
    const lignes = telecharge.fichiers[0].contenu.split('\r\n').map((l) => l.split('\t')).slice(1)
    expect(lignes.map((l) => [l[0], l[2], l[4], l[8], l[9]])).toEqual([
      ['OD', 'OD00001', '625110', 'Barème kilométrique 2025', '20251231'],
      ['OD', 'OD00001', '108000', 'Barème kilométrique 2025', '20251231'],
    ])
  })

  it('le garde symétrique : la même écriture sans son véhicule est une rupture, et sort du FEC', async () => {
    poser({ vehicules: [VEHICULE], ecritures_brouillon: FORFAIT_2025.map((e) => ({ ...e, vehicule_id: null, declaration_tva_id: null })) })
    monter()
    expect(await screen.findByText("Piste d'audit rompue")).toBeTruthy()
    expect(screen.getByText(/2 écritures ne seront pas dans ce FEC/)).toBeTruthy()
  })

  it('nomme le véhicule et son kilométrage dans la piste d’audit', async () => {
    poser({ vehicules: [VEHICULE], ecritures_brouillon: FORFAIT_2025 })
    monter()
    await screen.findByText(/2 écritures proposées/)
    await act(async () => { screen.getByRole('button', { name: /Exporter la piste d'audit/ }).click() })
    const csv = telecharge.fichiers.find((f) => f.nom.startsWith('piste-audit'))!.contenu
    expect(csv).toMatch(/Barème kilométrique 2025 : Peugeot 308, 12\s000 km professionnels/)
    expect(csv).not.toMatch(/hors du jeu chargé/)
  })

  it('refuse l’export de la piste sur une lecture partielle des véhicules, et le dit', async () => {
    poser({ vehicules: [VEHICULE, { ...VEHICULE, id: 've2', modele: 'Clio' }], ecritures_brouillon: FORFAIT_2025 })
    faux.muetParTable = { vehicules: 1 }
    monter()
    await screen.findByText(/2 écritures proposées/)
    await act(async () => { screen.getByRole('button', { name: /Exporter la piste d'audit/ }).click() })
    expect(telecharge.fichiers.filter((f) => f.nom.startsWith('piste-audit'))).toHaveLength(0)
    expect(await screen.findByText(/Les véhicules du cadre 7 n'ont pas pu être lus en entier/)).toBeTruthy()
    // Le FEC, lui, ne dépend pas des véhicules : il part.
    await act(async () => { screen.getByRole('button', { name: /Exporter FEC/ }).click() })
    expect(telecharge.fichiers.map((f) => f.nom)).toEqual(['123456789FEC20251231.txt'])
  })
})
