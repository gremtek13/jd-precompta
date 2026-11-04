import { filtrer, predicatEq, predicatIs, predicatNot, type Predicat } from './filtresPostgrest'
import { NON_VALIDEE } from './ecritures'
import type { CotisationDeclaree, DocumentDivers, EcritureBrouillon, LigneBancaire } from '../lib/types'

// LE FAUX CLIENT DE L'ONGLET COTISATIONS POUR « MODIFIER » ET « RÉUNIR » (COT-Q1, COT-Q3), chargé DANS la fabrique du
// `vi.mock` de CotisationsTab.gestes.test.tsx. À part de celui du paiement personnel : celui-ci APPLIQUE la mise à jour
// d'une échéance, sous les filtres de version qu'elle porte (filtresPostgrest.ts, qui lève sur une forme inconnue), et rend
// par `.select('id').maybeSingle()` la ligne écrite — ou rien, quand la version a changé. Les deux fonctions de la base que
// les gestes appellent font ce qu'elles font en base : `supprimer_echeance_cotisation` retire l'échéance (et remet à traiter
// le mouvement qui la paie), `rapprocher_cotisation` remplace l'écriture du mouvement par celle qu'on lui passe.
export const faux = {
  cotisations: [] as CotisationDeclaree[],
  lignes: [] as LigneBancaire[],
  ecritures: [] as EcritureBrouillon[],
  documents: [] as DocumentDivers[],
  muetApres: {} as Record<string, number>,
  misesAJour: [] as { valeur: Record<string, unknown>; filtres: string[] }[],
  erreurMiseAJour: null as string | null,
  rpcs: [] as { nom: string; args: Record<string, unknown> }[],
  erreursRpc: {} as Record<string, string>,
}

export function reinitialiser() {
  faux.cotisations = []
  faux.lignes = []
  faux.ecritures = []
  faux.documents = []
  faux.muetApres = {}
  faux.misesAJour = []
  faux.erreurMiseAJour = null
  faux.rpcs = []
  faux.erreursRpc = {}
}

function executerRpc(nom: string, args: Record<string, unknown>) {
  faux.rpcs.push({ nom, args })
  const erreur = faux.erreursRpc[nom]
  if (erreur) return Promise.resolve({ data: null, error: { message: erreur } })
  const id = args.p_cotisation_id as string
  if (nom === 'supprimer_echeance_cotisation') {
    const paiement = faux.lignes.find((l) => l.cotisation_id === id)
    if (paiement) {
      faux.ecritures = faux.ecritures.filter((e) => !(e.piece_id == null && e.ligne_bancaire_id === paiement.id))
      faux.lignes = faux.lignes.map((l) => (l.id === paiement.id ? { ...l, statut: 'non_rapprochee', cotisation_id: null } : l))
    }
    faux.documents = faux.documents.map((d) => (d.attached_to_cotisation_id === id ? { ...d, attached_to_cotisation_id: null } : d))
    faux.cotisations = faux.cotisations.filter((c) => c.id !== id)
  } else if (nom === 'rapprocher_cotisation') {
    const ligneId = args.p_ligne_bancaire_id as string
    const date = faux.lignes.find((l) => l.id === ligneId)?.date ?? '2026-01-01'
    faux.ecritures = faux.ecritures.filter((e) => !(e.piece_id == null && e.ligne_bancaire_id === ligneId))
    faux.ecritures.push(...(args.p_ecritures as Record<string, unknown>[]).map((e, i) => ecriture({
      id: `rpc-${faux.rpcs.length}-${i}`, ligne_bancaire_id: ligneId, date, compte: e.compte as string, libelle: e.libelle as string,
      montant: e.montant as number, sens: e.sens as 'debit' | 'credit',
    })))
  }
  return Promise.resolve({ data: 1, error: null })
}

export function supabaseFaux() {
  return {
    rpc: (nom: string, args: Record<string, unknown>) => executerRpc(nom, args),
    from: (table: string) => {
      const c: Record<string, unknown> = {}
      let operation: 'select' | 'update' = 'select'
      let valeurMaj: Record<string, unknown> = {}
      let unSeul = false
      let debut = 0
      let fin = Number.MAX_SAFE_INTEGER
      const predicats: Predicat[] = []
      const filtres: string[] = []
      const tris: { colonne: string; croissant: boolean }[] = []
      Object.assign(c, {
        select: () => c,
        update: (valeur: Record<string, unknown>) => { operation = 'update'; valeurMaj = valeur; return c },
        // Le cadrage par dossier n'est pas appliqué : le jeu d'essai ne porte qu'un dossier.
        eq: (colonne: string, valeur: unknown) => {
          if (colonne !== 'dossier_id') { predicats.push(predicatEq(colonne, valeur)); filtres.push(`${colonne}=eq.${String(valeur)}`) }
          return c
        },
        is: (colonne: string, valeur: null) => { predicats.push(predicatIs(colonne, valeur)); filtres.push(`${colonne}=is.null`); return c },
        not: (colonne: string, operateur: string, valeur: unknown) => { predicats.push(predicatNot(colonne, operateur, valeur)); return c },
        order: (colonne: string, options?: { ascending?: boolean }) => { tris.push({ colonne, croissant: options?.ascending !== false }); return c },
        range: (d: number, f: number) => { debut = d; fin = f; return c },
        maybeSingle: () => { unSeul = true; return c },
        then: (suite: (r: unknown) => unknown) => {
          if (operation === 'update') {
            faux.misesAJour.push({ valeur: valeurMaj, filtres })
            if (faux.erreurMiseAJour) return Promise.resolve({ data: null, error: { message: faux.erreurMiseAJour } }).then(suite)
            const visees = filtrer(faux.cotisations, predicats)
            faux.cotisations = faux.cotisations.map((x) => (visees.includes(x) ? { ...x, ...valeurMaj } : x))
            const rendues = visees.map((x) => ({ id: x.id }))
            return Promise.resolve({ data: unSeul ? rendues[0] ?? null : rendues, error: null }).then(suite)
          }
          const source: readonly object[] =
            table === 'cotisations_declarees' ? faux.cotisations
              : table === 'lignes_bancaires' ? faux.lignes
                : table === 'ecritures_brouillon' ? faux.ecritures
                  : table === 'documents_divers' ? faux.documents
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
          return Promise.resolve({ data: rendu, error: null, count: toutes.length }).then(suite)
        },
      })
      return c
    },
    storage: { from: () => ({ upload: () => Promise.resolve({ error: null }) }) },
  }
}

export function extractionFausse() {
  return {
    extractPiece: () => Promise.resolve({ lecture_cotisation: { echeances: [] } }),
    fichierDejaPresent: () => Promise.resolve(false),
    hashFichier: () => Promise.resolve('empreinte-de-test'),
  }
}

export function cotisation(o: Partial<CotisationDeclaree> = {}): CotisationDeclaree {
  return {
    id: 'cot-1', dossier_id: 'dossier-de-test', echeance: '2026-03-20', montant_appele: 800, montant_verse: null,
    montant_csg_crds: 300, previsionnel: false, created_at: '2026-01-05T09:00:00Z', paiement_personnel_le: null, ...o,
  }
}

export const ligne = (o: Partial<LigneBancaire> = {}): LigneBancaire => ({
  id: 'l-1', dossier_id: 'dossier-de-test', date: '2026-03-21', montant: -2000, libelle: 'PRLV URSSAF', libelle_brut: null,
  statut: 'rapprochee', piece_id: null, cotisation_id: 'cot-1', categorie_id: null, taux_tva: null, prelevement_personnel: false,
  source_fichier: null, emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false,
  reglement_groupe: false, compte_bilan: null, declaration_tva_id: null, id_externe: null, created_at: '2026-03-21T09:00:00Z',
  encaissements_de_factures: false, ...o,
})

export const ecriture = (o: Partial<EcritureBrouillon> = {}): EcritureBrouillon => ({
  id: 'e-1', dossier_id: 'dossier-de-test', piece_id: null, ligne_bancaire_id: 'l-1', date: '2026-03-21', compte: '512000',
  libelle: 'PRLV URSSAF', montant: 2000, sens: 'credit', statut: 'proposee', immobilisation_id: null, vehicule_id: null,
  declaration_tva_id: null, cotisation_id: null, encaissement_id: null, facture_id: null, created_at: '2026-03-21T09:00:00Z',
  ...NON_VALIDEE, ...o,
})

export const avis = (o: Partial<DocumentDivers> = {}): DocumentDivers => ({
  id: 'doc-1', dossier_id: 'dossier-de-test', storage_path: 'dossier-de-test/regul.pdf', storage_hash: null, nom_fichier: 'regul.pdf',
  categorie: 'cotisation', sous_dossier_id: null, attached_to_cotisation_id: null, notes: null, created_at: '2026-01-05T09:00:00Z', ...o,
})
