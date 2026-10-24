import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  TEXTE_ESSAI_ECRITURES, TRIPLETS_DU_CUMUL, attenduEnClairDeLEssai, compositionDuJeu, cumulDuModule, empreinteDAttendu,
  jeuDuDossier, jeuPourLaBase, jourDuJeu, macroDeLEssai, partsDuJeu, sourcesDuControleVue, sourcesDuJeu, uuidEssai,
  vueDesSources,
} from '../test/essaiEcrituresVentesFacturees'
import { correspondAuModele, etapesDeLEssai } from '../test/essaiVentesFacturees'
import { codesSql, messagesSql } from '../test/raiseSql'
import { derniereDefinitionSql, fichiersDuSchema } from '../test/schema'
import {
  REFUS_COMPTE_CONTREPARTIE, REFUS_ECRITURE_VENTE, REFUS_GARDE_CONTREPARTIE, REFUS_GARDE_LIGNES_VENTE,
  REFUS_RETRAIT_ECRITURE_VENTE, argumentsChoisirCompteContrepartie, argumentsEcrireVenteFacturee,
  argumentsRetirerEcritureVenteFacturee, ecrituresDeLaSource, identifiantDeLaSource, lignesDeLaSource,
  refusChoixCompteContrepartie, refusEcritureVenteFacturee, refusRetraitEcritureVenteFacturee,
  type ContexteEcritureVente, type LigneDuBrouillon, type MouvementPourEcriture,
} from './ecritureVenteFacturee'
import { refusClassement, type ExemplaireLu, type MouvementClasse } from './encaissementsFactures'
import { ecrituresDesVentesFacturees, refusCompteDeContrepartie, type SourceEcritureVente } from './ecrituresVentesFacturees'
import { PLAN_PAR_DEFAUT } from './planComptable'
import { COLONNES_GENEREES } from './sauvegarde'
import { LIBELLE_MOTIF_VENTE, type MotifVenteEcartee } from './ventesFacturees'

// LES ÉCRITURES D'UNE VENTE FACTURÉE, ENVOYÉES À LA BASE (chantier EC-Q3, étape VF4b ; migration
// `ecritures_de_la_vente_facturee`, dans l'export) : ce que le module envoie, ses refus rang par rang sur le jeu de l'essai,
// chaque liste confrontée au texte de sa fonction — dérive plantée comprise —, et l'essai confronté au module : la
// recomposition de la base, source par source, est celle que le module compose ; chaque refus que l'essai exige, le
// module le redit sous les mêmes mots.

// La migration, par son nom : sa version sera celle de son application.
const MIGRATION = /\/\d{14}_ecritures_de_la_vente_facturee\.sql$/
const TEXTE_MIGRATION = fichiersDuSchema().find((f) => MIGRATION.test(f.chemin))?.texte ?? ''
// La migration du virement mixte (étape VF5h), qui reprend deux de ces fonctions : `ecrire_vente_facturee` (le rang 16 sous
// ses mots neufs) et la garde G5 (une ligne qui porte une pièce n'est pas du troisième genre).
const TEXTE_VIREMENT_MIXTE = fichiersDuSchema().find((f) => /\/\d{14}_virement_mixte\.sql$/.test(f.chemin))?.texte ?? ''
const REPRISES_PAR_VF5H: ReadonlySet<string> = new Set(['ecrire_vente_facturee', 'garder_lignes_de_la_vente_facturee'])

const D1 = uuidEssai(1)
const D2 = uuidEssai(2)
const u = (n: number) => uuidEssai(n)

/** Le contexte du dossier du jeu en trésorerie (1, l'exercice 2025 validé) ou en engagement (2). */
function contexte(numero: 1 | 2, o: Partial<ContexteEcritureVente> = {}): ContexteEcritureVente {
  const j = jeuDuDossier(numero)
  return {
    dossierId: j.dossierId,
    ventesParLesFactures: true,
    anneesValidees: numero === 1 ? [2025] : [],
    factures: j.factures.map((f) => ({
      id: f.id, dossier_id: f.dossier_id, type: f.type, numero: f.numero, source_de_la_vente: f.source_de_la_vente,
      facture_origine_id: f.facture_origine_id,
    })),
    encaissements: j.encaissements.map((e) => ({
      id: e.id, dossier_id: e.dossier_id, facture_id: e.facture_id, date_encaissement: e.date_encaissement, montant: e.montant,
      moyen: e.moyen, ligne_bancaire_id: e.ligne_bancaire_id, annule_id: e.annule_id, retire_le: e.retire_le,
      compte_contrepartie: j.comptes.get(e.id) ?? null,
    })),
    mouvements: j.mouvements.map((m): MouvementPourEcriture => ({
      id: m.id, dossier_id: m.dossier_id, statut: m.encaissements_de_factures ? 'rapprochee' : 'non_rapprochee', piece_id: null,
      cotisation_id: null, categorie_id: null, emprunt_id: null, compte_bilan: null, declaration_tva_id: null, ventilee: false,
      reglement_groupe: false, prelevement_personnel: false, encaissements_de_factures: m.encaissements_de_factures,
    })),
    composition: compositionDuJeu(numero),
    plan: PLAN_PAR_DEFAUT,
    ...o,
  }
}

const source = (genre: SourceEcritureVente['genre'], id: string): SourceEcritureVente =>
  genre === 'encaissement' ? { genre, encaissementId: id, factureId: '' }
    : genre === 'mouvement' ? { genre, ligneBancaireId: id } : { genre, factureId: id }

const message = (liste: readonly { cle: string; modele: string }[], cle: string) => (liste.find((r) => r.cle === cle) as { modele: string }).modele

// ── Les listes, confrontées au texte des fonctions ──────────────────────────────────────────────────────────────────

type Liste = readonly { readonly cle: string; readonly modele: string; readonly code: string }[]

/** Ce qui sépare une liste du texte d'une fonction : les messages et les codes de ses `raise exception`, dans l'ordre. */
function ecartsAvecLeTexte(liste: Liste, sql: string): string[] {
  const messages = messagesSql(sql)
  const codes = codesSql(sql)
  const ecarts: string[] = []
  if (messages.length !== liste.length) ecarts.push(`${messages.length} refus dans le texte, ${liste.length} dans la liste`)
  liste.forEach((r, i) => {
    if (messages[i] !== r.modele) ecarts.push(`rang ${i + 1} (${r.cle}) : « ${messages[i]} » au lieu de « ${r.modele} »`)
    if (codes[i] !== r.code) ecarts.push(`rang ${i + 1} (${r.cle}) : ${codes[i]} au lieu de ${r.code}`)
  })
  return ecarts
}

const FONCTIONS: readonly (readonly [string, Liste])[] = [
  ['ecrire_vente_facturee', REFUS_ECRITURE_VENTE],
  ['retirer_ecriture_vente_facturee', REFUS_RETRAIT_ECRITURE_VENTE],
  ['choisir_compte_contrepartie', REFUS_COMPTE_CONTREPARTIE],
  ['garder_lignes_de_la_vente_facturee', REFUS_GARDE_LIGNES_VENTE],
]

describe('chaque liste redit sa fonction, dans son ordre, sous ses mots et ses codes', () => {
  it('les quatre fonctions neuves sont dans la migration ; leur dernière définition, la sienne ou celle du virement mixte', () => {
    for (const [nom] of FONCTIONS) {
      expect(TEXTE_MIGRATION, nom).toContain(`create function public.${nom}(`)
      const texte = REPRISES_PAR_VF5H.has(nom) ? TEXTE_VIREMENT_MIXTE : TEXTE_MIGRATION
      const debut = texte.indexOf(`${REPRISES_PAR_VF5H.has(nom) ? 'create or replace' : 'create'} function public.${nom}(`)
      expect(debut, nom).toBeGreaterThanOrEqual(0)
      expect(derniereDefinitionSql(nom), nom).toBe(texte.slice(debut, texte.indexOf('$$;', debut)))
    }
  })

  it.each(FONCTIONS)('%s', (nom, liste) => {
    expect(ecartsAvecLeTexte(liste, derniereDefinitionSql(nom))).toEqual([])
    // L'accès d'abord, partout où un appelant le demande ; la garde n'en juge pas.
    if (nom !== 'garder_lignes_de_la_vente_facturee') expect(liste[0]).toMatchObject({ cle: 'acces', code: '42501' })
  })

  it('vire au rouge sur un mot changé, un code changé, un refus retiré ou deux refus échangés', () => {
    const sql = derniereDefinitionSql('ecrire_vente_facturee')
    const mot = sql.replace('relire la source, puis la recomposer', 'relis la source, puis recompose-la')
    expect(ecartsAvecLeTexte(REFUS_ECRITURE_VENTE, mot)).toHaveLength(1)
    const code = sql.replace(/(aucune écriture ne s''y passe plus\.',[^;]*?using errcode = ')22023'/, "$123514'")
    expect(code).not.toBe(sql)
    expect(ecartsAvecLeTexte(REFUS_ECRITURE_VENTE, code)).toEqual(['rang 20 (frontiere) : 23514 au lieu de 22023'])
    const retire = sql.replace(/raise exception 'Cet encaissement s''écrit sur un compte[^;]*;/, 'null;')
    expect(retire).not.toBe(sql)
    expect(ecartsAvecLeTexte(REFUS_ECRITURE_VENTE, retire).length).toBeGreaterThan(1)
    const echange = [...REFUS_ECRITURE_VENTE]
    ;[echange[13], echange[14]] = [echange[14], echange[13]]
    expect(ecartsAvecLeTexte(echange, sql).length).toBeGreaterThan(0)
  })

  it('le motif d’une facture écartée se dit sous les mots du module des ventes facturées', () => {
    const sql = derniereDefinitionSql('ecrire_vente_facturee')
    const libelles = Object.fromEntries([...sql.matchAll(/when '(\w+)' then '((?:[^']|'')*)'/g)].map((m) => [m[1], m[2].replace(/''/g, "'")]))
    expect(libelles).toEqual(LIBELLE_MOTIF_VENTE)
    expect(Object.keys(libelles).sort()).toEqual((Object.keys(LIBELLE_MOTIF_VENTE) as MotifVenteEcartee[]).sort())
  })

  it('les refus d’un compte de contrepartie : ceux de `refusCompteDeContrepartie`, dans son ordre', () => {
    const sql = derniereDefinitionSql('refus_compte_de_contrepartie')
    const retours = [...sql.matchAll(/return '((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"))
    expect(retours).toEqual(['46', '411000', '512000', '445660'].map((c) => refusCompteDeContrepartie(c, PLAN_PAR_DEFAUT)))
    for (const c of ['511000', '530000']) expect(refusCompteDeContrepartie(c, PLAN_PAR_DEFAUT)).toBe(retours[2])
    expect(sql).toContain("coalesce(p_compte, '') !~ '^[1-5][0-9]{5,9}$'")
    expect(TEXTE_MIGRATION).toContain("check (compte_contrepartie ~ '^[1-5][0-9]{5,9}$')")
  })

  it('la garde des encaissements : celle de VF2 au caractère près, et les deux refus du compte de contrepartie', () => {
    const vf2 = fichiersDuSchema().find((f) => f.chemin.endsWith('20261019070229_encaissements_de_la_vente_facturee.sql'))?.texte ?? ''
    const corps = (texte: string) => texte.slice(texte.lastIndexOf('function public.garder_encaissement_facture()'))
      .split('$$;')[0]
    const avant = corps(vf2)
    // La définition de cette migration-ci, que la migration registre_virement_mixte (étape VF5h2) reprend ensuite pour une
    // règle de plus au retrait (registreVirementMixte.test.ts) : celle de ce fichier, non la dernière de l'export.
    const apres = corps(TEXTE_MIGRATION)
    expect(avant.length).toBeGreaterThan(1000)
    const retire = apres
      .replace(/\n {4}if new\.compte_contrepartie is not null and not public\.is_super_admin\(\) then[\s\S]*?\n {4}end if;/, '')
      .replace(/\n {4}if new\.compte_contrepartie is distinct from old\.compte_contrepartie[\s\S]*?\n {4}end if;/, '')
      .replaceAll(", 'ligne_bancaire_id', 'compte_contrepartie']", ", 'ligne_bancaire_id']")
    expect(retire).toBe(avant)
    const neufs = messagesSql(apres).filter((m) => !messagesSql(avant).includes(m))
    expect(neufs).toEqual(REFUS_GARDE_CONTREPARTIE.map((r) => r.modele))
    const codes = codesSql(apres)
    for (const r of REFUS_GARDE_CONTREPARTIE) expect(codes[messagesSql(apres).indexOf(r.modele)]).toBe(r.code)
  })

  it('les droits : le cabinet appelle les trois fonctions, personne d’autre ; les aides et la garde ne s’appellent pas', () => {
    for (const signature of ['ecrire_vente_facturee(uuid, text, uuid, jsonb)', 'retirer_ecriture_vente_facturee(uuid, text, uuid)',
      'choisir_compte_contrepartie(uuid, uuid, text)']) {
      expect(TEXTE_MIGRATION).toContain(`revoke execute on function public.${signature} from public, anon;`)
      expect(TEXTE_MIGRATION).toContain(`grant execute on function public.${signature} to authenticated;`)
    }
    for (const signature of ['refus_compte_de_contrepartie(uuid, text)', 'prorata_arrondi(bigint, bigint, bigint)',
      'calcul_vente_facturee(uuid)', 'ecriture_attendue_vente_facturee(uuid, text, uuid)', 'garder_lignes_de_la_vente_facturee()']) {
      expect(TEXTE_MIGRATION).toContain(`revoke execute on function public.${signature} from public, anon, authenticated;`)
      expect(TEXTE_MIGRATION).not.toContain(`grant execute on function public.${signature}`)
    }
  })
})

// ── Ce qu'on envoie ─────────────────────────────────────────────────────────────────────────────────────────────────

describe('ce qu’on envoie à la base', () => {
  const c1 = contexte(1)
  const c2 = contexte(2)

  it('l’identifiant d’une source', () => {
    expect(identifiantDeLaSource({ genre: 'facture', factureId: 'f' })).toBe('f')
    expect(identifiantDeLaSource({ genre: 'avoir', factureId: 'a' })).toBe('a')
    expect(identifiantDeLaSource({ genre: 'encaissement', encaissementId: 'e', factureId: 'f' })).toBe('e')
    expect(identifiantDeLaSource({ genre: 'mouvement', ligneBancaireId: 'm' })).toBe('m')
  })

  it('un encaissement : ses lignes, le montant en euros au centime, son libellé', () => {
    const a = argumentsEcrireVenteFacturee(D1, source('encaissement', u(501)), c1.composition, [2025])
    expect(a).toMatchObject({ p_dossier_id: D1, p_source: 'encaissement', p_source_id: u(501) })
    expect(a.p_lignes.map((l) => `${l.date}|${l.compte}|${l.sens}|${l.montant}|${l.ligne_bancaire_id ?? ''}`).sort()).toEqual([
      '2026-03-02|445710|credit|20|', `2026-03-02|512000|debit|120|${u(401)}`, '2026-03-02|706000|credit|100|',
    ])
    expect(new Set(a.p_lignes.map((l) => l.libelle)).size).toBe(1)
    expect(a.p_lignes[0].libelle.length).toBeGreaterThan(0)
  })

  it('une facture en engagement : ses deux écritures, l’émission et la livraison, ensemble', () => {
    const a = argumentsEcrireVenteFacturee(D2, source('facture', u(1103)), c2.composition, [])
    expect([...new Set(a.p_lignes.map((l) => l.date))].sort()).toEqual(['2026-03-04', '2026-03-09'])
    expect(a.p_lignes).toHaveLength(5)
  })

  it('après la frontière seulement : l’encaissement de 2025 n’a plus rien à envoyer', () => {
    expect(argumentsEcrireVenteFacturee(D1, source('encaissement', u(524)), c1.composition, [2025]).p_lignes).toEqual([])
    expect(argumentsEcrireVenteFacturee(D1, source('encaissement', u(524)), c1.composition, []).p_lignes).toHaveLength(3)
    expect(ecrituresDeLaSource(c1.composition, source('encaissement', u(524)), [2024])).toHaveLength(1)
  })

  it('les arguments du retrait et du choix du compte', () => {
    expect(argumentsRetirerEcritureVenteFacturee(D1, source('mouvement', u(402))))
      .toEqual({ p_dossier_id: D1, p_source: 'mouvement', p_source_id: u(402) })
    expect(argumentsChoisirCompteContrepartie(D1, u(518), '467100'))
      .toEqual({ p_dossier_id: D1, p_encaissement_id: u(518), p_compte: '467100' })
    expect(argumentsChoisirCompteContrepartie(D1, u(518), null).p_compte).toBeNull()
  })
})

// ── Ce que la base refuserait ───────────────────────────────────────────────────────────────────────────────────────

describe('les refus d’écrire, sur le jeu de l’essai', () => {
  const c1 = contexte(1)
  const refus = (genre: SourceEcritureVente['genre'], n: number, c = c1) => refusEcritureVenteFacturee(source(genre, u(n)), c)
  const cle = (genre: SourceEcritureVente['genre'], n: number, c = c1) => refus(genre, n, c)?.cle ?? null

  it('un dossier qui n’a pas basculé, avant tout', () => {
    expect(cle('facture', 1101, contexte(1, { ventesParLesFactures: false }))).toBe('dossier_non_bascule')
  })

  it('la source introuvable dans ce dossier, chaque genre', () => {
    expect(cle('facture', 1101)).toBe('facture_introuvable')
    expect(cle('facture', 301)).toBe('facture_introuvable')
    expect(cle('avoir', 101)).toBe('avoir_introuvable')
    expect(cle('encaissement', 1501)).toBe('encaissement_introuvable')
    expect(cle('mouvement', 1402)).toBe('mouvement_introuvable')
  })

  it('une source qui n’est pas celle d’une vente facturée', () => {
    expect(cle('facture', 111)).toBe('facture_non_source')
    expect(cle('avoir', 303)).toBe('avoir_non_source')
    expect(cle('encaissement', 520)).toBe('encaissement_non_source')
    expect(cle('mouvement', 411)).toBe('mouvement_sans_source')
  })

  it('une vente écartée : la facture nommée, son motif dit sous ses mots — pour la facture, son avoir, son encaissement', () => {
    const attendu = (numero: string, motif: MotifVenteEcartee) =>
      `La facture ${numero} ne se compte pas sans deviner (${LIBELLE_MOTIF_VENTE[motif]}) : ses écritures ne s'écrivent pas.`
    expect(refus('facture', 107)?.message).toBe(attendu('F2026-0007', 'encaissement_illisible'))
    expect(refus('encaissement', 512)?.message).toBe(attendu('F2026-0007', 'encaissement_illisible'))
    expect(refus('facture', 115)?.message).toBe(attendu('F2026-0014', 'nature'))
    expect(refus('facture', 116)?.message).toBe(attendu('F2026-0015', 'option_debits'))
    expect(refus('facture', 117)?.message).toBe(attendu('F2026-0016', 'sans_lignes'))
    expect(refus('encaissement', 526)?.message).toBe(attendu('F2026-0017', 'contre_passation_illisible'))
    expect(refus('avoir', 304)?.message).toBe(attendu('F2026-0018', 'ttc_nul'))
  })

  it('le compte de contrepartie, à choisir puis refusé sous les mots de la règle', () => {
    expect(cle('encaissement', 518)).toBe('compte_a_choisir')
    expect(refus('encaissement', 519)?.message).toBe(
      `Le compte de contrepartie de cet encaissement, 411000, est refusé : ${refusCompteDeContrepartie('411000', PLAN_PAR_DEFAUT)}`)
    // Le compte choisi, la composition le lit : l'encaissement s'écrit sur lui.
    const j = jeuDuDossier(1)
    const composition = ecrituresDesVentesFacturees({
      sources: { dossierId: j.dossierId, factures: j.factures, lignes: j.lignes, encaissements: j.encaissements, parts: j.parts },
      mouvements: j.mouvements, comptesDeContrepartie: new Map([...j.comptes, [u(518), '467100']]), exemplaires: j.exemplaires, mode: 'tresorerie', plan: PLAN_PAR_DEFAUT,
    })
    const choisi = contexte(1, {
      composition, encaissements: c1.encaissements.map((e) => (e.id === u(518) ? { ...e, compte_contrepartie: '467100' } : e)),
    })
    expect(cle('encaissement', 518, choisi)).toBeNull()
    expect(argumentsEcrireVenteFacturee(D1, source('encaissement', u(518)), composition, [2025]).p_lignes.map((l) => l.compte).sort())
      .toEqual(['445710', '467100', '706000'])
  })

  it('les mouvements qui ne s’écrivent pas, et pourquoi', () => {
    expect(cle('mouvement', 408)).toBe('mouvement_facture_non_source')
    expect(cle('mouvement', 410)).toBe('mouvement_vente_ecartee')
    expect(cle('mouvement', 407)).toBe('mouvement_non_classe')
    expect(cle('mouvement', 409)).toBe('mouvement_ecart')
  })

  it('rien à écrire après la frontière ; et ce qui s’écrit ne se refuse pas', () => {
    for (const [g, n] of [['facture', 101], ['encaissement', 514], ['encaissement', 524], ['mouvement', 401]] as const) {
      expect(cle(g, n), `${g} ${n}`).toBe('rien_a_ecrire')
    }
    expect(cle('encaissement', 524, contexte(1, { anneesValidees: [] }))).toBeNull()
    for (const [g, n] of [['encaissement', 501], ['facture', 103], ['facture', 104], ['avoir', 301], ['mouvement', 402],
      ['mouvement', 406], ['encaissement', 509], ['encaissement', 511]] as const) {
      expect(cle(g, n), `${g} ${n}`).toBeNull()
    }
  })
})

describe('les refus de retirer', () => {
  const c1 = contexte(1)
  const ligne = (o: Partial<LigneDuBrouillon>): LigneDuBrouillon => ({
    dossier_id: D1, statut: 'proposee', facture_id: null, encaissement_id: null, ligne_bancaire_id: null, piece_id: null,
    immobilisation_id: null, vehicule_id: null, declaration_tva_id: null, cotisation_id: null, ...o,
  })
  const cle = (genre: SourceEcritureVente['genre'], n: number, brouillon: LigneDuBrouillon[] = [], c = c1) =>
    refusRetraitEcritureVenteFacturee(source(genre, u(n)), c, brouillon)?.cle ?? null

  it('dans l’ordre de la base', () => {
    expect(cle('facture', 101, [], contexte(1, { ventesParLesFactures: false }))).toBe('dossier_non_bascule')
    expect(cle('facture', 1101)).toBe('facture_introuvable')
    expect(cle('avoir', 101)).toBe('avoir_introuvable')
    expect(cle('encaissement', 1501)).toBe('encaissement_introuvable')
    expect(cle('mouvement', 1402)).toBe('mouvement_introuvable')
    const classe = contexte(1, { mouvements: c1.mouvements.map((m) => (m.id === u(411) ? { ...m, statut: 'rapprochee', compte_bilan: '467000' } : m)) })
    expect(cle('mouvement', 411, [ligne({ ligne_bancaire_id: u(411) })], classe)).toBe('mouvement_classe_autrement')
    expect(cle('mouvement', 411, [ligne({ ligne_bancaire_id: u(411) })])).toBe('mouvement_jamais_cite')
    expect(cle('encaissement', 501, [ligne({ encaissement_id: u(501) })])).toBe('encore_a_ecrire')
    expect(cle('encaissement', 524, [ligne({ encaissement_id: u(524), statut: 'validee' })])).toBe('validees')
    expect(cle('encaissement', 514)).toBe('aucune_ecriture')
    expect(cle('mouvement', 407)).toBe('aucune_ecriture')
  })

  it('un encaissement retiré, un mouvement déclassé : leurs lignes se retirent', () => {
    expect(cle('encaissement', 514, [ligne({ encaissement_id: u(514) })])).toBeNull()
    // Déclassé, le mouvement reste réservé à son encaissement, et la composition ne l'écrit plus.
    const j = jeuDuDossier(1)
    const mouvements = j.mouvements.map((m) => (m.id === u(402) ? { ...m, encaissements_de_factures: false } : m))
    const composition = ecrituresDesVentesFacturees({
      sources: { dossierId: j.dossierId, factures: j.factures, lignes: j.lignes, encaissements: j.encaissements, parts: j.parts },
      mouvements, comptesDeContrepartie: j.comptes, exemplaires: j.exemplaires, mode: 'tresorerie', plan: PLAN_PAR_DEFAUT,
    })
    const declasse = contexte(1, {
      composition,
      mouvements: c1.mouvements.map((m) => (m.id === u(402) ? { ...m, statut: 'non_rapprochee', encaissements_de_factures: false } : m)),
    })
    expect(cle('mouvement', 402, [ligne({ ligne_bancaire_id: u(402) })], declasse)).toBeNull()
    expect(cle('mouvement', 402, [ligne({ ligne_bancaire_id: u(402) })])).toBe('encore_a_ecrire')
  })

  it('les lignes d’une source : ses colonnes, et pour un mouvement aucune autre', () => {
    const brouillon = [
      ligne({ encaissement_id: u(501), ligne_bancaire_id: u(401) }), ligne({ facture_id: u(103) }), ligne({ ligne_bancaire_id: u(402) }),
      ligne({ ligne_bancaire_id: u(402), piece_id: 'p' }), ligne({ ligne_bancaire_id: u(402), cotisation_id: 'c' }),
      ligne({ ligne_bancaire_id: u(402), dossier_id: D2 }), ligne({ ligne_bancaire_id: u(402), facture_id: u(102) }),
      ligne({ ligne_bancaire_id: u(402), encaissement_id: u(503) }), ligne({ ligne_bancaire_id: u(402), immobilisation_id: 'i' }),
      ligne({ ligne_bancaire_id: u(402), vehicule_id: 'v' }), ligne({ ligne_bancaire_id: u(402), declaration_tva_id: 'd' }),
    ]
    expect(lignesDeLaSource(brouillon, source('encaissement', u(501)), D1)).toHaveLength(1)
    expect(lignesDeLaSource(brouillon, source('facture', u(103)), D1)).toHaveLength(1)
    expect(lignesDeLaSource(brouillon, source('mouvement', u(402)), D1)).toEqual([brouillon[2]])
    expect(lignesDeLaSource(brouillon, source('mouvement', u(401)), D1)).toEqual([])
  })
})

describe('les refus d’un compte de contrepartie', () => {
  const c1 = contexte(1)
  const cle = (n: number, compte: string | null) => refusChoixCompteContrepartie(u(n), compte, c1)?.cle ?? null

  it('dans l’ordre de la base, puis la règle sous ses mots', () => {
    expect(cle(1518, '467100')).toBe('encaissement_introuvable')
    expect(cle(514, '467100')).toBe('retire')
    expect(cle(511, '467100')).toBe('contre_passation')
    expect(cle(520, '467100')).toBe('facture_non_source')
    expect(refusChoixCompteContrepartie(u(523), '467100', c1)?.message)
      .toBe("L'exercice 2025 est validé : le compte de contrepartie de cet encaissement ne change plus.")
    expect(cle(501, '467100')).toBe('cite_un_mouvement')
    expect(cle(502, '467100')).toBe('cite_un_mouvement')
    expect(cle(510, '467100')).toBe('moyen')
    expect(cle(504, '467100')).toBe('moyen')
    expect(cle(518, null)).toBe('compte_absent')
    for (const compte of ['601000', '46710', '411000', '512000', '511000', '530000', '445660']) {
      const r = refusChoixCompteContrepartie(u(518), compte, c1)
      expect(r, compte).toEqual({ cle: 'compte_refuse', message: refusCompteDeContrepartie(compte, PLAN_PAR_DEFAUT) })
    }
    expect(cle(518, '467100')).toBeNull()
    expect(cle(519, '467100')).toBeNull()
    expect(cle(523, '467100')).toBe('frontiere')
    expect(refusChoixCompteContrepartie(u(523), '467100', contexte(1, { anneesValidees: [] }))).toBeNull()
  })
})

// ── Les bornes que les mutations du module ont demandées ────────────────────────────────────────────────────────────

describe('les bornes du module', () => {
  const c1 = contexte(1)
  const c2 = contexte(2)
  const j = jeuDuDossier(1)
  const composer = (o: Partial<Parameters<typeof ecrituresDesVentesFacturees>[0]> = {}, encaissements = j.encaissements, parts = j.parts) =>
    ecrituresDesVentesFacturees({
      sources: { dossierId: j.dossierId, factures: j.factures, lignes: j.lignes, encaissements, parts },
      mouvements: j.mouvements, comptesDeContrepartie: j.comptes, exemplaires: j.exemplaires, mode: 'tresorerie', plan: PLAN_PAR_DEFAUT, ...o,
    })
  const ligne = (o: Partial<LigneDuBrouillon>): LigneDuBrouillon => ({
    dossier_id: D1, statut: 'proposee', facture_id: null, encaissement_id: null, ligne_bancaire_id: null, piece_id: null,
    immobilisation_id: null, vehicule_id: null, declaration_tva_id: null, cotisation_id: null, ...o,
  })

  it('une source d’un autre dossier, même lue avec celles du dossier, est introuvable', () => {
    const melange = contexte(1, {
      factures: [...c1.factures, ...c2.factures], encaissements: [...c1.encaissements, ...c2.encaissements],
      mouvements: [...c1.mouvements, ...c2.mouvements],
    })
    expect(refusEcritureVenteFacturee(source('facture', u(1101)), melange)?.cle).toBe('facture_introuvable')
    expect(refusEcritureVenteFacturee(source('encaissement', u(1501)), melange)?.cle).toBe('encaissement_introuvable')
    expect(refusEcritureVenteFacturee(source('mouvement', u(1402)), melange)?.cle).toBe('mouvement_introuvable')
    expect(refusRetraitEcritureVenteFacturee(source('facture', u(1101)), melange, [])?.cle).toBe('facture_introuvable')
    expect(refusChoixCompteContrepartie(u(1518), '467100', melange)?.cle).toBe('encaissement_introuvable')
  })

  it('le retrait ne demande pas que la source soit celle d’une vente facturée', () => {
    expect(refusRetraitEcritureVenteFacturee(source('facture', u(111)), c1, [])?.cle).toBe('aucune_ecriture')
    expect(refusRetraitEcritureVenteFacturee(source('avoir', u(303)), c1, [])?.cle).toBe('aucune_ecriture')
  })

  it('un mouvement que seul cite un encaissement retiré, ou défait sans mouvement : il ne s’écrit pas, ses lignes se retirent', () => {
    const retire = j.encaissements.map((e) => (e.id === u(503) ? { ...e, retire_le: '2026-03-21T12:00:00Z' } : e))
    const sansE503 = contexte(1, {
      composition: composer({}, retire), encaissements: c1.encaissements.map((e) => (e.id === u(503) ? { ...e, retire_le: '2026-03-21T12:00:00Z' } : e)),
    })
    expect(refusEcritureVenteFacturee(source('mouvement', u(402)), sansE503)?.cle).toBe('mouvement_sans_source')
    expect(refusRetraitEcritureVenteFacturee(source('mouvement', u(402)), sansE503, [ligne({ ligne_bancaire_id: u(402) })])).toBeNull()
    const defait = { ...j.encaissements.find((e) => e.id === u(501))!, id: 'c501', montant: -120, annule_id: u(501), ligne_bancaire_id: null,
      motif: 'ESSAI', date_encaissement: '2026-03-03', cree_le: '2026-03-03T10:00:00+00:00' }
    const parts = [...j.parts, { encaissement_id: 'c501', dossier_id: D1, taux: 20, montant: -120 }]
    const sansE501 = contexte(1, {
      composition: composer({}, [...j.encaissements, defait], parts),
      encaissements: [...c1.encaissements, { ...c1.encaissements.find((e) => e.id === u(501))!, id: 'c501', montant: -120, annule_id: u(501), ligne_bancaire_id: null }],
    })
    expect(refusEcritureVenteFacturee(source('mouvement', u(401)), sansE501)?.cle).toBe('mouvement_sans_source')
  })

  it('un encaissement sur un mouvement que la composition n’a pas lu : la base en jugera', () => {
    const sans401 = contexte(1, { composition: composer({ mouvements: j.mouvements.filter((m) => m.id !== u(401)) }) })
    expect(sans401.composition.nonEcrites.some((n) => n.source.genre === 'encaissement' && n.source.encaissementId === u(501))).toBe(true)
    expect(refusEcritureVenteFacturee(source('encaissement', u(501)), sans401)).toBeNull()
  })

  it('la contre-passation sans mouvement d’un encaissement au compte refusé : le compte de cet encaissement', () => {
    const e519 = j.encaissements.find((e) => e.id === u(519))!
    const c519 = { ...e519, id: 'c519', montant: -24, annule_id: u(519), motif: 'ESSAI', date_encaissement: '2026-03-14',
      cree_le: '2026-03-14T10:00:00+00:00' }
    const contexte519 = contexte(1, {
      composition: composer({}, [...j.encaissements, c519], [...j.parts, { encaissement_id: 'c519', dossier_id: D1, taux: 20, montant: -24 }]),
      encaissements: [...c1.encaissements, { ...c1.encaissements.find((e) => e.id === u(519))!, id: 'c519', montant: -24, annule_id: u(519),
        compte_contrepartie: null }],
    })
    expect(refusEcritureVenteFacturee(source('encaissement', 'c519'), contexte519)?.message).toBe(
      `Le compte de contrepartie de cet encaissement, 411000, est refusé : ${refusCompteDeContrepartie('411000', PLAN_PAR_DEFAUT)}`)
  })

  it('le choix du compte : l’exercice qui fige est celui de l’encaissement ; une compensation qui cite un mouvement ; un compte vide', () => {
    expect(refusChoixCompteContrepartie(u(523), '467100', contexte(1, { anneesValidees: [2025, 2026] }))?.message)
      .toBe("L'exercice 2025 est validé : le compte de contrepartie de cet encaissement ne change plus.")
    const cite = contexte(1, { encaissements: c1.encaissements.map((e) => (e.id === u(518) ? { ...e, ligne_bancaire_id: u(401) } : e)) })
    expect(refusChoixCompteContrepartie(u(518), '467100', cite)?.cle).toBe('cite_un_mouvement')
    expect(refusChoixCompteContrepartie(u(518), '', c1)).toEqual({ cle: 'compte_refuse', message: refusCompteDeContrepartie('', PLAN_PAR_DEFAUT) })
  })

  it('une source se reconnaît à son genre ET à son identifiant', () => {
    expect(argumentsEcrireVenteFacturee(D1, { genre: 'avoir', factureId: u(103) }, c1.composition, [2025]).p_lignes).toEqual([])
    expect(argumentsEcrireVenteFacturee(D1, source('facture', u(103)), c1.composition, [2025]).p_lignes.length).toBeGreaterThan(0)
  })
})

// ── L'essai, confronté au module ────────────────────────────────────────────────────────────────────────────────────

describe('l’essai des écritures d’une vente facturée, confronté au module', () => {
  const etapes = etapesDeLEssai(TEXTE_ESSAI_ECRITURES)
  const refusExiges = etapes.filter((e) => e.code !== '' && e.code !== 'OK')
  const valeur = (prefixe: string) => etapes.find((e) => e.controle.startsWith(prefixe)) as (typeof etapes)[number]

  it('l’essai se lit', () => {
    expect(etapes.length).toBeGreaterThan(150)
    expect(refusExiges.length).toBeGreaterThan(100)
  })

  it('son jeu est celui du module', () => {
    expect(macroDeLEssai('JEU')).toBe(jeuPourLaBase())
    expect(jourDuJeu('2026-03-01')).toBe(0)
    expect(jourDuJeu('2025-12-20')).toBe(-71)
  })

  it('la règle du cumul : les triplets et ce que le module en rend', () => {
    const cumul = valeur('1. ')
    const triplets = [...cumul.requete.matchAll(/\((\d+), (-?\d+), (-?\d+), (-?\d+)\)/g)].map((m) => [Number(m[2]), Number(m[3]), Number(m[4])])
    expect(triplets).toEqual(TRIPLETS_DU_CUMUL.map((t) => [...t]))
    expect(cumul.attendu).toBe(cumulDuModule())
  })

  // Les attendus longs sont leur empreinte, et leur texte en commentaire au-dessus du contrôle : les deux, ceux du module.
  it('les parts du jeu : celles du module', () => {
    expect(valeur('2. ').attendu).toBe(empreinteDAttendu(partsDuJeu()))
    expect(attenduEnClairDeLEssai('2')).toBe(partsDuJeu())
  })

  it('chaque source du jeu, une fois, rendue comme le module la compose dans les deux modèles', () => {
    // Huit depuis l'étape VF5h : le 6b, le virement mixte.
    const vues = etapes.filter((e) => sourcesDuControleVue(e.requete).length > 0)
    expect(vues).toHaveLength(8)
    for (const v of vues) {
      const attendue = vueDesSources(sourcesDuControleVue(v.requete))
      expect(v.attendu, v.controle).toBe(empreinteDAttendu(attendue))
      expect(attenduEnClairDeLEssai(v.controle.split('.')[0]), v.controle).toBe(attendue)
    }
    const vus = vues.flatMap((v) => sourcesDuControleVue(v.requete)).map(([g, n]) => `${g}${n}`)
    expect(new Set(vus).size).toBe(vus.length)
    expect([...vus].sort()).toEqual(sourcesDuJeu().map(([g, n]) => `${g}${n}`).sort())
  })

  it('vire au rouge sur une ligne déplacée', () => {
    const vue = etapes.find((e) => e.controle.startsWith('4. ')) as (typeof etapes)[number]
    const clair = attenduEnClairDeLEssai('4') as string
    expect(clair).toContain('512+12000@401')
    expect(empreinteDAttendu(clair.replace('512+12000@401', '512+12000'))).not.toBe(vue.attendu)
    expect(empreinteDAttendu(clair)).toBe(vue.attendu)
  })

  const LISTES: readonly Liste[] = [REFUS_ECRITURE_VENTE, REFUS_RETRAIT_ECRITURE_VENTE, REFUS_COMPTE_CONTREPARTIE,
    REFUS_GARDE_LIGNES_VENTE, REFUS_GARDE_CONTREPARTIE]

  it('chaque refus qu’il exige est dans une liste du module, sous le même code — ou un refus d’hier, nommé', () => {
    // Ce que l'essai exige d'autre que ses fonctions : le refus de l'anonyme (le droit d'exécuter), celui de G2 sur les
    // chemins d'hier, la garde des colonnes de VF2, et deux refus d'hier des fonctions du relevé et de VF2.
    const HIER = [
      'permission denied for function ecrire_vente_facturee',
      'Ce mouvement est classé par ses encaissements : il ne reçoit aucun autre classement — le cabinet retire d\'abord celui-ci.',
      'Une écriture ne porte une facture ou un encaissement que par la fonction qui écrit la vente facturée.',
      'Ce mouvement n\'est affecté à aucune catégorie.',
    ]
    for (const e of refusExiges) {
      const dansUneListe = LISTES.some((l) => l.some((r) => r.code === e.code && correspondAuModele(r.modele, e.attendu)))
      expect(dansUneListe || HIER.includes(e.attendu), `${e.controle} : ${e.code} ${e.attendu}`).toBe(true)
    }
  })

  it('chaque refus des listes y est exigé, sauf la suppression directe (jouée sur la réplique)', () => {
    const exige = (r: Liste[number]) => refusExiges.some((e) => e.code === r.code && correspondAuModele(r.modele, e.attendu))
    const absents = LISTES.flatMap((l) => l.filter((r) => !exige(r)).map((r) => r.cle))
    expect(absents).toEqual(['retrait_hors_fonction'])
  })

  // Les contrôles qui écrivent ou retirent sans lignes (« '[]' ») une source de R ou de N, et ceux qui choisissent un
  // compte : la base y refuse ce que le module redit avant le clic, sous les mêmes mots.
  const D3 = uuidEssai(3)
  const idDe = (texte: string) => (/^\{U\}(\d{5})$/.exec(texte) ? uuidEssai(Number(texte.slice(3))) : texte)

  it('chaque refus d’écrire ou de retirer que l’essai exige pour une source, le module le redit sous les mêmes mots', () => {
    const appel = /^select (ecrire_vente_facturee|retirer_ecriture_vente_facturee)\('([^']+)', '(\w+)', '([^']+)'(?:, '\[\]')?\)$/
    let confrontes = 0
    for (const e of refusExiges) {
      const m = appel.exec(e.requete.trim())
      if (!m || e.profil !== 'chef' || e.code === '42501') continue
      const dossier = m[2] === '{D3}' ? D3 : m[2]
      if (![D1, D3].includes(dossier) || (m[1] === 'ecrire_vente_facturee' && !e.requete.endsWith("'[]')"))) continue
      const c = contexte(1, dossier === D3 ? { ventesParLesFactures: false } : {})
      const genre = m[3] as SourceEcritureVente['genre']
      if (!['facture', 'avoir', 'encaissement', 'mouvement'].includes(genre)) continue
      const s = source(genre, idDe(m[4]))
      const r = m[1] === 'ecrire_vente_facturee' ? refusEcritureVenteFacturee(s, c) : refusRetraitEcritureVenteFacturee(s, c, [])
      // Écrire « [] » une source qui a des lignes : la base dit « pas celle qu'elle recompose », que le module ne dit pas
      // — il envoie la composition.
      if (e.attendu === message(REFUS_ECRITURE_VENTE, 'ecriture_differente')) {
        expect(r, e.controle).toBeNull()
        continue
      }
      // Retirer une source dont le brouillon porte des lignes (le jeu de l'essai) : le module, sans brouillon, dit « aucune ».
      if (m[1] === 'retirer_ecriture_vente_facturee' && r?.cle === 'aucune_ecriture' && e.attendu !== r.message) continue
      // Un motif LIKE de l'essai, fini par « % », est le début du message.
      const attendu = e.attendu.endsWith('%') ? (r?.message ?? '').startsWith(e.attendu.slice(0, -1)) : r?.message === e.attendu
      expect(attendu, `${e.controle} : ${e.attendu} — le module : ${r?.message}`).toBe(true)
      confrontes++
    }
    expect(confrontes).toBeGreaterThan(35)
  })

  // Le virement mixte (étape VF5h, 53 à 57) : le mouvement du jeu, classé par la restauration, déclassé d'abord ; puis
  // `refusClassement` dit ce que la base refuse — l'exemplaire à désigner, la facture au plus petit numéro —, la pièce que
  // le contrôle désigne en plus comprise, et ne refuse rien du mouvement qui se classe.
  it('chaque refus du classement d’un mouvement mixte que l’essai exige, le module le redit (étape VF5h)', () => {
    const j = jeuDuDossier(1)
    const declasse = (id: string): MouvementClasse[] => j.mouvements.map((m) => ({
      id: m.id, dossier_id: m.dossier_id, date: m.date, montant: m.montant,
      statut: m.id === id || !m.encaissements_de_factures ? 'non_rapprochee' : 'rapprochee',
      encaissements_de_factures: m.id === id ? false : m.encaissements_de_factures,
      piece_id: null, cotisation_id: null, categorie_id: null, emprunt_id: null, compte_bilan: null, declaration_tva_id: null,
      ventilee: false, reglement_groupe: false, prelevement_personnel: false,
    }))
    const vente = { anneesValidees: [2025], factures: j.factures }
    const appel = /select retirer_classement_par_encaissements\('\{D1\}', '\{U\}(\d{5})'\); select classer_mouvement_par_encaissements\('\{D1\}', '\{U\}\1'\)$/
    const designee = /^insert into pieces \([^)]*\) values \('\{X\}', '\{D1\}', [^;]*'\{U\}(\d{5})'\);/
    let confrontes = 0
    for (const e of refusExiges) {
      const m = appel.exec(e.requete.trim())
      if (!m) continue
      const d = designee.exec(e.requete.trim())
      const exemplaires: ExemplaireLu[] = d
        ? [...j.exemplaires, { id: 'x', dossier_id: j.dossierId, facture_id: u(Number(d[1])), statut: 'validee', type_piece: 'vente' }]
        : j.exemplaires
      const r = refusClassement(j.dossierId, u(Number(m[1])), declasse(u(Number(m[1]))), j.encaissements, vente, exemplaires)
      expect(`${e.code} ${r?.message}`, e.controle).toBe(`22023 ${e.attendu}`)
      confrontes++
    }
    expect(confrontes).toBe(4)
    expect(refusClassement(j.dossierId, u(420), declasse(u(420)), j.encaissements, vente, j.exemplaires)).toBeNull()
    expect(valeur('53. ').attendu).toBe('rapprochee|true')
  })

  it('chaque refus du choix d’un compte que l’essai exige, le module le redit', () => {
    const appel = /^select choisir_compte_contrepartie\('([^']+)', '([^']+)', (?:'(\d+)'|null)\)$/
    let confrontes = 0
    for (const e of refusExiges) {
      const m = appel.exec(e.requete.trim())
      if (!m || e.profil !== 'chef') continue
      const r = refusChoixCompteContrepartie(m[2], m[3] ?? null, contexte(1))
      expect(r?.message, `${e.controle} : ${e.attendu}`).toBe(e.attendu)
      confrontes++
    }
    expect(confrontes).toBe(16)
  })
})

// ── La sauvegarde ───────────────────────────────────────────────────────────────────────────────────────────────────

describe('le compte de contrepartie à la sauvegarde', () => {
  it('une colonne ordinaire, recopiée avec sa ligne : rien n’est généré', () => {
    expect(COLONNES_GENEREES.encaissements_factures ?? []).not.toContain('compte_contrepartie')
  })

  it('l’essai de restauration le contrôle, ou dit qu’il attend la migration', () => {
    const essai = readFileSync(new URL('../../supabase/essais/restauration.sql', import.meta.url), 'utf8')
    const bloc = essai.slice(essai.indexOf('-- LE COMPTE DE CONTREPARTIE D\'UN ENCAISSEMENT'), essai.indexOf('select controle, attendu, observe'))
    expect(bloc).toContain('s.compte_contrepartie is not null')
    expect(bloc).toContain('e.compte_contrepartie = s.compte_contrepartie')
    expect(bloc).toContain('EN ATTENTE de la migration ecritures_de_la_vente_facturee')
  })
})
