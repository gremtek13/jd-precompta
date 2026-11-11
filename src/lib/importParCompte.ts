import type { CompteBancaire } from './comptesBancaires'

// L'IMPORT D'UN RELEVÉ PAR COMPTE BANCAIRE (ligne 26.6, lot MCB2 ; MCB-Q1 à Q8, tranchées le 11/11/2026). Le récit :
// HISTORIQUE.md, « 11/11/2026 — L'IMPORT D'UN RELEVÉ PAR COMPTE BANCAIRE (MCB2) ». Ce module pur décide, avant le clic :
//   - sous quel compte le relevé entre : un dossier qui en tient deux ou plus n'en prend aucun par défaut ; un seul, il est
//     pris sans rien demander ; aucun (un dossier neuf), la base crée le principal au premier mouvement (MCB1) ;
//   - contre quels mouvements et quels contrôles le fichier se juge : ceux du compte choisi seul — le dédoublonnage par
//     multiplicité, le recouvrement d'une période et la suite des soldes (`lib/importReleve.ts`, `lib/suiteDesReleves.ts`)
//     ne changent pas, ils reçoivent la part du compte. Deux frais de 2,50 € le même jour sur deux comptes ne sont plus
//     des doublons, un mois d'un compte ne recouvre plus le même mois de l'autre ;
//   - le nom du fichier : unique dans le dossier (MCB-Q6, la contrainte `controles_releves_bancaires_fichier_unique`), il
//     se refuse avant le clic quand il est déjà celui d'un relevé d'un AUTRE compte — la base ne le refuserait que si ce
//     relevé avait son contrôle, et la suite des soldes, qui retrouve un fichier par son nom, mêlerait les deux comptes ;
//   - un OFX dont l'identifiant de compte (ses quatre derniers caractères, `releveOfxQif.ts`) contredit le compte choisi :
//     refusé, que le compte choisi en retienne d'autres, ou qu'un autre compte du dossier retienne les siens.
// Drapeau baissé (`COMPTES_BANCAIRES_PREVUS`), l'écran passe `{ etat: 'sans_objet' }` et rien ne change : tout le relevé
// du dossier est un seul compte, comme avant MCB.

/** Ce que l'import lit d'un compte bancaire. */
export type CompteDuReleve = Pick<CompteBancaire, 'id' | 'libelle' | 'principal' | 'fin_d_identifiant'>

/** La lecture des comptes du dossier, telle que l'écran la tient. `sans_objet` : le drapeau est baissé, la table n'existe
 *  pas encore. */
export type LectureDesComptes =
  | { etat: 'sans_objet' }
  | { etat: 'en_cours' }
  | { etat: 'illisible'; motif: string }
  | { etat: 'lus'; comptes: readonly CompteDuReleve[] }

/** Le compte sous lequel le relevé entre. `tout_le_dossier` : le drapeau baissé, comme avant MCB ; `premier` : le dossier ne
 *  tient encore aucun compte, la base crée le principal au premier mouvement ; `compte` : le seul compte, ou celui choisi ;
 *  `a_choisir` : deux ou plus, aucun choisi ; `retenu` : les comptes ne sont pas lus en entier, l'import attend. */
export type CompteDeLImport =
  | { cas: 'tout_le_dossier' }
  | { cas: 'premier' }
  | { cas: 'compte'; compte: CompteDuReleve; seul: boolean }
  | { cas: 'a_choisir'; comptes: readonly CompteDuReleve[] }
  | { cas: 'retenu'; raison: string }

export function compteDeLImport(lecture: LectureDesComptes, choisi: string | null): CompteDeLImport {
  if (lecture.etat === 'sans_objet') return { cas: 'tout_le_dossier' }
  if (lecture.etat === 'en_cours') {
    return { cas: 'retenu', raison: 'Les comptes bancaires du dossier sont en cours de lecture : l’import attend de savoir sous quel compte le relevé entre.' }
  }
  if (lecture.etat === 'illisible') {
    return { cas: 'retenu', raison: `Les comptes bancaires du dossier n’ont pas été lus en entier (${lecture.motif}) : l’import ne sait pas `
      + 'sous quel compte le relevé entre, ni contre quels mouvements le dédoublonner. Recharge la page.' }
  }
  const { comptes } = lecture
  if (comptes.length === 0) return { cas: 'premier' }
  if (comptes.length === 1) return { cas: 'compte', compte: comptes[0], seul: true }
  const trouve = choisi === null ? undefined : comptes.find((c) => c.id === choisi)
  return trouve ? { cas: 'compte', compte: trouve, seul: false } : { cas: 'a_choisir', comptes }
}

/** Le refus de l'import tant que le compte n'est pas connu, dit avant le clic ; nul quand le relevé sait où il entre. */
export function refusDuCompte(c: CompteDeLImport): string | null {
  if (c.cas === 'retenu') return c.raison
  if (c.cas === 'a_choisir') {
    return `Ce dossier tient ${c.comptes.length} comptes bancaires : choisis celui dont ce relevé est l’extrait avant d’importer — `
      + 'aucun n’est pris par défaut, et un mouvement importé sous le mauvais compte ne se retire pas.'
  }
  return null
}

/** L'identifiant du compte à écrire sur chaque mouvement et sur le contrôle du fichier : celui du compte choisi, ou rien —
 *  drapeau baissé, la colonne n'existe pas ; aucun compte encore, la base pose le principal qu'elle crée. */
export function compteAEcrire(c: CompteDeLImport): string | null {
  return c.cas === 'compte' ? c.compte.id : null
}

/** La part du relevé (mouvements ou contrôles) contre laquelle le fichier se juge : tout le dossier quand il n'y a qu'un
 *  compte à l'ancienne ou aucun encore, celle du compte choisi sinon, rien tant que le compte n'est pas connu (l'import est
 *  alors refusé, et l'aperçu ne dédoublonne contre rien). */
export function partDuCompte<T extends { compte_bancaire_id?: string | null }>(lignes: readonly T[], c: CompteDeLImport): T[] {
  if (c.cas === 'tout_le_dossier' || c.cas === 'premier') return [...lignes]
  if (c.cas === 'compte') return lignes.filter((l) => l.compte_bancaire_id === c.compte.id)
  return []
}

/** Le refus d'un fichier qui porte le nom d'un relevé d'un AUTRE compte du dossier (MCB-Q6 : un nom est unique dans le
 *  dossier), dit avant le clic ; nul sinon. Le même nom sous le MÊME compte reste un relevé redéposé, que le dédoublonnage
 *  reconnaît. */
export function refusDuNomDuFichier(
  nom: string | null,
  c: CompteDeLImport,
  lignes: readonly { source_fichier: string | null; compte_bancaire_id?: string | null }[],
  controles: readonly { source_fichier: string | null; compte_bancaire_id?: string | null }[],
  lecture: LectureDesComptes,
): string | null {
  if (nom === null || c.cas !== 'compte') return null
  const autre = [...lignes, ...controles].find((l) => l.source_fichier === nom && l.compte_bancaire_id != null
    && l.compte_bancaire_id !== c.compte.id)
  if (!autre) return null
  const libelle = lecture.etat === 'lus' ? lecture.comptes.find((k) => k.id === autre.compte_bancaire_id)?.libelle : undefined
  return `Le relevé « ${nom} » est déjà importé sous ${libelle === undefined ? 'un autre compte bancaire du dossier' : `le compte « ${libelle} »`} : `
    + `le nom d’un fichier de relevé est unique dans le dossier. S’il est bien l’extrait de « ${c.compte.libelle} », renomme le `
    + 'fichier avant de l’importer ; sinon, choisis le compte dont il est l’extrait.'
}

/** Le refus d'un OFX dont l'identifiant de compte (ses quatre derniers caractères) contredit le compte choisi : un autre
 *  compte du dossier retient ces caractères, ou le compte choisi en retient d'autres. Nul pour un CSV, un QIF, un OFX qui
 *  ne dit pas son compte, et un dossier sans compte encore. */
export function refusDeLIdentifiant(fin: string | null, c: CompteDeLImport, lecture: LectureDesComptes): string | null {
  if (fin === null || c.cas !== 'compte') return null
  const comptes = lecture.etat === 'lus' ? lecture.comptes : [c.compte]
  const autre = comptes.find((k) => k.id !== c.compte.id && k.fin_d_identifiant === fin)
  if (autre) {
    return `Ce relevé OFX est celui du compte « ${autre.libelle} » : l’identifiant de compte qu’il porte finit comme celui des `
      + `relevés OFX déjà importés sous lui. Choisis ce compte, plutôt que « ${c.compte.libelle} ».`
  }
  if (c.compte.fin_d_identifiant !== null && c.compte.fin_d_identifiant !== fin) {
    return `Ce relevé OFX n’est pas celui du compte « ${c.compte.libelle} » : l’identifiant de compte qu’il porte ne finit pas `
      + 'comme celui des relevés OFX déjà importés sous lui. '
      + (c.seul ? 'S’il est l’extrait d’un autre compte du dossier, ce compte se crée d’abord, puis le relevé s’importe sous lui.'
        : 'Choisis le compte dont il est l’extrait.')
  }
  return null
}

/** Les quatre caractères à retenir sur le compte après l'import d'un OFX : ceux du fichier, quand le compte n'en retient
 *  encore aucun ; nul sinon (rien à écrire). */
export function finAPoser(fin: string | null, c: CompteDeLImport): string | null {
  return fin !== null && c.cas === 'compte' && c.compte.fin_d_identifiant === null ? fin : null
}
