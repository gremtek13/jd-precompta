import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ROLE_AUTRES_IMPOTS, compteDesAutresImpots, lireLaPartAutresImpots, partAutresImpotsSelon } from './autresImpotsDesCotisations'
import * as module from './autresImpotsDesCotisations'
import { posteDuFormulaire, valeursDesCases } from './cases2035'
import { natOpDeLaLigne } from './champsBncDuFec'
import { libelleCompteTenu } from './comptes'
import { formatMoney as euros } from './format'
import { concordance2035 } from './concordance2035'
import {
  confirmationPaiementPersonnel, ecritureDuPaiementPersonnel, refusPaiementPersonnelSelon, REFUS_PAIEMENT_PERSONNEL,
} from './cotisationPersonnelle'
import {
  cotisationsComptees, ecritureDeLaCotisation, refusMontantsDuPaiementPersonnel, refusRapprochementCotisation,
} from './cotisationRapprochee'
import { calculerDeclaration2035, POSTE_AUTRES_IMPOTS, POSTE_COTISATIONS } from './declaration2035'
import { modeleDuDossier } from './engagement'
import { jugerLaModification, partReunie, saisieDe, valeursReunies, type ContexteDesGestes } from './gestesDesEcheances'
import { PLAN_DECALE, PLAN_PAR_DEFAUT, planDeLaReponse, rolesLusAuPlan, type PlanComptable } from './planComptable'
import { CAISSE_ABSENTE } from './recettesDeCaisse'
import { calculerSituationIntermediaire } from './situationIntermediaire'
import type { CotisationDeclaree, EcritureBrouillon, LigneBancaire, ModeComptable } from './types'
import { comptesSurPlusieursPostes } from './unCompteUnPoste'
import { AUCUNE_SAISIE_2035 } from './saisies2035'
import { NON_VALIDEE } from '../test/ecritures'
import { LIBELLES_PAR_DEFAUT, planLuDe } from '../test/modeles'
import { ROLES_DE_LA_BASE } from '../test/rolesDeLaBase'
import { definitionsSql, derniereDefinitionSql, fichiersDuSchema } from '../test/schema'
import { ventesFactureesVides } from '../test/ventesFacturees'
import { ECRITURES_LIBRES_ABSENTES } from './ecrituresLibresDesExports'

// LA PART « AUTRES IMPÔTS » D'UNE ÉCHÉANCE (EXP58-Q6, EXP58-Q7 ; la migration `autres_impots_des_cotisations`, en production depuis
// le 19/11/2026, 243, et dans l'export : supabase/schema/20261119120000_autres_impots_des_cotisations.sql).
// Le drapeau joué par un accesseur, ses deux états écrits : baissé, rien ne change, à l'octet près, même sur une échéance
// qui porterait une part ; levé, l'écriture, la 2035, la concordance, le FEC et les gestes la portent comme la base.
const drapeau = vi.hoisted(() => ({ leve: undefined as boolean | undefined }))
vi.mock('./autresImpotsDesCotisations', async (original) => {
  const vrai = await original<typeof import('./autresImpotsDesCotisations')>()
  const etat = () => drapeau.leve ?? vrai.AUTRES_IMPOTS_DES_COTISATIONS_PREVUS
  return {
    ...vrai,
    get AUTRES_IMPOTS_DES_COTISATIONS_PREVUS() { return etat() },
    partAutresImpots: (c: { montant_autres_impots?: number | null }) => vrai.partAutresImpotsSelon(etat(), c),
  }
})
afterEach(() => { drapeau.leve = undefined })
const lever = () => { drapeau.leve = true }
const baisser = () => { drapeau.leve = false }

const MIGRATION = fichiersDuSchema().find((f) => f.chemin.endsWith('_autres_impots_des_cotisations.sql'))!
// Les fichiers de l'export AVANT elle : ce que la base exécutait la veille, le drapeau baissé.
const AVANT_ELLE = (f: { chemin: string }) => !f.chemin.endsWith('_autres_impots_des_cotisations.sql')
const md5 = (t: string) => createHash('md5').update(t, 'utf8').digest('hex')
const sansApostrophes = (s: string) => s.replace(/''/g, "'").replace(/’/g, "'")
const messagesSql = (sql: string) => [...sql.matchAll(/raise exception '((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"))
const derniere = (nom: string, fichiers: { chemin: string; texte: string }[]) => {
  const d = definitionsSql(nom, fichiers)
  return d[d.length - 1].definition
}

const cotisation = (o: Partial<CotisationDeclaree> = {}): CotisationDeclaree => ({
  id: 'k1', dossier_id: 'd1', echeance: '2026-03-05', montant_appele: 500, montant_verse: null, montant_csg_crds: 60,
  montant_autres_impots: 20, previsionnel: false, created_at: '2026-01-05T09:00:00Z', paiement_personnel_le: null, ...o,
})
const mouvement = (o: Partial<LigneBancaire> = {}): LigneBancaire => ({
  id: 'l1', dossier_id: 'd1', date: '2026-03-05', montant: -500, libelle: 'PRLV URSSAF', libelle_brut: null, statut: 'rapprochee',
  piece_id: null, cotisation_id: 'k1', categorie_id: null, taux_tva: null, prelevement_personnel: false, source_fichier: null,
  emprunt_id: null, emprunt_echeance: null, emprunt_interets: null, emprunt_assurance: null, ventilee: false, reglement_groupe: false,
  compte_bilan: null, declaration_tva_id: null, id_externe: null, created_at: '2026-03-06T09:00:00Z', encaissements_de_factures: false, ...o,
})
const ecrite = (l: LigneBancaire, lignes: { compte: string; sens: 'debit' | 'credit'; montant: number }[]): EcritureBrouillon[] =>
  lignes.map((e, i) => ({
    id: `${l.id}-${i}`, dossier_id: 'd1', piece_id: null, ligne_bancaire_id: l.id, date: l.date, compte: e.compte, libelle: 'PRLV',
    montant: e.montant, sens: e.sens, statut: 'proposee', immobilisation_id: null, vehicule_id: null, declaration_tva_id: null,
    cotisation_id: null, encaissement_id: null, facture_id: null, created_at: '2026-03-06T09:00:00Z', ...NON_VALIDEE,
  }))
const lignesDe = (e: readonly { compte: string; sens: string; montant: number }[]) =>
  e.map(({ compte, sens, montant }) => `${compte}:${sens}:${montant}`).sort()
const AVEC_LE_ROLE: PlanComptable = { ...PLAN_PAR_DEFAUT, autres_impots: '637800' }

describe('le rôle des autres impôts, la migration et l’essai', () => {
  it('le rôle est celui que la migration insère au catalogue : 635 et 637, 637800, « Taxes diverses », sans préfixe, rang 660', () => {
    expect(MIGRATION, 'la migration est introuvable dans l’export').toBeDefined()
    expect(MIGRATION.texte).toContain("('autres_impots', array['635', '637'], '637800', 'Taxes diverses', null, 660);")
    expect(ROLE_AUTRES_IMPOTS).toEqual({
      role: 'autres_impots', racines: ['635', '637'], compteDefaut: '637800', libelleDefaut: 'Taxes diverses',
      prefixeAuxiliaireDefaut: null, ordre: 660,
    })
  })

  it('son empreinte est celle que planComptable.sql exige (contrôle 1sexies)', () => {
    const r = ROLE_AUTRES_IMPOTS
    const empreinte = md5(`${r.role}|${r.racines.join(',')}|${r.compteDefaut}|${r.libelleDefaut}||${r.ordre}`)
    expect(empreinte).toBe('fe86bbbb41ff8802a9559caebbc538d3')
    expect(readFileSync(new URL('../../supabase/essais/planComptable.sql', import.meta.url), 'utf8'))
      .toContain(`empreinte_roles_autres_impots constant text := '${empreinte}';`)
  })

  it('le drapeau est levé : l’export porte la migration, et la constante de l’assistant le suit', () => {
    const dansLExport = fichiersDuSchema().some((f) => f.chemin.endsWith('_autres_impots_des_cotisations.sql'))
    expect(dansLExport).toBe(true)
    expect(module.AUTRES_IMPOTS_DES_COTISATIONS_PREVUS).toBe(true)
    const assistant = readFileSync(new URL('../../supabase/functions/agent-comptable/index.ts', import.meta.url), 'utf8')
    const lignes = [...assistant.matchAll(/^const AUTRES_IMPOTS_DES_COTISATIONS_PREVUS = (true|false)$/gm)]
    expect(lignes).toHaveLength(1)
    expect(lignes[0][1] === 'true').toBe(module.AUTRES_IMPOTS_DES_COTISATIONS_PREVUS)
  })

  it('la base écrit les quatre lignes du rapprochement et les trois du paiement personnel que le module compose', () => {
    // La migration est la dernière définition de l'export : c'est elle que la base exécute.
    for (const nom of ['rapprocher_cotisation', 'enregistrer_paiement_personnel_cotisation', 'garder_paiement_personnel']) {
      expect(derniereDefinitionSql(nom), nom).toBe(derniere(nom, [MIGRATION]))
    }
    const rapprocher = derniere('rapprocher_cotisation', [MIGRATION])
    expect(rapprocher).toContain("  v_compte_impots := public.compte_du_role(v_ligne.dossier_id, 'autres_impots');")
    expect(rapprocher).toContain('      (v_compte_cotisations, v_sens_compte, v_total - v_csg - v_impots),\n'
      + '      (v_compte_exploitant, v_sens_compte, v_csg),\n      (v_compte_impots, v_sens_compte, v_impots)\n')
    const personnel = derniere('enregistrer_paiement_personnel_cotisation', [MIGRATION])
    expect(personnel).toContain("  v_compte_impots := public.compte_du_role(p_dossier_id, 'autres_impots');")
    expect(personnel).toContain('      (v_compte_cotisations, v_sens_charge, v_net - v_part),\n      (v_compte_impots, v_sens_charge, v_part),\n'
      + '      (v_compte, v_sens_dirigeant, v_net)\n')
    expect(derniere('garder_paiement_personnel', [MIGRATION])).toContain('new.montant_csg_crds, new.montant_autres_impots, new.dossier_id')
  })

  it('les refus du paiement personnel : baissé, ceux de l’export d’avant elle ; levé, ceux de la migration, dans son ordre', () => {
    expect(refusPaiementPersonnelSelon(false).map((r) => r.modele))
      .toEqual(messagesSql(derniereDefinitionSql('enregistrer_paiement_personnel_cotisation', AVANT_ELLE)))
    expect(refusPaiementPersonnelSelon(true).map((r) => r.modele))
      .toEqual(messagesSql(derniereDefinitionSql('enregistrer_paiement_personnel_cotisation')))
    expect(refusPaiementPersonnelSelon(true).map((r) => r.modele))
      .toEqual(messagesSql(derniere('enregistrer_paiement_personnel_cotisation', [MIGRATION])))
    expect(refusPaiementPersonnelSelon(false)).toBe(REFUS_PAIEMENT_PERSONNEL)
  })

  it('les refus du rapprochement : ceux de la migration, à leur rang, sous ses mots', () => {
    lever()
    const sql = sansApostrophes(derniere('rapprocher_cotisation', [MIGRATION]))
    let position = sql.indexOf('dépasse le mouvement (% €)') // le dernier refus de la CSG-CRDS
    expect(position).toBeGreaterThan(0)
    for (const [c, l] of [
      [cotisation({ montant_autres_impots: 20.005 }), mouvement()],
      [cotisation({ montant_csg_crds: null }), mouvement({ montant: -10 })],
      [cotisation({ montant_autres_impots: 450 }), mouvement()],
    ] as const) {
      const refus = refusRapprochementCotisation(l, c, 'tresorerie')!
      const fixe = sansApostrophes(refus).replace(/\([^)]*€\)/g, '(% €)')
      const ici = sql.indexOf(fixe)
      expect(ici, fixe).toBeGreaterThan(position)
      position = ici
    }
  })
})

describe('le compte, la part saisie', () => {
  it('le compte du plan, sinon le défaut du catalogue', () => {
    expect(compteDesAutresImpots(PLAN_PAR_DEFAUT)).toBe('637800')
    expect(compteDesAutresImpots({ ...PLAN_PAR_DEFAUT, autres_impots: '635800' })).toBe('635800')
  })

  it('la part : nulle le drapeau baissé ou sans saisie ; sa valeur absolue sinon', () => {
    expect(partAutresImpotsSelon(false, { montant_autres_impots: 20 })).toBeNull()
    expect(partAutresImpotsSelon(true, { montant_autres_impots: null })).toBeNull()
    expect(partAutresImpotsSelon(true, {})).toBeNull()
    expect(partAutresImpotsSelon(true, { montant_autres_impots: -20 })).toBe(20)
  })

  it('une part tapée : vide, positive au centime, jamais zéro ni négative', () => {
    expect(lireLaPartAutresImpots('')).toEqual({ ok: true, valeur: null })
    expect(lireLaPartAutresImpots(' 20,5 ')).toEqual({ ok: true, valeur: 20.5 })
    expect(lireLaPartAutresImpots('0')).toEqual({ ok: false, message: 'Une part « autres impôts » de zéro se laisse vide.' })
    expect(lireLaPartAutresImpots('-3')).toMatchObject({ ok: false })
    expect(lireLaPartAutresImpots('1.005')).toEqual({ ok: false, message: 'La part « autres impôts » n’est pas au centime.' })
    expect(lireLaPartAutresImpots('douze')).toMatchObject({ ok: false })
  })

  it('le libellé du 637800 et du 635800, le drapeau levé seulement', () => {
    lever()
    expect(libelleCompteTenu('637800')).toBe('Taxes diverses')
    expect(libelleCompteTenu('635800')).toBe('Autres droits')
    baisser()
    expect(libelleCompteTenu('637800')).toBeNull()
  })
})

describe('drapeau baissé : rien ne change, même sur une échéance qui porte une part', () => {
  it('l’écriture, les refus, la part comptée et la lecture du plan sont ceux d’hier', () => {
    baisser()
    expect(lignesDe(ecritureDeLaCotisation(mouvement(), cotisation(), 'tresorerie', PLAN_PAR_DEFAUT)))
      .toEqual(['108000:debit:60', '512000:credit:500', '646000:debit:440'])
    expect(refusRapprochementCotisation(mouvement(), cotisation({ montant_autres_impots: 9999 }), 'tresorerie')).toBeNull()
    expect(cotisationsComptees([cotisation()], [mouvement()], 'tresorerie')[0].autresImpots).toBeNull()
    expect(rolesLusAuPlan().some((r) => r.role === 'autres_impots')).toBe(false)
  })
})

describe('drapeau levé : l’écriture d’une échéance', () => {
  it('rapprochée en trésorerie : la part au 637800, la cotisation hors CSG-CRDS et hors part, la CSG-CRDS au 108000 (l’essai, étape 3)', () => {
    lever()
    expect(lignesDe(ecritureDeLaCotisation(mouvement(), cotisation(), 'tresorerie', AVEC_LE_ROLE)))
      .toEqual(['108000:debit:60', '512000:credit:500', '637800:debit:20', '646000:debit:420'])
  })

  it('en engagement, la part se sépare, la CSG-CRDS reste au 646000 (étape 3e)', () => {
    lever()
    expect(lignesDe(ecritureDeLaCotisation(mouvement(), cotisation(), 'engagement', AVEC_LE_ROLE)))
      .toEqual(['512000:credit:500', '637800:debit:20', '646000:debit:480'])
  })

  it('un remboursement la crédite (étape 3g) ; une échéance toute de CSG-CRDS et de part n’a pas de ligne de cotisation (3i)', () => {
    lever()
    const remboursement = cotisation({ montant_appele: -300, montant_csg_crds: 30, montant_autres_impots: 10 })
    expect(lignesDe(ecritureDeLaCotisation(mouvement({ montant: 300 }), remboursement, 'tresorerie', AVEC_LE_ROLE)))
      .toEqual(['108000:credit:30', '512000:debit:300', '637800:credit:10', '646000:credit:260'])
    expect(lignesDe(ecritureDeLaCotisation(mouvement({ montant: -80 }), cotisation({ montant_appele: 80 }), 'tresorerie', AVEC_LE_ROLE)))
      .toEqual(['108000:debit:60', '512000:credit:80', '637800:debit:20'])
  })

  it('le compte du plan du dossier (3k) : le plan décalé au 635800', () => {
    lever()
    expect(lignesDe(ecritureDeLaCotisation(mouvement(), cotisation(), 'tresorerie', { ...PLAN_DECALE, autres_impots: '635800' })))
      .toEqual(['108100:debit:60', '512100:credit:500', '635800:debit:20', '646100:debit:420'])
  })

  it('les refus : au millième ; avec la CSG-CRDS, plus fort que le mouvement ; seule en engagement', () => {
    lever()
    expect(refusRapprochementCotisation(mouvement(), cotisation({ montant_autres_impots: 20.005 }), 'tresorerie'))
      .toBe('La part « autres impôts » de cette échéance n’est pas au centime.')
    expect(refusRapprochementCotisation(mouvement(), cotisation({ montant_autres_impots: 450 }), 'tresorerie'))
      .toBe(`La CSG-CRDS et la part « autres impôts » de cette échéance (${euros(510)}) dépassent le mouvement (${euros(500)}).`)
    expect(refusRapprochementCotisation(mouvement(), cotisation({ montant_autres_impots: 600 }), 'engagement'))
      .toBe(`La part « autres impôts » de cette échéance (${euros(600)}) dépasse le mouvement (${euros(500)}).`)
    expect(refusRapprochementCotisation(mouvement(), cotisation({ montant_autres_impots: 440 }), 'tresorerie')).toBeNull()
  })

  it('payée depuis le compte personnel : trois lignes, face au dirigeant pour l’échéance hors CSG-CRDS (étapes 4 et 4d)', () => {
    lever()
    const { modele: tresorerie } = modeleDuDossier({ mode_comptable: 'tresorerie', compte_notes_de_frais: '455000' }, planLuDe(AVEC_LE_ROLE))
    const { modele: engagement } = modeleDuDossier({ mode_comptable: 'engagement', compte_notes_de_frais: '455000' }, planLuDe(AVEC_LE_ROLE))
    if (!tresorerie || !engagement) throw new Error('modèle refusé')
    expect(lignesDe(ecritureDuPaiementPersonnel(cotisation(), tresorerie)))
      .toEqual(['108000:credit:440', '637800:debit:20', '646000:debit:420'])
    expect(lignesDe(ecritureDuPaiementPersonnel(cotisation(), engagement)))
      .toEqual(['455000:credit:500', '637800:debit:20', '646000:debit:480'])
    expect(confirmationPaiementPersonnel(cotisation(), '2026-03-10', tresorerie))
      .toContain(`Le brouillon reçoit ${euros(420)} au débit du 646000 et ${euros(20)} du 637800, face au 108000, à cette date.`)
    expect(refusMontantsDuPaiementPersonnel(cotisation({ montant_autres_impots: 450 }), 'tresorerie')?.message)
      .toBe('La CSG-CRDS et la part « autres impôts » de cette échéance (510,00 €) dépassent son montant (500,00 €).')
    expect(refusMontantsDuPaiementPersonnel(cotisation({ montant_autres_impots: 600 }), 'engagement')?.message)
      .toBe('La part « autres impôts » de cette échéance (600,00 €) dépasse son montant (500,00 €).')
  })

  it('la lecture du plan exige le rôle, sous ses racines, sans préfixe', () => {
    lever()
    // La base rend le rôle depuis la migration : il est dans `ROLES_DE_LA_BASE`, une fois.
    expect(ROLES_DE_LA_BASE.filter((r) => r.role === 'autres_impots')).toEqual([ROLE_AUTRES_IMPOTS])
    const lignes = ROLES_DE_LA_BASE.map((r) => ({
      role: r.role, compte: r.compteDefaut, libelle: LIBELLES_PAR_DEFAUT[r.role as keyof typeof LIBELLES_PAR_DEFAUT] ?? r.libelleDefaut,
      prefixe_auxiliaire: r.prefixeAuxiliaireDefaut, origine: 'application',
    }))
    expect(planDeLaReponse({ data: lignes, error: null }).plan?.autres_impots).toBe('637800')
    expect(planDeLaReponse({ data: lignes.filter((l) => l.role !== 'autres_impots'), error: null }).motif)
      .toBe('plan comptable incomplet : le rôle des autres impôts est absent (autres_impots)')
    expect(planDeLaReponse({ data: lignes.map((l) => (l.role === 'autres_impots' ? { ...l, compte: '646100' } : l)), error: null }).motif)
      .toBe('plan comptable illisible : « 646100 » n’est pas un compte du rôle « autres_impots »')
  })
})

describe('drapeau levé : la 2035, la concordance, le FEC, la situation', () => {
  const declaration = (mode: ModeComptable = 'tresorerie', c = cotisation()) => calculerDeclaration2035(
    2026, [], [], [], cotisationsComptees([c], [mouvement()], mode), [], false, new Map(), [], [], AVEC_LE_ROLE,
    ventesFactureesVides('d1'), { etat: 'sans_bascule' }, CAISSE_ABSENTE, ECRITURES_LIBRES_ABSENTES,
  )

  it('la part quitte BK et BT et entre en BS ; le résultat ne change pas ; le revenu brut social baisse d’autant', () => {
    baisser()
    const hier = valeursDesCases(declaration(), AUCUNE_SAISIE_2035).valeurs
    lever()
    const d = declaration()
    const aujourdhui = valeursDesCases(d, AUCUNE_SAISIE_2035).valeurs
    expect(d.depenses.map((l) => `${l.poste}:${l.montant}`).sort())
      .toEqual([`${POSTE_AUTRES_IMPOTS}:20`, 'CSG déductible:42.06', `${POSTE_COTISATIONS}:420`])
    expect([hier.get('BK'), hier.get('BT'), hier.get('BS') ?? 0]).toEqual([440, 440, 0])
    expect([aujourdhui.get('BK'), aujourdhui.get('BT'), aujourdhui.get('BS')]).toEqual([420, 420, 20])
    expect(aujourdhui.get('CR')).toBe(hier.get('CR'))
    expect((aujourdhui.get('DC') ?? 0) - (hier.get('DC') ?? 0)).toBe(20)
    expect(d.contributions.filter((c) => c.poste === POSTE_AUTRES_IMPOTS).map((c) => c.compte)).toEqual(['637800'])
  })

  it('la concordance tient avec l’écriture à quatre lignes, et dit l’écriture d’hier « à réécrire »', () => {
    lever()
    const contexte = { piecesValidees: new Set<string>(), piecesImmobilisees: new Set<string>(), mouvementsDesVentesFacturees: new Set<string>() }
    const quatre = ecrite(mouvement(), ecritureDeLaCotisation(mouvement(), cotisation(), 'tresorerie', AVEC_LE_ROLE))
    expect(concordance2035(declaration(), quatre, contexte, null).concorde).toBe(true)
    baisser()
    const trois = ecrite(mouvement(), ecritureDeLaCotisation(mouvement(), cotisation(), 'tresorerie', AVEC_LE_ROLE))
    lever()
    const c = concordance2035(declaration(), trois, contexte, null)
    expect(c.concorde).toBe(false)
    expect(c.ecarts).toHaveLength(1)
  })

  it('un compte, un seul poste : le 646000 en BK, le 637800 en BS, aucune attention', () => {
    lever()
    const ecritures = ecrite(mouvement(), ecritureDeLaCotisation(mouvement(), cotisation(), 'tresorerie', AVEC_LE_ROLE))
    expect(comptesSurPlusieursPostes({
      ecritures, categories: [], pieces: [], mouvements: [mouvement()], ventilations: [], operationsDeCaisse: [], plan: AVEC_LE_ROLE,
    })).toEqual([])
    // Une catégorie au même compte et au même poste (« Impôts et taxes », la ligne 13 aussi) : rien ; à un autre poste : l'attention.
    const piece = { id: 'p1', categorie_id: 'cat' }
    const ligneDePiece = { ...ecritures[0], id: 'pp', ligne_bancaire_id: null, piece_id: 'p1', compte: '637800' }
    const avec = (poste: string) => comptesSurPlusieursPostes({
      ecritures: [...ecritures, ligneDePiece], categories: [{ id: 'cat', compte_comptable: '637800', poste_2035: poste }], pieces: [piece],
      mouvements: [mouvement()], ventilations: [], operationsDeCaisse: [], plan: AVEC_LE_ROLE,
    })
    expect(avec('Impôts et taxes')).toEqual([])
    expect(avec('Divers')).toEqual([{ annee: 2026, compte: '637800', lignesDuFormulaire: ['Autres frais divers de gestion', 'Autres impôts'] }])
  })

  it('le FEC : la ligne de la part se range « Autres impôts », sa NatOp le dit', () => {
    expect(posteDuFormulaire(POSTE_AUTRES_IMPOTS, 'depense')).toBe('Autres impôts')
    expect(natOpDeLaLigne('Cotisation sociale', { compte: '637800', poste: { de: 'moteur', poste: POSTE_AUTRES_IMPOTS } }))
      .toBe('Cotisation sociale — Autres impôts')
  })

  it('la situation intermédiaire : la part sort des cotisations et rejoint « Autres impôts », le résultat ne change pas', () => {
    const situation = () => calculerSituationIntermediaire([], [], [], cotisationsComptees([cotisation()], [mouvement()], 'tresorerie'),
      '2026-01-01', '2026-12-31', false, new Map(), 'tresorerie', [], ventesFactureesVides('d1'), AVEC_LE_ROLE, { etat: 'sans_bascule' }, CAISSE_ABSENTE, ECRITURES_LIBRES_ABSENTES)
    baisser()
    const hier = situation()
    lever()
    const aujourdhui = situation()
    expect(hier.totauxParPoste).toEqual([[POSTE_COTISATIONS, -500]])
    expect(aujourdhui.totauxParPoste.sort()).toEqual([[POSTE_AUTRES_IMPOTS, -20], [POSTE_COTISATIONS, -480]].sort())
    expect(aujourdhui.resultat).toBe(hier.resultat)
  })
})

describe('drapeau levé : « Modifier » et « Réunir »', () => {
  const contexte = (o: Partial<ContexteDesGestes> = {}): ContexteDesGestes => ({
    mode: 'tresorerie', plan: AVEC_LE_ROLE, banques: { cas: 'role', compte: PLAN_PAR_DEFAUT.banque }, mouvementDe: () => mouvement(),
    figee: () => null, dateFigee: () => null, ecritures: [], ...o,
  })

  it('la part se saisit, et la changer sur une échéance rapprochée réécrit son écriture dans le même geste', () => {
    lever()
    const c = cotisation({ montant_autres_impots: null })
    const saisie = saisieDe(c)
    expect(saisie.autresImpots).toBe('')
    const j = jugerLaModification(c, { ...saisie, autresImpots: '20' }, contexte())
    if ('refus' in j) throw new Error(j.refus.message)
    expect(j.valeurs.montant_autres_impots).toBe(20)
    expect(lignesDe(j.reecriture!.ecritures)).toEqual(['108000:debit:60', '512000:credit:500', '637800:debit:20', '646000:debit:420'])
    expect(j.effets.join(' ')).toContain(`Sa part « autres impôts » (${euros(20)}) sort de BK et entre en BS, au 637800.`)
  })

  it('une part plus forte que l’échéance avec la CSG-CRDS se refuse ; une part figée par un paiement personnel aussi', () => {
    lever()
    const c = cotisation({ montant_autres_impots: null })
    expect(jugerLaModification(c, { ...saisieDe(c), autresImpots: '450' }, contexte({ mouvementDe: () => null })))
      .toEqual({ refus: { message: `La part « autres impôts » (${euros(450)}), avec la CSG-CRDS, dépasse le montant de l’échéance (${euros(500)}).` } })
    const payee = cotisation({ paiement_personnel_le: '2026-03-10' })
    expect('refus' in jugerLaModification(payee, { ...saisieDe(payee), autresImpots: '25' }, contexte({ mouvementDe: () => null }))).toBe(true)
  })

  it('« Réunir » additionne les parts, une part absente valant zéro', () => {
    lever()
    expect(partReunie(cotisation(), cotisation({ id: 'k2', montant_autres_impots: null }))).toEqual({ montant_autres_impots: 20 })
    expect(partReunie(cotisation({ montant_autres_impots: null }), cotisation({ id: 'k2', montant_autres_impots: null })))
      .toEqual({ montant_autres_impots: null })
    expect(partReunie(cotisation(), { ...cotisation({ id: 'k2' }), montant_autres_impots: undefined })).toEqual({})
    expect(valeursReunies(cotisation(), cotisation({ id: 'k2', montant_autres_impots: 5 })).montant_autres_impots).toBe(25)
  })
})
