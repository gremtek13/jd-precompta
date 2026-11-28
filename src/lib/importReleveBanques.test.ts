// L'IMPORT D'UN RELEVÉ PAR FICHIER, ÉPROUVÉ CONTRE LA FORME DES EXPORTS RÉELS DES BANQUES FRANÇAISES (28/11/2026, MVP « le
// relevé importé par fichier »). Chaque jeu d'essai de `relevesDesBanques/` est FICTIF — noms, comptes, montants —, écrit
// d'après la forme publique de l'export : séparateur, encodage, préambule, en-tête, signe, nombres, dates, libellés sur
// plusieurs lignes, lignes de solde. Les fichiers sont en UTF-8 dans le dépôt ; le test les remet dans l'encodage de la
// banque avant de les lire par la MÊME chaîne que l'écran (`ImportCsv` de `BanqueTab.tsx`) : `decoderReleve`, le format au
// contenu, `parseCsv`, `detectColumnMapping`, `lignesDeDonnees`, les refus dits avant le clic, `interpreterReleve`,
// `controlerSolde`, `partagerParMultiplicite`.
//
// Sources de la forme des exports :
//   [GESTAN]  wiki de Gestan, « CYBERBANQUE : Intégration fichiers bancaires » —
//             https://wiki.gestan.fr/doku.php?id=wiki:extensv15:cyberbanque (Banque Populaire, Caisse d'Épargne 2014, 2020
//             et 2024, Crédit Agricole 2011 et 2020, Crédit Lyonnais, Crédit Mutuel, La Banque Postale, Société Générale).
//   [OF]      OpenFlyers, « Modèles de format d'import de relevé bancaire » —
//             https://doc4-fr.openflyers.com/Modèles-de-format-d'import-de-relevé-bancaire, une page par banque (BNP
//             particulier et professionnel, Banque Populaire professionnel, Banque Postale, Caisse d'Épargne, CIC, Crédit
//             Agricole, Crédit Mutuel, Société Générale, Boursorama), et « Exporter un relevé bancaire depuis un site
//             internet de banque » (les réglages de l'export : séparateur, décimale, format de la date).
//   [COZY]    connecteur Boursorama de Cozy Cloud, `lib.js` — https://orandin.github.io/cozy-konnector-bank-boursorama/lib.js.html
//             (l'en-tête « dateOp;dateVal;label;… »).
//   [APPLE]   pièce jointe d'un forum de développeurs, un export « Date;Nature de l'opération;Débit;Crédit;Devise;Date de
//             valeur;Libellé interbancaire » — https://developer.apple.com/forums/content/attachment/3eb6bf2d-89f1-4b48-a36b-796ab583b5e5
//   [QONTO]   aide de Qonto, « What do the fields of the 'full Export (CSV format)' mean? » —
//             https://help.qonto.com/en/articles/4359527 (les champs « Settlement date (UTC) », « Total amount (incl.
//             VAT) ») ; le format de date « DD-MM-YYYY HH:mm:ss » relevé par
//             https://dev.classmethod.jp/articles/retrieve-qontos-transactions-via-api/
//   [BOURSO]  aide de BoursoBank, « Comment et sous quels formats puis-je exporter mes mouvements… » —
//             https://www.boursobank.com/aide-en-ligne/banque/releves-et-documents-bancaires/question/comment-et-sous-quels-formats-puis-je-exporter-mes-mouvements-de-compte-et-de-carte-bancaire-26780
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { colonneDeLaDateDeValeur, detectColumnMapping, estUnSoldeCourant, lignesDeDonnees, parseCsv, parseMontantBancaire, refusDeLaDevise } from './csv'
import {
  AUCUNE_DECISION, douteDuSens, interpreterReleve, partagerParMultiplicite, phraseDesEcartees, refusDesLignesATrancher,
  refusDesTableauxSuivants, refusDuReglage, type MouvementSigne, type ReglageDeLImport,
} from './importReleve'
import { decoderReleve, lireReleveOfxQif } from './releveOfxQif'
import { controlerSolde, phraseDesSoldes } from './soldeReleve'

// Les octets d'un jeu d'essai dans l'encodage de sa banque.
type Encodage = 'windows-1252' | 'iso-8859-15' | 'utf-8' | 'utf-8-bom'
function octets(nom: string, encodage: Encodage): Uint8Array {
  const texte = readFileSync(new URL(`./relevesDesBanques/${nom}`, import.meta.url), 'utf8')
  if (encodage === 'utf-8') return new TextEncoder().encode(texte)
  if (encodage === 'utf-8-bom') return new TextEncoder().encode(`﻿${texte}`)
  // Un caractère sur un octet ; l'euro est 0x80 en windows-1252, 0xA4 en ISO-8859-15 (la norme ISO/IEC 8859-15, tableau du
  // jeu de caractères). Aucun jeu d'essai ne porte un caractère que les deux encodages n'ont pas.
  return Uint8Array.from([...texte].map((c) => {
    if (c === '€') return encodage === 'windows-1252' ? 0x80 : 0xa4
    const code = c.charCodeAt(0)
    if (code > 0xff) throw new Error(`« ${c} » ne s’écrit pas en ${encodage}`)
    return code
  }))
}

// La chaîne de l'écran, de l'octet au relevé interprété, avec le relevé déjà en base (`existantes`).
function commeLEcran(o: Uint8Array, existantes: readonly MouvementSigne[] = []) {
  const { texte, encodage } = decoderReleve(o)
  expect(lireReleveOfxQif(texte)).toBeNull()
  const rows = parseCsv(texte)
  const d = detectColumnMapping(rows)
  const { donnees, retirees } = lignesDeDonnees(rows, d.hasHeader, d.ligneEnTete)
  const reglage: ReglageDeLImport = {
    colDate: d.colDate, colLibelle: d.colLibelle, hasHeader: d.hasHeader, format: d.format, colMontant: d.colMontant,
    colDebit: d.colDebit, colCredit: d.colCredit, colSolde: d.colSolde, colDateValeur: colonneDeLaDateDeValeur(rows),
  }
  const releve = interpreterReleve(donnees, reglage, AUCUNE_DECISION)
  const refus = refusDesTableauxSuivants(donnees) ?? refusDeLaDevise(rows, donnees) ?? refusDuReglage(reglage)
    ?? refusDesLignesATrancher(releve.aTrancher)
  const { nouvelles, dejaPresentes } = partagerParMultiplicite(releve.operations, existantes)
  return {
    encodage, rows, detection: d, donnees, retirees, reglage, releve, refus, nouvelles, dejaPresentes,
    controle: controlerSolde(releve.soldes, releve.operations), doute: douteDuSens(reglage, releve.operations),
  }
}
const lus = (r: ReturnType<typeof commeLEcran>) => r.releve.operations.map((o) => [o.date, o.montant])

describe('Crédit Agricole [GESTAN « nouveau format 2020 », OF « Crédit Agricole avec point-virgule »]', () => {
  it('format 2020 : préambule, Débit positif, libellés sur plusieurs lignes, milliers en espace insécable, ISO-8859-15', () => {
    const r = commeLEcran(octets('credit-agricole-2020.csv', 'iso-8859-15'))
    expect(r.encodage).toBe('windows-1252')
    expect(r.refus).toBeNull()
    expect(r.detection).toMatchObject({ format: 'debit_credit', colDate: 0, colLibelle: 1, colDebit: 2, colCredit: 3, ligneEnTete: 6, doute: null })
    expect(lus(r)).toEqual([
      ['2026-11-28', 1234.56], ['2026-11-27', -1050], ['2026-11-25', -12.5], ['2026-11-25', -12.5], ['2026-11-03', 86.4],
    ])
    // Le libellé garde ses lignes : le FEC les remet sur une seule (`champFec`), le dédoublonnage les compare telles quelles.
    expect(r.releve.operations[1].libelle).toMatch(/^PRELEVEMENT\s+URSSAF FICTIVE COTISATIONS 11\/2026\s+REF 0000000000$/)
    // Le pied de page (le titulaire, le porteur, la carte, l'encours) : du texte seul, compté, jamais une opération.
    expect(r.releve.ecartees).toEqual([{ raison: 'texte seul', nombre: 4 }])
    expect(phraseDesEcartees(r.releve.ecartees)).toBe('4 ignorée(s) (4 texte seul)')
    // Le solde du préambule n'est pas une ligne du relevé : aucun contrôle, et l'écran le dit.
    expect(r.controle).toBeNull()
    expect(phraseDesSoldes(r.releve.soldes.length)).toMatch(/^Aucune ligne de solde reconnue/)
  })

  it('les deux paiements identiques du même jour s’importent tous deux ; redéposé, rien ne s’importe deux fois', () => {
    const premier = commeLEcran(octets('credit-agricole-2020.csv', 'iso-8859-15'))
    expect(premier.nouvelles).toHaveLength(5)
    const enBase = premier.nouvelles.slice(0, 3) // l'un des deux paiements à la pharmacie seulement
    const second = commeLEcran(octets('credit-agricole-2020.csv', 'iso-8859-15'), enBase)
    expect(second.dejaPresentes).toBe(3)
    expect(second.nouvelles.map((o) => o.montant)).toEqual([-12.5, 86.4])
    expect(commeLEcran(octets('credit-agricole-2020.csv', 'iso-8859-15'), premier.nouvelles).nouvelles).toEqual([])
  })

  it('corrigé : un débit qui s’arrête après son montant n’est plus pris pour un solde quand les crédits sont les plus nombreux', () => {
    // [OF] exemple 1 : « …";45,60; » au débit, « …";;76,00; » au crédit. Quatre crédits, deux débits : la largeur habituelle
    // est celle d'un crédit, et chaque débit, plus court d'une cellule vide, entrait comme une « ligne de solde ».
    const r = commeLEcran(octets('credit-agricole-date-valeur.csv', 'windows-1252'))
    expect(r.detection).toMatchObject({ format: 'debit_credit', colDebit: 3, colCredit: 4, colLibelle: 2, ligneEnTete: 5 })
    expect(r.reglage.colDateValeur).toBe(1)
    expect(lus(r)).toEqual([
      ['2026-11-04', 45], ['2026-11-06', -29.99], ['2026-11-10', 312.8], ['2026-11-18', 60], ['2026-11-24', -118.4], ['2026-11-27', 90],
    ])
    expect(r.releve.soldes).toEqual([])
    expect(r.releve.operations[4].dateValeur).toBe('2026-11-25')
  })

  it('corrigé : un fichier qui porte deux comptes, chacun sous son en-tête, se refuse', () => {
    // [GESTAN] « Les fichiers du CA peuvent concerner plusieurs comptes à la fois » : lues à la suite, les opérations du livret
    // entraient au relevé du compte courant.
    const r = commeLEcran(octets('credit-agricole-deux-comptes.csv', 'windows-1252'))
    expect(r.refus).toMatch(/^Le fichier porte un second tableau, sous son propre en-tête \(« Date ; Libellé ; Débit euros ; Crédit euros »\)/)
    expect(r.refus).toMatch(/Exporte un compte à la fois\.$/)
  })

  it('un symbole euro d’ISO-8859-15 DANS une cellule de montant se lit « ¤ » et la ligne s’écarte, comptée', () => {
    // Le décodeur ne connaît que l'UTF-8 et windows-1252 ; 0xA4 y est « ¤ ». Du côté fermé : illisible, jamais deviné.
    const ligne = new TextDecoder('utf-8').decode(Uint8Array.from([0x31, 0x32, 0x2c, 0x35, 0x30, 0x20])) + '¤'
    expect(parseMontantBancaire(ligne)).toBeNull()
  })
})

describe('Société Générale [OF « Société Générale avec point-virgule », GESTAN, APPLE]', () => {
  it('forme 2020 : tout entre guillemets, Débit négatif, la suite du libellé sur des lignes sans date', () => {
    const r = commeLEcran(octets('societe-generale-2020.csv', 'windows-1252'))
    expect(r.refus).toBeNull()
    expect(r.detection).toMatchObject({ format: 'debit_credit', colDate: 0, colDebit: 2, colCredit: 3, colLibelle: 1, ligneEnTete: 5 })
    expect(r.reglage.colDateValeur).toBe(5)
    expect(lus(r)).toEqual([['2026-11-27', 1234.56], ['2026-11-20', -98], ['2026-11-05', -12.5]])
    // « DE: CPAM FICTIVE », « MOTIF: … » : du texte seul, qui ne se rattache pas à l'opération (le nom d'un patient y
    // entrerait) et ne se compte plus « date illisible ».
    expect(r.releve.ecartees).toEqual([{ raison: 'texte seul', nombre: 3 }])
  })

  it('forme sans guillemets : la suite du libellé sur une ligne qui commence par le séparateur, ou coupée en deux', () => {
    const r = commeLEcran(octets('societe-generale-sans-guillemets.csv', 'windows-1252'))
    expect(r.refus).toBeNull()
    expect(lus(r)).toEqual([['2026-11-04', -6], ['2026-11-15', -131], ['2026-11-28', 3440.48]])
    expect(r.releve.ecartees).toEqual([{ raison: 'texte seul', nombre: 5 }])
    expect(r.releve.soldes).toEqual([])
  })

  it('corrigé : la colonne « Devise » d’un compte tenu en dollars refuse l’import', () => {
    const r = commeLEcran(octets('societe-generale-dollars.csv', 'utf-8'))
    expect(r.refus).toBe('La colonne 5 dit une autre monnaie que l’euro (« USD ») : le relevé d’un compte tenu en une autre devise '
      + 'ne s’importe pas, ses montants entreraient comme des euros.')
  })
})

describe('La Banque Postale [OF « Banque Postale avec point-virgule », GESTAN]', () => {
  it('au point-virgule : préambule, « Montant(EUROS) » lu, « Montant(FRANCS) » jamais', () => {
    const r = commeLEcran(octets('la-banque-postale.csv', 'windows-1252'))
    expect(r.detection).toMatchObject({ format: 'signe', colDate: 0, colMontant: 2, colLibelle: 1, ligneEnTete: 6 })
    expect(lus(r)).toEqual([['2026-11-27', 312.8], ['2026-11-20', -98], ['2026-11-05', -12.5]])
    expect(r.releve.operations[0].libelle).toBe('VIREMENT DE CPAM FICTIVE                  REF 0000000000')
    expect(r.releve.ecartees).toEqual([])
    // Le solde du préambule est celui du jour de l'export : il ne contrôle rien.
    expect(r.controle).toBeNull()
  })

  it('à tabulations', () => {
    const r = commeLEcran(octets('la-banque-postale-tabulations.csv', 'windows-1252'))
    expect(r.detection).toMatchObject({ format: 'signe', colMontant: 2, ligneEnTete: 6 })
    expect(lus(r)).toEqual([['2026-11-06', -200], ['2026-11-04', -69.62], ['2026-11-03', 287.86]])
  })
})

describe('BNP Paribas et Hello bank! [OF « BNP particulier avec point-virgule », « Exporter un relevé… »]', () => {
  it('sans en-tête : la première ligne (le compte, son solde au point décimal) retirée, le point décimal lu', () => {
    const r = commeLEcran(octets('bnp-paribas.csv', 'windows-1252'))
    expect(r.detection).toMatchObject({ format: 'signe', colDate: 0, colMontant: 4, colLibelle: 3, hasHeader: true, ligneEnTete: null })
    expect(r.retirees).toEqual([['Compte à Vue', 'CABINET FICTIF', '****0000', '30/11/2026', '', '9 025.61']])
    expect(lus(r)).toEqual([['2026-11-28', 312.8], ['2026-11-20', -98], ['2026-11-05', -260.15], ['2026-11-05', -12.5]])
    expect(r.releve.ecartees).toEqual([])
    expect(r.doute).toBeNull()
  })
})

describe('LCL [GESTAN « Crédit Lyonnais », le relevé réel de `soldeReleve.test.ts`]', () => {
  it('à tabulations, sans en-tête, « 150,0 », les deux soldes plus courts : le contrôle tourne et tombe juste', () => {
    const r = commeLEcran(octets('lcl.csv', 'windows-1252'))
    expect(r.detection).toMatchObject({ format: 'signe', colDate: 0, colMontant: 1, colLibelle: 4, hasHeader: false })
    expect(lus(r)).toEqual([
      ['2026-11-05', 150], ['2026-11-07', -191.17], ['2026-11-12', -12.5], ['2026-11-12', -12.5], ['2026-11-20', 312.8],
    ])
    expect(r.releve.soldes).toEqual([{ date: '2026-11-01', montant: 2104.4 }, { date: '2026-11-30', montant: 2351.03 }])
    expect(r.controle).toMatchObject({ soldeInitial: 2104.4, soldeFinal: 2351.03, coherent: true })
  })

  it('le dédoublonnage par multiplicité : un passage à la pharmacie déjà en base, l’autre s’importe', () => {
    const enBase = [{ date: '2026-11-12', libelle: 'CB PHARMACIE FICT 11/11', montant: -12.5 }]
    const r = commeLEcran(octets('lcl.csv', 'windows-1252'), enBase)
    expect(r.dejaPresentes).toBe(1)
    expect(r.nouvelles).toHaveLength(4)
  })
})

describe('CIC et Crédit Mutuel [OF « CIC avec virgule », « Crédit Mutuel avec point-virgule », GESTAN]', () => {
  it('CIC « une seule colonne » : virgule séparatrice, point décimal, un libellé entre guillemets qui porte une virgule', () => {
    const r = commeLEcran(octets('cic-virgule.csv', 'windows-1252'))
    expect(r.detection).toMatchObject({ format: 'signe', colDate: 0, colMontant: 2, colLibelle: 3, colSolde: 4, ligneEnTete: 0 })
    expect(lus(r)).toEqual([['2026-11-04', 1584], ['2026-11-05', -4], ['2026-11-06', 50]])
    expect(r.releve.operations[1].libelle).toBe('PRLV FICTIF, FRAIS DE TENUE')
    // IMPORT-Q1, à trancher : la colonne du solde courant suit l'arithmétique du relevé, mais n'alimente aucun contrôle.
    expect(estUnSoldeCourant(r.donnees, 4, (row) => parseMontantBancaire(row[2]))).toBe(true)
    expect(r.controle).toBeNull()
  })

  it('Crédit Mutuel en UTF-8 avec sa marque d’ordre : Débit négatif, « -1 053,57 », la colonne Solde jamais un montant', () => {
    const r = commeLEcran(octets('credit-mutuel.csv', 'utf-8-bom'))
    expect(r.encodage).toBe('utf-8')
    expect(r.detection).toMatchObject({ format: 'debit_credit', colDate: 0, colDebit: 2, colCredit: 3, colLibelle: 4, colSolde: 5, ligneEnTete: 0 })
    expect(lus(r)).toEqual([['2026-11-02', 344], ['2026-11-03', -10.84], ['2026-11-05', -1053.57], ['2026-11-06', 23]])
    expect(estUnSoldeCourant(r.donnees, 5, (row) => { const v = row[2] || row[3]; return parseMontantBancaire(v) })).toBe(true)
  })
})

describe('Caisse d’Épargne et Banque Populaire [GESTAN, OF « CE avec virgule », « Banque Populaire professionnel »]', () => {
  it('Caisse d’Épargne 2020 : « +312,8 », et les deux soldes sans date — l’un avant l’en-tête, l’autre en dernière ligne', () => {
    const r = commeLEcran(octets('caisse-epargne-2020.csv', 'windows-1252'))
    expect(r.refus).toBeNull()
    expect(r.detection).toMatchObject({ format: 'debit_credit', colDate: 0, colDebit: 3, colCredit: 4, colLibelle: 2, ligneEnTete: 3 })
    expect(lus(r)).toEqual([['2026-11-30', 312.8], ['2026-11-25', -98], ['2026-11-12', -12.5], ['2026-11-05', 43.4]])
    // BANQ-Q2, à trancher : le solde de fin est dans le préambule, celui de début n'a pas de date. Rien ne les date sans
    // lire le préambule (« Date de début de téléchargement : 01/11/2026 ») ; aucun contrôle, et le solde de début se dit
    // comme tel parmi les lignes écartées.
    expect(r.releve.ecartees).toEqual([{ raison: 'solde sans date', nombre: 1 }])
    expect(r.controle).toBeNull()
  })

  it('corrigé : Caisse d’Épargne 2024, la date de comptabilisation date le mouvement, pas celle de l’achat par carte', () => {
    const r = commeLEcran(octets('caisse-epargne-2024.csv', 'windows-1252'))
    expect(r.detection).toMatchObject({ format: 'debit_credit', colDate: 0, colDebit: 8, colCredit: 9, colLibelle: 2 })
    expect(r.reglage.colDateValeur).toBe(11)
    // L'achat du 31/12/2026, passé au compte le 02/01/2027 : un mouvement de 2027, comme au relevé imprimé et à son solde.
    expect(lus(r)).toEqual([['2027-01-02', -12.5], ['2026-12-30', 312.8], ['2026-12-28', -98]])
  })

  it('corrigé : Banque Populaire, la date de comptabilisation avant la date d’opération, un point-virgule final', () => {
    const r = commeLEcran(octets('banque-populaire.csv', 'windows-1252'))
    expect(r.detection).toMatchObject({ format: 'signe', colDate: 1, colMontant: 6, colLibelle: 3, ligneEnTete: 0 })
    expect(lus(r)).toEqual([['2026-12-02', -81.4], ['2026-11-28', 245], ['2026-11-20', -600]])
    expect(r.releve.soldes).toEqual([])
  })
})

describe('BoursoBank [COZY, BOURSO, OF « Boursorama avec guillemet »]', () => {
  it('l’export CSV : en-tête anglais reconnu, année sur deux chiffres, le solde du compte jamais un montant', () => {
    const r = commeLEcran(octets('boursobank.csv', 'utf-8'))
    expect(r.detection).toMatchObject({ format: 'signe', colDate: 0, colMontant: 6, colLibelle: 2, colSolde: 9, ligneEnTete: 0 })
    expect(r.reglage.colDateValeur).toBe(1)
    expect(lus(r)).toEqual([['2026-11-28', 312.8], ['2026-11-20', -98], ['2026-11-05', -12.5]])
    // Le même solde sur chaque ligne : celui du compte au jour de l'export, pas un solde courant.
    expect(estUnSoldeCourant(r.donnees, 9, (row) => parseMontantBancaire(row[6]))).toBe(false)
  })

  it('l’ancien export à tabulations : guillemets, une espace avant la date, « +00000001000,00 », la devise « EUR  »', () => {
    const r = commeLEcran(octets('boursorama-tabulations.csv', 'windows-1252'))
    expect(r.refus).toBeNull()
    expect(r.detection).toMatchObject({ format: 'signe', colDate: 0, colMontant: 3, colLibelle: 2, ligneEnTete: 2 })
    expect(lus(r)).toEqual([['2026-11-03', 1000], ['2026-11-05', -2222.06], ['2026-11-06', -11.72]])
  })
})

describe('Qonto [QONTO]', () => {
  it('« JJ-MM-AAAA HH:MM:SS » en temps universel ne se lit pas : rien ne s’importe, chaque ligne comptée (BANQ-Q3)', () => {
    // Le jour d'une date universelle n'est pas toujours celui de Paris (le 30/11 à 23 h 30 UTC est le 1er décembre) : la
    // lire comme une date civile changerait de mois une opération de fin de mois. Du côté fermé, en attendant le cabinet.
    const r = commeLEcran(octets('qonto.csv', 'utf-8'))
    expect(r.releve.operations).toEqual([])
    expect(r.releve.ecartees).toEqual([{ raison: 'date illisible', nombre: 2 }])
  })
})
