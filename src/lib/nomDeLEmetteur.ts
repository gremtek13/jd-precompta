// LE NOM QU'UNE FACTURE IMPRIME POUR SON ÉMETTEUR (FACT-Q2 (B), réponse du cabinet du 27/11/2026). Une facture qui a figé ses
// mentions à sa validation (A7a, `mentions_figees`) imprime la dénomination qu'elle a figée (`denomination_imprimee`), et,
// faute d'elle, le nom qu'elle porte (`emetteur_nom`) ; une facture d'avant, son seul `emetteur_nom`. L'aperçu l'imprime
// (`ceQueLaFactureImprime`, lib/mentionsFigeesVue.ts), et l'e-mail de la facture la nomme de même — son objet, sa signature
// et son expéditeur (supabase/functions/send-email), qui disaient le nom interne du dossier quand la facture imprimait son
// nom légal. Le bloc est COPIÉ dans `send-email`, auto-portée, au caractère près (nomDeLEmetteurCopie.test.ts).

// ── DÉBUT COPIE nomDeLEmetteur ───────────────────────────────────────────────────────────────────────────────────────
/** Ce qu'une facture lue porte de son émetteur : le drapeau des mentions figées, la dénomination figée, le nom recopié. */
export interface EmetteurDeLaFacture {
  mentions_figees?: boolean | null
  denomination_imprimee?: string | null
  emetteur_nom: string | null
}

/** Le nom que la facture imprime pour son émetteur : la dénomination figée d'une facture figée, sinon `emetteur_nom`. */
export function nomDeLEmetteur(f: EmetteurDeLaFacture): string | null {
  const denomination = f.denomination_imprimee
  if (f.mentions_figees === true && typeof denomination === 'string' && denomination.trim() !== '') return denomination
  return f.emetteur_nom
}
// ── FIN COPIE nomDeLEmetteur ─────────────────────────────────────────────────────────────────────────────────────────
