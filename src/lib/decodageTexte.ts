// Le texte d'un fichier exporté par un logiciel ou une banque française, qui sort souvent en windows-1252 (CP1252) et non
// en UTF-8. On tente l'UTF-8 en mode strict — qui LÈVE sur une séquence invalide, là où le mode indulgent (`blob.text()`)
// rend un U+FFFD qu'il faudrait ensuite aller renifler — et on retombe sur windows-1252, qui ne peut pas échouer.
//
// Une seule copie de la règle, pour la balance reprise (`BalanceCard.tsx`, où elle est née : les libellés y sont les noms
// de comptes) et pour le relevé bancaire importé par fichier. Sur un relevé, le repli n'est pas que cosmétique : un export
// windows-1252 qui écrit « -12,50 € » porte le symbole euro sur l'octet 0x80 ; lu en UTF-8 indulgent, il devenait U+FFFD,
// le montant illisible, et la ligne était écartée. Une marque d'ordre UTF-8 en tête est retirée par le décodeur.
// L'import des contacts a sa propre version, qui y ajoute les marques UTF-16 et le refus d'un caractère nul
// (`lib/contactsImportFichier.ts`).
export type EncodageLu = 'utf-8' | 'windows-1252'

export function decoderUtf8OuWindows1252(octets: ArrayBuffer | Uint8Array): { texte: string; encodage: EncodageLu } {
  try {
    return { texte: new TextDecoder('utf-8', { fatal: true }).decode(octets), encodage: 'utf-8' }
  } catch {
    return { texte: new TextDecoder('windows-1252').decode(octets), encodage: 'windows-1252' }
  }
}
