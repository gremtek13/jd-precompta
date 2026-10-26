import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { correspondAuModele, etapesDeLEssai, refusExigesParLEssai } from '../test/essaiVentesFacturees'
import { codesSql, messagesSql } from '../test/raiseSql'
import { derniereDefinitionSql, fichiersDuSchema } from '../test/schema'
import {
  REFUS_CONTRE_PASSATION, REFUS_ENREGISTREMENT, REFUS_RETRAIT, refusContrePassation, refusContrePassationSansIssue,
  refusContrePassationVente, refusEnregistrement, refusEnregistrementVente, refusRetrait, refusRetraitVente,
  type ContexteFacture, type ContexteVente, type EncaissementPourContrePassation, type FactureDuDossier,
  type FacturePourEncaissement, type LigneDeFacture, type MouvementClasse, type SaisieEncaissement,
} from './encaissementsFactures'
import { motsDuCabinet, pourLEspace } from './espaceVentes'

// LES REFUS DU REGISTRE POUR LA FACTURE D'AVANT D'UN VIREMENT MIXTE (chantier EC-Q3, ligne 28.65, étape VF5h2 ; VF5H-Q2 ;
// migration `registre_virement_mixte`, appliquée en production le 26/10/2026, `20261026000145`). Le virement
// mixte (étape VF5h) classe par ses encaissements un crédit qui paie une facture source ET une facture d'avant la bascule,
// qui n'est pas source ; pour celle-ci, la base laissait encore citer ce mouvement, retirer l'encaissement qu'il compte, ou
// le contre-passer sans débit — chaque geste changeait ce que le mouvement justifie. La migration reprend quatre fonctions
// d'hier — `enregistrer_encaissement`, `retirer_encaissement`, `annuler_encaissement` et la garde des encaissements — et
// n'y fait qu'INSÉRER des lignes : ce garde le confronte à l'export, fonction par fonction, au caractère près, puis joue
// les trois refus neufs du module (`virementMixte`), leur rang, ce qu'ils laissent passer, les mots du client, et ce que
// l'essai exige de la base (supabase/essais/ventesFacturees.sql, 93b et 140 à 144c, les mutations 177 à 182).
//
// Ailleurs : encaissementsFactures.test.ts confronte les trois listes au texte des fonctions, ordre et mots ;
// encaissementsVenteFacturee.test.ts parcourt les rangs d'une facture source ; encaissementsFenetreVente.test.ts cerne,
// sur un tirage, chaque écart d'avec les jugements d'hier ; espaceVentes.test.ts dit les phrases du client. Données
// FICTIVES.
//
// La garde des encaissements a été reprise depuis par la migration `insertion_des_encaissements` (VF5H2-Q1 et
// VF5H2Q1-Q1, deux règles de plus, à l'insertion et au rattachement), puis par `contre_passation_sur_mouvement_fige`
// (VF5H2Q1-Q2 et VF5H2Q1Q2-Q1, deux de plus) : ce garde-ci confronte la définition que CETTE migration lui donne ;
// insertionDesEncaissements.test.ts confronte la suivante à celle-ci, contrePassationSurMouvementFige.test.ts la
// dernière à la précédente.

const MIGRATION = /\/\d{14}_registre_virement_mixte\.sql$/
const texteDeLaMigration = () => fichiersDuSchema().find((f) => MIGRATION.test(f.chemin))?.texte ?? ''

// Les fonctions qu'une migration POSTÉRIEURE a reprises, et le fichier qui en porte désormais la dernière définition.
const REPRISES_DEPUIS = new Map([['garder_encaissement_facture', /\/\d{14}_contre_passation_sur_mouvement_fige\.sql$/]])

// Ce que cette migration a posé : la définition que son texte donne à une fonction — la dernière de l'export, sauf pour
// une fonction reprise depuis.
function definitionPosee(nom: string): string {
  if (!REPRISES_DEPUIS.has(nom)) return derniereDefinitionSql(nom)
  const texte = texteDeLaMigration()
  const debut = texte.indexOf(`create or replace function public.${nom}(`)
  expect(debut, nom).toBeGreaterThan(0)
  return texte.slice(debut, texte.indexOf('$$;', debut))
}

// La définition d'une fonction telle que la dernière migration AVANT celle-ci la laisse — celle que la production exécute
// aujourd'hui —, et le fichier qui la porte.
function avantLaMigration(nom: string): { chemin: string; definition: string } {
  const motif = new RegExp(`create (or replace )?function public\\.${nom}\\(`, 'g')
  const fichiers = fichiersDuSchema()
  const ici = fichiers.findIndex((f) => MIGRATION.test(f.chemin))
  expect(ici, 'la migration registre_virement_mixte dans l’export').toBeGreaterThan(0)
  const avant = fichiers.slice(0, ici).filter((f) => new RegExp(motif.source).test(f.texte))
  expect(avant.length, nom).toBeGreaterThan(0)
  const { chemin, texte } = avant[avant.length - 1]
  const positions = [...texte.matchAll(motif)].map((m) => m.index as number)
  const debut = positions[positions.length - 1]
  return { chemin, definition: texte.slice(debut, texte.indexOf('$$;', debut)) }
}

// Le fichier de l'export qui porte la DERNIÈRE définition d'une fonction : celle que la base exécutera.
function fichierDeLaDerniereDefinition(nom: string): string {
  const motif = new RegExp(`create (or replace )?function public\\.${nom}\\(`)
  const fichiers = fichiersDuSchema().filter((f) => motif.test(f.texte))
  return fichiers[fichiers.length - 1]?.chemin ?? ''
}

const corps = (definition: string) => definition.slice(definition.indexOf('as $$') + 'as $$'.length)
const md5 = (texte: string) => createHash('md5').update(texte, 'utf8').digest('hex')

// Ce que demain insère dans hier, ligne à ligne : le préfixe commun, puis le suffixe commun, borné ; null quand autre chose
// qu'une insertion a changé — une ligne d'hier retirée ou modifiée.
function insertion(hier: string, demain: string): { ligne: number; fragment: string } | null {
  const h = hier.split('\n')
  const d = demain.split('\n')
  let p = 0
  while (p < h.length && h[p] === d[p]) p++
  let s = 0
  while (s < h.length - p && s < d.length - p && h[h.length - 1 - s] === d[d.length - 1 - s]) s++
  if (p + s !== h.length) return null
  return { ligne: p, fragment: `${d.slice(p, d.length - s).join('\n')}\n` }
}

// Les quatre fonctions reprises : leur signature, l'empreinte de leur corps d'hier (celle que la production portait le
// 24/10/2026, relevée par catalogue) et la migration qui l'a écrit.
const REPRISES = [
  ['enregistrer_encaissement', 'public.enregistrer_encaissement(uuid, uuid, date, numeric, text, uuid, jsonb)', 'fff9e766b64e97cc7379bf85096842d4', 'encaissements_de_la_vente_facturee'],
  ['retirer_encaissement', 'public.retirer_encaissement(uuid, uuid)', '48a3669825dda032dd62147b3cbdc9cd', 'encaissements_de_la_vente_facturee'],
  ['annuler_encaissement', 'public.annuler_encaissement(uuid, uuid, date, text, uuid)', '93cd70fcf69ee8d76f38f33b64fc951e', 'impaye_non_declare'],
  ['garder_encaissement_facture', 'public.garder_encaissement_facture()', '533f69429909033ed7edb2ead5f7681a', 'ecritures_de_la_vente_facturee'],
] as const

// Ce que la migration change, et RIEN D'AUTRE : [fonction, ligne d'hier avant laquelle elle insère (comptée depuis
// `create`), lignes insérées]. Enregistrer : le rang 18, après le 17 de la facture source. Retirer : une branche `else`
// au `if` de la facture source — le rang 8, sous le verrou partagé du mouvement. Annuler : une branche `elsif` après le
// rang 20 — le rang 21, sous le même verrou. La garde : au retrait, après la règle de la facture source.
const INSERTIONS: readonly (readonly [string, number, string])[] = [
  [
    'enregistrer_encaissement', 113,
    "    -- Pour une facture qui n'est pas source (étape VF5h2, VF5H-Q2) : un mouvement classé par ses encaissements — ce qu'il\n    -- justifie ne change plus. Le virement mixte (étape VF5h) y compte l'encaissement d'une facture d'avant la bascule ;\n    -- un encaissement de plus en retiendrait la composition (`mouvement_ecart`, `mouvement_facture_non_source`) et\n    -- rendrait ses écritures fausses. Classé autrement — rapproché de la pièce de la facture, le plus souvent —, il se\n    -- cite comme hier.\n    if v_facture.source_de_la_vente is not true and v_mouvement.encaissements_de_factures then\n      raise exception 'Ce mouvement est déjà classé par ses encaissements : l''encaissement d''une facture qui n''est pas la source de sa vente ne s''y ajoute plus — retirer d''abord ce classement.'\n        using errcode = '22023';\n    end if;\n",
  ],
  [
    'retirer_encaissement', 51,
    "  else\n    -- Pour une facture qui n'est pas source (étape VF5h2, VF5H-Q2) : le mouvement dont il dépend — le sien, ou, pour une\n    -- contre-passation sans mouvement, celui de l'encaissement qu'elle annule — CLASSÉ PAR SES ENCAISSEMENTS. Le virement\n    -- mixte compte cet encaissement, ou l'écarte tant que la contre-passation vit : le retrait changerait ce qu'il\n    -- justifie. Classé autrement — rapproché de la pièce de la facture, le plus souvent —, il se retire comme hier. Le\n    -- verrou partagé du mouvement, comme pour une facture source : un classement concurrent attend ce retrait, puis le\n    -- voit.\n    v_ligne := coalesce(v_encaissement.ligne_bancaire_id,\n      (select c.ligne_bancaire_id from public.encaissements_factures c where c.id = v_encaissement.annule_id));\n    if v_ligne is not null then\n      select * into v_mouvement from public.lignes_bancaires l where l.id = v_ligne for share;\n      if v_mouvement.encaissements_de_factures then\n        raise exception 'Le mouvement dont dépend cet encaissement est classé par ses encaissements : le cabinet retire d''abord ce classement.'\n          using errcode = '22023';\n      end if;\n    end if;\n",
  ],
  [
    'annuler_encaissement', 131,
    "  elsif v_encaissement.ligne_bancaire_id is not null then\n    -- Pour une facture qui n'est pas source (étape VF5h2, VF5H-Q2) : le mouvement de l'encaissement contre-passé, classé\n    -- par ses encaissements — le virement mixte compte cet encaissement, et la contre-passation sans mouvement l'en\n    -- écarterait ; elle ne cite pas de débit (le rang 15). Le même verrou partagé : un classement concurrent attend, puis\n    -- la voit.\n    select l.encaissements_de_factures into v_classe from public.lignes_bancaires l\n     where l.id = v_encaissement.ligne_bancaire_id for share;\n    if v_classe then\n      raise exception 'Le mouvement de l''encaissement contre-passé est classé par ses encaissements : le cabinet retire d''abord ce classement.'\n        using errcode = '22023';\n    end if;\n",
  ],
  [
    'garder_encaissement_facture', 126,
    "    -- Pour une facture qui n'est pas source (étape VF5h2, VF5H-Q2) : ce qu'un mouvement CLASSÉ PAR SES ENCAISSEMENTS\n    -- justifie ne change pas non plus — le virement mixte compte cet encaissement, ou l'écarte tant que la contre-passation\n    -- vit. Classé autrement, il se retire comme hier.\n    if v_source is not true and exists (\n         select 1 from public.lignes_bancaires l\n          where l.id = coalesce(old.ligne_bancaire_id,\n                                (select c.ligne_bancaire_id from public.encaissements_factures c where c.id = old.annule_id))\n            and l.encaissements_de_factures) then\n      raise exception 'Le mouvement dont dépend cet encaissement est classé par ses encaissements : le cabinet retire d''abord ce classement.'\n        using errcode = '23514';\n    end if;\n",
  ],
]

// Le modèle d'un refus du module ; vide s'il n'y est pas — chaque cas le dit alors à son tour, plutôt que le fichier entier.
const modele = <C extends string>(liste: readonly { cle: C; modele: string }[], cle: C) =>
  liste.find((r) => r.cle === cle)?.modele ?? ''
const NEUF_ENREGISTRER = modele(REFUS_ENREGISTREMENT, 'mouvement_classe_facture_d_avant')
const NEUF_RETIRER = modele(REFUS_RETRAIT, 'mouvement_classe_facture_d_avant')
const NEUF_ANNULER = modele(REFUS_CONTRE_PASSATION, 'mouvement_encaissement_classe_facture_d_avant')

describe('la migration registre_virement_mixte reprend quatre fonctions d’hier, et n’y fait qu’insérer ses lignes', () => {
  it('sa garde suppose le virement mixte, puis exige le corps d’hier de chacune, celui que l’export porte avant elle', () => {
    const texte = texteDeLaMigration()
    expect(texte).not.toBe('')
    const premiereDefinition = texte.indexOf('create or replace function')
    expect(texte.indexOf("where m.name = 'virement_mixte')")).toBeGreaterThan(0)
    expect(texte.indexOf("where m.name = 'virement_mixte')")).toBeLessThan(premiereDefinition)
    for (const [nom, signature, empreinte, migration] of REPRISES) {
      const hier = avantLaMigration(nom)
      expect(md5(corps(hier.definition)), nom).toBe(empreinte)
      expect(hier.chemin, nom).toMatch(new RegExp(`/\\d{14}_${migration}\\.sql$`))
      expect(texte, nom).toContain(`('${signature}', '${empreinte}', '${migration}')`)
      expect(texte.indexOf(`'${empreinte}'`), nom).toBeLessThan(premiereDefinition)
    }
    expect(texte).toContain("md5(replace((select p.prosrc from pg_proc p where p.oid = to_regprocedure(v.fonction)), chr(13), '')) <> v.empreinte then")
  })

  it('chacune est celle d’hier au caractère près, ses lignes insérées en plus ; la dernière de l’export, sauf la garde, reprise depuis', () => {
    for (const [nom, ligne, fragment] of INSERTIONS) {
      expect(fichierDeLaDerniereDefinition(nom), nom).toMatch(REPRISES_DEPUIS.get(nom) ?? MIGRATION)
      expect(insertion(avantLaMigration(nom).definition, definitionPosee(nom)), nom).toEqual({ ligne, fragment })
    }
    expect(INSERTIONS.map(([nom]) => nom)).toEqual(REPRISES.map(([nom]) => nom))
  })

  it('vire au rouge sur une dérive plantée : un mot changé hors de l’insertion, ou une ligne d’hier retirée', () => {
    const demain = derniereDefinitionSql('retirer_encaissement')
    const derive = demain.replace("raise exception 'Accès refusé à ce dossier.'", "raise exception 'Accès refusé à ce dossier !'")
    expect(derive).not.toBe(demain)
    expect(insertion(avantLaMigration('retirer_encaissement').definition, derive)).toBeNull()
    const ampute = demain.replace('  v_ligne uuid;\n', '')
    expect(ampute).not.toBe(demain)
    expect(insertion(avantLaMigration('retirer_encaissement').definition, ampute)).toBeNull()
  })

  it('les refus : un de plus par fonction, à son rang, sous ses mots et son code — rien d’autre ne bouge', () => {
    const attendus = [
      ['enregistrer_encaissement', NEUF_ENREGISTRER, '22023', modele(REFUS_ENREGISTREMENT, 'mouvement_classe'), modele(REFUS_ENREGISTREMENT, 'mouvement_deja_pris')],
      ['retirer_encaissement', NEUF_RETIRER, '22023', modele(REFUS_RETRAIT, 'mouvement_classe'), undefined],
      ['annuler_encaissement', NEUF_ANNULER, '22023', modele(REFUS_CONTRE_PASSATION, 'mouvement_encaissement_classe'), undefined],
      // La garde : la règle du rang 8, sous ses mots, après celle de la facture source, en dernier.
      ['garder_encaissement_facture', NEUF_RETIRER, '23514', modele(REFUS_RETRAIT, 'mouvement_classe'), undefined],
    ] as const
    for (const [nom, neuf, code, precedent, suivant] of attendus) {
      const hier = avantLaMigration(nom).definition
      const demain = definitionPosee(nom)
      const k = messagesSql(demain).indexOf(neuf)
      expect(k, nom).toBeGreaterThan(0)
      expect(messagesSql(demain).filter((m) => m === neuf), nom).toHaveLength(1)
      expect(messagesSql(demain).toSpliced(k, 1), nom).toEqual(messagesSql(hier))
      expect(codesSql(demain).toSpliced(k, 1), nom).toEqual(codesSql(hier))
      expect(codesSql(demain)[k], nom).toBe(code)
      expect(messagesSql(demain)[k - 1], nom).toBe(precedent)
      expect(messagesSql(demain)[k + 1], nom).toBe(suivant)
    }
    // Le module les range au même rang que la base : le 18e, le 8e, le 21e (le premier, l'accès, compté).
    expect(REFUS_ENREGISTREMENT.findIndex((r) => r.cle === 'mouvement_classe_facture_d_avant')).toBe(17)
    expect(REFUS_RETRAIT.findIndex((r) => r.cle === 'mouvement_classe_facture_d_avant')).toBe(7)
    expect(REFUS_CONTRE_PASSATION.findIndex((r) => r.cle === 'mouvement_encaissement_classe_facture_d_avant')).toBe(20)
    expect(messagesSql(derniereDefinitionSql('enregistrer_encaissement')).indexOf(NEUF_ENREGISTRER)).toBe(17)
    expect(messagesSql(derniereDefinitionSql('retirer_encaissement')).indexOf(NEUF_RETIRER)).toBe(7)
    expect(messagesSql(derniereDefinitionSql('annuler_encaissement')).indexOf(NEUF_ANNULER)).toBe(20)
  })

  it('la condition : une facture qui n’est pas source — `is not true`, du côté fermé —, sur un mouvement classé par ses encaissements', () => {
    expect(derniereDefinitionSql('enregistrer_encaissement'))
      .toContain('if v_facture.source_de_la_vente is not true and v_mouvement.encaissements_de_factures then')
    // Retirer et annuler : la branche que la facture source ne prend pas, sur le mouvement lu sous verrou partagé.
    expect(derniereDefinitionSql('retirer_encaissement'))
      .toMatch(/ {2}else\n(?: {4}--[^\n]*\n)+ {4}v_ligne := coalesce\(v_encaissement\.ligne_bancaire_id,/)
    expect(derniereDefinitionSql('retirer_encaissement'))
      .toContain('select * into v_mouvement from public.lignes_bancaires l where l.id = v_ligne for share;\n      if v_mouvement.encaissements_de_factures then')
    expect(derniereDefinitionSql('annuler_encaissement'))
      .toContain('select l.encaissements_de_factures into v_classe from public.lignes_bancaires l\n     where l.id = v_encaissement.ligne_bancaire_id for share;\n    if v_classe then')
    expect(derniereDefinitionSql('garder_encaissement_facture')).toContain('if v_source is not true and exists (')
  })

  it('le texte : une seule définition de chacune, ni droits rejoués ni commentaire ni objet retiré, aucune barre oblique inverse', () => {
    const texte = texteDeLaMigration()
    for (const [nom] of REPRISES) {
      expect(texte.match(new RegExp(`create or replace function public\\.${nom}\\(`, 'g')), nom).toHaveLength(1)
    }
    expect(texte.match(/create (or replace )?function/g)).toHaveLength(4)
    expect(texte).not.toMatch(/\b(grant|revoke|drop|truncate|alter)\b/i)
    expect(texte).not.toMatch(/\b(create|drop)\s+(table|policy|trigger|index|view)\b/i)
    // `create or replace` garde le commentaire de chaque fonction, son propriétaire et ses droits : rien ne se rejoue.
    expect(texte).not.toMatch(/\bcomment on\b/i)
    expect(texte).not.toMatch(/\bdelete from\b/i)
    // Le mot « delete » n'y vient que de la garde reprise, qui nomme l'opération qu'elle refuse, comme hier.
    const garde = avantLaMigration('garder_encaissement_facture').definition
    expect(texte.match(/delete/gi)?.length ?? 0).toBe(garde.match(/delete/gi)?.length ?? 0)
    expect(texte).not.toContain('\\')
    expect(texte).not.toContain('\r')
  })
})

// ── Le module, avant le clic ──────────────────────────────────────────────────────────────────────────────────────────

const D = 'd1'
const AUJOURD_HUI = '2027-11-02'

// F1, la facture source du virement mixte ; F2, la facture d'avant la bascule, qui n'est pas source : 100 € à 20 %.
const LIGNES: LigneDeFacture[] = [
  { facture_id: 'f1', ordre: 1, designation: 'a', quantite: 1, prix_unitaire_ht: 1000, taux_tva: 20 },
  { facture_id: 'f2', ordre: 1, designation: 'a', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20 },
]

function facture(o: Partial<FacturePourEncaissement> = {}): FacturePourEncaissement {
  return {
    id: 'f2', dossier_id: D, statut: 'validee', type: 'facture', numero: 'F2026-0001', date_emission: '2026-10-01',
    emetteur_siret: '12345678200010', montant_ht: 100, montant_tva: 20, montant_ttc: 120, superpdp_invoice_id: null,
    tiers_nom: 'Client Fictif SAS', source_de_la_vente: false, ...o,
  }
}

function contexte(o: Partial<ContexteFacture> = {}): ContexteFacture {
  return {
    dossierId: D, facture: facture(), lignes: LIGNES, transmissions: [], evenementsSuperpdp: [], statutsRecus: [],
    encaissements: [], parts: [], ...o,
  }
}

function factureDuDossier(o: Partial<FactureDuDossier>): FactureDuDossier {
  return { id: 'f1', dossier_id: D, numero: 'F2027-0001', type: 'facture', statut: 'validee', facture_origine_id: null, source_de_la_vente: true, ...o }
}

const FACTURES: FactureDuDossier[] = [factureDuDossier({}), factureDuDossier({ id: 'f2', numero: 'F2026-0001', source_de_la_vente: false })]

function vente(o: Partial<ContexteVente> = {}): ContexteVente {
  return { anneesValidees: [], factures: FACTURES, ...o }
}

function mouvement(o: Partial<MouvementClasse> = {}): MouvementClasse {
  return {
    id: 'm1', dossier_id: D, date: '2027-10-15', montant: 1320, statut: 'non_rapprochee', piece_id: null, cotisation_id: null,
    categorie_id: null, emprunt_id: null, compte_bilan: null, declaration_tva_id: null, ventilee: false, reglement_groupe: false,
    prelevement_personnel: false, encaissements_de_factures: false, ...o,
  }
}

// Le virement mixte classé : M1 paie F1 (1 200 €) et F2 (120 €), classé par ses encaissements.
const VIREMENT_MIXTE = mouvement({ statut: 'rapprochee', encaissements_de_factures: true })

function encaissement(o: Partial<EncaissementPourContrePassation> = {}): EncaissementPourContrePassation {
  return {
    id: 'e2', dossier_id: D, facture_id: 'f2', montant: 120, ligne_bancaire_id: 'm1', annule_id: null, retire_le: null,
    date_encaissement: '2027-10-15', ...o,
  }
}

function saisie(o: Partial<SaisieEncaissement> = {}): SaisieEncaissement {
  return { date: '2027-10-15', montant: 10, moyen: 'virement', ligneBancaireId: 'm1', repartition: [{ taux: 20, montant: 10 }], ...o }
}

// Chaque autre classement qu'un mouvement peut porter : la facture d'avant s'y comporte comme hier.
const AUTREMENT: [string, Partial<MouvementClasse>][] = [
  ['libre', {}],
  ['rapproché de la pièce de la facture', { statut: 'rapprochee', piece_id: 'p1' }],
  ['une catégorie', { statut: 'rapprochee', categorie_id: 'k1' }],
  ['un compte de bilan', { statut: 'rapprochee', compte_bilan: '580000' }],
  ['ventilé', { statut: 'rapprochee', ventilee: true }],
  ['un règlement groupé', { statut: 'rapprochee', reglement_groupe: true }],
  ['écarté', { statut: 'ignoree' }],
]

describe('refusEnregistrementVente — le rang 18 : la facture d’avant ne cite pas un mouvement classé par ses encaissements', () => {
  const refusV = (c: ContexteFacture, s: SaisieEncaissement, m: MouvementClasse[] = [VIREMENT_MIXTE], banque = true) =>
    refusEnregistrementVente(c, s, m, AUJOURD_HUI, banque, vente())

  it('cité, le virement mixte classé se refuse, sous les mots de la base', () => {
    expect(refusV(contexte(), saisie())).toEqual({ cle: 'mouvement_classe_facture_d_avant', message: NEUF_ENREGISTRER })
  })

  it('après la date, le montant, le moyen, le droit « Banque », un autre dossier et un débit ; avant tout ce qui suit le rang 17', () => {
    expect(refusV(contexte(), saisie({ date: null }))?.cle).toBe('date_absente')
    expect(refusV(contexte(), saisie({ montant: 0 }))?.cle).toBe('montant_positif')
    expect(refusV(contexte(), saisie({ moyen: 'troc' }))?.cle).toBe('moyen_inconnu')
    expect(refusV(contexte(), saisie(), [VIREMENT_MIXTE], false)?.cle).toBe('mouvement_sans_banque')
    expect(refusV(contexte(), saisie(), [{ ...VIREMENT_MIXTE, dossier_id: 'd2' }])?.cle).toBe('mouvement_hors_dossier')
    expect(refusV(contexte(), saisie(), [{ ...VIREMENT_MIXTE, montant: -1320 }])?.cle).toBe('mouvement_debit')
    // Le rang 19 (« justifie déjà ») : l'encaissement de F2 que le virement compte déjà — le rang 18 d'abord.
    const deja = contexte({ encaissements: [encaissement()] })
    expect(refusV(deja, saisie())?.cle).toBe('mouvement_classe_facture_d_avant')
    expect(refusEnregistrement(deja, saisie(), [VIREMENT_MIXTE], AUJOURD_HUI, true)?.cle).toBe('mouvement_deja_pris')
    // L'écart des frais, la répartition, le plafond : après lui.
    const plein = contexte({ encaissements: [encaissement({ id: 'e1', facture_id: 'f1', montant: 1320 })] })
    expect(refusEnregistrement(plein, saisie(), [VIREMENT_MIXTE], AUJOURD_HUI, true)?.cle).toBe('mouvement_depasse')
    expect(refusV(plein, saisie())?.cle).toBe('mouvement_classe_facture_d_avant')
    expect(refusV(contexte(), saisie({ repartition: [] }))?.cle).toBe('mouvement_classe_facture_d_avant')
    expect(refusV(contexte(), saisie({ montant: 121, repartition: [{ taux: 20, montant: 121 }] }))?.cle).toBe('mouvement_classe_facture_d_avant')
  })

  it('sur un mouvement libre ou classé autrement, sans mouvement : comme hier', () => {
    for (const [quoi, o] of AUTREMENT) {
      const m = [mouvement(o)]
      expect(refusV(contexte(), saisie(), m), quoi).toEqual(refusEnregistrement(contexte(), saisie(), m, AUJOURD_HUI, true))
      expect(refusV(contexte(), saisie(), m), quoi).toBeNull()
    }
    expect(refusV(contexte(), saisie({ ligneBancaireId: null }))).toBeNull()
  })

  it('la facture source du même virement : le rang 17, sous ses mots d’hier ; sans la vente, le rang 18 ne se juge pas', () => {
    const source = contexte({ facture: facture({ id: 'f1', numero: 'F2027-0001', montant_ht: 1000, montant_tva: 200, montant_ttc: 1200, source_de_la_vente: true }) })
    expect(refusV(source, saisie())).toEqual({ cle: 'mouvement_classe', message: modele(REFUS_ENREGISTREMENT, 'mouvement_classe') })
    // Le jugement d'hier ne lit pas ce qui classe un mouvement : il ne dit ni l'un ni l'autre.
    expect(refusEnregistrement(contexte(), saisie(), [VIREMENT_MIXTE], AUJOURD_HUI, true)).toBeNull()
  })
})

describe('refusRetraitVente — le rang 8 : l’encaissement que compte le virement mixte classé ne se retire pas', () => {
  const vide = new Set<string>()
  const refusR = (encaissements: EncaissementPourContrePassation[], id = 'e2', m: MouvementClasse[] = [VIREMENT_MIXTE], v = vente(), declares = vide) =>
    refusRetraitVente(D, id, encaissements, declares, m, v)

  it('le sien, ou celui de la contre-passation sans mouvement qui l’en écarte : refusé, sous les mots de la base', () => {
    expect(refusR([encaissement()])).toEqual({ cle: 'mouvement_classe_facture_d_avant', message: NEUF_RETIRER })
    const annulation = encaissement({ id: 'c2', montant: -120, ligne_bancaire_id: null, annule_id: 'e2' })
    expect(refusR([encaissement(), annulation], 'c2')).toEqual({ cle: 'mouvement_classe_facture_d_avant', message: NEUF_RETIRER })
  })

  it('après les refus d’hier : introuvable, déjà retiré, déclaré, annulé', () => {
    expect(refusR([encaissement()], 'inconnu')?.cle).toBe('encaissement_introuvable')
    expect(refusR([encaissement({ retire_le: '2027-10-20T10:00:00Z' })])?.cle).toBe('deja_retire')
    expect(refusR([encaissement()], 'e2', [VIREMENT_MIXTE], vente(), new Set(['e2']))?.cle).toBe('declare')
    const annulation = encaissement({ id: 'c2', montant: -120, ligne_bancaire_id: null, annule_id: 'e2' })
    expect(refusR([encaissement(), annulation])?.cle).toBe('annule')
  })

  it('sur un mouvement libre ou classé autrement, sans mouvement : comme hier', () => {
    for (const [quoi, o] of AUTREMENT) {
      expect(refusR([encaissement()], 'e2', [mouvement(o)]), quoi).toEqual(refusRetrait(D, 'e2', [encaissement()], vide))
      expect(refusR([encaissement()], 'e2', [mouvement(o)]), quoi).toBeNull()
    }
    expect(refusR([encaissement({ ligne_bancaire_id: null })])).toBeNull()
  })

  it('une facture que la lecture n’a pas rendue n’est pas source : le rang 8, du côté fermé ; la facture source, ses rangs d’hier', () => {
    expect(refusR([encaissement({ facture_id: 'f9' })])?.cle).toBe('mouvement_classe_facture_d_avant')
    const source = encaissement({ id: 'e1', facture_id: 'f1', montant: 1200 })
    expect(refusR([source], 'e1')).toEqual({ cle: 'mouvement_classe', message: modele(REFUS_RETRAIT, 'mouvement_classe') })
    expect(refusR([{ ...source, date_encaissement: '2026-06-01' }], 'e1', [VIREMENT_MIXTE], vente({ anneesValidees: [2026] }))?.cle)
      .toBe('frontiere')
    // La facture d'avant n'a pas de frontière : un exercice validé ne la retient pas avant le rang 8.
    expect(refusR([encaissement({ date_encaissement: '2026-06-01' })], 'e2', [mouvement()], vente({ anneesValidees: [2026] }))).toBeNull()
  })
})

describe('refusContrePassationVente — le rang 21 : sans débit, l’encaissement que compte le virement mixte classé ne se contre-passe pas', () => {
  const DECLARE = [{ encaissement_id: 'e2', etat: 'depose' as const }]
  const DEBIT = mouvement({ id: 'm_debit', montant: -120, date: '2027-10-25' })
  const refusC = (o: { encaissements?: EncaissementPourContrePassation[]; date?: string | null; motif?: string | null; ligne?: string | null;
    mouvements?: MouvementClasse[]; banque?: boolean; v?: ContexteVente; declarations?: typeof DECLARE } = {}) =>
    refusContrePassationVente(D, 'e2', o.encaissements ?? [encaissement()], o.declarations ?? DECLARE, o.date === undefined ? '2027-10-25' : o.date,
      o.motif === undefined ? 'Virement rendu' : o.motif, AUJOURD_HUI, o.ligne ?? null, o.mouvements ?? [VIREMENT_MIXTE, DEBIT], o.banque ?? true,
      o.v ?? vente())

  it('déclaré, sans débit : refusé, sous les mots de la base — avec ou sans « Banque »', () => {
    expect(refusC()).toEqual({ cle: 'mouvement_encaissement_classe_facture_d_avant', message: NEUF_ANNULER })
    expect(refusC({ banque: false })).toEqual({ cle: 'mouvement_encaissement_classe_facture_d_avant', message: NEUF_ANNULER })
  })

  it('en dernier : les refus d’hier d’abord — non déclaré, la date, le motif — ; un débit cité, le rang 15', () => {
    expect(refusC({ declarations: [] })?.cle).toBe('non_declare')
    expect(refusC({ date: null })?.cle).toBe('date_absente')
    expect(refusC({ date: '2027-10-14' })?.cle).toBe('date_avant_encaissement')
    expect(refusC({ motif: ' ' })?.cle).toBe('motif_absent')
    expect(refusC({ motif: 'x'.repeat(2001) })?.cle).toBe('motif_trop_long')
    expect(refusC({ ligne: 'm_debit' })?.cle).toBe('mouvement_non_source')
    expect(refusC({ ligne: 'm_debit', banque: false })?.cle).toBe('mouvement_sans_banque')
  })

  it('sur un mouvement libre ou classé autrement, ou sans mouvement : comme hier', () => {
    const hier = (e: EncaissementPourContrePassation) =>
      refusContrePassation(D, 'e2', [e], DECLARE, '2027-10-25', 'Virement rendu', AUJOURD_HUI)
    for (const [quoi, o] of AUTREMENT) {
      expect(refusC({ mouvements: [mouvement(o), DEBIT] }), quoi).toEqual(hier(encaissement()))
      expect(refusC({ mouvements: [mouvement(o), DEBIT] }), quoi).toBeNull()
    }
    expect(refusC({ encaissements: [encaissement({ ligne_bancaire_id: null })] })).toBeNull()
  })

  it('une facture que la lecture n’a pas rendue : le rang 21, du côté fermé ; la facture source, le rang 20 sous ses mots d’hier', () => {
    expect(refusC({ encaissements: [encaissement({ facture_id: 'f9' })] })?.cle).toBe('mouvement_encaissement_classe_facture_d_avant')
    const source = encaissement({ facture_id: 'f1', montant: 1200 })
    expect(refusC({ encaissements: [source] })).toEqual({
      cle: 'mouvement_encaissement_classe', message: modele(REFUS_CONTRE_PASSATION, 'mouvement_encaissement_classe'),
    })
  })
})

describe('refusContrePassationSansIssue — le rang 21 se dit avant la saisie : « Contre-passer » ne s’offre pas', () => {
  const DECLARE = [{ encaissement_id: 'e2', etat: 'depose' as const }]
  const DEBIT = mouvement({ id: 'm_debit', montant: -120, date: '2027-10-25' })
  const sansIssue = (o: { encaissements?: EncaissementPourContrePassation[]; mouvements?: MouvementClasse[]; v?: ContexteVente } = {}) =>
    refusContrePassationSansIssue(D, 'e2', o.encaissements ?? [encaissement()], o.mouvements ?? [VIREMENT_MIXTE, DEBIT], o.v ?? vente())

  it('le virement mixte classé : le refus du rang 21, sous les mots de la base — et aucune saisie n’aboutit', () => {
    expect(sansIssue()).toEqual({ cle: 'mouvement_encaissement_classe_facture_d_avant', message: NEUF_ANNULER })
    // Sans débit le rang 21, avec un débit le rang 15 : quelles que soient la date et le motif, la base refuse.
    for (const ligne of [null, 'm_debit']) {
      for (const [date, motif] of [['2027-10-25', 'Virement rendu'], ['2027-10-20', 'Chèque revenu impayé'], ['2027-11-02', 'x']]) {
        expect(refusContrePassationVente(D, 'e2', [encaissement()], DECLARE, date, motif, AUJOURD_HUI, ligne, [VIREMENT_MIXTE, DEBIT],
          true, vente()), `${ligne} ${date}`).not.toBeNull()
      }
    }
  })

  it('un mouvement libre ou classé autrement, aucun mouvement, la facture source, le relevé non lu : rien d’avance', () => {
    for (const [quoi, o] of AUTREMENT) expect(sansIssue({ mouvements: [mouvement(o), DEBIT] }), quoi).toBeNull()
    expect(sansIssue({ encaissements: [encaissement({ ligne_bancaire_id: null })] })).toBeNull()
    expect(sansIssue({ encaissements: [encaissement({ facture_id: 'f1', montant: 1200 })] })).toBeNull()
    expect(sansIssue({ mouvements: [] })).toBeNull()
  })

  it('une facture que la lecture n’a pas rendue : le refus, du côté fermé ; un autre dossier ou un encaissement absent : rien', () => {
    expect(sansIssue({ encaissements: [encaissement({ facture_id: 'f9' })] })?.cle).toBe('mouvement_encaissement_classe_facture_d_avant')
    expect(sansIssue({ encaissements: [encaissement({ dossier_id: 'd2' })] })).toBeNull()
    expect(sansIssue({ encaissements: [] })).toBeNull()
  })
})

describe('les mots du client et l’essai', () => {
  it('le client lit les trois refus tutoyés, son cabinet qui retire le classement, sans aucune forme du cabinet', () => {
    for (const neuf of [NEUF_ENREGISTRER, NEUF_RETIRER, NEUF_ANNULER]) {
      const client = pourLEspace('client', neuf)
      expect(client, neuf).toContain("ton cabinet retire d'abord ce classement")
      expect(client, neuf).not.toContain("— retirer d'abord")
      expect(motsDuCabinet(client), client).toEqual([])
      expect(pourLEspace('cabinet', neuf)).toBe(neuf)
    }
  })

  it('l’essai les exige de la base, sous leurs mots et leur code, au cabinet comme au client ; la garde au rôle des Edge Functions', () => {
    const refus = refusExigesParLEssai()
    const exigePar = (neuf: string, code: string) =>
      new Set(refus.filter((e) => e.code === code && correspondAuModele(neuf, e.attendu)).map((e) => e.profil))
    expect([...exigePar(NEUF_ENREGISTRER, '22023')].sort()).toEqual(['chef', 'client_vb'])
    expect([...exigePar(NEUF_RETIRER, '22023')].sort()).toEqual(['chef', 'client_v'])
    expect([...exigePar(NEUF_ANNULER, '22023')].sort()).toEqual(['chef', 'client_v'])
    expect([...exigePar(NEUF_RETIRER, '23514')]).toEqual(['service'])
  })

  it('l’essai joue aussi ce qu’ils laissent passer, et chacun a sa mutation, qui doit passer', () => {
    const etapes = etapesDeLEssai()
    const numero = (n: string) => etapes.find((e) => e.controle.startsWith(`${n}. `))
    for (const n of ['140d', '140e', '141c', '142c', '143d']) {
      expect(numero(n)?.code, n).toBe('OK')
    }
    // La facture source du même virement, ses refus d'hier ; un débit, le sien (le rang 16 avant le 18) ; un débit cité, le
    // rang 15.
    for (const n of ['140f', '140g', '141d', '142b', '142d']) expect(numero(n)?.code, n).toBe('22023')
    for (const n of ['177', '178', '179', '180', '181', '182']) {
      expect(numero(n)?.controle, n).toMatch(/^\d+\. MUTATION de 14\d[a-z]? : /)
      expect(numero(n)?.code, n).toBe('OK')
    }
    // 93b : hier, la contre-passation passait ; demain, le rang 21.
    expect(numero('93b')?.code).toBe('22023')
    expect(numero('93b') && correspondAuModele(NEUF_ANNULER, numero('93b')?.attendu ?? '')).toBe(true)
  })
})
