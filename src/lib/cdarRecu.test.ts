import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DOSSIER_RECUS, ECHOS_RECUS, EXEMPLES_RECUS, SIREN_ACHETEUR_RECU, SIREN_VENDEUR_RECU, echoRecu, factureRecue, messageRecu,
  statutLu,
} from '../test/cdarRecu'
import {
  analyserXmlRecu, CODES_STATUT_RECU, LONGUEUR_MAX_TEXTE_RECU, lireStatutRecu, rattacherStatutRecu, TYPES_FACTURE_STATUT_RECU,
  type LectureStatutRecu, type StatutRecuLu,
} from './cdarRecu'
import { fichiersDuSchema } from '../test/schema'

// LA LECTURE D'UN STATUT REÇU (ligne 28.5, étape d7), éprouvée sur des messages FICTIFS qui passent au schéma CDAR D22B
// (outils/facturation/cdar/recus/, valider.mjs), puis sur ce qu'on en abîme une donnée à la fois. Les chemins et les
// règles sont ceux de l'annexe 2 v2.3 et de l'annexe 7 v1.9 des spécifications externes de la DGFiP.

const lu = (xml: string): StatutRecuLu => {
  const r = lireStatutRecu(xml)
  if (!('lu' in r)) throw new Error(`message non lu : ${r.raison}`)
  return r.lu
}
const refus = (xml: string): Exclude<LectureStatutRecu, { lu: StatutRecuLu }> => {
  const r = lireStatutRecu(xml)
  if ('lu' in r) throw new Error(`message lu à tort : ${JSON.stringify(r.lu).slice(0, 200)}`)
  return r
}
const REFUS = messageRecu('refus-210.xml')
// Une substitution qui doit trouver son motif, une fois : un essai qui n'abîme rien passerait pour une lecture juste.
function abime(xml: string, motif: string | RegExp, par: string): string {
  const sortie = xml.replace(motif, par)
  expect(sortie, `motif introuvable : ${String(motif)}`).not.toBe(xml)
  return sortie
}

describe('les messages reçus d’exemple', () => {
  it.each(EXEMPLES_RECUS)('$fichier se lit champ par champ', ({ fichier, lu: attendu }) => {
    expect(lu(messageRecu(fichier))).toEqual(attendu)
  })

  it.each(ECHOS_RECUS)('l’écho $fichier (un statut « Encaissée » de d5) se lit aussi', ({ fichier, lu: attendu }) => {
    expect(lu(echoRecu(fichier))).toEqual(attendu)
  })

  it('chaque exemple a passé le schéma CDAR D22B, et chaque fichier du dossier est un exemple', () => {
    const manifeste = JSON.parse(readFileSync(new URL('valides.json', DOSSIER_RECUS), 'utf8')) as { fichiers: Record<string, { sha256: string }> }
    const fichiers = readdirSync(DOSSIER_RECUS).filter((f) => f.endsWith('.xml')).sort()
    expect(fichiers).toEqual(EXEMPLES_RECUS.map((e) => e.fichier).sort())
    for (const f of fichiers) {
      const empreinte = createHash('sha256').update(readFileSync(new URL(f, DOSSIER_RECUS))).digest('hex')
      expect(manifeste.fichiers[f]?.sha256, `${f} : à repasser par valider.mjs`).toBe(empreinte)
    }
  })

  it('les exemples couvrent un refus, un rejet, un 601, d’autres préfixes, un litige, un paiement et un écho', () => {
    expect(new Set([...EXEMPLES_RECUS, ...ECHOS_RECUS].map((e) => e.lu.code))).toEqual(new Set(['210', '213', '601', '205', '207', '211', '212']))
  })
})

describe('l’analyseur XML : strict, et il résout les espaces de noms', () => {
  it('un document bien formé se lit, entités, CDATA et commentaires compris', () => {
    const r = analyserXmlRecu('<?xml version="1.0"?><!-- c --><a xmlns="urn:x" b="1 &amp; 2"><c>&lt;&#233;&#x20AC;<![CDATA[<d>]]></c><?pi x?></a>\n')
    expect(r).toEqual({
      racine: {
        ns: 'urn:x', nom: 'a', attributs: [{ ns: '', nom: 'b', valeur: '1 & 2' }], texte: '',
        enfants: [{ ns: 'urn:x', nom: 'c', attributs: [], enfants: [], texte: '<é€<d>' }],
      },
    })
  })

  it('un préfixe se résout dans sa portée, un espace par défaut aussi, et peut revenir à aucun', () => {
    const r = analyserXmlRecu('<p:a xmlns:p="urn:p" xmlns="urn:d"><b/><p:c xmlns:p="urn:q"/><e xmlns=""/></p:a>')
    if (!('racine' in r)) throw new Error(r.refus)
    expect(r.racine.ns).toBe('urn:p')
    expect(r.racine.enfants.map((e) => [e.ns, e.nom])).toEqual([['urn:d', 'b'], ['urn:q', 'c'], ['', 'e']])
  })

  it('les fins de ligne se ramènent à « \\n », une marque d’ordre d’octets s’ignore', () => {
    const r = analyserXmlRecu('\uFEFF<a>x\r\ny\rz</a>')
    expect(r).toMatchObject({ racine: { texte: 'x\ny\nz' } })
  })

  const malformes: [string, string, RegExp][] = [
    ['une DTD', '<!DOCTYPE a [<!ENTITY e "x">]><a>&e;</a>', /DTD/],
    ['une déclaration d’entité, sans DOCTYPE', '<!ENTITY e "x"><a/>', /DTD/],
    ['une déclaration d’élément dans le document', '<a><!ELEMENT b ANY></a>', /DTD/],
    ['une entité inconnue', '<a>&nbsp;</a>', /entité/],
    ['une esperluette nue', '<a>a & b</a>', /entité/],
    ['une référence numérique hors de XML', '<a>&#0;</a>', /entité/],
    ['une balise mal fermée', '<a><b></a></b>', /balise fermante/],
    ['un document inachevé', '<a><b></b>', /incomplet/],
    ['deux racines', '<a/><b/>', /plusieurs racines/],
    ['du texte hors de la racine', '<a/>x', /hors de la racine/],
    ['un attribut répété', '<a b="1" b="2"/>', /répété/],
    ['un attribut répété par son espace de noms', '<a xmlns:p="urn:x" xmlns:q="urn:x" p:b="1" q:b="2"/>', /répété/],
    ['des attributs collés', '<a b="1"c="2"/>', /mal séparés/],
    ['une valeur sans guillemets', '<a b=1/>', /guillemets/],
    ['un chevron dans une valeur', '<a b="<"/>', /valeur d’attribut/],
    ['un préfixe non déclaré', '<p:a/>', /préfixe non déclaré/],
    ['un préfixe « dé-déclaré »', '<a xmlns:p=""/>', /espace de noms/],
    ['le préfixe xmlns déclaré', '<a xmlns:xmlns="urn:x"/>', /espace de noms/],
    ['un caractère interdit', '<a>\u0001</a>', /caractère/],
    ['un encodage autre que l’UTF-8', '<?xml version="1.0" encoding="ISO-8859-1"?><a/>', /ISO-8859-1/],
    ['une déclaration au milieu', ' <?xml version="1.0"?><a/>', /instruction/],
    ['un commentaire qui finit par un tiret', '<a><!-- x ---></a>', /commentaire/],
    ['« ]]> » dans un texte', '<a>]]></a>', /entité/],
    ['une section CDATA hors de la racine', '<![CDATA[x]]><a/>', /CDATA/],
  ]
  it.each(malformes)('refuse %s', (_, xml, motif) => {
    const r = analyserXmlRecu(xml)
    expect('refus' in r ? r.refus : 'accepté').toMatch(motif)
  })

  it('borne la profondeur, le nombre d’éléments et la longueur', () => {
    expect(analyserXmlRecu(`${'<a>'.repeat(65)}${'</a>'.repeat(65)}`)).toMatchObject({ refus: expect.stringMatching(/profond/) })
    expect(analyserXmlRecu(`${'<a>'.repeat(64)}${'</a>'.repeat(64)}`)).toHaveProperty('racine')
    expect(analyserXmlRecu(`<a>${'<b/>'.repeat(20_000)}</a>`)).toMatchObject({ refus: expect.stringMatching(/trop long/) })
    expect(analyserXmlRecu(`<a>${' '.repeat(1_000_001)}</a>`)).toMatchObject({ refus: expect.stringMatching(/taille/) })
  })
})

describe('un message qu’on ne sait pas lire, ou qui dit deux choses, est dit tel', () => {
  it('un message qui n’est pas un CDAR', () => {
    expect(refus('<a/>')).toEqual({ refus: 'illisible', raison: 'Le message n’est pas un cycle de vie CDAR (CrossDomainAcknowledgementAndResponse).' })
    // Le bon nom, dans un autre espace de noms : ce n'est pas le message de l'UN/CEFACT.
    expect(refus(abime(REFUS, 'xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossDomainAcknowledgementAndResponse:100"', 'xmlns:rsm="urn:autre"')).refus).toBe('illisible')
    expect(refus('pas du XML').raison).toMatch(/^Le message n’est pas un XML lisible : /)
  })

  const decisifs: [string, string | RegExp, string, 'illisible' | 'ambigu', RegExp][] = [
    ['deux documents de réponse', /<\/rsm:AcknowledgementDocument>/, '</rsm:AcknowledgementDocument><rsm:AcknowledgementDocument><ram:ReferenceReferencedDocument/></rsm:AcknowledgementDocument>', 'ambigu', /plusieurs documents de réponse/],
    ['aucune référence', /<ram:ReferenceReferencedDocument>[\s\S]*<\/ram:ReferenceReferencedDocument>/, '', 'illisible', /aucun objet/],
    ['deux références', /<\/ram:ReferenceReferencedDocument>/, '</ram:ReferenceReferencedDocument><ram:ReferenceReferencedDocument/>', 'ambigu', /plusieurs objets/],
    ['un message relatif à plusieurs objets (MDT-74)', '<udt:Indicator>false</udt:Indicator>', '<udt:Indicator>true</udt:Indicator>', 'ambigu', /MDT-74/],
    ['un message relatif à plusieurs objets, écrit « 1 » (xsd:boolean)', '<udt:Indicator>false</udt:Indicator>', '<udt:Indicator>1</udt:Indicator>', 'ambigu', /MDT-74/],
    ['un indicateur illisible', '<udt:Indicator>false</udt:Indicator>', '<udt:Indicator>False</udt:Indicator>', 'illisible', /MDT-74/],
    ['deux codes de statut', '<ram:ProcessConditionCode>210</ram:ProcessConditionCode>', '<ram:ProcessConditionCode>210</ram:ProcessConditionCode><ram:ProcessConditionCode>205</ram:ProcessConditionCode>', 'ambigu', /MDT-105/],
    ['un code absent', '<ram:ProcessConditionCode>210</ram:ProcessConditionCode>', '', 'illisible', /MDT-105/],
    ['un code de deux chiffres', '<ram:ProcessConditionCode>210</ram:ProcessConditionCode>', '<ram:ProcessConditionCode>21</ram:ProcessConditionCode>', 'illisible', /MDT-105/],
    ['un numéro absent', '<ram:IssuerAssignedID>F2027-0042</ram:IssuerAssignedID>', '', 'illisible', /MDT-87/],
    ['un numéro vide', '<ram:IssuerAssignedID>F2027-0042</ram:IssuerAssignedID>', '<ram:IssuerAssignedID>  </ram:IssuerAssignedID>', 'illisible', /MDT-87/],
    ['deux numéros', '<ram:IssuerAssignedID>F2027-0042</ram:IssuerAssignedID>', '<ram:IssuerAssignedID>F2027-0042</ram:IssuerAssignedID><ram:IssuerAssignedID>F2027-0043</ram:IssuerAssignedID>', 'ambigu', /MDT-87/],
    ['un numéro qui n’est pas une valeur simple', '<ram:IssuerAssignedID>F2027-0042</ram:IssuerAssignedID>', '<ram:IssuerAssignedID><ram:x/></ram:IssuerAssignedID>', 'illisible', /MDT-87/],
    ['un type de deux chiffres', '<ram:TypeCode>380</ram:TypeCode>', '<ram:TypeCode>38</ram:TypeCode>', 'illisible', /MDT-91/],
    ['un type et une référence qui se contredisent', '<ram:TypeCode>380</ram:TypeCode>', '<ram:TypeCode>305</ram:TypeCode>', 'ambigu', /se contredisent/],
    ['ni type ni référence', /<ram:TypeCode>380<\/ram:TypeCode>[\s\S]*<ram:ReferenceTypeCode>[^<]*<\/ram:ReferenceTypeCode>/, '', 'illisible', /sur quoi il porte/],
    ['deux SIREN du vendeur', '<ram:GlobalID schemeID="0009">12345678200010</ram:GlobalID>', '<ram:GlobalID schemeID="0002">987654324</ram:GlobalID>', 'ambigu', /G7\.17/],
    ['un SIREN de huit chiffres', '<ram:GlobalID schemeID="0002">123456782</ram:GlobalID>\n        <ram:GlobalID schemeID="0009">', '<ram:GlobalID schemeID="0002">12345678</ram:GlobalID>\n        <ram:GlobalID schemeID="0009">', 'illisible', /neuf chiffres/],
    ['deux émetteurs de l’objet', '<ram:SpecifiedDocumentStatus>', '<ram:IssuerTradeParty/><ram:SpecifiedDocumentStatus>', 'ambigu', /MDG-40/],
    ['une date d’objet impossible', '<qdt:DateTimeString format="204">20271001000000</qdt:DateTimeString>', '<qdt:DateTimeString format="204">20270231000000</qdt:DateTimeString>', 'illisible', /MDT-100/],
    ['une date d’objet sans format', '<qdt:DateTimeString format="204">20271001000000</qdt:DateTimeString>', '<qdt:DateTimeString>20271001000000</qdt:DateTimeString>', 'illisible', /MDT-100/],
    ['une date d’objet d’un autre format', '<qdt:DateTimeString format="204">20271001000000</qdt:DateTimeString>', '<qdt:DateTimeString format="203">202710010000</qdt:DateTimeString>', 'illisible', /MDT-100/],
    ['une date d’objet à 24 h', '<qdt:DateTimeString format="204">20271001000000</qdt:DateTimeString>', '<qdt:DateTimeString format="204">20271001240000</qdt:DateTimeString>', 'illisible', /MDT-100/],
    ['un 29 février d’une année séculaire qui n’est pas bissextile', '<qdt:DateTimeString format="204">20271001000000</qdt:DateTimeString>', '<qdt:DateTimeString format="204">21000229000000</qdt:DateTimeString>', 'illisible', /MDT-100/],
    ['deux dates d’objet', '<ram:ProcessConditionCode>', '<ram:FormattedIssueDateTime/><ram:ProcessConditionCode>', 'ambigu', /MDT-100/],
  ]
  it.each(decisifs)('%s', (_, motif, par, attendu, raison) => {
    const r = refus(abime(REFUS, motif, par))
    expect(r.refus).toBe(attendu)
    expect(r.raison).toMatch(raison)
  })

  it('un numéro de 200 caractères se lit ; de 201, il est illisible — la longueur que la base garde', () => {
    const numero = (n: number) => abime(REFUS, '<ram:IssuerAssignedID>F2027-0042</ram:IssuerAssignedID>', `<ram:IssuerAssignedID>${'F'.repeat(n)}</ram:IssuerAssignedID>`)
    expect(lu(numero(200)).reference).toBe('F'.repeat(200))
    expect(refus(numero(201))).toMatchObject({ refus: 'illisible', raison: expect.stringMatching(/MDT-87/) })
    // Et un 29 février d'une année bissextile — 2000, séculaire divisible par 400 — se lit.
    expect(lu(abime(REFUS, '<qdt:DateTimeString format="204">20271001000000</qdt:DateTimeString>', '<qdt:DateTimeString format="204">20000229000000</qdt:DateTimeString>')).dateObjet).toBe('2000-02-29')
  })

  it('un numéro se lit comme un `xsd:token` : ses blancs en tête, en fin et répétés ne comptent pas', () => {
    expect(lu(abime(REFUS, '<ram:IssuerAssignedID>F2027-0042</ram:IssuerAssignedID>', '<ram:IssuerAssignedID>\n  F2027-0042\t</ram:IssuerAssignedID>')).reference).toBe('F2027-0042')
  })

  it('MDT-100 se lit dans l’espace de noms udt, celui des versions de l’annexe 2 d’avant la 2.2', () => {
    expect(lu(abime(REFUS, '<qdt:DateTimeString format="204">20271001000000</qdt:DateTimeString>', '<udt:DateTimeString format="102">20271001</udt:DateTimeString>')).dateObjet).toBe('2027-10-01')
  })

  it('l’objet se lit par le type seul, ou par la référence seule ; un type de facture fait une facture', () => {
    const sansUrn = abime(REFUS, /<ram:ReferenceTypeCode>[^<]*<\/ram:ReferenceTypeCode>/, '')
    expect(lu(sansUrn).objet).toBe('facture')
    for (const type of TYPES_FACTURE_STATUT_RECU) {
      const xml = type === '380' ? sansUrn : abime(sansUrn, '<ram:TypeCode>380</ram:TypeCode>', `<ram:TypeCode>${type}</ram:TypeCode>`)
      expect(lu(xml), type).toMatchObject({ objet: 'facture', typeObjet: type })
    }
    expect(lu(abime(sansUrn, '<ram:TypeCode>380</ram:TypeCode>', '<ram:TypeCode>303</ram:TypeCode>')).objet).toBe('flux')
    expect(lu(abime(sansUrn, '<ram:TypeCode>380</ram:TypeCode>', '<ram:TypeCode>304</ram:TypeCode>')).objet).toBe('autre')
    expect(lu(abime(sansUrn, '<ram:TypeCode>380</ram:TypeCode>', '<ram:TypeCode>999</ram:TypeCode>')).objet).toBe('autre')
    const sansType = abime(REFUS, '<ram:TypeCode>380</ram:TypeCode>', '')
    expect(lu(sansType)).toMatchObject({ objet: 'facture', typeObjet: null })
    expect(lu(abime(sansType, 'CDV:einvoicingF2</ram:ReferenceTypeCode>', 'CDV:flux</ram:ReferenceTypeCode>')).objet).toBe('flux')
    expect(lu(abime(sansType, 'CDV:einvoicingF2</ram:ReferenceTypeCode>', 'CDV:inconnu</ram:ReferenceTypeCode>')).objet).toBe('autre')
    // Une référence inconnue ne contredit pas un type connu.
    expect(lu(abime(REFUS, 'CDV:einvoicingF2</ram:ReferenceTypeCode>', 'CDV:inconnu</ram:ReferenceTypeCode>')).objet).toBe('facture')
  })

  it('MDT-74 absent, « 0 » ou « false » : un seul objet ; MDT-129 sans 0002 : aucun SIREN', () => {
    expect(lu(abime(REFUS, /<ram:MultipleReferencesIndicator>[\s\S]*?<\/ram:MultipleReferencesIndicator>/, '')).code).toBe('210')
    const sansSiren = abime(REFUS, '<ram:GlobalID schemeID="0002">123456782</ram:GlobalID>\n        <ram:GlobalID schemeID="0009">', '<ram:GlobalID schemeID="0009">')
    expect(lu(sansSiren).siren).toBeNull()
    // Le même SIREN écrit deux fois n'est pas deux SIREN.
    expect(lu(abime(REFUS, '<ram:GlobalID schemeID="0009">12345678200010</ram:GlobalID>', '<ram:GlobalID schemeID=" 0002 "> 123456782 </ram:GlobalID>')).siren).toBe(SIREN_VENDEUR_RECU)
  })
})

describe('une donnée informative mal formée s’écarte seule, et le dit', () => {
  it('l’horodatage, le rôle, l’identifiant du message', () => {
    const r = lu(abime(abime(abime(REFUS,
      '<udt:DateTimeString format="204">20271008143000</udt:DateTimeString>\n    </ram:IssueDateTime>\n    <ram:ReferenceReferencedDocument>',
      '<udt:DateTimeString format="204">2027100814</udt:DateTimeString>\n    </ram:IssueDateTime>\n    <ram:ReferenceReferencedDocument>'),
    '<ram:RoleCode>BY</ram:RoleCode>', '<ram:RoleCode>acheteur</ram:RoleCode>'),
    '<ram:ID>REFUS-2027-000017</ram:ID>', '<ram:ID> </ram:ID>'))
    expect(r).toMatchObject({ code: '210', emisLe: null, createurRole: null, messageId: null })
    expect(r.avertissements).toEqual([
      'L’identifiant du message (MDT-4) est illisible : il est écarté.',
      'Le rôle du créateur du message (MDT-40) est illisible : il est écarté.',
      'L’horodatage du statut (MDT-78) est illisible : il est écarté.',
    ])
  })

  it('un code de motif, une date de statut, un montant', () => {
    const r = lu(abime(abime(messageRecu('paiement-211.xml'),
      '<ram:ValueAmount currencyID="EUR">1200.00</ram:ValueAmount>', '<ram:ValueAmount currencyID="EUR">1200,00</ram:ValueAmount>'),
    '<udt:DateTimeString format="204">20271013000000</udt:DateTimeString>', '<udt:DateTimeString format="204">2027101300000</udt:DateTimeString>'))
    expect(r).toMatchObject({ code: '211', montants: [], dateStatut: null })
    expect(r.avertissements).toEqual(['Une date de statut (MDT-110) est illisible : elle est écartée.', 'Un montant (MDT-215) est illisible : il est écarté.'])
    // Un rôle de quatre caractères n'est pas un code de rôle (UNTDID 3035 : trois au plus).
    const role = lu(abime(REFUS, '<ram:RoleCode>BY</ram:RoleCode>', '<ram:RoleCode>BYER</ram:RoleCode>'))
    expect(role.createurRole).toBeNull()
    expect(role.avertissements).toEqual(['Le rôle du créateur du message (MDT-40) est illisible : il est écarté.'])
    const motif = lu(abime(REFUS, '<ram:ReasonCode>MONTANT_ERR</ram:ReasonCode>', '<ram:ReasonCode>MONTANT ERR !</ram:ReasonCode>'))
    expect(motif.motifs).toBe('Montant de la facture erroné')
    expect(motif.avertissements).toEqual(['Un code de motif (MDT-113) est illisible : il est écarté.'])
  })

  it('un montant de G7.07 : le point, 19 chiffres et 6 décimales au plus, le signe en tête', () => {
    const avec = (montant: string) => lu(abime(messageRecu('paiement-211.xml'), '>1200.00<', `>${montant}<`)).montants.map((m) => m.montant)
    expect(avec('-58.9')).toEqual(['-58.9'])
    expect(avec('1234567890123.123456')).toEqual(['1234567890123.123456'])
    expect(avec('12345678901234.123456')).toEqual([])
    expect(avec('1.1234567')).toEqual([])
    expect(avec('+5')).toEqual([])
  })

  it('un motif ou un commentaire de plus de 2 000 caractères est coupé, et le dit', () => {
    const long = 'é'.repeat(2500)
    const r = lu(abime(REFUS, 'La quantité facturée ne correspond pas au bon de commande n° BC-17 &amp; ses deux avenants.', long))
    expect([...(r.commentaire ?? '')].length).toBe(2000)
    expect(r.commentaire?.endsWith('é…')).toBe(true)
    expect(r.avertissements).toEqual(['Le commentaire dépasse 2000 caractères : il est coupé.'])
  })

  it('un caractère de commande qu’XML admet (U+0085, U+0090) devient une espace : un motif tient sur une ligne', () => {
    const r = lu(abime(REFUS, '<ram:Reason>Montant de la facture erroné</ram:Reason>', '<ram:Reason>Montant\u0085de la\u0090 facture erroné</ram:Reason>'))
    expect(r.motifs).toBe('MONTANT_ERR : Montant de la facture erroné')
  })

  it('des dates de statut qui se contredisent s’écartent', () => {
    const r = lu(abime(REFUS, '</ram:SpecifiedDocumentStatus>', '</ram:SpecifiedDocumentStatus><ram:SpecifiedDocumentStatus><ram:ReferenceDateTime><udt:DateTimeString format="102">20271009</udt:DateTimeString></ram:ReferenceDateTime></ram:SpecifiedDocumentStatus>'))
    expect(r.dateStatut).toBeNull()
    expect(r.avertissements).toEqual(['Les dates de statut (MDT-110) se contredisent : elles sont écartées.'])
  })
})

describe('le rattachement à une facture du dossier : l’identité de G1.42', () => {
  const refusLu = lu(REFUS)
  const rattacher = (o: Partial<StatutRecuLu> = {}, facture = factureRecue(), sirenDuDossier: string | null = SIREN_VENDEUR_RECU) =>
    rattacherStatutRecu({ ...refusLu, ...o }, facture, sirenDuDossier)

  it('le refus de F2027-0042 se rattache à F2027-0042', () => {
    expect(rattacher()).toEqual({ factureId: 'facture-42' })
    // Une facture du dossier émise et figée sous le SIRET du vendeur ; le dossier n'a pas à le porter encore.
    expect(rattacher({}, factureRecue(), null)).toEqual({ factureId: 'facture-42' })
    // L'identité de G1.42 compte l'ANNÉE d'émission, pas le jour : un message qui date la facture d'un autre jour de la
    // même année la désigne encore.
    expect(rattacher({ dateObjet: '2027-03-15' })).toEqual({ factureId: 'facture-42' })
    // Sans date ni type dans le message, le numéro et le SIREN suffisent : le numéro porte son année.
    expect(rattacher({ dateObjet: null, typeObjet: null })).toEqual({ factureId: 'facture-42' })
    // Un avoir refusé se rattache à l'avoir.
    expect(rattacher({ reference: 'A2027-0003', typeObjet: '381' }, factureRecue({ id: 'avoir-3', numero: 'A2027-0003', type: 'avoir' })))
      .toEqual({ factureId: 'avoir-3' })
  })

  it('chaque statut du tableau 8 se rattache ; un autre code non', () => {
    for (const code of CODES_STATUT_RECU) expect(rattacher({ code }), code).toEqual({ factureId: 'facture-42' })
    for (const code of ['199', '214', '501', '601', '250']) expect(rattacher({ code }), code).toMatchObject({ ecart: 'statut_inconnu' })
  })

  const ecarts: [string, Partial<StatutRecuLu>, ReturnType<typeof factureRecue> | null, string | null, string, RegExp][] = [
    ['un statut sur un statut (601)', { objet: 'statut', code: '601' }, factureRecue(), SIREN_VENDEUR_RECU, 'autre_objet', /porte sur un autre statut/],
    ['un statut sur un flux', { objet: 'flux', code: '501' }, factureRecue(), SIREN_VENDEUR_RECU, 'autre_objet', /porte sur un flux/],
    ['un statut sur autre chose', { objet: 'autre', code: '251' }, factureRecue(), SIREN_VENDEUR_RECU, 'autre_objet', /un objet qui n’est pas une facture/],
    ['un vendeur que le message ne désigne pas', { siren: null }, factureRecue(), SIREN_VENDEUR_RECU, 'illisible', /G7\.17/],
    ['aucune facture de ce numéro, au SIREN du dossier', {}, null, SIREN_VENDEUR_RECU, 'facture_inconnue', /F2027-0042/],
    ['aucune facture de ce numéro, sans SIREN au dossier', {}, null, null, 'facture_inconnue', /F2027-0042/],
    ['aucune facture de ce numéro, une autre entreprise', { siren: SIREN_ACHETEUR_RECU }, null, SIREN_VENDEUR_RECU, 'autre_vendeur', /autre entreprise/],
    ['un brouillon', {}, factureRecue({ statut: 'brouillon' }), SIREN_VENDEUR_RECU, 'facture_inconnue', /F2027-0042/],
    ['une facture d’un autre numéro', {}, factureRecue({ numero: 'F2027-0043' }), SIREN_VENDEUR_RECU, 'facture_inconnue', /F2027-0042/],
    ['la facture d’une autre entreprise', { siren: SIREN_ACHETEUR_RECU }, factureRecue(), SIREN_VENDEUR_RECU, 'autre_vendeur', /autre entreprise/],
    ['une facture émise sous un autre SIREN que le dossier d’aujourd’hui', {}, factureRecue({ emetteur_siret: '98765432400019' }), SIREN_VENDEUR_RECU, 'incoherent', /autre SIREN/],
    ['une facture sans SIREN figé', {}, factureRecue({ emetteur_siret: null }), SIREN_VENDEUR_RECU, 'incoherent', /ne porte pas le SIREN/],
    ['une autre année d’émission', { dateObjet: '2028-10-01' }, factureRecue(), SIREN_VENDEUR_RECU, 'incoherent', /de 2028 : celle du dossier est de 2027/],
    ['les valeurs par défaut de la plateforme de l’administration (G1.114)', { dateObjet: '1900-01-01' }, factureRecue(), SIREN_VENDEUR_RECU, 'incoherent', /1900/],
    ['un avoir pour une facture', { typeObjet: '381' }, factureRecue(), SIREN_VENDEUR_RECU, 'incoherent', /type 381/],
    ['une facture pour un avoir', { reference: 'A2027-0003' }, factureRecue({ numero: 'A2027-0003', type: 'avoir' }), SIREN_VENDEUR_RECU, 'incoherent', /un avoir \(381\)/],
    ['une autofacture', { typeObjet: '389' }, factureRecue(), SIREN_VENDEUR_RECU, 'incoherent', /type 389/],
  ]
  it.each(ecarts)('%s ne se rattache pas', (_, o, facture, sirenDuDossier, ecart, raison) => {
    const r = rattacher(o, facture as ReturnType<typeof factureRecue>, sirenDuDossier)
    expect(r).toMatchObject({ ecart })
    expect('raison' in r ? r.raison : '').toMatch(raison)
  })

  it('un message d’une autre entreprise ne dit ni son numéro ni son SIREN', () => {
    for (const facture of [null, factureRecue()]) {
      const r = rattacher({ siren: SIREN_ACHETEUR_RECU }, facture as ReturnType<typeof factureRecue>)
      expect('raison' in r ? r.raison : '').not.toMatch(/F2027|987654324/)
    }
  })

  it('les exemples : le refus, le rejet, le litige et le paiement se rattachent à leur facture ; le 601 jamais', () => {
    const factures = { 'F2027-0042': factureRecue(), 'F2027-0043': factureRecue({ id: 'facture-43', numero: 'F2027-0043' }),
      'F2027-0044': factureRecue({ id: 'facture-44', numero: 'F2027-0044', date_emission: '2027-10-05' }) } as Record<string, ReturnType<typeof factureRecue>>
    const issues = [...EXEMPLES_RECUS, ...ECHOS_RECUS].map((e) => [e.fichier, rattacherStatutRecu(e.lu, factures[e.lu.reference] ?? null, SIREN_VENDEUR_RECU)])
    expect(Object.fromEntries(issues)).toEqual({
      'refus-210.xml': { factureId: 'facture-42' },
      'rejet-213.xml': { factureId: 'facture-43' },
      'rejet-601.xml': { ecart: 'autre_objet', raison: 'Un statut 601 porte sur un autre statut (un cycle de vie rejeté) : il ne désigne pas une facture.' },
      'approuvee-205-autres-prefixes.xml': { factureId: 'facture-42' },
      'litige-207.xml': { factureId: 'facture-44' },
      'paiement-211.xml': { factureId: 'facture-42' },
      'encaissement-un-taux.xml': { factureId: 'facture-42' },
      'encaissement-plusieurs-taux.xml': { factureId: 'facture-43' },
      'contre-passation.xml': { factureId: 'facture-43' },
    })
  })

  it('les codes et les types sont ceux des sources : tableau 8 et G1.01', () => {
    expect([...CODES_STATUT_RECU]).toEqual(['200', '201', '202', '203', '204', '205', '206', '207', '208', '209', '210', '211', '212', '213'])
    expect([...TYPES_FACTURE_STATUT_RECU].sort()).toEqual(['261', '380', '381', '384', '386', '389', '393', '396', '471', '472', '473', '500', '501', '502', '503'])
  })

  it('statutLu garde ses valeurs par défaut', () => {
    expect(statutLu({})).toMatchObject({ objet: 'facture', code: '210', siren: SIREN_VENDEUR_RECU, avertissements: [] })
  })
})

// CE QUE LA BASE GARDE (migration cycle_de_vie_des_factures_emises) : tout ce que la lecture rend d'un message lisible
// passe les contraintes de la table — sinon la fonction lirait un refus et ne pourrait pas l'écrire.
describe('ce que la lecture rend, la table le garde', () => {
  const MIGRATION = fichiersDuSchema().find((f) => f.texte.includes('create table public.statuts_factures_recus ('))?.texte ?? ''
  const contrainte = (nom: string) => {
    const m = new RegExp(`constraint ${nom} check \\((.*)\\),?$`, 'm').exec(MIGRATION)
    expect(m, nom).not.toBeNull()
    return (m as RegExpExecArray)[1]
  }

  it('les codes, les longueurs et les formes sont ceux des contraintes de la table', () => {
    expect(MIGRATION).not.toBe('')
    expect([...contrainte('statuts_factures_recus_code').matchAll(/'(\d{3})'/g)].map((m) => m[1])).toEqual([...CODES_STATUT_RECU])
    expect(contrainte('statuts_factures_recus_motifs')).toBe(`btrim(motifs) <> '' and length(motifs) <= ${LONGUEUR_MAX_TEXTE_RECU}`)
    expect(contrainte('statuts_factures_recus_commentaire')).toBe(`btrim(commentaire) <> '' and length(commentaire) <= ${LONGUEUR_MAX_TEXTE_RECU}`)
    expect(contrainte('statuts_factures_recus_message_id')).toBe("message_id <> '' and length(message_id) <= 200")
    expect(contrainte('statuts_factures_recus_emis_le')).toBe("emis_le ~ '^[0-9]{14}$'")
    expect(contrainte('statuts_factures_recus_createur_role')).toBe("createur_role ~ '^[A-Z0-9]{1,3}$'")
    expect(contrainte('statuts_factures_recus_montants')).toBe("jsonb_typeof(montants) = 'array'")
  })

  // Les contraintes de la table, rejouées sur une lecture : `length` compte des caractères, comme `[...texte].length`.
  const admis = (l: StatutRecuLu): string[] => {
    const fautes: string[] = []
    const texte = (v: string | null, nom: string) => {
      if (v !== null && (v.trim() === '' || [...v].length > LONGUEUR_MAX_TEXTE_RECU)) fautes.push(nom)
    }
    if (!(CODES_STATUT_RECU as readonly string[]).includes(l.code)) fautes.push('code')
    if (l.messageId !== null && (l.messageId === '' || [...l.messageId].length > 200)) fautes.push('message_id')
    if (l.emisLe !== null && !/^[0-9]{14}$/.test(l.emisLe)) fautes.push('emis_le')
    if (l.createurRole !== null && !/^[A-Z0-9]{1,3}$/.test(l.createurRole)) fautes.push('createur_role')
    if (l.dateStatut !== null && !/^\d{4}-\d{2}-\d{2}$/.test(l.dateStatut)) fautes.push('date_statut')
    texte(l.motifs, 'motifs')
    texte(l.commentaire, 'commentaire')
    if (!Array.isArray(l.montants)) fautes.push('montants')
    return fautes
  }

  it('chaque exemple de statut de facture passe les contraintes, et un motif ou un commentaire coupé aussi', () => {
    for (const e of [...EXEMPLES_RECUS, ...ECHOS_RECUS].filter((x) => x.lu.objet === 'facture')) {
      expect(admis(e.lu), e.fichier).toEqual([])
    }
    const long = lu(abime(REFUS, /<ram:Reason>[^<]*<\/ram:Reason>/, `<ram:Reason>${'é'.repeat(3000)}</ram:Reason>`))
    expect(admis(long)).toEqual([])
    // Une espace en tête du libellé, un motif de 2 000 caractères pile après elle : la base compte comme la lecture.
    const pile = lu(abime(REFUS, /<ram:Reason>[^<]*<\/ram:Reason>/, `<ram:Reason>  ${'x'.repeat(LONGUEUR_MAX_TEXTE_RECU)}</ram:Reason>`))
    expect(admis(pile)).toEqual([])
  })
})
