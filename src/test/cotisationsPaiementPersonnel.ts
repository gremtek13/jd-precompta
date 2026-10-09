import { filtrer, predicatEq, predicatIs, predicatNot, type Predicat } from './filtresPostgrest'
import { A_NOUVEAU_NON_VALIDE, NON_VALIDEE } from './ecritures'
import type { ANouveau, CotisationDeclaree, EcritureBrouillon, LigneBancaire } from '../lib/types'

// LE FAUX CLIENT DE L'ONGLET COTISATIONS POUR LE PAIEMENT DEPUIS LE COMPTE PERSONNEL (ligne 26.6, phase C), partagé par
// les deux fichiers qui le montent : CotisationsTabPaiementPersonnel.test.tsx (le module tel qu'il est) et
// CotisationsTabRetraitPaiement.test.tsx (le drapeau du retrait levé — un module simulé l'est pour tout un fichier).
// Chaque fichier le charge DANS la fabrique de son `vi.mock` et l'importe aussi : un seul état par fichier.
//
// Les filtres qui décident de ce que l'écran voit sont APPLIQUÉS (filtresPostgrest.ts), l'ordre aussi — l'ouverture est
// la PREMIÈRE date des à-nouveaux lus —, et le compte annoncé est le vrai : `muetApres` rend une lecture partielle.
export const faux = {
  cotisations: [] as CotisationDeclaree[],
  lignes: [] as LigneBancaire[],
  ecritures: [] as EcritureBrouillon[],
  aNouveaux: [] as ANouveau[],
  muetApres: {} as Record<string, number>,
  insertions: [] as { table: string; valeur: unknown }[],
  misesAJour: [] as { table: string; valeur: unknown }[],
  // Le refus d'une mise à jour directe d'une échéance : un échec au MILIEU de l'échéancier, après son insertion.
  erreurMiseAJour: null as string | null,
  rpcs: [] as { nom: string; args: Record<string, unknown> }[],
  erreurRpc: null as string | null,
  // Retient la RÉPONSE des lectures qui suivent un `rpc` : le verrou doit tenir pendant la relecture.
  retenirLectures: false,
  relacher: null as (() => void) | null,
  retenue: null as Promise<void> | null,
  // Retient l'appel à la base lui-même.
  retenirRpc: false,
  relacherRpc: null as (() => void) | null,
  // Ce que « lit » la fausse extraction d'un avis d'appel.
  echeancesLues: [] as { date: string; montant: number; previsionnel: boolean }[],
}

export function reinitialiser() {
  faux.cotisations = []
  faux.lignes = []
  faux.ecritures = []
  faux.aNouveaux = []
  faux.muetApres = {}
  faux.insertions = []
  faux.misesAJour = []
  faux.erreurMiseAJour = null
  faux.rpcs = []
  faux.erreurRpc = null
  faux.retenirLectures = false
  faux.relacher = null
  faux.retenue = null
  faux.retenirRpc = false
  faux.relacherRpc = null
  faux.echeancesLues = []
}

type ReponseRpc = { data: number | null; error: { message: string } | null }

// Ce que font les fonctions de la base : la déclaration pose la date et écrit l'écriture composée par l'écran ; le retrait
// les défait ensemble ; la suppression de l'échéance emporte les deux (clé en cascade).
function executerRpc(nom: string, args: Record<string, unknown>): Promise<ReponseRpc> {
  faux.rpcs.push({ nom, args })
  if (faux.erreurRpc) return Promise.resolve({ data: null, error: { message: faux.erreurRpc } })
  const id = args.p_cotisation_id as string
  if (nom === 'enregistrer_paiement_personnel_cotisation') {
    const date = args.p_date_paiement as string
    faux.cotisations = faux.cotisations.map((c) => (c.id === id ? { ...c, paiement_personnel_le: date } : c))
    faux.ecritures.push(...(args.p_ecritures as Record<string, unknown>[]).map((e, i): EcritureBrouillon => ({
      id: `perso-${faux.rpcs.length}-${i}`, dossier_id: 'dossier-de-test', piece_id: null, ligne_bancaire_id: null,
      date, compte: e.compte as string, libelle: e.libelle as string, montant: e.montant as number,
      sens: e.sens as 'debit' | 'credit', statut: 'proposee', immobilisation_id: null, vehicule_id: null,
      declaration_tva_id: null, cotisation_id: id, ...NON_VALIDEE, created_at: '2026-10-09T10:00:00Z',
    })))
  } else if (nom === 'retirer_paiement_personnel_cotisation') {
    faux.cotisations = faux.cotisations.map((c) => (c.id === id ? { ...c, paiement_personnel_le: null } : c))
    faux.ecritures = faux.ecritures.filter((e) => e.cotisation_id !== id)
  } else if (nom === 'supprimer_echeance_cotisation') {
    faux.ecritures = faux.ecritures.filter((e) => e.cotisation_id !== id)
    faux.cotisations = faux.cotisations.filter((c) => c.id !== id)
  }
  if (faux.retenirLectures) faux.retenue = new Promise<void>((r) => { faux.relacher = r })
  return Promise.resolve({ data: 1, error: null })
}

export function supabaseFaux() {
  return {
    rpc: (nom: string, args: Record<string, unknown>) => {
      if (faux.retenirRpc) {
        faux.retenirRpc = false
        return new Promise<void>((r) => { faux.relacherRpc = r }).then(() => executerRpc(nom, args))
      }
      return executerRpc(nom, args)
    },
    from: (table: string) => {
      const c: Record<string, unknown> = {}
      let operation = 'select'
      let debut = 0
      let fin = Number.MAX_SAFE_INTEGER
      // Le cadrage par dossier n'est pas appliqué : le jeu d'essai ne porte qu'un dossier.
      const predicats: Predicat[] = []
      const tris: { colonne: string; croissant: boolean }[] = []
      Object.assign(c, {
        select: () => c,
        // Une échéance insérée entre en base : la relecture la rend.
        insert: (valeur: unknown) => {
          operation = 'insert'
          faux.insertions.push({ table, valeur })
          if (table === 'cotisations_declarees') {
            const lignes = (Array.isArray(valeur) ? valeur : [valeur]) as Partial<CotisationDeclaree>[]
            faux.cotisations = [...faux.cotisations, ...lignes.map((l, i) => cotisation({ ...l, id: `ins-${faux.insertions.length}-${i}` }))]
          }
          return c
        },
        update: (valeur: unknown) => { operation = 'update'; faux.misesAJour.push({ table, valeur }); return c },
        eq: (colonne: string, valeur: unknown) => {
          if (colonne !== 'dossier_id') predicats.push(predicatEq(colonne, valeur))
          return c
        },
        is: (colonne: string, valeur: null) => { predicats.push(predicatIs(colonne, valeur)); return c },
        not: (colonne: string, operateur: string, valeur: unknown) => { predicats.push(predicatNot(colonne, operateur, valeur)); return c },
        order: (colonne: string, options?: { ascending?: boolean }) => { tris.push({ colonne, croissant: options?.ascending !== false }); return c },
        range: (d: number, f: number) => { debut = d; fin = f; return c },
        then: (suite: (r: { data: unknown[]; error: { message: string } | null; count: number }) => unknown) => {
          if (operation === 'update' && table === 'cotisations_declarees' && faux.erreurMiseAJour) {
            return Promise.resolve({ data: [], error: { message: faux.erreurMiseAJour }, count: 0 }).then(suite)
          }
          if (operation !== 'select') return Promise.resolve({ data: [], error: null, count: 0 }).then(suite)
          const source: readonly object[] =
            table === 'cotisations_declarees' ? faux.cotisations
              : table === 'lignes_bancaires' ? faux.lignes
                : table === 'ecritures_brouillon' ? faux.ecritures
                  : table === 'a_nouveaux' ? faux.aNouveaux
                    : []
          const valeur = (ligne: object, colonne: string) => String((ligne as Record<string, unknown>)[colonne] ?? '')
          const toutes = [...filtrer(source, predicats)].sort((a, b) => {
            for (const { colonne, croissant } of tris) {
              const x = valeur(a, colonne)
              const y = valeur(b, colonne)
              if (x !== y) return (x < y ? -1 : 1) * (croissant ? 1 : -1)
            }
            return 0
          })
          const rendu = toutes.slice(debut, Math.min(fin + 1, toutes.length, faux.muetApres[table] ?? Infinity))
          return (faux.retenue ?? Promise.resolve())
            .then(() => ({ data: rendu, error: null, count: toutes.length }))
            .then(suite)
        },
      })
      return c
    },
    storage: { from: () => ({ upload: () => Promise.resolve({ error: null }) }) },
  }
}

// Doublée pour ne rien facturer : ces tests portent sur l'écran, jamais sur l'OCR.
export function extractionFausse() {
  return {
    extractPiece: () => Promise.resolve({ lecture_cotisation: { echeances: faux.echeancesLues } }),
    fichierDejaPresent: () => Promise.resolve(false),
    hashFichier: () => Promise.resolve('empreinte-de-test'),
  }
}

// Les jeux d'essai, typés sans `as` : le compilateur les confronte aux tables.
export function cotisation(o: Partial<CotisationDeclaree> = {}): CotisationDeclaree {
  return {
    id: 'cot-1', dossier_id: 'dossier-de-test', echeance: '2026-03-05',
    montant_appele: 1000, montant_verse: null, montant_csg_crds: 300,
    previsionnel: false, created_at: '2026-01-05T09:00:00Z', paiement_personnel_le: null, ...o,
  }
}

export const ligne = (o: Partial<LigneBancaire> = {}): LigneBancaire => ({
  id: 'l-1', dossier_id: 'dossier-de-test', date: '2026-03-06', montant: -1000,
  libelle: 'PRLV', libelle_brut: null, statut: 'rapprochee',
  piece_id: null, cotisation_id: 'cot-1', categorie_id: null, taux_tva: null, prelevement_personnel: false, source_fichier: null,
  emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false,
  compte_bilan: null, declaration_tva_id: null, id_externe: null, created_at: '2026-03-06T09:00:00Z', ...o,
})

export const ecriture = (o: Partial<EcritureBrouillon> = {}): EcritureBrouillon => ({
  id: 'e-1', dossier_id: 'dossier-de-test', piece_id: null, ligne_bancaire_id: null, date: '2026-03-10',
  compte: '646000', libelle: 'Cotisation', montant: 700, sens: 'debit', statut: 'proposee',
  immobilisation_id: null, vehicule_id: null, declaration_tva_id: null, cotisation_id: 'cot-1', ...NON_VALIDEE,
  created_at: '2026-03-10T10:00:00Z', ...o,
})

// L'écriture juste de l'échéance `cot-1` (1 000 €, dont 300 € de CSG-CRDS) payée le 10/03/2026, en trésorerie.
export const ecritureJuste = (date = '2026-03-10') => [
  ecriture({ id: 'e-a', compte: '646000', sens: 'debit', date }),
  ecriture({ id: 'e-b', compte: '108000', sens: 'credit', date }),
]

export const aNouveau = (o: Partial<ANouveau> = {}): ANouveau => ({
  id: 'an-1', dossier_id: 'dossier-de-test', date: '2026-01-01', compte: '512000', compte_origine: '512100',
  libelle: 'Banque', sens: 'debit', montant: 100, source_nom: 'balance.csv', source_empreinte: 'empreinte',
  created_at: '2026-01-02T09:00:00Z', ...A_NOUVEAU_NON_VALIDE, ...o,
})
