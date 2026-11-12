import { analyserXmlRecu, type ElementRecu } from './cdarRecu'

// L'ACHETEUR D'UNE FACTURE REÇUE, LU PAR LE SERVEUR (espace client, ligne 51.5, étape B4r ; B4-Q1 et B4-Q2, tranchées le
// 11/11/2026 à la recommandation). Quand l'accès « Achats » relève la plateforme de sa société, c'est la fonction
// `plateforme-agreee` qui écrit la pièce, jamais son navigateur ; et elle ne l'écrit que si la facture désigne le dossier
// comme ACHETEUR. Une identité ouverte sur une plateforme peut servir plusieurs entreprises : sans ce contrôle, une
// organisation mal configurée ferait entrer la facture d'une autre entreprise dans le dossier, sous les yeux du client.
//
// CE QUE LE MODULE LIT, ET RIEN D'AUTRE : le SIREN de l'acheteur, tel que `lireFactureXml` (lib/factureElectronique.ts) le lit
// — l'identifiant légal (BT-47 : le schéma 0002, un SIREN ; 0009, un SIRET ; sans schéma, l'un ou l'autre à sa forme), sinon le
// numéro de TVA français (BT-48). Les montants, la date et le fournisseur restent au lecteur du navigateur : le serveur n'a
// pas `DOMParser`, et deux lecteurs complets finiraient par se contredire. La pièce que le serveur écrit le dit (confiance
// « basse », sans montants) ; le cabinet la lit et la complète.
//
// SANS JAMAIS DEVINER, ET DU CÔTÉ FERMÉ : un XML que l'analyseur strict de cdarRecu refuse (une DTD, une entité, un préfixe non
// déclaré, plus d'un million de caractères), une racine qui n'est ni une facture CII ni une facture ou un avoir UBL, un
// identifiant qui porte des éléments, rendent « inconnu » — la facture n'entre pas par le client, elle attend le cabinet.
// Là où `lireFactureXml` lit un SIREN, ce module lit le même, ou aucun (acheteurRecuCopie.test.ts les confronte) ; il n'en lit
// jamais un autre.

// ── DÉBUT COPIE acheteurRecu ─────────────────────────────────────────────────────────────────────────────────────────
// Ce bloc est recopié AU CARACTÈRE PRÈS dans plateforme-agreee, après le bloc cdarRecu dont il emprunte
// `analyserXmlRecu` et `ElementRecu`, et rien d'autre. acheteurRecuCopie.test.ts compare la copie à ce bloc, l'exécute seule
// avec le bloc cdarRecu de la fonction, et confronte ce qu'elle lit à `lireFactureXml`.

// Les espaces de noms des deux syntaxes : ceux de `NS` (lib/factureElectronique.ts), que le test confronte.
const NS_ACHETEUR = {
  rsm: 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100',
  ram: 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100',
  facture: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
  avoir: 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2',
  cac: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
  cbc: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
} as const

/** Ce que la facture dit de son acheteur : sa syntaxe et le SIREN lu (nul quand elle ne le dit pas), ou pourquoi elle ne se lit pas. */
export type AcheteurLu = { syntaxe: 'CII' | 'UBL'; siren: string | null } | { refus: string }

/** La facture désigne-t-elle le dossier comme acheteur ? « inconnue » quand rien ne permet de le dire. */
export type ConcordanceAcheteur = 'concorde' | 'autre' | 'inconnue'

function enfantsAcheteur(el: ElementRecu | null, ns: string, nom: string): ElementRecu[] {
  return el === null ? [] : el.enfants.filter((e) => e.ns === ns && e.nom === nom)
}

function enfantAcheteur(el: ElementRecu | null, ns: string, nom: string): ElementRecu | null {
  return enfantsAcheteur(el, ns, nom)[0] ?? null
}

// Le texte d'un champ, sans ses blancs de bord ; nul quand il est vide — ou quand l'élément porte des éléments : l'analyseur ne
// garde pas l'ordre de leurs textes, et un identifiant ainsi fait ne se lit pas (le côté fermé).
function texteAcheteur(el: ElementRecu | null): string | null {
  if (el === null || el.enfants.length > 0) return null
  const t = el.texte.trim()
  return t === '' ? null : t
}

function attributAcheteur(el: ElementRecu | null, nom: string): string | null {
  const v = el?.attributs.find((a) => a.ns === '' && a.nom === nom)?.valeur.trim() ?? ''
  return v === '' ? null : v
}

// La règle de `sirenDe` (lib/factureElectronique.ts), sur l'arbre de l'analyseur.
function sirenAcheteur(idLegal: ElementRecu | null, tva: string | null): string | null {
  const v = (texteAcheteur(idLegal) ?? '').replace(/\s/g, '')
  const schema = attributAcheteur(idLegal, 'schemeID')
  if ((schema === null || schema === '0002') && /^\d{9}$/.test(v)) return v
  if ((schema === null || schema === '0009') && /^\d{14}$/.test(v)) return v.slice(0, 9)
  const m = /^FR[0-9A-Z]{2}(\d{9})$/.exec((tva ?? '').replace(/\s/g, '').toUpperCase())
  return m ? m[1] : null
}

/** Le SIREN de l'acheteur d'une facture CII, ou d'une facture ou d'un avoir UBL. */
export function acheteurDeLaFacture(xml: string): AcheteurLu {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) return { refus: 'le XML déclare une DTD ou des entités' }
  const analyse = analyserXmlRecu(xml)
  if ('refus' in analyse) return { refus: analyse.refus }
  const racine = analyse.racine
  const N = NS_ACHETEUR
  if (racine.ns === N.rsm && racine.nom === 'CrossIndustryInvoice') {
    const accord = enfantAcheteur(enfantAcheteur(racine, N.rsm, 'SupplyChainTradeTransaction'), N.ram, 'ApplicableHeaderTradeAgreement')
    const partie = enfantAcheteur(accord, N.ram, 'BuyerTradeParty')
    const organisation = enfantAcheteur(partie, N.ram, 'SpecifiedLegalOrganization')
    const tva = enfantsAcheteur(partie, N.ram, 'SpecifiedTaxRegistration')
      .map((r) => enfantAcheteur(r, N.ram, 'ID'))
      .find((id) => attributAcheteur(id, 'schemeID') === 'VA') ?? null
    return { syntaxe: 'CII', siren: sirenAcheteur(enfantAcheteur(organisation, N.ram, 'ID'), texteAcheteur(tva)) }
  }
  if ((racine.ns === N.facture && racine.nom === 'Invoice') || (racine.ns === N.avoir && racine.nom === 'CreditNote')) {
    const partie = enfantAcheteur(enfantAcheteur(racine, N.cac, 'AccountingCustomerParty'), N.cac, 'Party')
    const legal = enfantAcheteur(partie, N.cac, 'PartyLegalEntity')
    const schemaTva = enfantsAcheteur(partie, N.cac, 'PartyTaxScheme')
      .find((s) => texteAcheteur(enfantAcheteur(enfantAcheteur(s, N.cac, 'TaxScheme'), N.cbc, 'ID')) === 'VAT') ?? null
    return {
      syntaxe: 'UBL',
      siren: sirenAcheteur(enfantAcheteur(legal, N.cbc, 'CompanyID'), texteAcheteur(enfantAcheteur(schemaTva, N.cbc, 'CompanyID'))),
    }
  }
  return { refus: 'ce XML n’est ni une facture CII ni une facture UBL' }
}

/** Le SIREN d'un dossier, tiré de son SIRET (ou d'un SIREN saisi seul) : la règle de `sirenDuDossier`. */
export function sirenDuDossierRecu(siret: unknown): string | null {
  const v = (typeof siret === 'string' ? siret : '').replace(/\s/g, '')
  if (/^\d{14}$/.test(v)) return v.slice(0, 9)
  if (/^\d{9}$/.test(v)) return v
  return null
}

/** Un achat doit avoir le dossier pour acheteur ; ce qui ne se lit pas, ou ne dit pas son acheteur, est « inconnue ». */
export function concordanceDeLAcheteur(lu: AcheteurLu, sirenDossier: string | null): ConcordanceAcheteur {
  if ('refus' in lu || lu.siren === null || sirenDossier === null) return 'inconnue'
  return lu.siren === sirenDossier ? 'concorde' : 'autre'
}
// ── FIN COPIE acheteurRecu ───────────────────────────────────────────────────────────────────────────────────────────
