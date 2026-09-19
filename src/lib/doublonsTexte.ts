import { supabase } from './supabase'

// Le même document déposé deux fois — ce que l'empreinte du FICHIER ne peut pas voir.
//
// La détection de doublons du projet repose sur le SHA-256 du fichier (`pieces.storage_hash`,
// `documents_divers.storage_hash`), et c'est la bonne base : elle attrape le cas le plus fréquent,
// le même fichier redéposé. Mais elle est aveugle par construction au cas d'à côté — deux EXPORTS du
// même document : repris d'un portail fournisseur, réimprimé en PDF, rescanné, renommé. Octets
// différents, substance identique.
//
// CE QUE ÇA COÛTE, mesuré sur le dossier `test` le 19/09/2026. « mai.pdf » et « juin.pdf »
// (Transmedical, 38,40 €) portent deux empreintes de fichier distinctes et exactement le même texte
// OCR. Conséquences en chaîne, qu'aucun écran ne reliait :
//   - une échéance de plus dans le mois de juin, donc une charge comptée deux fois si les deux sont
//     validées et catégorisées ;
//   - le prélèvement réel du mois manquant ne trouve plus de pièce en face ;
//   - et les deux pièces se disputent le même mouvement, donc `analyserAppariements` refuse un
//     appariement qui était certain (« plusieurs pièces possibles »).
// Le diagnostic a d'abord été « une date mal lue ». Il était faux : les deux textes sont identiques
// et disent la même date. Seule la comparaison des TEXTES l'a montré.
//
// L'EMPREINTE VIT EN BASE, en colonne générée (`piece_textes_ocr.texte_md5`) : une empreinte que
// l'application écrirait pourrait être oubliée à une mise à jour et désigner un texte qui n'existe
// plus. Postgres la recalcule à chaque écriture, donc elle ne peut pas dériver. Les espaces y sont
// normalisés avant le calcul — l'OCR ne recolle pas toujours les blancs de la même façon.

/** Une empreinte de texte et ce à quoi elle est rattachée. Exactement un des deux identifiants. */
export interface EmpreinteTexte {
  pieceId: string | null
  documentId: string | null
  empreinte: string
}

/** Plusieurs pièces/documents d'un même dossier dont le texte lu est identique. */
export interface DoublonDeTexte {
  empreinte: string
  pieceIds: string[]
  documentIds: string[]
}

// Regroupement pur, pour que la règle soit testable sans base. Volontairement séparé de la lecture
// (voir l'en-tête de comptes.ts sur la raison pour laquelle un module de calcul n'importe pas le
// client Supabase — ici la lecture vit dans le même fichier, mais la règle reste isolable).
export function grouperDoublonsDeTexte(empreintes: EmpreinteTexte[]): DoublonDeTexte[] {
  const parEmpreinte = new Map<string, EmpreinteTexte[]>()
  for (const ligne of empreintes) {
    // Une ligne sans empreinte ne se compare à rien : la taire vaut mieux que de créer un groupe
    // « tous ceux dont on ne sait rien », qui serait le plus gros et le plus faux.
    if (!ligne.empreinte) continue
    // Une ligne qui ne désigne ni pièce ni document ne mène nulle part — l'écran n'aurait rien à
    // ouvrir. Le CHECK de la table l'interdit déjà ; on ne s'y fie pas pour autant.
    if (!ligne.pieceId && !ligne.documentId) continue
    const groupe = parEmpreinte.get(ligne.empreinte)
    if (groupe) groupe.push(ligne)
    else parEmpreinte.set(ligne.empreinte, [ligne])
  }

  const doublons: DoublonDeTexte[] = []
  for (const [empreinte, lignes] of parEmpreinte) {
    if (lignes.length < 2) continue
    doublons.push({
      empreinte,
      pieceIds: lignes.map((l) => l.pieceId).filter((id): id is string => !!id),
      documentIds: lignes.map((l) => l.documentId).filter((id): id is string => !!id),
    })
  }
  // Ordre stable : deux lectures du même dossier doivent rendre la même liste, l'ordre d'une requête
  // Postgres n'étant pas garanti.
  return doublons.sort((a, b) => a.empreinte.localeCompare(b.empreinte))
}

// Lit les empreintes SEULES, jamais les textes : c'est tout l'intérêt de la colonne générée. Un
// texte OCR pèse des kilo-octets par ligne, et cette liste couvre le dossier entier.
export async function chargerEmpreintesTexte(dossierId: string): Promise<EmpreinteTexte[]> {
  const { data, error } = await supabase
    .from('piece_textes_ocr')
    .select('piece_id, document_id, texte_md5')
    .eq('dossier_id', dossierId)
  // Une lecture dont l'échec ressemble à un résultat vide se vérifie comme une écriture : sans ça,
  // un refus RLS se lirait « aucun doublon », c'est-à-dire exactement le contraire de ce qu'on sait.
  if (error) throw error
  return (data ?? []).map((l) => ({
    pieceId: (l.piece_id as string | null) ?? null,
    documentId: (l.document_id as string | null) ?? null,
    empreinte: (l.texte_md5 as string | null) ?? '',
  }))
}

export async function chargerDoublonsDeTexte(dossierId: string): Promise<DoublonDeTexte[]> {
  return grouperDoublonsDeTexte(await chargerEmpreintesTexte(dossierId))
}
