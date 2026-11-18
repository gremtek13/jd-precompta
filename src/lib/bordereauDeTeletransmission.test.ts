import { describe, expect, it } from 'vitest'
import {
  lignesDesFragments,
  lireBordereauxDeTeletransmission,
  montantsEnFin,
  type BordereauLu,
  type FragmentDeTexte,
  type LectureDuBordereau,
  type PageDeTexte,
} from './bordereauDeTeletransmission'
import { entierTire, tirage } from '../test/encaissementsBatterie'

// LE BORDEREAU DE TÉLÉTRANSMISSION, LU SUR DES TEXTES FICTIFS (conception 59, BOR1). La forme est celle de la page réelle que
// le cabinet a montrée le 18/11/2026 (BOR0), restée hors du dépôt ; les noms, numéros et montants sont INVENTÉS
// (« BENEFICIAIRE UN », des numéros d'assuré faits de 9, une caisse « VILLE FICTIVE »).

interface FactureFictive {
  numero: string
  prescription: string
  assure: string
  nom: string
  naissance: string
  /** Total, caisse, mutuelle, assuré, en centimes. */
  montants: [number, number, number, number]
}

/** Un montant à la française, les milliers séparés par une espace (insécable si demandé), comme Télévitale l'imprime. */
function euros(centimes: number, espace = ' '): string {
  const signe = centimes < 0 ? '-' : ''
  const abs = Math.abs(centimes)
  const entier = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, espace)
  return `${signe}${entier},${String(abs % 100).padStart(2, '0')}`
}

const FACTURES: FactureFictive[] = [
  { numero: '900000001', prescription: '01/10/2026', assure: '1999999999999 71', nom: 'BENEFICIAIRE UN', naissance: '01/01/1950', montants: [65400, 45780, 19620, 0] },
  { numero: '900000002', prescription: '02/10/2026', assure: '2999999999999 72', nom: 'BENEFICIAIRE DEUX', naissance: '02/02/1960', montants: [394610, 394610, 0, 0] },
  { numero: '900000003', prescription: '03/10/2026', assure: '1888888888888 73', nom: 'BENEFICIAIRE TROIS', naissance: '03/03/1970', montants: [12345, 8641, 2469, 1235] },
]

const ligneDeFacture = (f: FactureFictive, espace = ' ') =>
  `${f.numero} ${f.prescription} ${f.assure} ${f.nom} ${f.naissance} ${f.montants.map((m) => euros(m, espace)).join(' ')}`

const somme = (fs: FactureFictive[], c: number) => fs.reduce((s, f) => s + f.montants[c], 0)

interface Options {
  lot?: number
  factures?: FactureFictive[]
  annonce?: number
  totaux?: [number, number, number, number]
  securise?: boolean
  entete?: Partial<Record<'lot' | 'securise' | 'organisme' | 'destinataire' | 'colonnes' | 'titre', string | null>>
}

function lignesDuBordereau(o: Options = {}): string[] {
  const fs = o.factures ?? FACTURES
  const totaux = o.totaux ?? [somme(fs, 0), somme(fs, 1), somme(fs, 2), somme(fs, 3)]
  const e = o.entete ?? {}
  const choisir = (cle: keyof NonNullable<Options['entete']>, defaut: string) => (cle in e ? e[cle] : defaut)
  const lignes = [
    choisir('titre', 'Bordereau de Teletransmission'),
    'PRATICIEN FICTIF 99-9-99999/9',
    choisir('lot', `Lot : ${o.lot ?? 42} créé le 09/11/2026`),
    choisir('securise', o.securise ? 'LOT SECURISE' : 'LOT NON SECURISE'),
    choisir('organisme', 'Organisme assurance maladie destinataire : 999 - CPAM - VILLE FICTIVE'),
    choisir('destinataire', 'Destinataire du réglement : Partenaire de santé'),
    'CAISSE PRIMAIRE FICTIVE',
    '1 RUE IMAGINAIRE 99999 NULLEPART',
    choisir('colonnes', 'Facture Date prescription Numéro Assuré Nom Bénéficiaire Naissance Total Caisse Mutuelle Assuré'),
    ...fs.map((f) => ligneDeFacture(f)),
    `TOTAL: LOT de ${o.annonce ?? fs.length} Factures ${totaux.map((m) => euros(m)).join(' ')}`,
    '18/11/2026',
    '1/1',
    'Réalisé par Televitale',
  ]
  return lignes.filter((l): l is string => l !== null)
}

const page = (lignes: string[]): PageDeTexte => ({ lignes })

function lus(r: LectureDuBordereau): readonly BordereauLu[] {
  if (r.etat !== 'lu') throw new Error(`Refusé : ${r.raison}`)
  return r.bordereaux
}
function raison(r: LectureDuBordereau): string {
  if (r.etat !== 'refuse') throw new Error('Lu, quand on attendait un refus.')
  return r.raison
}

const ATTENDU: BordereauLu = {
  lot: 42,
  creeLe: '2026-11-09',
  securise: false,
  organisme: { code: '999', libelle: 'CPAM - VILLE FICTIVE' },
  nombreDeFactures: 3,
  totaux: { totalCentimes: 472355, caisseCentimes: 449031, mutuelleCentimes: 22089, assureCentimes: 1235 },
}

describe('montantsEnFin', () => {
  it('lit les montants à la française depuis la fin, milliers séparés par une espace', () => {
    expect(montantsEnFin('TOTAL: LOT de 3 Factures 5 678,90 5 432,10 246,80 0,00', 4))
      .toEqual({ tete: 'TOTAL: LOT de 3 Factures', centimes: [567890, 543210, 24680, 0] })
    expect(montantsEnFin('x 1 234 567,89 -12,00', 2)).toEqual({ tete: 'x', centimes: [123456789, -1200] })
    expect(montantsEnFin('x -1 234,00', 1)).toEqual({ tete: 'x', centimes: [-123400] })
    expect(montantsEnFin('x 5678,90', 1)).toEqual({ tete: 'x', centimes: [567890] })
  })

  it('ne rattache pas une date ni un groupe de plus de trois chiffres', () => {
    expect(montantsEnFin('01/01/1950 321,00', 1)).toEqual({ tete: '01/01/1950', centimes: [32100] })
    expect(montantsEnFin('1234 321,00', 1)).toEqual({ tete: '1234', centimes: [32100] })
  })

  it('refuse une ligne qui ne finit pas par assez de montants, ou un montant à une décimale', () => {
    expect(montantsEnFin('x 1,00 2,00 3,00', 4)).toBeNull()
    expect(montantsEnFin('x 1,0 2,00 3,00 4,00', 4)).toBeNull()
    expect(montantsEnFin('x 2,00 3,00 4,00 5', 4)).toBeNull()
  })
})

describe('un bordereau en lignes recomposées', () => {
  it('rend l’en-tête du lot et ses quatre totaux, et rien d’autre', () => {
    expect(lus(lireBordereauxDeTeletransmission([page(lignesDuBordereau())]))).toEqual([ATTENDU])
  })

  it('« LOT SECURISE », et les espaces insécables des milliers', () => {
    const lignes = lignesDuBordereau({ securise: true }).map((l) => l.replace(/(\d) (\d{3},\d{2})/g, '$1 $2'))
    expect(lignes.some((l) => l.includes(' '))).toBe(true)
    expect(lus(lireBordereauxDeTeletransmission([page(lignes)]))[0]).toEqual({ ...ATTENDU, securise: true })
  })

  it('les accents et la casse de l’en-tête ne comptent pas', () => {
    const lignes = lignesDuBordereau({
      entete: { titre: 'BORDEREAU DE TÉLÉTRANSMISSION', lot: 'LOT : 42 CREE LE 09/11/2026', destinataire: 'Destinataire du règlement : PARTENAIRE DE SANTE' },
    })
    expect(lus(lireBordereauxDeTeletransmission([page(lignes)]))).toEqual([ATTENDU])
  })

  it('le pied d’une seule ligne (date, page, éditeur) est ignoré', () => {
    const lignes = lignesDuBordereau()
    const pied = lignes.splice(-3, 3)
    lignes.push(pied.join(' '))
    expect(lus(lireBordereauxDeTeletransmission([page(lignes)]))).toEqual([ATTENDU])
  })
})

describe('le refus de ce qui n’est pas sûr', () => {
  const refuse = (o: Options) => raison(lireBordereauxDeTeletransmission([page(lignesDuBordereau(o))]))

  it('le titre absent', () => {
    expect(refuse({ entete: { titre: null } })).toMatch(/titre « Bordereau de Teletransmission »/)
    expect(raison(lireBordereauxDeTeletransmission([]))).toMatch(/titre .* est absent/)
  })

  it('le lot, sa date ou l’organisme illisibles, ou absents', () => {
    expect(refuse({ entete: { lot: 'Lot : 42 créé le 31/02/2026' } })).toMatch(/numéro du lot ou sa date de création ne se lit pas/)
    expect(refuse({ entete: { lot: 'Lot : XLII créé le 09/11/2026' } })).toMatch(/numéro du lot/)
    expect(refuse({ entete: { lot: null } })).toMatch(/numéro du lot et sa date de création sont absents/)
    expect(refuse({ entete: { organisme: 'Organisme assurance maladie destinataire : CPAM' } })).toMatch(/organisme destinataire ne se lit pas/)
    expect(refuse({ entete: { organisme: 'Organisme assurance maladie destinataire : 999 - <script>' } })).toMatch(/organisme destinataire ne se lit pas/)
    expect(refuse({ entete: { organisme: null } })).toMatch(/organisme destinataire est absent/)
    expect(refuse({ entete: { securise: null } })).toMatch(/lot sécurisé.*absente/)
  })

  it('le destinataire du règlement : tout libellé accepté, jamais rendu ; la ligne absente, un refus (BOR1-Q2 (B))', () => {
    for (const libelle of ['Assuré', 'MME BENEFICIAIRE QUATRE', 'Partenaire de santé et assuré', '', '12345 ; <script>']) {
      const r = lireBordereauxDeTeletransmission([page(lignesDuBordereau({ entete: { destinataire: `Destinataire du réglement : ${libelle}` } }))])
      expect(lus(r)).toEqual([ATTENDU])
      if (libelle.length >= 3) expect(JSON.stringify(r)).not.toContain(libelle)
    }
    expect(refuse({ entete: { destinataire: null } })).toMatch(/destinataire du règlement est absent/)
  })

  it('le contrôle « total = caisse + mutuelle + assuré » reste sur chaque ligne (BOR1-Q3 (A))', () => {
    const fausse: FactureFictive = { ...FACTURES[2], montants: [12345, 8641, 2469, 1234] }
    const lignes = lignesDuBordereau({ factures: [FACTURES[0], fausse], totaux: [65400 + 12345, 45780 + 8641, 19620 + 2469, 1234] })
    expect(raison(lireBordereauxDeTeletransmission([page(lignes)]))).toMatch(/ligne de facture n° 2, le total n’est pas la somme/)
  })

  it('l’en-tête des colonnes non reconnu', () => {
    expect(refuse({ entete: { colonnes: 'Facture Date Numéro Nom Total' } })).toMatch(/sans l’en-tête des colonnes/)
    expect(refuse({ entete: { colonnes: null } })).toMatch(/sans l’en-tête des colonnes/)
  })

  it('le total absent', () => {
    const lignes = lignesDuBordereau().filter((l) => !l.startsWith('TOTAL'))
    expect(raison(lireBordereauxDeTeletransmission([page(lignes)]))).toMatch(/ligne de total .* est absente/)
  })

  it('le nombre de lignes différent du nombre annoncé', () => {
    expect(refuse({ annonce: 4 })).toMatch(/3 ligne\(s\) de facture lue\(s\), quand le total en annonce 4/)
  })

  it('une colonne dont la somme ne tombe pas', () => {
    const [t, c, m, a] = [somme(FACTURES, 0), somme(FACTURES, 1), somme(FACTURES, 2), somme(FACTURES, 3)]
    expect(refuse({ totaux: [t + 1, c + 1, m, a] })).toMatch(/colonne « Total » diffère du total imprimé/)
    expect(refuse({ totaux: [t, c - 1, m + 1, a] })).toMatch(/colonne « Caisse » diffère/)
  })

  it('un total différent de caisse + mutuelle + assuré, sur la ligne de total ou sur une ligne', () => {
    const [t, c, m, a] = [somme(FACTURES, 0), somme(FACTURES, 1), somme(FACTURES, 2), somme(FACTURES, 3)]
    expect(refuse({ totaux: [t, c, m, a + 1] })).toMatch(/total du lot n’est pas la somme/)
    const fausse: FactureFictive = { ...FACTURES[0], montants: [65400, 45780, 19600, 0] }
    expect(refuse({ factures: [fausse] })).toMatch(/ligne de facture n° 1, le total n’est pas la somme/)
  })

  it('une ligne du tableau non reconnue, ou une facture sans ses quatre montants', () => {
    const lignes = lignesDuBordereau()
    lignes.splice(10, 0, 'SUITE DU NOM')
    expect(raison(lireBordereauxDeTeletransmission([page(lignes)]))).toMatch(/non reconnue après la ligne de facture n° 1/)
    const coupee = lignesDuBordereau()
    coupee[9] = coupee[9].replace(/ \S+$/, '')
    expect(raison(lireBordereauxDeTeletransmission([page(coupee)]))).toMatch(/ligne de facture n° 1 ne finit pas par quatre montants/)
  })

  it('une ligne après le total, du texte avant le titre', () => {
    expect(raison(lireBordereauxDeTeletransmission([page([...lignesDuBordereau(), 'SIGNATURE'])]))).toMatch(/inattendue après la ligne de total/)
    expect(raison(lireBordereauxDeTeletransmission([page(['ENTÊTE ÉTRANGER', ...lignesDuBordereau()])]))).toMatch(/avant le titre/)
  })

  it('aucune raison ne cite une valeur d’une ligne de facture', () => {
    const cas: Options[] = [{ annonce: 4 }, { totaux: [1, 1, 0, 0] }, { factures: [{ ...FACTURES[0], montants: [65400, 45780, 19600, 0] }] }]
    for (const o of cas) {
      const r = refuse(o)
      for (const f of FACTURES) {
        for (const valeur of [f.numero, f.prescription, f.assure, f.nom, f.naissance, ...f.montants.map((m) => euros(m))]) {
          expect(r).not.toContain(valeur)
        }
      }
    }
  })
})

describe('plusieurs bordereaux, plusieurs pages', () => {
  it('deux bordereaux dans un fichier : un lot par bordereau, chacun contrôlé par son total', () => {
    const r = lireBordereauxDeTeletransmission([
      page(lignesDuBordereau()),
      page(lignesDuBordereau({ lot: 43, factures: [FACTURES[1]] })),
    ])
    expect(lus(r).map((b) => [b.lot, b.nombreDeFactures, b.totaux.totalCentimes])).toEqual([[42, 3, 472355], [43, 1, 394610]])
  })

  it('deux bordereaux sur la même page se lisent aussi', () => {
    const r = lireBordereauxDeTeletransmission([page([...lignesDuBordereau(), ...lignesDuBordereau({ lot: 43 })])])
    expect(lus(r).map((b) => b.lot)).toEqual([42, 43])
  })

  it('le même lot deux fois, ou un second bordereau faux, refusent le fichier entier', () => {
    expect(raison(lireBordereauxDeTeletransmission([page(lignesDuBordereau()), page(lignesDuBordereau())]))).toMatch(/bordereau 2 : le même lot figure deux fois/)
    expect(raison(lireBordereauxDeTeletransmission([page(lignesDuBordereau()), page(lignesDuBordereau({ lot: 43, annonce: 9 }))])))
      .toMatch(/^bordereau 2 : /)
  })

  it('un bordereau sur deux pages, le total en dernière page, l’en-tête repris ou non', () => {
    const entiere = lignesDuBordereau()
    const indiceTotal = entiere.findIndex((l) => l.startsWith('TOTAL'))
    const avant = entiere.slice(0, indiceTotal - 1)
    const fin = entiere.slice(indiceTotal - 1)
    const premiere = [...avant, '18/11/2026', '1/2', 'Réalisé par Televitale']
    const reprise = [...entiere.slice(0, 9), ...fin]
    expect(lus(lireBordereauxDeTeletransmission([page(premiere), page(reprise)]))).toEqual([ATTENDU])
    const sansEntete = [entiere[8], ...fin]
    expect(lus(lireBordereauxDeTeletransmission([page(premiere), page(sansEntete)]))).toEqual([ATTENDU])
    expect(lus(lireBordereauxDeTeletransmission([page(premiere), page(fin)]))).toEqual([ATTENDU])
  })

  it('une page qui suit sous un autre lot, avant le total, est un refus', () => {
    const entiere = lignesDuBordereau()
    const indiceTotal = entiere.findIndex((l) => l.startsWith('TOTAL'))
    const premiere = entiere.slice(0, indiceTotal - 1)
    const autreLot = [...lignesDuBordereau({ lot: 43 }).slice(0, 9), ...entiere.slice(indiceTotal - 1)]
    expect(raison(lireBordereauxDeTeletransmission([page(premiere), page(autreLot)]))).toMatch(/numéro du lot .* deux valeurs différentes/)
  })

  it('un titre au milieu d’une page, avant le total, est un refus', () => {
    const lignes = lignesDuBordereau()
    lignes.splice(10, 0, 'Bordereau de Teletransmission')
    expect(raison(lireBordereauxDeTeletransmission([page(lignes)]))).toMatch(/un titre au milieu du bordereau/)
  })
})

// Les fragments, tels que pdf.js les rend : une cellule par fragment, à son abscisse, dans un ordre qui n'est pas celui de la
// lecture ; l'ordonnée croît vers le haut.
function fragmentsDe(lignes: string[], melange: () => number): FragmentDeTexte[] {
  const fragments: FragmentDeTexte[] = []
  lignes.forEach((ligne, rang) => {
    const y = 800 - rang * 14 + (melange() - 0.5) * 2 // un léger désalignement, sous la tolérance
    let x = 40
    for (const mot of ligne.split(' ')) {
      fragments.push({ texte: mot, x, y, largeur: mot.length * 5, hauteur: 9 })
      x += mot.length * 5 + 3
    }
  })
  for (let i = fragments.length - 1; i > 0; i--) {
    const j = entierTire(melange, i + 1)
    ;[fragments[i], fragments[j]] = [fragments[j], fragments[i]]
  }
  return fragments
}

describe('un bordereau en fragments positionnés', () => {
  it('lignesDesFragments regroupe par ordonnée, du haut vers le bas, puis par abscisse', () => {
    expect(lignesDesFragments([
      { texte: 'B', x: 50, y: 700 }, { texte: 'A', x: 10, y: 700.8 }, { texte: 'haut', x: 10, y: 780 },
      { texte: 'Télé', x: 10, y: 600, largeur: 20 }, { texte: 'vitale', x: 30, y: 600, largeur: 25 }, { texte: ' ', x: 99, y: 500 },
    ])).toEqual(['haut', 'A B', 'Télévitale'])
  })

  it('cinquante bordereaux tirés d’une graine fixe, fragments mélangés : la même lecture qu’en lignes', () => {
    const t = tirage(20261118)
    for (let essai = 0; essai < 50; essai++) {
      const nombre = 1 + entierTire(t, 12)
      const factures: FactureFictive[] = Array.from({ length: nombre }, (_, k) => {
        const caisse = entierTire(t, 500000)
        const mutuelle = entierTire(t, 30000)
        const assure = entierTire(t, 3) === 0 ? entierTire(t, 5000) : 0
        return {
          numero: String(900000100 + k), prescription: '05/10/2026', assure: `1${String(k).padStart(12, '9')} 70`,
          nom: `BENEFICIAIRE NUMERO ${k}`, naissance: '04/04/1944', montants: [caisse + mutuelle + assure, caisse, mutuelle, assure],
        }
      })
      const lignes = lignesDuBordereau({ lot: 100 + essai, factures })
      const enLignes = lireBordereauxDeTeletransmission([page(lignes)])
      const enFragments = lireBordereauxDeTeletransmission([{ fragments: fragmentsDe(lignes, t) }])
      expect(lus(enFragments)).toEqual(lus(enLignes))
      expect(lus(enLignes)[0].nombreDeFactures).toBe(nombre)
    }
  })
})

describe('le canari : aucune chaîne d’une ligne de facture dans le résultat', () => {
  it('sérialisé, le résultat ne contient ni numéro, ni date, ni numéro d’assuré, ni nom, ni montant imprimé d’une ligne', () => {
    const resultat = JSON.stringify(lireBordereauxDeTeletransmission([page(lignesDuBordereau())]))
    expect(resultat).toContain('"lot":42')
    for (const f of FACTURES) {
      const morceaux = [f.nom, f.assure, ...ligneDeFacture(f).split(' ').filter((m) => m.length >= 3)]
      for (const morceau of morceaux) expect(resultat).not.toContain(morceau)
    }
    // Les seules clés : celles de l'en-tête et des totaux.
    expect(Object.keys(lus(JSON.parse(resultat) as LectureDuBordereau)[0]).sort())
      .toEqual(['creeLe', 'lot', 'nombreDeFactures', 'organisme', 'securise', 'totaux'])
  })
})
