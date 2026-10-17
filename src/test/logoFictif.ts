import { empreinteSha256 } from '../lib/logoDesFactures'

// DES LOGOS FICTIFS pour les tests du logo des factures (espace client, étape A5c2a) : des octets écrits ici, aucun fichier.
// Le PNG est une vraie image de 1 × 1 pixel ; le JPEG n'a que de quoi être reconnu à sa signature (les trois octets
// FF D8 FF), le test ne l'affiche pas. `logoDe(n)` rend un PNG distinct par `n` (un octet de remplissage de plus, après la
// signature, que la lecture ne regarde pas) : chaque empreinte est différente, aucune n'est celle d'un autre jeu d'essai.

const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

function octetsDeBase64(texte: string): Uint8Array<ArrayBuffer> {
  const binaire = atob(texte)
  const octets = new Uint8Array(binaire.length)
  for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i)
  return octets
}

/** Un PNG fictif : le même 1 × 1 pixel, suivi de `n` octets nuls — chaque `n` donne un autre fichier, donc une autre empreinte. */
export function logoDe(n = 0): Uint8Array<ArrayBuffer> {
  const base = octetsDeBase64(PNG_1X1)
  const rendu = new Uint8Array(base.length + n)
  rendu.set(base)
  return rendu
}

/** Un JPEG fictif, reconnu à sa signature. */
export function jpegFictif(): Uint8Array<ArrayBuffer> {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9])
}

/** L'empreinte (SHA-256, hexadécimal minuscule) d'un fichier fictif — celle du module, qui le calcule comme le seau le nomme. */
export const empreinteDe = (octets: Uint8Array<ArrayBuffer>): Promise<string> => empreinteSha256(new Blob([octets]))
