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

// Les trente-deux octets de 0x80 à 0x9F, selon l'index windows-1252 de la norme Encoding du WHATWG (celle des
// navigateurs) ; cinq n'y ont pas de caractère et gardent leur point de code (0x81, 0x8D, 0x8F, 0x90, 0x9D). Écrits ici
// plutôt que demandés à `TextDecoder('windows-1252')` : Node 22.22 lit ces octets comme du latin-1 (0x80 y rend U+0080
// au lieu de « € »), et un décodage doit dire la même chose partout où il tourne, la suite comprise.
const WINDOWS_1252_DE_80_A_9F: readonly number[] = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008d, 0x017d, 0x008f,
  0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x009d, 0x017e, 0x0178,
]

/** Des octets windows-1252 en texte, sans `TextDecoder` : hors de 0x80–0x9F, un octet est son propre point de code. */
export function decoderWindows1252(octets: ArrayBuffer | Uint8Array): string {
  const o = octets instanceof Uint8Array ? octets : new Uint8Array(octets)
  const morceaux: string[] = []
  // Par tranches : `String.fromCharCode` prend ses points de code en arguments, dont le nombre est borné.
  const TRANCHE = 8192
  for (let debut = 0; debut < o.length; debut += TRANCHE) {
    const fin = Math.min(debut + TRANCHE, o.length)
    const codes = new Array<number>(fin - debut)
    for (let i = debut; i < fin; i++) {
      const b = o[i]
      codes[i - debut] = b >= 0x80 && b <= 0x9f ? WINDOWS_1252_DE_80_A_9F[b - 0x80] : b
    }
    morceaux.push(String.fromCharCode(...codes))
  }
  return morceaux.join('')
}

export function decoderUtf8OuWindows1252(octets: ArrayBuffer | Uint8Array): { texte: string; encodage: EncodageLu } {
  try {
    return { texte: new TextDecoder('utf-8', { fatal: true }).decode(octets), encodage: 'utf-8' }
  } catch {
    return { texte: decoderWindows1252(octets), encodage: 'windows-1252' }
  }
}
