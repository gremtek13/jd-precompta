import { INVENTAIRE_DES_CONTROLES_SANS_OBJET } from '../lib/inventaireDesControles'
import { bilanDeLExercice, type BilanEtabli, type EntreesDuBilan } from '../lib/bilan'
import type { ModeleComptable } from '../lib/engagement'
import { PLAN_PAR_DEFAUT } from '../lib/planComptable'
import type { ANouveau, EcritureBrouillon } from '../lib/types'
import { A_NOUVEAU_NON_VALIDE, NON_VALIDEE } from './ecritures'
import { LIBELLES_PAR_DEFAUT, PREFIXES_PAR_DEFAUT } from './modeles'

// Les fabriques des tests de la liasse 2033 (lib/compteDeResultat2033.test.ts, lib/liasse2033.test.ts) : une société en
// engagement, des écritures posées ligne à ligne, et son bilan établi — la source des soldes de la liasse.

export const SOCIETE: ModeleComptable = {
  mode: 'engagement', compteNotesDeFrais: '455000', plan: PLAN_PAR_DEFAUT, libelles: LIBELLES_PAR_DEFAUT, prefixes: PREFIXES_PAR_DEFAUT,
}

export type Ligne = [compte: string, sens: 'D' | 'C', euros: number]

let numero = 0

export function ecrire(date: string, lignes: Ligne[]): EcritureBrouillon[] {
  return lignes.map(([compte, sens, montant]) => {
    numero += 1
    return {
      id: `e${String(numero).padStart(5, '0')}`, dossier_id: 'd1', piece_id: null, ligne_bancaire_id: null,
      date, compte, libelle: 'Écriture d’essai', montant, sens: sens === 'D' ? 'debit' : 'credit', statut: 'proposee',
      created_at: `${date}T10:00:00Z`, immobilisation_id: null, vehicule_id: null, declaration_tva_id: null, cotisation_id: null,
      ...NON_VALIDEE, encaissement_id: null, facture_id: null,
    }
  })
}

export function reprise(date: string, lignes: Ligne[]): ANouveau[] {
  return lignes.map(([compte, sens, montant]) => {
    numero += 1
    return {
      id: `a${numero}`, dossier_id: 'd1', date, compte, compte_origine: compte, libelle: compte,
      sens: sens === 'D' ? 'debit' : 'credit', montant, source_nom: 'balance-fictive.csv', source_empreinte: 'empreinte-fictive',
      created_at: '2026-02-01T10:00:00Z', ...A_NOUVEAU_NON_VALIDE,
    }
  })
}

/** Le bilan établi de l'exercice 2026, clos (aujourd'hui le 15/03/2027) ; lève s'il ne s'établit pas. */
export function bilanEtabli(o: Partial<EntreesDuBilan>): BilanEtabli {
  const b = bilanDeLExercice({
    exercice: 2026, ecritures: [], categories: [], reprise: [], reportes: [], anneesValidees: [], pieces: [],
    modele: SOCIETE, aujourdHui: '2027-03-15', inventaire: INVENTAIRE_DES_CONTROLES_SANS_OBJET, ...o,
  })
  if (b.etat !== 'etabli') throw new Error(`bilan non établi : ${b.motif.texte}`)
  return b
}
