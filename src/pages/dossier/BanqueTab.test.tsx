import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContexteDossier } from '../../test/exercicesValides'
import BanqueTab from './BanqueTab'
import { EmplacementPanneauDroit, FournisseurPanneauDroit } from '../../components/PanneauDroit'
import type {
  Categorie, CotisationDeclaree, EcritureBrouillon, LettrageManuel, LigneBancaire, Piece, RegleAffectationBancaire, RegleBancaireIgnoree,
  ReglementGroupe, VentilationBancaire,
} from '../../lib/types'
import type { ModeleComptable } from '../../lib/engagement'
import type { Emprunt } from '../../lib/emprunts'
import type { Predicat } from '../../test/filtresPostgrest'
import { NON_VALIDEE } from '../../test/ecritures'

// « Tout rapprocher automatiquement » n'avait AUCUN verrou en `useRef`, contrairement à son voisin
// `validerEtRapprocherLot` juste au-dessus dans le fichier : il ne se désactivait que via
// `rapprochementAuto`, un ÉTAT React qui ne prend effet qu'au rendu suivant. Un double clic partait
// donc deux fois dans le même lot — même défaut que VehiculesCard, ImportDossierModal et « C'est une
// facture » (DocumentsTab), retrouvé ici en écrivant le test plutôt qu'en relisant le code.
const faux = vi.hoisted(() => ({
  lignes: [] as LigneBancaire[],
  pieces: [] as unknown[],
  updatesLignes: [] as Record<string, unknown>[],
  // La promesse de la première mise à jour de ligne bancaire est gardée en attente : c'est la
  // fenêtre réelle pendant laquelle un second clic arrive. La résoudre tout de suite supprimerait
  // la fenêtre même que le verrou est censé fermer.
  resoudreUpdateLigne: null as null | (() => void),
  // La lecture des relevés déjà classés dans Documents, refusée à la demande.
  erreurReleves: null as string | null,
  // Mises à jour de ligne appliquées tout de suite, pour les tests qui ne regardent pas la fenêtre
  // d'attente — ou refusées, pour ceux qui regardent ce que l'écran fait d'un échec.
  majImmediate: false,
  erreurMajLigne: null as string | null,
  // La RELECTURE du relevé retenue à la demande : c'est la fenêtre pendant laquelle le panneau montre
  // encore l'état d'avant, et que le verrou doit couvrir.
  retenirLectureLignes: false,
  resoudreLectureLignes: null as null | (() => void),
  updatesPieces: [] as Record<string, unknown>[],
  insertions: [] as { table: string; valeur: Record<string, unknown> }[],
  // Le serveur qui cesse de rendre au-delà de N lignes d'une table tout en annonçant le vrai total :
  // la panne qui produit une lecture INCOMPLÈTE (voir lib/lectureComplete.ts). Par table, parce que
  // chaque lot ne regarde pas les mêmes lectures.
  muet: {} as Record<string, number>,
  // Ce que « lit » le faux pdf.js : des lignes de texte avec l'abscisse de leur montant.
  lignesPdf: [] as { texte: string; xFin: number }[],
  // Les lignes d'écriture de la pièce, que la contrepartie banque lit avant d'écrire ; vides, elle
  // renonce (rien à compléter). Et les dates qu'elle réécrit, avec leurs filtres.
  ecritures: [] as { id: string; compte: string; ligne_bancaire_id?: string | null }[],
  updatesEcritures: [] as { valeur: Record<string, unknown>; filtres: string[] }[],
  // Les suppressions d'écritures, avec leurs filtres : c'est ce qui dit QUELLES lignes l'annulation
  // d'un rapprochement retire.
  suppressionsEcritures: [] as string[][],
  // L'insertion d'une écriture refusée par la base : c'est ce qui fait dire à l'écran que l'écriture
  // de la banque n'a pas pu être créée.
  erreurInsertionEcritures: null as string | null,
  // Les catégories du dossier (ligne 26.6), et les appels aux fonctions SQL de l'affectation — que le
  // faux serveur APPLIQUE au relevé, pour que la relecture montre le mouvement dans son nouvel état.
  categories: [] as Categorie[],
  rpcs: [] as { nom: string; args: Record<string, unknown> }[],
  erreurRpc: null as string | null,
  // Les règles d'affectation, ce que l'écran en écrit (`upsert`) et en retire (`delete`) — et le refus
  // de l'un ou l'autre à la demande.
  reglesAffectation: [] as RegleAffectationBancaire[],
  upserts: [] as { table: string; valeur: Record<string, unknown>; options: unknown }[],
  suppressionsRegles: [] as string[][],
  erreurUpsert: null as string | null,
  erreurSuppressionRegle: null as string | null,
  // Le lot refusé au N-ième envoi (1 pour le premier) : ce qui dit ce que l'écran annonce d'un refus au
  // milieu d'un lot découpé en envois.
  refusAuEnvoi: null as number | null,
  // Les échéances de cotisation : un justificatif possible pour le lot des règles, et une lecture qui
  // peut être partielle comme les autres.
  cotisations: [] as CotisationDeclaree[],
  // Les emprunts du dossier (lib/echeanceEmprunt.ts) : une lecture qui peut être partielle, et deux
  // fonctions SQL que le faux serveur APPLIQUE au relevé.
  emprunts: [] as Emprunt[],
  // Les parts des mouvements ventilés (lib/ventilationBanque.ts) : une lecture qui peut être partielle, et
  // deux fonctions SQL que le faux serveur APPLIQUE au relevé et à ses parts.
  ventilations: [] as VentilationBancaire[],
  // Les parts des virements qui règlent plusieurs pièces (lib/reglementGroupe.ts) : une lecture qui peut être
  // partielle, et deux fonctions SQL que le faux serveur APPLIQUE au relevé et à ses parts.
  reglements: [] as ReglementGroupe[],
  // La connexion bancaire de la carte (ConnexionBancaireCard) : aucune par défaut. Les tests de CÂBLAGE la
  // programment — la connexion que rend `statut`, et ce que rend la récupération.
  connexionBancaire: null as null | { connexion: Record<string, unknown>; recuperation: Record<string, unknown> },
  // Les règles « toujours ignorer » du dossier : elles décident du statut ÉCRIT à l'import d'un mouvement.
  reglesIgnorees: [] as RegleBancaireIgnoree[],
  // Les écritures VALIDÉES et les biens que lit `lirePiecesFigees` : ce qu'un exercice validé a figé. Servies à part
  // des écritures que la contrepartie banque relit, sur le filtre que la lecture pose (`statut=validee`).
  ecrituresValidees: [] as { id: string; statut: string; date: string; piece_id: string | null; immobilisation_id: string | null }[],
  immobilisations: [] as { id: string; piece_id: string | null }[],
  // Les lettrages faits à la main (lib/lettragesLecture.ts), et le brouillon que leur lecture relit — servi FILTRÉ comme
  // la requête le demande, comptes de tiers seulement : un faux qui rendrait tout ne verrait pas une liste de comptes
  // amputée.
  lettrages: [] as LettrageManuel[],
  brouillon: [] as EcritureBrouillon[],
}))

// BanqueTab importe aussi lib/pdfText (import de relevé PDF), qui charge pdf.js — celui-ci touche au
// DOM dès l'import (voir CLAUDE.md, « Même règle pour les dépendances navigateur ») et lève sous
// jsdom faute de `DOMMatrix`. Aucune fonctionnalité PDF n'est exercée par ce test : le module est
// donc remplacé, exactement comme `lib/supabase` l'est ci-dessous pour ce qui parle à la base.
vi.mock('../../lib/pdfText', () => ({ extractPdfLignes: async () => faux.lignesPdf }))

vi.mock('../../lib/supabase', async () => {
  const { filtrer, predicatEq, predicatIn, predicatNot, predicatOr } = await import('../../test/filtresPostgrest')
  function chaine(table: string) {
    let operation = 'select'
    let idFiltre: unknown = null
    let valeurMaj: Record<string, unknown> = {}
    let valeurUpsert: Record<string, unknown>[] = []
    const filtres: string[] = []
    // Les filtres APPLIQUÉS aux catégories (voir src/test/filtresPostgrest.ts) : lues sur le seul
    // dossier au lieu du dossier ET du cabinet, elles disparaissent toutes en production — aucune n'y
    // appartient à un dossier —, et un faux qui ignorait les deux filtres ne pouvait pas le voir.
    const predicats: Predicat[] = []
    // Une lecture du brouillon restreinte à des COMPTES : celle des lettrages faits à la main, servie par `faux.brouillon`.
    let surDesComptes = false
    let debut = 0
    let fin = Number.MAX_SAFE_INTEGER
    const c: Record<string, unknown> = {}
    Object.assign(c, {
      select: () => c,
      eq: (colonne: string, valeur: unknown) => {
        if (colonne === 'id') idFiltre = valeur
        filtres.push(`${colonne}=${valeur}`)
        predicats.push(predicatEq(colonne, valeur))
        return c
      },
      neq: (colonne: string, valeur: unknown) => { filtres.push(`${colonne}!=${valeur}`); return c },
      not: (colonne: string, operateur: string, valeur: unknown) => { predicats.push(predicatNot(colonne, operateur, valeur)); return c },
      or: (expression: string) => { predicats.push(predicatOr(expression)); return c },
      order: () => c,
      in: (colonne: string, valeurs: unknown[]) => {
        if (colonne === 'compte') surDesComptes = true
        predicats.push(predicatIn(colonne, valeurs))
        return c
      },
      delete: () => { operation = 'delete'; return c },
      update: (valeur: Record<string, unknown>) => {
        operation = 'update'
        valeurMaj = valeur
        if (table === 'lignes_bancaires') faux.updatesLignes.push(valeur)
        if (table === 'pieces') faux.updatesPieces.push(valeur)
        if (table === 'ecritures_brouillon') faux.updatesEcritures.push({ valeur, filtres })
        return c
      },
      insert: (valeur: Record<string, unknown>) => {
        operation = 'insert'
        faux.insertions.push({ table, valeur })
        return c
      },
      upsert: (valeur: Record<string, unknown>, options: unknown) => {
        operation = 'upsert'
        valeurUpsert = Array.isArray(valeur) ? valeur : [valeur]
        faux.upserts.push({ table, valeur, options })
        return c
      },
      range: (d: number, f: number) => { debut = d; fin = f; return c },
      then: (suite: (r: unknown) => unknown) => {
        const muet = faux.muet[table]
        if (operation === 'select' && muet != null) {
          const toutes = table === 'lignes_bancaires' ? faux.lignes : table === 'pieces' ? faux.pieces
            : table === 'categories' ? filtrer(faux.categories, predicats)
              : table === 'regles_affectation_bancaire' ? filtrer(faux.reglesAffectation, predicats)
                : table === 'cotisations_declarees' ? faux.cotisations
                  : table === 'emprunts' ? faux.emprunts
                    : table === 'ventilations_bancaires' ? faux.ventilations
                      : table === 'reglements_groupes' ? faux.reglements
                        : table === 'regles_bancaires_ignorees' ? faux.reglesIgnorees
                          : table === 'immobilisations' ? faux.immobilisations
                            : table === 'lettrages_manuels' ? filtrer(faux.lettrages, predicats)
                              : table === 'ecritures_brouillon' && surDesComptes ? filtrer(faux.brouillon, predicats) : []
          const rendu = toutes.slice(debut, Math.min(fin + 1, muet))
          return Promise.resolve({ data: rendu, error: null, count: toutes.length }).then(suite)
        }
        if (table === 'lignes_bancaires' && operation === 'update' && faux.erreurMajLigne) {
          return Promise.resolve({ data: null, error: { message: faux.erreurMajLigne } }).then(suite)
        }
        if (table === 'lignes_bancaires' && operation === 'update' && faux.majImmediate) {
          faux.lignes = faux.lignes.map((l) => (l.id === idFiltre ? { ...l, ...valeurMaj } as LigneBancaire : l))
          return Promise.resolve({ data: null, error: null }).then(suite)
        }
        if (table === 'lignes_bancaires' && operation === 'update') {
          // La mise à jour reste en attente jusqu'à `resoudreUpdateLigne` : c'est la fenêtre
          // réseau réelle pendant laquelle un second clic arriverait. Une fois « résolue », elle
          // applique réellement la valeur — sinon le rechargement suivant verrait une ligne encore
          // "non_rapprochee" et le bouton réapparaîtrait à tort.
          return new Promise((resoudre) => {
            faux.resoudreUpdateLigne = () => {
              // `as` ici seulement : on simule le serveur qui applique un `update` partiel. La FABRIQUE,
              // elle, reste typée sans `as` — c'est là que le compilateur doit mordre.
              faux.lignes = faux.lignes.map((l) => (l.id === idFiltre ? { ...l, ...valeurMaj } as LigneBancaire : l))
              resoudre({ data: null, error: null })
            }
          }).then(suite)
        }
        if (table === 'lignes_bancaires' && operation === 'select' && faux.retenirLectureLignes) {
          faux.retenirLectureLignes = false
          return new Promise((resoudre) => {
            faux.resoudreLectureLignes = () => resoudre({ data: faux.lignes, error: null, count: faux.lignes.length })
          }).then(suite)
        }
        if (table === 'lignes_bancaires' && operation === 'upsert') {
          // L'import de la connexion bancaire : le faux serveur ÉCRIT les lignes et rend celles qu'il a
          // écrites, comme `ignoreDuplicates` — un identifiant externe déjà présent n'est ni réécrit ni rendu.
          const deja = new Set(faux.lignes.map((l) => l.id_externe))
          const ecrites = valeurUpsert.filter((l) => !deja.has(String(l.id_externe)))
          faux.lignes = [...faux.lignes, ...ecrites.map((l, i): LigneBancaire => ({
            id: `importee-${faux.lignes.length + i}`, dossier_id: String(l.dossier_id), date: String(l.date),
            libelle: String(l.libelle), montant: Number(l.montant), statut: l.statut as LigneBancaire['statut'],
            piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false,
            source_fichier: String(l.source_fichier), libelle_brut: null, emprunt_id: null, emprunt_echeance: null,
            emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false, id_externe: String(l.id_externe),
            created_at: '2025-06-20T09:00:00Z',
          }))]
          return Promise.resolve({ data: ecrites.map((l) => ({ id_externe: l.id_externe })), error: null }).then(suite)
        }
        if (table === 'lignes_bancaires') {
          return Promise.resolve({ data: faux.lignes, error: null, count: faux.lignes.length }).then(suite)
        }
        if (table === 'regles_bancaires_ignorees') {
          return Promise.resolve({ data: faux.reglesIgnorees, error: null, count: faux.reglesIgnorees.length }).then(suite)
        }
        if (table === 'ecritures_brouillon' && operation === 'select' && filtres.includes('statut=validee')) {
          return Promise.resolve({ data: faux.ecrituresValidees, error: null, count: faux.ecrituresValidees.length }).then(suite)
        }
        if (table === 'immobilisations') {
          return Promise.resolve({ data: faux.immobilisations, error: null, count: faux.immobilisations.length }).then(suite)
        }
        if (table === 'lettrages_manuels') {
          const lus = filtrer(faux.lettrages, predicats)
          return Promise.resolve({ data: lus, error: null, count: lus.length }).then(suite)
        }
        if (table === 'ecritures_brouillon' && operation === 'select' && surDesComptes) {
          const lues = filtrer(faux.brouillon, predicats)
          return Promise.resolve({ data: lues, error: null, count: lues.length }).then(suite)
        }
        if (table === 'ecritures_brouillon') {
          if (operation === 'delete') faux.suppressionsEcritures.push([...filtres])
          return Promise.resolve(operation === 'select'
            ? { data: faux.ecritures, error: null, count: faux.ecritures.length }
            : operation === 'insert' && faux.erreurInsertionEcritures
              ? { data: null, error: { message: faux.erreurInsertionEcritures } }
              : { data: null, error: null }).then(suite)
        }
        if (table === 'regles_affectation_bancaire') {
          if (operation === 'upsert') {
            return Promise.resolve(faux.erreurUpsert ? { data: null, error: { message: faux.erreurUpsert } } : { data: null, error: null }).then(suite)
          }
          if (operation === 'delete') {
            faux.suppressionsRegles.push([...filtres])
            if (faux.erreurSuppressionRegle) return Promise.resolve({ data: null, error: { message: faux.erreurSuppressionRegle } }).then(suite)
            faux.reglesAffectation = faux.reglesAffectation.filter((r) => r.id !== idFiltre)
            return Promise.resolve({ data: null, error: null }).then(suite)
          }
          const lues = filtrer(faux.reglesAffectation, predicats)
          return Promise.resolve({ data: lues, error: null, count: lues.length }).then(suite)
        }
        if (table === 'cotisations_declarees') {
          return Promise.resolve({ data: faux.cotisations, error: null, count: faux.cotisations.length }).then(suite)
        }
        if (table === 'emprunts') {
          return Promise.resolve({ data: faux.emprunts, error: null, count: faux.emprunts.length }).then(suite)
        }
        if (table === 'ventilations_bancaires') {
          return Promise.resolve({ data: faux.ventilations, error: null, count: faux.ventilations.length }).then(suite)
        }
        if (table === 'reglements_groupes') {
          return Promise.resolve({ data: faux.reglements, error: null, count: faux.reglements.length }).then(suite)
        }
        if (table === 'categories') {
          const lues = filtrer(faux.categories, predicats)
          return Promise.resolve({ data: lues, error: null, count: lues.length }).then(suite)
        }
        if (table === 'documents_divers' && faux.erreurReleves) {
          return Promise.resolve({ data: null, error: { message: faux.erreurReleves }, count: null }).then(suite)
        }
        if (table === 'pieces') {
          // Le `count` est OBLIGATOIRE ici : sans total annoncé, `lireTout` déclare la lecture
          // INCOMPLÈTE (voir lib/lectureComplete.ts) et l'écran bascule sur son bandeau de lecture
          // partielle. Les tests d'avant passaient dans cet état dégradé — donc pour une raison qui
          // n'était pas celle qu'ils annonçaient. C'est le coût récurrent de `lireTout`, et il se
          // paie une fois par faux client.
          return Promise.resolve({ data: faux.pieces, error: null, count: faux.pieces.length }).then(suite)
        }
        // regles_bancaires_ignorees, controles_releves_bancaires,
        // ecritures_brouillon (lu avant contrepartie — vide fait renoncer à l'insertion, ce qui
        // évite d'avoir à modéliser aussi cette écriture ici) : rien de tout ça n'intervient dans
        // ce que ce test vérifie.
        return Promise.resolve({ data: [], error: null, count: 0 }).then(suite)
      },
    })
    return c
  }
  // Les deux fonctions SQL de l'affectation : le faux serveur refuse à la demande, sinon il applique au
  // relevé ce que la vraie fonction écrit — la catégorie et le statut, l'écriture n'étant pas relue ici.
  function rpc(nom: string, args: Record<string, unknown>) {
    faux.rpcs.push({ nom, args })
    if (faux.erreurRpc) return Promise.resolve({ data: null, error: { message: faux.erreurRpc } })
    if (nom === 'affecter_mouvements_bancaires') {
      const envoi = args.p_affectations as { ligne_bancaire_id: string; categorie_id: string; taux_tva: number | null }[]
      const rang = faux.rpcs.filter((r) => r.nom === nom).length
      if (faux.refusAuEnvoi === rang) {
        return Promise.resolve({ data: null, error: { message: 'Le mouvement du 02/06/2025 (-100,00 €) n\'est plus à traiter : il a changé depuis l\'affichage.' } })
      }
      faux.lignes = faux.lignes.map((l): LigneBancaire => {
        const a = envoi.find((x) => x.ligne_bancaire_id === l.id)
        return a ? { ...l, categorie_id: a.categorie_id, taux_tva: a.taux_tva, statut: 'rapprochee' } : l
      })
      return Promise.resolve({ data: envoi.length, error: null })
    }
    const id = args.p_ligne_bancaire_id
    // La ventilation (lib/ventilationBanque.ts) : les parts remplacent celles du mouvement, ou partent avec
    // la ventilation — l'écriture n'étant pas relue ici.
    if (nom === 'ventiler_mouvement_bancaire') {
      const parts = args.p_parts as { categorie_id: string | null; part_personnelle: boolean; montant: number; taux_tva: number | null }[]
      faux.ventilations = [
        ...faux.ventilations.filter((v) => v.ligne_bancaire_id !== id),
        ...parts.map((part, i): VentilationBancaire => ({
          id: `part-${String(id)}-${i}`, dossier_id: 'dossier-de-test', ligne_bancaire_id: String(id),
          categorie_id: part.categorie_id, part_personnelle: part.part_personnelle, montant: part.montant, taux_tva: part.taux_tva,
          created_at: '2025-06-02T10:00:00Z',
        })),
      ]
    }
    if (nom === 'retirer_ventilation_mouvement_bancaire') faux.ventilations = faux.ventilations.filter((v) => v.ligne_bancaire_id !== id)
    // Le règlement de plusieurs pièces (lib/reglementGroupe.ts) : les parts remplacent celles du mouvement, ou
    // partent avec le règlement — les écritures n'étant pas relues ici.
    if (nom === 'regler_pieces_par_mouvement') {
      const parts = args.p_parts as { piece_id: string; montant: number }[]
      faux.reglements = [
        ...faux.reglements.filter((r) => r.ligne_bancaire_id !== id),
        ...parts.map((part, i): ReglementGroupe => ({
          id: `groupe-${String(id)}-${i}`, dossier_id: 'dossier-de-test', ligne_bancaire_id: String(id),
          piece_id: part.piece_id, montant: part.montant, created_at: '2025-06-02T10:00:00Z',
        })),
      ]
    }
    if (nom === 'retirer_reglement_groupe') faux.reglements = faux.reglements.filter((r) => r.ligne_bancaire_id !== id)
    faux.lignes = faux.lignes.map((l): LigneBancaire => {
      if (l.id !== id) return l
      // Le virement personnel (lib/virementPersonnel.ts) : classé et écrit, ou remis à traiter et
      // retiré — l'écriture n'étant pas relue ici non plus.
      if (nom === 'classer_virement_personnel') return { ...l, statut: 'ignoree', prelevement_personnel: true }
      if (nom === 'retirer_virement_personnel') return { ...l, statut: 'non_rapprochee', prelevement_personnel: false }
      // L'échéance d'emprunt (lib/echeanceEmprunt.ts) : rapprochée avec son découpage, ou retirée.
      if (nom === 'rapprocher_echeance_emprunt') {
        return {
          ...l, statut: 'rapprochee', emprunt_id: String(args.p_emprunt_id), emprunt_echeance: args.p_echeance as number | null,
          emprunt_interets: Number(args.p_interets), emprunt_assurance: Number(args.p_assurance),
        }
      }
      if (nom === 'retirer_echeance_emprunt') {
        return { ...l, statut: 'non_rapprochee', emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null }
      }
      if (nom === 'ventiler_mouvement_bancaire') return { ...l, statut: 'rapprochee', ventilee: true, id_externe: null }
      if (nom === 'retirer_ventilation_mouvement_bancaire') return { ...l, statut: 'non_rapprochee', ventilee: false, id_externe: null }
      if (nom === 'regler_pieces_par_mouvement') return { ...l, statut: 'rapprochee', reglement_groupe: true }
      if (nom === 'retirer_reglement_groupe') return { ...l, statut: 'non_rapprochee', reglement_groupe: false }
      // L'échéance de cotisation (lib/cotisationRapprochee.ts) : rapprochée avec son écriture, ou retirée.
      if (nom === 'rapprocher_cotisation') return { ...l, statut: 'rapprochee', cotisation_id: String(args.p_cotisation_id) }
      if (nom === 'retirer_rapprochement_cotisation') return { ...l, statut: 'non_rapprochee', cotisation_id: null }
      return nom === 'affecter_mouvement_bancaire'
        ? { ...l, categorie_id: String(args.p_categorie_id), taux_tva: (args.p_taux_tva as number | null | undefined) ?? null, statut: 'rapprochee' }
        : { ...l, categorie_id: null, taux_tva: null, statut: 'non_rapprochee' }
    })
    return Promise.resolve({ data: 2, error: null })
  }
  // La carte de connexion bancaire (ConnexionBancaireCard) lit l'état de la connexion à l'ouverture :
  // aucune par défaut, et rien de configuré — la carte a ses propres tests. Les tests de CÂBLAGE programment
  // une connexion et sa récupération. Toute autre action serait un appel au prestataire que ces tests n'ont
  // pas prévu, et se nomme.
  const functions = {
    invoke: (nom: string, options: { body: { action?: unknown } }) => {
      const action = options.body.action
      if (nom === 'banque-connexion' && action === 'statut') {
        return Promise.resolve({
          data: { configuree: faux.connexionBancaire !== null, connexion: faux.connexionBancaire?.connexion ?? null }, error: null,
        })
      }
      if (nom === 'banque-connexion' && action === 'mouvements' && faux.connexionBancaire) {
        return Promise.resolve({ data: faux.connexionBancaire.recuperation, error: null })
      }
      throw new Error(`Appel de fonction non attendu dans ce test : ${nom} ${String(action)}`)
    },
  }
  return { supabase: { from: (table: string) => chaine(table), rpc, functions } }
})

// TYPÉ, et sans `as`, comme `pieceDeTest` juste en dessous : le compilateur confronte alors chaque
// champ à `LigneBancaire`, donc à la table. Il a sorti `created_at`, absent depuis toujours de ce
// jeu d'essai — même remède que les cinq colonnes manquantes du `piece()` de PiecesTab.
function ligneDeTest(o: Partial<LigneBancaire> = {}): LigneBancaire {
  return {
    id: 'ligne-1', dossier_id: 'dossier-de-test', date: '2025-06-02', montant: -100,
    libelle: 'PRLV SEPA FOURNISSEUR', libelle_brut: null, statut: 'non_rapprochee',
    piece_id: null, cotisation_id: null, categorie_id: null, taux_tva: null, prelevement_personnel: false, source_fichier: null,
    emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false, id_externe: null,
    created_at: '2025-06-02T09:00:00Z', ...o,
  }
}

// TYPÉ, et sans `as` : le compilateur vérifie alors chaque champ contre `Piece`, donc contre la
// table. Le jeu d'essai portait `devise: null`, impossible en base (NOT NULL DEFAULT 'EUR') — et ce
// n'était pas inerte ici : `reglerPieceSurBanque` sort sur `!piece.devise` AVANT son test
// `=== 'EUR'`, donc le test exerçait la branche du champ absent au lieu de celle d'une pièce en
// euros. Un jeu d'essai infidèle ne fait pas qu'affaiblir un test : il lui fait prouver autre chose.
function pieceDeTest(o: Partial<Piece> = {}): Piece {
  return {
    id: 'piece-1', dossier_id: 'dossier-de-test', uploaded_by: null, source: 'upload',
    storage_path: 'dossier/facture.pdf', nom_fichier: 'facture.pdf', storage_hash: null,
    date_piece: '2025-06-01', tiers: 'Fournisseur', montant_ht: null, montant_tva: null,
    montant_ttc: 100, devise: 'EUR', montant_devise: null, taux_change: null,
    conversion_source: null, categorie_id: null, sous_dossier_id: null, type_piece: 'achat',
    statut: 'validee', notes: null, confiance: null, superpdp_invoice_id: null,
    created_at: '2025-06-01T09:00:00Z', updated_at: '2025-06-01T09:00:00Z', ...o,
  }
}

function reinitialiser() {
  faux.lignes = [ligneDeTest()]
  faux.pieces = [pieceDeTest()]
  faux.updatesLignes = []
  faux.resoudreUpdateLigne = null
  faux.erreurReleves = null
  faux.majImmediate = false
  faux.erreurMajLigne = null
  faux.retenirLectureLignes = false
  faux.resoudreLectureLignes = null
  faux.updatesPieces = []
  faux.insertions = []
  faux.muet = {}
  faux.lignesPdf = []
  faux.ecritures = []
  faux.updatesEcritures = []
  faux.suppressionsEcritures = []
  faux.erreurInsertionEcritures = null
  faux.categories = []
  faux.rpcs = []
  faux.erreurRpc = null
  faux.reglesAffectation = []
  faux.upserts = []
  faux.suppressionsRegles = []
  faux.erreurUpsert = null
  faux.erreurSuppressionRegle = null
  faux.refusAuEnvoi = null
  faux.cotisations = []
  faux.emprunts = []
  faux.ventilations = []
  faux.reglements = []
  faux.connexionBancaire = null
  faux.reglesIgnorees = []
  faux.ecrituresValidees = []
  faux.immobilisations = []
  faux.lettrages = []
  faux.brouillon = []
}

// L'onglet dans la coque du panneau de droite, comme dans l'application : sans elle,
// `usePanneauDroit` lève (voir lib/panneauDroit.ts) — un bouton qui n'ouvrirait rien ne doit pas
// passer pour un bouton qui marche.
const TRESORERIE: ModeleComptable = { mode: 'tresorerie', compteNotesDeFrais: '455000' }
const ENGAGEMENT: ModeleComptable = { mode: 'engagement', compteNotesDeFrais: '455000' }

// `valides` : les exercices validés que la page du dossier fournit à ses onglets (DossierDetail).
function rendre(modele: ModeleComptable = TRESORERIE, assujettiTva = false, valides: readonly number[] = []) {
  return render(
    <FournisseurPanneauDroit>
      <ContexteDossier annee="toutes" valides={valides}>
        <BanqueTab dossierId="dossier-de-test" modele={modele} assujettiTva={assujettiTva} />
      </ContexteDossier>
      <EmplacementPanneauDroit />
    </FournisseurPanneauDroit>,
  )
}

const volet = () => screen.getByRole('complementary', { name: 'Panneau contextuel' })

afterEach(() => { vi.restoreAllMocks() })

describe('BanqueTab — Tout rapprocher automatiquement', () => {
  it('ne rapproche le lot qu\'une fois quand le bouton est cliqué deux fois de suite', async () => {
    reinitialiser()
    rendre()
    const bouton = await screen.findByRole('button', { name: /Tout rapprocher automatiquement \(1\)/ })

    // Les deux clics partent dans le MÊME `act` : deux `fireEvent.click` de suite ne reproduisent
    // PAS un double clic, chacun ouvre son propre `act` qui re-rend le composant avant le suivant.
    await act(async () => {
      bouton.click()
      bouton.click()
    })

    expect(faux.updatesLignes).toHaveLength(1)
    expect(faux.updatesLignes[0]).toMatchObject({ statut: 'rapprochee', piece_id: 'piece-1' })

    await act(async () => { faux.resoudreUpdateLigne?.() })
    await waitFor(() => expect(screen.queryByRole('button', { name: /Tout rapprocher automatiquement/ })).toBeNull())
  })

  // DEUX PIÈCES QUI CONVIENNENT AUSSI BIEN L'UNE QUE L'AUTRE — le cas réel de ce dossier, deux
  // dépôts du même document au même montant et à la même date. L'écran faisait
  // `piecesValidees.find(...)` : la PREMIÈRE DE LA LISTE gagnait, en masse et sur un seul clic, sans
  // que rien ne le dise. `planRapprochementAutomatique` refuse désormais, et l'écran DIT ce qu'il
  // laisse — un bouton qui annonce N en en traitant moins ne dit pas où sont passées les autres.
  //
  // Aucun test de `src/lib` ne peut voir ceci : le plan est juste, c'est son CÂBLAGE à l'écran qui
  // décide de ce qui s'écrit en base et de ce que l'opérateur lit.
  it('ne rapproche rien et le dit quand deux pièces se disputent le mouvement', async () => {
    reinitialiser()
    faux.pieces = [
      pieceDeTest({ id: 'piece-1', nom_fichier: 'mai.pdf' }),
      pieceDeTest({ id: 'piece-2', nom_fichier: 'juin.pdf' }),
    ]
    rendre()

    await screen.findByText(/plusieurs pièces ou échéances possibles/)
    expect(screen.queryByRole('button', { name: /Tout rapprocher automatiquement/ })).toBeNull()
    expect(faux.updatesLignes).toHaveLength(0)
  })

  // GARDE SYMÉTRIQUE, et elle porte tout : sans elle, « l'écran refuse l'ambiguïté » serait satisfait
  // par un écran qui n'affiche JAMAIS le bouton et crie à l'ambiguïté sur un relevé ordinaire.
  it('ne crie pas à l’ambiguïté quand une seule pièce convient', async () => {
    reinitialiser()
    rendre()

    await screen.findByRole('button', { name: /Tout rapprocher automatiquement \(1\)/ })
    expect(screen.queryByText(/plusieurs pièces ou échéances possibles/)).toBeNull()
  })
})

// UNE PASTILLE VERTE QUI SURVIT À CE QU'ELLE AFFIRMAIT. Les deux clés du côté banque
// (`piece_id`, `cotisation_id`) sont en `ON DELETE SET NULL` : supprimer la pièce ou l'échéance ne
// bloque pas, elle défait le lien en silence et `statut` reste `'rapprochee'`. L'écran affichait
// alors « Rapproché » en vert, indiscernable d'un vrai rapprochement — une pièce sans tiers rend
// exactement le même libellé nu — pendant que la Checklist, qui ne compte que les
// `non_rapprochee`, se taisait.
//
// Aucun test de `src/lib` ne peut le voir : `mouvementRapprocheSansObjet` est juste, c'est son
// CÂBLAGE à la pastille qui décide de ce que l'opérateur lit.
describe('BanqueTab — un mouvement rapproché qui ne désigne plus rien', () => {
  it("le dit au lieu d'afficher la pastille verte", async () => {
    reinitialiser()
    faux.lignes = [ligneDeTest({ statut: 'rapprochee', piece_id: null, cotisation_id: null })]
    rendre()

    // L'écran s'ouvre sur « Non rapprochés » : c'est justement ce filtre qui fait disparaître le
    // mouvement orphelin de la vue par défaut, une raison de plus pour que sa pastille dise vrai.
    await act(async () => { (await screen.findByRole('button', { name: 'Rapprochés' })).click() })

    await screen.findByText('Rapproché sans justificatif')
    expect(screen.queryAllByText(/^Rapproché$/)).toHaveLength(0)

    // LE PANNEAU EST UNE SECONDE COPIE DE LA MÊME PASTILLE, et il faut l'OUVRIR pour la voir : une
    // assertion qui reste sur la liste laisserait le panneau mentir tout seul, et la mutation qui
    // ne corrige qu'un des deux sites passerait au vert.
    await act(async () => { screen.getByText('PRLV SEPA FOURNISSEUR').click() })
    expect(screen.queryAllByText('Rapproché sans justificatif')).toHaveLength(2)
    expect(screen.queryAllByText(/^Rapproché$/)).toHaveLength(0)
  })

  // GARDE SYMÉTRIQUE : sans elle, « la pastille ne ment plus » serait satisfait par un écran qui
  // crierait au justificatif manquant sur TOUS les rapprochements, y compris les vrais.
  it('laisse la pastille verte à un rapprochement qui désigne bien une pièce', async () => {
    reinitialiser()
    faux.lignes = [ligneDeTest({ statut: 'rapprochee', piece_id: 'piece-1' })]
    rendre()

    await act(async () => { (await screen.findByRole('button', { name: 'Rapprochés' })).click() })

    await screen.findByText(/Rapproché — Fournisseur/)
    expect(screen.queryAllByText('Rapproché sans justificatif')).toHaveLength(0)

    // Le panneau dit le rapprochement par sa pastille ET par la pièce qu'il désigne.
    await act(async () => { screen.getByText('PRLV SEPA FOURNISSEUR').click() })
    expect(within(volet()).getByText('Rapproché')).toBeTruthy()
    expect(within(volet()).getByText('Rapproché avec')).toBeTruthy()
    expect(within(volet()).getByText('Fournisseur')).toBeTruthy()
    expect(screen.queryAllByText('Rapproché sans justificatif')).toHaveLength(0)
  })
})

// LA BANQUE FAIT FOI, MAIS SOUS UN SEUIL (décision du cabinet, 23/09/2026). Sous le seuil la pièce
// est ALIGNÉE au rapprochement, donc il ne reste aucun écart à montrer ; au-dessus on ne touche à
// rien — un écart large est presque toujours un paiement partiel — et c'est cette pastille qui le dit.
//
// JUGÉ SUR LE TOTAL PAYÉ DE LA PIÈCE, jamais mouvement par mouvement : la pastille d'avant comparait chaque
// mouvement à sa pièce, et criait deux fois sur une facture réglée en deux fois.
//
// Aucun test de `src/lib` ne peut voir son CÂBLAGE, qui décide de ce que l'opérateur lit. Et rien d'autre ne
// le dirait tant que les écritures ne sont pas générées : le déséquilibre n'existe qu'une fois la charge écrite.
describe('BanqueTab — une pièce payée en partie, ou de trop', () => {
  const RESTE = /Reste .*500,00.*à payer sur la pièce/

  it("affiche le reste à payer, dans la liste ET dans le panneau", async () => {
    reinitialiser()
    faux.pieces = [pieceDeTest({ montant_ttc: 1000 })]
    faux.lignes = [ligneDeTest({ statut: 'rapprochee', piece_id: 'piece-1', montant: -500 })]
    rendre()

    await act(async () => { (await screen.findByRole('button', { name: 'Rapprochés' })).click() })
    await screen.findByText(RESTE)

    // LE PANNEAU EST UNE SECONDE COPIE, et il faut l'OUVRIR : une assertion restée sur la liste
    // laisserait le panneau mentir tout seul, et la mutation qui ne corrige qu'un des deux sites
    // passerait au vert.
    await act(async () => { screen.getByText('PRLV SEPA FOURNISSEUR').click() })
    expect(screen.queryAllByText(RESTE)).toHaveLength(2)
  })

  // LE CAS QUI A FAIT RÉÉCRIRE CETTE PASTILLE : un acompte rapproché de la pièce, puis le solde réglé par la part
  // d'un virement groupé. Chacun des deux paiements s'écarte de 500 € de la pièce ; leur total la règle.
  it('se tait sur une pièce réglée en deux fois', async () => {
    reinitialiser()
    faux.pieces = [pieceDeTest({ montant_ttc: 1000 })]
    faux.lignes = [
      ligneDeTest({ id: 'ligne-1', statut: 'rapprochee', piece_id: 'piece-1', montant: -500, libelle: 'ACOMPTE' }),
      ligneDeTest({ id: 'ligne-2', statut: 'rapprochee', montant: -500, reglement_groupe: true, libelle: 'SOLDE GROUPE' }),
    ]
    faux.reglements = [{ id: 'g1', dossier_id: 'dossier-de-test', ligne_bancaire_id: 'ligne-2', piece_id: 'piece-1', montant: -500, created_at: '2025-06-02T10:00:00Z' }]
    rendre()

    await act(async () => { (await screen.findByRole('button', { name: 'Rapprochés' })).click() })
    await screen.findByText('SOLDE GROUPE')
    expect(screen.queryAllByText(/à payer sur|de trop/)).toHaveLength(0)

    await act(async () => { screen.getByText('ACOMPTE').click() })
    expect(within(volet()).queryAllByText(/à payer sur|de trop/)).toHaveLength(0)
  })

  // GARDE SYMÉTRIQUE — sans elle, « l'écran signale le reste » serait satisfait par un écran qui crie sur TOUS
  // les rapprochements, y compris les exacts et ceux que le seuil absorbe.
  it('se tait sur un paiement exact et sur un écart sous le seuil', async () => {
    reinitialiser()
    faux.pieces = [pieceDeTest({ montant_ttc: 100 }), pieceDeTest({ id: 'piece-2', montant_ttc: 100 })]
    faux.lignes = [
      ligneDeTest({ id: 'ligne-1', statut: 'rapprochee', piece_id: 'piece-1', montant: -100 }),
      ligneDeTest({ id: 'ligne-2', statut: 'rapprochee', piece_id: 'piece-2', montant: -99.97, libelle: 'PRLV AVEC ESCOMPTE' }),
    ]
    rendre()

    await act(async () => { (await screen.findByRole('button', { name: 'Rapprochés' })).click() })
    await screen.findByText('PRLV AVEC ESCOMPTE')
    expect(screen.queryAllByText(/à payer sur|de trop/)).toHaveLength(0)
  })

  // Le trop-payé a son point dans la Checklist (`piecesPayeesEnTrop`) : il a donc sa pastille, dans les deux modèles.
  it('dit une pièce payée de trop, dans la liste ET dans le panneau, en engagement aussi', async () => {
    for (const modele of [TRESORERIE, ENGAGEMENT]) {
      reinitialiser()
      faux.pieces = [pieceDeTest({ montant_ttc: 100 })]
      faux.lignes = [ligneDeTest({ statut: 'rapprochee', piece_id: 'piece-1', montant: -150 })]
      const { unmount } = rendre(modele)

      await act(async () => { (await screen.findByRole('button', { name: 'Rapprochés' })).click() })
      await screen.findByText(/Pièce payée .*50,00.*de trop/)
      await act(async () => { screen.getByText('PRLV SEPA FOURNISSEUR').click() })
      expect(screen.queryAllByText(/Pièce payée .*50,00.*de trop/)).toHaveLength(2)
      expect(screen.queryAllByText(/à payer sur/)).toHaveLength(0)
      unmount()
    }
  })

  // En engagement, une facture payée en partie est une dette qui court encore, au 401 : rien à signaler.
  it('se tait en engagement sur une pièce payée en partie', async () => {
    reinitialiser()
    faux.pieces = [pieceDeTest({ montant_ttc: 1000 })]
    faux.lignes = [ligneDeTest({ statut: 'rapprochee', piece_id: 'piece-1', montant: -500 })]
    rendre(ENGAGEMENT)

    await act(async () => { (await screen.findByRole('button', { name: 'Rapprochés' })).click() })
    await screen.findByText('PRLV SEPA FOURNISSEUR')
    expect(screen.queryAllByText(/à payer sur/)).toHaveLength(0)
  })

  // Sur un virement qui règle plusieurs pièces, la liste dit combien restent payées en partie ou l'ont été de
  // trop ; la fiche, lesquelles. Ici trois pièces : l'une payée en partie, l'autre exactement, la dernière de trop.
  it('dit, sur un virement groupé, les pièces payées en partie ou de trop', async () => {
    reinitialiser()
    faux.pieces = [
      pieceDeTest({ montant_ttc: 1000, tiers: 'Grossiste' }),
      pieceDeTest({ id: 'piece-2', montant_ttc: 100, tiers: 'Papeterie' }),
      pieceDeTest({ id: 'piece-3', montant_ttc: 50, tiers: 'Imprimeur' }),
    ]
    faux.lignes = [ligneDeTest({ statut: 'rapprochee', montant: -680, reglement_groupe: true, libelle: 'VIREMENT GROUPE' })]
    faux.reglements = [
      { id: 'g1', dossier_id: 'dossier-de-test', ligne_bancaire_id: 'ligne-1', piece_id: 'piece-1', montant: -500, created_at: '2025-06-02T10:00:00Z' },
      { id: 'g2', dossier_id: 'dossier-de-test', ligne_bancaire_id: 'ligne-1', piece_id: 'piece-2', montant: -100, created_at: '2025-06-02T10:00:00Z' },
      { id: 'g3', dossier_id: 'dossier-de-test', ligne_bancaire_id: 'ligne-1', piece_id: 'piece-3', montant: -80, created_at: '2025-06-02T10:00:00Z' },
    ]
    rendre()

    await act(async () => { (await screen.findByRole('button', { name: 'Rapprochés' })).click() })
    await screen.findByText(/Reste .*500,00.*à payer sur une pièce/)
    expect(screen.getByText(/Une pièce payée .*30,00.*de trop/)).toBeTruthy()

    await act(async () => { screen.getByText('VIREMENT GROUPE').click() })
    expect(within(volet()).getByText(/Reste .*500,00.*à payer sur une pièce/)).toBeTruthy()
    const restes = within(volet()).getAllByText(/: reste .*à payer — rapproche le paiement qui manque/)
    expect(restes).toHaveLength(1)
    expect(restes[0].textContent).toMatch(/Grossiste/)
    const trops = within(volet()).getAllByText(/: payée .*30,00.*de trop — un paiement en double \?/)
    expect(trops).toHaveLength(1)
    expect(trops[0].textContent).toMatch(/Imprimeur/)
  })

  // Un paiement non lu ferait paraître une pièce réglée payée en partie : le reste se tait sur le relevé ou les
  // parts lus en partie — et le bandeau de lecture partielle dit pourquoi.
  it('se tait sur un relevé ou des parts lus en partie', async () => {
    for (const table of ['lignes_bancaires', 'reglements_groupes']) {
      reinitialiser()
      faux.pieces = [pieceDeTest({ montant_ttc: 1000 })]
      faux.lignes = [
        ligneDeTest({ id: 'ligne-1', statut: 'rapprochee', piece_id: 'piece-1', montant: -500, libelle: 'ACOMPTE' }),
        ligneDeTest({ id: 'ligne-2', statut: 'rapprochee', montant: -500, reglement_groupe: true, libelle: 'SOLDE GROUPE' }),
      ]
      faux.reglements = [{ id: 'g1', dossier_id: 'dossier-de-test', ligne_bancaire_id: 'ligne-2', piece_id: 'piece-1', montant: -500, created_at: '2025-06-02T10:00:00Z' }]
      faux.muet = { [table]: table === 'lignes_bancaires' ? 1 : 0 }
      const { unmount } = rendre()

      await act(async () => { (await screen.findByRole('button', { name: 'Rapprochés' })).click() })
      await screen.findAllByText(/n.ont pas pu être lu/)
      expect(screen.queryAllByText(/à payer sur/)).toHaveLength(0)
      unmount()
    }
  })
})

// LE SECOND PAIEMENT D'UNE PIÈCE PAYÉE EN PARTIE (ligne 26) : un acompte de 300 € rapproché de la facture de 1 000 €,
// puis le solde par un autre virement qui ne paie qu'elle. Tenue pour rapprochée dès son acompte, la pièce ne s'offrait
// plus au solde — et le règlement groupé exige deux pièces — : elle restait « payée en partie », ce que la validation de
// son exercice refuse, sans geste pour la régler.
describe('BanqueTab — le second paiement d’une pièce payée en partie', () => {
  function poserAcompte(montantSolde = -700) {
    reinitialiser()
    faux.majImmediate = true
    faux.pieces = [pieceDeTest({ montant_ttc: 1000 })]
    faux.lignes = [
      ligneDeTest({ id: 'acompte', libelle: 'ACOMPTE FOURNISSEUR', montant: -300, statut: 'rapprochee', piece_id: 'piece-1' }),
      ligneDeTest({ id: 'solde', libelle: 'SOLDE FOURNISSEUR', montant: montantSolde }),
    ]
  }
  const optionsDePiece = () => [...(within(volet()).getByLabelText('Pièce') as HTMLSelectElement).options].map((o) => o.textContent ?? '')
  const choisir = async (id: string) => {
    await act(async () => { fireEvent.change(within(volet()).getByLabelText('Pièce'), { target: { value: id } }) })
  }

  it('la fiche du solde offre la pièce pour son reste, et l’associe au clic — en trésorerie comme en engagement', async () => {
    for (const modele of [TRESORERIE, ENGAGEMENT]) {
      poserAcompte()
      const { unmount } = rendre(modele)
      await ouvrir('SOLDE FOURNISSEUR')
      expect(optionsDePiece().filter((t) => /reste 700,00\s€ sur 1\s000,00\s€/.test(t))).toHaveLength(1)
      // Et l'affectation à une catégorie, plus bas, le dit avant le clic : ce solde compterait la dépense deux fois.
      within(volet()).getByText(/Une pièce payée en partie attend son solde : ce mouvement le règle peut-être\. Avant d’affecter/)
      await choisir('piece-1')
      within(volet()).getByText('Cette pièce est déjà payée en partie : ce mouvement en règle le reste.')
      await act(async () => { within(volet()).getByRole('button', { name: 'Associer' }).click() })
      await waitFor(() => expect(faux.updatesLignes).toEqual([expect.objectContaining({ statut: 'rapprochee', piece_id: 'piece-1' })]))
      unmount()
    }
  })

  it('refuse avant le clic un mouvement qui dépasse le reste, ou qui va dans le mauvais sens', async () => {
    for (const [montant, refus] of [[-900, /dépasse ce qu’il reste à régler de la pièce « Fournisseur »/], [700, /mauvais sens pour la pièce « Fournisseur »/]] as const) {
      poserAcompte(montant)
      const { unmount } = rendre()
      await ouvrir('SOLDE FOURNISSEUR')
      await choisir('piece-1')
      within(volet()).getByText(refus)
      expect((within(volet()).getByRole('button', { name: 'Associer' }) as HTMLButtonElement).disabled).toBe(true)
      expect(within(volet()).queryByText(/en règle le reste/)).toBeNull()
      expect(faux.updatesLignes).toHaveLength(0)
      unmount()
    }
  })

  // GARDES SYMÉTRIQUES : une pièce réglée — au seuil près — ne s'offre plus, et sur des parts lues en partie, un
  // paiement non lu ferait paraître une pièce réglée payée en partie : rien n'est offert.
  it('n’offre ni une pièce réglée, ni une pièce payée en partie sur une lecture partielle', async () => {
    poserAcompte()
    // 996 € payés sur 1 000 : le reste de 4 € tient sous le seuil (5 € au plus) — la pièce est réglée.
    faux.lignes = faux.lignes.map((l) => (l.id === 'acompte' ? { ...l, montant: -996 } : l))
    const { unmount } = rendre()
    await ouvrir('SOLDE FOURNISSEUR')
    expect(within(volet()).queryByLabelText('Pièce')).toBeNull()
    unmount()

    // Le relevé lu en partie : un troisième mouvement, trié après les deux autres, n'est pas servi.
    poserAcompte()
    faux.lignes = [...faux.lignes, ligneDeTest({ id: 'zz-autre', libelle: 'AUTRE MOUVEMENT', montant: -12 })]
    faux.muet = { lignes_bancaires: 2 }
    const { unmount: demonter } = rendre()
    await ouvrir('SOLDE FOURNISSEUR')
    expect(within(volet()).queryByLabelText('Pièce')).toBeNull()
    demonter()

    // Les parts des virements groupés lues en partie : une part non lue paie peut-être cette pièce.
    poserAcompte()
    faux.reglements = [{ id: 'g1', dossier_id: 'dossier-de-test', ligne_bancaire_id: 'ailleurs', piece_id: 'piece-autre', montant: -10, created_at: '2025-06-02T10:00:00Z' }]
    faux.muet = { reglements_groupes: 0 }
    rendre()
    await ouvrir('SOLDE FOURNISSEUR')
    expect(within(volet()).queryByLabelText('Pièce')).toBeNull()
  })

  // UNE PIÈCE FIGÉE PAR UN EXERCICE VALIDÉ. En ENGAGEMENT, sa facture validée se règle : le solde de la dette, payé
  // l'année suivante, s'offre pour son reste. En TRÉSORERIE elle ne se rapproche plus d'aucun mouvement — la rapprocher
  // la redaterait, ce que la base refuse —, et son reste ne s'offre pas non plus. CAS DÉFENSIF, annoncé comme tel, de
  // ce côté-là : la validation refuse en trésorerie un exercice qui porte une pièce payée en partie.
  it('une pièce figée payée en partie s’offre en engagement, pas en trésorerie — cas défensif', async () => {
    for (const [modele, offerte] of [[ENGAGEMENT, true], [TRESORERIE, false]] as const) {
      poserAcompte()
      faux.pieces = [pieceDeTest({ montant_ttc: 1000, date_piece: '2025-12-10' })]
      faux.lignes = faux.lignes.map((l) => ({ ...l, date: l.id === 'acompte' ? '2025-12-15' : '2026-01-20' }))
      faux.ecrituresValidees = [{ id: 'ev-facture', statut: 'validee', date: '2025-12-10', piece_id: 'piece-1', immobilisation_id: null }]
      const { unmount } = rendre(modele, false, [2025])
      await ouvrir('SOLDE FOURNISSEUR')
      if (offerte) {
        expect(optionsDePiece().filter((t) => /reste 700,00\s€ sur 1\s000,00\s€/.test(t))).toHaveLength(1)
      } else {
        expect(within(volet()).queryByLabelText('Pièce')).toBeNull()
      }
      unmount()
    }
  })

  // Une pièce SANS paiement s'offre comme avant, à son montant : c'est le premier paiement. Et la pièce dont le RESTE
  // vaut le mouvement vient en tête, comme une pièce de son montant — même quand l'autre est plus proche en date.
  it('offre toujours une pièce sans paiement, à son montant, après celle dont le reste vaut le mouvement', async () => {
    poserAcompte()
    faux.pieces = [...faux.pieces, pieceDeTest({ id: 'piece-2', tiers: 'Papeterie', montant_ttc: 250, date_piece: '2025-06-02' })]
    rendre()
    await ouvrir('SOLDE FOURNISSEUR')
    expect(optionsDePiece().filter((t) => /Papeterie — 250,00\s€$/.test(t))).toHaveLength(1)
    expect(optionsDePiece()[1]).toMatch(/reste 700,00\s€ sur 1\s000,00\s€/)
    await choisir('piece-2')
    expect(within(volet()).queryByText(/en règle le reste/)).toBeNull()
    expect((within(volet()).getByRole('button', { name: 'Associer' }) as HTMLButtonElement).disabled).toBe(false)
  })
})

// LES RELEVÉS DÉJÀ CLASSÉS, LUS EN PARTIE, LE DISENT DANS L'IMPORT. Leur lecture s'écrivait
// `lireTout(…).then((lecture) => …)` — une forme que le scanner ne voyait pas — et jetait son
// drapeau : tronquée, la liste cache un relevé déjà classé, qu'on croit alors devoir redemander.
describe('BanqueTab — les relevés déjà classés dans Documents', () => {
  it('lus en partie, ils le disent', async () => {
    reinitialiser()
    faux.erreurReleves = 'refus simulé'
    rendre()
    expect(await screen.findByText(/Les relevés déjà classés dans Documents n'ont pas pu être lus en entier \(lecture interrompue après 0 ligne\(s\) : refus simulé\)/)).toBeTruthy()
  })

  it('lus en entier, ils se taisent', async () => {
    reinitialiser()
    rendre()
    expect(await screen.findByText('Importer un relevé bancaire')).toBeTruthy()
    expect(screen.queryAllByText(/Les relevés déjà classés dans Documents n'ont pas pu/)).toHaveLength(0)
  })
})

// LE RAPPROCHEMENT D'UN MOUVEMENT DANS LE PANNEAU DE DROITE (étape 2 de l'interface d'ordinateur).
// Il remplace une fenêtre qui recouvrait l'écran — et c'est ce qui change le plus : la liste reste
// cliquable à côté, donc « Tout rapprocher » et une action du panneau peuvent désormais se croiser sur
// le même mouvement. Ce qui ferait mentir le panneau sans que rien ne casse visiblement : une pièce
// « proposée » quand deux conviennent aussi bien (l'ordre de tri trancherait à la place de
// l'opérateur), trois coches sous une pièce que la banque ne confirme pas, un choix dans la liste
// déroulante qui rapproche dès qu'on y touche, une action qui part deux fois, et un panneau qui
// retombe sur l'état d'avant l'action.
// Par la ligne du RELEVÉ : le même libellé apparaît aussi dans les tableaux « Sans doute possible »
// et « À trancher par l'opérateur », qui ne s'ouvrent pas. Cherchée HORS de l'`act` : dedans, React
// retient les mises à jour du chargement jusqu'à la sortie, et la ligne n'apparaîtrait jamais.
async function ouvrir(libelle = 'PRLV SEPA FOURNISSEUR') {
  const cellules = await screen.findAllByText(libelle)
  const cellule = cellules.find((e) => e.closest('tr')?.classList.contains('clickable'))
  if (!cellule) throw new Error(`Aucune ligne du relevé ne porte « ${libelle} »`)
  await act(async () => { cellule.click() })
}

describe('BanqueTab — le mouvement dans le panneau de droite', () => {
  it('associe la pièce proposée et RESTE sur le mouvement, dans son nouvel état', async () => {
    reinitialiser()
    faux.majImmediate = true
    rendre()
    await ouvrir()

    expect(within(volet()).getByText('Mouvement 1 sur 1')).toBeTruthy()
    expect(within(volet()).getByText('Pièce proposée')).toBeTruthy()
    await act(async () => { within(volet()).getByRole('button', { name: 'Associer cette pièce' }).click() })

    // Comme dans la maquette : on voit ce qu'on vient de faire, et l'annulation est à portée de main.
    // Le mouvement a quitté la liste « Non rapprochés », et le panneau le dit plutôt que de mentir
    // sur sa place.
    await waitFor(() => expect(within(volet()).getByText('Rapproché avec')).toBeTruthy())
    expect(faux.updatesLignes).toEqual([expect.objectContaining({ statut: 'rapprochee', piece_id: 'piece-1' })])
    expect(within(volet()).getByText('Mouvement hors de la liste affichée')).toBeTruthy()
    expect(within(volet()).getByRole('button', { name: 'Annuler le rapprochement' })).toBeTruthy()
  })

  it('la ligne ouverte est surlignée dans la liste, et ne l’est plus panneau fermé', async () => {
    reinitialiser()
    rendre()
    await ouvrir()
    const ligne = screen.getAllByText('PRLV SEPA FOURNISSEUR').map((e) => e.closest('tr')).find((tr) => tr != null)!
    expect(ligne.className).toContain('ligne-ouverte')
    await act(async () => { within(volet()).getByRole('button', { name: 'Fermer le panneau' }).click() })
    expect(ligne.className).not.toContain('ligne-ouverte')
    expect(volet().childElementCount).toBe(0)
  })

  it('justifie la pièce proposée par ses signaux', async () => {
    reinitialiser()
    rendre()
    await ouvrir()
    const panneau = within(volet())
    expect(panneau.getByText('Même montant, au centime près')).toBeTruthy()
    expect(panneau.getByText('1 jour d’écart avec la pièce')).toBeTruthy()
    expect(panneau.getByText('Fournisseur retrouvé dans le libellé bancaire')).toBeTruthy()
    expect(panneau.queryAllByText(/Sens contraire/)).toHaveLength(0)
  })

  // GARDE SYMÉTRIQUE du précédent : sans elle, « le panneau justifie » serait satisfait par un
  // panneau qui coche TOUT — or c'est précisément le fournisseur et le sens qui séparent une
  // concordance d'une coïncidence (voir lib/appariementBanque.ts).
  it('dit ce que la banque ne confirme pas, au lieu de le cocher', async () => {
    reinitialiser()
    faux.pieces = [pieceDeTest({ tiers: 'Transmedical' })]
    faux.lignes = [ligneDeTest({ montant: 100, libelle: 'VIR SEPA REMBOURSEMENT' })]
    rendre()
    await ouvrir('VIR SEPA REMBOURSEMENT')
    const panneau = within(volet())
    expect(panneau.getByText('Fournisseur non retrouvé dans le libellé bancaire')).toBeTruthy()
    expect(panneau.getByText('Sens contraire : la pièce attend un paiement, le relevé montre un crédit')).toBeTruthy()
    expect(panneau.queryAllByText('Fournisseur retrouvé dans le libellé bancaire')).toHaveLength(0)
  })

  // DEUX PIÈCES QUI CONVIENNENT AUSSI BIEN : le cas que « Tout rapprocher » refuse de trancher. En
  // mettre une en avant sous « Pièce proposée », avec le bouton principal, le trancherait à la place
  // de l'opérateur — par l'ordre de tri.
  it('ne propose aucune des deux pièces qui conviennent aussi bien : il les montre toutes', async () => {
    reinitialiser()
    faux.majImmediate = true
    faux.pieces = [
      pieceDeTest({ id: 'piece-1', nom_fichier: 'mai.pdf' }),
      pieceDeTest({ id: 'piece-2', nom_fichier: 'juin.pdf' }),
    ]
    rendre()
    await ouvrir()
    const panneau = within(volet())
    expect(panneau.getByText('2 pièces conviennent aussi bien')).toBeTruthy()
    expect(panneau.queryAllByText('Pièce proposée')).toHaveLength(0)
    expect(panneau.queryAllByRole('button', { name: 'Associer cette pièce' })).toHaveLength(0)

    const boutons = panneau.getAllByRole('button', { name: 'Associer celle-ci' })
    expect(boutons).toHaveLength(2)
    await act(async () => { boutons[1].click() })
    await waitFor(() => expect(faux.updatesLignes).toEqual([expect.objectContaining({ piece_id: 'piece-2' })]))
  })

  // Dans la fenêtre d'avant, choisir dans la liste déroulante RAPPROCHAIT : sur une liste qui a le
  // focus, les flèches du clavier changent la valeur, donc la première pièce venue partait sans avoir
  // été choisie. Le choix ne s'applique plus qu'au clic sur « Associer ».
  it('le choix à la main ne rapproche qu’au clic sur « Associer »', async () => {
    reinitialiser()
    faux.majImmediate = true
    faux.pieces = [pieceDeTest({ montant_ttc: 250 })]
    rendre()
    await ouvrir()
    const panneau = within(volet())
    expect(panneau.getByText('Aucune pièce proposée pour ce mouvement.')).toBeTruthy()

    await act(async () => { fireEvent.change(panneau.getByLabelText('Pièce'), { target: { value: 'piece-1' } }) })
    expect(faux.updatesLignes).toHaveLength(0)

    await act(async () => { panneau.getByRole('button', { name: 'Associer' }).click() })
    await waitFor(() => expect(faux.updatesLignes).toEqual([expect.objectContaining({ piece_id: 'piece-1' })]))
  })

  // Trois clics dans le MÊME rendu, et pas deux : un verrou posé DANS le `try` laisse le refus du
  // deuxième sortir par le `finally`, qui relâche le verrou du premier — le troisième passe alors
  // (voir CLAUDE.md, « Le verrou se pose AVANT le `try` »).
  it('n’associe qu’une fois, même sur trois clics rapprochés', async () => {
    reinitialiser()
    rendre()
    await ouvrir()
    const bouton = within(volet()).getByRole('button', { name: 'Associer cette pièce' })
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(faux.updatesLignes).toHaveLength(1)
  })

  // LE VERROU EST PARTAGÉ. Tant que le rapprochement vivait dans une fenêtre qui recouvrait l'écran,
  // on ne pouvait pas lancer « Tout rapprocher » en arbitrant une ligne ; le panneau laisse la liste
  // cliquable, donc les deux peuvent se croiser — et deux écritures qui se croisent laissent une
  // contrepartie banque pour une pièce que le mouvement ne désigne plus.
  it('une action du panneau en cours retient « Tout rapprocher », et inversement', async () => {
    reinitialiser()
    rendre()
    await ouvrir()
    const associer = within(volet()).getByRole('button', { name: 'Associer cette pièce' })
    const toutRapprocher = screen.getByRole('button', { name: /Tout rapprocher automatiquement \(1\)/ })
    await act(async () => { associer.click(); toutRapprocher.click() })
    expect(faux.updatesLignes).toHaveLength(1)
    expect(toutRapprocher.hasAttribute('disabled')).toBe(true)
  })

  it('« Tout rapprocher » en cours retient le panneau', async () => {
    reinitialiser()
    rendre()
    await ouvrir()
    const associer = within(volet()).getByRole('button', { name: 'Associer cette pièce' })
    const toutRapprocher = screen.getByRole('button', { name: /Tout rapprocher automatiquement \(1\)/ })
    await act(async () => { toutRapprocher.click(); associer.click() })
    expect(faux.updatesLignes).toHaveLength(1)
    expect(associer.hasAttribute('disabled')).toBe(true)
  })

  // Relâché avant la relecture du relevé, le verrou laisserait le panneau montrer « Associer cette
  // pièce » sur un mouvement DÉJÀ rapproché, le temps que la relecture revienne — et un second clic
  // referait le rapprochement.
  it('reste verrouillé tant que la relecture du relevé n’est pas revenue', async () => {
    reinitialiser()
    faux.majImmediate = true
    rendre()
    await ouvrir()
    faux.retenirLectureLignes = true
    const associer = within(volet()).getByRole('button', { name: 'Associer cette pièce' })
    await act(async () => { associer.click() })
    await waitFor(() => expect(faux.resoudreLectureLignes).not.toBeNull())
    expect(associer.hasAttribute('disabled')).toBe(true)

    await act(async () => { faux.resoudreLectureLignes?.() })
    await waitFor(() => expect(within(volet()).getByText('Rapproché avec')).toBeTruthy())
  })

  // L'échec se DIT, et l'écran ne reste pas figé : c'était la moitié silencieuse de l'ancien
  // `ignorer`, dont le résultat n'était pas lu — sans conséquence tant que la fenêtre se fermait sur
  // l'action, trompeur maintenant que le panneau reste sur le mouvement.
  it('un refus est dit, et le panneau redevient utilisable', async () => {
    reinitialiser()
    faux.erreurMajLigne = 'refus simulé'
    const alerte = vi.spyOn(window, 'alert').mockImplementation(() => {})
    rendre()
    await ouvrir()
    await act(async () => { within(volet()).getByRole('button', { name: 'Ignorer' }).click() })
    await waitFor(() => expect(alerte).toHaveBeenCalledWith(expect.stringMatching(/n'a pas pu être ignoré : refus simulé/)))
    expect(within(volet()).getByRole('button', { name: 'Ignorer' }).hasAttribute('disabled')).toBe(false)
    expect(within(volet()).getByText('Non rapproché')).toBeTruthy()
  })

  // Rapproché sous le filtre « Non rapprochés », le mouvement quitte la liste : « Suivant » mène au
  // mouvement qui a pris sa place, et on enchaîne sans revenir à la liste.
  it('« Suivant » mène, après une association, au mouvement qui a pris sa place', async () => {
    reinitialiser()
    faux.majImmediate = true
    faux.lignes = [
      ligneDeTest({ id: 'ligne-1' }),
      ligneDeTest({ id: 'ligne-2', montant: -42, libelle: 'PRLV SEPA AUTRE CHOSE' }),
    ]
    rendre()
    await ouvrir()
    expect(within(volet()).getByText('Mouvement 1 sur 2')).toBeTruthy()
    await act(async () => { within(volet()).getByRole('button', { name: 'Associer cette pièce' }).click() })
    await waitFor(() => expect(within(volet()).getByText('Mouvement hors de la liste affichée')).toBeTruthy())

    expect(within(volet()).getByRole('button', { name: 'Mouvement précédent' }).hasAttribute('disabled')).toBe(true)
    await act(async () => { within(volet()).getByRole('button', { name: 'Mouvement suivant' }).click() })
    expect(within(volet()).getByText('Mouvement 1 sur 1')).toBeTruthy()
    expect(within(volet()).getAllByText('PRLV SEPA AUTRE CHOSE').length).toBeGreaterThan(0)
  })

  it('un mouvement ignoré se remet à traiter', async () => {
    reinitialiser()
    faux.majImmediate = true
    faux.lignes = [ligneDeTest({ statut: 'ignoree' })]
    rendre()
    await act(async () => { (await screen.findByRole('button', { name: 'Ignorés' })).click() })
    await ouvrir()
    await act(async () => { within(volet()).getByRole('button', { name: 'Remettre à traiter' }).click() })
    await waitFor(() => expect(within(volet()).getByText('Non rapproché')).toBeTruthy())
    expect(faux.updatesLignes).toEqual([expect.objectContaining({ statut: 'non_rapprochee', piece_id: null })])
    // Sans `cotisation_id` : un rapprochement d'échéance posé entre-temps ailleurs ferait refuser la mise à
    // jour, au lieu d'être défait en silence en laissant son écriture au brouillon.
    expect(faux.updatesLignes[0]).not.toHaveProperty('cotisation_id')
  })
})

// L'ÉCRITURE D'UNE PIÈCE SUIT SON PAIEMENT (lib/rattachement.ts, lib/contrepartieBanque.ts) : datée
// au paiement quand on la rapproche, rendue à sa date de facture quand on annule. Ce qui se joue ici
// est le CÂBLAGE — que l'écran passe la pièce et le mouvement à ces deux fonctions.
describe('BanqueTab — l’écriture suit le paiement', () => {
  it('rapprocher une pièce déjà passée en écriture la date au paiement', async () => {
    reinitialiser()
    faux.majImmediate = true
    faux.ecritures = [{ id: 'e1', compte: '606100' }]
    rendre()
    await ouvrir()
    await act(async () => { within(volet()).getByRole('button', { name: 'Associer cette pièce' }).click() })
    await waitFor(() => expect(within(volet()).getByText('Rapproché avec')).toBeTruthy())

    expect(faux.updatesEcritures).toEqual([{ valeur: { date: '2025-06-02' }, filtres: ['piece_id=piece-1', 'compte!=512000'] }])
    expect(faux.insertions).toContainEqual({ table: 'ecritures_brouillon', valeur: expect.objectContaining({ compte: '512000', date: '2025-06-02' }) })
  })

  it('annuler le rapprochement rend l’écriture à la date de sa facture', async () => {
    reinitialiser()
    faux.majImmediate = true
    faux.lignes = [ligneDeTest({ statut: 'rapprochee', piece_id: 'piece-1' })]
    rendre()
    await act(async () => { (await screen.findByRole('button', { name: 'Rapprochés' })).click() })
    await ouvrir()
    await act(async () => { within(volet()).getByRole('button', { name: 'Annuler le rapprochement' }).click() })
    await waitFor(() => expect(within(volet()).getByText('Non rapproché')).toBeTruthy())

    expect(faux.updatesEcritures).toEqual([{ valeur: { date: '2025-06-01' }, filtres: ['piece_id=piece-1'] }])
  })
})

// LE TROISIÈME CHEMIN DE RAPPROCHEMENT N'APPELAIT PAS LE RÈGLEMENT SUR LA BANQUE. Le rapprochement à
// la main et le lot « sans doute possible » règlent la pièce sur le montant réellement débité avant
// d'écrire la contrepartie (voir lib/reglementBanque.ts) ; « Tout rapprocher » ne le faisait pas, donc
// une pièce en devise rapprochée par lui restait « provisoire » au cours BCE alors que la banque
// venait de donner son montant réel.
describe('BanqueTab — Tout rapprocher règle la pièce sur la banque', () => {
  it('une pièce en devise passe au montant réellement débité', async () => {
    reinitialiser()
    faux.majImmediate = true
    faux.pieces = [pieceDeTest({ devise: 'USD', montant_devise: 120, montant_ttc: 100, taux_change: 1.2, conversion_source: 'bce' })]
    rendre()
    const bouton = await screen.findByRole('button', { name: /Tout rapprocher automatiquement \(1\)/ })
    await act(async () => { bouton.click() })
    await waitFor(() => expect(faux.updatesPieces).toEqual([expect.objectContaining({ conversion_source: 'banque' })]))
  })
})

// UNE LECTURE PARTIELLE NE COMMANDE PAS D'ÉCRITURE. Les bandeaux disaient déjà que les mouvements, les
// pièces ou les règles n'avaient été lus qu'en partie ; les boutons qui ÉCRIVENT à partir de ces
// listes restaient ouverts. L'import dédoublonne contre les mouvements LUS — et aucun écran ne permet
// de retirer un mouvement bancaire ; les deux lots n'écrivent que ce qui n'a qu'UN candidat, et une
// unicité ne se juge que sur tout ce qui existe.
describe('BanqueTab — import d’un relevé', () => {
  // Un import qui écarte des doublons le DIT par une alerte : c'est elle qui prouve, dans le cas
  // passant, que le dédoublonnage a bien tourné contre les mouvements lus.
  const alertes: string[] = []
  beforeEach(() => {
    alertes.length = 0
    vi.spyOn(window, 'alert').mockImplementation((m?: unknown) => { alertes.push(String(m)) })
  })

  const CSV = 'Date;Libellé;Montant\n02/06/2025;PRLV SEPA FOURNISSEUR;-100,00\n05/06/2025;VIR CLIENT DUPONT;250,00\n'

  async function deposer() {
    const fichier = new File([CSV], 'releve-juin.csv', { type: 'text/csv' })
    const champ = document.querySelector('input[type=file][accept=".csv,text/csv"]') as HTMLInputElement
    await act(async () => { fireEvent.change(champ, { target: { files: [fichier] } }) })
    return screen.findByRole('button', { name: /Importer 2 ligne\(s\)/ })
  }

  // La garde posée DANS les gestionnaires (`if (lectureIncomplete) return`) n'est atteinte par aucun
  // clic, le bouton étant déjà grisé : la retirer laisse ces tests verts, et c'est attendu. C'est une
  // seconde ceinture, comme le refus côté gestionnaire de ClotureTab — la dire gardée serait faux.
  it('se suspend sur un relevé lu à moitié, plutôt que de réimporter ce qu’il n’a pas lu', async () => {
    reinitialiser()
    // Le mouvement du 02/06 est en base, mais la lecture n'en rend rien : le dédoublonnage le
    // croirait absent, et l'importerait une seconde fois.
    faux.muet = { lignes_bancaires: 0 }
    rendre()

    const bouton = await deposer()
    expect(screen.getByText(/Import suspendu/)).toBeTruthy()
    expect(bouton.hasAttribute('disabled')).toBe(true)
    await act(async () => { bouton.click() })
    expect(faux.insertions.filter((i) => i.table === 'lignes_bancaires')).toHaveLength(0)
  })

  it('importe, sur une lecture complète, la seule ligne qui manque', async () => {
    // Le garde symétrique : sans lui, « l'import se suspend » serait satisfait par un import qui ne
    // part JAMAIS.
    reinitialiser()
    rendre()

    const bouton = await deposer()
    expect(screen.queryByText(/Import suspendu/)).toBeNull()
    await act(async () => { bouton.click() })

    const lot = faux.insertions.filter((i) => i.table === 'lignes_bancaires')
    expect(lot).toHaveLength(1)
    expect(lot[0].valeur).toEqual([expect.objectContaining({ libelle: 'VIR CLIENT DUPONT', montant: 250 })])
    expect(alertes).toEqual([expect.stringContaining('1 déjà présente(s), ignorée(s)')])
  })

  // Le chemin PDF porte la même garde et le même verrou que le CSV — un chemin qu'on ne teste pas
  // est celui où une mutation passe inaperçue.
  async function deposerPdf() {
    faux.lignesPdf = [
      { texte: '02/06/2025 PRLV SEPA FOURNISSEUR -100,00', xFin: 0 },
      { texte: '05/06/2025 VIR CLIENT DUPONT 250,00', xFin: 0 },
    ]
    await act(async () => { (await screen.findByRole('button', { name: 'PDF' })).click() })
    const fichier = new File(['%PDF'], 'releve-juin.pdf', { type: 'application/pdf' })
    const champ = document.querySelector('input[type=file][accept=".pdf,application/pdf"]') as HTMLInputElement
    await act(async () => { fireEvent.change(champ, { target: { files: [fichier] } }) })
    return screen.findByRole('button', { name: /Importer 2 ligne\(s\)/ })
  }

  it('se suspend aussi par le chemin PDF', async () => {
    reinitialiser()
    faux.muet = { lignes_bancaires: 0 }
    rendre()

    const bouton = await deposerPdf()
    expect(bouton.hasAttribute('disabled')).toBe(true)
    await act(async () => { bouton.click() })
    expect(faux.insertions.filter((i) => i.table === 'lignes_bancaires')).toHaveLength(0)
  })

  it("n'importe qu'une fois un relevé PDF cliqué trois fois", async () => {
    reinitialiser()
    rendre()

    const bouton = await deposerPdf()
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })

    const lot = faux.insertions.filter((i) => i.table === 'lignes_bancaires')
    expect(lot).toHaveLength(1)
    expect(lot[0].valeur).toEqual([expect.objectContaining({ libelle: 'VIR CLIENT DUPONT', montant: 250 })])
  })

  it("trois clics rapprochés n'importent le relevé qu'une fois", async () => {
    // Chaque clic dédoublonnait contre la MÊME liste d'avant : deux imports partis dans le même rendu
    // inséraient tous deux le relevé entier. Trois et non deux : un verrou posé dans le `try` serait
    // relâché par le deuxième clic et laisserait passer le troisième.
    reinitialiser()
    rendre()

    const bouton = await deposer()
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })

    expect(faux.insertions.filter((i) => i.table === 'lignes_bancaires')).toHaveLength(1)
  })
})

describe('BanqueTab — les lots de rapprochement sur une lecture partielle', () => {
  it('suspend « Tout rapprocher » quand la jumelle d’une pièce peut ne pas avoir été lue', async () => {
    // Deux dépôts du même document : lus ensemble, le plan refuse de trancher (test plus haut). Lus
    // à moitié, la seconde disparaît et la première paraît seule candidate.
    reinitialiser()
    faux.pieces = [
      pieceDeTest({ id: 'piece-1', nom_fichier: 'mai.pdf' }),
      pieceDeTest({ id: 'piece-2', nom_fichier: 'juin.pdf' }),
    ]
    faux.muet = { pieces: 1 }
    rendre()

    const bouton = await screen.findByRole('button', { name: /Tout rapprocher automatiquement \(1\)/ })
    expect(bouton.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(/Rapprochement automatique suspendu/)).toBeTruthy()
    await act(async () => { bouton.click() })
    expect(faux.updatesLignes).toHaveLength(0)
  })

  it('suspend la validation en lot, qui validerait la pièce sur cette fausse certitude', async () => {
    reinitialiser()
    faux.pieces = [
      pieceDeTest({ id: 'piece-1', nom_fichier: 'mai.pdf', statut: 'a_valider' }),
      pieceDeTest({ id: 'piece-2', nom_fichier: 'juin.pdf', statut: 'a_valider' }),
    ]
    faux.muet = { pieces: 1 }
    rendre()

    const bouton = await screen.findByRole('button', { name: 'Valider et rapprocher cette pièce' })
    expect(bouton.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(/Validation en lot suspendue/)).toBeTruthy()
    await act(async () => { bouton.click() })
    expect(faux.updatesPieces).toHaveLength(0)
    expect(faux.updatesLignes).toHaveLength(0)
  })

  it('valide en lot, sur une lecture complète, la pièce qui n’a qu’un mouvement possible', async () => {
    // Le garde symétrique du précédent.
    reinitialiser()
    faux.majImmediate = true
    faux.pieces = [pieceDeTest({ id: 'piece-1', statut: 'a_valider' })]
    rendre()

    const bouton = await screen.findByRole('button', { name: 'Valider et rapprocher cette pièce' })
    expect(screen.queryByText(/Validation en lot suspendue/)).toBeNull()
    await act(async () => { bouton.click() })
    await waitFor(() => expect(faux.updatesPieces).toEqual([expect.objectContaining({ statut: 'validee' })]))
  })
})

// EN ENGAGEMENT (lib/engagement.ts), le rapprochement écrit le RÈGLEMENT de la facture et ne redate
// rien ; l'annuler retire ce règlement-là. Le calcul est testé à part : ici, que l'écran passe le
// modèle du dossier aux deux fonctions.
describe('BanqueTab — en engagement', () => {
  it('rapprocher écrit le règlement du mouvement, 401 contre 512, sans redater la facture', async () => {
    reinitialiser()
    faux.majImmediate = true
    faux.ecritures = [{ id: 'e1', compte: '606100', ligne_bancaire_id: null }, { id: 'e2', compte: '401000', ligne_bancaire_id: null }]
    rendre(ENGAGEMENT)
    await ouvrir()
    await act(async () => { within(volet()).getByRole('button', { name: 'Associer cette pièce' }).click() })
    await waitFor(() => expect(within(volet()).getByText('Rapproché avec')).toBeTruthy())

    expect(faux.updatesEcritures).toEqual([])
    expect(faux.insertions).toContainEqual({
      table: 'ecritures_brouillon',
      valeur: [
        expect.objectContaining({ compte: '401000', sens: 'debit', montant: 100, date: '2025-06-02', ligne_bancaire_id: 'ligne-1' }),
        expect.objectContaining({ compte: '512000', sens: 'credit', montant: 100, date: '2025-06-02', ligne_bancaire_id: 'ligne-1' }),
      ],
    })
  })

  it('dit que l’écriture de RÈGLEMENT n’a pas pu être créée, pas une « contrepartie banque »', async () => {
    reinitialiser()
    faux.majImmediate = true
    faux.erreurInsertionEcritures = 'refus simulé'
    faux.ecritures = [{ id: 'e1', compte: '606100', ligne_bancaire_id: null }, { id: 'e2', compte: '401000', ligne_bancaire_id: null }]
    const alerte = vi.spyOn(window, 'alert').mockImplementation(() => {})
    rendre(ENGAGEMENT)
    await ouvrir()
    await act(async () => { within(volet()).getByRole('button', { name: 'Associer cette pièce' }).click() })
    await waitFor(() => expect(alerte).toHaveBeenCalledWith(
      "Le rapprochement est enregistré, mais l'écriture de règlement n'a pas pu être créée : refus simulé",
    ))
  })

  it('et parle de contrepartie banque en trésorerie — le garde symétrique', async () => {
    reinitialiser()
    faux.majImmediate = true
    faux.erreurInsertionEcritures = 'refus simulé'
    faux.ecritures = [{ id: 'e1', compte: '606100', ligne_bancaire_id: null }]
    const alerte = vi.spyOn(window, 'alert').mockImplementation(() => {})
    rendre(TRESORERIE)
    await ouvrir()
    await act(async () => { within(volet()).getByRole('button', { name: 'Associer cette pièce' }).click() })
    await waitFor(() => expect(alerte).toHaveBeenCalledWith(
      "Le rapprochement est enregistré, mais l'écriture de contrepartie banque n'a pas pu être créée : refus simulé",
    ))
  })

  it('annuler le rapprochement retire le règlement de ce mouvement, et ne redate rien', async () => {
    reinitialiser()
    faux.majImmediate = true
    faux.lignes = [ligneDeTest({ statut: 'rapprochee', piece_id: 'piece-1' })]
    rendre(ENGAGEMENT)
    await act(async () => { (await screen.findByRole('button', { name: 'Rapprochés' })).click() })
    await ouvrir()
    await act(async () => { within(volet()).getByRole('button', { name: 'Annuler le rapprochement' }).click() })
    await waitFor(() => expect(within(volet()).getByText('Non rapproché')).toBeTruthy())

    expect(faux.suppressionsEcritures).toEqual([['ligne_bancaire_id=ligne-1']])
    expect(faux.updatesEcritures).toEqual([])
  })
})

// LIGNE 26.6 : un mouvement qui n'aura jamais de facture — des frais bancaires, un encaissement de
// l'Assurance maladie — s'affecte à une catégorie. Ce que ce bloc garde et qu'aucun test de `src/lib`
// ne peut voir : que l'écran passe par la fonction SQL (jamais une mise à jour directe de la ligne,
// qui laisserait l'écriture derrière), avec l'écriture composée pour CE mouvement, au clic seulement,
// une seule fois, et qu'il dise avant le clic ce que la base refuserait.
function categorieDeTest(o: Partial<Categorie> = {}): Categorie {
  return {
    id: 'cat-frais', dossier_id: null, code: 'frais_bancaires', libelle: 'Frais bancaires', ordre: 70,
    compte_comptable: '627000', poste_2035: 'Frais financiers', ...o,
  }
}

describe('BanqueTab — affecter un mouvement sans justificatif à une catégorie', () => {
  const FRAIS = categorieDeTest()
  const RECETTES = categorieDeTest({
    id: 'cat-recettes', code: 'ventes_prestations', libelle: 'Ventes / prestations', ordre: 10,
    compte_comptable: '706000', poste_2035: 'Recettes',
  })
  const BILAN = categorieDeTest({ id: 'cat-bilan', code: 'exploitant', libelle: 'Exploitant', ordre: 90, compte_comptable: '108000', poste_2035: null })

  function preparer(ligne: Partial<LigneBancaire> = {}) {
    reinitialiser()
    faux.pieces = []
    faux.categories = [FRAIS, RECETTES, BILAN]
    faux.lignes = [ligneDeTest({ libelle: 'FRAIS TENUE DE COMPTE', montant: -8.5, ...ligne })]
  }
  const choisir = (id: string) => fireEvent.change(within(volet()).getByLabelText('Catégorie'), { target: { value: id } })
  async function voirLesRapproches() {
    await act(async () => { (await screen.findByRole('button', { name: 'Rapprochés' })).click() })
  }

  it('n’affecte qu’au clic sur « Affecter », par la base, et reste sur le mouvement', async () => {
    preparer()
    rendre()
    await ouvrir('FRAIS TENUE DE COMPTE')
    // Changer la liste n'écrit rien : sur une liste qui a le focus, les flèches du clavier la changent.
    choisir('cat-frais')
    expect(faux.rpcs).toEqual([])
    await act(async () => { within(volet()).getByRole('button', { name: 'Affecter' }).click() })

    await waitFor(() => expect(within(volet()).getByText('Affecté à « Frais bancaires »')).toBeTruthy())
    expect(faux.rpcs).toEqual([{
      nom: 'affecter_mouvement_bancaire',
      args: {
        p_ligne_bancaire_id: 'ligne-1',
        p_categorie_id: 'cat-frais',
        p_ecritures: [
          { compte: '627000', sens: 'debit', montant: 8.5, libelle: 'FRAIS TENUE DE COMPTE' },
          { compte: '512000', sens: 'credit', montant: 8.5, libelle: 'FRAIS TENUE DE COMPTE' },
        ],
        p_taux_tva: null,
      },
    }])
    // Jamais une mise à jour directe de la ligne : l'affectation et son écriture partent ensemble.
    expect(faux.updatesLignes).toEqual([])
    expect(within(volet()).getByRole('button', { name: 'Annuler l’affectation' })).toBeTruthy()
  })

  it('écrit un encaissement en recette sur un dossier exonéré : la banque au débit, le produit au crédit', async () => {
    preparer({ libelle: 'VIR CPAM', montant: 250 })
    rendre()
    await ouvrir('VIR CPAM')
    choisir('cat-recettes')
    await act(async () => { within(volet()).getByRole('button', { name: 'Affecter' }).click() })
    expect(faux.rpcs[0].args.p_ecritures).toEqual([
      { compte: '706000', sens: 'credit', montant: 250, libelle: 'VIR CPAM' },
      { compte: '512000', sens: 'debit', montant: 250, libelle: 'VIR CPAM' },
    ])
  })

  const choisirTaux = (taux: string) => fireEvent.change(within(volet()).getByLabelText('Taux de TVA de cette recette'), { target: { value: taux } })

  it('sur un dossier assujetti, une recette demande son taux — rien n’est deviné — et s’écrit au hors taxe avec sa TVA', async () => {
    preparer({ libelle: 'VIR CPAM', montant: 120 })
    rendre(TRESORERIE, true)
    await ouvrir('VIR CPAM')
    choisir('cat-recettes')
    // Le taux manque : le bouton attend, et la fiche pose la question — sans crier à l'erreur.
    expect((within(volet()).getByLabelText('Taux de TVA de cette recette') as HTMLSelectElement).value).toBe('')
    expect(within(volet()).getByText(/le relevé ne dit pas celle d’une recette : choisis son taux/)).toBeTruthy()
    expect(within(volet()).getByRole('button', { name: 'Affecter' }).hasAttribute('disabled')).toBe(true)
    expect(within(volet()).queryByText(/porte son taux/)).toBeNull()
    expect(faux.rpcs).toEqual([])

    choisirTaux('20')
    expect(within(volet()).getByText(/Recette au hors taxe : 100,00.*TVA collectée \(445710\) : 20,00/)).toBeTruthy()
    await act(async () => { within(volet()).getByRole('button', { name: 'Affecter' }).click() })
    expect(faux.rpcs).toEqual([{
      nom: 'affecter_mouvement_bancaire',
      args: {
        p_ligne_bancaire_id: 'ligne-1',
        p_categorie_id: 'cat-recettes',
        p_ecritures: [
          { compte: '706000', sens: 'credit', montant: 100, libelle: 'VIR CPAM' },
          { compte: '445710', sens: 'credit', montant: 20, libelle: 'VIR CPAM' },
          { compte: '512000', sens: 'debit', montant: 120, libelle: 'VIR CPAM' },
        ],
        p_taux_tva: 20,
      },
    }])
    // Le taux affecté se lit ensuite sur le mouvement.
    await waitFor(() => expect(within(volet()).getByText(/Compte 706000 · Recettes · TVA 20 %/)).toBeTruthy())
  })

  it('une recette exonérée d’un dossier assujetti s’écrit entière, sans ligne de TVA, au taux zéro', async () => {
    preparer({ libelle: 'VIR CPAM', montant: 250 })
    rendre(TRESORERIE, true)
    await ouvrir('VIR CPAM')
    choisir('cat-recettes')
    choisirTaux('0')
    expect(within(volet()).getByText(/Sans TVA : la recette entière, en E2 de la CA3/)).toBeTruthy()
    await act(async () => { within(volet()).getByRole('button', { name: 'Affecter' }).click() })
    expect(faux.rpcs[0].args).toEqual({
      p_ligne_bancaire_id: 'ligne-1',
      p_categorie_id: 'cat-recettes',
      p_ecritures: [
        { compte: '706000', sens: 'credit', montant: 250, libelle: 'VIR CPAM' },
        { compte: '512000', sens: 'debit', montant: 250, libelle: 'VIR CPAM' },
      ],
      p_taux_tva: 0,
    })
  })

  it('une dépense du même dossier ne demande aucun taux, et n’emporte pas celui choisi pour une recette', async () => {
    preparer({ libelle: 'VIR CPAM', montant: 250 })
    rendre(TRESORERIE, true)
    await ouvrir('VIR CPAM')
    choisir('cat-recettes')
    choisirTaux('20')
    // Une dépense : pas de TVA déductible sans facture, donc pas de taux — et pas celui resté de la recette.
    choisir('cat-frais')
    expect(within(volet()).queryByLabelText('Taux de TVA de cette recette')).toBeNull()
    await act(async () => { within(volet()).getByRole('button', { name: 'Affecter' }).click() })
    expect(faux.rpcs[0].args.p_taux_tva).toBeNull()
    expect((faux.rpcs[0].args.p_ecritures as { compte: string }[]).map((l) => l.compte)).toEqual(['627000', '512000'])
  })

  it('sur un dossier exonéré, aucune recette ne demande de taux', async () => {
    preparer({ libelle: 'VIR CPAM', montant: 250 })
    rendre()
    await ouvrir('VIR CPAM')
    choisir('cat-recettes')
    expect(within(volet()).queryByLabelText('Taux de TVA de cette recette')).toBeNull()
    expect(within(volet()).getByRole('button', { name: 'Affecter' }).hasAttribute('disabled')).toBe(false)
  })

  it('nomme un encaissement rangé sur une dépense, sans le refuser — c’est un remboursement', async () => {
    preparer({ libelle: 'VIR CPAM', montant: 250 })
    rendre()
    await ouvrir('VIR CPAM')
    choisir('cat-frais')
    expect(within(volet()).getByText(/C’est un encaissement, et cette catégorie est une dépense/)).toBeTruthy()
    expect(within(volet()).getByRole('button', { name: 'Affecter' }).hasAttribute('disabled')).toBe(false)
    // Le garde symétrique : rangé en recette, il n'y a rien à dire.
    choisir('cat-recettes')
    expect(within(volet()).queryByText(/C’est un encaissement/)).toBeNull()
  })

  it('ne propose que les comptes de charge et de produit, les dépenses d’abord pour un paiement', async () => {
    preparer()
    rendre()
    await ouvrir('FRAIS TENUE DE COMPTE')
    const options = within(within(volet()).getByLabelText('Catégorie')).getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual(['— Choisir —', 'Frais bancaires (627000)', 'Ventes / prestations (706000)'])
  })

  it('n’affecte qu’une fois, même sur trois clics rapprochés', async () => {
    preparer()
    rendre()
    await ouvrir('FRAIS TENUE DE COMPTE')
    choisir('cat-frais')
    const bouton = within(volet()).getByRole('button', { name: 'Affecter' })
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(faux.rpcs).toHaveLength(1)
  })

  it('dit une affectation que la base refuse, et le mouvement reste à traiter', async () => {
    preparer()
    faux.erreurRpc = 'refus simulé'
    const alerte = vi.spyOn(window, 'alert').mockImplementation(() => {})
    rendre()
    await ouvrir('FRAIS TENUE DE COMPTE')
    choisir('cat-frais')
    await act(async () => { within(volet()).getByRole('button', { name: 'Affecter' }).click() })
    await waitFor(() => expect(alerte).toHaveBeenCalledWith(expect.stringMatching(/L'affectation n'a pas pu être enregistrée : refus simulé/)))
    expect(within(volet()).getByText('Non rapproché')).toBeTruthy()
  })

  it('la liste dit « Affecté » et la catégorie, jamais un « Rapproché » nu ni « sans justificatif »', async () => {
    preparer({ statut: 'rapprochee', categorie_id: 'cat-frais' })
    rendre()
    await voirLesRapproches()
    expect(await screen.findByText('Affecté — Frais bancaires')).toBeTruthy()
    expect(screen.queryByText('Rapproché')).toBeNull()
    expect(screen.queryByText('Rapproché sans justificatif')).toBeNull()
  })

  it('annule l’affectation par la base, jamais par une remise à « à traiter »', async () => {
    preparer({ statut: 'rapprochee', categorie_id: 'cat-frais' })
    rendre()
    await voirLesRapproches()
    await ouvrir('FRAIS TENUE DE COMPTE')
    expect(within(volet()).getByText('Affecté à « Frais bancaires »')).toBeTruthy()
    // Pas « Rapproché avec » : sa preuve est le relevé, pas une pièce.
    expect(within(volet()).queryByText('Rapproché avec')).toBeNull()
    await act(async () => { within(volet()).getByRole('button', { name: 'Annuler l’affectation' }).click() })
    await waitFor(() => expect(within(volet()).getByText('Non rapproché')).toBeTruthy())
    expect(faux.rpcs).toEqual([{ nom: 'retirer_affectation_mouvement_bancaire', args: { p_ligne_bancaire_id: 'ligne-1' } }])
    expect(faux.updatesLignes).toEqual([])
  })

  it('dit une annulation que la base refuse, et le mouvement reste affecté', async () => {
    preparer({ statut: 'rapprochee', categorie_id: 'cat-frais' })
    faux.erreurRpc = 'refus simulé'
    const alerte = vi.spyOn(window, 'alert').mockImplementation(() => {})
    rendre()
    await voirLesRapproches()
    await ouvrir('FRAIS TENUE DE COMPTE')
    await act(async () => { within(volet()).getByRole('button', { name: 'Annuler l’affectation' }).click() })
    await waitFor(() => expect(alerte).toHaveBeenCalledWith(expect.stringMatching(/L'affectation n'a pas pu être annulée : refus simulé/)))
    expect(within(volet()).getByText('Affecté à « Frais bancaires »')).toBeTruthy()
    expect(within(volet()).getByRole('button', { name: 'Annuler l’affectation' }).hasAttribute('disabled')).toBe(false)
  })

  // LE VERROU EST PARTAGÉ AVEC LES LOTS, et le bouton le montre : sans cela il resterait cliquable
  // pendant « Tout rapprocher », et le clic, refusé par le verrou, ne ferait visiblement rien.
  it('« Tout rapprocher » en cours retient aussi l’affectation', async () => {
    preparer()
    faux.pieces = [pieceDeTest()]
    faux.lignes = [ligneDeTest(), ligneDeTest({ id: 'ligne-2', libelle: 'FRAIS TENUE DE COMPTE', montant: -8.5 })]
    rendre()
    await ouvrir('FRAIS TENUE DE COMPTE')
    choisir('cat-frais')
    const affecter = within(volet()).getByRole('button', { name: 'Affecter' })
    expect(affecter.hasAttribute('disabled')).toBe(false)
    await act(async () => { screen.getByRole('button', { name: /Tout rapprocher automatiquement \(1\)/ }).click() })
    expect(affecter.hasAttribute('disabled')).toBe(true)
    await act(async () => { affecter.click() })
    expect(faux.rpcs).toEqual([])
  })

  // Le compte d'une catégorie se change dans Écritures, après coup : un mouvement affecté quand elle
  // portait un compte de charge ne compte plus dans aucun total si elle porte maintenant un compte de
  // bilan, et c'est sur ce mouvement que l'opérateur doit l'apprendre.
  it('dit, sur un mouvement affecté, un compte qui n’est plus de charge ni de produit', async () => {
    preparer({ statut: 'rapprochee', categorie_id: 'cat-frais' })
    rendre()
    await voirLesRapproches()
    await ouvrir('FRAIS TENUE DE COMPTE')
    // Le garde symétrique : affecté à une catégorie de charge, il n'y a rien à en dire.
    expect(within(volet()).queryByText(/n’est plus un compte de charge ou de produit/)).toBeNull()
    cleanup()

    preparer({ statut: 'rapprochee', categorie_id: 'cat-bilan' })
    rendre()
    await voirLesRapproches()
    await ouvrir('FRAIS TENUE DE COMPTE')
    expect(within(volet()).getByText(/Le compte de cette catégorie n’est plus un compte de charge ou de produit/)).toBeTruthy()
  })

  it('la liste montre « TVA à choisir » sur une recette affectée sans taux d’un dossier assujetti, et le taux des autres', async () => {
    const ligne = () => screen.getAllByText('VIR CPAM').find((e) => e.closest('tr')?.classList.contains('clickable'))!.closest('tr')!
    preparer({ libelle: 'VIR CPAM', montant: 120, statut: 'rapprochee', categorie_id: 'cat-recettes' })
    rendre(TRESORERIE, true)
    await voirLesRapproches()
    await waitFor(() => expect(ligne().textContent).toMatch(/TVA à choisir/))
    // La fiche dit quoi faire, et propose de choisir le taux.
    await ouvrir('VIR CPAM')
    expect(within(volet()).getByText(/cette recette n’a pas de taux : sa TVA n’est dans aucune/)).toBeTruthy()
    expect((within(volet()).getByLabelText('Taux de TVA de cette recette') as HTMLSelectElement).value).toBe('')
    cleanup()

    // Le garde symétrique : avec son taux, la pastille le dit et rien n'est à choisir.
    preparer({ libelle: 'VIR CPAM', montant: 120, statut: 'rapprochee', categorie_id: 'cat-recettes', taux_tva: 20 })
    rendre(TRESORERIE, true)
    await voirLesRapproches()
    await waitFor(() => expect(ligne().textContent).toMatch(/Affecté — Ventes \/ prestations · TVA 20\u00a0%/))
    expect(ligne().textContent).not.toMatch(/TVA à choisir/)
    await ouvrir('VIR CPAM')
    expect((within(volet()).getByLabelText('Taux de TVA de cette recette') as HTMLSelectElement).value).toBe('20')
    cleanup()

    // Un dossier qui a cessé d'être assujetti : le taux gardé ne se montre plus, et rien n'est à choisir.
    preparer({ libelle: 'VIR CPAM', montant: 120, statut: 'rapprochee', categorie_id: 'cat-recettes', taux_tva: 20 })
    rendre()
    await voirLesRapproches()
    await waitFor(() => expect(ligne().textContent).toMatch(/Affecté — Ventes \/ prestations/))
    expect(ligne().textContent).not.toMatch(/TVA/)
    await ouvrir('VIR CPAM')
    expect(within(volet()).queryByText(/TVA 20 %/)).toBeNull()
  })

  it('dit qu’aucune catégorie n’a de compte de charge ou de produit, au lieu d’une liste vide', async () => {
    preparer()
    faux.categories = [BILAN]
    rendre()
    await ouvrir('FRAIS TENUE DE COMPTE')
    expect(within(volet()).getByText(/Aucune catégorie de ce dossier n’a de compte de charge ou de produit/)).toBeTruthy()
    expect(within(volet()).queryByRole('button', { name: 'Affecter' })).toBeNull()
  })

  it('dit des catégories lues en partie, sans quoi la liste de choix manquerait d’une catégorie en silence', async () => {
    preparer()
    faux.muet = { categories: 1 }
    rendre()
    expect(await screen.findByText(/Les catégories n'ont pas pu être lues en entier/)).toBeTruthy()
    // Le garde symétrique : lues en entier, rien à dire.
    cleanup()
    preparer()
    rendre()
    await screen.findAllByText('FRAIS TENUE DE COMPTE')
    expect(screen.queryByText(/Les catégories n'ont pas pu être lues/)).toBeNull()
  })

  it('dit, sur un mouvement affecté, ce que la 2035 ne comptera pas', async () => {
    preparer({ statut: 'rapprochee', categorie_id: 'cat-divers' })
    faux.categories = [...faux.categories, categorieDeTest({ id: 'cat-divers', code: 'divers', libelle: 'Divers', compte_comptable: '628000', poste_2035: null })]
    rendre()
    await voirLesRapproches()
    await ouvrir('FRAIS TENUE DE COMPTE')
    expect(within(volet()).getByText(/Cette catégorie n’a pas de poste 2035/)).toBeTruthy()
    // Réaffecter part de la catégorie en place : sans rien changer, il réécrit l'écriture.
    expect((within(volet()).getByLabelText('Catégorie') as HTMLSelectElement).value).toBe('cat-divers')
  })
})

function regleDeTest(o: Partial<RegleAffectationBancaire> = {}): RegleAffectationBancaire {
  return {
    id: 'regle-1', dossier_id: 'dossier-de-test', motif: 'cpam', sens: 'encaissement', categorie_id: 'cat-recettes',
    taux_tva: null, created_at: '2025-07-01T09:00:00Z', ...o,
  }
}

// LES RÈGLES PROPOSENT, LE CLIC ÉCRIT (lib/reglesAffectation.ts). Ce qu'aucun test de `src/lib` ne peut
// voir : que le lot parte sur le clic et pas avant, par la fonction SQL et pas autrement, UNE fois
// sous trois clics, qu'il se suspende sur une lecture partielle, qu'il laisse de côté un mouvement
// dont la pièce est au dossier — et qu'une règle retenue depuis la fiche parte APRÈS l'affectation.
describe('BanqueTab — les règles d’affectation et le lot', () => {
  const FRAIS = categorieDeTest()
  const RECETTES = categorieDeTest({
    id: 'cat-recettes', code: 'ventes_prestations', libelle: 'Ventes / prestations', ordre: 10,
    compte_comptable: '706000', poste_2035: 'Recettes',
  })
  const ASSURANCE = categorieDeTest({ id: 'cat-assurance', code: 'assurance', libelle: 'Assurance', ordre: 30, compte_comptable: '616100', poste_2035: "Primes d'assurance" })

  function preparer() {
    reinitialiser()
    faux.pieces = []
    faux.categories = [FRAIS, RECETTES, ASSURANCE]
    faux.lignes = [
      ligneDeTest({ id: 'l-cpam-1', libelle: 'VIR CPAM 13 SOINS', montant: 250, date: '2025-06-03' }),
      ligneDeTest({ id: 'l-cpam-2', libelle: 'VIR CPAM 13 SOINS', montant: 180, date: '2025-06-10' }),
      ligneDeTest({ id: 'l-frais', libelle: 'FRAIS TENUE DE COMPTE', montant: -8.5, date: '2025-06-05' }),
      ligneDeTest({ id: 'l-swiss-1', libelle: 'PRLV SEPA SWISSLIFE', montant: -60, date: '2025-06-07' }),
      ligneDeTest({ id: 'l-swiss-2', libelle: 'PRLV SEPA SWISSLIFE', montant: -60, date: '2025-07-07' }),
    ]
    faux.reglesAffectation = [
      regleDeTest(),
      regleDeTest({ id: 'regle-2', motif: 'frais', sens: 'decaissement', categorie_id: 'cat-frais' }),
    ]
  }
  const envoisDuLot = () => faux.rpcs.filter((r) => r.nom === 'affecter_mouvements_bancaires')
  const choisir = (id: string) => fireEvent.change(within(volet()).getByLabelText('Catégorie'), { target: { value: id } })

  it('propose ce que les règles reconnaissent, et ne l’écrit qu’au clic, en un envoi', async () => {
    preparer()
    rendre()
    expect(await screen.findByText('Affectations proposées par vos règles (3)')).toBeTruthy()
    expect(screen.getByText(/2 mouvements,/).closest('li')?.textContent).toMatch(/^Ventes \/ prestations \(706000\) : 2 mouvements, 430,00/)
    expect(screen.getByText(/1 mouvement,/).closest('li')?.textContent).toMatch(/^Frais bancaires \(627000\) : 1 mouvement, -8,50/)
    // Rien n'est écrit au chargement : la règle propose, elle n'écrit pas.
    expect(faux.rpcs).toEqual([])

    await act(async () => { screen.getByRole('button', { name: 'Affecter les 3' }).click() })

    expect(envoisDuLot()).toEqual([{
      nom: 'affecter_mouvements_bancaires',
      args: {
        p_affectations: [
          { ligne_bancaire_id: 'l-cpam-1', categorie_id: 'cat-recettes', taux_tva: null, ecritures: [
            { compte: '706000', sens: 'credit', montant: 250, libelle: 'VIR CPAM 13 SOINS' },
            { compte: '512000', sens: 'debit', montant: 250, libelle: 'VIR CPAM 13 SOINS' },
          ] },
          { ligne_bancaire_id: 'l-cpam-2', categorie_id: 'cat-recettes', taux_tva: null, ecritures: [
            { compte: '706000', sens: 'credit', montant: 180, libelle: 'VIR CPAM 13 SOINS' },
            { compte: '512000', sens: 'debit', montant: 180, libelle: 'VIR CPAM 13 SOINS' },
          ] },
          { ligne_bancaire_id: 'l-frais', categorie_id: 'cat-frais', taux_tva: null, ecritures: [
            { compte: '627000', sens: 'debit', montant: 8.5, libelle: 'FRAIS TENUE DE COMPTE' },
            { compte: '512000', sens: 'credit', montant: 8.5, libelle: 'FRAIS TENUE DE COMPTE' },
          ] },
        ],
      },
    }])
    // Le relevé relu, plus rien n'est proposé : la carte disparaît.
    await waitFor(() => expect(screen.queryByText(/Affectations proposées par vos règles/)).toBeNull())
    expect(faux.updatesLignes).toEqual([])
  })

  it('sur un dossier assujetti, une règle de recette porte son taux : le lot l’écrit au hors taxe, sa TVA à côté', async () => {
    preparer()
    faux.reglesAffectation = [
      regleDeTest({ taux_tva: 20 }),
      regleDeTest({ id: 'regle-2', motif: 'frais', sens: 'decaissement', categorie_id: 'cat-frais' }),
    ]
    rendre(TRESORERIE, true)
    expect(await screen.findByText('Affectations proposées par vos règles (3)')).toBeTruthy()
    // Le taux de la règle se lit sur chaque recette proposée, pas sur la dépense.
    expect(screen.getAllByText('Ventes / prestations (TVA 20 %)')).toHaveLength(2)
    expect(screen.getAllByText('Frais bancaires').some((e) => e.tagName === 'TD')).toBe(true)

    await act(async () => { screen.getByRole('button', { name: 'Affecter les 3' }).click() })
    const envoi = envoisDuLot()[0].args.p_affectations as { ligne_bancaire_id: string; taux_tva: number | null; ecritures: unknown }[]
    expect(envoi.find((a) => a.ligne_bancaire_id === 'l-cpam-1')).toEqual({
      ligne_bancaire_id: 'l-cpam-1', categorie_id: 'cat-recettes', taux_tva: 20, ecritures: [
        { compte: '706000', sens: 'credit', montant: 208.33, libelle: 'VIR CPAM 13 SOINS' },
        { compte: '445710', sens: 'credit', montant: 41.67, libelle: 'VIR CPAM 13 SOINS' },
        { compte: '512000', sens: 'debit', montant: 250, libelle: 'VIR CPAM 13 SOINS' },
      ],
    })
    expect(envoi.find((a) => a.ligne_bancaire_id === 'l-frais')?.taux_tva).toBeNull()
  })

  it('sur un dossier assujetti, une règle de recette SANS taux ne propose rien : le lot dirait une TVA qu’on ne connaît pas', async () => {
    preparer()
    rendre(TRESORERIE, true)
    expect(await screen.findByText('Affectations proposées par vos règles (1)')).toBeTruthy()
    expect(screen.getByText(/2 mouvements que l'affectation refuserait/)).toBeTruthy()
    expect(screen.getAllByText(/cette règle n’en dit pas/)).toHaveLength(2)
    await act(async () => { screen.getByRole('button', { name: 'Affecter ce mouvement' }).click() })
    expect((envoisDuLot()[0].args.p_affectations as { ligne_bancaire_id: string }[]).map((a) => a.ligne_bancaire_id)).toEqual(['l-frais'])
  })

  it('la fiche présélectionne le taux de la règle, et la règle retenue garde le taux choisi', async () => {
    preparer()
    faux.reglesAffectation = [regleDeTest({ taux_tva: 20 })]
    rendre(TRESORERIE, true)
    await ouvrir('VIR CPAM 13 SOINS')
    expect((within(volet()).getByLabelText('Catégorie') as HTMLSelectElement).value).toBe('cat-recettes')
    expect((within(volet()).getByLabelText('Taux de TVA de cette recette') as HTMLSelectElement).value).toBe('20')
    expect(within(volet()).getByText(/dans cette catégorie\s*, à 20 %/)).toBeTruthy()
    // L'opérateur corrige le taux et retient la règle : elle garde celui qu'il a choisi.
    fireEvent.change(within(volet()).getByLabelText('Taux de TVA de cette recette'), { target: { value: '10' } })
    await act(async () => { within(volet()).getByRole('checkbox').click() })
    await act(async () => { within(volet()).getByRole('button', { name: 'Affecter' }).click() })
    expect(faux.rpcs[0].args.p_taux_tva).toBe(10)
    expect(faux.upserts).toHaveLength(1)
    expect(faux.upserts[0].valeur).toMatchObject({ sens: 'encaissement', categorie_id: 'cat-recettes', taux_tva: 10 })
  })

  it('la liste signale un mouvement qu’une règle propose', async () => {
    preparer()
    rendre()
    const ligne = (await screen.findAllByText('FRAIS TENUE DE COMPTE')).find((e) => e.closest('tr')?.classList.contains('clickable'))
    expect(ligne?.closest('tr')?.textContent).toMatch(/Non rapproché · suggestion/)
    // Le garde symétrique : un mouvement qu'aucune règle ne reconnaît reste sans suggestion.
    const autre = (await screen.findAllByText('PRLV SEPA SWISSLIFE')).find((e) => e.closest('tr')?.classList.contains('clickable'))
    expect(autre?.closest('tr')?.textContent).not.toMatch(/suggestion/)
  })

  it('écarte du lot un mouvement dont la pièce est au dossier, et le dit', async () => {
    preparer()
    faux.pieces = [pieceDeTest({ id: 'p-cpam', tiers: null, type_piece: 'vente', montant_ttc: 250, date_piece: '2025-06-01', statut: 'a_valider' })]
    rendre()
    expect(await screen.findByText('Affectations proposées par vos règles (2)')).toBeTruthy()
    expect(screen.getByText(/1 mouvement à rapprocher plutôt qu'affecter/)).toBeTruthy()
    expect(screen.getByText(/Une pièce du même montant attend un rapprochement/)).toBeTruthy()

    await act(async () => { screen.getByRole('button', { name: 'Affecter les 2' }).click() })
    const envoyes = (envoisDuLot()[0].args.p_affectations as { ligne_bancaire_id: string }[]).map((a) => a.ligne_bancaire_id)
    expect(envoyes).toEqual(['l-cpam-2', 'l-frais'])
  })

  // LE SOLDE D'UNE PIÈCE PAYÉE EN PARTIE (ligne 26) : rapprochée de son acompte, la pièce échappait au contrôle du
  // justificatif, et une règle au nom du fournisseur aurait affecté le solde — la dépense comptée une seconde fois.
  it('écarte du lot le solde d’une pièce payée en partie, et le dit', async () => {
    preparer()
    faux.reglesAffectation = [...faux.reglesAffectation, regleDeTest({ id: 'regle-3', motif: 'swisslife', sens: 'decaissement', categorie_id: 'cat-assurance' })]
    faux.pieces = [pieceDeTest({ id: 'p-swiss', tiers: 'Swisslife', montant_ttc: 120, date_piece: '2025-06-01' })]
    faux.lignes = faux.lignes.map((l) => (l.id === 'l-swiss-1' ? { ...l, statut: 'rapprochee' as const, piece_id: 'p-swiss' } : l))
    rendre()
    expect(await screen.findByText('Affectations proposées par vos règles (3)')).toBeTruthy()
    expect(screen.getByText(/1 mouvement à rapprocher plutôt qu'affecter/)).toBeTruthy()
    expect(screen.getByText(/Une pièce payée en partie attend son solde/)).toBeTruthy()
  })

  it('suspend le lot sur une lecture partielle des règles, et le dit', async () => {
    preparer()
    faux.muet = { regles_affectation_bancaire: 1 }
    rendre()
    expect(await screen.findByText(/Les règles d’affectation n'ont pas pu être lues en entier/)).toBeTruthy()
    expect(screen.getByText(/Affectation en lot suspendue/)).toBeTruthy()
    const bouton = screen.getByRole('button', { name: /^Affecter les / })
    expect(bouton.hasAttribute('disabled')).toBe(true)
    await act(async () => { bouton.click() })
    expect(envoisDuLot()).toEqual([])
  })

  it('suspend aussi le lot sur une lecture partielle des pièces — un justificatif non lu ne s’écarte pas', async () => {
    preparer()
    faux.pieces = [pieceDeTest({ id: 'p-cpam', tiers: null, type_piece: 'vente', montant_ttc: 250, date_piece: '2025-06-01' })]
    faux.muet = { pieces: 0 }
    rendre()
    expect(await screen.findByText(/Affectation en lot suspendue/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Affecter les / }).hasAttribute('disabled')).toBe(true)
  })

  it('suspend aussi le lot sur une lecture partielle des catégories — une règle y viserait une catégorie non lue', async () => {
    preparer()
    faux.muet = { categories: 2 }
    rendre()
    expect(await screen.findByText(/Affectation en lot suspendue/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Affecter les / }).hasAttribute('disabled')).toBe(true)
  })

  it('suspend aussi le lot sur un relevé lu en partie', async () => {
    preparer()
    faux.muet = { lignes_bancaires: 4 }
    rendre()
    expect(await screen.findByText(/Affectation en lot suspendue/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Affecter les / }).hasAttribute('disabled')).toBe(true)
  })

  it('suspend aussi le lot sur des échéances de cotisation lues en partie — une échéance non lue ne s’écarte pas', async () => {
    preparer()
    faux.cotisations = [{
      id: 'cot-1', dossier_id: 'dossier-de-test', echeance: '2025-06-05', montant_appele: 90, montant_verse: null,
      montant_csg_crds: null, previsionnel: false, created_at: '2025-01-10T09:00:00Z',
    }]
    faux.muet = { cotisations_declarees: 0 }
    rendre()
    expect(await screen.findByText(/Affectation en lot suspendue/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Affecter les / }).hasAttribute('disabled')).toBe(true)
  })

  it('dit où sont passés les mouvements qu’une règle reconnaît, même quand elle n’en propose aucun', async () => {
    preparer()
    faux.reglesAffectation = [regleDeTest({ id: 'regle-3', motif: 'swisslife', sens: 'decaissement', categorie_id: 'cat-assurance' })]
    faux.pieces = [pieceDeTest({ id: 'p-swiss', tiers: 'Swisslife Prévoyance', montant_ttc: 720, date_piece: '2025-01-15' })]
    rendre()
    expect(await screen.findByText('Affectations proposées par vos règles (0)')).toBeTruthy()
    expect(screen.getByText(/2 mouvements à rapprocher plutôt qu'affecter/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Affecter les / })).toBeNull()
  })

  it('dit les mouvements que l’affectation refuserait, et pourquoi — jamais dans le lot', async () => {
    preparer()
    rendre(TRESORERIE, true)
    expect(await screen.findByText('Affectations proposées par vos règles (1)')).toBeTruthy()
    const refus = screen.getByText(/2 mouvements que l'affectation refuserait/).closest('details')
    expect(refus?.textContent).toMatch(/règle « cpam »\) : .*assujetti à la TVA/)
  })

  it('dit les mouvements où des règles se contredisent, sans en proposer aucun', async () => {
    preparer()
    faux.reglesAffectation.push(regleDeTest({ id: 'regle-3', motif: 'soins', sens: 'encaissement', categorie_id: 'cat-frais' }))
    rendre()
    expect(await screen.findByText('Affectations proposées par vos règles (1)')).toBeTruthy()
    const conflits = screen.getByText(/2 mouvements où des règles se contredisent/).closest('details')
    expect(conflits?.textContent).toMatch(/VIR CPAM 13 SOINS : « cpam », « soins »/)
  })

  it('le dit aussi dans la fiche, et n’y présélectionne rien', async () => {
    preparer()
    faux.reglesAffectation.push(regleDeTest({ id: 'regle-3', motif: 'soins', sens: 'encaissement', categorie_id: 'cat-frais' }))
    rendre()
    await ouvrir('VIR CPAM 13 SOINS')
    expect(within(volet()).getByText(/Plusieurs règles reconnaissent ce libellé sans s’accorder sur la catégorie/)).toBeTruthy()
    expect((within(volet()).getByLabelText('Catégorie') as HTMLSelectElement).value).toBe('')
  })

  it('n’affecte le lot qu’une fois, même sur trois clics rapprochés', async () => {
    preparer()
    rendre()
    const bouton = await screen.findByRole('button', { name: 'Affecter les 3' })
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(envoisDuLot()).toHaveLength(1)
  })

  it('découpe un grand lot en envois de cent, et dit ce qui est passé avant un refus', async () => {
    preparer()
    faux.lignes = Array.from({ length: 150 }, (_, i) => ligneDeTest({
      id: `l${i}`, libelle: 'VIR CPAM 13 SOINS', montant: 10 + i, date: `2025-06-${String((i % 28) + 1).padStart(2, '0')}`,
    }))
    faux.refusAuEnvoi = 2
    const alerte = vi.spyOn(window, 'alert').mockImplementation(() => {})
    rendre()
    const bouton = await screen.findByRole('button', { name: 'Affecter les 150' })
    await act(async () => { bouton.click() })
    await waitFor(() => expect(alerte).toHaveBeenCalled())
    expect(envoisDuLot().map((r) => (r.args.p_affectations as unknown[]).length)).toEqual([100, 50])
    expect(alerte).toHaveBeenCalledWith(expect.stringMatching(
      /^100 mouvements affectés, puis l'envoi suivant a été refusé, et rien de cet envoi n'a été écrit : Le mouvement du 02\/06\/2025/))
    // Les cent premiers sont écrits : le relevé est relu, et la carte ne propose plus que les cinquante
    // autres — sans relecture, elle en annoncerait cent cinquante, dont cent déjà affectés.
    await waitFor(() => expect(screen.getByText('Affectations proposées par vos règles (50)')).toBeTruthy())
  })

  it('refusé dès le premier envoi, le lot dit que rien de cet envoi n’a été écrit', async () => {
    preparer()
    faux.refusAuEnvoi = 1
    const alerte = vi.spyOn(window, 'alert').mockImplementation(() => {})
    rendre()
    const bouton = await screen.findByRole('button', { name: 'Affecter les 3' })
    await act(async () => { bouton.click() })
    await waitFor(() => expect(alerte).toHaveBeenCalledWith(expect.stringMatching(/^Le lot a été refusé, et rien de cet envoi n'a été écrit : /)))
    expect(screen.getByText('Affectations proposées par vos règles (3)')).toBeTruthy()
  })

  it('retire une règle après une confirmation qui dit ce qu’on perd, sans toucher aux mouvements', async () => {
    preparer()
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false)
    rendre()
    const retirer = await screen.findByRole('button', { name: 'Retirer la règle « frais »' })
    await act(async () => { retirer.click() })
    expect(confirmation).toHaveBeenCalledWith(expect.stringMatching(/« frais » \(paiements → Frais bancaires\)[\s\S]*Les mouvements déjà affectés le restent/))
    expect(faux.suppressionsRegles).toEqual([])

    confirmation.mockReturnValue(true)
    await act(async () => { retirer.click() })
    expect(faux.suppressionsRegles).toEqual([['id=regle-2']])
    expect(faux.rpcs).toEqual([])
    await waitFor(() => expect(screen.getByText('Affectations proposées par vos règles (2)')).toBeTruthy())
  })

  it('dit un retrait de règle que la base refuse', async () => {
    preparer()
    faux.erreurSuppressionRegle = 'refus simulé'
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const alerte = vi.spyOn(window, 'alert').mockImplementation(() => {})
    rendre()
    const retirer = await screen.findByRole('button', { name: 'Retirer la règle « frais »' })
    await act(async () => { retirer.click() })
    await waitFor(() => expect(alerte).toHaveBeenCalledWith("La règle n'a pas pu être retirée : refus simulé"))
  })

  it('présélectionne dans la fiche la catégorie qu’une règle propose, et le dit — sans rien écrire', async () => {
    preparer()
    rendre()
    await ouvrir('FRAIS TENUE DE COMPTE')
    expect((within(volet()).getByLabelText('Catégorie') as HTMLSelectElement).value).toBe('cat-frais')
    expect(within(volet()).getByText(/Une règle range les paiements contenant « frais » dans cette catégorie/)).toBeTruthy()
    expect(faux.rpcs).toEqual([])
    // Une autre catégorie choisie, la phrase se tait : elle parlerait d'une catégorie qui n'est plus celle-là.
    choisir('cat-assurance')
    expect(within(volet()).queryByText(/Une règle range les paiements/)).toBeNull()
  })

  it('ne parle d’aucune règle sur un mouvement déjà affecté', async () => {
    preparer()
    faux.lignes = faux.lignes.map((l) => (l.id === 'l-frais' ? { ...l, statut: 'rapprochee' as const, categorie_id: 'cat-frais' } : l))
    rendre()
    await act(async () => { (await screen.findByRole('button', { name: 'Rapprochés' })).click() })
    await ouvrir('FRAIS TENUE DE COMPTE')
    expect(within(volet()).getByText('Affecté à « Frais bancaires »')).toBeTruthy()
    expect(within(volet()).queryByText(/Une règle range/)).toBeNull()
  })

  it('retient une règle depuis la fiche : l’affectation d’abord, puis la règle normalisée', async () => {
    preparer()
    rendre()
    await ouvrir('PRLV SEPA SWISSLIFE')
    choisir('cat-assurance')
    await act(async () => { within(volet()).getByRole('checkbox').click() })
    expect((within(volet()).getByLabelText('Motif de la règle') as HTMLInputElement).value).toBe('swisslife')
    expect(within(volet()).getByText(/1 autre mouvement à traiter le contient : il sera proposé/)).toBeTruthy()
    fireEvent.change(within(volet()).getByLabelText('Motif de la règle'), { target: { value: '  SwissLife ' } })

    await act(async () => { within(volet()).getByRole('button', { name: 'Affecter' }).click() })

    expect(faux.rpcs.map((r) => r.nom)).toEqual(['affecter_mouvement_bancaire'])
    expect(faux.upserts).toEqual([{
      table: 'regles_affectation_bancaire',
      valeur: { dossier_id: 'dossier-de-test', motif: 'swisslife', sens: 'decaissement', categorie_id: 'cat-assurance', taux_tva: null },
      options: { onConflict: 'dossier_id,motif,sens' },
    }])
  })

  it('n’écrit pas la règle quand l’affectation est refusée — une règle sans affectation proposerait un choix que personne n’a fait', async () => {
    preparer()
    faux.erreurRpc = 'refus simulé'
    vi.spyOn(window, 'alert').mockImplementation(() => {})
    rendre()
    await ouvrir('PRLV SEPA SWISSLIFE')
    choisir('cat-assurance')
    await act(async () => { within(volet()).getByRole('checkbox').click() })
    await act(async () => { within(volet()).getByRole('button', { name: 'Affecter' }).click() })
    expect(faux.rpcs.map((r) => r.nom)).toEqual(['affecter_mouvement_bancaire'])
    expect(faux.upserts).toEqual([])
  })

  it('n’écrit aucune règle quand la case n’est pas cochée', async () => {
    preparer()
    rendre()
    await ouvrir('PRLV SEPA SWISSLIFE')
    choisir('cat-assurance')
    await act(async () => { within(volet()).getByRole('button', { name: 'Affecter' }).click() })
    expect(faux.rpcs.map((r) => r.nom)).toEqual(['affecter_mouvement_bancaire'])
    expect(faux.upserts).toEqual([])
  })

  it('refuse, avant le clic, un motif qui ne nomme personne', async () => {
    preparer()
    rendre()
    await ouvrir('PRLV SEPA SWISSLIFE')
    choisir('cat-assurance')
    await act(async () => { within(volet()).getByRole('checkbox').click() })
    fireEvent.change(within(volet()).getByLabelText('Motif de la règle'), { target: { value: 'PRLV SEPA' } })
    expect(within(volet()).getByText(/il désignerait un type d’opération, pas un tiers/)).toBeTruthy()
    expect(within(volet()).getByRole('button', { name: 'Affecter' }).hasAttribute('disabled')).toBe(true)
  })

  it('dit la règle que la nouvelle remplacerait', async () => {
    preparer()
    faux.reglesAffectation.push(regleDeTest({ id: 'regle-3', motif: 'swisslife', sens: 'decaissement', categorie_id: 'cat-frais' }))
    rendre()
    await ouvrir('PRLV SEPA SWISSLIFE')
    choisir('cat-assurance')
    await act(async () => { within(volet()).getByRole('checkbox').click() })
    expect(within(volet()).getByText(/Elle remplacera la règle qui les range en « Frais bancaires »/)).toBeTruthy()
    // Le garde symétrique : la même catégorie choisie, rien n'est remplacé.
    choisir('cat-frais')
    expect(within(volet()).queryByText(/Elle remplacera/)).toBeNull()
  })

  it('ne dit pas remplacer une règle de l’autre sens', async () => {
    preparer()
    faux.reglesAffectation.push(regleDeTest({ id: 'regle-3', motif: 'swisslife', sens: 'encaissement', categorie_id: 'cat-recettes' }))
    rendre()
    await ouvrir('PRLV SEPA SWISSLIFE')
    choisir('cat-assurance')
    await act(async () => { within(volet()).getByRole('checkbox').click() })
    expect(within(volet()).getByText(/1 autre mouvement à traiter le contient/)).toBeTruthy()
    expect(within(volet()).queryByText(/Elle remplacera/)).toBeNull()
  })

  it('dit une règle que la base refuse, le mouvement restant affecté', async () => {
    preparer()
    faux.erreurUpsert = 'refus simulé'
    const alerte = vi.spyOn(window, 'alert').mockImplementation(() => {})
    rendre()
    await ouvrir('PRLV SEPA SWISSLIFE')
    choisir('cat-assurance')
    await act(async () => { within(volet()).getByRole('checkbox').click() })
    await act(async () => { within(volet()).getByRole('button', { name: 'Affecter' }).click() })
    await waitFor(() => expect(alerte).toHaveBeenCalledWith(
      "Le mouvement est affecté, mais la règle n'a pas pu être enregistrée : refus simulé"))
    await waitFor(() => expect(within(volet()).getByText('Affecté à « Assurance »')).toBeTruthy())
  })

  it('ne retient aucune règle sur une lecture partielle des règles', async () => {
    preparer()
    faux.muet = { regles_affectation_bancaire: 1 }
    rendre()
    await ouvrir('PRLV SEPA SWISSLIFE')
    expect(within(volet()).getByRole('checkbox').hasAttribute('disabled')).toBe(true)
    expect(within(volet()).getByText(/Les règles d’affectation n’ont pas pu être lues en entier/)).toBeTruthy()
  })

  it('des règles relues en partie, fiche ouverte et case cochée, suspendent l’affectation', async () => {
    preparer()
    rendre()
    await ouvrir('PRLV SEPA SWISSLIFE')
    choisir('cat-assurance')
    await act(async () => { within(volet()).getByRole('checkbox').click() })
    // Une relecture du relevé arrive pendant que la fiche est ouverte — ici après le retrait d'une autre
    // règle —, et elle ne lit les règles qu'en partie.
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    faux.muet = { regles_affectation_bancaire: 0 }
    await act(async () => { screen.getByRole('button', { name: 'Retirer la règle « frais »' }).click() })
    await waitFor(() => expect(within(volet()).getByText(/Les règles d’affectation n’ont pas pu être lues en entier/)).toBeTruthy())
    expect(within(volet()).getByRole('button', { name: 'Affecter' }).hasAttribute('disabled')).toBe(true)
  })

  it('avertit, avant d’affecter, qu’un justificatif de ce tiers attend un rapprochement', async () => {
    preparer()
    faux.pieces = [pieceDeTest({ id: 'p-swiss', tiers: 'Swisslife Prévoyance', montant_ttc: 720, date_piece: '2025-01-15' })]
    rendre()
    await ouvrir('PRLV SEPA SWISSLIFE')
    expect(within(volet()).getByText(/Un justificatif de ce tiers n’est rapproché d’aucun mouvement\. Avant d’affecter/)).toBeTruthy()
    // Le garde symétrique : sans pièce de ce tiers, rien à dire.
    cleanup()
    preparer()
    rendre()
    await ouvrir('PRLV SEPA SWISSLIFE')
    expect(within(volet()).queryByText(/Avant d’affecter/)).toBeNull()
  })
})

// UN VIREMENT PERSONNEL S'ÉCRIT (lib/virementPersonnel.ts) : sur le compte du dirigeant, face à la
// banque, par la fonction de la base qui vérifie l'écriture et l'écrit AVEC le classement. Le bouton le
// classait par une simple mise à jour, sans rien écrire — et « Remettre à traiter » doit maintenant
// retirer l'écriture avec lui, par la base aussi.
describe('BanqueTab — le virement personnel s’écrit', () => {
  function preparer(ligne: Partial<LigneBancaire> = {}) {
    reinitialiser()
    faux.pieces = []
    faux.lignes = [ligneDeTest({ libelle: 'VIR COMPTE PERSO', montant: -500, ...ligne })]
  }

  it('classe et écrit par la base, sur le compte de l’exploitant, et reste sur le mouvement', async () => {
    preparer()
    rendre()
    await ouvrir('VIR COMPTE PERSO')
    // Dit avant le clic : où il s'écrira.
    expect(within(volet()).getByText(/il s’écrit sur le compte 108000 \(Compte de l'exploitant\)/)).toBeTruthy()
    await act(async () => { within(volet()).getByRole('button', { name: 'Virement personnel' }).click() })

    await waitFor(() => expect(within(volet()).getByRole('heading', { name: 'Virement personnel' })).toBeTruthy())
    expect(faux.rpcs).toEqual([{
      nom: 'classer_virement_personnel',
      args: {
        p_ligne_bancaire_id: 'ligne-1',
        p_ecritures: [
          { compte: '108000', sens: 'debit', montant: 500, libelle: 'VIR COMPTE PERSO' },
          { compte: '512000', sens: 'credit', montant: 500, libelle: 'VIR COMPTE PERSO' },
        ],
      },
    }])
    // Plus de mise à jour directe du relevé : un classement sans son écriture manquerait au FEC.
    expect(faux.updatesLignes).toEqual([])
  })

  it('en engagement, sur le compte choisi pour le dirigeant', async () => {
    preparer({ montant: 2000, libelle: 'VIR APPORT' })
    rendre(ENGAGEMENT)
    await ouvrir('VIR APPORT')
    expect(within(volet()).getByText(/il s’écrit sur le compte 455000 \(Associés — comptes courants\)/)).toBeTruthy()
    await act(async () => { within(volet()).getByRole('button', { name: 'Virement personnel' }).click() })

    await waitFor(() => expect(faux.rpcs).toHaveLength(1))
    expect(faux.rpcs[0].args.p_ecritures).toEqual([
      { compte: '455000', sens: 'credit', montant: 2000, libelle: 'VIR APPORT' },
      { compte: '512000', sens: 'debit', montant: 2000, libelle: 'VIR APPORT' },
    ])
  })

  it('un refus de la base se dit, et le mouvement reste à traiter', async () => {
    preparer()
    faux.erreurRpc = 'refus simulé'
    const alerte = vi.spyOn(window, 'alert').mockImplementation(() => {})
    rendre()
    await ouvrir('VIR COMPTE PERSO')
    await act(async () => { within(volet()).getByRole('button', { name: 'Virement personnel' }).click() })

    await waitFor(() => expect(alerte).toHaveBeenCalledWith(expect.stringMatching(/Le mouvement n'a pas pu être classé en virement personnel : refus simulé/)))
    expect(within(volet()).getByText('Non rapproché')).toBeTruthy()
  })

  it('un mouvement de zéro euro est refusé avant l’appel', async () => {
    preparer({ montant: 0 })
    const alerte = vi.spyOn(window, 'alert').mockImplementation(() => {})
    rendre()
    await ouvrir('VIR COMPTE PERSO')
    await act(async () => { within(volet()).getByRole('button', { name: 'Virement personnel' }).click() })

    expect(alerte).toHaveBeenCalledWith('Un mouvement de zéro euro n’a rien à écrire.')
    expect(faux.rpcs).toEqual([])
  })

  it('remettre à traiter un virement personnel passe par la base, qui retire son écriture', async () => {
    preparer({ statut: 'ignoree', prelevement_personnel: true })
    rendre()
    await act(async () => { (await screen.findByRole('button', { name: 'Ignorés' })).click() })
    await ouvrir('VIR COMPTE PERSO')
    expect(within(volet()).getByText(/« Remettre à traiter » retire aussi son écriture/)).toBeTruthy()
    await act(async () => { within(volet()).getByRole('button', { name: 'Remettre à traiter' }).click() })

    await waitFor(() => expect(within(volet()).getByText('Non rapproché')).toBeTruthy())
    expect(faux.rpcs).toEqual([{ nom: 'retirer_virement_personnel', args: { p_ligne_bancaire_id: 'ligne-1' } }])
    expect(faux.updatesLignes).toEqual([])
  })

  it('un mouvement ignoré qui n’est pas un virement personnel se remet à traiter sans la base', async () => {
    // Garde SYMÉTRIQUE : sans lui, « un virement personnel passe par la base » serait satisfait par un
    // écran qui y envoie TOUS les mouvements ignorés — et la fonction refuse ceux qui n'en sont pas.
    preparer({ statut: 'ignoree' })
    faux.majImmediate = true
    rendre()
    await act(async () => { (await screen.findByRole('button', { name: 'Ignorés' })).click() })
    await ouvrir('VIR COMPTE PERSO')
    await act(async () => { within(volet()).getByRole('button', { name: 'Remettre à traiter' }).click() })

    await waitFor(() => expect(within(volet()).getByText('Non rapproché')).toBeTruthy())
    expect(faux.rpcs).toEqual([])
  })
})

// UNE ÉCHÉANCE DE COTISATION RAPPROCHÉE S'ÉCRIT (lib/cotisationRapprochee.ts). Ce qu'aucun test de `src/lib`
// ne peut voir : que le rapprochement parte par la fonction de la base avec son écriture — jamais par une
// mise à jour de la ligne —, depuis la fiche comme depuis « Tout rapprocher » ; que l'annulation passe par
// la base, qui retire l'écriture ; que ce que la base refuserait soit dit avant le clic ; et qu'un
// rapprochement qui ne peut pas s'écrire se voie dans la liste et la fiche.
describe('BanqueTab — une échéance de cotisation rapprochée s’écrit', () => {
  function echeance(o: Partial<CotisationDeclaree> = {}): CotisationDeclaree {
    return {
      id: 'cot-1', dossier_id: 'dossier-de-test', echeance: '2025-06-05', montant_appele: 100, montant_verse: null,
      montant_csg_crds: 9.7, previsionnel: false, created_at: '2025-01-10T09:00:00Z', ...o,
    }
  }
  function preparer(ligne: Partial<LigneBancaire> = {}, cotisation: Partial<CotisationDeclaree> = {}) {
    reinitialiser()
    faux.pieces = []
    faux.cotisations = [echeance(cotisation)]
    faux.lignes = [ligneDeTest({ libelle: 'PRLV URSSAF', date: '2025-06-06', ...ligne })]
  }

  it('rapproche l’échéance proposée par la base, avec son écriture, et reste sur le mouvement', async () => {
    preparer()
    rendre()
    await ouvrir('PRLV URSSAF')
    await act(async () => { within(volet()).getByRole('button', { name: 'Associer cette échéance' }).click() })

    await waitFor(() => expect(within(volet()).getByRole('heading', { name: 'Rapproché avec' })).toBeTruthy())
    expect(faux.rpcs).toEqual([{
      nom: 'rapprocher_cotisation',
      args: {
        p_ligne_bancaire_id: 'ligne-1',
        p_cotisation_id: 'cot-1',
        p_ecritures: [
          { compte: '512000', sens: 'credit', montant: 100, libelle: 'PRLV URSSAF' },
          { compte: '646000', sens: 'debit', montant: 90.3, libelle: 'PRLV URSSAF' },
          { compte: '108000', sens: 'debit', montant: 9.7, libelle: 'PRLV URSSAF' },
        ],
      },
    }])
    // Plus de mise à jour directe du relevé : un rapprochement sans son écriture manquerait au FEC.
    expect(faux.updatesLignes).toEqual([])
  })

  it('en engagement, la CSG-CRDS reste au 646000', async () => {
    preparer()
    rendre(ENGAGEMENT)
    await ouvrir('PRLV URSSAF')
    await act(async () => { within(volet()).getByRole('button', { name: 'Associer cette échéance' }).click() })

    await waitFor(() => expect(faux.rpcs).toHaveLength(1))
    expect(faux.rpcs[0].args.p_ecritures).toEqual([
      { compte: '512000', sens: 'credit', montant: 100, libelle: 'PRLV URSSAF' },
      { compte: '646000', sens: 'debit', montant: 100, libelle: 'PRLV URSSAF' },
    ])
  })

  it('une CSG-CRDS plus grande que le mouvement : dit avant le clic, et rien ne part', async () => {
    preparer({}, { montant_csg_crds: 150 })
    rendre()
    await ouvrir('PRLV URSSAF')

    const bouton = within(volet()).getByRole('button', { name: 'Associer cette échéance' })
    expect(bouton.hasAttribute('disabled')).toBe(true)
    expect(within(volet()).getByText(/La CSG-CRDS de cette échéance \(150,00\s€\) dépasse le mouvement \(100,00\s€\)\./)).toBeTruthy()
    await act(async () => { bouton.click() })
    expect(faux.rpcs).toEqual([])
  })

  it('le choix à la main dit le refus avant le clic : un encaissement ne paie pas un appel', async () => {
    // Le sens écarte l'échéance des propositions ; le choix à la main l'offre encore, et le dit.
    preparer({ montant: 100, libelle: 'VIR URSSAF' })
    rendre()
    await ouvrir('VIR URSSAF')
    const liste = within(volet()).getByLabelText('Échéance de cotisation') as HTMLSelectElement
    await act(async () => { fireEvent.change(liste, { target: { value: 'cot-1' } }) })

    expect(within(volet()).getByText(/Ce mouvement est un encaissement : il ne paie pas un appel de cotisation\./)).toBeTruthy()
    const associer = within(liste.closest('.field') as HTMLElement).getByRole('button', { name: 'Associer' })
    expect(associer.hasAttribute('disabled')).toBe(true)
  })

  it('annuler le rapprochement passe par la base, qui retire son écriture', async () => {
    preparer({ statut: 'rapprochee', cotisation_id: 'cot-1' })
    rendre()
    await act(async () => { (await screen.findByRole('button', { name: 'Rapprochés' })).click() })
    await ouvrir('PRLV URSSAF')
    await act(async () => { within(volet()).getByRole('button', { name: 'Annuler le rapprochement' }).click() })

    await waitFor(() => expect(within(volet()).getByText('Non rapproché')).toBeTruthy())
    expect(faux.rpcs).toEqual([{ nom: 'retirer_rapprochement_cotisation', args: { p_ligne_bancaire_id: 'ligne-1' } }])
    expect(faux.updatesLignes).toEqual([])
  })

  it('« Tout rapprocher » passe une échéance par la base, avec son écriture', async () => {
    preparer()
    rendre()
    const bouton = await screen.findByRole('button', { name: /Tout rapprocher automatiquement \(1\)/ })
    await act(async () => { bouton.click() })

    await waitFor(() => expect(faux.rpcs).toHaveLength(1))
    expect(faux.rpcs[0]).toEqual({
      nom: 'rapprocher_cotisation',
      args: expect.objectContaining({ p_ligne_bancaire_id: 'ligne-1', p_cotisation_id: 'cot-1' }),
    })
    expect(faux.updatesLignes).toEqual([])
  })

  it('« Ne s’écrit pas » sur un encaissement rapproché d’un appel, et la fiche dit pourquoi', async () => {
    preparer({ montant: 100, statut: 'rapprochee', cotisation_id: 'cot-1' })
    rendre()
    await act(async () => { (await screen.findByRole('button', { name: 'Rapprochés' })).click() })

    expect(await screen.findByText('Ne s’écrit pas')).toBeTruthy()
    await ouvrir('PRLV URSSAF')
    expect(within(volet()).getByText(/Ce rapprochement ne peut pas s’écrire : Ce mouvement est un encaissement/)).toBeTruthy()
    expect(within(volet()).getByText(/Annule-le pour le refaire\./)).toBeTruthy()
    // Et la fiche ne prétend pas dire comment il s'écrit.
    expect(within(volet()).queryByText(/S’écrit face à la banque/)).toBeNull()
  })

  // LIGNE 26.6 (d) : d'un exercice validé, ni le mouvement ni l'échéance ne changent plus. La pastille appellerait un
  // geste que la base refuse, et la fiche ne conseille plus d'annuler ; ce qu'elle dit reste vrai — il manque au FEC.
  it('d’un exercice validé, ni pastille ni conseil d’annuler : le rapprochement ne change plus', async () => {
    preparer({ montant: 100, statut: 'rapprochee', cotisation_id: 'cot-1' })
    rendre(TRESORERIE, false, [2025])
    await act(async () => { (await screen.findByRole('button', { name: 'Rapprochés' })).click() })

    expect(await screen.findByText(/Rapproché — Cotisation du 05\/06\/2025/)).toBeTruthy()
    expect(screen.queryByText('Ne s’écrit pas')).toBeNull()
    await ouvrir('PRLV URSSAF')
    expect(within(volet()).getByText(/Ce rapprochement ne peut pas s’écrire : Ce mouvement est un encaissement/)).toBeTruthy()
    expect(within(volet()).queryByText(/Annule-le pour le refaire/)).toBeNull()
  })

  it('la fiche dit comment l’échéance payée s’écrit — sans le 108000 en engagement', async () => {
    // Sans cette note, une échéance écrite et une échéance rapprochée avant que le rapprochement écrive se
    // ressemblaient dans la fiche : elle ne lit pas le brouillon, et renvoie à l'onglet Cotisations.
    preparer({ statut: 'rapprochee', cotisation_id: 'cot-1' })
    rendre()
    await act(async () => { (await screen.findByRole('button', { name: 'Rapprochés' })).click() })
    await ouvrir('PRLV URSSAF')
    expect(within(volet()).getByText(/S’écrit face à la banque : 90,30\s€ au 646000 — Cotisations sociales personnelles de l'exploitant ; 9,70\s€ au 108000 — Compte de l'exploitant \(sa CSG-CRDS\)\. « Annuler le rapprochement » retire aussi son écriture ; l’onglet Cotisations dit si elle manque, et l’écrit\./)).toBeTruthy()

    cleanup()
    preparer({ statut: 'rapprochee', cotisation_id: 'cot-1' })
    rendre(ENGAGEMENT)
    await act(async () => { (await screen.findByRole('button', { name: 'Rapprochés' })).click() })
    await ouvrir('PRLV URSSAF')
    expect(within(volet()).getByText(/S’écrit face à la banque : 100,00\s€ au 646000 — Cotisations sociales personnelles de l'exploitant\./)).toBeTruthy()
    expect(within(volet()).queryByText(/108000/)).toBeNull()
  })

  it('aucune pastille sur un prélèvement qui paie son appel', async () => {
    // Garde SYMÉTRIQUE : sans lui, « la pastille dit le rapprochement qui ne s'écrit pas » serait
    // satisfait par une pastille sur TOUT rapprochement d'échéance.
    preparer({ statut: 'rapprochee', cotisation_id: 'cot-1' })
    rendre()
    await act(async () => { (await screen.findByRole('button', { name: 'Rapprochés' })).click() })

    expect(await screen.findByText(/Rapproché — Cotisation du 05\/06\/2025/)).toBeTruthy()
    expect(screen.queryByText('Ne s’écrit pas')).toBeNull()
    await ouvrir('PRLV URSSAF')
    expect(within(volet()).queryByText(/ne peut pas s’écrire/)).toBeNull()
  })

  it('« Tout rapprocher » écrit dans le modèle du dossier : en engagement, la CSG-CRDS reste au 646000', async () => {
    preparer()
    rendre(ENGAGEMENT)
    const bouton = await screen.findByRole('button', { name: /Tout rapprocher automatiquement \(1\)/ })
    await act(async () => { bouton.click() })

    await waitFor(() => expect(faux.rpcs).toHaveLength(1))
    expect(faux.rpcs[0].args.p_ecritures).toEqual([
      { compte: '512000', sens: 'credit', montant: 100, libelle: 'PRLV URSSAF' },
      { compte: '646000', sens: 'debit', montant: 100, libelle: 'PRLV URSSAF' },
    ])
  })

  it('la pastille suit le modèle : une CSG-CRDS au-delà du mouvement ne gêne qu’en trésorerie', async () => {
    // En trésorerie la CSG-CRDS passe au 108000 : plus grande que le prélèvement, l'écriture est impossible.
    preparer({ statut: 'rapprochee', cotisation_id: 'cot-1' }, { montant_csg_crds: 150 })
    rendre()
    await act(async () => { (await screen.findByRole('button', { name: 'Rapprochés' })).click() })
    expect(await screen.findByText('Ne s’écrit pas')).toBeTruthy()

    // En engagement elle reste au 646000 avec le reste : rien n'empêche l'écriture.
    cleanup()
    preparer({ statut: 'rapprochee', cotisation_id: 'cot-1' }, { montant_csg_crds: 150 })
    rendre(ENGAGEMENT)
    await act(async () => { (await screen.findByRole('button', { name: 'Rapprochés' })).click() })
    expect(await screen.findByText(/Rapproché — Cotisation du 05\/06\/2025/)).toBeTruthy()
    expect(screen.queryByText('Ne s’écrit pas')).toBeNull()
  })

  it('parmi plusieurs échéances, celle que la base refuserait ne s’associe pas, et dit pourquoi', async () => {
    preparer()
    faux.cotisations = [echeance(), echeance({ id: 'cot-2', echeance: '2025-06-07', montant_csg_crds: 150 })]
    rendre()
    await ouvrir('PRLV URSSAF')

    const boutons = within(volet()).getAllByRole('button', { name: 'Associer celle-ci' })
    expect(boutons).toHaveLength(2)
    const refuses = boutons.filter((b) => b.hasAttribute('disabled'))
    expect(refuses).toHaveLength(1)
    expect(refuses[0].getAttribute('title')).toMatch(/La CSG-CRDS de cette échéance \(150,00\s€\) dépasse le mouvement \(100,00\s€\)\./)
    await act(async () => { refuses[0].click() })
    expect(faux.rpcs).toEqual([])
  })

  it('rapprocher une pièce ne touche pas au lien d’une échéance : la base refuserait le conflit', async () => {
    // Le lien vers une échéance n'est plus remis à zéro par la mise à jour d'une pièce : posé entre-temps
    // ailleurs, il ferait refuser la mise à jour au lieu d'être défait en silence, son écriture laissée.
    reinitialiser()
    faux.majImmediate = true
    rendre()
    await ouvrir()
    await act(async () => { within(volet()).getByRole('button', { name: 'Associer cette pièce' }).click() })

    await waitFor(() => expect(faux.updatesLignes).toHaveLength(1))
    expect(faux.updatesLignes[0]).toEqual({ statut: 'rapprochee', piece_id: 'piece-1' })
  })
})

// UNE ÉCHÉANCE D'EMPRUNT SE DÉCOUPE ET S'ÉCRIT (lib/echeanceEmprunt.ts). Ce qu'aucun test de `src/lib` ne
// peut voir : que le découpage PROPOSÉ ne parte qu'au clic, par la fonction SQL et jamais par une mise à
// jour de la ligne, UNE fois sous trois clics ; que les champs se corrigent et que le capital suive ; qu'un
// paiement qui ne ressemble à rien garde le geste replié ; que la liste et la fiche disent l'échéance au
// lieu d'un « Rapproché » nu — et qu'un paiement qui ressemble à une échéance n'entre pas dans le lot des
// règles, où son capital serait affecté en charge.
describe('BanqueTab — une échéance d’emprunt se découpe et s’écrit', () => {
  // 12 000 € à 3,6 % sur 24 mois depuis le 5 janvier 2025 : mensualité 518,97 €, et l'échéance 1 (5 février)
  // porte 36,00 € d'intérêts pour 482,97 € de capital ; l'échéance 3 (5 avril), 33,10 € pour 485,87 €.
  const EMPRUNT: Emprunt = {
    id: 'emp-1', dossier_id: 'dossier-de-test', nom: 'Prêt matériel', organisme_preteur: 'Banque du Midi',
    capital_initial: 12000, taux_annuel: 3.6, date_debut: '2025-01-05', duree_mois: 24, created_at: '2025-01-05T10:00:00Z',
  }
  // Le prélèvement porte 21,03 € de plus que l'échéance : l'assurance de l'emprunteur.
  const ECHEANCE = { libelle: 'PRLV ECHEANCE PRET', montant: -540, date: '2025-02-06' }
  const RAPPROCHEE: Partial<LigneBancaire> = {
    ...ECHEANCE, statut: 'rapprochee', emprunt_id: 'emp-1', emprunt_echeance: 1, emprunt_interets: 36, emprunt_assurance: 21.03,
  }

  function preparer(ligne: Partial<LigneBancaire> = ECHEANCE) {
    reinitialiser()
    faux.pieces = []
    faux.emprunts = [EMPRUNT]
    faux.lignes = [ligneDeTest({ ...ECHEANCE, ...ligne })]
  }
  const champ = (nom: string) => within(volet()).getByLabelText(nom) as HTMLInputElement
  const saisir = (nom: string, valeur: string) => fireEvent.change(champ(nom), { target: { value: valeur } })
  const rapprochements = () => faux.rpcs.filter((r) => r.nom === 'rapprocher_echeance_emprunt')
  async function voirLesRapproches() {
    await act(async () => { (await screen.findByRole('button', { name: 'Rapprochés' })).click() })
  }

  it('propose l’échéance à laquelle le paiement ressemble, et ne l’écrit qu’au clic, par la base', async () => {
    preparer()
    rendre()
    await ouvrir('PRLV ECHEANCE PRET')
    expect(within(volet()).getByText('Échéance d’emprunt proposée')).toBeTruthy()
    expect(champ('Échéance n°').value).toBe('1')
    expect(champ('Intérêts (661100)').value).toBe('36.00')
    expect(champ('Assurance (616800)').value).toBe('21.03')
    expect(within(volet()).getByText(/L’échéancier prévoit 518,97.*le 05\/02\/2025.*21,03.*de plus/)).toBeTruthy()
    expect(within(volet()).getByText(/Capital remboursé/).textContent).toMatch(/482,97/)
    // Ce que l'affectation coûterait, dit sous « Sans justificatif » ; et une proposition existe, donc
    // l'écran ne dit pas qu'il n'y en a aucune.
    expect(within(volet()).getByText(/ressemble à une échéance d’emprunt \(ci-dessus\) : affecté à une catégorie, son capital compterait en charge/)).toBeTruthy()
    expect(within(volet()).queryByText('Aucune pièce proposée pour ce mouvement.')).toBeNull()
    expect(faux.rpcs).toEqual([])

    await act(async () => { within(volet()).getByRole('button', { name: 'Rapprocher de cette échéance' }).click() })

    expect(faux.rpcs).toEqual([{
      nom: 'rapprocher_echeance_emprunt',
      args: {
        p_ligne_bancaire_id: 'ligne-1', p_emprunt_id: 'emp-1', p_echeance: 1, p_interets: 36, p_assurance: 21.03,
        p_ecritures: [
          { compte: '164000', sens: 'debit', montant: 482.97, libelle: 'PRLV ECHEANCE PRET' },
          { compte: '661100', sens: 'debit', montant: 36, libelle: 'PRLV ECHEANCE PRET' },
          { compte: '616800', sens: 'debit', montant: 21.03, libelle: 'PRLV ECHEANCE PRET' },
          { compte: '512000', sens: 'credit', montant: 540, libelle: 'PRLV ECHEANCE PRET' },
        ],
      },
    }])
    // Jamais une mise à jour directe de la ligne : le rapprochement et son écriture partent ensemble.
    expect(faux.updatesLignes).toEqual([])
    // La fiche RESTE sur le mouvement, dans son nouvel état.
    await waitFor(() => expect(within(volet()).getByText('Échéance n° 1 — Prêt matériel')).toBeTruthy())
    expect(within(volet()).getByRole('button', { name: 'Annuler le rapprochement' })).toBeTruthy()
  })

  it('changer de numéro repropose les intérêts de ce mois-là, sans rien écrire', async () => {
    preparer()
    rendre()
    await ouvrir('PRLV ECHEANCE PRET')
    saisir('Échéance n°', '3')
    expect(champ('Intérêts (661100)').value).toBe('33.10')
    expect(champ('Assurance (616800)').value).toBe('21.03')
    expect(within(volet()).getByText(/L’échéancier prévoit 518,97.*le 05\/04\/2025/)).toBeTruthy()
    // Loin du mouvement, c'est dit : une échéance éloignée d'un mois n'est sans doute pas la bonne.
    expect(within(volet()).getByText(/Cette échéance tombe à 58 jours du mouvement/)).toBeTruthy()
    expect(faux.rpcs).toEqual([])
    await act(async () => { within(volet()).getByRole('button', { name: 'Rapprocher de cette échéance' }).click() })
    expect(rapprochements()[0].args).toMatchObject({ p_echeance: 3, p_interets: 33.1, p_assurance: 21.03 })
  })

  it('corriger les montants recalcule le capital, et refuse ce que la base refuserait', async () => {
    preparer()
    rendre()
    await ouvrir('PRLV ECHEANCE PRET')
    saisir('Intérêts (661100)', '30.5')
    expect(within(volet()).getByText(/Capital remboursé/).textContent).toMatch(/488,47/)

    saisir('Intérêts (661100)', '600')
    expect(within(volet()).getByText(/Découpage impossible : les intérêts et l’assurance sont positifs, au centime, et ne dépassent pas le prélèvement/)).toBeTruthy()
    expect(within(volet()).queryByText(/Capital remboursé/)).toBeNull()
    const bouton = within(volet()).getByRole('button', { name: 'Rapprocher de cette échéance' })
    expect(bouton.hasAttribute('disabled')).toBe(true)

    saisir('Intérêts (661100)', '36')
    saisir('Assurance (616800)', '')
    expect(within(volet()).getByText('Saisis les intérêts et l’assurance — 0 s’il n’y en a pas.')).toBeTruthy()
    expect(bouton.hasAttribute('disabled')).toBe(true)
    await act(async () => { bouton.click() })
    expect(faux.rpcs).toEqual([])

    saisir('Assurance (616800)', '0')
    expect(bouton.hasAttribute('disabled')).toBe(false)
  })

  it('refuse une échéance déjà payée par un autre mouvement, en disant lequel', async () => {
    preparer({ ...ECHEANCE, date: '2025-03-06' })
    faux.lignes.push(ligneDeTest({ ...RAPPROCHEE, id: 'ligne-payee', date: '2025-02-05', libelle: 'PRLV ECHEANCE PRET FEVRIER' }))
    rendre()
    await ouvrir('PRLV ECHEANCE PRET')
    // L'échéance 1 est payée : c'est la 2 qui est proposée.
    expect(champ('Échéance n°').value).toBe('2')
    saisir('Échéance n°', '1')
    expect(within(volet()).getByText('L’échéance n° 1 de cet emprunt est déjà rapprochée du mouvement du 05/02/2025.')).toBeTruthy()
    expect(within(volet()).getByRole('button', { name: 'Rapprocher de cette échéance' }).hasAttribute('disabled')).toBe(true)
  })

  it('un paiement qui ne ressemble à aucune échéance garde le geste, replié', async () => {
    preparer({ libelle: 'PRLV SEPA TRANSMEDICAL', montant: -38.4, date: '2025-02-06' })
    rendre()
    await ouvrir('PRLV SEPA TRANSMEDICAL')
    expect(within(volet()).queryByText('Échéance d’emprunt proposée')).toBeNull()
    expect(within(volet()).getByText('Aucune pièce proposée pour ce mouvement.')).toBeTruthy()
    expect(within(volet()).queryByText(/ressemble à une échéance/)).toBeNull()
    expect(within(volet()).queryByLabelText('Échéance n°')).toBeNull()

    await act(async () => { within(volet()).getByRole('button', { name: 'Rapprocher d’un emprunt…' }).click() })
    // Le seul emprunt du dossier est choisi, et son échéance la plus proche proposée — ramenée à ce que le
    // prélèvement peut porter, et l'écart dit.
    expect((within(volet()).getByLabelText('Emprunt') as HTMLSelectElement).value).toBe('emp-1')
    expect(champ('Échéance n°').value).toBe('1')
    expect(champ('Intérêts (661100)').value).toBe('36.00')
    expect(champ('Assurance (616800)').value).toBe('0.00')
    expect(within(volet()).getByText(/Le prélèvement est inférieur de 480,57/)).toBeTruthy()
    await act(async () => { within(volet()).getByRole('button', { name: 'Rapprocher de cette échéance' }).click() })
    expect(rapprochements()).toHaveLength(1)
  })

  it('un déblocage : les fonds reçus, au crédit du 164', async () => {
    preparer({ libelle: 'VIR DEBLOCAGE PRET', montant: 12000, date: '2025-01-07' })
    rendre()
    await ouvrir('VIR DEBLOCAGE PRET')
    expect(within(volet()).getByText('Déblocage d’emprunt proposé')).toBeTruthy()
    expect(within(volet()).queryByLabelText('Échéance n°')).toBeNull()
    expect(within(volet()).getByText(/ressemble au déblocage d’un emprunt \(ci-dessus\) : affecté à une catégorie, il compterait en recette/)).toBeTruthy()
    await act(async () => { within(volet()).getByRole('button', { name: 'Rapprocher du déblocage' }).click() })
    expect(faux.rpcs).toEqual([{
      nom: 'rapprocher_echeance_emprunt',
      args: {
        p_ligne_bancaire_id: 'ligne-1', p_emprunt_id: 'emp-1', p_echeance: null, p_interets: 0, p_assurance: 0,
        p_ecritures: [
          { compte: '164000', sens: 'credit', montant: 12000, libelle: 'VIR DEBLOCAGE PRET' },
          { compte: '512000', sens: 'debit', montant: 12000, libelle: 'VIR DEBLOCAGE PRET' },
        ],
      },
    }])
    await waitFor(() => expect(within(volet()).getByText('Déblocage d’emprunt — Prêt matériel')).toBeTruthy())
  })

  it('n’écrit qu’une fois, même sur trois clics rapprochés', async () => {
    preparer()
    rendre()
    await ouvrir('PRLV ECHEANCE PRET')
    const bouton = within(volet()).getByRole('button', { name: 'Rapprocher de cette échéance' })
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(rapprochements()).toHaveLength(1)
  })

  // Relâché avant la relecture, le verrou laisserait le formulaire cliquable sur un mouvement déjà
  // rapproché : un second clic réécrirait le rapprochement. Le bouton le montre.
  it('reste verrouillé tant que la relecture du relevé n’est pas revenue', async () => {
    preparer()
    rendre()
    await ouvrir('PRLV ECHEANCE PRET')
    faux.retenirLectureLignes = true
    await act(async () => { within(volet()).getByRole('button', { name: 'Rapprocher de cette échéance' }).click() })
    expect(within(volet()).getByRole('button', { name: 'Rapprocher de cette échéance' }).hasAttribute('disabled')).toBe(true)
    await act(async () => { faux.resoudreLectureLignes?.() })
    await waitFor(() => expect(within(volet()).getByText('Échéance n° 1 — Prêt matériel')).toBeTruthy())
  })

  it('un refus de la base se dit, et le mouvement reste à traiter', async () => {
    preparer()
    faux.erreurRpc = 'refus simulé'
    const alerte = vi.spyOn(window, 'alert').mockImplementation(() => {})
    rendre()
    await ouvrir('PRLV ECHEANCE PRET')
    await act(async () => { within(volet()).getByRole('button', { name: 'Rapprocher de cette échéance' }).click() })
    await waitFor(() => expect(alerte).toHaveBeenCalledWith(expect.stringMatching(/Le rapprochement de l'emprunt n'a pas pu être enregistré : refus simulé/)))
    expect(within(volet()).getByText('Non rapproché')).toBeTruthy()
  })

  it('la liste dit l’échéance et l’emprunt, jamais un « Rapproché » nu ni « sans justificatif »', async () => {
    preparer(RAPPROCHEE)
    rendre()
    await voirLesRapproches()
    expect(await screen.findByText('Échéance n° 1 — Prêt matériel')).toBeTruthy()
    expect(screen.queryByText(/^Rapproché$/)).toBeNull()
    expect(screen.queryByText('Rapproché sans justificatif')).toBeNull()
  })

  it('la fiche montre le découpage, et annule le rapprochement par la base', async () => {
    preparer(RAPPROCHEE)
    rendre()
    await voirLesRapproches()
    await ouvrir('PRLV ECHEANCE PRET')
    const decoupage = within(volet()).getByText('Capital remboursé (164000)').closest('dl')
    expect(decoupage?.textContent).toMatch(/Capital remboursé \(164000\)482,97.*Intérêts \(661100\)36,00.*Assurance \(616800\)21,03/)
    expect(within(volet()).queryByText('Rapproché avec')).toBeNull()
    expect(within(volet()).queryByText(/^Rapproché$/)).toBeNull()
    await act(async () => { within(volet()).getByRole('button', { name: 'Annuler le rapprochement' }).click() })
    await waitFor(() => expect(within(volet()).getByText('Non rapproché')).toBeTruthy())
    expect(faux.rpcs).toEqual([{ nom: 'retirer_echeance_emprunt', args: { p_ligne_bancaire_id: 'ligne-1' } }])
    expect(faux.updatesLignes).toEqual([])
  })

  it('dit une annulation que la base refuse, et le mouvement reste rapproché', async () => {
    preparer(RAPPROCHEE)
    faux.erreurRpc = 'refus simulé'
    const alerte = vi.spyOn(window, 'alert').mockImplementation(() => {})
    rendre()
    await voirLesRapproches()
    await ouvrir('PRLV ECHEANCE PRET')
    await act(async () => { within(volet()).getByRole('button', { name: 'Annuler le rapprochement' }).click() })
    await waitFor(() => expect(alerte).toHaveBeenCalledWith(expect.stringMatching(/Le rapprochement de l'emprunt n'a pas pu être annulé : refus simulé/)))
    expect(within(volet()).getByText('Échéance n° 1 — Prêt matériel')).toBeTruthy()
  })

  it('corrige le découpage d’une échéance déjà rapprochée, depuis celui que la base garde', async () => {
    preparer(RAPPROCHEE)
    rendre()
    await voirLesRapproches()
    await ouvrir('PRLV ECHEANCE PRET')
    expect(within(volet()).queryByLabelText('Intérêts (661100)')).toBeNull()
    await act(async () => { within(volet()).getByRole('button', { name: 'Corriger le découpage…' }).click() })
    expect(champ('Échéance n°').value).toBe('1')
    expect(champ('Intérêts (661100)').value).toBe('36.00')
    expect(champ('Assurance (616800)').value).toBe('21.03')
    saisir('Intérêts (661100)', '35')
    await act(async () => { within(volet()).getByRole('button', { name: 'Enregistrer le découpage' }).click() })
    expect(rapprochements()[0].args).toMatchObject({
      p_echeance: 1, p_interets: 35, p_assurance: 21.03,
      p_ecritures: [
        { compte: '164000', sens: 'debit', montant: 483.97, libelle: 'PRLV ECHEANCE PRET' },
        { compte: '661100', sens: 'debit', montant: 35, libelle: 'PRLV ECHEANCE PRET' },
        { compte: '616800', sens: 'debit', montant: 21.03, libelle: 'PRLV ECHEANCE PRET' },
        { compte: '512000', sens: 'credit', montant: 540, libelle: 'PRLV ECHEANCE PRET' },
      ],
    })
  })

  // Le découpage de départ d'une correction est celui que la BASE GARDE, validé sur le tableau de la
  // banque — pas la proposition de l'échéancier. Dans le cas ci-dessus les deux coïncident, et c'est ce qui
  // laissait passer la mutation qui repart de la proposition : d'où des montants qui s'en écartent.
  it('repart du découpage gardé, même quand il s’écarte de l’échéancier', async () => {
    preparer({ ...RAPPROCHEE, emprunt_interets: 35.1, emprunt_assurance: 22 })
    rendre()
    await voirLesRapproches()
    await ouvrir('PRLV ECHEANCE PRET')
    await act(async () => { within(volet()).getByRole('button', { name: 'Corriger le découpage…' }).click() })
    expect(champ('Intérêts (661100)').value).toBe('35.10')
    expect(champ('Assurance (616800)').value).toBe('22.00')
  })

  it('dit qu’une échéance rapprochée désigne un emprunt qui n’a pas été lu', async () => {
    preparer(RAPPROCHEE)
    faux.emprunts = []
    rendre()
    await voirLesRapproches()
    await ouvrir('PRLV ECHEANCE PRET')
    expect(within(volet()).getByText('L’emprunt rapproché ne figure pas parmi les emprunts lus.')).toBeTruthy()
    expect(within(volet()).queryByRole('button', { name: 'Corriger le découpage…' })).toBeNull()
  })

  it('la liste signale un paiement qui ressemble à une échéance', async () => {
    preparer()
    faux.lignes.push(ligneDeTest({ id: 'autre', libelle: 'PRLV SEPA TRANSMEDICAL', montant: -38.4, date: '2025-02-06' }))
    rendre()
    const ligne = (await screen.findAllByText('PRLV ECHEANCE PRET')).find((e) => e.closest('tr')?.classList.contains('clickable'))
    expect(ligne?.closest('tr')?.textContent).toMatch(/Non rapproché · suggestion/)
    const autre = (await screen.findAllByText('PRLV SEPA TRANSMEDICAL')).find((e) => e.closest('tr')?.classList.contains('clickable'))
    expect(autre?.closest('tr')?.textContent).not.toMatch(/suggestion/)
  })

  it('un dossier sans emprunt ne parle pas d’emprunt', async () => {
    preparer()
    faux.emprunts = []
    rendre()
    await ouvrir('PRLV ECHEANCE PRET')
    expect(within(volet()).queryByText(/emprunt/i)).toBeNull()
  })

  const FRAIS = categorieDeTest()
  function preparerLot() {
    preparer({ libelle: 'PRLV BANQUE DU MIDI ECHEANCE' })
    faux.categories = [FRAIS]
    faux.lignes.push(ligneDeTest({ id: 'l-frais', libelle: 'FRAIS BANQUE DU MIDI', montant: -8.5, date: '2025-02-10' }))
    faux.reglesAffectation = [regleDeTest({ motif: 'banque du midi', sens: 'decaissement', categorie_id: 'cat-frais' })]
  }

  // Une règle au nom de la banque désigne ses frais ET ses échéances : affectée en lot à « Frais
  // bancaires », l'échéance y porterait son capital en charge.
  it('écarte du lot des règles un paiement qui ressemble à une échéance, et le dit', async () => {
    preparerLot()
    rendre()
    expect(await screen.findByText('Affectations proposées par vos règles (1)')).toBeTruthy()
    expect(screen.getByText(/1 mouvement à rapprocher plutôt qu'affecter/)).toBeTruthy()
    expect(screen.getByText(/Il ressemble à l’échéance n° 1 de l’emprunt « Prêt matériel » : à rapprocher de l’emprunt, pas à affecter/)).toBeTruthy()
    await act(async () => { screen.getByRole('button', { name: 'Affecter ce mouvement' }).click() })
    const envoi = faux.rpcs.find((r) => r.nom === 'affecter_mouvements_bancaires')
    expect(envoi).toBeTruthy()
    expect((envoi!.args.p_affectations as { ligne_bancaire_id: string }[]).map((a) => a.ligne_bancaire_id)).toEqual(['l-frais'])
  })

  it('suspend le lot sur une lecture partielle des emprunts, et le dit — jusque dans la fiche', async () => {
    preparerLot()
    faux.muet = { emprunts: 0 }
    rendre()
    expect(await screen.findByText(/Les emprunts n'ont pas pu être lus en entier/)).toBeTruthy()
    expect(screen.getByText(/Affectation en lot suspendue/)).toBeTruthy()
    // Sans les emprunts, l'échéance n'est plus reconnue : le lot la proposerait avec les frais — c'est
    // précisément ce que la suspension empêche d'écrire.
    const bouton = screen.getByRole('button', { name: 'Affecter les 2' })
    expect(bouton.hasAttribute('disabled')).toBe(true)
    await act(async () => { bouton.click() })
    expect(faux.rpcs.filter((r) => r.nom === 'affecter_mouvements_bancaires')).toEqual([])
    await ouvrir('PRLV BANQUE DU MIDI ECHEANCE')
    expect(within(volet()).getByText(/La liste des emprunts n’a pas pu être lue en entier/)).toBeTruthy()
  })
})

describe('BanqueTab — ventiler un mouvement sur plusieurs comptes', () => {
  const TELEPHONE = categorieDeTest({
    id: 'cat-tel', code: 'telephone', libelle: 'Téléphone', ordre: 40, compte_comptable: '626000',
    poste_2035: 'Frais postaux et de télécommunications',
  })
  const FRAIS = categorieDeTest()
  const RECETTES = categorieDeTest({
    id: 'cat-recettes', code: 'ventes_prestations', libelle: 'Ventes / prestations', ordre: 10,
    compte_comptable: '706000', poste_2035: 'Recettes',
  })
  const PARTS: VentilationBancaire[] = [
    {
      id: 'part-1', dossier_id: 'dossier-de-test', ligne_bancaire_id: 'ligne-1', categorie_id: 'cat-tel', part_personnelle: false,
      montant: -84, taux_tva: null, created_at: '2025-06-02T10:00:00Z',
    },
    {
      id: 'part-2', dossier_id: 'dossier-de-test', ligne_bancaire_id: 'ligne-1', categorie_id: null, part_personnelle: true,
      montant: -36, taux_tva: null, created_at: '2025-06-02T10:00:00Z',
    },
  ]
  const VENTILEE: Partial<LigneBancaire> = { statut: 'rapprochee', ventilee: true, id_externe: null }

  function preparer(ligne: Partial<LigneBancaire> = {}, parts: VentilationBancaire[] = []) {
    reinitialiser()
    faux.pieces = []
    faux.categories = [TELEPHONE, FRAIS, RECETTES]
    faux.lignes = [ligneDeTest({ libelle: 'PRLV OPERATEUR MOBILE', montant: -120, ...ligne })]
    faux.ventilations = parts
  }
  async function voirLesRapproches() {
    await act(async () => { (await screen.findByRole('button', { name: 'Rapprochés' })).click() })
  }
  async function deplier() {
    await act(async () => { within(volet()).getByRole('button', { name: 'Ventiler sur plusieurs comptes…' }).click() })
  }
  function saisir(numero: number, cible: string, montant: string) {
    fireEvent.change(within(volet()).getByLabelText(`Compte de la part ${numero}`), { target: { value: cible } })
    fireEvent.change(within(volet()).getByLabelText(`Montant de la part ${numero}`), { target: { value: montant } })
  }
  const ventilations = () => faux.rpcs.filter((r) => r.nom === 'ventiler_mouvement_bancaire')

  it('ne ventile qu’au clic, par la base, et reste sur le mouvement ventilé', async () => {
    preparer()
    rendre()
    await ouvrir('PRLV OPERATEUR MOBILE')
    await deplier()
    saisir(1, 'cat-tel', '84')
    saisir(2, 'dirigeant', '36')
    expect(within(volet()).getByText('Les parts font le mouvement.')).toBeTruthy()
    expect(faux.rpcs).toEqual([])
    await act(async () => { within(volet()).getByRole('button', { name: 'Ventiler' }).click() })

    await waitFor(() => expect(within(volet()).getByText('Ventilé sur 2 comptes')).toBeTruthy())
    expect(faux.rpcs).toEqual([{
      nom: 'ventiler_mouvement_bancaire',
      args: {
        p_ligne_bancaire_id: 'ligne-1',
        // Signées comme le relevé : l'opérateur a saisi « 84 » et « 36 » dans le sens du paiement.
        p_parts: [
          { categorie_id: 'cat-tel', part_personnelle: false, montant: -84, taux_tva: null },
          { categorie_id: null, part_personnelle: true, montant: -36, taux_tva: null },
        ],
        p_ecritures: [
          { compte: '626000', sens: 'debit', montant: 84, libelle: 'PRLV OPERATEUR MOBILE' },
          { compte: '108000', sens: 'debit', montant: 36, libelle: 'PRLV OPERATEUR MOBILE' },
          { compte: '512000', sens: 'credit', montant: 120, libelle: 'PRLV OPERATEUR MOBILE' },
        ],
      },
    }])
    // Jamais une mise à jour directe de la ligne : la ventilation, ses parts et son écriture partent ensemble.
    expect(faux.updatesLignes).toEqual([])
    const parts = within(volet()).getByText('Téléphone (626000)').closest('dl')
    expect(parts?.textContent).toMatch(/Téléphone \(626000\)84,00.*Part personnelle \(108000\)36,00/)
    expect(within(volet()).getByRole('button', { name: 'Annuler la ventilation' })).toBeTruthy()
  })

  it('en engagement, la part personnelle va au compte choisi pour le dirigeant', async () => {
    preparer()
    rendre(ENGAGEMENT)
    await ouvrir('PRLV OPERATEUR MOBILE')
    await deplier()
    saisir(1, 'cat-tel', '84')
    saisir(2, 'dirigeant', '36')
    expect(within(volet()).getByText(/La part personnelle s’écrit sur le compte 455000/)).toBeTruthy()
    await act(async () => { within(volet()).getByRole('button', { name: 'Ventiler' }).click() })
    expect((ventilations()[0].args.p_ecritures as { compte: string }[]).map((e) => e.compte)).toEqual(['626000', '455000', '512000'])
  })

  it('demande chaque part avant de crier à l’erreur, puis dit le reste à ventiler', async () => {
    preparer()
    rendre()
    await ouvrir('PRLV OPERATEUR MOBILE')
    await deplier()
    const bouton = () => within(volet()).getByRole('button', { name: 'Ventiler' })
    // Deux lignes vides : une consigne, pas une faute.
    expect(within(volet()).getByText('Choisis le compte et le montant de chaque part.')).toBeTruthy()
    expect(within(volet()).queryByText(/Chaque part/)).toBeNull()
    expect(bouton().hasAttribute('disabled')).toBe(true)
    saisir(1, 'cat-tel', '84')
    saisir(2, 'dirigeant', '30')
    expect(within(volet()).getByText(/Reste à ventiler : 6,00/)).toBeTruthy()
    expect(within(volet()).getByText(/Les parts font 114,00.*au lieu des 120,00.*du mouvement\./)).toBeTruthy()
    expect(bouton().hasAttribute('disabled')).toBe(true)
    saisir(2, 'dirigeant', '40')
    expect(within(volet()).getByText(/Les parts dépassent le mouvement de 4,00/)).toBeTruthy()
    expect(bouton().hasAttribute('disabled')).toBe(true)
    saisir(2, 'dirigeant', '36')
    expect(bouton().hasAttribute('disabled')).toBe(false)
  })

  it('la remise nette de sa commission : un montant négatif va en sens inverse', async () => {
    preparer({ libelle: 'REMISE CB', montant: 95 })
    rendre()
    await ouvrir('REMISE CB')
    await deplier()
    saisir(1, 'cat-recettes', '100')
    saisir(2, 'cat-frais', '-5')
    // Ni l'une ni l'autre ne diminue sa catégorie : aucune mise en garde.
    expect(within(volet()).queryByText(/diminue/)).toBeNull()
    await act(async () => { within(volet()).getByRole('button', { name: 'Ventiler' }).click() })
    expect(ventilations()[0].args).toMatchObject({
      p_parts: [
        { categorie_id: 'cat-recettes', part_personnelle: false, montant: 100 },
        { categorie_id: 'cat-frais', part_personnelle: false, montant: -5 },
      ],
      p_ecritures: [
        { compte: '706000', sens: 'credit', montant: 100 },
        { compte: '627000', sens: 'debit', montant: 5 },
        { compte: '512000', sens: 'debit', montant: 95 },
      ],
    })
  })

  it('nomme une part qui diminue sa catégorie, sans la refuser — c’est un remboursement', async () => {
    preparer({ libelle: 'REMISE CB', montant: 95 })
    rendre()
    await ouvrir('REMISE CB')
    await deplier()
    saisir(1, 'cat-recettes', '90')
    saisir(2, 'cat-frais', '5')
    expect(within(volet()).getByText(/La part « Frais bancaires » diminue sa catégorie au lieu de l’augmenter/)).toBeTruthy()
    expect(within(volet()).getByRole('button', { name: 'Ventiler' }).hasAttribute('disabled')).toBe(false)
  })

  it('sur un dossier assujetti, une part de recette demande son taux, et s’écrit au hors taxe avec sa TVA', async () => {
    preparer({ libelle: 'REMISE CB', montant: 95 })
    rendre(TRESORERIE, true)
    await ouvrir('REMISE CB')
    await deplier()
    saisir(1, 'cat-recettes', '100')
    saisir(2, 'cat-frais', '-5')
    // Le taux de la recette manque : le bouton attend, et le formulaire pose la question. La commission, une
    // dépense, n'en demande pas.
    expect(within(volet()).getByText('Choisis le taux de TVA de chaque part de recette : le relevé ne le dit pas.')).toBeTruthy()
    expect(within(volet()).getByRole('button', { name: 'Ventiler' }).hasAttribute('disabled')).toBe(true)
    expect(within(volet()).queryByLabelText('Taux de TVA de la part 2')).toBeNull()
    expect(faux.rpcs).toEqual([])

    fireEvent.change(within(volet()).getByLabelText('Taux de TVA de la part 1'), { target: { value: '20' } })
    expect(within(volet()).getByText(/hors taxe 83,33.*TVA 16,67/)).toBeTruthy()
    await act(async () => { within(volet()).getByRole('button', { name: 'Ventiler' }).click() })
    expect(ventilations()).toEqual([{
      nom: 'ventiler_mouvement_bancaire',
      args: {
        p_ligne_bancaire_id: 'ligne-1',
        p_parts: [
          { categorie_id: 'cat-recettes', part_personnelle: false, montant: 100, taux_tva: 20 },
          { categorie_id: 'cat-frais', part_personnelle: false, montant: -5, taux_tva: null },
        ],
        p_ecritures: [
          { compte: '706000', sens: 'credit', montant: 83.33, libelle: 'REMISE CB' },
          { compte: '445710', sens: 'credit', montant: 16.67, libelle: 'REMISE CB' },
          { compte: '627000', sens: 'debit', montant: 5, libelle: 'REMISE CB' },
          { compte: '512000', sens: 'debit', montant: 95, libelle: 'REMISE CB' },
        ],
      },
    }])
  })

  it('un taux choisi pour une recette ne part pas avec la part si elle devient une dépense', async () => {
    preparer({ libelle: 'REMISE CB', montant: 95 })
    rendre(TRESORERIE, true)
    await ouvrir('REMISE CB')
    await deplier()
    saisir(1, 'cat-recettes', '100')
    fireEvent.change(within(volet()).getByLabelText('Taux de TVA de la part 1'), { target: { value: '20' } })
    saisir(1, 'cat-tel', '100')
    saisir(2, 'cat-frais', '-5')
    await act(async () => { within(volet()).getByRole('button', { name: 'Ventiler' }).click() })
    expect((ventilations()[0].args.p_parts as { taux_tva: number | null }[]).map((p) => p.taux_tva)).toEqual([null, null])
  })

  it('sur un dossier exonéré, aucune part ne demande de taux', async () => {
    preparer({ libelle: 'REMISE CB', montant: 95 })
    rendre()
    await ouvrir('REMISE CB')
    await deplier()
    saisir(1, 'cat-recettes', '100')
    saisir(2, 'cat-frais', '-5')
    expect(within(volet()).queryByLabelText('Taux de TVA de la part 1')).toBeNull()
    expect(within(volet()).getByRole('button', { name: 'Ventiler' }).hasAttribute('disabled')).toBe(false)
  })

  it('la liste montre « TVA à choisir » sur un mouvement ventilé dont une part de recette n’a pas de taux, sur un dossier assujetti', async () => {
    const parts = (taux: number | null): VentilationBancaire[] => [
      { ...PARTS[0], categorie_id: 'cat-recettes', montant: 100, taux_tva: taux },
      { ...PARTS[1], categorie_id: 'cat-frais', part_personnelle: false, montant: -5 },
    ]
    const ligne = () => screen.getAllByText('REMISE CB').find((e) => e.closest('tr')?.classList.contains('clickable'))!.closest('tr')!
    preparer({ ...VENTILEE, libelle: 'REMISE CB', montant: 95 }, parts(null))
    rendre(TRESORERIE, true)
    await voirLesRapproches()
    await waitFor(() => expect(ligne().textContent).toMatch(/Ventilé sur 2 comptes/))
    expect(ligne().textContent).toMatch(/TVA à choisir/)
    cleanup()

    // Le garde symétrique : la part porte son taux.
    preparer({ ...VENTILEE, libelle: 'REMISE CB', montant: 95 }, parts(20))
    rendre(TRESORERIE, true)
    await voirLesRapproches()
    await waitFor(() => expect(ligne().textContent).toMatch(/Ventilé sur 2 comptes/))
    expect(ligne().textContent).not.toMatch(/TVA à choisir/)
    cleanup()

    // Et sur un dossier exonéré, rien à choisir.
    preparer({ ...VENTILEE, libelle: 'REMISE CB', montant: 95 }, parts(null))
    rendre()
    await voirLesRapproches()
    await waitFor(() => expect(ligne().textContent).toMatch(/Ventilé sur 2 comptes/))
    expect(ligne().textContent).not.toMatch(/TVA à choisir/)
  })

  it('la fiche d’un mouvement ventilé dit le taux de chaque part de recette, et nomme celle qui n’en a pas', async () => {
    const parts = (taux: number | null): VentilationBancaire[] => [
      { ...PARTS[0], categorie_id: 'cat-recettes', montant: 100, taux_tva: taux },
      { ...PARTS[1], categorie_id: 'cat-frais', part_personnelle: false, montant: -5 },
    ]
    preparer({ ...VENTILEE, libelle: 'REMISE CB', montant: 95 }, parts(20))
    rendre(TRESORERIE, true)
    await voirLesRapproches()
    await ouvrir('REMISE CB')
    expect(within(volet()).getByText('Ventes / prestations (706000) · TVA 20 %')).toBeTruthy()
    expect(within(volet()).queryByText(/n’a pas de taux/)).toBeNull()
    cleanup()

    preparer({ ...VENTILEE, libelle: 'REMISE CB', montant: 95 }, parts(null))
    rendre(TRESORERIE, true)
    await voirLesRapproches()
    await ouvrir('REMISE CB')
    expect(within(volet()).getByText(
      'Le dossier est assujetti à la TVA et la part « Ventes / prestations (706000) » n’a pas de taux : sa TVA n’est dans aucune déclaration, et la 2035 la compte en recette. Modifie la ventilation pour choisir son taux.',
    )).toBeTruthy()
    expect(within(volet()).queryByText(/· TVA/)).toBeNull()
    cleanup()

    // Deux parts de recette sans taux : la phrase les compte.
    preparer({ ...VENTILEE, libelle: 'REMISE CB', montant: 95 }, [
      { ...PARTS[0], categorie_id: 'cat-recettes', montant: 60, taux_tva: null },
      { ...PARTS[1], categorie_id: 'cat-frais', part_personnelle: false, montant: -5 },
      { ...PARTS[1], id: 'part-3', categorie_id: 'cat-formation', part_personnelle: false, montant: 40, taux_tva: null },
    ])
    faux.categories = [...faux.categories, categorieDeTest({
      id: 'cat-formation', code: 'formation', libelle: 'Formations dispensées', ordre: 11, compte_comptable: '706100', poste_2035: 'Recettes',
    })]
    rendre(TRESORERIE, true)
    await voirLesRapproches()
    await ouvrir('REMISE CB')
    expect(within(volet()).getByText(/et 2 parts de recette n’ont pas de taux : leur TVA n’est dans aucune déclaration/)).toBeTruthy()
    cleanup()

    // Le garde symétrique : sur un dossier exonéré, le taux gardé en base ne s'écrit plus — ni montré, ni
    // réclamé.
    preparer({ ...VENTILEE, libelle: 'REMISE CB', montant: 95 }, parts(20))
    rendre()
    await voirLesRapproches()
    await ouvrir('REMISE CB')
    expect(within(volet()).getByText('Ventes / prestations (706000)')).toBeTruthy()
    expect(within(volet()).queryByText(/· TVA/)).toBeNull()
    expect(within(volet()).queryByText(/n’a pas de taux/)).toBeNull()
  })

  it('ajoute et retire une part, jamais en dessous de deux', async () => {
    preparer()
    rendre()
    await ouvrir('PRLV OPERATEUR MOBILE')
    await deplier()
    expect(within(volet()).queryByRole('button', { name: /Retirer la part/ })).toBeNull()
    await act(async () => { within(volet()).getByRole('button', { name: 'Ajouter une part' }).click() })
    saisir(1, 'cat-tel', '60')
    saisir(2, 'cat-frais', '24')
    saisir(3, 'dirigeant', '36')
    expect(within(volet()).getByText('Les parts font le mouvement.')).toBeTruthy()
    await act(async () => { within(volet()).getByRole('button', { name: 'Retirer la part 2' }).click() })
    // La part retirée est bien la deuxième : il reste le téléphone et la part personnelle.
    expect((within(volet()).getByLabelText('Compte de la part 2') as HTMLSelectElement).value).toBe('dirigeant')
    expect(within(volet()).getByText(/Reste à ventiler : 24,00/)).toBeTruthy()
    expect(within(volet()).queryByRole('button', { name: /Retirer la part/ })).toBeNull()
  })

  it('ne ventile qu’une fois, même sur trois clics rapprochés', async () => {
    preparer()
    rendre()
    await ouvrir('PRLV OPERATEUR MOBILE')
    await deplier()
    saisir(1, 'cat-tel', '84')
    saisir(2, 'dirigeant', '36')
    const bouton = within(volet()).getByRole('button', { name: 'Ventiler' })
    await act(async () => { bouton.click(); bouton.click(); bouton.click() })
    expect(ventilations()).toHaveLength(1)
  })

  // Relâché avant la relecture, le verrou laisserait le formulaire cliquable sur un mouvement déjà ventilé.
  it('reste verrouillé tant que la relecture du relevé n’est pas revenue', async () => {
    preparer()
    rendre()
    await ouvrir('PRLV OPERATEUR MOBILE')
    await deplier()
    saisir(1, 'cat-tel', '84')
    saisir(2, 'dirigeant', '36')
    faux.retenirLectureLignes = true
    await act(async () => { within(volet()).getByRole('button', { name: 'Ventiler' }).click() })
    expect(within(volet()).getByRole('button', { name: 'Ventiler' }).hasAttribute('disabled')).toBe(true)
    await act(async () => { faux.resoudreLectureLignes?.() })
    await waitFor(() => expect(within(volet()).getByText('Ventilé sur 2 comptes')).toBeTruthy())
  })

  // LE VERROU EST PARTAGÉ AVEC LES LOTS, comme pour l'affectation.
  it('« Tout rapprocher » en cours retient aussi la ventilation', async () => {
    preparer()
    faux.pieces = [pieceDeTest()]
    faux.lignes = [ligneDeTest(), ligneDeTest({ id: 'ligne-2', libelle: 'PRLV OPERATEUR MOBILE', montant: -120 })]
    rendre()
    await ouvrir('PRLV OPERATEUR MOBILE')
    await deplier()
    saisir(1, 'cat-tel', '84')
    saisir(2, 'dirigeant', '36')
    const ventiler = within(volet()).getByRole('button', { name: 'Ventiler' })
    expect(ventiler.hasAttribute('disabled')).toBe(false)
    await act(async () => { screen.getByRole('button', { name: /Tout rapprocher automatiquement \(1\)/ }).click() })
    expect(ventiler.hasAttribute('disabled')).toBe(true)
    await act(async () => { ventiler.click() })
    expect(ventilations()).toEqual([])
  })

  it('un refus de la base se dit, et le mouvement reste à traiter', async () => {
    preparer()
    faux.erreurRpc = 'refus simulé'
    const alerte = vi.spyOn(window, 'alert').mockImplementation(() => {})
    rendre()
    await ouvrir('PRLV OPERATEUR MOBILE')
    await deplier()
    saisir(1, 'cat-tel', '84')
    saisir(2, 'dirigeant', '36')
    await act(async () => { within(volet()).getByRole('button', { name: 'Ventiler' }).click() })
    await waitFor(() => expect(alerte).toHaveBeenCalledWith(expect.stringMatching(/La ventilation n'a pas pu être enregistrée : refus simulé/)))
    expect(within(volet()).getByText('Non rapproché')).toBeTruthy()
  })

  it('ne propose de ventiler ni un mouvement affecté, ni un mouvement de zéro euro', async () => {
    preparer({ statut: 'rapprochee', categorie_id: 'cat-tel' })
    rendre()
    await voirLesRapproches()
    await ouvrir('PRLV OPERATEUR MOBILE')
    expect(within(volet()).queryByRole('button', { name: 'Ventiler sur plusieurs comptes…' })).toBeNull()
    cleanup()
    preparer({ montant: 0 })
    rendre()
    await ouvrir('PRLV OPERATEUR MOBILE')
    expect(within(volet()).queryByRole('button', { name: 'Ventiler sur plusieurs comptes…' })).toBeNull()
  })

  it('la liste dit « Ventilé sur 2 comptes », jamais un « Rapproché » nu ni « sans justificatif »', async () => {
    preparer(VENTILEE, PARTS)
    rendre()
    await voirLesRapproches()
    expect(await screen.findByText('Ventilé sur 2 comptes')).toBeTruthy()
    expect(screen.queryByText(/^Rapproché$/)).toBeNull()
    expect(screen.queryByText('Rapproché sans justificatif')).toBeNull()
  })

  it('la fiche montre les parts dans le sens du mouvement, et annule la ventilation par la base', async () => {
    preparer(VENTILEE, PARTS)
    rendre()
    await voirLesRapproches()
    await ouvrir('PRLV OPERATEUR MOBILE')
    const parts = within(volet()).getByText('Téléphone (626000)').closest('dl')
    expect(parts?.textContent).toMatch(/Téléphone \(626000\)84,00.*Part personnelle \(108000\)36,00/)
    expect(within(volet()).queryByText('Rapproché avec')).toBeNull()
    expect(within(volet()).queryByText(/^Rapproché$/)).toBeNull()
    await act(async () => { within(volet()).getByRole('button', { name: 'Annuler la ventilation' }).click() })
    await waitFor(() => expect(within(volet()).getByText('Non rapproché')).toBeTruthy())
    expect(faux.rpcs).toEqual([{ nom: 'retirer_ventilation_mouvement_bancaire', args: { p_ligne_bancaire_id: 'ligne-1' } }])
    expect(faux.updatesLignes).toEqual([])
  })

  it('dit une annulation que la base refuse, et le mouvement reste ventilé', async () => {
    preparer(VENTILEE, PARTS)
    faux.erreurRpc = 'refus simulé'
    const alerte = vi.spyOn(window, 'alert').mockImplementation(() => {})
    rendre()
    await voirLesRapproches()
    await ouvrir('PRLV OPERATEUR MOBILE')
    await act(async () => { within(volet()).getByRole('button', { name: 'Annuler la ventilation' }).click() })
    await waitFor(() => expect(alerte).toHaveBeenCalledWith(expect.stringMatching(/La ventilation n'a pas pu être annulée : refus simulé/)))
    expect(within(volet()).getByText('Ventilé sur 2 comptes')).toBeTruthy()
  })

  it('modifie une ventilation en repartant de ses parts', async () => {
    preparer(VENTILEE, PARTS)
    rendre()
    await voirLesRapproches()
    await ouvrir('PRLV OPERATEUR MOBILE')
    await act(async () => { within(volet()).getByRole('button', { name: 'Modifier la ventilation…' }).click() })
    // Les parts en place, dans le sens du mouvement.
    expect((within(volet()).getByLabelText('Compte de la part 1') as HTMLSelectElement).value).toBe('cat-tel')
    expect((within(volet()).getByLabelText('Montant de la part 1') as HTMLInputElement).value).toBe('84.00')
    expect((within(volet()).getByLabelText('Compte de la part 2') as HTMLSelectElement).value).toBe('dirigeant')
    expect((within(volet()).getByLabelText('Montant de la part 2') as HTMLInputElement).value).toBe('36.00')
    saisir(1, 'cat-tel', '96')
    saisir(2, 'dirigeant', '24')
    await act(async () => { within(volet()).getByRole('button', { name: 'Enregistrer la ventilation' }).click() })
    expect(ventilations()[0].args.p_parts).toEqual([
      { categorie_id: 'cat-tel', part_personnelle: false, montant: -96, taux_tva: null },
      { categorie_id: null, part_personnelle: true, montant: -24, taux_tva: null },
    ])
  })

  it('modifie une ventilation d’un dossier assujetti en repartant du taux de chaque part de recette', async () => {
    preparer({ ...VENTILEE, libelle: 'REMISE CB', montant: 95 }, [
      { ...PARTS[0], categorie_id: 'cat-recettes', montant: 100, taux_tva: 20 },
      { ...PARTS[1], id: 'part-2', categorie_id: 'cat-frais', part_personnelle: false, montant: -5, taux_tva: null },
    ])
    rendre(TRESORERIE, true)
    await voirLesRapproches()
    await ouvrir('REMISE CB')
    await act(async () => { within(volet()).getByRole('button', { name: 'Modifier la ventilation…' }).click() })
    expect((within(volet()).getByLabelText('Taux de TVA de la part 1') as HTMLSelectElement).value).toBe('20')
    expect(within(volet()).queryByLabelText('Taux de TVA de la part 2')).toBeNull()
    await act(async () => { within(volet()).getByRole('button', { name: 'Enregistrer la ventilation' }).click() })
    expect(ventilations()[0].args.p_parts).toEqual([
      { categorie_id: 'cat-recettes', part_personnelle: false, montant: 100, taux_tva: 20 },
      { categorie_id: 'cat-frais', part_personnelle: false, montant: -5, taux_tva: null },
    ])
  })

  it('des parts lues en partie : l’écran le dit, et la modification est suspendue', async () => {
    preparer(VENTILEE, PARTS)
    faux.muet = { ventilations_bancaires: 1 }
    rendre()
    expect(await screen.findByText(/Les parts des mouvements ventilés n'ont pas pu être lues en entier/)).toBeTruthy()
    await voirLesRapproches()
    await ouvrir('PRLV OPERATEUR MOBILE')
    expect(within(volet()).getByText(/celles de ce mouvement peuvent manquer ci-dessous/)).toBeTruthy()
    expect(within(volet()).queryByRole('button', { name: 'Modifier la ventilation…' })).toBeNull()
    // Le garde symétrique : lues en entier, la modification est offerte.
    cleanup()
    preparer(VENTILEE, PARTS)
    rendre()
    await voirLesRapproches()
    await ouvrir('PRLV OPERATEUR MOBILE')
    expect(within(volet()).getByRole('button', { name: 'Modifier la ventilation…' })).toBeTruthy()
  })

  it('dit une part dont la catégorie n’a pas de poste 2035', async () => {
    preparer(VENTILEE, PARTS)
    faux.categories = [{ ...TELEPHONE, poste_2035: null }, FRAIS, RECETTES]
    rendre()
    await voirLesRapproches()
    await ouvrir('PRLV OPERATEUR MOBILE')
    expect(within(volet()).getByText(/« Téléphone » n’a pas de poste 2035 : sa part n’entre dans aucun total/)).toBeTruthy()
  })

  // Trouvé par mutation : l'alerte retirée laissait ce fichier vert. Le compte d'une catégorie qui quitte
  // les comptes de résultat — une catégorie devenue compte de bilan — retire sa part de la 2035 et rend
  // l'écriture fausse ; c'est la fiche, où l'on arbitre le mouvement, qui doit le dire.
  it('dit une part dont la catégorie n’a plus de compte de charge ou de produit', async () => {
    preparer(VENTILEE, PARTS)
    faux.categories = [{ ...TELEPHONE, compte_comptable: '467000' }, FRAIS, RECETTES]
    rendre()
    await voirLesRapproches()
    await ouvrir('PRLV OPERATEUR MOBILE')
    expect(within(volet()).getByText(/Le compte de « Téléphone » n’est plus un compte de charge ou de produit/)).toBeTruthy()
    // Le garde symétrique : une catégorie de résultat ne déclenche rien.
    cleanup()
    preparer(VENTILEE, PARTS)
    rendre()
    await voirLesRapproches()
    await ouvrir('PRLV OPERATEUR MOBILE')
    expect(within(volet()).queryByText(/n’est plus un compte de charge ou de produit/)).toBeNull()
  })

  // Trouvé par mutation aussi : des parts qui ne font plus le mouvement — un chemin défensif, la base
  // vérifiant la somme — se disent dans la fiche ; sur des parts lues en partie, jamais, une part non lue
  // passerait pour une part manquante.
  it('dit des parts qui ne font plus le mouvement, et se tait sur des parts lues en partie', async () => {
    const MAL_VENTILEES = [PARTS[0], { ...PARTS[1], montant: -30 }]
    preparer(VENTILEE, MAL_VENTILEES)
    rendre()
    await voirLesRapproches()
    await ouvrir('PRLV OPERATEUR MOBILE')
    expect(within(volet()).getByText(/Les parts enregistrées ne font plus le montant du mouvement/)).toBeTruthy()
    cleanup()
    preparer(VENTILEE, MAL_VENTILEES)
    faux.muet = { ventilations_bancaires: 1 }
    rendre()
    await voirLesRapproches()
    await ouvrir('PRLV OPERATEUR MOBILE')
    expect(within(volet()).queryByText(/ne font plus le montant du mouvement/)).toBeNull()
  })

  // Trouvé par mutation : l'ordre des catégories proposées n'était gardé par rien. Comme pour l'affectation,
  // le sens du mouvement décide : les dépenses d'abord pour un paiement, les recettes d'abord pour un
  // encaissement — l'erreur la plus facile est de choisir dans le mauvais groupe.
  it('propose d’abord les catégories du sens du mouvement', async () => {
    const groupes = () => [...within(volet()).getByLabelText('Compte de la part 1').querySelectorAll('optgroup')].map((g) => g.getAttribute('label'))
    preparer()
    rendre()
    await ouvrir('PRLV OPERATEUR MOBILE')
    await deplier()
    expect(groupes()).toEqual(['Dépenses', 'Recettes', 'Hors résultat'])
    cleanup()
    preparer({ libelle: 'REMISE CB', montant: 485.3 })
    rendre()
    await ouvrir('REMISE CB')
    await deplier()
    expect(groupes()).toEqual(['Recettes', 'Dépenses', 'Hors résultat'])
  })
})

// UN VIREMENT QUI RÈGLE PLUSIEURS PIÈCES (ligne 26, lib/reglementGroupe.ts). Le calcul est gardé par ses
// propres tests ; ici, ce qu'aucun d'eux ne voit : que le geste ne part qu'au clic et par la base, que chaque
// part reçoive SA contrepartie, que les pièces d'un règlement annulé retournent à la date de leur facture, et
// qu'une pièce réglée par une part cesse d'être candidate partout ailleurs sur cet écran.
describe('BanqueTab — un virement qui règle plusieurs pièces', () => {
  const ALPHA = pieceDeTest({ id: 'piece-a', tiers: 'Alpha', nom_fichier: 'alpha.pdf', montant_ttc: 300, date_piece: '2025-05-20' })
  const BETA = pieceDeTest({ id: 'piece-b', tiers: 'Beta', nom_fichier: 'beta.pdf', montant_ttc: 200, date_piece: '2025-05-25' })
  const AVOIR_BETA = pieceDeTest({ id: 'avoir-b', tiers: 'Beta', nom_fichier: 'avoir.pdf', montant_ttc: -50, date_piece: '2025-05-28' })
  const GAMMA = pieceDeTest({ id: 'piece-c', tiers: 'Gamma', nom_fichier: 'gamma.pdf', montant_ttc: 200, date_piece: '2025-05-26' })
  const part = (id: string, pieceId: string | null, montant: number): ReglementGroupe => ({
    id, dossier_id: 'dossier-de-test', ligne_bancaire_id: 'ligne-1', piece_id: pieceId, montant, created_at: '2025-06-02T10:00:00Z',
  })
  const PARTS = [part('groupe-1', 'piece-a', -300), part('groupe-2', 'piece-b', -200)]
  const REGLE: Partial<LigneBancaire> = { statut: 'rapprochee', reglement_groupe: true }

  function preparer(ligne: Partial<LigneBancaire> = {}, parts: ReglementGroupe[] = []) {
    reinitialiser()
    faux.pieces = [ALPHA, BETA, AVOIR_BETA, GAMMA]
    faux.lignes = [ligneDeTest({ libelle: 'VIR FOURNISSEURS', montant: -500, ...ligne })]
    faux.reglements = parts
  }
  async function voirLesRapproches() {
    await act(async () => { (await screen.findByRole('button', { name: 'Rapprochés' })).click() })
  }
  async function deplier() {
    await act(async () => { within(volet()).getByRole('button', { name: 'Régler plusieurs pièces…' }).click() })
  }
  function choisir(numero: number, pieceId: string, montant?: string) {
    fireEvent.change(within(volet()).getByLabelText(`Pièce ${numero}`), { target: { value: pieceId } })
    if (montant !== undefined) fireEvent.change(within(volet()).getByLabelText(`Part de la pièce ${numero}`), { target: { value: montant } })
  }
  const saisie = (numero: number) => (within(volet()).getByLabelText(`Part de la pièce ${numero}`) as HTMLInputElement).value
  const bouton = (nom = 'Régler ces pièces') => within(volet()).getByRole('button', { name: nom })
  const reglementsRpc = () => faux.rpcs.filter((r) => r.nom === 'regler_pieces_par_mouvement')

  it('règle les pièces au clic, par la base, une contrepartie par part, et reste sur le mouvement', async () => {
    preparer()
    faux.ecritures = [{ id: 'charge', compte: '606100', ligne_bancaire_id: null }]
    rendre()
    await ouvrir('VIR FOURNISSEURS')
    await deplier()
    // Choisir une pièce propose ce qu'il en reste à régler.
    choisir(1, 'piece-a')
    choisir(2, 'piece-b')
    expect([saisie(1), saisie(2)]).toEqual(['300.00', '200.00'])
    expect(within(volet()).getByText('Les parts font le mouvement.')).toBeTruthy()
    expect(faux.rpcs).toEqual([])
    await act(async () => { bouton().click() })

    await waitFor(() => expect(within(volet()).getByText('Règle 2 pièces')).toBeTruthy())
    expect(reglementsRpc()).toEqual([{
      nom: 'regler_pieces_par_mouvement',
      // Signées comme le relevé : l'opérateur a saisi « 300 » et « 200 », qui règlent deux factures d'achat.
      args: { p_ligne_bancaire_id: 'ligne-1', p_parts: [{ piece_id: 'piece-a', montant: -300 }, { piece_id: 'piece-b', montant: -200 }] },
    }])
    // Jamais une mise à jour directe du mouvement : le règlement et ses parts partent ensemble, par la base.
    expect(faux.updatesLignes).toEqual([])
    // Chaque part reçoit sa contrepartie banque, à son montant et à la date du mouvement…
    expect(faux.insertions.filter((i) => i.table === 'ecritures_brouillon').map((i) => i.valeur)).toEqual([
      expect.objectContaining({ piece_id: 'piece-a', ligne_bancaire_id: 'ligne-1', compte: '512000', montant: 300, sens: 'credit', date: '2025-06-02' }),
      expect.objectContaining({ piece_id: 'piece-b', ligne_bancaire_id: 'ligne-1', compte: '512000', montant: 200, sens: 'credit', date: '2025-06-02' }),
    ])
    // … et chaque pièce, réglée entière par sa part, passe à la date du paiement.
    expect(faux.updatesEcritures.map((u) => [u.valeur, u.filtres])).toEqual([
      [{ date: '2025-06-02' }, ['piece_id=piece-a', 'compte!=512000']],
      [{ date: '2025-06-02' }, ['piece_id=piece-b', 'compte!=512000']],
    ])
    const parts = within(volet()).getByText(/Alpha — 20\/05\/2025/).closest('dl')
    expect(parts?.textContent).toMatch(/Alpha — 20\/05\/2025 \(facture de 300,00.*\)300,00.*Beta — 25\/05\/2025 \(facture de 200,00.*\)200,00/)
    expect(bouton('Annuler le règlement groupé')).toBeTruthy()
    expect(within(volet()).queryByText('Rapproché avec')).toBeNull()
  })

  it('en engagement, chaque part écrit le règlement de sa facture', async () => {
    preparer()
    faux.ecritures = [{ id: 'facture', compte: '606100', ligne_bancaire_id: null }]
    rendre(ENGAGEMENT)
    await ouvrir('VIR FOURNISSEURS')
    await deplier()
    choisir(1, 'piece-a')
    choisir(2, 'piece-b')
    await act(async () => { bouton().click() })
    await waitFor(() => expect(reglementsRpc()).toHaveLength(1))
    await waitFor(() => expect(faux.insertions.filter((i) => i.table === 'ecritures_brouillon')).toHaveLength(2))
    const reglements = faux.insertions.filter((i) => i.table === 'ecritures_brouillon').map((i) => i.valeur as unknown as Record<string, unknown>[])
    expect(reglements.map((r) => r.map((l) => [l.piece_id, l.compte, l.sens, l.montant, l.ligne_bancaire_id]))).toEqual([
      [['piece-a', '401000', 'debit', 300, 'ligne-1'], ['piece-a', '512000', 'credit', 300, 'ligne-1']],
      [['piece-b', '401000', 'debit', 200, 'ligne-1'], ['piece-b', '512000', 'credit', 200, 'ligne-1']],
    ])
    // Rien n'est redaté en engagement : la facture reste à sa date.
    expect(faux.updatesEcritures).toEqual([])
  })

  it('demande chaque part avant de crier à l’erreur, puis dit le reste à répartir', async () => {
    preparer()
    rendre()
    await ouvrir('VIR FOURNISSEURS')
    await deplier()
    expect(within(volet()).getByText('Choisis la pièce et le montant de chaque part.')).toBeTruthy()
    // Demander n'est pas refuser : aucune alerte tant que les parts ne sont pas saisies.
    const section = within(volet()).getByRole('heading', { name: 'Plusieurs pièces' }).closest('section')!
    expect(section.querySelectorAll('.fiche-mouvement-alerte')).toHaveLength(0)
    choisir(1, 'piece-a')
    expect(section.querySelectorAll('.fiche-mouvement-alerte')).toHaveLength(0)
    expect(bouton().hasAttribute('disabled')).toBe(true)
    choisir(1, 'piece-a', '300')
    choisir(2, 'piece-b', '150')
    expect(within(volet()).getByText(/Reste à répartir : 50,00/)).toBeTruthy()
    expect(within(volet()).getByText(/Les parts font 450,00.*au lieu des 500,00.*du mouvement\./)).toBeTruthy()
    expect(bouton().hasAttribute('disabled')).toBe(true)
    choisir(2, 'piece-b', '250')
    expect(within(volet()).getByText(/Les parts dépassent le mouvement de 50,00/)).toBeTruthy()
    expect(bouton().hasAttribute('disabled')).toBe(true)
    choisir(2, 'piece-b', '200')
    expect(bouton().hasAttribute('disabled')).toBe(false)
  })

  it('un avoir se déduit : sa part, saisie positive, part dans l’autre sens', async () => {
    preparer({ montant: -450 })
    rendre()
    await ouvrir('VIR FOURNISSEURS')
    await deplier()
    choisir(1, 'piece-a')
    choisir(2, 'piece-b')
    await act(async () => { within(volet()).getByRole('button', { name: 'Ajouter une pièce' }).click() })
    choisir(3, 'avoir-b')
    expect(saisie(3)).toBe('50.00')
    expect(within(volet()).getByText('Les parts font le mouvement.')).toBeTruthy()
    await act(async () => { bouton().click() })
    expect(reglementsRpc()[0].args.p_parts).toEqual([
      { piece_id: 'piece-a', montant: -300 }, { piece_id: 'piece-b', montant: -200 }, { piece_id: 'avoir-b', montant: 50 },
    ])
    // Réglé, le mouvement montre ses parts DANS SON SENS : l'avoir y figure en négatif, nommé comme tel, et
    // les trois font le virement — montrées toutes positives, elles feraient 550 € pour un virement de 450 €.
    await waitFor(() => expect(within(volet()).getByText('Règle 3 pièces')).toBeTruthy())
    const parts = within(volet()).getByText(/Beta — 28\/05\/2025/).closest('dl')
    expect(parts?.textContent).toMatch(/Alpha — 20\/05\/2025 \(facture de 300,00[^)]*\)300,00/)
    expect(parts?.textContent).toMatch(/Beta — 28\/05\/2025 \(avoir de 50,00[^)]*\)[-−]50,00/)
  })

  it('refuse avant le clic une part qui paierait une pièce deux fois, et dit ce qu’il en reste', async () => {
    preparer({ montant: -400 })
    // Alpha a déjà reçu un acompte de 100 € par un autre mouvement : il en reste 200 à régler.
    faux.lignes = [...faux.lignes, ligneDeTest({ id: 'acompte', libelle: 'ACOMPTE ALPHA', montant: -100, statut: 'rapprochee', piece_id: 'piece-a' })]
    rendre()
    await ouvrir('VIR FOURNISSEURS')
    await deplier()
    expect(within(within(volet()).getByLabelText('Pièce 1')).getByRole('option', { name: /Alpha.*\(reste 200,00.*\)/ })).toBeTruthy()
    choisir(1, 'piece-a', '250')
    choisir(2, 'piece-b', '150')
    expect(within(volet()).getByText(/La part de la pièce « Alpha » dépasse ce qu’il en reste à régler \(200,00.*\) : une pièce ne se paie pas deux fois\./)).toBeTruthy()
    expect(bouton().hasAttribute('disabled')).toBe(true)
    choisir(1, 'piece-a', '200')
    choisir(2, 'piece-b', '200')
    expect(bouton().hasAttribute('disabled')).toBe(false)
  })

  it('n’offre pas une pièce déjà réglée, ni deux fois la même', async () => {
    preparer({ montant: -400 })
    faux.lignes = [...faux.lignes, ligneDeTest({ id: 'paye', libelle: 'PRLV GAMMA', montant: -200, statut: 'rapprochee', piece_id: 'piece-c' })]
    rendre()
    await ouvrir('VIR FOURNISSEURS')
    await deplier()
    const options = (numero: number) => [...(within(volet()).getByLabelText(`Pièce ${numero}`) as HTMLSelectElement).options].map((o) => o.value)
    expect(options(1)).not.toContain('piece-c')
    choisir(1, 'piece-a')
    expect(options(2)).not.toContain('piece-a')
    expect(options(1)).toContain('piece-a')
  })

  it('ne règle qu’une fois, même sur trois clics rapprochés', async () => {
    preparer()
    rendre()
    await ouvrir('VIR FOURNISSEURS')
    await deplier()
    choisir(1, 'piece-a')
    choisir(2, 'piece-b')
    const regler = bouton()
    await act(async () => { regler.click(); regler.click(); regler.click() })
    expect(reglementsRpc()).toHaveLength(1)
  })

  it('un refus de la base se dit, et le mouvement reste à traiter', async () => {
    preparer()
    faux.erreurRpc = 'refus simulé'
    const alerte = vi.spyOn(window, 'alert').mockImplementation(() => {})
    rendre()
    await ouvrir('VIR FOURNISSEURS')
    await deplier()
    choisir(1, 'piece-a')
    choisir(2, 'piece-b')
    await act(async () => { bouton().click() })
    await waitFor(() => expect(alerte).toHaveBeenCalledWith(expect.stringMatching(/Le règlement groupé n'a pas pu être enregistré : refus simulé/)))
    expect(within(volet()).getByText('Non rapproché')).toBeTruthy()
    expect(faux.insertions).toEqual([])
  })

  it('une contrepartie refusée est dite, le règlement restant enregistré', async () => {
    preparer()
    faux.ecritures = [{ id: 'charge', compte: '606100', ligne_bancaire_id: null }]
    faux.erreurInsertionEcritures = 'insertion refusée'
    const alerte = vi.spyOn(window, 'alert').mockImplementation(() => {})
    rendre()
    await ouvrir('VIR FOURNISSEURS')
    await deplier()
    choisir(1, 'piece-a')
    choisir(2, 'piece-b')
    await act(async () => { bouton().click() })
    await waitFor(() => expect(alerte).toHaveBeenCalledWith(expect.stringMatching(
      /Le règlement groupé est enregistré, mais des écritures n'ont pas pu suivre :\nAlpha : insertion refusée\nBeta : insertion refusée/,
    )))
    await waitFor(() => expect(within(volet()).getByText('Règle 2 pièces')).toBeTruthy())
  })

  it('la liste dit « Règle 2 pièces », jamais un « Rapproché » nu ni « sans justificatif »', async () => {
    preparer(REGLE, PARTS)
    rendre()
    await voirLesRapproches()
    expect(await screen.findByText('Règle 2 pièces')).toBeTruthy()
    expect(screen.queryByText(/^Rapproché( —.*)?$/)).toBeNull()
    expect(screen.queryByText('Rapproché sans justificatif')).toBeNull()
    // La fiche non plus : sa pastille dit le règlement, jamais un « Rapproché » qui ferait chercher UNE pièce.
    await ouvrir('VIR FOURNISSEURS')
    expect(within(volet()).getByText('Règle 2 pièces', { selector: '.badge' })).toBeTruthy()
    expect(within(volet()).queryAllByText('Rapproché', { selector: '.badge' })).toHaveLength(0)
  })

  it('annule le règlement par la base, et ses pièces retournent à la date de leur facture', async () => {
    preparer(REGLE, PARTS)
    rendre()
    await voirLesRapproches()
    await ouvrir('VIR FOURNISSEURS')
    await act(async () => { bouton('Annuler le règlement groupé').click() })
    await waitFor(() => expect(within(volet()).getByText('Non rapproché')).toBeTruthy())
    expect(faux.rpcs).toEqual([{ nom: 'retirer_reglement_groupe', args: { p_ligne_bancaire_id: 'ligne-1' } }])
    expect(faux.updatesLignes).toEqual([])
    expect(faux.updatesEcritures.map((u) => [u.valeur, u.filtres])).toEqual([
      [{ date: '2025-05-20' }, ['piece_id=piece-a']],
      [{ date: '2025-05-25' }, ['piece_id=piece-b']],
    ])
  })

  it('dit une annulation que la base refuse, et le mouvement reste réglé', async () => {
    preparer(REGLE, PARTS)
    faux.erreurRpc = 'refus simulé'
    const alerte = vi.spyOn(window, 'alert').mockImplementation(() => {})
    rendre()
    await voirLesRapproches()
    await ouvrir('VIR FOURNISSEURS')
    await act(async () => { bouton('Annuler le règlement groupé').click() })
    await waitFor(() => expect(alerte).toHaveBeenCalledWith(expect.stringMatching(/Le règlement groupé n'a pas pu être annulé : refus simulé/)))
    expect(within(volet()).getByText('Règle 2 pièces')).toBeTruthy()
    expect(faux.updatesEcritures).toEqual([])
  })

  it('modifie un règlement en repartant de ses parts, et la pièce qui en sort retourne à sa date de facture', async () => {
    preparer(REGLE, PARTS)
    rendre()
    await voirLesRapproches()
    await ouvrir('VIR FOURNISSEURS')
    await act(async () => { within(volet()).getByRole('button', { name: 'Modifier le règlement…' }).click() })
    expect((within(volet()).getByLabelText('Pièce 1') as HTMLSelectElement).value).toBe('piece-a')
    expect([saisie(1), saisie(2)]).toEqual(['300.00', '200.00'])
    choisir(2, 'piece-c')
    await act(async () => { bouton('Enregistrer le règlement').click() })
    await waitFor(() => expect(reglementsRpc()).toHaveLength(1))
    expect(reglementsRpc()[0].args.p_parts).toEqual([{ piece_id: 'piece-a', montant: -300 }, { piece_id: 'piece-c', montant: -200 }])
    await waitFor(() => expect(faux.updatesEcritures.map((u) => u.filtres)).toContainEqual(['piece_id=piece-b']))
    expect(faux.updatesEcritures.find((u) => u.filtres[0] === 'piece_id=piece-b')?.valeur).toEqual({ date: '2025-05-25' })
  })

  it('dit une part dont la pièce a été supprimée depuis', async () => {
    preparer(REGLE, [PARTS[0], part('groupe-2', null, -200)])
    rendre()
    await voirLesRapproches()
    await ouvrir('VIR FOURNISSEURS')
    expect(within(volet()).getByText('Pièce supprimée')).toBeTruthy()
    expect(within(volet()).getByText(/Une pièce que ce mouvement réglait a été supprimée : sa part \(200,00.*\) ne justifie plus rien/)).toBeTruthy()
    // Le garde symétrique : un règlement dont toutes les pièces existent ne dit rien.
    cleanup()
    preparer(REGLE, PARTS)
    rendre()
    await voirLesRapproches()
    await ouvrir('VIR FOURNISSEURS')
    expect(within(volet()).queryByText(/ne justifie plus rien/)).toBeNull()
  })

  it('des parts lues en partie : l’écran le dit, et régler, modifier et annuler sont suspendus', async () => {
    preparer(REGLE, PARTS)
    faux.lignes = [...faux.lignes, ligneDeTest({ id: 'ligne-2', libelle: 'VIR CLIENTS', montant: -400 })]
    faux.muet = { reglements_groupes: 1 }
    rendre()
    expect(await screen.findByText(/Les parts des virements qui règlent plusieurs pièces n'ont pas pu être lues en entier/)).toBeTruthy()
    await ouvrir('VIR CLIENTS')
    await deplier()
    expect(within(volet()).getByText(/Régler plusieurs pièces est suspendu/)).toBeTruthy()
    choisir(1, 'piece-c')
    choisir(2, 'piece-b')
    expect(bouton().hasAttribute('disabled')).toBe(true)
    await voirLesRapproches()
    await ouvrir('VIR FOURNISSEURS')
    // Le nombre de pièces n'est pas dit sur des parts lues en partie : il serait faux.
    expect(within(volet()).getByText('Règle plusieurs pièces', { selector: '.badge' })).toBeTruthy()
    expect(within(volet()).queryByRole('button', { name: 'Modifier le règlement…' })).toBeNull()
    expect(bouton('Annuler le règlement groupé').hasAttribute('disabled')).toBe(true)
  })

  it('une pièce que règle un virement groupé n’est plus candidate ailleurs, ni au lot « Valider et rapprocher »', async () => {
    const monter = (groupe: boolean) => {
      reinitialiser()
      faux.pieces = [{ ...ALPHA, statut: 'a_valider' }, BETA]
      faux.lignes = [
        ligneDeTest({ libelle: 'VIR FOURNISSEURS', montant: -500, ...(groupe ? REGLE : {}) }),
        ligneDeTest({ id: 'ligne-2', libelle: 'PRLV ALPHA', montant: -300, date: '2025-05-21' }),
      ]
      faux.reglements = groupe ? PARTS : []
      rendre()
    }
    monter(true)
    await ouvrir('PRLV ALPHA')
    expect(within(volet()).queryByRole('option', { name: /Alpha/ })).toBeNull()
    expect(screen.queryByText(/Sans doute possible/)).toBeNull()
    // Le garde symétrique : la même pièce, que rien ne paie, est bien candidate — sans quoi ce test serait
    // satisfait par un écran qui ne propose jamais rien.
    cleanup()
    monter(false)
    await ouvrir('PRLV ALPHA')
    expect(within(volet()).getByRole('option', { name: /Alpha/ })).toBeTruthy()
    expect(screen.getByText(/Sans doute possible \(1\)/)).toBeTruthy()
  })

  it('une lecture partielle des parts suspend les lots de rapprochement', async () => {
    reinitialiser()
    faux.reglements = [part('ailleurs', 'piece-autre', -50)]
    faux.muet = { reglements_groupes: 0 }
    rendre()
    expect(await screen.findByText(/Rapprochement automatique suspendu : une lecture est incomplète/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Tout rapprocher automatiquement/ }).hasAttribute('disabled')).toBe(true)
  })

  it('offre d’abord les pièces que le mouvement règle dans son sens, puis les plus proches en date', async () => {
    preparer()
    rendre()
    await ouvrir('VIR FOURNISSEURS')
    await deplier()
    const options = [...(within(volet()).getByLabelText('Pièce 1') as HTMLSelectElement).options].map((o) => o.value)
    // Un paiement règle d'abord des factures d'achat — la plus proche du virement en tête : Gamma le 26/05, Beta le
    // 25/05, Alpha le 20/05 —, et l'avoir, qui se règle par une entrée, vient après elles bien qu'il soit le plus
    // proche en date.
    expect(options).toEqual(['', 'piece-c', 'piece-b', 'piece-a', 'avoir-b'])
  })

  it('ne propose de retirer une pièce qu’au-delà de deux : un règlement groupé en porte au moins deux', async () => {
    preparer()
    rendre()
    await ouvrir('VIR FOURNISSEURS')
    await deplier()
    expect(within(volet()).queryAllByRole('button', { name: /^Retirer la pièce/ })).toHaveLength(0)
    await act(async () => { within(volet()).getByRole('button', { name: 'Ajouter une pièce' }).click() })
    expect(within(volet()).getAllByRole('button', { name: /^Retirer la pièce/ })).toHaveLength(3)
    await act(async () => { within(volet()).getByRole('button', { name: 'Retirer la pièce 3' }).click() })
    expect(within(volet()).queryByLabelText('Pièce 3')).toBeNull()
    expect(within(volet()).queryAllByRole('button', { name: /^Retirer la pièce/ })).toHaveLength(0)
  })

  it('choisir une pièce n’écrase pas un montant déjà saisi', async () => {
    preparer()
    rendre()
    await ouvrir('VIR FOURNISSEURS')
    await deplier()
    fireEvent.change(within(volet()).getByLabelText('Part de la pièce 1'), { target: { value: '250' } })
    choisir(1, 'piece-a')
    expect(saisie(1)).toBe('250')
    // Le garde symétrique : sur une part vide, choisir propose ce qu'il reste à régler.
    choisir(2, 'piece-b')
    expect(saisie(2)).toBe('200.00')
  })

  it('une pièce en devise passe au débit réel — au total de ses paiements quand elle est payée aussi ailleurs', async () => {
    const USD = pieceDeTest({
      id: 'piece-usd', tiers: 'Delta', nom_fichier: 'delta.pdf', date_piece: '2025-05-27',
      devise: 'USD', montant_devise: 108, montant_ttc: 100, taux_change: 1.08, conversion_source: 'bce',
    })
    // Seule payée par sa part : le débit réel, 103 €, dépasse le provisoire de l'écart de change — et le devient.
    preparer({ montant: -403 })
    faux.pieces = [ALPHA, USD]
    rendre()
    await ouvrir('VIR FOURNISSEURS')
    await deplier()
    choisir(1, 'piece-a')
    choisir(2, 'piece-usd', '103')
    expect(bouton().hasAttribute('disabled')).toBe(false)
    await act(async () => { bouton().click() })
    await waitFor(() => expect(faux.updatesPieces).toEqual([expect.objectContaining({ montant_ttc: 103, conversion_source: 'banque' })]))

    // Un acompte l'a déjà payée en partie : elle passe au TOTAL que la banque a payé pour elle — l'acompte et sa part,
    // 101 € —, jamais à sa part seule, qui n'en est qu'une fraction (lib/reglementBanque.ts).
    cleanup()
    preparer({ montant: -351 })
    faux.pieces = [ALPHA, USD]
    faux.lignes = [...faux.lignes, ligneDeTest({ id: 'acompte', libelle: 'ACOMPTE DELTA', montant: -50, statut: 'rapprochee', piece_id: 'piece-usd' })]
    rendre()
    await ouvrir('VIR FOURNISSEURS')
    await deplier()
    choisir(1, 'piece-a')
    choisir(2, 'piece-usd', '51')
    await act(async () => { bouton().click() })
    await waitFor(() => expect(reglementsRpc()).toHaveLength(1))
    await waitFor(() => expect(within(volet()).getByText('Règle 2 pièces')).toBeTruthy())
    expect(faux.updatesPieces).toEqual([expect.objectContaining({ montant_ttc: 101, conversion_source: 'banque' })])
  })

  // PAYÉE EN DEUX FOIS, UNE PIÈCE EN EUROS SE RÈGLE SUR LE TOTAL DE SES PAIEMENTS : 300 € payés 150 + 149,99 passent à
  // 299,99 — sous le seuil, la banque fait foi. Réglée sur sa part seule, elle gardait un centime que rien n'écrit, qui
  // déséquilibrait son écriture et faisait refuser la validation de son exercice.
  it('une pièce en euros payée en deux fois s’aligne sur le total de ses paiements, sous le seuil', async () => {
    preparer({ montant: -349.99 })
    faux.lignes = [...faux.lignes, ligneDeTest({ id: 'acompte', libelle: 'ACOMPTE ALPHA', montant: -150, statut: 'rapprochee', piece_id: 'piece-a' })]
    rendre()
    await ouvrir('VIR FOURNISSEURS')
    await deplier()
    choisir(1, 'piece-a', '149.99')
    choisir(2, 'piece-b', '200')
    await act(async () => { bouton().click() })
    await waitFor(() => expect(reglementsRpc()).toHaveLength(1))
    await waitFor(() => expect(faux.updatesPieces).toEqual([expect.objectContaining({ montant_ttc: 299.99 })]))

    // Réglée de nouveau, son ancienne part du MÊME mouvement ne compte pas : seule la nouvelle s'ajoute à l'acompte.
    cleanup()
    preparer({ ...REGLE, montant: -349.99 }, [part('groupe-1', 'piece-a', -249.99), part('groupe-2', 'piece-b', -100)])
    faux.lignes = [...faux.lignes, ligneDeTest({ id: 'acompte', libelle: 'ACOMPTE ALPHA', montant: -150, statut: 'rapprochee', piece_id: 'piece-a' })]
    rendre()
    await voirLesRapproches()
    await ouvrir('VIR FOURNISSEURS')
    await act(async () => { within(volet()).getByRole('button', { name: 'Modifier le règlement…' }).click() })
    choisir(1, 'piece-a', '149.99')
    choisir(2, 'piece-b', '200')
    await act(async () => { bouton('Enregistrer le règlement').click() })
    await waitFor(() => expect(reglementsRpc()).toHaveLength(1))
    await waitFor(() => expect(faux.updatesPieces).toEqual([expect.objectContaining({ montant_ttc: 299.99 })]))
  })

  it('ne dit pas le nombre de pièces sur des parts lues en partie, même quand il en a lu plusieurs', async () => {
    preparer(REGLE, [...PARTS.map((p, i) => (i === 1 ? { ...p, montant: -150 } : p)), part('groupe-3', 'piece-c', -50)])
    faux.muet = { reglements_groupes: 2 }
    rendre()
    await voirLesRapproches()
    expect(await screen.findByText('Règle plusieurs pièces')).toBeTruthy()
    expect(screen.queryAllByText(/^Règle \d+ pièces$/)).toHaveLength(0)
    await ouvrir('VIR FOURNISSEURS')
    expect(within(volet()).getByText('Règle plusieurs pièces', { selector: '.badge' })).toBeTruthy()
    expect(within(volet()).queryAllByText(/^Règle \d+ pièces$/)).toHaveLength(0)
    // Deux parts lues sur trois ne font pas le mouvement : sur une lecture partielle, ce n'est pas un écart.
    expect(within(volet()).queryAllByText(/ne font plus le montant du mouvement/)).toHaveLength(0)
  })

  it('une lecture partielle des parts suspend aussi la validation en lot', async () => {
    reinitialiser()
    faux.pieces = [{ ...ALPHA, statut: 'a_valider' }]
    faux.lignes = [ligneDeTest({ id: 'ligne-2', libelle: 'PRLV ALPHA', montant: -300, date: '2025-05-21' })]
    faux.reglements = [part('ailleurs', 'piece-autre', -50)]
    faux.muet = { reglements_groupes: 0 }
    rendre()
    expect(await screen.findByText(/Validation en lot suspendue : une lecture est incomplète/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Valider et rapprocher cette pièce' }).hasAttribute('disabled')).toBe(true)
  })

  it('ne propose de régler plusieurs pièces ni sur un mouvement déjà rapproché, ni sur un mouvement de zéro euro', async () => {
    preparer({ statut: 'rapprochee', piece_id: 'piece-a' })
    rendre()
    await voirLesRapproches()
    await ouvrir('VIR FOURNISSEURS')
    expect(within(volet()).queryByRole('button', { name: 'Régler plusieurs pièces…' })).toBeNull()
    cleanup()
    preparer({ montant: 0 })
    rendre()
    await ouvrir('VIR FOURNISSEURS')
    expect(within(volet()).queryByRole('button', { name: 'Régler plusieurs pièces…' })).toBeNull()
  })
})

// LA CARTE DE CONNEXION BANCAIRE DANS L'ONGLET. Ses propres tests la montent seule, avec ses props écrites à
// la main : rien n'y vérifie que l'onglet lui passe SON relevé, SES règles et SA suspension — or c'est le
// relevé qui écarte un mouvement déjà importé d'un fichier, les règles qui décident du statut écrit, et la
// suspension qui empêche d'importer sur une lecture partielle. Une carte branchée sur une liste vide
// importerait en double, en silence.
describe('BanqueTab — la connexion bancaire', () => {
  const connexion = {
    banque_nom: 'Mock ASPSP', banque_pays: 'FI', type_acces: 'personal', environnement: 'SANDBOX', etat: 'active',
    valide_jusqu_au: '2099-01-01T00:00:00+00:00', derniere_recuperation: null, created_at: '2025-06-01T08:00:00+00:00',
    compte_empreinte: 'emp-courant',
    comptes: [{ empreinte: 'emp-courant', nom: 'Compte courant', devise: 'EUR', iban_fin: '0042', mouvements_lisibles: true }],
  }
  const recuperation = {
    du: '2025-06-01', au: '2025-06-30', complete: true, motif: null, banque_nom: 'Mock ASPSP', environnement: 'SANDBOX',
    compte: { nom: 'Compte courant', iban_fin: '0042' }, avertissement: null,
    ecartes: { non_comptabilises: 0, autre_devise: 0, hors_periode: 0, illisibles: 0, doublons: 0 },
    mouvements: [
      // Le même mouvement que la ligne du relevé importé en fichier : même date, même montant.
      { id_externe: 'eb:r:fichier', date: '2025-06-02', libelle: 'PRLV SEPA FOURNISSEUR — FICTIF SA', montant: -100 },
      { id_externe: 'eb:r:assurance', date: '2025-06-10', libelle: 'PRLV SEPA ASSURANCE FICTIVE', montant: -50 },
    ],
  }
  const regle = (motif: string): RegleBancaireIgnoree => ({ id: `r-${motif}`, dossier_id: 'dossier-de-test', motif, created_at: '2025-06-01T09:00:00Z' })

  async function recuperer() {
    const bouton = await screen.findByRole('button', { name: 'Récupérer les mouvements' })
    await act(async () => { bouton.click() })
  }

  it('la carte reçoit le relevé, les règles et le rechargement de l’onglet', async () => {
    reinitialiser()
    faux.connexionBancaire = { connexion, recuperation }
    faux.reglesIgnorees = [regle('assurance fictive')]
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    rendre()
    await recuperer()
    // Le relevé de l'onglet : le mouvement déjà importé d'un fichier est écarté de l'import.
    expect(screen.getByText('1 à importer').parentElement!.textContent).toContain('1 déjà dans un relevé importé en fichier')
    await act(async () => { screen.getByRole('button', { name: 'Importer les 1 mouvement(s)' }).click() })
    // Les règles de l'onglet : le statut écrit est celui qu'elles décident.
    const importe = faux.upserts.find((u) => u.table === 'lignes_bancaires')
    expect(importe?.valeur).toEqual([expect.objectContaining({ id_externe: 'eb:r:assurance', statut: 'ignoree' })])
    // Le rechargement de l'onglet : relue, la carte sait que ce mouvement est désormais au relevé — une
    // seconde récupération ne le proposerait plus. Sans lui, elle le reproposerait jusqu'à recharger la page.
    await screen.findByText(/1 mouvement\(s\) importé\(s\) dans le relevé/)
    await recuperer()
    const apercu = (await screen.findByText('0 à importer')).parentElement!.textContent!
    expect(apercu).toContain('1 déjà importé(s)')
  })

  it('une lecture partielle du relevé suspend l’import de la banque', async () => {
    reinitialiser()
    faux.connexionBancaire = { connexion, recuperation }
    faux.muet = { lignes_bancaires: 0 }
    rendre()
    await recuperer()
    expect(screen.getByText(/Import suspendu : une lecture de l'onglet est incomplète/)).toBeTruthy()
    expect((screen.getByRole('button', { name: /^Importer les/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('une lecture partielle des règles « toujours ignorer » la suspend aussi', async () => {
    reinitialiser()
    faux.connexionBancaire = { connexion, recuperation }
    faux.reglesIgnorees = [regle('assurance fictive')]
    faux.muet = { regles_bancaires_ignorees: 0 }
    rendre()
    await recuperer()
    expect(screen.getByText(/Import suspendu : une lecture de l'onglet est incomplète/)).toBeTruthy()
    expect((screen.getByRole('button', { name: /^Importer les/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('une lecture complète n’est pas suspendue — le garde symétrique', async () => {
    reinitialiser()
    faux.connexionBancaire = { connexion, recuperation }
    rendre()
    await recuperer()
    expect(screen.queryByText(/Import suspendu/)).toBeNull()
    expect((screen.getByRole('button', { name: /^Importer les/ }) as HTMLButtonElement).disabled).toBe(false)
  })
  // LIGNE 26.6 (d) : la frontière de validation vient de l'onglet — la carte, montée seule, reçoit la sienne écrite à
  // la main. Le mouvement de juin 2025 déjà importé d'un fichier reste « déjà dans un relevé » ; l'autre tombe dans
  // l'exercice validé, ne s'importe pas, et la carte le dit.
  it('la carte reçoit la frontière de validation de l’onglet', async () => {
    reinitialiser()
    faux.connexionBancaire = { connexion, recuperation }
    rendre(TRESORERIE, false, [2025])
    await recuperer()
    expect(screen.getByText('0 à importer').parentElement!.textContent).toContain('1 déjà dans un relevé importé en fichier')
    expect(screen.getByText(/Un mouvement daté d’un exercice validé, au plus tard le 31\/12\/2025, ne s’importe pas/)).toBeTruthy()
  })
})

// LIGNE 26.6 (d) : CE QU'UN EXERCICE VALIDÉ A FIGÉ. Un mouvement daté au plus tard à la frontière ne s'importe, ne se
// rapproche, ne se classe et ne se modifie plus — la base le refuse (`garder_mouvement_valide`). Ce qu'aucun test de
// `src/lib` ne voit : que l'écran lise les exercices validés que la page du dossier lui fournit, écarte ces lignes des
// deux imports en le disant, ne propose plus aucun geste sur un mouvement figé — en le disant aussi —, et ne réclame
// plus le taux de TVA qu'il ne pourrait plus recevoir.
describe('BanqueTab — un exercice validé', () => {
  const alertes: string[] = []
  beforeEach(() => {
    alertes.length = 0
    vi.spyOn(window, 'alert').mockImplementation((m?: unknown) => { alertes.push(String(m)) })
  })
  const RECETTES = categorieDeTest({
    id: 'cat-recettes', code: 'ventes_prestations', libelle: 'Ventes / prestations', ordre: 10,
    compte_comptable: '706000', poste_2035: 'Recettes',
  })
  const EMPRUNT: Emprunt = {
    id: 'emp-1', dossier_id: 'dossier-de-test', nom: 'Prêt matériel', organisme_preteur: 'Banque du Midi',
    capital_initial: 12000, taux_annuel: 3.6, date_debut: '2025-01-05', duree_mois: 24, created_at: '2025-01-05T10:00:00Z',
  }
  async function voirLesRapproches() {
    await act(async () => { (await screen.findByRole('button', { name: 'Rapprochés' })).click() })
  }
  async function deposerCsv(csv: string, lignes = 2) {
    const fichier = new File([csv], 'releve.csv', { type: 'text/csv' })
    const champ = document.querySelector('input[type=file][accept=".csv,text/csv"]') as HTMLInputElement
    await act(async () => { fireEvent.change(champ, { target: { files: [fichier] } }) })
    return screen.findByRole('button', { name: new RegExp(`Importer ${lignes} ligne\\(s\\)`) })
  }
  const lot = () => faux.insertions.filter((i) => i.table === 'lignes_bancaires')

  it('l’import d’un fichier écarte la ligne d’un exercice validé, importe les autres, et le dit', async () => {
    reinitialiser()
    faux.lignes = []
    rendre(TRESORERIE, false, [2025])
    const bouton = await deposerCsv('Date;Libellé;Montant\n05/06/2025;VIR CLIENT DUPONT;250,00\n10/01/2026;VIR CLIENT MARTIN;300,00\n')
    await act(async () => { bouton.click() })
    expect(lot()).toHaveLength(1)
    expect(lot()[0].valeur).toEqual([expect.objectContaining({ libelle: 'VIR CLIENT MARTIN', montant: 300 })])
    expect(alertes).toEqual([expect.stringMatching(
      /1 ligne\(s\) importée\(s\), 1 datée\(s\) d’un exercice validé, non importée\(s\)\.[\s\S]*Une ligne datée d’un exercice validé, au plus tard le 31\/12\/2025, ne s’importe pas/,
    )])
  })

  it('plusieurs lignes d’un exercice validé se disent au pluriel', async () => {
    reinitialiser()
    faux.lignes = []
    rendre(TRESORERIE, false, [2025])
    const bouton = await deposerCsv(
      'Date;Libellé;Montant\n05/06/2025;VIR CLIENT DUPONT;250,00\n06/06/2025;VIR CLIENT DURAND;120,00\n10/01/2026;VIR CLIENT MARTIN;300,00\n', 3)
    await act(async () => { bouton.click() })
    expect(lot()[0].valeur).toEqual([expect.objectContaining({ libelle: 'VIR CLIENT MARTIN' })])
    expect(alertes).toEqual([expect.stringMatching(
      /2 datée\(s\) d’un exercice validé[\s\S]*2 lignes datées d’un exercice validé, au plus tard le 31\/12\/2025, ne s’importent pas — un exercice validé ne reçoit plus de mouvement\. Le relevé de cet exercice ne les porte pas/,
    )])
  })

  it('un relevé dont rien n’est à importer le dit, sans rien envoyer', async () => {
    // Le 02/06/2025 est déjà au relevé ; le 05/06/2025 tombe dans l'exercice validé.
    reinitialiser()
    rendre(TRESORERIE, false, [2025])
    const bouton = await deposerCsv('Date;Libellé;Montant\n02/06/2025;PRLV SEPA FOURNISSEUR;-100,00\n05/06/2025;VIR CLIENT DUPONT;250,00\n')
    await act(async () => { bouton.click() })
    expect(lot()).toHaveLength(0)
    expect(screen.getByText(/Rien à importer : une ligne datée d’un exercice validé, au plus tard le 31\/12\/2025, ne s’importe pas.*L’autre est déjà au relevé\./)).toBeTruthy()
  })

  // Le garde symétrique : sans exercice validé, la même ligne s'importe, et rien n'est dit.
  it('sans exercice validé, la ligne de 2025 s’importe', async () => {
    reinitialiser()
    faux.lignes = []
    rendre()
    const bouton = await deposerCsv('Date;Libellé;Montant\n05/06/2025;VIR CLIENT DUPONT;250,00\n10/01/2026;VIR CLIENT MARTIN;300,00\n')
    await act(async () => { bouton.click() })
    expect(lot()[0].valeur).toHaveLength(2)
    expect(alertes).toEqual([])
  })

  it('le chemin PDF écarte aussi la ligne d’un exercice validé, et le dit', async () => {
    reinitialiser()
    faux.lignes = []
    faux.lignesPdf = [
      { texte: '05/06/2025 VIR CLIENT DUPONT 250,00', xFin: 0 },
      { texte: '10/01/2026 VIR CLIENT MARTIN 300,00', xFin: 0 },
    ]
    rendre(TRESORERIE, false, [2025])
    await act(async () => { (await screen.findByRole('button', { name: 'PDF' })).click() })
    const fichier = new File(['%PDF'], 'releve.pdf', { type: 'application/pdf' })
    const champ = document.querySelector('input[type=file][accept=".pdf,application/pdf"]') as HTMLInputElement
    await act(async () => { fireEvent.change(champ, { target: { files: [fichier] } }) })
    const bouton = await screen.findByRole('button', { name: /Importer 2 ligne\(s\)/ })
    await act(async () => { bouton.click() })
    expect(lot()).toHaveLength(1)
    expect(lot()[0].valeur).toEqual([expect.objectContaining({ libelle: 'VIR CLIENT MARTIN', montant: 300 })])
    expect(alertes).toEqual([expect.stringMatching(/Une ligne datée d’un exercice validé, au plus tard le 31\/12\/2025, ne s’importe pas/)])
  })

  it('le chemin PDF dont rien n’est à importer le dit aussi, sans rien envoyer', async () => {
    reinitialiser()
    faux.lignes = []
    faux.lignesPdf = [
      { texte: '05/06/2025 VIR CLIENT DUPONT 250,00', xFin: 0 },
      { texte: '06/06/2025 VIR CLIENT DURAND 120,00', xFin: 0 },
    ]
    rendre(TRESORERIE, false, [2025])
    await act(async () => { (await screen.findByRole('button', { name: 'PDF' })).click() })
    const fichier = new File(['%PDF'], 'releve.pdf', { type: 'application/pdf' })
    const champ = document.querySelector('input[type=file][accept=".pdf,application/pdf"]') as HTMLInputElement
    await act(async () => { fireEvent.change(champ, { target: { files: [fichier] } }) })
    const bouton = await screen.findByRole('button', { name: /Importer 2 ligne\(s\)/ })
    await act(async () => { bouton.click() })
    expect(lot()).toHaveLength(0)
    expect(screen.getByText(/Rien à importer : 2 lignes datées d’un exercice validé, au plus tard le 31\/12\/2025, ne s’importent pas/)).toBeTruthy()
  })

  it('la fiche d’un mouvement figé ne propose plus rien, et dit l’exercice qui le fige', async () => {
    reinitialiser()
    faux.lignes = [ligneDeTest({ statut: 'rapprochee', piece_id: 'piece-1' })]
    rendre(TRESORERIE, false, [2025])
    await voirLesRapproches()
    await ouvrir()
    expect(within(volet()).getByText(/L'exercice 2025 est validé : ce mouvement ne se rapproche, ne se classe et ne se modifie plus/)).toBeTruthy()
    expect(within(volet()).queryByRole('button', { name: 'Annuler le rapprochement' })).toBeNull()
    cleanup()

    // Figé par la validation d'un exercice POSTÉRIEUR : la phrase de la base, pas « validé ».
    reinitialiser()
    faux.lignes = [ligneDeTest({ statut: 'rapprochee', piece_id: 'piece-1' })]
    rendre(TRESORERIE, false, [2026])
    await voirLesRapproches()
    await ouvrir()
    expect(within(volet()).getByText(/L'exercice 2025 est figé par la validation de l'exercice 2026 : ce mouvement ne se rapproche/)).toBeTruthy()
    cleanup()

    // Le garde symétrique : le lendemain de la frontière, le geste est là, et rien n'est dit.
    reinitialiser()
    faux.lignes = [ligneDeTest({ statut: 'rapprochee', piece_id: 'piece-1' })]
    rendre(TRESORERIE, false, [2024])
    await voirLesRapproches()
    await ouvrir()
    expect(within(volet()).getByRole('button', { name: 'Annuler le rapprochement' })).toBeTruthy()
    expect(within(volet()).queryByText(/ne se modifie plus/)).toBeNull()
  })

  it('un mouvement affecté figé ne se réaffecte plus, et son taux n’est plus réclamé', async () => {
    const ligne = () => screen.getAllByText('VIR CPAM').find((e) => e.closest('tr')?.classList.contains('clickable'))!.closest('tr')!
    reinitialiser()
    faux.pieces = []
    faux.categories = [RECETTES]
    faux.lignes = [ligneDeTest({ libelle: 'VIR CPAM', montant: 120, statut: 'rapprochee', categorie_id: 'cat-recettes' })]
    rendre(TRESORERIE, true, [2025])
    await voirLesRapproches()
    await waitFor(() => expect(ligne().textContent).toMatch(/Affecté/))
    expect(ligne().textContent).not.toMatch(/TVA à choisir/)
    await ouvrir('VIR CPAM')
    expect(within(volet()).getByText(/ne se modifie plus/)).toBeTruthy()
    expect(within(volet()).queryByRole('button', { name: 'Annuler l’affectation' })).toBeNull()
    expect(within(volet()).queryByRole('button', { name: 'Réaffecter' })).toBeNull()
    expect(within(volet()).queryByLabelText('Catégorie')).toBeNull()
    expect(within(volet()).queryByText(/cette recette n’a pas de taux/)).toBeNull()
  })

  it('un mouvement ventilé, réglé en groupe ou d’emprunt figé ne se modifie plus', async () => {
    reinitialiser()
    faux.categories = [RECETTES]
    faux.emprunts = [EMPRUNT]
    faux.lignes = [
      ligneDeTest({ id: 'l-vent', libelle: 'REMISE CB', montant: 95, statut: 'rapprochee', ventilee: true }),
      ligneDeTest({ id: 'l-groupe', libelle: 'VIR FOURNISSEURS', montant: -100, statut: 'rapprochee', reglement_groupe: true }),
      ligneDeTest({
        id: 'l-emprunt', libelle: 'PRLV ECHEANCE PRET', montant: -540, date: '2025-02-06', statut: 'rapprochee',
        emprunt_id: 'emp-1', emprunt_echeance: 1, emprunt_interets: 36, emprunt_assurance: 21.03,
      }),
    ]
    faux.ventilations = [
      { id: 'v1', dossier_id: 'dossier-de-test', ligne_bancaire_id: 'l-vent', categorie_id: 'cat-recettes', part_personnelle: false, montant: 100, taux_tva: null, created_at: '2025-06-02T10:00:00Z' },
      { id: 'v2', dossier_id: 'dossier-de-test', ligne_bancaire_id: 'l-vent', categorie_id: null, part_personnelle: true, montant: -5, taux_tva: null, created_at: '2025-06-02T10:00:00Z' },
    ]
    faux.reglements = [{ id: 'g1', dossier_id: 'dossier-de-test', ligne_bancaire_id: 'l-groupe', piece_id: 'piece-1', montant: -100, created_at: '2025-06-02T10:00:00Z' }]
    rendre(TRESORERIE, false, [2025])
    await voirLesRapproches()

    await ouvrir('REMISE CB')
    expect(within(volet()).getByText(/ne se modifie plus/)).toBeTruthy()
    expect(within(volet()).queryByRole('button', { name: 'Modifier la ventilation…' })).toBeNull()
    expect(within(volet()).queryByRole('button', { name: 'Annuler la ventilation' })).toBeNull()

    await ouvrir('VIR FOURNISSEURS')
    expect(within(volet()).getByText(/ne se modifie plus/)).toBeTruthy()
    expect(within(volet()).queryByRole('button', { name: 'Modifier le règlement…' })).toBeNull()
    expect(within(volet()).queryByRole('button', { name: 'Annuler le règlement groupé' })).toBeNull()

    await ouvrir('PRLV ECHEANCE PRET')
    expect(within(volet()).getByText(/ne se modifie plus/)).toBeTruthy()
    expect(within(volet()).queryByRole('button', { name: 'Corriger le découpage…' })).toBeNull()
    expect(within(volet()).queryByRole('button', { name: 'Annuler le rapprochement' })).toBeNull()
  })

  // Les catégories restent libres après une validation : leur compte ou leur poste peut changer. Les alertes qui en
  // découlent demandent de réaffecter ou de modifier la ventilation — un geste que la base refuse sur un mouvement
  // figé. Elles se taisent ; la fiche dit pourquoi rien ne se modifie.
  it('les alertes d’un mouvement affecté ou ventilé figé, qui demanderaient un geste impossible, se taisent', async () => {
    const HORS_RESULTAT = categorieDeTest({ id: 'cat-hors', libelle: 'Ancienne recette', code: 'autre', compte_comptable: '467000', poste_2035: 'Recettes' })
    const SANS_POSTE = categorieDeTest({ id: 'cat-sans-poste', libelle: 'Honoraires reçus', code: 'autre', compte_comptable: '706100', poste_2035: null })
    const ALERTES = [
      /n’est plus un compte de charge ou de produit/, /ne sont plus des comptes de charge ou de produit/,
      /pas de taux/, /pas de poste 2035/,
    ]
    const jeu = () => {
      reinitialiser()
      faux.pieces = []
      faux.categories = [RECETTES, HORS_RESULTAT, SANS_POSTE]
      faux.lignes = [
        ligneDeTest({ id: 'l-hors', libelle: 'VIR ANCIEN', montant: 80, statut: 'rapprochee', categorie_id: 'cat-hors' }),
        ligneDeTest({ id: 'l-poste', libelle: 'VIR HONORAIRES', montant: 60, statut: 'rapprochee', categorie_id: 'cat-sans-poste', taux_tva: 0 }),
        ligneDeTest({ id: 'l-vent', libelle: 'REMISE CB', montant: 300, statut: 'rapprochee', ventilee: true }),
      ]
      faux.ventilations = [
        { id: 'v1', dossier_id: 'dossier-de-test', ligne_bancaire_id: 'l-vent', categorie_id: 'cat-recettes', part_personnelle: false, montant: 100, taux_tva: null, created_at: '2025-06-02T10:00:00Z' },
        { id: 'v2', dossier_id: 'dossier-de-test', ligne_bancaire_id: 'l-vent', categorie_id: 'cat-hors', part_personnelle: false, montant: 120, taux_tva: null, created_at: '2025-06-02T10:00:00Z' },
        { id: 'v3', dossier_id: 'dossier-de-test', ligne_bancaire_id: 'l-vent', categorie_id: 'cat-sans-poste', part_personnelle: false, montant: 80, taux_tva: 0, created_at: '2025-06-02T10:00:00Z' },
      ]
    }
    const ligneDu = (libelle: string) => screen.getAllByText(libelle).find((e) => e.closest('tr')?.classList.contains('clickable'))!.closest('tr')!
    const parcourir = async (attendu: 'tues' | 'dits') => {
      await voirLesRapproches()
      // La pastille de la liste comme l'alerte de la fiche : la part de recette sans taux d'un mouvement ventilé figé
      // ne se réclame plus.
      await waitFor(() => expect(ligneDu('REMISE CB').textContent).toMatch(/Ventilé/))
      if (attendu === 'tues') expect(ligneDu('REMISE CB').textContent).not.toMatch(/TVA à choisir/)
      else expect(ligneDu('REMISE CB').textContent).toMatch(/TVA à choisir/)
      for (const libelle of ['VIR ANCIEN', 'VIR HONORAIRES', 'REMISE CB']) {
        await ouvrir(libelle)
        const texte = volet().textContent!
        const dites = ALERTES.filter((a) => a.test(texte))
        if (attendu === 'tues') expect(dites, libelle).toEqual([])
        else expect(dites.length, libelle).toBeGreaterThan(0)
      }
    }
    jeu()
    rendre(TRESORERIE, true, [2025])
    await parcourir('tues')
    cleanup()
    // Le garde symétrique : sans exercice validé, chacun des trois mouvements porte son alerte — le jeu les
    // déclenche bien toutes.
    jeu()
    rendre(TRESORERIE, true)
    await parcourir('dits')
  })

  it('un virement personnel ou une échéance de cotisation figés ne se remettent plus à traiter, et la fiche ne le promet pas', async () => {
    reinitialiser()
    faux.pieces = []
    faux.cotisations = [{
      id: 'cot-1', dossier_id: 'dossier-de-test', echeance: '2025-06-05', montant_appele: 100, montant_verse: null,
      montant_csg_crds: 9.7, previsionnel: false, created_at: '2025-01-10T09:00:00Z',
    }]
    faux.lignes = [
      ligneDeTest({ id: 'l-perso', libelle: 'VIR COMPTE PERSO', montant: -500, statut: 'ignoree', prelevement_personnel: true }),
      ligneDeTest({ id: 'l-urssaf', libelle: 'PRLV URSSAF', montant: -100, date: '2025-06-06', statut: 'rapprochee', cotisation_id: 'cot-1' }),
    ]
    rendre(TRESORERIE, false, [2025])
    await act(async () => { (await screen.findByRole('button', { name: 'Tous' })).click() })

    await ouvrir('VIR COMPTE PERSO')
    expect(within(volet()).getByText(/Ni charge ni recette : il s’écrit sur le compte/)).toBeTruthy()
    expect(within(volet()).getByText(/ne se modifie plus/)).toBeTruthy()
    expect(within(volet()).queryByRole('button', { name: 'Remettre à traiter' })).toBeNull()
    expect(within(volet()).queryByText(/« Remettre à traiter » retire aussi son écriture/)).toBeNull()

    await ouvrir('PRLV URSSAF')
    expect(within(volet()).getByText(/S’écrit face à la banque/)).toBeTruthy()
    expect(within(volet()).getByText(/ne se modifie plus/)).toBeTruthy()
    expect(within(volet()).queryByRole('button', { name: 'Annuler le rapprochement' })).toBeNull()
    expect(within(volet()).queryByText(/« Annuler le rapprochement » retire aussi son écriture/)).toBeNull()
  })
})

// UNE PIÈCE QU'UN EXERCICE VALIDÉ A FIGÉE (lib/piecesFigeesLecture.ts). En TRÉSORERIE, une pièce qui porte elle-même une
// écriture validée s'équilibre sans paiement — une note de frais, face au compte de l'exploitant — : la rapprocher la
// redaterait au paiement, ce que la base refuse, et la 2035 de l'exercice suivant la compterait une seconde fois. Elle
// n'est donc plus proposée, ni choisie, ni réglée en groupe, et un paiement du même montant ne s'affecte pas en lot. En
// ENGAGEMENT, sa facture validée se règle normalement. Dans les deux, aucune pièce figée ne s'aligne plus sur la banque.
describe('BanqueTab — une pièce figée par un exercice validé', () => {
  const NOTE = pieceDeTest({ id: 'note-1', type_piece: 'note_frais', tiers: 'Restaurant du Port', nom_fichier: 'note.pdf', date_piece: '2025-12-30', montant_ttc: 1000 })
  const ECRITURE_DE_LA_NOTE = { id: 'ev-note', statut: 'validee', date: '2025-12-30', piece_id: 'note-1', immobilisation_id: null }
  const FRAIS = categorieDeTest()
  function preparer({ figee = true, montant = -1000 }: { figee?: boolean; montant?: number } = {}) {
    reinitialiser()
    faux.pieces = [NOTE]
    faux.lignes = [ligneDeTest({ id: 'l-rembt', libelle: 'VIR REMBOURSEMENT FRAIS', date: '2026-01-02', montant })]
    faux.ecrituresValidees = figee ? [ECRITURE_DE_LA_NOTE] : []
  }
  const texte = () => volet().textContent!.replace(/\s/g, ' ')
  const ligneDuReleve = (libelle: string) =>
    screen.getAllByText(libelle).find((e) => e.closest('tr')?.classList.contains('clickable'))!.closest('tr')!

  it('en trésorerie, la note figée n’est plus proposée, ni choisie, ni réglée en groupe — et la fiche le dit', async () => {
    preparer()
    rendre(TRESORERIE, false, [2025])
    await ouvrir('VIR REMBOURSEMENT FRAIS')
    expect(within(volet()).queryByRole('button', { name: 'Associer cette pièce' })).toBeNull()
    expect(within(volet()).queryByLabelText('Pièce')).toBeNull()
    expect(texte()).toMatch(/Restaurant du Port \(30\/12\/2025, 1 000,00 €\), du même montant, porte une écriture d’un exercice validé : elle ne se rapproche plus d’aucun mouvement\. Si ce mouvement rembourse cette note de frais, classe-le en virement personnel\./)
    // « Déjà rapprochées » serait faux : la note n'est payée par rien.
    expect(texte()).toMatch(/déjà rapprochées d’un autre mouvement, ou figées par un exercice validé/)
    await act(async () => { within(volet()).getByRole('button', { name: 'Régler plusieurs pièces…' }).click() })
    const options = [...(within(volet()).getByLabelText('Pièce 1') as HTMLSelectElement).options].map((o) => o.value)
    expect(options).not.toContain('note-1')
    // Ni l'avertissement de l'affectation, qui l'appellerait « une pièce qui attend un rapprochement ».
    expect(texte()).not.toMatch(/attend un rapprochement/)
    // Ni la liste, ni les lots : pas de suggestion sur la ligne, rien « à trancher », pas de « Tout rapprocher ».
    expect(ligneDuReleve('VIR REMBOURSEMENT FRAIS').textContent).not.toMatch(/suggestion/)
    expect(screen.queryByText(/À trancher par l'opérateur/)).toBeNull()
    expect(screen.queryByRole('button', { name: /Tout rapprocher automatiquement/ })).toBeNull()
  })

  // Le garde symétrique : la même note, sans exercice validé, est proposée — le jeu la propose bien.
  it('sans écriture validée, la même note est proposée, et rien n’est dit de la validation', async () => {
    preparer({ figee: false })
    rendre(TRESORERIE, false, [2025])
    await ouvrir('VIR REMBOURSEMENT FRAIS')
    expect(within(volet()).getByRole('button', { name: 'Associer cette pièce' })).toBeTruthy()
    expect(texte()).not.toMatch(/exercice validé/)
    expect(texte()).toMatch(/Une pièce du même montant attend un rapprochement/)
    expect(ligneDuReleve('VIR REMBOURSEMENT FRAIS').textContent).toMatch(/suggestion/)
    expect(screen.getByText(/À trancher par l'opérateur/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Tout rapprocher automatiquement \(1\)/ })).toBeTruthy()
  })

  it('une pièce figée qui n’est pas une note de frais ne propose pas le virement personnel', async () => {
    preparer()
    faux.pieces = [{ ...NOTE, type_piece: 'achat' }]
    rendre(TRESORERIE, false, [2025])
    await ouvrir('VIR REMBOURSEMENT FRAIS')
    expect(texte()).toMatch(/porte une écriture d’un exercice validé : elle ne se rapproche plus d’aucun mouvement\./)
    expect(texte()).not.toMatch(/classe-le en virement personnel/)
  })

  it('en engagement, la facture figée se règle — sans s’aligner sur le montant de la banque', async () => {
    preparer({ montant: -999.99 })
    faux.majImmediate = true
    rendre(ENGAGEMENT, false, [2025])
    const bouton = await screen.findByRole('button', { name: /Tout rapprocher automatiquement \(1\)/ })
    await act(async () => { bouton.click() })
    await waitFor(() => expect(faux.updatesLignes).toEqual([{ statut: 'rapprochee', piece_id: 'note-1' }]))
    expect(faux.updatesPieces).toEqual([])
  })

  // Le garde symétrique de l'alignement : la même pièce, non figée, passe au montant de la banque.
  it('non figée, la même pièce s’aligne sur le montant de la banque', async () => {
    preparer({ figee: false, montant: -999.99 })
    faux.majImmediate = true
    rendre(ENGAGEMENT, false, [2025])
    const bouton = await screen.findByRole('button', { name: /Tout rapprocher automatiquement \(1\)/ })
    await act(async () => { bouton.click() })
    await waitFor(() => expect(faux.updatesPieces).toEqual([expect.objectContaining({ montant_ttc: 999.99 })]))
  })

  it('en engagement, l’associer à la main ou la régler en groupe ne l’aligne pas non plus', async () => {
    preparer({ montant: -999.99 })
    faux.majImmediate = true
    rendre(ENGAGEMENT, false, [2025])
    await ouvrir('VIR REMBOURSEMENT FRAIS')
    expect(texte()).not.toMatch(/exercice validé/)
    await act(async () => { within(volet()).getByRole('button', { name: 'Associer cette pièce' }).click() })
    await waitFor(() => expect(faux.updatesLignes).toEqual([{ statut: 'rapprochee', piece_id: 'note-1' }]))
    expect(faux.updatesPieces).toEqual([])
    cleanup()

    // Réglée en groupe avec une autre pièce, dont la part est son seul paiement : c'est le cas où la part l'alignerait.
    preparer({ montant: -1499.99 })
    faux.pieces = [NOTE, pieceDeTest({ id: 'piece-autre', tiers: 'Autre', nom_fichier: 'autre.pdf', date_piece: '2025-12-28', montant_ttc: 500 })]
    rendre(ENGAGEMENT, false, [2025])
    await ouvrir('VIR REMBOURSEMENT FRAIS')
    await act(async () => { within(volet()).getByRole('button', { name: 'Régler plusieurs pièces…' }).click() })
    fireEvent.change(within(volet()).getByLabelText('Pièce 1'), { target: { value: 'note-1' } })
    fireEvent.change(within(volet()).getByLabelText('Part de la pièce 1'), { target: { value: '999.99' } })
    fireEvent.change(within(volet()).getByLabelText('Pièce 2'), { target: { value: 'piece-autre' } })
    await act(async () => { within(volet()).getByRole('button', { name: 'Régler ces pièces' }).click() })
    await waitFor(() => expect(faux.rpcs.filter((r) => r.nom === 'regler_pieces_par_mouvement')).toHaveLength(1))
    expect(faux.updatesPieces).toEqual([])
  })

  it('en trésorerie, une facture figée par le seul bien qu’elle justifie reste proposée, sans s’aligner', async () => {
    reinitialiser()
    faux.majImmediate = true
    faux.pieces = [pieceDeTest({ id: 'facture-bien', tiers: 'Matériel Médical', date_piece: '2025-12-30', montant_ttc: 1000 })]
    faux.lignes = [ligneDeTest({ id: 'l-bien', libelle: 'PRLV MATERIEL MEDICAL', date: '2026-01-02', montant: -999.99 })]
    faux.immobilisations = [{ id: 'bien-1', piece_id: 'facture-bien' }]
    faux.ecrituresValidees = [{ id: 'ev-dotation', statut: 'validee', date: '2025-12-31', piece_id: null, immobilisation_id: 'bien-1' }]
    rendre(TRESORERIE, false, [2025])
    const bouton = await screen.findByRole('button', { name: /Tout rapprocher automatiquement \(1\)/ })
    await act(async () => { bouton.click() })
    await waitFor(() => expect(faux.updatesLignes).toEqual([{ statut: 'rapprochee', piece_id: 'facture-bien' }]))
    expect(faux.updatesPieces).toEqual([])
  })

  it('une lecture partielle des pièces figées le dit, et suspend le rapprochement automatique en trésorerie', async () => {
    preparer({ figee: false })
    faux.immobilisations = [{ id: 'bien-1', piece_id: null }, { id: 'bien-2', piece_id: null }]
    faux.muet = { immobilisations: 1 }
    rendre(TRESORERIE, false, [2025])
    expect(await screen.findByText(/Les écritures validées et les immobilisations du dossier n'ont pas pu être lues en entier/)).toBeTruthy()
    expect(screen.getByText(/peut donc être proposée au rapprochement : la base refuserait d’en redater les écritures validées/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Tout rapprocher automatiquement \(1\)/ }).hasAttribute('disabled')).toBe(true)
    cleanup()

    // En engagement, la pièce figée se règle de toute façon : le lot reste ouvert, et le bandeau dit l'autre conséquence.
    preparer({ figee: false })
    faux.immobilisations = [{ id: 'bien-1', piece_id: null }, { id: 'bien-2', piece_id: null }]
    faux.muet = { immobilisations: 1 }
    rendre(ENGAGEMENT, false, [2025])
    expect(await screen.findByText(/peut donc paraître encore alignable sur le montant de la banque/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Tout rapprocher automatiquement \(1\)/ }).hasAttribute('disabled')).toBe(false)
  })

  it('un paiement du même montant qu’une note figée ne s’affecte pas en lot, et le lot dit pourquoi', async () => {
    preparer()
    faux.categories = [FRAIS]
    faux.reglesAffectation = [regleDeTest({ motif: 'remboursement', sens: 'decaissement', categorie_id: 'cat-frais' })]
    rendre(TRESORERIE, false, [2025])
    expect(await screen.findByText('Affectations proposées par vos règles (0)')).toBeTruthy()
    expect(screen.getByText(/1 mouvement à rapprocher plutôt qu'affecter/)).toBeTruthy()
    expect(screen.getByText(/Une note de frais du même montant, d’un exercice validé, est peut-être remboursée par ce mouvement : à classer en virement personnel, pas à affecter/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Affecter les / })).toBeNull()
  })

  it('une pièce figée qui n’est pas une note de frais ne retient pas le paiement du lot', async () => {
    preparer()
    faux.pieces = [{ ...NOTE, type_piece: 'achat' }]
    faux.categories = [FRAIS]
    faux.reglesAffectation = [regleDeTest({ motif: 'remboursement', sens: 'decaissement', categorie_id: 'cat-frais' })]
    rendre(TRESORERIE, false, [2025])
    expect(await screen.findByText('Affectations proposées par vos règles (1)')).toBeTruthy()
    expect(screen.queryByText(/Une note de frais du même montant, d’un exercice validé/)).toBeNull()
  })

  // « Déjà rapprochées » quand rien n'est figé : la phrase d'avant, sans parler de validation.
  it('sans pièce figée, la fiche dit « toutes déjà rapprochées », sans parler de validation', async () => {
    reinitialiser()
    faux.pieces = [NOTE]
    faux.lignes = [
      ligneDeTest({ id: 'l-paie', libelle: 'CB RESTAURANT DU PORT', date: '2025-12-30', montant: -1000, statut: 'rapprochee', piece_id: 'note-1' }),
      ligneDeTest({ id: 'l-autre', libelle: 'VIR DIVERS', date: '2026-01-02', montant: -50 }),
    ]
    rendre(TRESORERIE)
    await ouvrir('VIR DIVERS')
    expect(texte()).toMatch(/Toutes les pièces et échéances de ce dossier sont déjà rapprochées d’un autre mouvement — si aucune/)
    expect(texte()).not.toMatch(/figées par un exercice validé/)
  })

  // CAS DÉFENSIF, annoncé comme tel : en trésorerie, une pièce figée déjà portée par le règlement groupé d'un mouvement
  // non figé ne se produit pas (payée en partie dans l'exercice validé, elle en aurait empêché la validation). Si elle
  // se produisait, modifier le règlement devrait encore la montrer, au lieu de faire repartir sa part sans pièce.
  it('une pièce figée déjà portée par ce règlement y reste lisible — cas défensif', async () => {
    reinitialiser()
    faux.pieces = [
      NOTE, pieceDeTest({ id: 'piece-autre', tiers: 'Autre', nom_fichier: 'autre.pdf', date_piece: '2025-12-28', montant_ttc: 500 }),
      { ...NOTE, id: 'note-2', tiers: 'Taxi Bleu', nom_fichier: 'taxi.pdf' },
    ]
    faux.lignes = [ligneDeTest({ id: 'l-groupe', libelle: 'VIR GROUPE', date: '2026-01-02', montant: -1500, statut: 'rapprochee', reglement_groupe: true })]
    faux.reglements = [
      { id: 'g1', dossier_id: 'dossier-de-test', ligne_bancaire_id: 'l-groupe', piece_id: 'note-1', montant: -1000, created_at: '2026-01-02T10:00:00Z' },
      { id: 'g2', dossier_id: 'dossier-de-test', ligne_bancaire_id: 'l-groupe', piece_id: 'piece-autre', montant: -500, created_at: '2026-01-02T10:00:00Z' },
    ]
    faux.ecrituresValidees = [ECRITURE_DE_LA_NOTE, { ...ECRITURE_DE_LA_NOTE, id: 'ev-note-2', piece_id: 'note-2' }]
    rendre(TRESORERIE, false, [2025])
    await act(async () => { (await screen.findByRole('button', { name: 'Rapprochés' })).click() })
    await ouvrir('VIR GROUPE')
    await act(async () => { within(volet()).getByRole('button', { name: 'Modifier le règlement…' }).click() })
    const choix = within(volet()).getByLabelText('Pièce 1') as HTMLSelectElement
    expect(choix.value).toBe('note-1')
    // Une autre note figée, que ce règlement ne porte pas, ne s'y ajoute pas.
    expect([...choix.options].map((o) => o.value)).not.toContain('note-2')
  })

  // Le garde symétrique : sans note figée, la règle le propose.
  it('sans pièce du même montant, la règle propose le paiement', async () => {
    preparer()
    faux.pieces = []
    faux.categories = [FRAIS]
    faux.reglesAffectation = [regleDeTest({ motif: 'remboursement', sens: 'decaissement', categorie_id: 'cat-frais' })]
    rendre(TRESORERIE, false, [2025])
    expect(await screen.findByText('Affectations proposées par vos règles (1)')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Affecter ce mouvement' })).toBeTruthy()
  })
})

// UNE FACTURE QU'UN LETTRAGE FAIT À LA MAIN SOLDE AVEC SON AVOIR N'ATTEND AUCUN MOUVEMENT BANCAIRE (ligne 32, seconde
// brique). Comptée parmi les montants introuvables dans le relevé, elle portait une alerte « à vérifier » — et un point
// en erreur dans la Checklist, qui mène ici — qu'aucun paiement ne viendrait jamais éteindre. Seul un lettrage qui TIENT
// l'écarte, revérifié sur les lignes des comptes de tiers que l'onglet relit (lib/lettragesLecture.ts).
describe('BanqueTab — une pièce lettrée à la main n’attend pas de mouvement bancaire', () => {
  const FACTURE = pieceDeTest({ id: 'f-duval', tiers: 'Imprimerie Duval', nom_fichier: 'duval-facture.pdf', montant_ttc: 240 })
  const AVOIR = pieceDeTest({ id: 'a-duval', tiers: 'Imprimerie Duval', nom_fichier: 'duval-avoir.pdf', montant_ttc: -240 })

  function ligneDuBrouillon(id: string, pieceId: string, compte: string, sens: 'debit' | 'credit', montant: number): EcritureBrouillon {
    return {
      id, dossier_id: 'dossier-de-test', piece_id: pieceId, ligne_bancaire_id: null, immobilisation_id: null, vehicule_id: null,
      date: '2025-06-01', compte, libelle: 'Imprimerie Duval', sens, montant, statut: 'proposee', created_at: '2025-06-02T09:00:00Z',
      ...NON_VALIDEE,
    }
  }

  // Les écritures des deux factures en engagement : la charge et sa TVA, et le 401 qui porte le TTC.
  function brouillonDuval(montantAvoir = 240): EcritureBrouillon[] {
    return [
      ligneDuBrouillon('e1', 'f-duval', '606400', 'debit', 200),
      ligneDuBrouillon('e2', 'f-duval', '445660', 'debit', 40),
      ligneDuBrouillon('e3', 'f-duval', '401000', 'credit', 240),
      ligneDuBrouillon('e4', 'a-duval', '606400', 'credit', montantAvoir - 40),
      ligneDuBrouillon('e5', 'a-duval', '445660', 'credit', 40),
      ligneDuBrouillon('e6', 'a-duval', '401000', 'debit', montantAvoir),
    ]
  }

  const LETTRAGE: LettrageManuel[] = [
    { id: 'lm1', dossier_id: 'dossier-de-test', groupe: 'g1', piece_id: 'f-duval', compte: '401000', created_at: '2025-06-03T09:00:00Z' },
    { id: 'lm2', dossier_id: 'dossier-de-test', groupe: 'g1', piece_id: 'a-duval', compte: '401000', created_at: '2025-06-03T09:00:00Z' },
  ]

  function preparer() {
    reinitialiser()
    faux.lignes = [ligneDeTest({ id: 'l-autre', libelle: 'PRLV SEPA AUTRE CHOSE', montant: -999 })]
    faux.pieces = [FACTURE, AVOIR]
    faux.brouillon = brouillonDuval()
    faux.lettrages = LETTRAGE
  }

  const ecarts = () => screen.getByText(/pièce\(s\) validée\(s\) sans mouvement bancaire correspondant/).textContent ?? ''

  it('un lettrage qui tient retire la facture et son avoir des montants introuvables et des pièces sans mouvement', async () => {
    preparer()
    rendre(ENGAGEMENT)
    await screen.findByText('Écarts à vérifier')
    expect(screen.queryByText(/ne correspond(ent)? à aucun mouvement bancaire/)).toBeNull()
    expect(ecarts()).toMatch(/· 0 pièce\(s\) validée\(s\) sans mouvement bancaire correspondant/)
    expect(screen.queryByText(/Les lettrages faits à la main n.ont pas pu être lus/)).toBeNull()
  })

  // Le garde symétrique : sans lettrage, les deux montants sont introuvables, et l'écran le dit.
  it('sans lettrage, la facture et son avoir restent des montants introuvables', async () => {
    preparer()
    faux.lettrages = []
    rendre(ENGAGEMENT)
    expect(await screen.findByText('2 montants ne correspondent à aucun mouvement bancaire')).toBeTruthy()
    expect(ecarts()).toMatch(/· 2 pièce\(s\) validée\(s\) sans mouvement bancaire correspondant/)
  })

  // Un lettrage qui ne se solde plus — l'avoir ne vaut plus que 200 € — laisse la facture attendre son paiement : c'est
  // que le lettrage TIENNE qui compte, pas d'avoir été lettré.
  it('un lettrage qui ne se solde plus laisse les deux pièces parmi les montants introuvables', async () => {
    preparer()
    faux.pieces = [FACTURE, { ...AVOIR, montant_ttc: -200 }]
    faux.brouillon = brouillonDuval(200)
    rendre(ENGAGEMENT)
    expect(await screen.findByText('2 montants ne correspondent à aucun mouvement bancaire')).toBeTruthy()
    expect(ecarts()).toMatch(/· 2 pièce\(s\) validée\(s\) sans mouvement bancaire correspondant/)
  })

  // Le lettrage se revérifie sur les lignes des COMPTES DE TIERS : sans elles, il ne se vérifie pas, et ne retire rien.
  it('le lettrage se revérifie sur les lignes du 401 : sans elles, il ne retire rien', async () => {
    preparer()
    faux.brouillon = brouillonDuval().filter((e) => e.compte !== '401000')
    rendre(ENGAGEMENT)
    expect(await screen.findByText('2 montants ne correspondent à aucun mouvement bancaire')).toBeTruthy()
  })

  // Le lettrage se revérifie sur TOUTES les pièces que l'onglet lit, comme la carte des comptes de tiers : un avoir
  // repassé « à valider » garde son écriture, et le lettrage tient encore. Revérifié sur les seules validées, il ne
  // tiendrait plus — « une de ses pièces n'a pas pu être lue » —, et la facture redeviendrait un montant introuvable.
  it('un avoir repassé « à valider » ne défait pas le lettrage qui le compte', async () => {
    preparer()
    faux.pieces = [FACTURE, { ...AVOIR, statut: 'a_valider' }]
    rendre(ENGAGEMENT)
    await screen.findByText('Écarts à vérifier')
    expect(screen.queryByText(/ne correspond(ent)? à aucun mouvement bancaire/)).toBeNull()
    expect(ecarts()).toMatch(/· 0 pièce\(s\) validée\(s\) sans mouvement bancaire correspondant/)
  })

  it('des lettrages lus en partie le disent, en engagement', async () => {
    preparer()
    faux.muet = { lettrages_manuels: 1 }
    rendre(ENGAGEMENT)
    expect(await screen.findByText(/Les lettrages faits à la main n.ont pas pu être lus en entier/)).toBeTruthy()
    expect(screen.getByText(/Une facture qu’un lettrage solde avec son avoir peut donc paraître sans mouvement bancaire/)).toBeTruthy()
  })

  it('les lignes des comptes de tiers lues en partie le disent aussi', async () => {
    preparer()
    faux.muet = { ecritures_brouillon: 0 }
    rendre(ENGAGEMENT)
    expect(await screen.findByText(/Les lettrages faits à la main n.ont pas pu être lus en entier/)).toBeTruthy()
    expect(await screen.findByText('2 montants ne correspondent à aucun mouvement bancaire')).toBeTruthy()
  })

  // En trésorerie, rien ne se lettre : un lettrage y est impossible (la base le refuse, et le modèle ne change plus une
  // fois le brouillon écrit). CAS DÉFENSIF, annoncé comme tel : s'il s'en trouvait un, il ne retirerait rien, et une
  // lecture partielle des lettrages ne s'y dirait pas.
  it('en trésorerie, un lettrage ne retire rien et sa lecture partielle ne se dit pas — cas défensif', async () => {
    preparer()
    faux.muet = { lettrages_manuels: 1 }
    rendre(TRESORERIE)
    await screen.findByText('Écarts à vérifier')
    expect(screen.queryByText(/Les lettrages faits à la main/)).toBeNull()
    faux.muet = {}
    cleanup()
    rendre(TRESORERIE)
    expect(await screen.findByText('2 montants ne correspondent à aucun mouvement bancaire')).toBeTruthy()
  })
})
