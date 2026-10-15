import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CHAMPS_D_UNE_LIGNE, LIGNES_PAR_IMPORT_MAX, refusImportContacts } from './contactsImport'
import {
  CHAMPS_DANS_L_ORDRE, LIBELLES_DES_CHAMPS, SEPARATEURS, TAILLE_FICHIER_IMPORT_MAX,
  apercuDeLImport, choisirPourLaColonne, colonnesProposees, decoderLeFichier, decouperLeFichier, etatDeLaCorrespondance,
  lignesAImporter, nomCompare, refusDeLaTaille, separateurPropose, tableauDuFichier, typePropose, typesProposes, valeursDuType,
  type ChoixDeColonne, type CorrespondanceDuFichier, type EnregistrementDuFichier, type TableauDuFichier,
} from './contactsImportFichier'
import { LIBELLES_TYPE_CONTACT } from './contactsVue'
import { motsDuCabinet } from './espaceVentes'
import { contact } from '../test/contacts'

// LE FICHIER D'UN IMPORT DE CLIENTS (espace client, étape A4b3b) : la borne, l'encodage et ses marques, le caractère nul, le
// séparateur proposé, les guillemets et les retours à la ligne d'une cellule, l'en-tête, la correspondance des colonnes, le type
// par colonne ou unique, les lignes telles qu'elles partent, l'aperçu contre les refus du module de l'import. Données FICTIVES.

const utf8 = (t: string) => new TextEncoder().encode(t)
const avec = (marque: number[], corps: Uint8Array) => new Uint8Array([...marque, ...corps])
function utf16(t: string, ordre: 'le' | 'be'): Uint8Array {
  const octets = new Uint8Array(t.length * 2)
  for (let i = 0; i < t.length; i++) {
    const u = t.charCodeAt(i)
    octets[2 * i + (ordre === 'le' ? 0 : 1)] = u & 0xff
    octets[2 * i + (ordre === 'le' ? 1 : 0)] = u >> 8
  }
  return octets
}
const lu = (octets: Uint8Array) => {
  const r = decoderLeFichier(octets, 'cabinet')
  if ('refus' in r) throw new Error(r.refus)
  return r
}
const decoupe = (texte: string, sep: ';' | ',' | '\t' = ';') => {
  const r = decouperLeFichier(texte, sep, 'cabinet')
  if ('refus' in r) throw new Error(r.refus)
  return r
}
const cellules = (texte: string, sep: ';' | ',' | '\t' = ';') => decoupe(texte, sep).enregistrements.map((e) => e.cellules)

describe('la borne du fichier', () => {
  it('dix mébioctets : à la borne, rien ; un octet de plus, le refus dit le poids à l’octet face à la borne', () => {
    expect(TAILLE_FICHIER_IMPORT_MAX).toBe(10 * 1024 * 1024)
    expect(refusDeLaTaille(TAILLE_FICHIER_IMPORT_MAX, 'cabinet')).toBeNull()
    const refus = refusDeLaTaille(TAILLE_FICHIER_IMPORT_MAX + 1, 'cabinet') as string
    expect(refus.replace(/[\u00a0\u202f]/g, ' ')).toMatch(/^Ce fichier pèse 10 485 761 octets, au-delà des 10 485 760 octets/)
    expect(refusDeLaTaille(12 * 1024 * 1024, 'client')?.replace(/[\u00a0\u202f]/g, ' ')).toMatch(/^Ce fichier pèse 12 Mo, au-delà des 10 Mo .*Vérifie que c’est le bon fichier/)
  })
})

describe('l’encodage', () => {
  const texte = 'Nom;Adresse\nÉcole fictive;Rue de l’Été\n'

  it('une marque d’ordre UTF-8 décide, et ne fait pas partie du texte', () => {
    expect(lu(avec([0xef, 0xbb, 0xbf], utf8(texte)))).toEqual({ texte, encodage: 'utf-8-marque' })
  })

  it('UTF-16, petit- et gros-boutiste, par leur marque', () => {
    expect(lu(avec([0xff, 0xfe], utf16(texte, 'le')))).toEqual({ texte, encodage: 'utf-16le' })
    expect(lu(avec([0xfe, 0xff], utf16(texte, 'be')))).toEqual({ texte, encodage: 'utf-16be' })
  })

  it('une seconde marque reste dans le texte (seule la première est la marque du fichier)', () => {
    expect(lu(avec([0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf], utf8('A'))).texte).toBe(String.fromCharCode(0xfeff) + 'A')
  })

  it('sans marque : l’UTF-8 strict, sinon windows-1252', () => {
    expect(lu(utf8(texte))).toEqual({ texte, encodage: 'utf-8' })
    // « É » et « é » en windows-1252 : C9 et E9, des octets que l'UTF-8 strict refuse.
    const cp1252 = new Uint8Array([0x4e, 0x6f, 0x6d, 0x0a, 0xc9, 0x74, 0xe9])
    expect(lu(cp1252)).toEqual({ texte: 'Nom\nÉté', encodage: 'windows-1252' })
    // windows-1252 n'est pas latin-1 : 0x80 est l'euro.
    expect(lu(new Uint8Array([0x80])).texte).toBe('€')
  })

  it('une marque démentie par les octets refuse le fichier, au lieu de le lire de travers', () => {
    const r = decoderLeFichier(avec([0xef, 0xbb, 0xbf], new Uint8Array([0xc9, 0x74])), 'cabinet')
    expect(r).toEqual({ refus: expect.stringMatching(/^Ce fichier s’annonce en UTF-8 par sa marque d’ordre, mais ses octets n’en sont pas/) })
    // Un nombre impair d'octets après la marque d'UTF-16.
    const impair = decoderLeFichier(new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0x42]), 'client')
    expect(impair).toEqual({ refus: expect.stringMatching(/^Ce fichier s’annonce en UTF-16 \(petit-boutiste\).*Enregistre-le de nouveau en CSV UTF-8/) })
  })

  it('UTF-16 sans marque : ses caractères nuls refusent le fichier, en français, avec la cause probable et la ligne', () => {
    const r = decoderLeFichier(utf16('Nom\nA', 'le'), 'cabinet')
    expect(r).toEqual({
      refus: 'Ce fichier porte un caractère nul (U+0000) à la ligne 1 : il a sans doute été enregistré en UTF-16 sans marque '
        + 'd’ordre, ou ce n’est pas un fichier texte. Le réenregistrer en CSV UTF-8 depuis le tableur, puis le reprendre.',
    })
  })

  it('un caractère nul plus loin : sa ligne physique (CRLF, LF et CR seul comptent une fois chacun)', () => {
    const r = decoderLeFichier(utf8('a\r\nb\nc\rd\u0000'), 'client') as { refus: string }
    expect(r.refus).toMatch(/^Ce fichier porte un caractère nul \(U\+0000\) à la ligne 4 : .*Enregistre-le de nouveau en CSV UTF-8 depuis ton tableur/)
  })

  it('un caractère nul derrière une marque d’UTF-16 se refuse aussi', () => {
    expect(decoderLeFichier(avec([0xff, 0xfe], utf16('A\u0000', 'le')), 'cabinet')).toHaveProperty('refus')
  })
})

describe('le séparateur proposé', () => {
  it('celui que la première ligne porte le plus, hors guillemets', () => {
    expect(separateurPropose('Nom;Adresse;SIREN\n')).toBe(';')
    expect(separateurPropose('Nom,Adresse,SIREN\n')).toBe(',')
    expect(separateurPropose('Nom\tAdresse\tSIREN\n')).toBe('\t')
    // Une virgule d'adresse entre guillemets ne compte pas, ni ce qui suit la première ligne.
    expect(separateurPropose('"Nom, raison sociale";Adresse\na,b,c,d,e\n')).toBe(';')
    expect(separateurPropose('Nom,"Adresse; bâtiment",SIREN\n')).toBe(',')
  })

  it('une première ligne entre guillemets qui porte un retour à la ligne : la ligne continue après lui', () => {
    expect(separateurPropose('"Nom\nsuite",A,B;C\n')).toBe(',')
  })

  it('à égalité : le point-virgule, puis la tabulation, puis la virgule ; sans aucun : le point-virgule', () => {
    expect(SEPARATEURS).toEqual([';', '\t', ','])
    expect(separateurPropose('a;b,c\n')).toBe(';')
    expect(separateurPropose('a\tb,c\n')).toBe('\t')
    expect(separateurPropose('Nom\n')).toBe(';')
    expect(separateurPropose('')).toBe(';')
  })

  it('un CR seul finit aussi la première ligne', () => {
    expect(separateurPropose('a;b\rc,d,e,f')).toBe(';')
  })
})

describe('le découpage', () => {
  it('CRLF, LF et CR ; la dernière ligne sans retour', () => {
    expect(cellules('a;b\r\nc;d\ne;f\rg;h')).toEqual([['a', 'b'], ['c', 'd'], ['e', 'f'], ['g', 'h']])
  })

  it('les guillemets : le séparateur, un guillemet doublé et un retour à la ligne dans une cellule', () => {
    expect(cellules('"a;b";"il dit ""oui""";"ligne 1\r\nligne 2"\nz;y;x')).toEqual([
      ['a;b', 'il dit "oui"', 'ligne 1\r\nligne 2'], ['z', 'y', 'x'],
    ])
  })

  it('chaque ligne de clients dit la ligne PHYSIQUE où elle commence, retours dans les cellules comptés', () => {
    const r = decoupe('Nom;Adresse\n"A";"1\n2\r\n3"\n\nB;C\r\n')
    expect(r.enregistrements.map((e) => e.ligne)).toEqual([1, 2, 6])
    expect(r.vides).toBe(1)
  })

  it('une ligne blanche, ou faite de séparateurs et de blancs, ne fait pas un client : elle est comptée', () => {
    const r = decoupe('a;b\n\n ; \n;;\nc;d\n\n')
    expect(r.enregistrements.map((e) => e.cellules)).toEqual([['a', 'b'], ['c', 'd']])
    expect(r.vides).toBe(4)
  })

  it('un guillemet jamais fermé refuse le fichier, la ligne où il s’ouvre nommée', () => {
    expect(decouperLeFichier('a;b\nc;"d\ne;f\n', ';', 'cabinet')).toEqual({
      refus: 'Un guillemet ouvert à la ligne 2 du fichier n’est jamais fermé : le reste du fichier se lirait comme une seule '
        + 'cellule. Vérifier le fichier, ou choisir un autre séparateur.',
    })
    expect(decouperLeFichier('"a', ';', 'client')).toEqual({ refus: expect.stringMatching(/Vérifie le fichier, ou choisis un autre séparateur\.$/) })
  })

  it('un guillemet au milieu d’une cellule en reste un caractère ; après une cellule entre guillemets, la suite s’y ajoute', () => {
    expect(cellules('Rue du 3"e;b\n"x"y;z')).toEqual([['Rue du 3"e', 'b'], ['xy', 'z']])
  })

  it('le séparateur choisi seul découpe : une virgule reste dans la cellule d’un fichier à points-virgules, et la tabulation', () => {
    expect(cellules('a,b;c')).toEqual([['a,b', 'c']])
    expect(cellules('a,b;c', ',')).toEqual([['a', 'b;c']])
    expect(cellules('a\tb;c', '\t')).toEqual([['a', 'b;c']])
  })

  it('une cellule vide entre guillemets en fin de fichier fait une ligne ; un fichier vide n’en fait aucune', () => {
    expect(decoupe('a;""').enregistrements).toEqual([{ ligne: 1, cellules: ['a', ''] }])
    expect(decoupe('')).toEqual({ enregistrements: [], vides: 0 })
    expect(decoupe('a;\n')).toEqual({ enregistrements: [{ ligne: 1, cellules: ['a', ''] }], vides: 0 })
  })
})

describe('l’en-tête et les colonnes', () => {
  const lignes: EnregistrementDuFichier[] = [
    { ligne: 1, cellules: [' Nom ', '', 'SIREN'] },
    { ligne: 2, cellules: ['A', 'b', 'c', 'd'] },
    { ligne: 3, cellules: ['E'] },
  ]

  it('avec en-tête : la première ligne nomme les colonnes (blancs des bords retirés) et n’est pas un client', () => {
    expect(tableauDuFichier(lignes, true)).toEqual({ colonnes: ['Nom', 'Colonne 2', 'SIREN', 'Colonne 4'], lignes: lignes.slice(1) })
  })

  it('sans en-tête : « Colonne N », toutes les lignes sont des clients', () => {
    expect(tableauDuFichier(lignes, false)).toEqual({ colonnes: ['Colonne 1', 'Colonne 2', 'Colonne 3', 'Colonne 4'], lignes })
  })

  it('aucune ligne : aucune colonne', () => {
    expect(tableauDuFichier([], true)).toEqual({ colonnes: [], lignes: [] })
  })
})

describe('la correspondance des colonnes', () => {
  it('les dix champs d’une ligne, ni plus ni moins, dans l’ordre de la saisie, sous ses libellés', () => {
    expect([...CHAMPS_DANS_L_ORDRE].sort()).toEqual([...CHAMPS_D_UNE_LIGNE].sort())
    const saisie = readFileSync(new URL('../pages/dossier/ContactSaisieModal.tsx', import.meta.url), 'utf8')
    for (const libelle of ['Type', 'SIREN', 'SIRET', 'Adresse de facturation électronique', 'Code service', 'E-mail']) {
      expect(saisie, libelle).toContain(`>${libelle}</label>`)
    }
    expect(LIBELLES_DES_CHAMPS.delai_paiement_jours).toBe('Délai de paiement (jours)')
  })

  it('un nom comparé sans casse, accents ni ponctuation', () => {
    expect(nomCompare('  E-Mail ')).toBe('email')
    expect(nomCompare('DÉLAI de paiement')).toBe('delaidepaiement')
    expect(nomCompare('Adresse de facturation électronique')).toBe(nomCompare('ADRESSE DE FACTURATION ELECTRONIQUE'))
  })

  it('la proposition : les libellés de l’application seulement ; un champ une fois, à la première colonne', () => {
    expect(colonnesProposees([
      'nom', 'TYPE', 'adresse', 'Siren', 'siret', 'Adresse de facturation electronique', 'code-service', 'Email', 'Délai', 'observations',
    ])).toEqual(CHAMPS_DANS_L_ORDRE)
    expect(colonnesProposees(['Nom ou raison sociale', 'Délai de paiement', 'Délai de paiement (jours)'])).toEqual(['nom', 'delai_paiement_jours', null])
    // Aucun nom d'un autre logiciel n'est supposé (A4B3-Q6).
    expect(colonnesProposees(['Raison sociale', 'Code postal', 'Ville', 'Téléphone', 'Courriel', 'N° SIRET', 'Nom', 'nom'])).toEqual([
      null, null, null, null, null, null, 'nom', null,
    ])
  })

  it('choisir un champ pour une colonne le retire à celle qui l’avait ; « Ne pas importer » et « à choisir » se répètent', () => {
    const choix: ChoixDeColonne[] = ['nom', 'adresse', null, 'ne_pas_importer']
    expect(choisirPourLaColonne(choix, 2, 'nom')).toEqual([null, 'adresse', 'nom', 'ne_pas_importer'])
    expect(choisirPourLaColonne(choix, 0, 'ne_pas_importer')).toEqual(['ne_pas_importer', 'adresse', null, 'ne_pas_importer'])
    expect(choisirPourLaColonne(choix, 1, null)).toEqual(['nom', null, null, 'ne_pas_importer'])
  })

  it('l’état : les colonnes à choisir, le type à choisir sans colonne pour lui, les colonnes non importées', () => {
    const colonnes = ['A', 'B', 'C', 'D']
    expect(etatDeLaCorrespondance(colonnes, { choix: ['nom', null, 'ne_pas_importer', null], valeursDuType: {}, typeUnique: null })).toEqual({
      aChoisir: ['B', 'D'], typeAChoisir: true, nonImportees: ['C'], colonneDuType: null,
    })
    expect(etatDeLaCorrespondance(colonnes, { choix: ['nom', 'adresse', 'ne_pas_importer', 'ne_pas_importer'], valeursDuType: {}, typeUnique: 'assujetti' }))
      .toEqual({ aChoisir: [], typeAChoisir: false, nonImportees: ['C', 'D'], colonneDuType: null })
    expect(etatDeLaCorrespondance(colonnes, { choix: ['nom', 'adresse', 'type_client', 'siren'], valeursDuType: {}, typeUnique: null }))
      .toEqual({ aChoisir: [], typeAChoisir: false, nonImportees: [], colonneDuType: 2 })
  })
})

describe('le type d’un client', () => {
  it('proposé d’après les libellés de la facture ou la valeur que la base range ; sinon non reconnu', () => {
    for (const t of ['assujetti', 'organisme_public', 'non_assujetti', 'etranger'] as const) {
      expect(typePropose(t)).toBe(t)
      expect(typePropose(` ${LIBELLES_TYPE_CONTACT[t].toUpperCase()} `)).toBe(t)
    }
    expect(typePropose('Organisme public')).toBe('organisme_public')
    expect(typePropose('Particulier')).toBeNull()
    expect(typePropose('')).toBeNull()
    expect(typesProposes(['assujetti', 'Pro'])).toEqual({ assujetti: 'assujetti', Pro: null })
  })

  it('les valeurs distinctes de la colonne, blancs des bords retirés, vide comprise, dans l’ordre où elles paraissent', () => {
    const lignes: EnregistrementDuFichier[] = [
      { ligne: 2, cellules: ['A', ' Pro '] }, { ligne: 3, cellules: ['B', ''] }, { ligne: 4, cellules: ['C', 'Pro'] }, { ligne: 5, cellules: ['D'] },
    ]
    expect(valeursDuType(lignes, 1)).toEqual(['Pro', ''])
  })
})

describe('les lignes telles qu’elles partent', () => {
  const tableau: TableauDuFichier = {
    colonnes: ['Nom', 'Type', 'Adresse', 'SIREN', 'SIRET', 'E-mail', 'Délai', 'Notes', 'Fax'],
    lignes: [
      { ligne: 2, cellules: ['  Société Essai ', 'Pro', ' 1 rue du Neuf ', '123 456 782', '123 456 782 00010', '', '30', '', '01'] },
      { ligne: 3, cellules: ['Client étranger fictif', 'Étranger', 'Rue étrangère', '123456782', '', 'a@exemple.fr', '30 jours', 'x'] },
      { ligne: 5, cellules: ['Inconnu', 'Autre', 'Rue'] },
    ],
  }
  const correspondance: CorrespondanceDuFichier = {
    choix: ['nom', 'type_client', 'adresse', 'siren', 'siret', 'email', 'delai_paiement_jours', 'observations', 'ne_pas_importer'],
    valeursDuType: { Pro: 'assujetti', 'Étranger': 'etranger', Autre: null },
    typeUnique: null,
  }

  it('les formes de la saisie à la main : blancs des bords, ceux d’un identifiant, vide nul, délai en nombre — rien de plus', () => {
    const [premiere] = lignesAImporter(tableau, correspondance)
    expect(premiere).toEqual({
      numero: 1, ligneDuFichier: 2, typeNonReconnu: null,
      envoyee: {
        nom: 'Société Essai', type_client: 'assujetti', adresse: '1 rue du Neuf', siren: '123456782', siret: '12345678200010',
        adresse_electronique: null, code_service: null, email: null, delai_paiement_jours: 30, observations: null,
      },
    })
    // Les clés sont celles d'une ligne de l'import, ni plus ni moins : « Fax », non importée, ne part pas.
    expect(Object.keys(premiere.envoyee).sort()).toEqual([...CHAMPS_D_UNE_LIGNE].sort())
  })

  it('un champ que le type n’ouvre pas n’est PAS écarté (le SIREN d’un client établi hors de France) ; un délai en mots part tel quel', () => {
    const [, seconde] = lignesAImporter(tableau, correspondance)
    expect(seconde.envoyee).toMatchObject({ type_client: 'etranger', siren: '123456782', siret: null, delai_paiement_jours: '30 jours', observations: 'x' })
  })

  it('une valeur non reconnue de la colonne du type : type nul, la valeur dite ; une valeur sans correspondance non plus', () => {
    const lignes = lignesAImporter(tableau, correspondance)
    expect(lignes[2]).toMatchObject({ numero: 3, ligneDuFichier: 5, typeNonReconnu: 'Autre', envoyee: { type_client: null, siren: null } })
    // Une valeur qui n'est pas une clé PROPRE de la correspondance (« constructor ») n'a pas de type.
    const piege: TableauDuFichier = { colonnes: ['Nom', 'Type'], lignes: [{ ligne: 1, cellules: ['A', 'constructor'] }] }
    expect(lignesAImporter(piege, { choix: ['nom', 'type_client'], valeursDuType: {}, typeUnique: null })[0])
      .toMatchObject({ typeNonReconnu: 'constructor', envoyee: { type_client: null } })
  })

  it('sans colonne pour le type : le type unique, sur chaque ligne', () => {
    const t: TableauDuFichier = { colonnes: ['Nom'], lignes: [{ ligne: 1, cellules: ['A'] }, { ligne: 2, cellules: ['B'] }] }
    const lignes = lignesAImporter(t, { choix: ['nom'], valeursDuType: {}, typeUnique: 'non_assujetti' })
    expect(lignes.map((l) => [l.envoyee.nom, l.envoyee.type_client, l.envoyee.adresse, l.typeNonReconnu])).toEqual([
      ['A', 'non_assujetti', '', null], ['B', 'non_assujetti', '', null],
    ])
  })

  it('une colonne pour l’adresse électronique et le code service : leurs formes, le type de la ligne gardé', () => {
    const t: TableauDuFichier = {
      colonnes: ['Nom', 'AE', 'CS'], lignes: [{ ligne: 1, cellules: ['Commune', ' 100000207 ', ' SERVICE '] }],
    }
    const [l] = lignesAImporter(t, { choix: ['nom', 'adresse_electronique', 'code_service'], valeursDuType: {}, typeUnique: 'non_assujetti' })
    expect(l.envoyee).toMatchObject({ type_client: 'non_assujetti', adresse_electronique: '100000207', code_service: 'SERVICE' })
  })
})

describe('l’aperçu', () => {
  const D = 'd1'
  const pris = contact({ id: 'c1', nom: 'Déjà rangé', siren: '123456782', siret: '12345678200010' })
  const ligne = (numero: number, o: Partial<{ nom: string; siren: string | null; siret: string | null; type: 'assujetti' | 'etranger' | null; adresse: string }>) => ({
    numero, ligneDuFichier: numero + 1, typeNonReconnu: null,
    envoyee: {
      nom: o.nom ?? `Client ${numero}`, type_client: o.type === undefined ? 'assujetti' as const : o.type, adresse: o.adresse ?? 'Rue', siren: o.siren ?? null,
      siret: o.siret ?? null, adresse_electronique: null, code_service: null, email: null, delai_paiement_jours: null, observations: null,
    },
  })

  it('sans refus : chaque ligne prête, et c’est ce que la base rangerait (`refusImportContacts`)', () => {
    const lignes = [ligne(1, {}), ligne(2, { siren: '987654324' })]
    const apercu = apercuDeLImport(D, null, lignes, [pris])
    expect(apercu).toEqual({ refusDuFichier: null, lignes: lignes.map((l) => ({ ligne: l, refus: null })), refusees: 0 })
    expect(refusImportContacts(D, null, lignes.map((l) => l.envoyee), [pris])).toBeNull()
  })

  it('les refus du module, ligne par ligne, « Ligne N : » ; le premier est celui de l’import', () => {
    const lignes = [
      ligne(1, { siren: '123456782', siret: '12345678200010' }),
      ligne(2, { adresse: '' }),
      ligne(3, { type: 'etranger', siren: '123456782' }),
      ligne(4, {}),
    ]
    const apercu = apercuDeLImport(D, null, lignes, [pris])
    expect(apercu.refusees).toBe(3)
    expect(apercu.lignes.map((l) => l.refus?.message ?? null)).toEqual([
      'Ligne 1 : Le SIRET « 12345678200010 » est déjà celui du contact « Déjà rangé » : un établissement ne se range qu\'une fois par dossier.',
      "Ligne 2 : L'adresse du contact est à renseigner.",
      "Ligne 3 : Un client établi hors de France n'a ni SIREN ni SIRET.",
      null,
    ])
    expect(apercu.lignes[0].refus).toEqual(refusImportContacts(D, null, lignes.map((l) => l.envoyee), [pris]))
  })

  it('un SIRET répété dans le fichier : la seconde ligne refusée, la première nommée', () => {
    const lignes = [ligne(1, { nom: 'Premier', siren: '123456782', siret: '12345678200010' }), ligne(2, { siren: '123456782', siret: '12345678200010' })]
    const apercu = apercuDeLImport(D, null, lignes, [])
    expect(apercu.lignes[1].refus?.message).toMatch(/^Ligne 2 : Le SIRET « 12345678200010 » est déjà celui du contact « Premier »/)
  })

  it('aucune ligne, ou plus de mille : le refus du module avant tout, aucune ligne jugée', () => {
    expect(apercuDeLImport(D, null, [], [])).toEqual({
      refusDuFichier: { cle: 'vide', ligne: null, code: '22023', message: "L'import ne porte aucune ligne." }, lignes: [], refusees: 0,
    })
    const trop = Array.from({ length: LIGNES_PAR_IMPORT_MAX + 1 }, (_, i) => ligne(i + 1, {}))
    const apercu = apercuDeLImport(D, null, trop, [])
    expect(apercu.refusDuFichier?.message).toBe('Un import range mille lignes au plus ; celui-ci en porte 1001 : le partager en plusieurs fichiers.')
    expect(apercu.lignes).toEqual([])
    const juste = Array.from({ length: LIGNES_PAR_IMPORT_MAX }, (_, i) => ligne(i + 1, {}))
    expect(apercuDeLImport(D, null, juste, []).refusDuFichier).toBeNull()
  })

  it('un dossier de soins : un particulier sans SIREN, refusé sous les mots de la base', () => {
    const lignes = [{ ...ligne(1, {}), envoyee: { ...ligne(1, {}).envoyee, type_client: 'non_assujetti' as const } }]
    expect(apercuDeLImport(D, 'cgi_261_4_1', lignes, []).lignes[0].refus?.message).toMatch(/^Ligne 1 : Un dossier qui dispense des soins exonérés/)
  })
})

describe('les mots de chaque espace', () => {
  it('le client est tutoyé, sans un mot du cabinet ; le cabinet n’est pas tutoyé', () => {
    const client = [
      refusDeLaTaille(TAILLE_FICHIER_IMPORT_MAX + 1, 'client'),
      (decoderLeFichier(utf16('A', 'le'), 'client') as { refus: string }).refus,
      (decoderLeFichier(new Uint8Array([0xef, 0xbb, 0xbf, 0xc9]), 'client') as { refus: string }).refus,
      (decouperLeFichier('"a', ';', 'client') as { refus: string }).refus,
    ] as string[]
    for (const t of client) expect(motsDuCabinet(t), t).toEqual([])
    const cabinet = [
      refusDeLaTaille(TAILLE_FICHIER_IMPORT_MAX + 1, 'cabinet'),
      (decoderLeFichier(utf16('A', 'le'), 'cabinet') as { refus: string }).refus,
      (decouperLeFichier('"a', ';', 'cabinet') as { refus: string }).refus,
    ] as string[]
    for (const t of cabinet) expect(t, t).not.toMatch(/\b(ton|ta|tes|toi)\b|Vérifie |choisis |Enregistre-le|reprends-le|partage-le/)
  })
})
