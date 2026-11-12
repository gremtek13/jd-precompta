// UN ZIP ÉCRIT EN FLUX (INAL6, CFC-Q1 (B) « un seul ZIP » pour tout le cabinet, tranchée le 12/11/2026).
//
// POURQUOI PAS JSZIP. `jszip` (3.10, déjà en dépendance) sait SORTIR un ZIP par morceaux (`generateInternalStream`,
// `streamFiles`), mais pas y ENTRER des fichiers au fil de l'eau : `zip.file()` résout chaque contenu aussitôt
// (`utils.prepareContent`, `Promise.resolve(data).then(...)`) et l'objet du ZIP le garde jusqu'à la fin ; la génération ne
// commence qu'une fois tous les fichiers donnés (`generate/index.js`, `zip.forEach`). Un ZIP de tout le cabinet tiendrait donc
// tous les fichiers en mémoire, puis le ZIP lui-même. D'où cet écrivain, qui n'ajoute aucune dépendance : chaque fichier
// est écrit dès qu'il est relu (son en-tête local, puis ses octets), et seul le répertoire central — quelques dizaines
// d'octets par fichier — reste en mémoire jusqu'à la fermeture.
//
// LE FORMAT. APPNOTE.TXT de PKWARE (version 6.3.10, publique), §4.3 : en-tête local (4.3.7), répertoire central (4.3.12),
// fin du répertoire central (4.3.16) ; méthode 0, « stored » (4.4.5) : les pièces sont des PDF, des JPEG et des PNG, déjà
// compressés, et tout outil lit un ZIP « stored » ; noms en UTF-8 (bit 11 des drapeaux, 4.4.4 et annexe D) ; CRC-32 du
// polynôme 0xEDB88320 (4.4.7). Pas de ZIP64 (4.3.14) : un ZIP au-delà de 4 Gio ou de 65 535 fichiers se REFUSE, avant
// d'écrire le fichier qui le ferait passer (`depasserait`), plutôt que de produire un fichier illisible.

/** Le plus gros ZIP qu'écrit ce module : un décalage ou une taille tient sur 32 bits (sans ZIP64). */
export const PLAFOND_DU_ZIP = 0xffff_ffff
/** Le plus grand nombre de fichiers d'un ZIP sans ZIP64. */
export const FICHIERS_AU_PLUS = 0xffff

/** Où vont les morceaux : un fichier du disque, ou une suite de Blob. */
export interface SortieDuZip {
  ecrire: (morceau: Uint8Array) => Promise<void>
}

const TABLE_CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(octets: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < octets.length; i++) c = TABLE_CRC[(c ^ octets[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** La date et l'heure MS-DOS (APPNOTE 4.4.6), à Paris : ce que l'explorateur du cabinet affichera. */
export function dateDos(instant: Date): { date: number; heure: number } {
  const parties = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    second: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant).map((p) => [p.type, p.value]))
  const an = Math.min(Math.max(Number(parties.year), 1980), 2107)
  return {
    date: ((an - 1980) << 9) | (Number(parties.month) << 5) | Number(parties.day),
    heure: (Number(parties.hour) << 11) | (Number(parties.minute) << 5) | Math.floor(Number(parties.second) / 2),
  }
}

const encodeur = new TextEncoder()
const UTF8 = 0x0800

interface Entree { nom: Uint8Array; crc: number; taille: number; decalage: number }

export class EcrivainZip {
  private readonly sortie: SortieDuZip
  private readonly dos: { date: number; heure: number }
  private readonly entrees: Entree[] = []
  private decalage = 0
  private ferme = false

  constructor(sortie: SortieDuZip, instant: Date) {
    this.sortie = sortie
    this.dos = dateDos(instant)
  }

  /** Les octets déjà écrits. */
  get octetsEcrits(): number { return this.decalage }
  get nombreDeFichiers(): number { return this.entrees.length }

  /** Le ZIP passerait-il ses bornes avec ce fichier, son répertoire central et sa fin comptés ? */
  depasserait(nom: string, taille: number, plafond: number = PLAFOND_DU_ZIP): boolean {
    const longueur = encodeur.encode(nom).length
    const central = this.entrees.reduce((s, e) => s + 46 + e.nom.length, 0) + 46 + longueur
    return this.entrees.length + 1 > FICHIERS_AU_PLUS
      || this.decalage + 30 + longueur + taille + central + 22 > Math.min(plafond, PLAFOND_DU_ZIP)
  }

  async ajouter(nom: string, octets: Uint8Array): Promise<void> {
    if (this.ferme) throw new RangeError('Le ZIP est déjà fermé.')
    if (this.depasserait(nom, octets.length)) throw new RangeError('Le ZIP passerait 4 Gio ou 65 535 fichiers.')
    const n = encodeur.encode(nom)
    const crc = crc32(octets)
    const tete = new Uint8Array(30 + n.length)
    const v = new DataView(tete.buffer)
    v.setUint32(0, 0x04034b50, true)
    v.setUint16(4, 20, true)
    v.setUint16(6, UTF8, true)
    v.setUint16(8, 0, true)
    v.setUint16(10, this.dos.heure, true)
    v.setUint16(12, this.dos.date, true)
    v.setUint32(14, crc, true)
    v.setUint32(18, octets.length, true)
    v.setUint32(22, octets.length, true)
    v.setUint16(26, n.length, true)
    v.setUint16(28, 0, true)
    tete.set(n, 30)
    this.entrees.push({ nom: n, crc, taille: octets.length, decalage: this.decalage })
    await this.sortie.ecrire(tete)
    if (octets.length > 0) await this.sortie.ecrire(octets)
    this.decalage += tete.length + octets.length
  }

  /** Le répertoire central et sa fin : le ZIP est complet. */
  async fermer(): Promise<void> {
    if (this.ferme) return
    this.ferme = true
    const taille = this.entrees.reduce((s, e) => s + 46 + e.nom.length, 0)
    const central = new Uint8Array(taille + 22)
    const v = new DataView(central.buffer)
    let p = 0
    for (const e of this.entrees) {
      v.setUint32(p, 0x02014b50, true)
      v.setUint16(p + 4, 20, true)
      v.setUint16(p + 6, 20, true)
      v.setUint16(p + 8, UTF8, true)
      v.setUint16(p + 10, 0, true)
      v.setUint16(p + 12, this.dos.heure, true)
      v.setUint16(p + 14, this.dos.date, true)
      v.setUint32(p + 16, e.crc, true)
      v.setUint32(p + 20, e.taille, true)
      v.setUint32(p + 24, e.taille, true)
      v.setUint16(p + 28, e.nom.length, true)
      // Champ supplémentaire, commentaire, disque, attributs internes et externes : nuls (42 octets d'en-tête avant le décalage).
      v.setUint32(p + 42, e.decalage, true)
      central.set(e.nom, p + 46)
      p += 46 + e.nom.length
    }
    v.setUint32(p, 0x06054b50, true)
    v.setUint16(p + 8, this.entrees.length, true)
    v.setUint16(p + 10, this.entrees.length, true)
    v.setUint32(p + 12, taille, true)
    v.setUint32(p + 16, this.decalage, true)
    await this.sortie.ecrire(central)
    this.decalage += central.length
  }
}
