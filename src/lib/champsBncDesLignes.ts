import type { ChampsBnc, ModeRglt, NatureOperation } from './champsBncDuFec'

// LES QUATRE CHAMPS D'UNE LIGNE, DE LA DEMANDE DE VALIDATION À LA RELECTURE D'UN EXERCICE VALIDÉ (ligne 26.6, étape e ; lots
// FEC22b et FEC22c2). Un module qui n'importe que des TYPES : la demande (lib/validationExercice.ts) et la relecture
// (lib/fec.ts, `numerotationValidee`) le lisent, et lib/champsBncDuFec.ts comme lib/champsBncFiges.ts, qui le redisent,
// importent lib/cases2035.ts — un cycle (cases2035 → declaration2035 → amortissements → validationExercice) qui les
// évaluerait avant leurs propres imports.

/** Le séparateur de la nature et du poste dans NatOp, celui de la réponse du cabinet (« Dépense — Achats »). */
export const SEPARATEUR_DU_POSTE = ' — '

// ── Les cinq clés d'une ligne de la demande de validation, et la NatOp d'une ligne validée (lots FEC22b et FEC22c2) ──────────
// La migration `champs_bnc_du_fec` les lit dans `p_lignes` et les fige (lib/champsBncFiges.ts, qui redit ses refus, les
// réexporte) ; la demande (lib/validationExercice.ts) et la relecture (lib/fec.ts, `numerotationValidee`) les composent ici.

/**
 * Ce qu'une ligne de la demande porte de plus, et ce qu'une ligne validée en garde : nul quand la valeur manque — jamais
 * une chaîne vide, que la base refuse (une date, un mode ou une identification vides ne sont pas nuls : 151b, 153b, 163i
 * de l'essai).
 */
export interface ChampsBncDUneLigne {
  date_reglement: string | null
  mode_reglement: ModeRglt | null
  nature_operation: NatureOperation | null
  poste_rattache: string | null
  identification_client: string | null
}

/**
 * Le poste que NatOp porte après la nature (FEC22-Q3, (C) : « Dépense — Achats »), ou nul quand NatOp n'est que la nature.
 * NatOp vient de `natOpDeLaLigne` (lib/champsBncDuFec.ts) : une autre forme est une faute de l'appelant, qui se lève.
 */
export function posteDeLaNatOp(nature: NatureOperation, natOp: string): string | null {
  if (natOp === nature) return null
  const prefixe = `${nature}${SEPARATEUR_DU_POSTE}`
  if (!natOp.startsWith(prefixe) || natOp.length === prefixe.length) {
    throw new Error(`NatOp « ${natOp} » ne commence pas par sa nature « ${nature} ».`)
  }
  return natOp.slice(prefixe.length)
}

/**
 * Les cinq clés d'une ligne de la demande, tirées des quatre champs de son écriture (`ChampsBnc`, lib/champsBncDuFec.ts) :
 * le vide du fichier ('') devient nul, la nature est celle de l'écriture, le poste celui que la NatOp de CETTE ligne
 * porte. Une ligne que les champs ne caractérisent pas est une faute de l'appelant, qui se lève.
 */
export function champsDeLaLigneDemandee(champs: ChampsBnc, idDeLaLigne: string): ChampsBncDUneLigne {
  const natOp = champs.natOp.get(idDeLaLigne)
  if (natOp === undefined) throw new Error(`La ligne ${idDeLaLigne} n'a pas de NatOp dans les champs de son écriture.`)
  return {
    date_reglement: champs.dateRglt === '' ? null : champs.dateRglt,
    mode_reglement: champs.modeRglt === '' ? null : champs.modeRglt,
    nature_operation: champs.nature,
    poste_rattache: posteDeLaNatOp(champs.nature, natOp),
    identification_client: champs.idClient === '' ? null : champs.idClient,
  }
}

/**
 * NatOp d'une ligne validée, recomposée de ce qu'elle a figé : la nature, suivie du poste quand elle en porte un ; ''
 * sans nature (une ligne validée sans les champs, avant la migration ou par une demande qui ne les portait pas).
 */
export function natOpFigee(ligne: Pick<ChampsBncDUneLigne, 'nature_operation' | 'poste_rattache'>): string {
  if (ligne.nature_operation === null) return ''
  return ligne.poste_rattache === null ? ligne.nature_operation : `${ligne.nature_operation}${SEPARATEUR_DU_POSTE}${ligne.poste_rattache}`
}
