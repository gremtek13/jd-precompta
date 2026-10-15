import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TYPES_CLIENT_CONTACT, saisieQuiPart, type ContactEnvoye } from './contacts'
import { champDeLaFiche, ficheDuContactCsv, nomFichierDeLaFiche, nomSimplifiePourUnFichier } from './contactsExport'
import {
  CHAMPS_DANS_L_ORDRE, apercuDeLImport, colonnesProposees, decoderLeFichier, decouperLeFichier, etatDeLaCorrespondance,
  lignesAImporter, separateurPropose, tableauDuFichier, typesProposes, valeursDuType,
} from './contactsImportFichier'
import { LIBELLES_TYPE_CONTACT, saisieInitialeContact } from './contactsVue'
import type { Contact, TypeClient } from './types'
import { contact } from '../test/contacts'

// LA FICHE D'UN CLIENT, EN UN FICHIER (espace client, étape A4b3c). Ce que ces cas gardent :
//  1. le fichier : la marque UTF-8, le « ; », CRLF, l'en-tête aux libellés de l'import, une seule ligne de fiche, les guillemets ;
//  2. l'ALLER-RETOUR, la preuve centrale : la fiche passée par l'import (décodage, découpage, colonnes proposées, lignes) rend
//     exactement ce que la saisie à la main enverrait pour ce contact — pour chacun des quatre types, chaque champ rempli à sa
//     borne, des valeurs qui portent « ; », « " », des retours à la ligne et des accents ; et l'aperçu de l'import n'y refuse rien ;
//  3. le nom du fichier : accents, ponctuation, nom vide, borne de quarante caractères.
// Données FICTIVES (SIREN 123456782 et 100000207, leurs établissements : src/test/contacts.ts).

const ENTETE_ATTENDU = 'Nom ou raison sociale;Type;Adresse;SIREN;SIRET;Adresse de facturation électronique;Code service;E-mail;'
  + 'Délai de paiement (jours);Observations'

describe('le fichier d’une fiche', () => {
  const c = contact({ nom: 'Société Essai', adresse: '3 rue des Essais', email: 'contact@societe-essai.example', delai_paiement_jours: 30 })
  const csv = ficheDuContactCsv(c)

  it('une marque d’ordre UTF-8 en tête (trois octets une fois écrit) : le tableur français lit les accents', () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect([...new TextEncoder().encode(csv).subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    // Une seule marque : l'import n'en retire qu'une.
    expect(csv.charCodeAt(1)).not.toBe(0xfeff)
  })

  it('deux lignes séparées par CRLF — l’en-tête aux libellés de l’import, puis la fiche — sans retour final ni LF seul', () => {
    expect(csv.slice(1).split('\r\n')).toEqual([
      ENTETE_ATTENDU,
      'Société Essai;une entreprise établie en France;3 rue des Essais;123456782;12345678200010;;;contact@societe-essai.example;30;',
    ])
    expect(csv.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
    expect(csv.endsWith('\r\n')).toBe(false)
  })

  it('l’en-tête est celui de l’import, dans l’ordre de la saisie : dix colonnes, aucune de plus', () => {
    expect(CHAMPS_DANS_L_ORDRE).toHaveLength(10)
    expect(csv.slice(1).split('\r\n')[0]).toBe(ENTETE_ATTENDU)
  })

  it('une copie fidèle : le délai en chiffres (zéro compris), le type sous le libellé du formulaire de la facture, rien d’arrondi', () => {
    const zero = ficheDuContactCsv(contact({ delai_paiement_jours: 0, type_client: 'etranger', siren: null, siret: null })).split('\r\n')[1]
    expect(zero.split(';').slice(1, 2)).toEqual([LIBELLES_TYPE_CONTACT.etranger])
    expect(zero.split(';')[8]).toBe('0')
    // Un champ non rempli est une cellule vide, pas un tiret ni un mot.
    const vide = ficheDuContactCsv(contact({ delai_paiement_jours: null, siren: null, siret: null })).split('\r\n')[1].split(';')
    expect(vide.slice(3)).toEqual(['', '', '', '', '', '', ''])
  })

  it('une valeur qui porte « ; », un guillemet, CR ou LF se met entre guillemets, les guillemets doublés, ses retours GARDÉS', () => {
    expect(champDeLaFiche('abc')).toBe('abc')
    expect(champDeLaFiche('')).toBe('')
    expect(champDeLaFiche('a;b')).toBe('"a;b"')
    expect(champDeLaFiche('il dit "oui"')).toBe('"il dit ""oui"""')
    expect(champDeLaFiche('a\nb')).toBe('"a\nb"')
    expect(champDeLaFiche('a\rb')).toBe('"a\rb"')
    expect(champDeLaFiche('a\r\nb')).toBe('"a\r\nb"')
    // Ni la virgule ni la tabulation n'en demandent (le séparateur est celui de l'en-tête) ; les blancs des bords restent : la
    // fiche ne « nettoie » rien.
    expect(champDeLaFiche('3, rue\tFictive')).toBe('3, rue\tFictive')
    expect(champDeLaFiche(' a ')).toBe(' a ')
  })

  it('les retours à la ligne d’un champ restent des retours à la ligne du fichier, pas des espaces (champCsv les aplatirait)', () => {
    const f = ficheDuContactCsv(contact({ observations: 'ligne 1\r\nligne 2\nligne 3' }))
    expect(f).toContain('"ligne 1\r\nligne 2\nligne 3"')
    const source = readFileSync(new URL('./contactsExport.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/from '\.\/pisteAudit'/)
  })
})

// ── L'aller-retour ───────────────────────────────────────────────────────────────────────────────────────────────────────
// La fiche passée par l'import tel que l'écran l'enchaîne : octets → texte (la marque lue) → séparateur proposé → cellules →
// colonnes (l'en-tête ôté) → champs PROPOSÉS (aucun « à choisir ») → valeurs du type → lignes telles qu'elles partiraient.
function allerRetour(c: Contact) {
  const octets = new TextEncoder().encode(ficheDuContactCsv(c))
  const decode = decoderLeFichier(octets, 'cabinet')
  if ('refus' in decode) throw new Error(decode.refus)
  expect(decode.encodage).toBe('utf-8-marque')
  expect(separateurPropose(decode.texte)).toBe(';')
  const decoupe = decouperLeFichier(decode.texte, ';', 'cabinet')
  if ('refus' in decoupe) throw new Error(decoupe.refus)
  expect(decoupe.vides).toBe(0)
  const tableau = tableauDuFichier(decoupe.enregistrements, true)
  expect(tableau.lignes).toHaveLength(1)
  const choix = colonnesProposees(tableau.colonnes)
  // Chaque colonne proposée, aucune « à choisir », chacune pour son champ.
  expect(choix).toEqual(CHAMPS_DANS_L_ORDRE)
  const correspondance = {
    choix, valeursDuType: typesProposes(valeursDuType(tableau.lignes, choix.indexOf('type_client'))), typeUnique: null,
  }
  expect(etatDeLaCorrespondance(tableau.colonnes, correspondance)).toEqual({
    aChoisir: [], typeAChoisir: false, nonImportees: [], colonneDuType: 1,
  })
  return { tableau, lignes: lignesAImporter(tableau, correspondance) }
}

// Ce qu'une saisie à la main enverrait de CE contact, et le contact lui-même : deux références, que le module d'export ne produit pas.
const cequeLaSaisieEnverrait = (c: Contact): ContactEnvoye => saisieQuiPart(saisieInitialeContact(c))
const ceQueLeContactDit = (c: Contact): ContactEnvoye => ({
  nom: c.nom, type_client: c.type_client, adresse: c.adresse as string, siren: c.siren, siret: c.siret,
  adresse_electronique: c.adresse_electronique, code_service: c.code_service, email: c.email,
  delai_paiement_jours: c.delai_paiement_jours, observations: c.observations,
})

// Un contact tel que la base le rangerait : la saisie REMPLIE de chaque champ passe par `saisieQuiPart`, qui laisse nul ce que le
// type n'ouvre pas — un SIREN pour un client établi hors de France, le code service d'une entreprise, etc. Les valeurs sont à
// leur borne (nom 200, adresse 1 000, observations 1 000, e-mail 254, code service 100, délai 60) et portent ce qu'un CSV a de
// plus traître : « ; », guillemets, CR, LF, CRLF, accents, ligature, caractère hors du plan de base.
function rempli(type: TypeClient): Contact {
  const motif = 'Café « Œuf »; "Frères" & Cie — 3, rue de l’Été\r\nbât. B\n\rZ'
  // Exactement `longueur` CARACTÈRES (points de code : la base compte ainsi), sans blanc au bord que la saisie retirerait.
  const exactement = (texte: string, longueur: number) => {
    let t = ''
    while (Array.from(t).length < longueur) t += texte
    const coupe = Array.from(t).slice(0, longueur).join('').trimEnd()
    return coupe + 'x'.repeat(longueur - Array.from(coupe).length)
  }
  const nom = exactement(`Nom "à;bord" ${motif} `, 200)
  const adresse = exactement('Adresse; "fictive"\n3, rue de l’Été\r\nBât. B\r', 1000)
  const observations = exactement('Observations 😀 « fidèles »; "à garder"\r\n\r\nligne\nvide ci-dessus\r', 1000)
  const email = `${'l'.repeat(64)}@${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(61)}`
  expect(email).toHaveLength(254)
  const envoye = saisieQuiPart({
    nom, typeClient: type, adresse, siren: '123456782', siret: '12345678200010',
    adresseElectronique: `123456782_12345678200010_${'x'.repeat(100)}`, codeService: 'S'.repeat(100), email, delai: '60', observations,
  })
  return contact({
    id: `c-${type}`, nom: envoye.nom, type_client: envoye.type_client, adresse: envoye.adresse, siren: envoye.siren, siret: envoye.siret,
    adresse_electronique: envoye.adresse_electronique, code_service: envoye.code_service, email: envoye.email,
    delai_paiement_jours: envoye.delai_paiement_jours as number, observations: envoye.observations,
  })
}

describe('l’aller-retour : la fiche passée par l’import rend ce que la saisie à la main enverrait', () => {
  it('les quatre types sont ceux de la base', () => {
    expect([...TYPES_CLIENT_CONTACT].sort()).toEqual(['assujetti', 'etranger', 'non_assujetti', 'organisme_public'])
  })

  for (const type of ['assujetti', 'organisme_public', 'non_assujetti', 'etranger'] as const) {
    it(`${type} : chaque champ à sa borne, « ; », guillemets, retours à la ligne et accents`, () => {
      const c = rempli(type)
      // Le jeu d'essai est ce qu'il dit : les bornes sont atteintes, et les champs que le type n'ouvre pas sont nuls.
      expect(Array.from(c.nom)).toHaveLength(200)
      expect(Array.from(c.adresse as string)).toHaveLength(1000)
      expect(c.observations).toMatch(/\r\n/)
      expect(c.delai_paiement_jours).toBe(60)
      expect(c.siren === null).toBe(type === 'etranger')
      expect(c.code_service === null).toBe(type !== 'organisme_public')
      const { lignes } = allerRetour(c)
      expect(lignes).toHaveLength(1)
      expect(lignes[0].envoyee).toEqual(cequeLaSaisieEnverrait(c))
      expect(lignes[0].envoyee).toEqual(ceQueLeContactDit(c))
      expect(lignes[0].typeNonReconnu).toBeNull()
      // Et l'aperçu de l'import, contre un fichier de clients vide, n'y refuse rien : la fiche est un client que la base rangerait.
      const apercu = apercuDeLImport('d1', null, lignes, [])
      expect(apercu.refusDuFichier).toBeNull()
      expect(apercu.lignes[0].refus).toBeNull()
      expect(apercu.refusees).toBe(0)
    })
  }

  it('un client minimal (le nom, le type, l’adresse) : tout le reste nul, comme la saisie', () => {
    const c = contact({
      type_client: 'non_assujetti', siren: null, siret: null, adresse_electronique: null, code_service: null, email: null,
      delai_paiement_jours: null, observations: null,
    })
    const { lignes } = allerRetour(c)
    expect(lignes[0].envoyee).toEqual(cequeLaSaisieEnverrait(c))
    expect(lignes[0].envoyee).toEqual({
      nom: c.nom, type_client: 'non_assujetti', adresse: c.adresse, siren: null, siret: null, adresse_electronique: null, code_service: null,
      email: null, delai_paiement_jours: null, observations: null,
    })
    expect(apercuDeLImport('d1', null, lignes, []).refusees).toBe(0)
  })

  it('un délai à zéro revient en zéro (et non en « rien »), un type d’une virgule (« un particulier, ou… ») sans guillemets revient aussi', () => {
    const c = contact({ type_client: 'non_assujetti', siren: null, siret: null, delai_paiement_jours: 0 })
    expect(ficheDuContactCsv(c).split('\r\n')[1]).toContain(';un particulier, ou un autre non-assujetti;')
    const { lignes } = allerRetour(c)
    expect(lignes[0].envoyee.delai_paiement_jours).toBe(0)
    expect(lignes[0].envoyee.type_client).toBe('non_assujetti')
  })

  it('un nom qui commence par un guillemet, une adresse qui finit par un séparateur : la ligne ne se décale pas', () => {
    const c = contact({ nom: '"Quoi ?" ; fictif', adresse: 'rue du Point-virgule ;', observations: '"entre guillemets"' })
    const { lignes } = allerRetour(c)
    expect(lignes[0].envoyee).toEqual(cequeLaSaisieEnverrait(c))
    expect(lignes[0].envoyee.nom).toBe('"Quoi ?" ; fictif')
  })

  it('les contacts d’essai du dépôt reviennent tous : leurs fiches ne se ressemblent pas, leurs retours sont ceux de leur saisie', () => {
    const contacts = [
      contact(),
      contact({ type_client: 'organisme_public', siren: '100000207', siret: '10000020700017', adresse_electronique: '100000207', code_service: 'SERVICE-ACHATS' }),
      contact({ type_client: 'non_assujetti', siren: '987654324', siret: null, delai_paiement_jours: null }),
      contact({ type_client: 'etranger', siren: null, siret: null }),
    ]
    for (const c of contacts) expect(allerRetour(c).lignes[0].envoyee).toEqual(cequeLaSaisieEnverrait(c))
  })

  // Le seul cas qui ne revient pas entier. La base refuse un contact rangé sans type (`type_inconnu`) : seul un contact EFFACÉ
  // n'en a plus, et la vue ne l'affiche jamais, donc ne l'exporte jamais. Mais `Contact.type_client` peut être nul : la cellule
  // du type est alors vide, et l'import la lit comme une valeur « (vide) » NON RECONNUE, dont la ligne est refusée. Ce que la
  // ligne envoie reste ce que la saisie enverrait (un type nul) : rien d'inventé, et le refus est celui de la base.
  it('« à préciser » (type nul) : la cellule du type est vide, l’import la dit « non reconnue » et refuse la ligne — rien n’est deviné', () => {
    const c = contact({ type_client: null, siren: null, siret: null })
    expect(ficheDuContactCsv(c).split('\r\n')[1].split(';')[1]).toBe('')
    const { lignes } = allerRetour(c)
    expect(lignes[0].envoyee).toEqual(cequeLaSaisieEnverrait(c))
    expect(lignes[0].envoyee.type_client).toBeNull()
    expect(lignes[0].typeNonReconnu).toBe('')
    const apercu = apercuDeLImport('d1', null, lignes, [])
    expect(apercu.refusees).toBe(1)
    expect(apercu.lignes[0].refus?.cle).toBe('type_inconnu')
  })
})

// ── Le nom du fichier ──────────────────────────────────────────────────────────────────────────────────────────────────────
describe('le nom du fichier', () => {
  it('« fiche-client-<nom simplifié>-<jour>.csv » : le jour est celui que l’appelant donne', () => {
    expect(nomFichierDeLaFiche('Société Essai', '2027-11-20')).toBe('fiche-client-societe-essai-2027-11-20.csv')
    expect(nomFichierDeLaFiche('Société Essai', '2026-01-05')).toBe('fiche-client-societe-essai-2026-01-05.csv')
  })

  it('minuscules ASCII : accents retirés, ligatures en deux lettres, tout ce qui n’est ni lettre ni chiffre devient UN tiret', () => {
    expect(nomSimplifiePourUnFichier('Café de l’Été')).toBe('cafe-de-l-ete')
    expect(nomSimplifiePourUnFichier('Œuvres & Fils')).toBe('oeuvres-fils')
    expect(nomSimplifiePourUnFichier('Cœur d’Æther')).toBe('coeur-d-aether')
    expect(nomSimplifiePourUnFichier('Straße Nº 3')).toBe('strasse-n-3')
    expect(nomSimplifiePourUnFichier('ÇA — MARCHE')).toBe('ca-marche')
    expect(nomSimplifiePourUnFichier('A.B.C. (SARL)')).toBe('a-b-c-sarl')
    expect(nomSimplifiePourUnFichier('Commune 2027/2028')).toBe('commune-2027-2028')
  })

  it('jamais un tiret au bord, jamais deux de suite', () => {
    expect(nomSimplifiePourUnFichier('  --Essai--  ')).toBe('essai')
    expect(nomSimplifiePourUnFichier('a   -  -  b')).toBe('a-b')
  })

  it('rien ne reste : « sans-nom » (nom vide, ponctuation seule, écriture que l’ASCII ne dit pas)', () => {
    expect(nomSimplifiePourUnFichier('')).toBe('sans-nom')
    expect(nomSimplifiePourUnFichier('  ')).toBe('sans-nom')
    expect(nomSimplifiePourUnFichier('***')).toBe('sans-nom')
    expect(nomSimplifiePourUnFichier('北京')).toBe('sans-nom')
    expect(nomFichierDeLaFiche('', '2027-11-20')).toBe('fiche-client-sans-nom-2027-11-20.csv')
  })

  it('quarante caractères au plus : quarante passent, quarante et un sont coupés ; une coupe sur un tiret ne le laisse pas', () => {
    expect(nomSimplifiePourUnFichier('a'.repeat(40))).toBe('a'.repeat(40))
    expect(nomSimplifiePourUnFichier('a'.repeat(41))).toBe('a'.repeat(40))
    expect(nomSimplifiePourUnFichier('a'.repeat(200))).toHaveLength(40)
    // Le quarante et unième caractère est ce qui suit un tiret : la coupe tombe sur lui, et il s'en va avec.
    expect(nomSimplifiePourUnFichier(`${'a'.repeat(39)} b`)).toBe('a'.repeat(39))
    expect(nomSimplifiePourUnFichier(`${'a'.repeat(38)} b`)).toBe(`${'a'.repeat(38)}-b`)
  })

  it('un nom de 200 caractères hors ASCII donne un nom de fichier sain', () => {
    const nom = `${'Éléphant de l’Œuvre ; "fictive" '.repeat(8)}`.slice(0, 200)
    const fichier = nomFichierDeLaFiche(nom, '2027-11-20')
    expect(fichier).toMatch(/^fiche-client-[a-z0-9]+(-[a-z0-9]+)*-2027-11-20\.csv$/)
    expect(fichier.length).toBeLessThanOrEqual('fiche-client-'.length + 40 + '-2027-11-20.csv'.length)
  })
})
