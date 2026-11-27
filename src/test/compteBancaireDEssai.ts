import type { CompteBancaire } from '../lib/comptesBancaires'

// LE COMPTE BANCAIRE D'ESSAI : le compte que portent les mouvements et les contrôles des fabriques (`compte_bancaire_id`,
// obligatoire comme en base depuis MCB1), et la ligne de `comptes_bancaires` qui le fait exister dans son dossier. Les deux
// vont ensemble : un mouvement dont le compte n'est pas dans la lecture des comptes du dossier se refuse
// (`REFUS_COMPTE_INCONNU`, lib/banqueDuMouvement.ts), et un faux client qui rendrait des mouvements au compte d'essai devant
// une table `comptes_bancaires` vide jouerait un dossier que la base ne peut pas porter. Le compte est le principal, sans 512
// propre : ses mouvements s'écrivent au 512 du rôle `banque`, l'écriture d'hier.
export const COMPTE_BANCAIRE_D_ESSAI = 'cb-essai'

/** La ligne de `comptes_bancaires` du compte d'essai, dans le dossier `dossierId`. */
export function compteBancaireDEssai(dossierId: string, o: Partial<CompteBancaire> = {}): CompteBancaire {
  return {
    id: COMPTE_BANCAIRE_D_ESSAI, dossier_id: dossierId, libelle: 'Compte professionnel (fictif)', principal: true, compte: null,
    compte_propre_depuis: null, ouvert_le: null, clos_le: null, fin_d_identifiant: null, created_by: null,
    created_at: '2025-01-01T08:00:00Z', ...o,
  }
}
