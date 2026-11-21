// ── DÉBUT COPIE texteDUnPdf ──────────────────────────────────────────────────────────────────────────────────────────
// LA COUCHE DE TEXTE D'UN PDF, LUE SANS PDF.JS (conception 59, BOR6, seconde partie : écarter un bordereau de télétransmission
// à la réception par e-mail, AVANT tout dépôt). L'original vit dans src/lib/texteDUnPdf.ts ; il est copié À L'IDENTIQUE dans
// receive-email, auto-portée, et texteDUnPdfCopie.test.ts compare la copie au caractère près et l'exécute contre l'original.
//
// POURQUOI PAS PDF.JS : mesuré le 21/11/2026 (HISTORIQUE.md, « BOR6, SECONDE PARTIE »), pdf.js demande 14,8 s de calcul et
// 420 Mo de mémoire pour un PDF de texte de 5 Mio (3 400 pages), quand une Edge Function n'a que 2 s de calcul et 256 Mo par
// requête ; son code pèse 3,3 Mo. Ce lecteur-ci ne fait que ce que la reconnaissance demande : il trouve les objets du
// fichier (les flux d'objets compris), décompresse les flux par le `DecompressionStream` natif, suit l'arbre des pages, et
// interprète les opérateurs de texte du contenu de chaque page (et de ses formulaires) en fragments positionnés, de la forme
// que pdf.js rend : le texte, l'abscisse et l'ordonnée de son origine, sa largeur quand la police la donne, sa hauteur.
// Les polices simples (WinAnsi, une table « Differences »), composites (Identity-H ou un CMap embarqué), et leur ToUnicode.
//
// CE QU'IL NE LIT PAS, ET QUI REND « ILLISIBLE » OU UN TEXTE VIDE : un fichier chiffré, un filtre autre que FlateDecode,
// ASCIIHexDecode et ASCII85Decode, un prédicteur, une police composite sous un CMap prédéfini autre qu'Identity, une police
// qui ne dit pas ses caractères. Ce qui ne se lit pas ne se reconnaît pas : à la réception, la pièce jointe part comme avant
// (BOR6-Q1 (A)).
//
// BORNÉ : la somme des octets décompressés et la durée de la lecture ont leur plafond, l'horloge est injectée ; au-delà, la
// lecture s'arrête et rend « illisible » sous la raison `borne`. NE REJETTE JAMAIS, et ne rend jamais un morceau du fichier
// dans une raison : les raisons sont des codes fixes. Rien ne sort d'ici : ni réseau, ni journal, ni stockage.

/** Un fragment de texte d'une page, de la forme que pdf.js rend : le texte et sa position. */
export interface FragmentDuPdf {
  texte: string
  x: number
  y: number
  largeur?: number
  hauteur?: number
}

/** Une page lue : ses fragments, dans l'ordre du contenu. */
export interface PageDuPdf {
  fragments: FragmentDuPdf[]
}

export type RaisonIllisible = 'pas-un-pdf' | 'chiffre' | 'sans-page' | 'borne' | 'erreur'

/** `pages` : le nombre de pages lues ; `arrete` : la lecture s'est arrêtée sur la demande de `surLaPage`. */
export type LectureDuTexte = { etat: 'lu'; pages: number; arrete: boolean } | { etat: 'illisible'; raison: RaisonIllisible }

export interface BornesDuTexte {
  /** La somme des octets décompressés, au plus. */
  octetsDecompressesMax: number
  /** La durée de la lecture, au plus, en millisecondes, mesurée par `maintenant`. */
  dureeMaxMs: number
  maintenant: () => number
}

type Valeur = null | boolean | number | Nom | Chaine | Reference | Valeur[] | Dico | Flux
interface Nom { t: 'nom'; v: string }
interface Chaine { t: 'chaine'; v: Uint8Array }
interface Reference { t: 'ref'; n: number }
interface Dico { t: 'dico'; v: Map<string, Valeur> }
interface Flux { t: 'flux'; dico: Dico; debut: number; fin: number; source: Uint8Array }
interface Mot { t: 'mot'; v: string }
type Jeton = number | Nom | Chaine | Mot

function estMot(v: Valeur | Mot | null): v is Mot {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && v.t === 'mot'
}

/** La lecture s'arrête au-delà d'une borne : levée ici, attrapée en tête, jamais au-dehors. */
class Borne extends Error {}

const ESPACE = new Uint8Array(256)
for (const c of [0, 9, 10, 12, 13, 32]) ESPACE[c] = 1
const DELIMITEUR = new Uint8Array(256)
for (const c of '()<>[]{}/%') DELIMITEUR[c.charCodeAt(0)] = 1

function latin1(o: Uint8Array, debut: number, fin: number): string {
  let s = ''
  for (let i = debut; i < fin; i++) s += String.fromCharCode(o[i])
  return s
}

/** Le lecteur de jetons d'un morceau d'octets, sous la syntaxe des objets et du contenu des pages. */
class Lexeur {
  i: number
  private retour: Jeton[] = []
  /** Faux dans le contenu d'une page, qui ne porte aucune référence : un nombre ne fait pas lire les deux jetons qui suivent. */
  readonly o: Uint8Array
  readonly fin: number
  private readonly references: boolean
  constructor(o: Uint8Array, debut: number, fin: number, references = true) {
    this.o = o
    this.i = debut
    this.fin = fin
    this.references = references
  }

  sauterLesEspaces(): void {
    const o = this.o
    while (this.i < this.fin) {
      const c = o[this.i]
      if (ESPACE[c]) this.i++
      else if (c === 0x25) {
        while (this.i < this.fin && o[this.i] !== 10 && o[this.i] !== 13) this.i++
      } else break
    }
  }

  rendre(j: Jeton): void {
    this.retour.push(j)
  }

  /** Le jeton suivant, ou null à la fin. */
  jeton(): Jeton | null {
    if (this.retour.length > 0) return this.retour.pop() as Jeton
    this.sauterLesEspaces()
    const o = this.o
    if (this.i >= this.fin) return null
    const c = o[this.i]
    if (c === 0x2f) { // nom
      let j = this.i + 1
      let s = ''
      while (j < this.fin && !ESPACE[o[j]] && !DELIMITEUR[o[j]]) {
        if (o[j] === 0x23 && j + 2 < this.fin) {
          const h = parseInt(latin1(o, j + 1, j + 3), 16)
          if (!Number.isNaN(h)) { s += String.fromCharCode(h); j += 3; continue }
        }
        s += String.fromCharCode(o[j])
        j++
      }
      this.i = j
      return { t: 'nom', v: s }
    }
    if (c === 0x28) return this.chaineLitterale()
    if (c === 0x3c) {
      if (o[this.i + 1] === 0x3c) { this.i += 2; return { t: 'mot', v: '<<' } }
      return this.chaineHexa()
    }
    if (c === 0x3e) {
      if (o[this.i + 1] === 0x3e) { this.i += 2; return { t: 'mot', v: '>>' } }
      this.i++
      return { t: 'mot', v: '>' }
    }
    if (c === 0x5b || c === 0x5d || c === 0x7b || c === 0x7d || c === 0x29) {
      this.i++
      return { t: 'mot', v: String.fromCharCode(c) }
    }
    let j = this.i
    while (j < this.fin && !ESPACE[o[j]] && !DELIMITEUR[o[j]]) j++
    if (j === this.i) j++
    const s = latin1(o, this.i, j)
    this.i = j
    // Un nombre commence par un chiffre, un signe ou un point ; « 12.5.3 » ou « - » restent des mots.
    if ((c >= 0x30 && c <= 0x39) || c === 0x2b || c === 0x2d || c === 0x2e) {
      const n = Number(s)
      if (s.length > 0 && !Number.isNaN(n) && !/[eExX]/.test(s)) return n
    }
    return { t: 'mot', v: s }
  }

  private chaineLitterale(): Chaine {
    const o = this.o
    const sortie: number[] = []
    let profondeur = 1
    let j = this.i + 1
    while (j < this.fin) {
      const c = o[j]
      if (c === 0x5c) {
        const d = o[j + 1]
        j += 2
        if (d === 0x6e) sortie.push(10)
        else if (d === 0x72) sortie.push(13)
        else if (d === 0x74) sortie.push(9)
        else if (d === 0x62) sortie.push(8)
        else if (d === 0x66) sortie.push(12)
        else if (d === 13) { if (o[j] === 10) j++ }
        else if (d === 10) { /* suite de ligne */ }
        else if (d >= 0x30 && d <= 0x37) {
          let v = d - 0x30
          for (let k = 0; k < 2 && o[j] >= 0x30 && o[j] <= 0x37; k++, j++) v = v * 8 + (o[j] - 0x30)
          sortie.push(v & 0xff)
        } else if (d !== undefined) sortie.push(d)
        continue
      }
      if (c === 0x28) profondeur++
      else if (c === 0x29) {
        profondeur--
        if (profondeur === 0) { j++; break }
      }
      sortie.push(c)
      j++
    }
    this.i = j
    return { t: 'chaine', v: Uint8Array.from(sortie) }
  }

  private chaineHexa(): Chaine {
    const o = this.o
    let fin = o.indexOf(0x3e, this.i + 1)
    if (fin < 0 || fin > this.fin) fin = this.fin
    const sortie = new Uint8Array((fin - this.i) >> 1)
    let n = 0
    let moitie = -1
    for (let j = this.i + 1; j < fin; j++) {
      const c = o[j]
      const v = c >= 0x30 && c <= 0x39 ? c - 0x30 : c >= 0x41 && c <= 0x46 ? c - 0x37 : c >= 0x61 && c <= 0x66 ? c - 0x57 : -1
      if (v < 0) continue
      if (moitie < 0) moitie = v
      else { sortie[n++] = moitie * 16 + v; moitie = -1 }
    }
    if (moitie >= 0) sortie[n++] = moitie * 16
    this.i = fin + 1
    return { t: 'chaine', v: sortie.subarray(0, n) }
  }

  /** Une valeur entière : un nombre, un nom, une chaîne, un tableau, un dictionnaire, une référence `n g R`. */
  valeur(profondeur = 0): Valeur | Mot | null {
    const j = this.jeton()
    if (j === null) return null
    if (typeof j === 'number') {
      if (!this.references) return j
      const g = this.jeton()
      if (typeof g === 'number' && Number.isInteger(j) && Number.isInteger(g)) {
        const r = this.jeton()
        if (r !== null && typeof r === 'object' && r.t === 'mot' && r.v === 'R') return { t: 'ref', n: j }
        if (r !== null) this.rendre(r)
      }
      if (g !== null) this.rendre(g)
      return j
    }
    if (j.t !== 'mot') return j
    if (profondeur > 64) return null
    if (j.v === '[') {
      const tableau: Valeur[] = []
      for (;;) {
        const v = this.valeur(profondeur + 1)
        if (v === null) return tableau
        if (estMot(v)) {
          if (v.v === ']') return tableau
          continue
        }
        tableau.push(v)
      }
    }
    if (j.v === '<<') {
      const dico = new Map<string, Valeur>()
      for (;;) {
        const cle = this.jeton()
        if (cle === null) return { t: 'dico', v: dico }
        if (typeof cle === 'object' && cle.t === 'mot' && cle.v === '>>') return { t: 'dico', v: dico }
        if (typeof cle !== 'object' || cle.t !== 'nom') continue
        const v = this.valeur(profondeur + 1)
        if (v === null) return { t: 'dico', v: dico }
        if (estMot(v)) {
          if (v.v === '>>') return { t: 'dico', v: dico }
          continue
        }
        dico.set(cle.v, v)
      }
    }
    if (j.v === 'true') return true
    if (j.v === 'false') return false
    if (j.v === 'null') return null
    return j
  }
}

const estDico = (v: unknown): v is Dico => typeof v === 'object' && v !== null && !Array.isArray(v) && (v as Dico).t === 'dico'
const estFlux = (v: unknown): v is Flux => typeof v === 'object' && v !== null && !Array.isArray(v) && (v as Flux).t === 'flux'
const nomDe = (v: unknown): string | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && (v as Nom).t === 'nom' ? (v as Nom).v : null

/** Cherche `motif` dans `o` à partir de `depuis`, par la recherche native de son premier octet. */
function chercher(o: Uint8Array, motif: string, depuis: number, fin = o.length): number {
  const premier = motif.charCodeAt(0)
  let i = depuis
  for (;;) {
    i = o.indexOf(premier, i)
    if (i < 0 || i + motif.length > fin) return -1
    let k = 1
    while (k < motif.length && o[i + k] === motif.charCodeAt(k)) k++
    if (k === motif.length) return i
    i++
  }
}

/** Le document : ses objets, lus par leur marque `n g obj`, sans la table des références (souvent fausse, jamais nécessaire). */
class FichierPdf {
  readonly objets = new Map<number, Valeur>()
  chiffre = false
  catalogue: Dico | null = null
  readonly pagesEnVrac: Dico[] = []
  /** Les polices déjà lues, d'une page à l'autre : une police se lit une fois par fichier. */
  readonly polices = new Map<Dico, Police>()
  private octetsRestants: number

  readonly o: Uint8Array
  private readonly bornes: BornesDuTexte
  private readonly debutMs: number
  constructor(o: Uint8Array, bornes: BornesDuTexte, debutMs: number) {
    this.o = o
    this.bornes = bornes
    this.debutMs = debutMs
    this.octetsRestants = bornes.octetsDecompressesMax
  }

  verifierLaDuree(): void {
    if (this.bornes.maintenant() - this.debutMs > this.bornes.dureeMaxMs) throw new Borne()
  }

  /** Les objets du fichier, dans l'ordre : un objet redéfini plus loin (une mise à jour incrémentale) remplace le premier. */
  lireLesObjets(): void {
    const o = this.o
    let i = 0
    for (;;) {
      const j = chercher(o, 'obj', i)
      if (j < 0) break
      i = j + 3
      if (j === 0 || !ESPACE[o[j - 1]] || (j + 3 < o.length && !ESPACE[o[j + 3]] && !DELIMITEUR[o[j + 3]])) continue
      // « n g obj » : deux entiers avant le mot.
      let k = j - 1
      while (k >= 0 && ESPACE[o[k]]) k--
      const finG = k + 1
      while (k >= 0 && o[k] >= 0x30 && o[k] <= 0x39) k--
      if (k + 1 === finG) continue
      const finN = k
      while (k >= 0 && ESPACE[o[k]]) k--
      if (k === finN) continue
      const finNum = k + 1
      while (k >= 0 && o[k] >= 0x30 && o[k] <= 0x39) k--
      if (k + 1 === finNum) continue
      const numero = Number(latin1(o, k + 1, finNum))
      const lexeur = new Lexeur(o, j + 3, o.length)
      const valeur = lexeur.valeur()
      if (estMot(valeur)) continue
      lexeur.sauterLesEspaces()
      let position = lexeur.i
      if (estDico(valeur) && chercher(o, 'stream', position, position + 6) === position) {
        let debut = position + 6
        if (o[debut] === 13) debut++
        if (o[debut] === 10) debut++
        const longueur = valeur.v.get('Length')
        let fin = -1
        if (typeof longueur === 'number' && Number.isInteger(longueur) && longueur >= 0 && debut + longueur <= o.length) {
          let e = debut + longueur
          while (e < o.length && ESPACE[o[e]]) e++
          if (chercher(o, 'endstream', e, e + 9) === e) fin = debut + longueur
        }
        if (fin < 0) {
          const e = chercher(o, 'endstream', debut)
          if (e < 0) continue
          fin = e
          while (fin > debut && (o[fin - 1] === 10 || o[fin - 1] === 13)) fin--
        }
        this.objets.set(numero, { t: 'flux', dico: valeur, debut, fin, source: o })
        position = fin + 9
      } else {
        this.objets.set(numero, valeur as Valeur)
      }
      i = Math.max(i, position)
    }
  }

  /** Le chiffrement se dit dans la remorque, ou dans le dictionnaire d'un flux de références. */
  repererLeChiffrement(): void {
    const o = this.o
    let i = 0
    for (;;) {
      const j = chercher(o, '/Encrypt', i)
      if (j < 0) return
      i = j + 8
      if (i < o.length && !ESPACE[o[i]] && !DELIMITEUR[o[i]]) continue
      this.chiffre = true
      return
    }
  }

  resoudre(v: Valeur | undefined, profondeur = 0): Valeur {
    if (v === undefined) return null
    if (typeof v === 'object' && v !== null && !Array.isArray(v) && v.t === 'ref') {
      if (profondeur > 16) return null
      return this.resoudre(this.objets.get(v.n), profondeur + 1)
    }
    return v
  }

  dans(d: Dico, cle: string): Valeur {
    return this.resoudre(d.v.get(cle))
  }

  /** Les octets décodés d'un flux, ou null quand un filtre n'est pas lu. Lève `Borne` au-delà du plafond des octets. */
  async decoder(f: Flux): Promise<Uint8Array | null> {
    let donnees = f.source.subarray(f.debut, f.fin)
    const filtre = this.dans(f.dico, 'Filter')
    const filtres = (Array.isArray(filtre) ? filtre : filtre === null ? [] : [filtre]).map((x) => nomDe(this.resoudre(x)))
    const parametres = this.dans(f.dico, 'DecodeParms')
    const listeParametres = Array.isArray(parametres) ? parametres : [parametres]
    for (let k = 0; k < filtres.length; k++) {
      const p = this.resoudre(listeParametres[k] ?? null)
      if (estDico(p)) {
        const predicteur = this.dans(p, 'Predictor')
        if (typeof predicteur === 'number' && predicteur > 1) return null
      }
      const nom = filtres[k]
      if (nom === 'FlateDecode' || nom === 'Fl') {
        const sortie = await this.inflater(donnees)
        if (sortie === null) return null
        donnees = sortie
      } else if (nom === 'ASCIIHexDecode' || nom === 'AHx') {
        const hexa = new Uint8Array(donnees.length + 1)
        hexa[0] = 0x3c
        hexa.set(donnees, 1)
        const j = new Lexeur(hexa, 0, hexa.length).jeton()
        donnees = typeof j === 'object' && j !== null && j.t === 'chaine' ? j.v : new Uint8Array(0)
      } else if (nom === 'ASCII85Decode' || nom === 'A85') {
        donnees = ascii85(donnees)
      } else {
        return null
      }
      this.octetsRestants -= donnees.length
      if (this.octetsRestants < 0) throw new Borne()
    }
    this.verifierLaDuree()
    return donnees
  }

  private async inflater(donnees: Uint8Array): Promise<Uint8Array | null> {
    for (const format of ['deflate', 'deflate-raw'] as const) {
      const morceaux: Uint8Array[] = []
      let total = 0
      let depasse = false
      try {
        const lecteur = new Blob([donnees.slice()]).stream().pipeThrough(new DecompressionStream(format)).getReader()
        for (;;) {
          const { done, value } = await lecteur.read()
          if (done) break
          total += value.length
          if (total > this.octetsRestants) {
            await lecteur.cancel().catch(() => undefined)
            depasse = true
            break
          }
          morceaux.push(value)
        }
      } catch {
        // Un flux tronqué ou suivi d'octets en trop : ce qui a été décompressé se garde, comme pdf.js le fait.
        if (total === 0) continue
      }
      if (depasse) throw new Borne()
      const sortie = new Uint8Array(total)
      let position = 0
      for (const m of morceaux) { sortie.set(m, position); position += m.length }
      return sortie
    }
    return null
  }

  /** Les objets des flux d'objets (PDF 1.5) qu'aucun objet direct ne définit déjà. */
  async lireLesFluxDObjets(): Promise<void> {
    const flux = [...this.objets.values()].filter((v): v is Flux => estFlux(v) && nomDe(this.dans(v.dico, 'Type')) === 'ObjStm')
    for (const f of flux) {
      const octets = await this.decoder(f)
      const n = this.dans(f.dico, 'N')
      const premier = this.dans(f.dico, 'First')
      if (octets === null || typeof n !== 'number' || typeof premier !== 'number') continue
      const entete = new Lexeur(octets, 0, Math.min(premier, octets.length))
      const paires: [number, number][] = []
      for (let k = 0; k < n && k < 100_000; k++) {
        const numero = entete.jeton()
        const decalage = entete.jeton()
        if (typeof numero !== 'number' || typeof decalage !== 'number') break
        paires.push([numero, decalage])
      }
      for (const [numero, decalage] of paires) {
        if (this.objets.has(numero) || premier + decalage >= octets.length) continue
        const v = new Lexeur(octets, premier + decalage, octets.length).valeur()
        if (estMot(v)) continue
        this.objets.set(numero, v as Valeur)
      }
    }
    for (const v of this.objets.values()) {
      if (!estDico(v)) continue
      const type = nomDe(this.dans(v, 'Type'))
      if (type === 'Catalog' && this.catalogue === null) this.catalogue = v
      if (type === 'Page') this.pagesEnVrac.push(v)
    }
  }

  /** Les pages dans l'ordre de l'arbre ; à défaut d'arbre lisible, dans l'ordre du fichier. */
  pages(): Dico[] {
    const vues = new Set<Dico>()
    const rangees: Dico[] = []
    const parcourir = (noeud: Valeur, profondeur: number) => {
      if (!estDico(noeud) || vues.has(noeud) || profondeur > 32) return
      vues.add(noeud)
      const kids = this.dans(noeud, 'Kids')
      if (Array.isArray(kids)) for (const k of kids) parcourir(this.resoudre(k), profondeur + 1)
      else if (nomDe(this.dans(noeud, 'Type')) === 'Page' || this.dans(noeud, 'Contents') !== null) rangees.push(noeud)
    }
    if (this.catalogue !== null) parcourir(this.dans(this.catalogue, 'Pages'), 0)
    return rangees.length > 0 ? rangees : this.pagesEnVrac
  }

  /** Une clé d'une page, héritée de ses parents quand elle ne la porte pas (les ressources). */
  herite(page: Dico, cle: string): Valeur {
    let noeud: Valeur = page
    for (let k = 0; k < 32 && estDico(noeud); k++) {
      const v = this.dans(noeud, cle)
      if (v !== null) return v
      noeud = this.dans(noeud, 'Parent')
    }
    return null
  }
}

function ascii85(o: Uint8Array): Uint8Array {
  const sortie: number[] = []
  let groupe: number[] = []
  for (let i = 0; i < o.length; i++) {
    const c = o[i]
    if (c === 0x7e) break
    if (ESPACE[c]) continue
    if (c === 0x7a && groupe.length === 0) { sortie.push(0, 0, 0, 0); continue }
    if (c < 0x21 || c > 0x75) continue
    groupe.push(c - 0x21)
    if (groupe.length === 5) {
      let v = 0
      for (const g of groupe) v = v * 85 + g
      sortie.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff)
      groupe = []
    }
  }
  if (groupe.length > 1) {
    const n = groupe.length
    while (groupe.length < 5) groupe.push(84)
    let v = 0
    for (const g of groupe) v = v * 85 + g
    const octets = [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]
    sortie.push(...octets.slice(0, n - 1))
  }
  return Uint8Array.from(sortie)
}

// ── Les polices : la longueur d'un code, son texte, sa largeur. ──

/** Les octets 0x80 à 0x9F de WinAnsiEncoding ; le reste est l'ASCII et le Latin-1. */
const WIN_ANSI_80 = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ'
const ACCENTS: Record<string, string> = {
  acute: '́', grave: '̀', circumflex: '̂', dieresis: '̈', cedilla: '̧', tilde: '̃', ring: '̊',
}
const NOMS_DE_GLYPHES: Record<string, string> = {
  space: ' ', exclam: '!', quotedbl: '"', numbersign: '#', dollar: '$', percent: '%', ampersand: '&', quotesingle: '\'',
  quoteright: '’', quoteleft: '‘', parenleft: '(', parenright: ')', asterisk: '*', plus: '+', comma: ',', hyphen: '-',
  minus: '-', period: '.', slash: '/', zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7',
  eight: '8', nine: '9', colon: ':', semicolon: ';', less: '<', equal: '=', greater: '>', question: '?', at: '@',
  bracketleft: '[', backslash: '\\', bracketright: ']', underscore: '_', braceleft: '{', bar: '|', braceright: '}',
  germandbls: 'ß', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ', fi: 'fi', fl: 'fl', Euro: '€', degree: '°', endash: '–', emdash: '—',
  nbspace: ' ', guillemotleft: '«', guillemotright: '»',
}

function texteDuGlyphe(nom: string): string {
  if (nom.length === 1) return nom
  const connu = NOMS_DE_GLYPHES[nom]
  if (connu !== undefined) return connu
  const accent = /^([A-Za-z])(acute|grave|circumflex|dieresis|cedilla|tilde|ring)$/.exec(nom)
  if (accent !== null) return (accent[1] + ACCENTS[accent[2]]).normalize('NFC')
  const uni = /^uni([0-9A-Fa-f]{4})$/.exec(nom) ?? /^u([0-9A-Fa-f]{4,6})$/.exec(nom)
  if (uni !== null) {
    const point = parseInt(uni[1], 16)
    if (point <= 0x10ffff && (point < 0xd800 || point > 0xdfff)) return String.fromCodePoint(point)
  }
  return ''
}

interface PlageDeCodes { octets: number; bas: Uint8Array; haut: Uint8Array }
interface CMapLu {
  plages: PlageDeCodes[]
  unicode: Map<number, string>
  plagesUnicode: { bas: number; haut: number; base: string | string[] }[]
  cid: Map<number, number>
  plagesCid: { bas: number; haut: number; cid: number }[]
}

function versNombre(o: Uint8Array): number {
  let v = 0
  for (const c of o) v = v * 256 + c
  return v
}

function utf16(o: Uint8Array): string {
  let s = ''
  for (let i = 0; i + 1 < o.length; i += 2) s += String.fromCharCode(o[i] * 256 + o[i + 1])
  if (o.length === 1) s += String.fromCharCode(o[0])
  return s
}

/** Un CMap (ToUnicode, ou l'encodage embarqué d'une police composite) : ses plages de codes, ses textes, ses CID. */
function lireCMap(octets: Uint8Array): CMapLu {
  const lu: CMapLu = { plages: [], unicode: new Map(), plagesUnicode: [], cid: new Map(), plagesCid: [] }
  const lexeur = new Lexeur(octets, 0, octets.length)
  const chaine = (v: unknown): Uint8Array | null =>
    typeof v === 'object' && v !== null && !Array.isArray(v) && (v as Chaine).t === 'chaine' ? (v as Chaine).v : null
  let section: string | null = null
  const operandes: (Valeur | Mot)[] = []
  for (let garde = 0; garde < 2_000_000; garde++) {
    const v = lexeur.valeur()
    if (v === null && lexeur.i >= lexeur.fin) break
    if (estMot(v)) {
      if (v.v.startsWith('begin')) { section = v.v; operandes.length = 0; continue }
      if (v.v.startsWith('end')) { section = null; operandes.length = 0; continue }
      continue
    }
    if (section === null) continue
    operandes.push(v)
    if (section === 'begincodespacerange' && operandes.length === 2) {
      const [bas, haut] = operandes.map(chaine)
      if (bas !== null && haut !== null && bas.length === haut.length && bas.length >= 1 && bas.length <= 4) {
        lu.plages.push({ octets: bas.length, bas, haut })
      }
      operandes.length = 0
    } else if (section === 'beginbfchar' && operandes.length === 2) {
      const source = chaine(operandes[0])
      const cible = operandes[1]
      if (source !== null) {
        const texte = chaine(cible)
        if (texte !== null) lu.unicode.set(versNombre(source), utf16(texte))
        else if (nomDe(cible) !== null) lu.unicode.set(versNombre(source), texteDuGlyphe(nomDe(cible) as string))
      }
      operandes.length = 0
    } else if (section === 'beginbfrange' && operandes.length === 3) {
      const [bas, haut] = operandes.slice(0, 2).map(chaine)
      const cible = operandes[2]
      if (bas !== null && haut !== null && lu.plagesUnicode.length < 50_000) {
        const texte = chaine(cible)
        if (texte !== null) lu.plagesUnicode.push({ bas: versNombre(bas), haut: versNombre(haut), base: utf16(texte) })
        else if (Array.isArray(cible)) {
          lu.plagesUnicode.push({ bas: versNombre(bas), haut: versNombre(haut), base: cible.map((c) => utf16(chaine(c) ?? new Uint8Array(0))) })
        }
      }
      operandes.length = 0
    } else if (section === 'begincidchar' && operandes.length === 2) {
      const source = chaine(operandes[0])
      if (source !== null && typeof operandes[1] === 'number') lu.cid.set(versNombre(source), operandes[1])
      operandes.length = 0
    } else if (section === 'begincidrange' && operandes.length === 3) {
      const [bas, haut] = operandes.slice(0, 2).map(chaine)
      if (bas !== null && haut !== null && typeof operandes[2] === 'number' && lu.plagesCid.length < 50_000) {
        lu.plagesCid.push({ bas: versNombre(bas), haut: versNombre(haut), cid: operandes[2] })
      }
      operandes.length = 0
    }
  }
  return lu
}

function texteDuCMap(cmap: CMapLu, code: number): string | undefined {
  const direct = cmap.unicode.get(code)
  if (direct !== undefined) return direct
  for (const p of cmap.plagesUnicode) {
    if (code < p.bas || code > p.haut) continue
    if (Array.isArray(p.base)) return p.base[code - p.bas] ?? ''
    if (p.base === '') return ''
    const dernier = p.base.charCodeAt(p.base.length - 1) + (code - p.bas)
    return p.base.slice(0, -1) + String.fromCharCode(dernier & 0xffff)
  }
  return undefined
}

interface Police {
  /** La longueur, en octets, du code qui commence en `i`. */
  longueur(o: Uint8Array, i: number): number
  texte(code: number): string
  /** La largeur d'un code en millièmes de l'unité de texte, ou undefined quand la police ne la dit pas. */
  largeur(code: number): number | undefined
}

async function lirePolice(doc: FichierPdf, police: Dico): Promise<Police> {
  const sousType = nomDe(doc.dans(police, 'Subtype'))
  const toUnicodeFlux = doc.dans(police, 'ToUnicode')
  const toUnicodeOctets = estFlux(toUnicodeFlux) ? await doc.decoder(toUnicodeFlux) : null
  const toUnicode = toUnicodeOctets === null ? null : lireCMap(toUnicodeOctets)

  if (sousType === 'Type0') {
    const descendantes = doc.dans(police, 'DescendantFonts')
    const descendante = doc.resoudre(Array.isArray(descendantes) ? descendantes[0] : null)
    const encodage = doc.dans(police, 'Encoding')
    const identite = nomDe(encodage) === 'Identity-H' || nomDe(encodage) === 'Identity-V'
    const embarque = estFlux(encodage) ? await doc.decoder(encodage) : null
    const cmapEncodage = embarque === null ? null : lireCMap(embarque)
    const lisible = identite || cmapEncodage !== null
    const plages = cmapEncodage?.plages.length ? cmapEncodage.plages : toUnicode?.plages.length ? toUnicode.plages : null
    const largeurs = new Map<number, number>()
    let parDefaut = 1000
    if (estDico(descendante)) {
      const dw = doc.dans(descendante, 'DW')
      if (typeof dw === 'number') parDefaut = dw
      const w = doc.dans(descendante, 'W')
      if (Array.isArray(w)) {
        for (let k = 0; k < w.length && largeurs.size < 100_000;) {
          const premier = doc.resoudre(w[k])
          const suivant = doc.resoudre(w[k + 1])
          if (typeof premier !== 'number') break
          if (Array.isArray(suivant)) {
            suivant.forEach((l, r) => { const v = doc.resoudre(l); if (typeof v === 'number') largeurs.set(premier + r, v) })
            k += 2
          } else {
            const largeur = doc.resoudre(w[k + 2])
            if (typeof suivant !== 'number' || typeof largeur !== 'number') break
            for (let c = premier; c <= suivant && largeurs.size < 100_000; c++) largeurs.set(c, largeur)
            k += 3
          }
        }
      }
    }
    const cidDe = (code: number): number => {
      if (cmapEncodage === null) return code
      const direct = cmapEncodage.cid.get(code)
      if (direct !== undefined) return direct
      for (const p of cmapEncodage.plagesCid) if (code >= p.bas && code <= p.haut) return p.cid + (code - p.bas)
      return code
    }
    return {
      longueur: (o, i) => longueurParPlages(plages, o, i, 2),
      texte: (code) => (lisible && toUnicode !== null ? texteDuCMap(toUnicode, code) ?? '' : ''),
      largeur: (code) => largeurs.get(cidDe(code)) ?? parDefaut,
    }
  }

  // Une police simple : un octet par code.
  const table: string[] = []
  for (let c = 0; c < 256; c++) table.push(c >= 0x80 && c <= 0x9f ? WIN_ANSI_80[c - 0x80] : String.fromCharCode(c))
  const encodage = doc.dans(police, 'Encoding')
  if (estDico(encodage)) {
    const differences = doc.dans(encodage, 'Differences')
    if (Array.isArray(differences)) {
      let code = 0
      for (const d of differences) {
        const v = doc.resoudre(d)
        if (typeof v === 'number') code = v
        else if (nomDe(v) !== null && code >= 0 && code < 256) table[code++] = texteDuGlyphe(nomDe(v) as string)
      }
    }
  }
  const premier = doc.dans(police, 'FirstChar')
  const largeurs = doc.dans(police, 'Widths')
  const type3 = sousType === 'Type3'
  return {
    longueur: () => 1,
    texte: (code) => (toUnicode !== null ? texteDuCMap(toUnicode, code) : undefined) ?? table[code] ?? '',
    largeur: (code) => {
      if (type3 || !Array.isArray(largeurs) || typeof premier !== 'number') return undefined
      const v = doc.resoudre(largeurs[code - premier])
      return typeof v === 'number' ? v : undefined
    },
  }
}

function longueurParPlages(plages: PlageDeCodes[] | null, o: Uint8Array, i: number, parDefaut: number): number {
  if (plages === null) return parDefaut
  for (let n = 1; n <= 4; n++) {
    for (const p of plages) {
      if (p.octets !== n || i + n > o.length) continue
      let dedans = true
      for (let k = 0; k < n && dedans; k++) dedans = o[i + k] >= p.bas[k] && o[i + k] <= p.haut[k]
      if (dedans) return n
    }
  }
  return 1
}

// ── Le contenu d'une page : les opérateurs de texte, en fragments positionnés. ──

type Matrice = [number, number, number, number, number, number]
const IDENTITE: Matrice = [1, 0, 0, 1, 0, 0]

function produit(m: Matrice, n: Matrice): Matrice {
  return [
    m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
  ]
}

function matriceDe(v: unknown): Matrice | null {
  if (!Array.isArray(v) || v.length !== 6 || !v.every((x) => typeof x === 'number' && Number.isFinite(x))) return null
  return v as Matrice
}

interface EtatGraphique {
  ctm: Matrice
  police: Police | null
  taille: number
  espacementCaracteres: number
  espacementMots: number
  echelle: number
  interligne: number
}

const FRAGMENTS_MAX = 2_000_000

class Interprete {
  readonly fragments: FragmentDuPdf[] = []
  private formulaires = 0

  private readonly doc: FichierPdf
  constructor(doc: FichierPdf) {
    this.doc = doc
  }

  private async police(ressources: Valeur, nom: string): Promise<Police | null> {
    const dictionnaire = estDico(ressources) ? this.doc.dans(ressources, 'Font') : null
    const police = estDico(dictionnaire) ? this.doc.dans(dictionnaire, nom) : null
    if (!estDico(police)) return null
    const connue = this.doc.polices.get(police)
    if (connue !== undefined) return connue
    const lue = await lirePolice(this.doc, police)
    this.doc.polices.set(police, lue)
    return lue
  }

  async contenu(octets: Uint8Array, ressources: Valeur, ctmInitiale: Matrice, profondeur: number): Promise<void> {
    const lexeur = new Lexeur(octets, 0, octets.length, false)
    const parNom = new Map<string, Police | null>()
    const pile: EtatGraphique[] = []
    let e: EtatGraphique = { ctm: ctmInitiale, police: null, taille: 0, espacementCaracteres: 0, espacementMots: 0, echelle: 1, interligne: 0 }
    let tm: Matrice = IDENTITE
    let tlm: Matrice = IDENTITE
    const operandes: (Valeur | Mot)[] = []
    const nombre = (k: number): number => {
      const v = operandes[operandes.length - k]
      return typeof v === 'number' ? v : 0
    }
    const montrer = (elements: readonly (Valeur | Mot)[]) => {
      const police = e.police
      if (police === null) return
      let texte = ''
      let avance = 0
      let largeurConnue = true
      const debut = produit(tm, e.ctm)
      for (const el of elements) {
        if (typeof el === 'number') {
          const decalage = (-el / 1000) * e.taille * e.echelle
          if (el < -250 && texte !== '' && !texte.endsWith(' ')) texte += ' '
          avance += decalage
          continue
        }
        if (typeof el !== 'object' || el === null || Array.isArray(el) || el.t !== 'chaine') continue
        const o = el.v
        for (let i = 0; i < o.length;) {
          const n = police.longueur(o, i)
          let code = 0
          for (let k = 0; k < n && i + k < o.length; k++) code = code * 256 + o[i + k]
          texte += police.texte(code)
          const l = police.largeur(code)
          if (l === undefined) largeurConnue = false
          else avance += ((l / 1000) * e.taille + e.espacementCaracteres + (n === 1 && code === 32 ? e.espacementMots : 0)) * e.echelle
          i += n
        }
      }
      if (texte.trim() !== '' && this.fragments.length < FRAGMENTS_MAX) {
        const echelleX = Math.hypot(debut[0], debut[1])
        this.fragments.push({
          texte,
          x: debut[4],
          y: debut[5],
          largeur: largeurConnue ? avance * echelleX : undefined,
          hauteur: e.taille * Math.hypot(debut[2], debut[3]),
        })
      }
      if (largeurConnue) tm = produit([1, 0, 0, 1, avance, 0], tm)
    }
    const allerALaLigne = (tx: number, ty: number) => {
      tlm = produit([1, 0, 0, 1, tx, ty], tlm)
      tm = tlm
    }
    for (let compte = 0; ; compte++) {
      if ((compte & 0xfff) === 0) this.doc.verifierLaDuree()
      const v = lexeur.valeur()
      if (v === null) {
        if (lexeur.i >= lexeur.fin) break
        operandes.push(null)
        continue
      }
      if (typeof v !== 'object' || v === null || Array.isArray(v) || v.t !== 'mot') {
        operandes.push(v)
        if (operandes.length > 64) operandes.shift()
        continue
      }
      const op = v.v
      switch (op) {
        case 'q': pile.push({ ...e }); break
        case 'Q': e = pile.pop() ?? e; break
        case 'cm': { const m = matriceDe(operandes.slice(-6)); if (m) e.ctm = produit(m, e.ctm); break }
        case 'BT': tm = IDENTITE; tlm = IDENTITE; break
        case 'Tf': {
          const nom = nomDe(operandes[operandes.length - 2])
          e.taille = nombre(1)
          if (nom === null) e.police = null
          else if (parNom.has(nom)) e.police = parNom.get(nom) ?? null
          else { e.police = await this.police(ressources, nom); parNom.set(nom, e.police) }
          break
        }
        case 'Tc': e.espacementCaracteres = nombre(1); break
        case 'Tw': e.espacementMots = nombre(1); break
        case 'Tz': e.echelle = nombre(1) / 100; break
        case 'TL': e.interligne = nombre(1); break
        case 'Td': allerALaLigne(nombre(2), nombre(1)); break
        case 'TD': e.interligne = -nombre(1); allerALaLigne(nombre(2), nombre(1)); break
        case 'Tm': { const m = matriceDe(operandes.slice(-6)); if (m) { tm = m; tlm = m } break }
        case 'T*': allerALaLigne(0, -e.interligne); break
        case 'Tj': montrer(operandes.slice(-1)); break
        case '\'': allerALaLigne(0, -e.interligne); montrer(operandes.slice(-1)); break
        case '"': e.espacementMots = nombre(3); e.espacementCaracteres = nombre(2); allerALaLigne(0, -e.interligne); montrer(operandes.slice(-1)); break
        case 'TJ': { const t = operandes[operandes.length - 1]; if (Array.isArray(t)) montrer(t); break }
        case 'Do': await this.formulaire(nomDe(operandes[operandes.length - 1]), ressources, e.ctm, profondeur); break
        case 'BI': sauterLImage(lexeur); break
        default: break
      }
      operandes.length = 0
    }
  }

  private async formulaire(nom: string | null, ressources: Valeur, ctm: Matrice, profondeur: number): Promise<void> {
    if (nom === null || profondeur >= 4 || ++this.formulaires > 2_000) return
    const xobjets = estDico(ressources) ? this.doc.dans(ressources, 'XObject') : null
    const f = estDico(xobjets) ? this.doc.dans(xobjets, nom) : null
    if (!estFlux(f) || nomDe(this.doc.dans(f.dico, 'Subtype')) !== 'Form') return
    const octets = await this.doc.decoder(f)
    if (octets === null) return
    const propres = this.doc.dans(f.dico, 'Resources')
    const matrice = matriceDe(this.doc.dans(f.dico, 'Matrix')) ?? IDENTITE
    await this.contenu(octets, propres ?? ressources, produit(matrice, ctm), profondeur + 1)
  }
}

/** Une image en ligne (`BI … ID … EI`) : ses octets ne sont pas du contenu. */
function sauterLImage(lexeur: Lexeur): void {
  const o = lexeur.o
  const id = chercher(o, 'ID', lexeur.i, lexeur.fin)
  if (id < 0) { lexeur.i = lexeur.fin; return }
  let i = id + 3
  for (;;) {
    const ei = chercher(o, 'EI', i, lexeur.fin)
    if (ei < 0) { lexeur.i = lexeur.fin; return }
    if (ESPACE[o[ei - 1]] && (ei + 2 >= lexeur.fin || ESPACE[o[ei + 2]])) { lexeur.i = ei + 2; return }
    i = ei + 2
  }
}

/**
 * Le texte des pages d'un PDF, page après page, remis à `surLaPage` ; la lecture s'arrête quand elle rend vrai. Une page
 * dont le contenu ne se décode pas rend une page sans fragment. Ne rejette jamais.
 */
export async function lireLeTexteDUnPdf(
  octets: Uint8Array, bornes: BornesDuTexte, surLaPage: (page: PageDuPdf) => boolean,
): Promise<LectureDuTexte> {
  try {
    const entete = chercher(octets, '%PDF-', 0, Math.min(octets.length, 1029))
    if (entete < 0) return { etat: 'illisible', raison: 'pas-un-pdf' }
    const doc = new FichierPdf(octets, bornes, bornes.maintenant())
    doc.repererLeChiffrement()
    if (doc.chiffre) return { etat: 'illisible', raison: 'chiffre' }
    doc.lireLesObjets()
    doc.verifierLaDuree()
    await doc.lireLesFluxDObjets()
    const pages = doc.pages()
    if (pages.length === 0) return { etat: 'illisible', raison: 'sans-page' }
    let lues = 0
    for (const page of pages) {
      const interprete = new Interprete(doc)
      const contenus = doc.dans(page, 'Contents')
      const flux = (Array.isArray(contenus) ? contenus.map((c) => doc.resoudre(c)) : [contenus]).filter(estFlux)
      const morceaux: Uint8Array[] = []
      for (const f of flux) {
        const decode = await doc.decoder(f)
        if (decode !== null) morceaux.push(decode, Uint8Array.of(10))
      }
      const total = morceaux.reduce((s, m) => s + m.length, 0)
      const contenu = new Uint8Array(total)
      let position = 0
      for (const m of morceaux) { contenu.set(m, position); position += m.length }
      await interprete.contenu(contenu, doc.herite(page, 'Resources'), IDENTITE, 0)
      lues++
      if (surLaPage({ fragments: interprete.fragments })) return { etat: 'lu', pages: lues, arrete: true }
    }
    return { etat: 'lu', pages: lues, arrete: false }
  } catch (e) {
    return { etat: 'illisible', raison: e instanceof Borne ? 'borne' : 'erreur' }
  }
}
// ── FIN COPIE texteDUnPdf ────────────────────────────────────────────────────────────────────────────────────────────
