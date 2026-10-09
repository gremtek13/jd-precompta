import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { SEUIL_ALIGNEMENT_PLAFOND_EUR, SEUIL_ALIGNEMENT_RELATIF, seuilAlignement } from './alignementBanque'
import {
  BORNE_MONTANT_EUROS, DATE_PLANCHER, ETATS_DECLARANTS, LONGUEUR_MAX_TEXTE, MOYENS_ENCAISSEMENT, REFUS_CONTRE_PASSATION,
  REFUS_DECLARATION, REFUS_ENREGISTREMENT, REFUS_RETRAIT, SEUIL_PLAFOND_CENTIMES, SEUIL_POUR_CENT, STATUT_DEPOSEE_SUPERPDP,
  centimesExacts, contrePassationDe, echeanceDeDeclaration, ecartDeFrais, encaissementsDeclares, euroCommeLaBase,
  obligationEncaissee, piecesJumelles, plateformeAcceptee, plateformeDeLaDeclaration, propositionsEncaissement,
  refusContrePassation, refusDeclaration, refusDeLaFacture, refusEnregistrement, refusRetrait, remplirModele,
  repartitionProposee, resteAEncaisser, tauxCommeLaBase, ttcParTaux,
  type CleRefusContrePassation, type ContexteFacture, type DeclarationLue, type EcheanceDeclaration, type EncaissementLu,
  type EncaissementPourContrePassation, type FacturePourEncaissement, type FacturePourObligation, type LigneDeFacture,
  type MouvementPropose, type PartLue, type PieceLue, type SaisieEncaissement, type StatutPlateformeLu,
  type TransmissionPourDeclaration,
} from './encaissementsFactures'
import { montantsDuDocument, TAUX_ADMIS } from './factureCii'
import { formatMoney } from './format'
import { paiementsDesPieces, type LignePayante, type PartReglee } from './rattachement'
import { DEBUT_EMISSION_PME } from './statutTva'
import { STATUTS_ANNULATION_PLATEFORME, STATUTS_ANNULATION_SUPERPDP } from './transmissionsFactures'
import type { MoyenEncaissement, StatutTva } from './types'
import { tirage } from '../test/encaissementsBatterie'
import { derniereDefinitionSql, fichiersDuSchema } from '../test/schema'

// LE MODULE DES ENCAISSEMENTS D'UNE FACTURE ÉMISE (ligne 28.5, étape d2), confronté à ce qui fait foi : la migration
// d1 (supabase/schema/20261008180607_encaissements_des_factures.sql) pour l'ordre et les mots des refus, ses
// constantes et ses formats ; l'essai joué en production (supabase/essais/encaissementsFactures.sql, 107 contrôles sur
// 107 le 08/10/2026) pour les messages que la base a rendus, valeurs comprises.

const MIGRATION = readFileSync(
  new URL('../../supabase/schema/20261008180607_encaissements_des_factures.sql', import.meta.url), 'utf8')
const ESSAI = readFileSync(new URL('../../supabase/essais/encaissementsFactures.sql', import.meta.url), 'utf8')

const D = 'd1'
const AUJOURD_HUI = '2027-11-02'

// La facture de l'essai (`fm`) : 1 200,00 € à 20 %, 105,50 € à 5,5 %, 50,00 € à 0 % — 1 355,50 € TTC.
const LIGNES: LigneDeFacture[] = [
  { facture_id: 'f1', ordre: 1, designation: 'a', quantite: 1, prix_unitaire_ht: 1000, taux_tva: 20 },
  { facture_id: 'f1', ordre: 2, designation: 'b', quantite: 1, prix_unitaire_ht: 100, taux_tva: 5.5 },
  { facture_id: 'f1', ordre: 3, designation: 'c', quantite: 1, prix_unitaire_ht: 50, taux_tva: 0 },
]

function facture(o: Partial<FacturePourEncaissement> = {}): FacturePourEncaissement {
  return {
    id: 'f1', dossier_id: D, statut: 'validee', type: 'facture', numero: 'F2027-0042', date_emission: '2027-10-01',
    emetteur_siret: '12345678200010',
    montant_ht: 1150, montant_tva: 205.5, montant_ttc: 1355.5, superpdp_invoice_id: null, tiers_nom: 'Client Fictif SAS',
    ...o,
  }
}

function contexte(o: Partial<ContexteFacture> = {}): ContexteFacture {
  return {
    dossierId: D, facture: facture(), lignes: LIGNES, transmissions: [], evenementsSuperpdp: [], statutsRecus: [], encaissements: [],
    parts: [],
    ...o,
  }
}

function encaissement(o: Partial<EncaissementLu> = {}): EncaissementLu {
  return { id: 'e1', dossier_id: D, facture_id: 'f1', montant: 100, ligne_bancaire_id: null, annule_id: null, retire_le: null, ...o }
}

function part(o: Partial<PartLue> = {}): PartLue {
  return { encaissement_id: 'e1', taux: 20, montant: 100, ...o }
}

function mouvement(o: Partial<MouvementPropose> = {}): MouvementPropose {
  return {
    id: 'm1', dossier_id: D, date: '2027-10-15', montant: 1355.5, libelle: 'VIR SEPA', libelle_brut: null,
    prelevement_personnel: false, compte_bilan: null, emprunt_id: null, declaration_tva_id: null, cotisation_id: null,
    ...o,
  }
}

function saisie(o: Partial<SaisieEncaissement> = {}): SaisieEncaissement {
  return { date: '2027-10-15', montant: 100, moyen: 'virement', ligneBancaireId: null, repartition: [{ taux: 20, montant: 100 }], ...o }
}

// Les mouvements de l'essai : 1 355,50 €, 100 €, 1 000 €, 98 €, un débit, zéro, et un crédit d'un autre dossier.
const MOUVEMENTS: MouvementPropose[] = [
  mouvement({ id: 'm_credit', montant: 1355.5 }), mouvement({ id: 'm_cent', montant: 100 }),
  mouvement({ id: 'm_mille', montant: 1000 }), mouvement({ id: 'm_98', montant: 98 }),
  mouvement({ id: 'm_debit', montant: -50 }), mouvement({ id: 'm_zero', montant: 0 }),
  mouvement({ id: 'm_autre', dossier_id: 'd2', montant: 100 }),
]

const refus = (c: ContexteFacture, s: SaisieEncaissement, mouvements: readonly MouvementPropose[] = MOUVEMENTS) =>
  refusEnregistrement(c, s, mouvements, AUJOURD_HUI)

// ── La migration, lue ──────────────────────────────────────────────────────────────────────────────────────────────

// Les messages des `raise exception` d'une fonction, dans l'ordre du texte, l'apostrophe doublée de SQL rendue simple.
function messagesSql(sql: string): string[] {
  return [...sql.matchAll(/raise exception '((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"))
}

// Ce qui suit le message d'un `raise exception`, jusqu'à `using errcode` : les valeurs qui remplissent ses « % ».
function argumentsSql(sql: string): string[][] {
  return [...sql.matchAll(/raise exception '(?:[^']|'')*'([\s\S]*?)using errcode/g)].map((m) => {
    const texte = m[1].replace(/\s+/g, ' ').trim().replace(/^,\s*/, '').replace(/\s*$/, '')
    if (!texte) return []
    // Découpe sur les virgules de premier niveau, hors chaînes.
    const valeurs: string[] = []
    let profondeur = 0
    let chaine = false
    let courant = ''
    for (const car of texte) {
      if (car === "'") chaine = !chaine
      if (!chaine && car === '(') profondeur++
      if (!chaine && car === ')') profondeur--
      if (!chaine && profondeur === 0 && car === ',') {
        valeurs.push(courant.trim())
        courant = ''
      } else courant += car
    }
    valeurs.push(courant.trim())
    return valeurs
  })
}

// Le message qu'un contrôle de l'essai attend de la base, et qu'elle a rendu en production : la dernière chaîne de sa
// ligne de VALUES — `('28. …', prep, appel, '22023', 'message')`. Un motif LIKE finit par « % ».
function messageDeLEssai(numero: string): string {
  const m = new RegExp(`\\('${numero}\\. [\\s\\S]*?'(?:22023|P0002)', '((?:[^']|'')*)'\\)`).exec(ESSAI)
  expect(m, `contrôle ${numero} de l’essai`).not.toBeNull()
  return (m as RegExpExecArray)[1].replace(/''/g, "'")
}

function attendreLeMessageDeLEssai(numero: string, recu: string | undefined) {
  const attendu = messageDeLEssai(numero)
  if (attendu.endsWith('%')) expect(recu?.startsWith(attendu.slice(0, -1)), `${numero} : ${recu}`).toBe(true)
  else expect(recu, numero).toBe(attendu)
}

describe('les moyens de paiement', () => {
  const listeDe = (re: RegExp) => [...((re.exec(MIGRATION) as RegExpExecArray)[1]).matchAll(/'(\w+)'/g)].map((m) => m[1])

  it('sont ceux de la contrainte de la table et de la fonction, dans leur ordre', () => {
    const table = listeDe(/constraint encaissements_factures_moyen\s+check \(moyen in \(([^)]*)\)\)/)
    const fonction = [...((/p_moyen not in \(([^)]*)\)/.exec(derniereDefinitionSql('enregistrer_encaissement')) as RegExpExecArray)[1])
      .matchAll(/'(\w+)'/g)].map((m) => m[1])
    expect(table).toHaveLength(8)
    expect(MOYENS_ENCAISSEMENT.map((m) => m.moyen)).toEqual(table)
    expect(MOYENS_ENCAISSEMENT.map((m) => m.moyen)).toEqual(fonction)
  })

  it('ont chacun un libellé, et la date à retenir là seulement où la doctrine la dit', () => {
    const libelles = MOYENS_ENCAISSEMENT.map((m) => m.libelle)
    expect(libelles).toEqual(['Virement', 'Chèque', 'Carte bancaire', 'Prélèvement', 'Espèces', 'Effet de commerce', 'Compensation', 'Autre'])
    const avecDate = MOYENS_ENCAISSEMENT.filter((m) => m.dateARetenir != null).map((m) => m.moyen)
    expect(avecDate).toEqual<MoyenEncaissement[]>(['virement', 'cheque', 'especes', 'effet'])
    const cheque = MOYENS_ENCAISSEMENT.find((m) => m.moyen === 'cheque')?.dateARetenir
    expect(cheque).toMatch(/remis/)
    expect(cheque).toMatch(/pas celui de son crédit/)
  })
})

// ── L'obligation ────────────────────────────────────────────────────────────────────────────────────────────────────

describe('obligationEncaissee — le statut « Encaissée » est-il dû pour cette facture ?', () => {
  const PRESTATION: FacturePourObligation = {
    id: 'f1', statut: 'validee', type: 'facture', date_emission: '2027-10-01',
    type_client: 'assujetti', nature_operation: 'services', option_debits: false,
  }
  const TAXEE = [{ facture_id: 'f1', taux_tva: 20 }]
  const SANS_TVA = [{ facture_id: 'f1', taux_tva: 0 }]
  const obligation = (o: Partial<FacturePourObligation>, statut: StatutTva | null = 'redevable', lignes = TAXEE) =>
    obligationEncaissee({ ...PRESTATION, ...o }, lignes, statut)

  it('due : des prestations de services, TVA à l’encaissement, à une entreprise ou à un organisme public', () => {
    for (const type_client of ['assujetti', 'organisme_public'] as const) {
      const o = obligation({ type_client })
      expect(o.etat).toBe('due')
      expect(o.raison).toBe('Due : des prestations de services, dont la TVA est due à l’encaissement.')
    }
  })

  it('due pour un dossier en franchise, sans TVA', () => {
    const o = obligation({}, 'franchise', SANS_TVA)
    expect(o).toEqual({ etat: 'due', raison: 'Due : des prestations de services d’un dossier en franchise en base, déclarées sans TVA.' })
  })

  it('facultative pour une facture émise avant le 1er septembre 2027, due dès ce jour', () => {
    expect(DEBUT_EMISSION_PME).toBe('2027-09-01')
    const veille = obligation({ date_emission: '2027-08-31' })
    expect(veille.etat).toBe('facultative')
    expect(veille.raison).toBe('Facultative : la facture est du 31/08/2027, et pour une PME ou une micro-entreprise '
      + 'l’obligation ne vaut que pour les factures émises à partir du 1er septembre 2027.')
    expect(obligation({ date_emission: '2027-09-01' }).etat).toBe('due')
    expect(obligation({ date_emission: '2026-09-15' }, 'franchise', SANS_TVA).etat).toBe('facultative')
  })

  it('sans objet : un brouillon, un avoir', () => {
    expect(obligation({ statut: 'brouillon' })).toEqual({ etat: 'sans_objet', raison: 'Sans objet : un brouillon n’est pas encore une facture.' })
    expect(obligation({ type: 'avoir' })).toEqual({
      etat: 'sans_objet', raison: 'Sans objet : un avoir ne s’encaisse pas ; seule une facture reçoit le statut « Encaissée ».',
    })
  })

  it('sans objet : un dossier exonéré', () => {
    expect(obligation({}, 'exonere', SANS_TVA)).toEqual({
      etat: 'sans_objet',
      raison: 'Sans objet : le dossier est exonéré de TVA, et ses opérations exonérées sortent de la facturation électronique.',
    })
  })

  it('sans objet : un particulier, un client établi hors de France — l’e-reporting', () => {
    expect(obligation({ type_client: 'non_assujetti' })).toEqual({
      etat: 'sans_objet', raison: 'Sans objet : la facture est adressée à un particulier ; ses paiements se déclareront par l’e-reporting.',
    })
    expect(obligation({ type_client: 'etranger' })).toEqual({
      etat: 'sans_objet', raison: 'Sans objet : le client est établi hors de France ; ses paiements se déclareront par l’e-reporting.',
    })
  })

  it('sans objet : une livraison de biens, une option pour les débits', () => {
    expect(obligation({ nature_operation: 'biens' })).toEqual({
      etat: 'sans_objet', raison: 'Sans objet : la TVA d’une livraison de biens est due à la livraison, pas à l’encaissement.',
    })
    for (const nature_operation of ['services', 'mixte'] as const) {
      expect(obligation({ nature_operation, option_debits: true })).toEqual({
        etat: 'sans_objet',
        raison: 'Sans objet : le dossier avait opté pour la TVA sur les débits : elle est due à la facture, pas à l’encaissement.',
      })
    }
  })

  it('sans objet : la facture d’un redevable qui ne porte aucune TVA — ses lignes seules comptent', () => {
    const attendu = { etat: 'sans_objet', raison: 'Sans objet : aucune ligne de la facture ne porte de TVA, et seule une TVA due à l’encaissement se déclare ainsi.' }
    expect(obligation({}, 'redevable', SANS_TVA)).toEqual(attendu)
    expect(obligation({}, 'redevable', [...SANS_TVA, { facture_id: 'f1', taux_tva: 0 }])).toEqual(attendu)
    // Une ligne taxée d'une AUTRE facture ne la rend pas taxée.
    expect(obligation({}, 'redevable', [...SANS_TVA, { facture_id: 'f2', taux_tva: 20 }])).toEqual(attendu)
    // Une seule ligne taxée suffit : la part à 0 % se déclare avec elle.
    expect(obligation({}, 'redevable', [...SANS_TVA, ...TAXEE]).etat).toBe('due')
    // Sans aucune ligne, rien ne se conclut : c'est la base qui refusera ses encaissements.
    expect(obligation({}, 'redevable', []).etat).toBe('due')
    expect(obligation({}, 'redevable', [{ facture_id: 'f2', taux_tva: 0 }]).etat).toBe('due')
  })

  it('à préciser : le statut de TVA du dossier, puis ce que la facture validée ne dit pas', () => {
    expect(obligation({}, null)).toEqual({
      etat: 'a_preciser',
      raison: 'À préciser : le statut de TVA du dossier, dont l’obligation dépend, n’est pas encore choisi (onglet TVA du dossier).',
    })
    expect(obligation({ type_client: null })).toEqual({
      etat: 'a_preciser',
      raison: 'À préciser : la facture ne dit pas à qui elle est adressée, et l’obligation en dépend ; validée, elle ne se complète plus.',
    })
    expect(obligation({ nature_operation: null })).toEqual({
      etat: 'a_preciser',
      raison: 'À préciser : la facture ne dit pas si elle porte sur des biens ou des services, et l’obligation en dépend ; '
        + 'validée, elle ne se complète plus.',
    })
    expect(obligation({ option_debits: null })).toEqual({
      etat: 'a_preciser',
      raison: 'À préciser : la facture ne dit pas si le dossier avait opté pour la TVA sur les débits, et l’obligation en '
        + 'dépend ; validée, elle ne se complète plus.',
    })
  })

  it('refusée : une facture mixte, dont les lignes ne disent pas la part des services (Q4)', () => {
    expect(obligation({ nature_operation: 'mixte' })).toEqual({
      etat: 'refusee',
      raison: 'Refusée : la facture mêle biens et services, et seule la part des services se déclarerait ; ses lignes ne disent pas laquelle.',
    })
  })

  it('dit le plus sûr d’abord : une raison certaine passe avant une donnée inconnue', () => {
    const etat = (o: Partial<FacturePourObligation>, statut: StatutTva | null, lignes = TAXEE) => obligation(o, statut, lignes).raison
    // Un brouillon avant tout, même d'un dossier exonéré ; un avoir avant le statut du dossier.
    expect(etat({ statut: 'brouillon', type: 'avoir' }, 'exonere')).toMatch(/brouillon/)
    expect(etat({ type: 'avoir' }, 'exonere')).toMatch(/avoir/)
    // Le dossier exonéré avant le client inconnu ; le client avant la nature ; la nature avant l'option.
    expect(etat({ type_client: null, nature_operation: null, option_debits: null }, 'exonere')).toMatch(/exonéré/)
    expect(etat({ type_client: 'non_assujetti', nature_operation: 'biens' }, null)).toMatch(/particulier/)
    expect(etat({ type_client: 'etranger', nature_operation: 'biens' }, null)).toMatch(/hors de France/)
    expect(etat({ nature_operation: 'biens', option_debits: true, type_client: null }, null)).toMatch(/livraison de biens/)
    expect(etat({ option_debits: true, type_client: null, nature_operation: null }, null)).toMatch(/débits/)
    expect(etat({ type_client: null, nature_operation: null, option_debits: null }, 'redevable', SANS_TVA)).toMatch(/aucune ligne/)
    // Puis ce qui est inconnu, dans l'ordre : le statut, le client, la nature, l'option.
    expect(etat({ type_client: null, nature_operation: null, option_debits: null }, null)).toMatch(/statut de TVA/)
    expect(etat({ type_client: null, nature_operation: null, option_debits: null }, 'redevable')).toMatch(/à qui/)
    expect(etat({ nature_operation: null, option_debits: null }, 'redevable')).toMatch(/biens ou des services/)
    // Une facture mixte d'un dossier au statut inconnu : exonéré, il n'aurait rien à déclarer — à préciser d'abord.
    expect(obligation({ nature_operation: 'mixte' }, null).etat).toBe('a_preciser')
    expect(obligation({ nature_operation: 'mixte', option_debits: null }).etat).toBe('a_preciser')
    // Mixte avant la date : refusée, même avant le 1er septembre 2027.
    expect(obligation({ nature_operation: 'mixte', date_emission: '2026-11-02' }).etat).toBe('refusee')
    // Sans objet avant facultative.
    expect(obligation({ nature_operation: 'biens', date_emission: '2026-11-02' }).etat).toBe('sans_objet')
    expect(obligation({ date_emission: '2026-11-02' }, null).etat).toBe('a_preciser')
  })

  it('ne cite aucun article : la règle se dit, elle ne vieillit pas au 01/01/2027', () => {
    const avec = (o: Partial<FacturePourObligation>) => ({ ...PRESTATION, ...o })
    const cas: [FacturePourObligation, StatutTva | null, { facture_id: string; taux_tva: number }[]][] = []
    for (const statut of ['redevable', 'franchise', 'exonere', null] as const) {
      for (const o of [
        {}, { statut: 'brouillon' as const }, { type: 'avoir' as const }, { type_client: 'non_assujetti' as const },
        { type_client: 'etranger' as const }, { type_client: null }, { nature_operation: 'biens' as const },
        { nature_operation: 'mixte' as const }, { nature_operation: null }, { option_debits: true }, { option_debits: null },
        { date_emission: '2027-01-15' },
      ]) {
        for (const lignes of [TAXEE, SANS_TVA]) cas.push([avec(o), statut, lignes])
      }
    }
    const etats = new Set<string>()
    for (const [f, statut, lignes] of cas) {
      const o = obligationEncaissee(f, lignes, statut)
      etats.add(o.etat)
      expect(o.raison).not.toMatch(/\bart\.|\barticle\b|\bCGI\b|\bCIBS\b|\bBOI\b|\bL\.\s?\d/i)
    }
    expect([...etats].sort()).toEqual(['a_preciser', 'due', 'facultative', 'refusee', 'sans_objet'])
  })
})

// ── Les refus, confrontés au texte de la base ──────────────────────────────────────────────────────────────────────

describe('les refus de la base, tels que la migration les écrit', () => {
  it('enregistrer_encaissement : les mêmes messages, dans le même ordre', () => {
    const sql = derniereDefinitionSql('enregistrer_encaissement')
    expect(messagesSql(sql)).toHaveLength(24)
    expect(REFUS_ENREGISTREMENT.map((r) => r.modele)).toEqual(messagesSql(sql))
    expect(new Set(REFUS_ENREGISTREMENT.map((r) => r.cle)).size).toBe(REFUS_ENREGISTREMENT.length)
  })

  it('retirer_encaissement : les mêmes messages, dans le même ordre', () => {
    const sql = derniereDefinitionSql('retirer_encaissement')
    expect(messagesSql(sql)).toHaveLength(5)
    expect(REFUS_RETRAIT.map((r) => r.modele)).toEqual(messagesSql(sql))
    expect(new Set(REFUS_RETRAIT.map((r) => r.cle)).size).toBe(REFUS_RETRAIT.length)
  })

  // LA BORNE DU HARNAIS : une confrontation qui ne saurait pas virer au rouge ne prouverait rien. Une dérive plantée dans
  // le texte de la fonction — un mot changé, deux refus permutés, un refus ajouté — doit la faire tomber.
  it('vire au rouge sur une dérive plantée dans le texte de la fonction', () => {
    const sql = derniereDefinitionSql('enregistrer_encaissement')
    const attendu = REFUS_ENREGISTREMENT.map((r) => r.modele)
    const mot = sql.replace("'Un encaissement est un montant positif.'", "'Un encaissement est un montant strictement positif.'")
    expect(mot).not.toBe(sql)
    expect(messagesSql(mot)).not.toEqual(attendu)
    const a = "raise exception 'La date de l''encaissement est à renseigner.'"
    const b = "raise exception 'Un encaissement ne se date pas avant l''an 2000.'"
    expect(sql).toContain(a)
    expect(sql).toContain(b)
    const permute = sql.replace(a, '§').replace(b, a).replace('§', b)
    expect(messagesSql(permute)).not.toEqual(attendu)
    const ajoute = sql.replace(b, `${b} using errcode = '22023'; end if; if false then raise exception 'Un refus de plus.'`)
    expect(messagesSql(ajoute)).not.toEqual(attendu)
  })

  it('les valeurs des messages sont écrites comme le module les écrit', () => {
    const sql = derniereDefinitionSql('enregistrer_encaissement')
    const MONTANT = (x: string) => `replace(to_char(${x}, 'FM999999999990.00'), '.', ',')`
    const TAUX = (x: string) => `replace(trim_scale(${x})::text, '.', ',')`
    const attendus: Record<string, string[]> = {
      date_future: ["to_char(v_aujourd_hui, 'DD/MM/YYYY')"],
      mouvement_depasse: [MONTANT('v_mouvement.montant'), MONTANT('v_total')],
      taux_repete: [TAUX('v_taux')],
      taux_hors_facture: [TAUX('v_taux')],
      taux_non_admis: [TAUX('v_taux')],
      repartition_somme: [MONTANT('v_total'), MONTANT('p_montant')],
      plafond_facture: [MONTANT('greatest(v_facture.montant_ttc - v_deja, 0)')],
      plafond_taux: [TAUX('v_part.taux'), MONTANT('greatest(v_ttc / 100.0 - v_deja, 0)')],
    }
    const args = argumentsSql(sql)
    expect(args).toHaveLength(REFUS_ENREGISTREMENT.length)
    REFUS_ENREGISTREMENT.forEach((r, i) => {
      expect(args[i], r.cle).toEqual(attendus[r.cle] ?? [])
      // Autant de « % » à remplir que de valeurs.
      expect(r.modele.replace(/%%/g, '').split('%').length - 1, r.cle).toBe(args[i].length)
    })
    for (const args2 of argumentsSql(derniereDefinitionSql('retirer_encaissement'))) expect(args2).toEqual([])
  })

  it('les bornes et le seuil sont ceux de la fonction', () => {
    const sql = derniereDefinitionSql('enregistrer_encaissement')
    expect(sql).toContain(`if p_date < date '${DATE_PLANCHER}' then`)
    expect(sql).toContain(`not (p_montant > 0 and p_montant < ${BORNE_MONTANT_EUROS})`)
    expect(sql).toContain('v_exces := (v_total - v_mouvement.montant) * 100;')
    const seuil = /if v_exces \* 100 > least\((\d+), v_total \* (\d+)\) then/.exec(sql)
    expect(seuil).not.toBeNull()
    // v_total est en euros : × 200, c'est 2 % de ses centimes, × 100.
    expect(Number((seuil as RegExpExecArray)[1])).toBe(SEUIL_PLAFOND_CENTIMES * 100)
    expect(Number((seuil as RegExpExecArray)[2])).toBe(SEUIL_POUR_CENT * 100)
    expect(sql).toContain("r.etat = 'rejete'")
    const statuts = /e\.status_code in \(([^)]*)\)/.exec(sql)
    expect([...((statuts as RegExpExecArray)[1]).matchAll(/'([^']+)'/g)].map((m) => m[1])).toEqual([...STATUTS_ANNULATION_SUPERPDP])
    expect(sql).toContain("(now() at time zone 'Europe/Paris')::date")
  })

  it('le seuil reprend celui d’alignementBanque.ts, en centimes entiers', () => {
    expect(SEUIL_POUR_CENT).toBe(SEUIL_ALIGNEMENT_RELATIF * 100)
    expect(SEUIL_PLAFOND_CENTIMES).toBe(SEUIL_ALIGNEMENT_PLAFOND_EUR * 100)
    // Sur toute une grille de montants, aux frontières : la même réponse que `seuilAlignement`.
    for (let total = 1; total <= 60_000; total++) {
      const frontiere = Math.floor(Math.min(SEUIL_PLAFOND_CENTIMES * 100, total * SEUIL_POUR_CENT) / 100)
      for (const ecart of [frontiere - 1, frontiere, frontiere + 1]) {
        if (ecart < 0) continue
        expect(ecartDeFrais(ecart, total), `${ecart} sur ${total}`).toBe(ecart / 100 <= seuilAlignement(total / 100))
      }
    }
  })
})

// ── Les valeurs, écrites comme la base ──────────────────────────────────────────────────────────────────────────────

describe('les valeurs des messages, écrites comme la base les écrit', () => {
  it('un montant : to_char(x, \'FM999999999990.00\'), la virgule décimale (relevé sur PostgreSQL 16)', () => {
    expect(euroCommeLaBase(0)).toBe('0,00')
    expect(euroCommeLaBase(5)).toBe('0,05')
    expect(euroCommeLaBase(135550)).toBe('1355,50')
    expect(euroCommeLaBase(100500)).toBe('1005,00')
    expect(euroCommeLaBase(-550)).toBe('-5,50')
    expect(euroCommeLaBase(99_999_999_999_999)).toBe('999999999999,99')
    expect(euroCommeLaBase(100_000_000_000_000)).toBe('############,##')
    expect(euroCommeLaBase(999_999_999_999_999)).toBe('############,##')
  })

  it('un taux : trim_scale du nombre reçu en JSON, sans exposant (relevé sur PostgreSQL 16)', () => {
    expect(TAUX_ADMIS.map(tauxCommeLaBase)).toEqual(['0', '0,9', '1,05', '1,75', '2,1', '5,5', '7', '8,5', '9,2', '9,6', '10', '13', '19,6', '20', '20,6'])
    expect(tauxCommeLaBase(1e-7)).toBe('0,0000001')
    expect(tauxCommeLaBase(1.5e-7)).toBe('0,00000015')
    expect(tauxCommeLaBase(-2.5e-7)).toBe('-0,00000025')
    expect(tauxCommeLaBase(1e21)).toBe('1000000000000000000000')
    expect(tauxCommeLaBase(1.25e22)).toBe('12500000000000000000000')
    expect(tauxCommeLaBase(-0)).toBe('0')
  })

  it('un montant au centime : lu sur son écriture, jamais arrondi', () => {
    expect(centimesExacts(1355.5)).toBe(135550)
    expect(centimesExacts(1.15)).toBe(115)
    expect(centimesExacts(0.07)).toBe(7)
    expect(centimesExacts(-5.5)).toBe(-550)
    expect(centimesExacts(-0)).toBe(0)
    expect(centimesExacts(9_999_999_999_999.99)).toBe(999_999_999_999_999)
    for (const x of [1.005, 10.001, 0.1 + 0.2, 1e-7, Number.NaN, Number.POSITIVE_INFINITY, 1e21]) {
      expect(centimesExacts(x), String(x)).toBeNull()
    }
  })

  it('remplit un modèle comme RAISE : « % » reçoit une valeur, « %% » s’écrit « % »', () => {
    expect(remplirModele('Le taux de % %% figure deux fois.', ['5,5'])).toBe('Le taux de 5,5 % figure deux fois.')
    expect(remplirModele('De % € à % €.', ['1', '2'])).toBe('De 1 € à 2 €.')
    expect(remplirModele('Rien.', [])).toBe('Rien.')
    expect(() => remplirModele('De % €.', [])).toThrow()
    expect(() => remplirModele('De % €.', ['1', '2'])).toThrow()
  })
})

// ── Ce que la base refuserait ───────────────────────────────────────────────────────────────────────────────────────

describe('refusEnregistrement — les refus de la base, avec ses messages', () => {
  it('accepte un encaissement valide, avec ou sans mouvement', () => {
    expect(refus(contexte(), saisie())).toBeNull()
    expect(refus(contexte(), saisie({ ligneBancaireId: 'm_cent' }))).toBeNull()
    expect(refus(contexte(), saisie({
      montant: 1355.5, repartition: [{ taux: 20, montant: 1200 }, { taux: 5.5, montant: 105.5 }, { taux: 0, montant: 50 }],
    }))).toBeNull()
    for (const m of MOYENS_ENCAISSEMENT) expect(refus(contexte(), saisie({ moyen: m.moyen }))).toBeNull()
  })

  it('les refus 2 à 6 : la facture, avec les messages que la base a rendus (contrôles 6 à 13 de l’essai)', () => {
    attendreLeMessageDeLEssai('6', refus(contexte({ facture: facture({ dossier_id: 'd2' }) }), saisie())?.message)
    attendreLeMessageDeLEssai('8', refus(contexte({ facture: facture({ statut: 'brouillon' }) }), saisie())?.message)
    attendreLeMessageDeLEssai('9', refus(contexte({ facture: facture({ type: 'avoir' }) }), saisie())?.message)
    const rejet = { facture_id: 'f1', canal: 'plateforme' as const, etat: 'rejete' as const, hote: 'pa.exemple.fr', flux_id: 'flux-1' }
    attendreLeMessageDeLEssai('10', refus(contexte({ transmissions: [rejet] }), saisie())?.message)
    attendreLeMessageDeLEssai('11', refus(contexte({ evenementsSuperpdp: [{ facture_id: 'f1', status_code: 'fr:210' }] }), saisie())?.message)
    attendreLeMessageDeLEssai('12', refus(contexte({ evenementsSuperpdp: [{ facture_id: 'f1', status_code: 'fr:213' }] }), saisie())?.message)
    // L'en-tête de la facture `fx` dit 21 € de TVA quand sa ligne en porte 20.
    const fx = contexte({
      facture: facture({ montant_ht: 100, montant_tva: 21, montant_ttc: 121 }),
      lignes: [{ facture_id: 'f1', ordre: 1, designation: 'a', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20 }],
    })
    attendreLeMessageDeLEssai('13', refus(fx, saisie())?.message)
  })

  it('une transmission ou un événement d’une autre facture, un autre état ou un autre statut ne refusent rien', () => {
    for (const etat of ['envoi', 'echec', 'depose', 'accepte'] as const) {
      expect(refus(contexte({ transmissions: [{ facture_id: 'f1', canal: 'plateforme', etat, hote: 'h', flux_id: null }] }), saisie())).toBeNull()
    }
    expect(refus(contexte({ transmissions: [{ facture_id: 'f2', canal: 'plateforme', etat: 'rejete', hote: 'h', flux_id: null }] }), saisie())).toBeNull()
    for (const status_code of ['fr:200', 'fr:205', 'fr:212', 'fr:501', 'api:rejected']) {
      expect(refus(contexte({ evenementsSuperpdp: [{ facture_id: 'f1', status_code }] }), saisie()), status_code).toBeNull()
    }
    expect(refus(contexte({ evenementsSuperpdp: [{ facture_id: 'f2', status_code: 'fr:210' }] }), saisie())).toBeNull()
  })

  it('l’en-tête se compare aux lignes de SA facture, au centime près, montant par montant', () => {
    const autre = { facture_id: 'f2', ordre: 9, designation: 'z', quantite: 1, prix_unitaire_ht: 999, taux_tva: 20 }
    expect(refusDeLaFacture(contexte({ lignes: [...LIGNES, autre] }))).toBeNull()
    for (const o of [
      { montant_ht: 1150.01 }, { montant_ht: 1150.001 }, { montant_tva: 205.49 }, { montant_tva: 205.501 },
      { montant_ttc: 1355.51 }, { montant_ttc: 1355.499 },
    ]) {
      expect(refusDeLaFacture(contexte({ facture: facture(o) }))?.cle, JSON.stringify(o)).toBe('lignes_incoherentes')
    }
    // Une facture sans ligne et à zéro : la base ne la refuse pas ici, mais au premier taux de la répartition.
    const vide = contexte({ facture: facture({ montant_ht: 0, montant_tva: 0, montant_ttc: 0 }), lignes: [] })
    expect(refusDeLaFacture(vide)).toBeNull()
    expect(refus(vide, saisie())?.cle).toBe('taux_hors_facture')
  })

  it('le refus 7 : la date, renseignée, pas avant l’an 2000, pas après aujourd’hui à Paris', () => {
    attendreLeMessageDeLEssai('14', refus(contexte(), saisie({ date: null }))?.message)
    for (const date of ['', '2027-02-30', '2027-13-01', '2027-00-10', '2027-01-00', '27-10-15', '2027-10-15T10:00:00Z', 'demain']) {
      expect(refus(contexte(), saisie({ date }))?.cle, date).toBe('date_absente')
    }
    attendreLeMessageDeLEssai('15', refus(contexte(), saisie({ date: '1999-12-31' }))?.message)
    expect(refus(contexte(), saisie({ date: '2000-01-01', repartition: [{ taux: 20, montant: 100 }] }))).toBeNull()
    expect(refus(contexte(), saisie({ date: '2028-02-29' }))?.message)
      .toBe("Un encaissement ne se date pas dans l'avenir : nous sommes le 02/11/2027.")
    expect(refus(contexte(), saisie({ date: '2027-11-03' }))?.cle).toBe('date_future')
    expect(refus(contexte(), saisie({ date: AUJOURD_HUI }))).toBeNull()
    expect(refus(contexte(), saisie({ date: '2024-02-29' }))).toBeNull()
  })

  it('le refus 8 : un montant positif, borné, au centime (contrôles 17 à 21)', () => {
    for (const [numero, montant] of [['17', 0], ['18', -1], ['19', Number.NaN], ['20', null]] as const) {
      attendreLeMessageDeLEssai(numero, refus(contexte(), saisie({ montant }))?.message)
    }
    for (const montant of [Number.POSITIVE_INFINITY, BORNE_MONTANT_EUROS, -0.001, 1e15]) {
      expect(refus(contexte(), saisie({ montant }))?.cle, String(montant)).toBe('montant_positif')
    }
    attendreLeMessageDeLEssai('21', refus(contexte(), saisie({ montant: 10.001, repartition: [{ taux: 20, montant: 10.001 }] }))?.message)
    expect(refus(contexte(), saisie({ montant: 1e-7 }))?.cle).toBe('montant_centime')
    expect(refus(contexte(), saisie({ montant: 0.1 + 0.2 }))?.cle).toBe('montant_centime')
    // Juste sous la borne, le montant passe : c'est le plafond de la facture qui le refuse.
    expect(refus(contexte(), saisie({ montant: 9_999_999_999_999.99, repartition: [{ taux: 20, montant: 9_999_999_999_999.99 }] }))?.cle)
      .toBe('plafond_facture')
  })

  it('le refus 9 : un moyen de paiement connu (contrôles 22 et 23)', () => {
    attendreLeMessageDeLEssai('22', refus(contexte(), saisie({ moyen: 'troc' }))?.message)
    attendreLeMessageDeLEssai('23', refus(contexte(), saisie({ moyen: null }))?.message)
    for (const moyen of ['', 'Virement', 'chèque', ' virement']) expect(refus(contexte(), saisie({ moyen }))?.cle, moyen).toBe('moyen_inconnu')
  })

  it('le refus 10 : un mouvement de ce dossier, un crédit (contrôles 24 à 26b)', () => {
    attendreLeMessageDeLEssai('24', refus(contexte(), saisie({ ligneBancaireId: 'm_autre' }))?.message)
    attendreLeMessageDeLEssai('25', refus(contexte(), saisie({ ligneBancaireId: 'inconnu' }))?.message)
    attendreLeMessageDeLEssai('26', refus(contexte(), saisie({ ligneBancaireId: 'm_debit' }))?.message)
    attendreLeMessageDeLEssai('26b', refus(contexte(), saisie({ ligneBancaireId: 'm_zero' }))?.message)
    // Le mouvement se cherche dans CE dossier : celui de l'écran, pas celui que porte la facture.
    expect(refus(contexte({ dossierId: 'd2', facture: facture({ dossier_id: 'd2' }) }), saisie({ ligneBancaireId: 'm_autre' })))
      .toBeNull()
  })

  it('le refus 10 : un mouvement qui justifie déjà un encaissement de cette facture (contrôle 27)', () => {
    const deja = encaissement({ id: 'e9', ligne_bancaire_id: 'm_credit', montant: 1 })
    attendreLeMessageDeLEssai('27', refus(contexte({ encaissements: [deja] }), saisie({ ligneBancaireId: 'm_credit', montant: 1, repartition: [{ taux: 20, montant: 1 }] }))?.message)
    const s = saisie({ ligneBancaireId: 'm_credit', montant: 1, repartition: [{ taux: 20, montant: 1 }] })
    // Retiré, ou annulé par une contre-passation vivante, il ne justifie plus rien.
    expect(refus(contexte({ encaissements: [{ ...deja, retire_le: '2027-10-20T10:00:00Z' }] }), s)).toBeNull()
    const annulation = encaissement({ id: 'a9', montant: -1, annule_id: 'e9' })
    expect(refus(contexte({ encaissements: [deja, annulation] }), s)).toBeNull()
    // Une annulation retirée ne libère rien.
    expect(refus(contexte({ encaissements: [deja, { ...annulation, retire_le: '2027-10-21T10:00:00Z' }] }), s)?.cle)
      .toBe('mouvement_deja_pris')
    // Le même mouvement pour une AUTRE facture n'est pas ce refus : il compte dans le total du mouvement.
    expect(refus(contexte({ encaissements: [{ ...deja, facture_id: 'f2' }] }), s)).toBeNull()
  })

  it('le refus 10 : un mouvement que ses encaissements dépasseraient au-delà des frais (contrôles 28 et 28b, 42 à 42c)', () => {
    attendreLeMessageDeLEssai('28', refus(contexte(), saisie({ ligneBancaireId: 'm_cent', montant: 102.05, repartition: [{ taux: 20, montant: 102.05 }] }))?.message)
    attendreLeMessageDeLEssai('28b', refus(contexte(), saisie({ ligneBancaireId: 'm_mille', montant: 1005.01, repartition: [{ taux: 20, montant: 1005.01 }] }))?.message)
    // Ce que la base a accepté : 2,04 € d'écart sur 102,04 €, 5 € sur 1 005 €, 2 € sur 100 € (2 % exactement).
    expect(refus(contexte(), saisie({ ligneBancaireId: 'm_cent', montant: 102.04, repartition: [{ taux: 20, montant: 102.04 }] }))).toBeNull()
    expect(refus(contexte(), saisie({ ligneBancaireId: 'm_mille', montant: 1005, repartition: [{ taux: 20, montant: 1005 }] }))).toBeNull()
    expect(refus(contexte(), saisie({ ligneBancaireId: 'm_98', montant: 100, repartition: [{ taux: 20, montant: 100 }] }))).toBeNull()
    expect(refus(contexte(), saisie({ ligneBancaireId: 'm_98', montant: 100.01, repartition: [{ taux: 20, montant: 100.01 }] }))?.message)
      .toBe("Ce mouvement de 98,00 € justifierait 100,01 € d'encaissements : l'écart dépasse ce que des frais bancaires expliquent.")
    // Un mouvement plus grand que l'encaissement ne refuse rien : un virement peut régler plusieurs factures.
    expect(refus(contexte(), saisie({ ligneBancaireId: 'm_mille', montant: 1, repartition: [{ taux: 20, montant: 1 }] }))).toBeNull()
  })

  it('le refus 10 juge TOUS les encaissements vivants du mouvement, de toutes les factures', () => {
    const autre = encaissement({ id: 'e8', facture_id: 'f2', ligne_bancaire_id: 'm_mille', montant: 600 })
    const s = (montant: number) => saisie({ ligneBancaireId: 'm_mille', montant, repartition: [{ taux: 20, montant }] })
    expect(refus(contexte({ encaissements: [autre] }), s(405))).toBeNull()
    expect(refus(contexte({ encaissements: [autre] }), s(405.01))?.message)
      .toBe("Ce mouvement de 1000,00 € justifierait 1005,01 € d'encaissements : l'écart dépasse ce que des frais bancaires expliquent.")
    // Retiré, ou annulé, l'encaissement de l'autre facture ne compte plus.
    expect(refus(contexte({ encaissements: [{ ...autre, retire_le: '2027-10-20T10:00:00Z' }] }), s(1000))).toBeNull()
    const annulation = encaissement({ id: 'a8', facture_id: 'f2', montant: -600, annule_id: 'e8' })
    expect(refus(contexte({ encaissements: [autre, annulation] }), s(1000))).toBeNull()
    // Un encaissement sur un autre mouvement n'y compte pas.
    expect(refus(contexte({ encaissements: [{ ...autre, ligne_bancaire_id: 'm_cent' }] }), s(1000))).toBeNull()
  })

  it('le refus 11 : la répartition, lisible (contrôles 30 à 32)', () => {
    attendreLeMessageDeLEssai('30', refus(contexte(), saisie({ repartition: [] }))?.message)
    for (const repartition of [
      [{ taux: 20, montant: Number.NaN }], [{ taux: Number.NaN, montant: 100 }], [{ taux: 20, montant: Number.POSITIVE_INFINITY }],
      [{ taux: Number.NEGATIVE_INFINITY, montant: 100 }], [{ taux: 20, montant: 50 }, { taux: 5.5, montant: Number.NaN }],
      [{ taux: 20, montant: '100' as unknown as number }], [{ taux: 20 } as unknown as { taux: number; montant: number }],
    ]) {
      expect(refus(contexte(), saisie({ repartition }))?.cle, JSON.stringify(repartition)).toBe('repartition_illisible')
    }
  })

  it('le refus 11 : sans taux répété, des taux de la facture, admis (contrôles 33 à 35)', () => {
    attendreLeMessageDeLEssai('33', refus(contexte(), saisie({ montant: 2, repartition: [{ taux: 20, montant: 1 }, { taux: 20.0, montant: 1 }] }))?.message)
    // Le premier taux qui en répète un autre, dans l'ordre de la liste.
    expect(refus(contexte(), saisie({
      montant: 3, repartition: [{ taux: 5.5, montant: 1 }, { taux: 20, montant: 1 }, { taux: 20, montant: 0.5 }, { taux: 5.5, montant: 0.5 }],
    }))?.message).toBe('Le taux de 20 % figure deux fois dans la répartition.')
    attendreLeMessageDeLEssai('34', refus(contexte(), saisie({ repartition: [{ taux: 10, montant: 100 }] }))?.message)
    expect(refus(contexte(), saisie({ montant: 2, repartition: [{ taux: 20, montant: 1 }, { taux: 2.1, montant: 1 }] }))?.message)
      .toBe("Le taux de 2,1 % n'est pas un taux de cette facture.")
    // Un taux de la facture que la facturation électronique n'admet pas : la facture `f19`.
    const f19 = contexte({
      facture: facture({ montant_ht: 100, montant_tva: 19, montant_ttc: 119 }),
      lignes: [{ facture_id: 'f1', ordre: 1, designation: 'a', quantite: 1, prix_unitaire_ht: 100, taux_tva: 19 }],
    })
    attendreLeMessageDeLEssai('35', refus(f19, saisie({ repartition: [{ taux: 19, montant: 100 }] }))?.message)
    // Les taux d'une autre facture ne comptent pas.
    const ailleurs = { facture_id: 'f2', ordre: 1, designation: 'z', quantite: 1, prix_unitaire_ht: 1, taux_tva: 10 }
    expect(refus(contexte({ lignes: [...LIGNES, ailleurs] }), saisie({ repartition: [{ taux: 10, montant: 100 }] }))?.cle)
      .toBe('taux_hors_facture')
  })

  it('le refus 11 : des parts positives au centime, dont la somme fait le montant (contrôles 36 à 39)', () => {
    attendreLeMessageDeLEssai('36', refus(contexte(), saisie({ montant: 1, repartition: [{ taux: 20, montant: 1 }, { taux: 5.5, montant: 0 }] }))?.message)
    attendreLeMessageDeLEssai('37', refus(contexte(), saisie({ montant: 1, repartition: [{ taux: 20, montant: 2 }, { taux: 5.5, montant: -1 }] }))?.message)
    attendreLeMessageDeLEssai('38', refus(contexte(), saisie({ montant: 1, repartition: [{ taux: 20, montant: 0.995 }, { taux: 5.5, montant: 0.005 }] }))?.message)
    expect(refus(contexte(), saisie({ montant: 1, repartition: [{ taux: 20, montant: 1e-7 }] }))?.cle).toBe('part_invalide')
    attendreLeMessageDeLEssai('39', refus(contexte(), saisie({ montant: 10, repartition: [{ taux: 20, montant: 6 }, { taux: 5.5, montant: 3.99 }] }))?.message)
    // Des centimes que la virgule flottante ne somme pas juste : 0,1 + 0,2 font 0,30 €.
    expect(refus(contexte(), saisie({ montant: 0.3, repartition: [{ taux: 20, montant: 0.1 }, { taux: 5.5, montant: 0.2 }] }))).toBeNull()
  })

  it('le refus 12 : le total de la facture, net (contrôles 40 et 43)', () => {
    const tout = [{ taux: 20, montant: 1200.01 }, { taux: 5.5, montant: 105.5 }, { taux: 0, montant: 50 }]
    attendreLeMessageDeLEssai('40', refus(contexte(), saisie({ montant: 1355.51, repartition: tout }))?.message)
    // Après 1 355,50 € encaissés, un centime de plus : il reste 0,00 € (contrôle 43).
    const soldee = contexte({
      encaissements: [encaissement({ montant: 500 }), encaissement({ id: 'e2', montant: 855.5 })],
      parts: [
        part({ taux: 20, montant: 442.64 }), part({ taux: 5.5, montant: 38.92 }), part({ taux: 0, montant: 18.44 }),
        part({ encaissement_id: 'e2', taux: 20, montant: 757.36 }), part({ encaissement_id: 'e2', taux: 5.5, montant: 66.58 }),
        part({ encaissement_id: 'e2', taux: 0, montant: 31.56 }),
      ],
    })
    expect(refus(soldee, saisie({ montant: 0.01, repartition: [{ taux: 0, montant: 0.01 }] }))?.message)
      .toBe("L'encaissement dépasserait le total de la facture : il reste 0,00 € à encaisser.")
  })

  it('le refus 12 compte les montants NETS : les retirés non, les annulations oui', () => {
    const e1 = encaissement({ montant: 1000 })
    const p1 = [part({ taux: 20, montant: 1000 })]
    const tout = (montant: number) => saisie({ montant, repartition: [{ taux: 20, montant: Math.min(montant, 200) }, ...(montant > 200 ? [{ taux: 5.5, montant: montant - 200 }] : [])] })
    expect(refus(contexte({ encaissements: [e1], parts: p1 }), tout(355.51))?.message)
      .toBe("L'encaissement dépasserait le total de la facture : il reste 355,50 € à encaisser.")
    // Retiré, il ne compte plus.
    expect(refus(contexte({ encaissements: [{ ...e1, retire_le: '2027-10-20T10:00:00Z' }], parts: p1 }), tout(355.51))?.cle)
      .not.toBe('plafond_facture')
    // Annulé par une contre-passation vivante : 1 000 − 1 000, il ne reste rien d'encaissé.
    const a1 = encaissement({ id: 'a1', montant: -1000, annule_id: 'e1' })
    const pa1 = part({ encaissement_id: 'a1', taux: 20, montant: -1000 })
    expect(refus(contexte({ encaissements: [e1, a1], parts: [...p1, pa1] }), saisie({ montant: 1200, repartition: [{ taux: 20, montant: 1200 }] })))
      .toBeNull()
    // L'annulation retirée ne compte plus, ni sa part : l'encaissement compte de nouveau, au total comme à son taux.
    const aRetiree = { ...a1, retire_le: '2027-10-21T10:00:00Z' }
    expect(refus(contexte({ encaissements: [e1, aRetiree], parts: [...p1, pa1] }),
      saisie({ montant: 1200, repartition: [{ taux: 20, montant: 1200 }] }))?.message)
      .toBe("L'encaissement dépasserait le total de la facture : il reste 355,50 € à encaisser.")
    expect(refus(contexte({ encaissements: [e1, aRetiree], parts: [...p1, pa1] }),
      saisie({ montant: 300, repartition: [{ taux: 20, montant: 300 }] }))?.message)
      .toBe("À 20 %, l'encaissement dépasserait ce que la facture porte : il reste 200,00 € à encaisser à ce taux.")
    // Les encaissements d'une autre facture ne comptent pas.
    expect(refus(contexte({ encaissements: [{ ...e1, facture_id: 'f2' }], parts: p1 }), tout(355.51))?.cle).not.toBe('plafond_facture')
    // Au-delà du total (une restauration, qui écrit sans les plafonds) : « il reste 0,00 € », jamais un reste négatif.
    expect(refus(contexte({ encaissements: [encaissement({ montant: 1400 })] }), saisie())?.message)
      .toBe("L'encaissement dépasserait le total de la facture : il reste 0,00 € à encaisser.")
  })

  it('le refus 12 : chaque taux, dans l’ordre des parts (contrôle 41)', () => {
    attendreLeMessageDeLEssai('41', refus(contexte(), saisie({ montant: 105.51, repartition: [{ taux: 5.5, montant: 105.51 }] }))?.message)
    // Deux parts en excès : la première de la liste est dite.
    expect(refus(contexte(), saisie({ montant: 160.01, repartition: [{ taux: 0, montant: 50.01 }, { taux: 5.5, montant: 110 }] }))?.message)
      .toBe("À 0 %, l'encaissement dépasserait ce que la facture porte : il reste 50,00 € à encaisser à ce taux.")
    // Ce que les encaissements vivants ont déjà pris à ce taux compte ; leurs parts aux autres taux, non.
    const e1 = encaissement({ montant: 150 })
    const parts = [part({ taux: 5.5, montant: 100 }), part({ taux: 20, montant: 50 })]
    expect(refus(contexte({ encaissements: [e1], parts }), saisie({ montant: 5.51, repartition: [{ taux: 5.5, montant: 5.51 }] }))?.message)
      .toBe("À 5,5 %, l'encaissement dépasserait ce que la facture porte : il reste 5,50 € à encaisser à ce taux.")
    expect(refus(contexte({ encaissements: [e1], parts }), saisie({ montant: 5.5, repartition: [{ taux: 5.5, montant: 5.5 }] }))).toBeNull()
    // Les parts d'un encaissement retiré, ou d'un autre encaissement que ceux de la facture, ne comptent pas.
    expect(refus(contexte({ encaissements: [{ ...e1, retire_le: '2027-10-20T10:00:00Z' }], parts }),
      saisie({ montant: 105.5, repartition: [{ taux: 5.5, montant: 105.5 }] }))).toBeNull()
    expect(refus(contexte({ encaissements: [{ ...e1, facture_id: 'f2' }], parts }),
      saisie({ montant: 105.5, repartition: [{ taux: 5.5, montant: 105.5 }] }))).toBeNull()
    // Un taux de 0 % se plafonne comme les autres.
    expect(refus(contexte(), saisie({ montant: 50, repartition: [{ taux: 0, montant: 50 }] }))).toBeNull()
    // Un taux déjà dépassé — une restauration écrit sans les plafonds — : « il reste 0,00 € », jamais un reste négatif.
    const depasse = contexte({ encaissements: [encaissement({ montant: 1300 })], parts: [part({ taux: 20, montant: 1300 })] })
    expect(refus(depasse, saisie({ montant: 1, repartition: [{ taux: 20, montant: 1 }] }))?.message)
      .toBe("À 20 %, l'encaissement dépasserait ce que la facture porte : il reste 0,00 € à encaisser à ce taux.")
  })

  it('dans l’ordre de la base : chaque refus passe avant le suivant, encore en faute', () => {
    // On part d'une saisie fautive partout, et l'on corrige une faute à la fois : chaque étape doit rendre le refus
    // suivant de la base, alors que les suivants sont encore en faute. La facture porte aussi une ligne à 19 % : un
    // taux de la facture que la facturation électronique n'admet pas.
    const lignes: LigneDeFacture[] = [...LIGNES, { facture_id: 'f1', ordre: 4, designation: 'd', quantite: 1, prix_unitaire_ht: 10, taux_tva: 19 }]
    const juste = facture({ montant_ht: 1160, montant_tva: 207.4, montant_ttc: 1367.4 })
    const deja = encaissement({ id: 'e9', ligne_bancaire_id: 'm_mille', montant: 1 })
    let c = contexte({
      facture: { ...juste, dossier_id: 'd2', statut: 'brouillon', type: 'avoir', montant_tva: 208 },
      lignes,
      transmissions: [{ facture_id: 'f1', canal: 'plateforme', etat: 'rejete', hote: 'h', flux_id: 'x' }],
    })
    let s = saisie({ date: null, montant: null, moyen: null, ligneBancaireId: 'inconnu', repartition: [] })
    const etapes: [string, () => void][] = [
      ['facture_introuvable', () => { c = { ...c, facture: { ...c.facture, dossier_id: D } } }],
      ['brouillon', () => { c = { ...c, facture: { ...c.facture, statut: 'validee' } } }],
      ['avoir', () => { c = { ...c, facture: { ...c.facture, type: 'facture' } } }],
      ['rejetee', () => { c = { ...c, transmissions: [] } }],
      ['lignes_incoherentes', () => { c = { ...c, facture: juste } }],
      ['date_absente', () => { s = { ...s, date: '1999-12-31' } }],
      ['date_avant_2000', () => { s = { ...s, date: '2027-11-03' } }],
      ['date_future', () => { s = { ...s, date: '2027-10-15' } }],
      ['montant_positif', () => { s = { ...s, montant: 10.001 } }],
      ['montant_centime', () => { s = { ...s, montant: 1367.41 } }],
      ['moyen_inconnu', () => { s = { ...s, moyen: 'cheque' } }],
      ['mouvement_hors_dossier', () => { s = { ...s, ligneBancaireId: 'm_debit' } }],
      ['mouvement_debit', () => { s = { ...s, ligneBancaireId: 'm_mille' }; c = { ...c, encaissements: [deja] } }],
      ['mouvement_deja_pris', () => { c = { ...c, encaissements: [{ ...deja, facture_id: 'f2' }] } }],
      ['mouvement_depasse', () => { s = { ...s, ligneBancaireId: null }; c = { ...c, encaissements: [] } }],
      ['repartition_illisible', () => { s = { ...s, repartition: [{ taux: 10, montant: 1 }, { taux: 19, montant: 0 }, { taux: 10, montant: 1 }] } }],
      ['taux_repete', () => { s = { ...s, repartition: [{ taux: 10, montant: 1 }, { taux: 19, montant: 0 }] } }],
      ['taux_hors_facture', () => { s = { ...s, repartition: [{ taux: 19, montant: 0 }, { taux: 20, montant: 1 }] } }],
      ['taux_non_admis', () => { s = { ...s, repartition: [{ taux: 20, montant: 0 }] } }],
      ['part_invalide', () => { s = { ...s, repartition: [{ taux: 20, montant: 1 }] } }],
      ['repartition_somme', () => { s = { ...s, repartition: [{ taux: 20, montant: 1367.41 }] } }],
      ['plafond_facture', () => { s = { ...s, montant: 1200.01, repartition: [{ taux: 20, montant: 1200.01 }] } }],
      ['plafond_taux', () => { s = { ...s, montant: 1200, repartition: [{ taux: 20, montant: 1200 }] } }],
    ]
    const vus: string[] = []
    for (const [cle, corriger] of etapes) {
      vus.push(refusEnregistrement(c, s, MOUVEMENTS, AUJOURD_HUI)?.cle ?? 'aucun')
      expect(vus[vus.length - 1], `avant de corriger ${cle}`).toBe(cle)
      corriger()
    }
    expect(refusEnregistrement(c, s, MOUVEMENTS, AUJOURD_HUI)).toBeNull()
    // Toutes les clés que le module juge, dans l'ordre du catalogue : l'accès seul reste à la base.
    expect(vus).toEqual(REFUS_ENREGISTREMENT.map((r) => r.cle).filter((cle) => cle !== 'acces'))
  })
})

describe('refusRetrait — les refus de retirer_encaissement', () => {
  const e1 = encaissement()
  const AUCUN = new Set<string>()

  it('accepte un encaissement vivant, jamais déclaré, qu’aucune annulation vivante ne vise', () => {
    expect(refusRetrait(D, 'e1', [e1], AUCUN)).toBeNull()
    // Une annulation retirée ne le retient plus.
    expect(refusRetrait(D, 'e1', [e1, encaissement({ id: 'a1', montant: -100, annule_id: 'e1', retire_le: '2027-10-21T10:00:00Z' })], AUCUN)).toBeNull()
    // Une annulation se retire elle-même.
    expect(refusRetrait(D, 'a1', [e1, encaissement({ id: 'a1', montant: -100, annule_id: 'e1' })], AUCUN)).toBeNull()
  })

  it('refuse, dans l’ordre de la base, avec ses messages (contrôles 44, 46 et 47)', () => {
    expect(refusRetrait('d2', 'e1', [e1], AUCUN)?.message).toBe('Encaissement introuvable dans ce dossier.')
    expect(refusRetrait(D, 'inconnu', [e1], AUCUN)?.cle).toBe('encaissement_introuvable')
    const retire = { ...e1, retire_le: '2027-10-20T10:00:00Z' }
    expect(refusRetrait(D, 'e1', [retire], new Set(['e1']))?.message).toBe('Cet encaissement est déjà retiré.')
    const annulation = encaissement({ id: 'a1', montant: -100, annule_id: 'e1' })
    expect(refusRetrait(D, 'e1', [e1, annulation], new Set(['e1']))?.message)
      .toBe("Un encaissement déclaré ne se retire pas : il se contre-passe, et l'annulation se déclare à son tour.")
    expect(refusRetrait(D, 'e1', [e1, annulation], AUCUN)?.message)
      .toBe("Cet encaissement est annulé par une contre-passation : retirez d'abord celle-ci.")
    // Une déclaration d'un AUTRE encaissement ne le retient pas.
    expect(refusRetrait(D, 'e1', [e1], new Set(['e2']))).toBeNull()
    // Les messages sont ceux que la base a rendus en production.
    expect(ESSAI).toContain("message_recu = 'Cet encaissement est déjà retiré.'")
    expect(ESSAI).toContain("message_recu = 'Encaissement introuvable dans ce dossier.'")
    expect(ESSAI).toContain("message_recu = 'Cet encaissement est annulé par une contre-passation : retirez d''abord celle-ci.'")
  })
})

// ── Les déclarations et la contre-passation (étape d4) ──────────────────────────────────────────────────────────────

// L'essai de l'étape d4, joué en production : les messages que la base a rendus pour chaque refus.
const ESSAI_D4 = readFileSync(new URL('../../supabase/essais/transmissionsEncaissements.sql', import.meta.url), 'utf8')

// La migration de l'étape d4, trouvée par ce qu'elle crée : sa version n'est connue qu'une fois appliquée.
const MIGRATION_D4 = fichiersDuSchema().find((f) => f.texte.includes('create table public.transmissions_encaissements ('))?.texte ?? ''

// Le tuple d'un contrôle de l'essai d4, de « ('42. » au tuple suivant ou à la fin de sa liste. Un message se cherche
// DANS le tuple de son contrôle : une recherche qui court au-delà rendrait en silence le message d'un autre contrôle.
function tupleDeLEssaiD4(numero: string): string {
  const debut = ESSAI_D4.indexOf(`('${numero}. `)
  expect(debut, `contrôle ${numero} de l’essai d4`).toBeGreaterThanOrEqual(0)
  expect(ESSAI_D4.indexOf(`('${numero}. `, debut + 1), `contrôle ${numero} unique dans l’essai d4`).toBe(-1)
  const fins = [ESSAI_D4.indexOf("\n        ('", debut + 1), ESSAI_D4.indexOf('\n      ) t(', debut)].filter((i) => i > 0)
  return ESSAI_D4.slice(debut, Math.min(...fins))
}

// Le message qu'un contrôle refusé de l'essai d4 attend de la base : la dernière chaîne de son tuple. Un motif LIKE finit
// par « % ».
function messageDeLEssaiD4(numero: string): string {
  const m = /'(?:22023|P0002)', '((?:[^']|'')*)'\),?\s*$/.exec(tupleDeLEssaiD4(numero))
  expect(m, `message du contrôle ${numero} de l’essai d4`).not.toBeNull()
  return (m as RegExpExecArray)[1].replace(/''/g, "'")
}

// Un refus de la contre-passation tel que l'essai l'écrit en SQL : guillemets doublés, l'expression à la place du « % ».
function modeleEnSql(cle: CleRefusContrePassation, expression: string): string {
  const { modele } = REFUS_CONTRE_PASSATION.find((r) => r.cle === cle) as (typeof REFUS_CONTRE_PASSATION)[number]
  return `'${modele.replace(/'/g, "''").replace('%', `' || ${expression} || '`)}'`
}

function attendreLeMessageDeLEssaiD4(numero: string, recu: string | undefined) {
  const attendu = messageDeLEssaiD4(numero)
  if (attendu.endsWith('%')) expect(recu?.startsWith(attendu.slice(0, -1)), `${numero} : ${recu}`).toBe(true)
  else expect(recu, numero).toBe(attendu)
}

function declaration(o: Partial<DeclarationLue> = {}): DeclarationLue {
  return { id: 'dcl1', dossier_id: D, encaissement_id: 'e1', facture_id: 'f1', canal: 'manuel', hote: 'pa.exemple.fr', etat: 'depose', ...o }
}

function transmission(o: Partial<TransmissionPourDeclaration> = {}): TransmissionPourDeclaration {
  return { facture_id: 'f1', canal: 'plateforme', hote: 'pa.exemple.fr', etat: 'accepte', ...o }
}

function aContrePasser(o: Partial<EncaissementPourContrePassation> = {}): EncaissementPourContrePassation {
  return { ...encaissement(), date_encaissement: '2027-10-15', ...o }
}

describe('les refus des déclarations, tels que la migration les écrit', () => {
  it('declarer_encaissement_hors_application : les mêmes messages, dans le même ordre', () => {
    const sql = derniereDefinitionSql('declarer_encaissement_hors_application')
    expect(messagesSql(sql)).toHaveLength(8)
    expect(REFUS_DECLARATION.map((r) => r.modele)).toEqual(messagesSql(sql))
    expect(new Set(REFUS_DECLARATION.map((r) => r.cle)).size).toBe(REFUS_DECLARATION.length)
    for (const args of argumentsSql(sql)) expect(args).toEqual([])
  })

  it('annuler_encaissement : les mêmes messages, dans le même ordre, et leurs valeurs écrites comme le module les écrit', () => {
    const sql = derniereDefinitionSql('annuler_encaissement')
    expect(messagesSql(sql)).toHaveLength(12)
    expect(REFUS_CONTRE_PASSATION.map((r) => r.modele)).toEqual(messagesSql(sql))
    expect(new Set(REFUS_CONTRE_PASSATION.map((r) => r.cle)).size).toBe(REFUS_CONTRE_PASSATION.length)
    const attendus: Record<string, string[]> = {
      date_avant_encaissement: ["to_char(v_encaissement.date_encaissement, 'DD/MM/YYYY')"],
      date_future: ["to_char(v_aujourd_hui, 'DD/MM/YYYY')"],
    }
    const args = argumentsSql(sql)
    expect(args).toHaveLength(REFUS_CONTRE_PASSATION.length)
    REFUS_CONTRE_PASSATION.forEach((r, i) => {
      expect(args[i], r.cle).toEqual(attendus[r.cle] ?? [])
      expect(r.modele.split('%').length - 1, r.cle).toBe(args[i].length)
    })
    expect(sql).toContain("(now() at time zone 'Europe/Paris')::date")
  })

  it('vire au rouge sur une dérive plantée dans le texte des fonctions', () => {
    const sql = derniereDefinitionSql('declarer_encaissement_hors_application')
    const attendu = REFUS_DECLARATION.map((r) => r.modele)
    const a = "raise exception 'Cet encaissement est retiré : il n''a jamais été déclaré, et ne se déclare plus.'"
    const b = "raise exception 'Cet encaissement est déjà déclaré : une déclaration ne se fait qu''une fois.'"
    expect(sql).toContain(a)
    expect(sql).toContain(b)
    expect(messagesSql(sql.replace(a, '§').replace(b, a).replace('§', b))).not.toEqual(attendu)
    expect(messagesSql(sql.replace('déjà déclaré', 'bien déclaré'))).not.toEqual(attendu)
    const autre = derniereDefinitionSql('annuler_encaissement')
    expect(messagesSql(autre.replace("'Le motif de la contre-passation est à renseigner.'", "'Le motif est à renseigner.'")))
      .not.toEqual(REFUS_CONTRE_PASSATION.map((r) => r.modele))
  })

  it('les états qui déclarent, le statut 200, les statuts qui annulent et les longueurs sont ceux de la migration', () => {
    expect(MIGRATION_D4).not.toBe('')
    const etats = (texte: string) => [...texte.matchAll(/'([a-z]+)'/g)].map((m) => m[1])
    const corps = /t\.etat in \(([^)]*)\)\)\s*$/.exec(derniereDefinitionSql('encaissement_declare'))
    expect(etats((corps as RegExpExecArray)[1])).toEqual([...ETATS_DECLARANTS])
    const index = /create unique index transmissions_encaissements_une_active[^;]*where etat in \(([^)]*)\);/.exec(MIGRATION_D4)
    expect(etats((index as RegExpExecArray)[1])).toEqual([...ETATS_DECLARANTS])
    const sql = derniereDefinitionSql('declarer_encaissement_hors_application')
    expect(sql).toContain(`e.status_code = '${STATUT_DEPOSEE_SUPERPDP}'`)
    const statuts = /e\.status_code in \(([^)]*)\)/.exec(sql)
    expect([...((statuts as RegExpExecArray)[1]).matchAll(/'([^']+)'/g)].map((m) => m[1])).toEqual([...STATUTS_ANNULATION_SUPERPDP])
    expect(sql).toContain(`if length(v_note) > ${LONGUEUR_MAX_TEXTE} then`)
    expect(sql).toContain("v_note text := case when btrim(p_note) = '' then null else p_note end;")
    const annuler = derniereDefinitionSql('annuler_encaissement')
    expect(annuler).toContain(`if length(p_motif) > ${LONGUEUR_MAX_TEXTE} then`)
    expect(annuler).toContain("if p_motif is null or btrim(p_motif) = '' then")
    expect(MIGRATION_D4).toContain(`check (btrim(note) <> '' and length(note) <= ${LONGUEUR_MAX_TEXTE})`)
  })
})

describe('encaissementsDeclares et plateformeAcceptee', () => {
  it('un encaissement est déclaré par une déclaration active : partie sans issue connue, déposée, acceptée', () => {
    const declares = encaissementsDeclares([
      declaration({ encaissement_id: 'e1', etat: 'envoi' }), declaration({ encaissement_id: 'e2', etat: 'depose' }),
      declaration({ encaissement_id: 'e3', etat: 'accepte' }), declaration({ encaissement_id: 'e4', etat: 'echec' }),
      declaration({ encaissement_id: 'e5', etat: 'rejete' }),
    ])
    expect([...declares].sort()).toEqual(['e1', 'e2', 'e3'])
    expect(encaissementsDeclares([])).toEqual(new Set())
  })

  it('la plateforme qui a accepté la facture : sa transmission acceptée, ou Super PDP déposée avec le statut 200', () => {
    const fr200 = { facture_id: 'f1', status_code: 'fr:200' }
    expect(plateformeAcceptee('f1', [transmission()], [])).toBe('pa.exemple.fr')
    expect(plateformeAcceptee('f1', [transmission({ canal: 'superpdp', hote: 'api.superpdp.tech' })], [])).toBe('api.superpdp.tech')
    const spdp = transmission({ canal: 'superpdp', hote: 'api.superpdp.tech', etat: 'depose' })
    expect(plateformeAcceptee('f1', [spdp], [fr200])).toBe('api.superpdp.tech')
    expect(plateformeAcceptee('f1', [spdp], [])).toBeNull()
    expect(plateformeAcceptee('f1', [spdp], [{ facture_id: 'f1', status_code: 'fr:201' }])).toBeNull()
    expect(plateformeAcceptee('f1', [spdp], [{ facture_id: 'f2', status_code: 'fr:200' }])).toBeNull()
    // Le statut 200 ne vaut que chez Super PDP : la plateforme du client dit l'acceptation par son accusé.
    expect(plateformeAcceptee('f1', [transmission({ etat: 'depose' })], [fr200])).toBeNull()
    for (const etat of ['envoi', 'echec', 'rejete'] as const) {
      expect(plateformeAcceptee('f1', [transmission({ etat })], [fr200]), etat).toBeNull()
      expect(plateformeAcceptee('f1', [{ ...spdp, etat }], [fr200]), `superpdp ${etat}`).toBeNull()
    }
    expect(plateformeAcceptee('f1', [transmission({ facture_id: 'f2' })], [])).toBeNull()
    expect(plateformeAcceptee('f1', [], [])).toBeNull()
  })

  it('une contre-passation se déclare là où son encaissement l’a été', () => {
    const annulation = encaissement({ id: 'a1', montant: -100, annule_id: 'e1' })
    expect(plateformeDeLaDeclaration(annulation, [declaration({ hote: 'autre.exemple.fr' })], [transmission()], [])).toBe('autre.exemple.fr')
    expect(plateformeDeLaDeclaration(annulation, [declaration({ etat: 'rejete' })], [transmission()], [])).toBeNull()
    expect(plateformeDeLaDeclaration(encaissement(), [], [transmission()], [])).toBe('pa.exemple.fr')
    expect(plateformeDeLaDeclaration(encaissement(), [], [], [])).toBeNull()
  })
})

describe('refusDeclaration — les refus de declarer_encaissement_hors_application', () => {
  const e1 = encaissement()
  const ACCEPTEE = [transmission()]
  const refusD = (o: {
    encaissements?: EncaissementLu[]; declarations?: DeclarationLue[]; transmissions?: TransmissionPourDeclaration[];
    evenements?: { facture_id: string; status_code: string }[]; statutsRecus?: StatutPlateformeLu[]; note?: string | null;
    id?: string; dossier?: string
  } = {}) => refusDeclaration(o.dossier ?? D, o.id ?? 'e1', o.encaissements ?? [e1], o.declarations ?? [], o.transmissions ?? ACCEPTEE,
    o.evenements ?? [], o.statutsRecus ?? [], o.note === undefined ? null : o.note)

  it('accepte un encaissement vivant, jamais déclaré, d’une facture acceptée', () => {
    expect(refusD()).toBeNull()
    expect(refusD({ note: 'Saisi par le client le 07/10.' })).toBeNull()
    // Une déclaration échouée ou rejetée ne le retient pas.
    expect(refusD({ declarations: [declaration({ etat: 'rejete' }), declaration({ id: 'x', canal: 'plateforme', etat: 'echec' })] })).toBeNull()
    // Le rejet ou le refus d'une AUTRE facture ne la retient pas.
    expect(refusD({ transmissions: [transmission(), transmission({ facture_id: 'f2', etat: 'rejete' })] })).toBeNull()
    expect(refusD({ evenements: [{ facture_id: 'f2', status_code: 'fr:210' }, { facture_id: 'f2', status_code: 'fr:213' }] })).toBeNull()
    // Une contre-passation, quand l'encaissement qu'elle annule est déclaré — la facture refusée depuis n'y change rien.
    const annulation = encaissement({ id: 'a1', montant: -100, annule_id: 'e1' })
    expect(refusD({ id: 'a1', encaissements: [e1, annulation], declarations: [declaration()], transmissions: [],
      evenements: [{ facture_id: 'f1', status_code: 'fr:210' }] })).toBeNull()
  })

  it('refuse, dans l’ordre de la base, avec les messages qu’elle a rendus en production', () => {
    attendreLeMessageDeLEssaiD4('6', refusD({ dossier: 'd2' })?.message)
    attendreLeMessageDeLEssaiD4('7', refusD({ id: 'inconnu' })?.message)
    attendreLeMessageDeLEssaiD4('8', refusD({ encaissements: [{ ...e1, retire_le: '2027-10-20T10:00:00Z' }] })?.message)
    attendreLeMessageDeLEssaiD4('9', refusD({ declarations: [declaration()] })?.message)
    attendreLeMessageDeLEssaiD4('10', refusD({ declarations: [declaration({ canal: 'plateforme', etat: 'envoi' })] })?.message)
    const annulation = encaissement({ id: 'a1', montant: -100, annule_id: 'e1' })
    attendreLeMessageDeLEssaiD4('11', refusD({ id: 'a1', encaissements: [e1, annulation] })?.message)
    attendreLeMessageDeLEssaiD4('12', refusD({ id: 'a1', encaissements: [e1, annulation], declarations: [declaration({ etat: 'rejete' })] })?.message)
    attendreLeMessageDeLEssaiD4('13', refusD({ transmissions: [transmission({ etat: 'rejete' })] })?.message)
    attendreLeMessageDeLEssaiD4('14', refusD({ evenements: [{ facture_id: 'f1', status_code: 'fr:210' }] })?.message)
    attendreLeMessageDeLEssaiD4('15', refusD({ evenements: [{ facture_id: 'f1', status_code: 'fr:213' }] })?.message)
    attendreLeMessageDeLEssaiD4('16', refusD({ transmissions: [] })?.message)
    attendreLeMessageDeLEssaiD4('17', refusD({ transmissions: [transmission({ etat: 'echec' })] })?.message)
    attendreLeMessageDeLEssaiD4('18', refusD({ transmissions: [transmission({ etat: 'envoi' })] })?.message)
    attendreLeMessageDeLEssaiD4('19', refusD({ transmissions: [transmission({ etat: 'depose' })] })?.message)
    attendreLeMessageDeLEssaiD4('20', refusD({ transmissions: [transmission({ canal: 'superpdp', hote: 'api.superpdp.tech', etat: 'depose' })],
      evenements: [{ facture_id: 'f1', status_code: 'fr:201' }] })?.message)
    attendreLeMessageDeLEssaiD4('22', refusD({ note: 'n'.repeat(2001) })?.message)
    attendreLeMessageDeLEssaiD4('23', refusD({ note: ` ${'n'.repeat(1999)} ` })?.message)
    attendreLeMessageDeLEssaiD4('24b', refusD({ declarations: [declaration()], evenements: [{ facture_id: 'f1', status_code: 'fr:210' }] })?.message)
    attendreLeMessageDeLEssaiD4('24c', refusD({ id: 'a1', encaissements: [e1, annulation], note: 'n'.repeat(2001) })?.message)
    attendreLeMessageDeLEssaiD4('24d', refusD({ transmissions: [], note: 'n'.repeat(2001) })?.message)
  })

  it('suit l’ordre de la base : chaque refus corrigé laisse paraître le suivant', () => {
    const annulation = encaissement({ id: 'a1', montant: -100, annule_id: 'e1', retire_le: '2027-10-20T10:00:00Z' })
    let o = {
      id: 'a1', dossier: 'd2', encaissements: [e1, annulation], declarations: [declaration({ encaissement_id: 'a1' })],
      transmissions: [transmission({ etat: 'rejete' })], note: 'n'.repeat(2001) as string | null,
    }
    const etapes: [string, () => void][] = [
      ['encaissement_introuvable', () => { o = { ...o, dossier: D } }],
      ['retire', () => { o = { ...o, encaissements: [e1, { ...annulation, retire_le: null }] } }],
      ['deja_declare', () => { o = { ...o, declarations: [] } }],
      ['contre_passation_non_declaree', () => { o = { ...o, id: 'e1' } }],
      ['facture_rejetee', () => { o = { ...o, transmissions: [transmission({ etat: 'depose' })] } }],
      ['sans_transmission_acceptee', () => { o = { ...o, transmissions: ACCEPTEE } }],
      ['note_trop_longue', () => { o = { ...o, note: null } }],
    ]
    const vus: string[] = []
    for (const [cle, corriger] of etapes) {
      vus.push(refusD(o)?.cle ?? 'aucun')
      expect(vus[vus.length - 1], `avant de corriger ${cle}`).toBe(cle)
      corriger()
    }
    expect(refusD(o)).toBeNull()
    expect(vus).toEqual(REFUS_DECLARATION.map((r) => r.cle).filter((cle) => cle !== 'acces'))
  })

  it('mesure la note comme la base : des espaces seuls ne sont pas une note, un caractère est un caractère', () => {
    expect(refusD({ note: ' '.repeat(5000) })).toBeNull()
    expect(refusD({ note: '' })).toBeNull()
    // Une tabulation, un saut de ligne ne sont pas des espaces pour btrim : 2 001 sauts de ligne sont trop longs.
    expect(refusD({ note: '\n'.repeat(2001) })?.cle).toBe('note_trop_longue')
    // Un emoji est un caractère pour length, deux unités pour String.length.
    expect(refusD({ note: '💶'.repeat(2000) })).toBeNull()
    expect(refusD({ note: '💶'.repeat(2001) })?.cle).toBe('note_trop_longue')
    expect(refusD({ note: 'n'.repeat(2000) })).toBeNull()
  })
})

describe('refusContrePassation — les refus d’annuler_encaissement', () => {
  const e1 = aContrePasser()
  const DECLARE = [declaration()]
  const refusC = (o: {
    encaissements?: EncaissementPourContrePassation[]; declarations?: DeclarationLue[]; date?: string | null;
    motif?: string | null; id?: string; dossier?: string
  } = {}) => refusContrePassation(o.dossier ?? D, o.id ?? 'e1', o.encaissements ?? [e1], o.declarations ?? DECLARE,
    o.date === undefined ? '2027-11-02' : o.date, o.motif === undefined ? 'Chèque revenu impayé' : o.motif, AUJOURD_HUI)

  it('accepte la contre-passation d’un encaissement déclaré, datée de lui à aujourd’hui', () => {
    expect(refusC()).toBeNull()
    expect(refusC({ date: '2027-10-15' })).toBeNull()
    expect(refusC({ declarations: [declaration({ etat: 'accepte' })] })).toBeNull()
    // Une contre-passation retirée, jamais déclarée, ne le retient plus.
    expect(refusC({ encaissements: [e1, aContrePasser({ id: 'a1', montant: -100, annule_id: 'e1', retire_le: '2027-10-21T10:00:00Z' })] })).toBeNull()
    expect(refusC({ motif: 'm'.repeat(2000) })).toBeNull()
  })

  it('refuse, dans l’ordre de la base, avec les messages qu’elle a rendus en production', () => {
    attendreLeMessageDeLEssaiD4('32', refusC({ dossier: 'd2' })?.message)
    attendreLeMessageDeLEssaiD4('33', refusC({ id: 'inconnu' })?.message)
    const annulation = aContrePasser({ id: 'a1', montant: -100, annule_id: 'e1' })
    attendreLeMessageDeLEssaiD4('34', refusC({ id: 'a1', encaissements: [e1, annulation] })?.message)
    attendreLeMessageDeLEssaiD4('35', refusC({ encaissements: [{ ...e1, retire_le: '2027-10-20T10:00:00Z' }], declarations: [] })?.message)
    attendreLeMessageDeLEssaiD4('36', refusC({ declarations: [] })?.message)
    attendreLeMessageDeLEssaiD4('37', refusC({ declarations: [declaration({ canal: 'plateforme', etat: 'echec' })] })?.message)
    attendreLeMessageDeLEssaiD4('38', refusC({ declarations: [declaration({ etat: 'rejete' })] })?.message)
    attendreLeMessageDeLEssaiD4('39', refusC({ declarations: [declaration({ canal: 'plateforme', etat: 'envoi' })] })?.message)
    attendreLeMessageDeLEssaiD4('40', refusC({ encaissements: [e1, annulation] })?.message)
    attendreLeMessageDeLEssaiD4('41', refusC({ date: null })?.message)
    // Les messages qui portent une date : l'essai les construit avec la sienne, le module avec celle qu'il reçoit — sur
    // le même modèle.
    expect(refusC({ date: '2027-10-14' })?.message).toBe("Une contre-passation ne se date pas avant l'encaissement qu'elle annule, du 15/10/2027.")
    expect(tupleDeLEssaiD4('42')).toContain(`'22023', ${modeleEnSql('date_avant_encaissement', "to_char(jour, 'DD/MM/YYYY')")})`)
    expect(refusC({ date: '2027-11-03' })?.message).toBe("Une contre-passation ne se date pas dans l'avenir : nous sommes le 02/11/2027.")
    expect(tupleDeLEssaiD4('43')).toContain(`'22023', ${modeleEnSql('date_future', "to_char(aujourd_hui, 'DD/MM/YYYY')")})`)
    attendreLeMessageDeLEssaiD4('44', refusC({ motif: null })?.message)
    attendreLeMessageDeLEssaiD4('45', refusC({ motif: '   ' })?.message)
    attendreLeMessageDeLEssaiD4('46', refusC({ motif: 'm'.repeat(2001) })?.message)
    attendreLeMessageDeLEssaiD4('47', refusC({ date: null, motif: null })?.message)
    attendreLeMessageDeLEssaiD4('48', refusC({ declarations: [], date: null, motif: null })?.message)
    attendreLeMessageDeLEssaiD4('48b', refusC({ encaissements: [e1, annulation], declarations: [declaration({ canal: 'plateforme', etat: 'envoi' })] })?.message)
    attendreLeMessageDeLEssaiD4('48c', refusC({ encaissements: [e1, annulation], date: null, motif: null })?.message)
  })

  it('suit l’ordre de la base : chaque refus corrigé laisse paraître le suivant', () => {
    const annulation = aContrePasser({ id: 'a1', montant: -100, annule_id: 'e1' })
    // Au départ la contre-passation est RETIRÉE elle aussi : la base dit qu'elle ne se contre-passe pas avant de dire
    // qu'elle est retirée.
    let o = {
      id: 'a1', dossier: 'd2',
      encaissements: [{ ...e1, retire_le: '2027-10-20T10:00:00Z' }, { ...annulation, retire_le: '2027-10-21T10:00:00Z' }] as EncaissementPourContrePassation[],
      declarations: [declaration({ canal: 'plateforme', etat: 'envoi' })], date: 'pas une date' as string | null,
      motif: 'm'.repeat(2001) as string | null,
    }
    const etapes: [string, () => void][] = [
      ['encaissement_introuvable', () => { o = { ...o, dossier: D } }],
      ['contre_passation', () => { o = { ...o, id: 'e1', declarations: [] } }],
      ['retire', () => { o = { ...o, encaissements: [e1, annulation] } }],
      ['non_declare', () => { o = { ...o, declarations: [declaration({ canal: 'plateforme', etat: 'envoi' })] } }],
      ['issue_inconnue', () => { o = { ...o, declarations: DECLARE } }],
      ['deja_contre_passe', () => { o = { ...o, encaissements: [e1, { ...annulation, retire_le: '2027-10-21T10:00:00Z' }] } }],
      ['date_absente', () => { o = { ...o, date: '2027-10-14' } }],
      ['date_avant_encaissement', () => { o = { ...o, date: '2027-11-03' } }],
      ['date_future', () => { o = { ...o, date: '2027-11-02', motif: '' } }],
      ['motif_absent', () => { o = { ...o, motif: 'm'.repeat(2001) } }],
      ['motif_trop_long', () => { o = { ...o, motif: 'Chèque revenu impayé' } }],
    ]
    const vus: string[] = []
    for (const [cle, corriger] of etapes) {
      vus.push(refusC(o)?.cle ?? 'aucun')
      expect(vus[vus.length - 1], `avant de corriger ${cle}`).toBe(cle)
      corriger()
    }
    expect(refusC(o)).toBeNull()
    expect(vus).toEqual(REFUS_CONTRE_PASSATION.map((r) => r.cle).filter((cle) => cle !== 'acces'))
  })

  it('mesure le motif comme la base, et tient une date qui n’en est pas une pour absente', () => {
    expect(refusC({ motif: '\n' })).toBeNull()
    expect(refusC({ motif: '💶'.repeat(2000) })).toBeNull()
    expect(refusC({ motif: '💶'.repeat(2001) })?.cle).toBe('motif_trop_long')
    for (const date of ['', '2027-02-30', '15/10/2027', '2027-13-01']) expect(refusC({ date })?.cle, date).toBe('date_absente')
  })
})

describe('contrePassationDe — ce que la contre-passation écrira', () => {
  it('le montant et chaque part, opposés, en centimes, du taux le plus fort au plus faible', () => {
    const parts = [part({ taux: 0, montant: 18.44 }), part({ taux: 20, montant: 442.64 }), part({ taux: 5.5, montant: 38.92 }),
      part({ encaissement_id: 'e2', taux: 20, montant: 7 })]
    expect(contrePassationDe(encaissement({ montant: 500 }), parts)).toEqual({
      montantCentimes: -50000,
      parts: [{ taux: 20, centimes: -44264 }, { taux: 5.5, centimes: -3892 }, { taux: 0, centimes: -1844 }],
    })
    // Un montant que la virgule flottante écrit juste en dessous du centime se compte au centime.
    expect(contrePassationDe(encaissement({ montant: 4.35 }), [part({ montant: 4.35 })]).montantCentimes).toBe(-435)
  })
})

// ── Les statuts lus sur la plateforme du client (étape d7) ──────────────────────────────────────────────────────────

// L'essai de l'étape d7, joué en production : ce que la base a accepté et refusé, avec ses messages.
const ESSAI_D7 = readFileSync(new URL('../../supabase/essais/statutsFacturesRecus.sql', import.meta.url), 'utf8')

// La migration de l'étape d7, trouvée par ce qu'elle crée.
const MIGRATION_D7 = fichiersDuSchema().find((f) => f.texte.includes('create table public.statuts_factures_recus ('))?.texte ?? ''

// Le tuple d'un contrôle de l'essai d7, de « ('25. » au tuple suivant ou à la fin de sa liste, sans ses lignes de
// commentaire : ce que le contrôle attend se cherche DANS son tuple, jamais dans celui d'un autre.
function tupleDeLEssaiD7(numero: string): string {
  const debut = ESSAI_D7.indexOf(`('${numero}. `)
  expect(debut, `contrôle ${numero} de l’essai d7`).toBeGreaterThanOrEqual(0)
  expect(ESSAI_D7.indexOf(`('${numero}. `, debut + 1), `contrôle ${numero} unique dans l’essai d7`).toBe(-1)
  const fins = [ESSAI_D7.indexOf("\n        ('", debut + 1), ESSAI_D7.indexOf('\n      ) t(', debut)].filter((i) => i > 0)
  return ESSAI_D7.slice(debut, Math.min(...fins)).split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')
}

// Ce qu'un contrôle de l'essai d7 attend de la base : un refus (son message, la dernière chaîne du tuple ; un motif LIKE
// finit par « % »), ou rien (« null, null ») pour un appel qu'elle accepte.
function attenduDeLEssaiD7(numero: string): string | null {
  const tuple = tupleDeLEssaiD7(numero)
  if (/null, null\),?\s*$/.test(tuple)) return null
  const m = /'(?:22023|23514)', '((?:[^']|'')*)'\),?\s*$/.exec(tuple)
  expect(m, `ce qu’attend le contrôle ${numero} de l’essai d7`).not.toBeNull()
  return (m as RegExpExecArray)[1].replace(/''/g, "'")
}

function attendreCeQuAttendLEssaiD7(numero: string, recu: string | undefined) {
  const attendu = attenduDeLEssaiD7(numero)
  if (attendu == null) expect(recu, `${numero} : accepté par la base`).toBeUndefined()
  else if (attendu.endsWith('%')) expect(recu?.startsWith(attendu.slice(0, -1)), `${numero} : ${recu}`).toBe(true)
  else expect(recu, numero).toBe(attendu)
}

describe('les statuts lus sur la plateforme du client (étape d7), tels que la base les lit', () => {
  // Les codes d'un `s.code in (…)`, un tableau par occurrence, dans l'ordre du texte.
  const codesLus = (sql: string) => [...sql.matchAll(/s\.code in \(([^)]*)\)/g)]
    .map((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]))

  it('les statuts qui annulent sont ceux que la base lit, aux quatre endroits où la règle vit', () => {
    expect(MIGRATION_D7).not.toBe('')
    const endroits: [string, number][] = [
      ['enregistrer_encaissement', 1], ['declarer_encaissement_hors_application', 1],
      ['garder_transmission_encaissement', 1], ['garder_transmission_facture', 2],
    ]
    for (const [nom, combien] of endroits) {
      const sql = derniereDefinitionSql(nom)
      expect(MIGRATION_D7, nom).toContain(sql)
      expect(codesLus(sql), nom).toEqual(Array.from({ length: combien }, () => [...STATUTS_ANNULATION_PLATEFORME]))
      expect(sql, nom).toContain('from public.statuts_factures_recus s')
    }
    // Les mêmes que chez Super PDP, sans leur préfixe : un refus est un refus, d'où qu'il vienne.
    expect(STATUTS_ANNULATION_SUPERPDP.map((c) => c.replace(/^fr:/, ''))).toEqual([...STATUTS_ANNULATION_PLATEFORME])
  })

  it('le refus 5 de l’enregistrement et le refus 6 de la déclaration s’élargissent sans changer de place ni de mots', () => {
    // Le statut lu s'ajoute à la condition de Super PDP, dans le même `if` : le message qui suit est celui d'hier.
    const enregistrer = derniereDefinitionSql('enregistrer_encaissement')
    const declarer = derniereDefinitionSql('declarer_encaissement_hors_application')
    for (const [sql, message] of [
      [enregistrer, (REFUS_ENREGISTREMENT.find((r) => r.cle === 'rejetee') as { modele: string }).modele],
      [declarer, (REFUS_DECLARATION.find((r) => r.cle === 'facture_rejetee') as { modele: string }).modele],
    ] as const) {
      const lu = sql.indexOf("s.code in ('210', '213')")
      const superpdp = sql.lastIndexOf("e.status_code in ('fr:210', 'fr:213')", lu)
      const refusSql = sql.indexOf('raise exception', lu)
      expect(superpdp).toBeGreaterThan(0)
      expect(sql.slice(superpdp, lu)).not.toContain('raise exception')
      expect(sql.slice(refusSql).startsWith(`raise exception '${message.replace(/'/g, "''")}'`)).toBe(true)
    }
  })

  it('une déclaration d’hier ne compte que le refus lu avant elle ; une transmission, que celui lu avant son départ', () => {
    const garde = derniereDefinitionSql('garder_transmission_encaissement')
    expect(garde).toContain("s.code in ('210', '213')\n                         and s.lu_le <= v_connu_le")
    expect(garde).toContain("v_connu_le := case when new.cree_le = now() then 'infinity'::timestamptz else new.cree_le end;")
    const facture = derniereDefinitionSql('garder_transmission_facture')
    expect(facture.match(/s\.lu_le <= new\.cree_le/g)).toHaveLength(2)
    // Les deux nouvelles conditions ne valent qu'à l'insertion : le suivi d'une transmission déposée n'est pas un envoi.
    expect(facture.lastIndexOf('statuts_factures_recus')).toBeLessThan(facture.indexOf('    return new;\n  end if;'))
  })
})

describe('refusDeLaFacture et refusDeclaration — un refus lu sur la plateforme du client (étape d7)', () => {
  const e1 = encaissement()
  const ACCEPTEE = [transmission()]
  const refusD = (statutsRecus: StatutPlateformeLu[], o: { declarations?: DeclarationLue[]; id?: string; encaissements?: EncaissementLu[] } = {}) =>
    refusDeclaration(D, o.id ?? 'e1', o.encaissements ?? [e1], o.declarations ?? [], ACCEPTEE, [], statutsRecus, null)
  const refusE = (statutsRecus: StatutPlateformeLu[]) => refus(contexte({ statutsRecus }), saisie())

  it('l’enregistrement : refusé sous 210 et 213, avec les messages que la base a rendus (contrôles 21 et 22)', () => {
    attendreCeQuAttendLEssaiD7('21', refusE([{ facture_id: 'f1', code: '210' }])?.message)
    attendreCeQuAttendLEssaiD7('22', refusE([{ facture_id: 'f1', code: '213' }])?.message)
    expect(refusDeLaFacture(contexte({ statutsRecus: [{ facture_id: 'f1', code: '213' }] }))?.cle).toBe('rejetee')
  })

  it('l’enregistrement : accepté sous un litige, une approbation, un paiement transmis, un écho, ou le refus d’une autre facture (23, 24)', () => {
    attendreCeQuAttendLEssaiD7('23', refusE([
      { facture_id: 'f1', code: '207' }, { facture_id: 'f1', code: '205' }, { facture_id: 'f1', code: '211' }, { facture_id: 'f1', code: '212' },
    ])?.message)
    attendreCeQuAttendLEssaiD7('24', refusE([{ facture_id: 'f2', code: '210' }])?.message)
    for (const code of ['200', '201', '202', '203', '204', '206', '208', '209'] as const) {
      expect(refusE([{ facture_id: 'f1', code }]), code).toBeNull()
    }
  })

  it('la déclaration : refusée sous 210 et 213 ; « déjà déclaré » passe avant ; acceptée sinon (contrôles 25 à 29)', () => {
    attendreCeQuAttendLEssaiD7('25', refusD([{ facture_id: 'f1', code: '210' }])?.message)
    attendreCeQuAttendLEssaiD7('26', refusD([{ facture_id: 'f1', code: '213' }])?.message)
    attendreCeQuAttendLEssaiD7('27', refusD([{ facture_id: 'f1', code: '210' }], { declarations: [declaration()] })?.message)
    attendreCeQuAttendLEssaiD7('28', refusD([{ facture_id: 'f1', code: '207' }])?.message)
    attendreCeQuAttendLEssaiD7('28b', refusD([{ facture_id: 'f2', code: '210' }])?.message)
    // La contre-passation d'un encaissement déclaré se déclare encore, la facture refusée depuis.
    const annulation = encaissement({ id: 'a1', montant: -100, annule_id: 'e1' })
    attendreCeQuAttendLEssaiD7('29', refusD([{ facture_id: 'f1', code: '210' }],
      { id: 'a1', encaissements: [e1, annulation], declarations: [declaration()] })?.message)
    expect(refusD([{ facture_id: 'f1', code: '210' }])?.cle).toBe('facture_rejetee')
  })

  it('la contre-passation et le retrait restent possibles, la facture refusée depuis (contrôles 30 et 31)', () => {
    // La base les accepte : la migration ne redéfinit ni l'une ni l'autre fonction, et l'essai l'a vérifié en production.
    expect(attenduDeLEssaiD7('30')).toBeNull()
    expect(attenduDeLEssaiD7('31')).toBeNull()
    expect(MIGRATION_D7).not.toMatch(/function public\.(annuler|retirer)_encaissement\(/)
    // Le module non plus : ni `refusContrePassation` ni `refusRetrait` ne lisent un statut.
    expect(refusContrePassation(D, 'e1', [aContrePasser()], [declaration()], '2027-10-20', 'Facture refusée', AUJOURD_HUI)).toBeNull()
    expect(refusRetrait(D, 'e1', [e1], new Set())).toBeNull()
  })
})

// ── Le TTC par taux et le reste ────────────────────────────────────────────────────────────────────────────────────

describe('ttcParTaux et resteAEncaisser', () => {
  it('le TTC par taux est celui de montantsDuDocument, du taux le plus fort au plus faible', () => {
    expect(ttcParTaux(facture(), LIGNES)).toEqual([{ taux: 20, ttcCentimes: 120000 }, { taux: 5.5, ttcCentimes: 10550 }, { taux: 0, ttcCentimes: 5000 }])
    const m = montantsDuDocument({ type: 'facture' }, LIGNES, null)
    expect(ttcParTaux(facture(), LIGNES).map((t) => t.ttcCentimes)).toEqual(m.groupes.map((g) => g.baseCentimes + g.tvaCentimes))
    // Les lignes d'une autre facture n'y entrent pas ; une ligne à 1,005 € vaut 1,00 € HT, comme la facture transmise.
    const ailleurs = { facture_id: 'f2', ordre: 1, designation: 'z', quantite: 1, prix_unitaire_ht: 999, taux_tva: 20 }
    expect(ttcParTaux(facture(), [...LIGNES, ailleurs])).toEqual(ttcParTaux(facture(), LIGNES))
    expect(ttcParTaux(facture(), [{ facture_id: 'f1', ordre: 1, designation: 'a', quantite: 1, prix_unitaire_ht: 1.005, taux_tva: 20 }]))
      .toEqual([{ taux: 20, ttcCentimes: 120 }])
  })

  it('le reste, sans encaissement : tout le TTC', () => {
    expect(resteAEncaisser(contexte())).toEqual({
      ttcCentimes: 135550, encaisseCentimes: 0, resteCentimes: 135550,
      parTaux: [
        { taux: 20, ttcCentimes: 120000, encaisseCentimes: 0, resteCentimes: 120000 },
        { taux: 5.5, ttcCentimes: 10550, encaisseCentimes: 0, resteCentimes: 10550 },
        { taux: 0, ttcCentimes: 5000, encaisseCentimes: 0, resteCentimes: 5000 },
      ],
    })
  })

  it('le reste est NET : les retirés ne comptent pas, les annulations comptent en négatif', () => {
    const c = contexte({
      encaissements: [
        encaissement({ id: 'e1', montant: 500 }),
        encaissement({ id: 'e2', montant: 300, retire_le: '2027-10-20T10:00:00Z' }),
        encaissement({ id: 'e3', montant: 200 }),
        encaissement({ id: 'a3', montant: -200, annule_id: 'e3' }),
        encaissement({ id: 'x', facture_id: 'f2', montant: 999 }),
      ],
      parts: [
        part({ encaissement_id: 'e1', taux: 20, montant: 442.64 }), part({ encaissement_id: 'e1', taux: 5.5, montant: 38.92 }),
        part({ encaissement_id: 'e1', taux: 0, montant: 18.44 }),
        part({ encaissement_id: 'e2', taux: 20, montant: 300 }),
        part({ encaissement_id: 'e3', taux: 20, montant: 200 }), part({ encaissement_id: 'a3', taux: 20, montant: -200 }),
        part({ encaissement_id: 'x', taux: 20, montant: 999 }),
      ],
    })
    expect(resteAEncaisser(c)).toEqual({
      ttcCentimes: 135550, encaisseCentimes: 50000, resteCentimes: 85550,
      parTaux: [
        { taux: 20, ttcCentimes: 120000, encaisseCentimes: 44264, resteCentimes: 75736 },
        { taux: 5.5, ttcCentimes: 10550, encaisseCentimes: 3892, resteCentimes: 6658 },
        { taux: 0, ttcCentimes: 5000, encaisseCentimes: 1844, resteCentimes: 3156 },
      ],
    })
  })

  it('les montants de la base se lisent au centime, même quand la virgule flottante tombe juste en dessous', () => {
    // 4,35 × 100 vaut 434,99999999999994 en virgule flottante : tronqué, l'encaissement perdrait un centime.
    const c = contexte({ encaissements: [encaissement({ montant: 4.35 })], parts: [part({ taux: 20, montant: 4.35 })] })
    expect(resteAEncaisser(c)).toMatchObject({ encaisseCentimes: 435, resteCentimes: 135115 })
    expect(resteAEncaisser(c).parTaux[0]).toMatchObject({ encaisseCentimes: 435, resteCentimes: 119565 })
    // Un mouvement de 0,57 € (56,99999999999999 centimes) justifie un encaissement de 0,58 € : un centime, 2 % d'écart.
    expect(refus(contexte(), saisie({ ligneBancaireId: 'm057', montant: 0.58, repartition: [{ taux: 20, montant: 0.58 }] }),
      [mouvement({ id: 'm057', montant: 0.57 })])).toBeNull()
  })

  it('un reste négatif se dit tel quel', () => {
    const c = contexte({ encaissements: [encaissement({ montant: 1400 })], parts: [part({ taux: 20, montant: 1400 })] })
    const r = resteAEncaisser(c)
    expect(r.resteCentimes).toBe(-4450)
    expect(r.parTaux[0].resteCentimes).toBe(-20000)
  })
})

// ── La répartition proposée ────────────────────────────────────────────────────────────────────────────────────────

describe('repartitionProposee — au prorata des restes (Q3)', () => {
  const RESTES = [{ taux: 20, resteCentimes: 120000 }, { taux: 5.5, resteCentimes: 10550 }, { taux: 0, resteCentimes: 5000 }]

  it('un encaissement qui solde la facture prend exactement le reste de chaque taux', () => {
    expect(repartitionProposee(135550, RESTES)).toEqual([{ taux: 20, centimes: 120000 }, { taux: 5.5, centimes: 10550 }, { taux: 0, centimes: 5000 }])
    // Après le partiel de l'essai (contrôle 43), le solde : exactement ce que la base a accepté.
    const apres = [{ taux: 20, resteCentimes: 75736 }, { taux: 5.5, resteCentimes: 6658 }, { taux: 0, resteCentimes: 3156 }]
    expect(repartitionProposee(85550, apres)).toEqual([{ taux: 20, centimes: 75736 }, { taux: 5.5, centimes: 6658 }, { taux: 0, centimes: 3156 }])
  })

  it('un partiel se répartit au prorata, les centimes aux plus forts restes de la division — celui de l’essai', () => {
    // 500 € : 442,64 € à 20 %, 38,92 € à 5,5 %, 18,44 € à 0 %, la répartition que la base a acceptée (contrôle 43).
    expect(repartitionProposee(50000, RESTES)).toEqual([{ taux: 20, centimes: 44264 }, { taux: 5.5, centimes: 3892 }, { taux: 0, centimes: 1844 }])
    // 10 € : 885,28 / 77,83 / 36,89 centimes ; deux centimes à placer, aux restes de 0,89 puis de 0,83.
    expect(repartitionProposee(1000, RESTES)).toEqual([{ taux: 20, centimes: 885 }, { taux: 5.5, centimes: 78 }, { taux: 0, centimes: 37 }])
  })

  it('à restes de division égaux, le taux le plus haut prend le centime', () => {
    expect(repartitionProposee(1, [{ taux: 10, resteCentimes: 100 }, { taux: 20, resteCentimes: 100 }])).toEqual([{ taux: 20, centimes: 1 }])
    expect(repartitionProposee(2, [{ taux: 5.5, resteCentimes: 100 }, { taux: 20, resteCentimes: 100 }, { taux: 10, resteCentimes: 100 }]))
      .toEqual([{ taux: 20, centimes: 1 }, { taux: 10, centimes: 1 }])
    // Un plus fort reste de division l'emporte sur un taux plus haut.
    expect(repartitionProposee(1, [{ taux: 20, resteCentimes: 100 }, { taux: 5.5, resteCentimes: 200 }])).toEqual([{ taux: 5.5, centimes: 1 }])
  })

  it('un taux sans reste, ou en excès, ne reçoit rien', () => {
    expect(repartitionProposee(100, [{ taux: 20, resteCentimes: 0 }, { taux: 10, resteCentimes: 500 }])).toEqual([{ taux: 10, centimes: 100 }])
    expect(repartitionProposee(100, [{ taux: 20, resteCentimes: -50 }, { taux: 10, resteCentimes: 500 }])).toEqual([{ taux: 10, centimes: 100 }])
  })

  it('rien à répartir : un montant qui n’est pas un nombre positif de centimes, aucun reste', () => {
    for (const montant of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(repartitionProposee(montant, RESTES), String(montant)).toBeNull()
    }
    expect(repartitionProposee(100, [])).toBeNull()
    expect(repartitionProposee(100, [{ taux: 20, resteCentimes: 0 }, { taux: 10, resteCentimes: -5 }])).toBeNull()
  })

  it('au-delà du reste, la somme fait encore le montant : la base dira le plafond', () => {
    const r = repartitionProposee(200000, RESTES) as { taux: number; centimes: number }[]
    expect(r.reduce((s, p) => s + p.centimes, 0)).toBe(200000)
    expect(refusEnregistrement(contexte(), saisie({ montant: 2000, repartition: r.map((p) => ({ taux: p.taux, montant: p.centimes / 100 })) }),
      MOUVEMENTS, AUJOURD_HUI)?.cle).toBe('plafond_facture')
  })

  it('la somme vaut toujours le montant, et aucun taux ne dépasse son reste — sur des tirages au hasard', () => {
    const hasard = tirage(20261008)
    for (let essai = 0; essai < 3000; essai++) {
      const restes = TAUX_ADMIS.filter(() => hasard() < 0.3).map((taux) => ({ taux, resteCentimes: Math.floor(hasard() * 10 ** (1 + Math.floor(hasard() * 8))) }))
      const total = restes.reduce((s, r) => s + Math.max(r.resteCentimes, 0), 0)
      const montant = 1 + Math.floor(hasard() * Math.max(total, 1))
      const r = repartitionProposee(montant, restes)
      if (total === 0) {
        expect(r).toBeNull()
        continue
      }
      const parts = r as { taux: number; centimes: number }[]
      expect(parts.reduce((s, p) => s + p.centimes, 0)).toBe(montant)
      for (const p of parts) {
        expect(Number.isInteger(p.centimes) && p.centimes > 0).toBe(true)
        expect(p.centimes).toBeLessThanOrEqual(restes.find((t) => t.taux === p.taux)?.resteCentimes ?? -1)
      }
    }
  })

  it('reste exacte aux montants que la virgule flottante ne multiplie plus juste', () => {
    // 10^15 centimes passent 2^53 une fois multipliés : les entiers longs gardent l'égalité exacte.
    const grands = [{ taux: 20, resteCentimes: 999_999_999_999_998 }, { taux: 0, resteCentimes: 1 }]
    expect(repartitionProposee(999_999_999_999_999, grands)).toEqual([{ taux: 20, centimes: 999_999_999_999_998 }, { taux: 0, centimes: 1 }])
    expect(repartitionProposee(3, grands)).toEqual([{ taux: 20, centimes: 3 }])
  })
})

// ── L'échéance ─────────────────────────────────────────────────────────────────────────────────────────────────────

describe('echeanceDeDeclaration — le 10 du mois suivant au réel, le 25 du mois qui suit le bimestre en franchise', () => {
  const FUSEAU_D_ORIGINE = process.env.TZ
  afterEach(() => {
    process.env.TZ = FUSEAU_D_ORIGINE
  })

  it('au réel : le mois de l’encaissement, à déclarer le 10 du mois suivant', () => {
    expect(echeanceDeDeclaration('2027-10-15', 'redevable')).toEqual({
      frequence: 'mensuelle', periodeDebut: '2027-10-01', periodeFin: '2027-10-31', date: '2027-11-10',
      libelle: 'Paiements d’octobre 2027 : à déclarer au plus tard le 10/11/2027.',
    })
    expect(echeanceDeDeclaration('2027-12-31', 'redevable')).toMatchObject({ periodeFin: '2027-12-31', date: '2028-01-10' })
    expect(echeanceDeDeclaration('2028-02-29', 'redevable')).toMatchObject({ periodeDebut: '2028-02-01', periodeFin: '2028-02-29', date: '2028-03-10' })
    expect(echeanceDeDeclaration('2027-01-01', 'redevable')?.libelle).toBe('Paiements de janvier 2027 : à déclarer au plus tard le 10/02/2027.')
    expect(echeanceDeDeclaration('2027-04-30', 'redevable')?.libelle).toMatch(/^Paiements d’avril 2027 /)
    expect(echeanceDeDeclaration('2027-08-01', 'redevable')?.libelle).toMatch(/^Paiements d’août 2027 /)
  })

  it('en franchise : le bimestre civil, à déclarer le 25 du mois qui le suit', () => {
    expect(echeanceDeDeclaration('2027-10-15', 'franchise')).toEqual({
      frequence: 'bimestrielle', periodeDebut: '2027-09-01', periodeFin: '2027-10-31', date: '2027-11-25',
      libelle: 'Paiements de septembre et octobre 2027 : à déclarer au plus tard le 25/11/2027 '
        + '(du 25 à la fin du mois selon l’entreprise ; l’application retient le 25).',
    })
    expect(echeanceDeDeclaration('2027-09-01', 'franchise')).toMatchObject({ periodeDebut: '2027-09-01', date: '2027-11-25' })
    expect(echeanceDeDeclaration('2027-11-30', 'franchise')).toMatchObject({
      periodeDebut: '2027-11-01', periodeFin: '2027-12-31', date: '2028-01-25',
    })
    expect(echeanceDeDeclaration('2028-01-31', 'franchise')).toMatchObject({ periodeDebut: '2028-01-01', periodeFin: '2028-02-29', date: '2028-03-25' })
    expect(echeanceDeDeclaration('2027-02-28', 'franchise')?.libelle).toMatch(/^Paiements de janvier et février 2027 /)
  })

  it('chaque mois d’une année, dans les deux régimes', () => {
    for (let mois = 1; mois <= 12; mois++) {
      const date = `2027-${String(mois).padStart(2, '0')}-17`
      const reel = echeanceDeDeclaration(date, 'redevable') as EcheanceDeclaration
      expect(reel.periodeDebut <= date && date <= reel.periodeFin, date).toBe(true)
      expect(reel.date).toBe(mois === 12 ? '2028-01-10' : `2027-${String(mois + 1).padStart(2, '0')}-10`)
      const fr = echeanceDeDeclaration(date, 'franchise') as EcheanceDeclaration
      const premier = mois % 2 === 1 ? mois : mois - 1
      expect(fr.periodeDebut).toBe(`2027-${String(premier).padStart(2, '0')}-01`)
      expect(fr.date).toBe(premier === 11 ? '2028-01-25' : `2027-${String(premier + 2).padStart(2, '0')}-25`)
      expect(fr.periodeDebut <= date && date <= fr.periodeFin, date).toBe(true)
    }
  })

  it('rien pour un dossier exonéré, au statut à préciser, ou une date qui n’en est pas une', () => {
    expect(echeanceDeDeclaration('2027-10-15', 'exonere')).toBeNull()
    expect(echeanceDeDeclaration('2027-10-15', null)).toBeNull()
    for (const date of ['', '2027-02-30', '2027-13-01', '15/10/2027']) {
      expect(echeanceDeDeclaration(date, 'redevable'), date).toBeNull()
      expect(echeanceDeDeclaration(date, 'franchise'), date).toBeNull()
    }
  })

  // Le test choisit ses fuseaux : sous Europe/Paris seul, une échéance calculée par `new Date` passerait.
  it('rend la même échéance sous les quatre fuseaux de test:fuseaux', () => {
    process.env.TZ = 'America/New_York'
    expect(new Date('2027-01-01').getDate()).toBe(31)
    const reference: (ReturnType<typeof echeanceDeDeclaration>)[] = []
    const dates = ['2027-01-01', '2027-02-28', '2027-03-31', '2027-10-31', '2027-12-01', '2027-12-31', '2028-02-29']
    for (const fuseau of ['Europe/Paris', 'UTC', 'America/New_York', 'Pacific/Auckland']) {
      process.env.TZ = fuseau
      const rendus = dates.flatMap((d) => [echeanceDeDeclaration(d, 'redevable'), echeanceDeDeclaration(d, 'franchise')])
      if (reference.length === 0) reference.push(...rendus)
      else expect(rendus, fuseau).toEqual(reference)
    }
    expect(reference.map((e) => e?.date)).toEqual([
      '2027-02-10', '2027-03-25', '2027-03-10', '2027-03-25', '2027-04-10', '2027-05-25', '2027-11-10', '2027-11-25',
      '2028-01-10', '2028-01-25', '2028-01-10', '2028-01-25', '2028-03-10', '2028-03-25',
    ])
  })
})

// ── La pièce jumelle et les propositions ──────────────────────────────────────────────────────────────────────────

describe('piecesJumelles — la même vente, entrée aussi comme pièce', () => {
  const T = { facture_id: 'f1', canal: 'plateforme' as const, etat: 'accepte' as const, hote: 'pa.exemple.fr', flux_id: 'flux-9' }
  const piece = (o: Partial<PieceLue>): PieceLue => ({
    id: 'p', dossier_id: D, flux_hote: null, flux_id: null, superpdp_invoice_id: null,
    identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null, ...o,
  })

  it('par le flux qui a transmis la facture, ou par l’identifiant de Super PDP', () => {
    const pieces = [
      piece({ id: 'flux', flux_hote: 'pa.exemple.fr', flux_id: 'flux-9' }),
      piece({ id: 'autre-flux', flux_hote: 'pa.exemple.fr', flux_id: 'flux-8' }),
      piece({ id: 'autre-hote', flux_hote: 'pa.ailleurs.fr', flux_id: 'flux-9' }),
      piece({ id: 'spdp', superpdp_invoice_id: 4242 }),
      piece({ id: 'autre-spdp', superpdp_invoice_id: 4243 }),
      piece({ id: 'autre-dossier', dossier_id: 'd2', flux_hote: 'pa.exemple.fr', flux_id: 'flux-9', superpdp_invoice_id: 4242 }),
      piece({ id: 'nue' }),
    ]
    expect(piecesJumelles(contexte({ transmissions: [T] }), pieces).map((p) => p.id)).toEqual(['flux'])
    expect(piecesJumelles(contexte({ facture: facture({ superpdp_invoice_id: 4242 }) }), pieces).map((p) => p.id)).toEqual(['spdp'])
    expect(piecesJumelles(contexte({ facture: facture({ superpdp_invoice_id: 4242 }), transmissions: [T] }), pieces).map((p) => p.id))
      .toEqual(['flux', 'spdp'])
  })

  it('jamais par deux identifiants absents, ni par la transmission d’une autre facture', () => {
    const nue = piece({ id: 'nue' })
    expect(piecesJumelles(contexte({ transmissions: [{ ...T, flux_id: null }] }), [nue, piece({ id: 'h', flux_hote: 'pa.exemple.fr' })])).toEqual([])
    expect(piecesJumelles(contexte(), [nue])).toEqual([])
    expect(piecesJumelles(contexte({ transmissions: [{ ...T, facture_id: 'f2' }] }), [piece({ id: 'flux', flux_hote: 'pa.exemple.fr', flux_id: 'flux-9' })]))
      .toEqual([])
  })

  // Ce que le pont de la ligne 28.6 apporte aux propositions (lib/ventesJumelles.ts, qui en porte les cas un par un).
  const IDENTITE = {
    identite_numero: 'F2027-0042', identite_siren_vendeur: '123456782', identite_date: '2027-10-01', identite_nature: 'facture' as const,
  }

  it('par l’identifiant que la transmission Super PDP a gardé, quand l’écriture sur la facture a échoué', () => {
    const spdp = { facture_id: 'f1', canal: 'superpdp' as const, etat: 'depose' as const, hote: 'api.superpdp.tech', flux_id: '4242' }
    expect(piecesJumelles(contexte({ transmissions: [spdp] }), [piece({ id: 'spdp', superpdp_invoice_id: 4242 })]).map((p) => p.id))
      .toEqual(['spdp'])
  })

  it('par l’identité que son original dit : le numéro, le SIREN figé, l’année — une autre année est une autre facture', () => {
    expect(piecesJumelles(contexte(), [piece({ id: 'recue', ...IDENTITE })]).map((p) => p.id)).toEqual(['recue'])
    expect(piecesJumelles(contexte(), [piece({ id: 'recue', ...IDENTITE, identite_date: '2026-10-01' })])).toEqual([])
    expect(piecesJumelles(contexte(), [piece({ id: 'recue', ...IDENTITE, identite_siren_vendeur: '987654321' })])).toEqual([])
  })

  it('une pièce dont l’identité contredit la facture n’est la jumelle de rien, même portée par son flux', () => {
    const contraire = piece({ id: 'x', ...IDENTITE, identite_nature: 'avoir', flux_hote: 'pa.exemple.fr', flux_id: 'flux-9' })
    expect(piecesJumelles(contexte({ transmissions: [T] }), [contraire])).toEqual([])
  })
})

describe('propositionsEncaissement — la pièce jumelle, puis le relevé ; rien ne s’écrit seul', () => {
  const T = { facture_id: 'f1', canal: 'plateforme' as const, etat: 'accepte' as const, hote: 'pa.exemple.fr', flux_id: 'flux-9' }
  const JUMELLE: PieceLue = {
    id: 'pj', dossier_id: D, flux_hote: 'pa.exemple.fr', flux_id: 'flux-9', superpdp_invoice_id: null,
    identite_numero: null, identite_siren_vendeur: null, identite_date: null, identite_nature: null,
  }
  const RESTES = [{ taux: 20, centimes: 120000 }, { taux: 5.5, centimes: 10550 }, { taux: 0, centimes: 5000 }]
  const ligne = (o: Partial<LignePayante>): LignePayante => ({
    id: 'm1', piece_id: 'pj', date: '2027-10-15', montant: 1355.5, statut: 'rapprochee', reglement_groupe: false, ...o,
  })
  const proposer = (
    mouvements: MouvementPropose[], lignes: LignePayante[], o: Partial<ContexteFacture> = {}, reglements: PartReglee[] = [],
  ) => propositionsEncaissement(contexte({ transmissions: [T], ...o }), [JUMELLE], paiementsDesPieces(lignes, reglements), mouvements, AUJOURD_HUI)

  it('la jumelle reconnue par son identité seule propose son paiement comme jumelle, pas comme un crédit du relevé', () => {
    const parIdentite: PieceLue = {
      ...JUMELLE, flux_hote: null, flux_id: null,
      identite_numero: 'F2027-0042', identite_siren_vendeur: '123456782', identite_date: '2027-10-01', identite_nature: 'facture',
    }
    const p = propositionsEncaissement(contexte(), [parIdentite], paiementsDesPieces([ligne({})], []), [mouvement()], AUJOURD_HUI)
    expect(p.map((x) => [x.source, x.ligneBancaireId, x.piecesPayees])).toEqual([['jumelle', 'm1', ['pj']]])
  })

  it('le paiement de la pièce jumelle qui solde la facture : le reste de chaque taux', () => {
    const p = proposer([mouvement()], [ligne({})])
    expect(p).toEqual([{
      source: 'jumelle', ligneBancaireId: 'm1', date: '2027-10-15', montantCentimes: 135550, repartition: RESTES,
      creditCentimes: 135550, ecartCentimes: 0, solde: true, avantLaFacture: false, clientCite: false, piecesPayees: ['pj'],
      explication: 'Le crédit fait exactement ce qui reste à encaisser.',
    }])
  })

  it('la banque a crédité un peu moins, sous le seuil des frais : le reste entier, et l’écart dit', () => {
    const [p] = proposer([mouvement({ montant: 1350.5 })], [ligne({ montant: 1350.5 })])
    expect(p).toMatchObject({ montantCentimes: 135550, creditCentimes: 135050, ecartCentimes: -500, solde: true, repartition: RESTES })
    expect(p.explication).toBe(`La banque a crédité ${formatMoney(1350.5)} pour ${formatMoney(1355.5)} restant à encaisser : `
      + `${formatMoney(5)} d’écart, sous le seuil des frais bancaires (2 % du montant, 5 € au plus). `
      + 'La facture s’encaisse en entier, comme la déclaration de TVA de l’application la compte.')
  })

  it('au-delà du seuil, un paiement partiel, réparti au prorata des restes', () => {
    const [p] = proposer([mouvement({ montant: 1350.49 })], [ligne({ montant: 1350.49 })])
    expect(p).toMatchObject({ montantCentimes: 135049, creditCentimes: 135049, ecartCentimes: 0, solde: false })
    expect(p.repartition.reduce((s, x) => s + x.centimes, 0)).toBe(135049)
    expect(p.explication).toBe(`Paiement partiel : ${formatMoney(1350.49)} sur ${formatMoney(1355.5)} restant à encaisser.`)
    const [acompte] = proposer([mouvement({ montant: 500 })], [ligne({ montant: 500 })])
    expect(acompte.repartition).toEqual([{ taux: 20, centimes: 44264 }, { taux: 5.5, centimes: 3892 }, { taux: 0, centimes: 1844 }])
  })

  it('la banque a crédité plus que le reste : le reste seul', () => {
    const [p] = proposer([mouvement({ montant: 1400 })], [ligne({ montant: 1400 })])
    expect(p).toMatchObject({ montantCentimes: 135550, creditCentimes: 140000, ecartCentimes: 4450, solde: true })
    expect(p.explication).toBe(`La banque a crédité ${formatMoney(1400)} pour ${formatMoney(1355.5)} restant à encaisser : seul ce reste s’encaisse.`)
  })

  it('la part d’un règlement groupé : ce que le mouvement paie de la pièce, jugé sur le mouvement entier', () => {
    const groupe = ligne({ id: 'mg', piece_id: null, montant: 2000, reglement_groupe: true })
    const [p] = proposer([mouvement({ id: 'mg', montant: 2000 })], [groupe], {}, [
      { ligne_bancaire_id: 'mg', piece_id: 'pj', montant: 1355.5 }, { ligne_bancaire_id: 'mg', piece_id: 'autre', montant: 644.5 },
    ])
    expect(p).toMatchObject({ source: 'jumelle', ligneBancaireId: 'mg', montantCentimes: 135550, creditCentimes: 135550 })
    expect(p.piecesPayees).toEqual(['autre', 'pj'])
  })

  it('un crédit du relevé qui paie déjà une autre pièce se propose, et le dit', () => {
    // Le PDF de la même vente déposé à la main, rapproché de son virement : rien ne le relie à la facture émise.
    const p = propositionsEncaissement(contexte(), [], paiementsDesPieces([ligne({ id: 'r', piece_id: 'pdf' })], []),
      [mouvement({ id: 'r' })], AUJOURD_HUI)
    expect(p).toMatchObject([{ source: 'releve', ligneBancaireId: 'r', piecesPayees: ['pdf'] }])
    expect(propositionsEncaissement(contexte(), [], new Map(), [mouvement({ id: 'r' })], AUJOURD_HUI)[0].piecesPayees).toEqual([])
  })

  it('un remboursement, un paiement déjà enregistré ou un mouvement non lu ne se proposent pas', () => {
    expect(proposer([mouvement({ montant: -100 })], [ligne({ montant: -100 })])).toEqual([])
    const deja = encaissement({ ligne_bancaire_id: 'm1', montant: 100 })
    expect(proposer([mouvement()], [ligne({})], { encaissements: [deja] })).toEqual([])
    expect(proposer([], [ligne({})])).toEqual([])
    // Un mouvement d'un autre dossier : la base le refuserait.
    expect(proposer([mouvement({ dossier_id: 'd2' })], [ligne({})])).toEqual([])
  })

  it('un paiement daté avant la facture : un acompte, signalé', () => {
    const [p] = proposer([mouvement({ date: '2027-09-20', montant: 500 })], [ligne({ date: '2027-09-20', montant: 500 })])
    expect(p.avantLaFacture).toBe(true)
    expect(p.explication).toBe(`Paiement partiel : ${formatMoney(500)} sur ${formatMoney(1355.5)} restant à encaisser. `
      + 'Payé avant la date de la facture : un acompte, dont l’échéance de déclaration court depuis le paiement.')
  })

  it('les crédits du relevé qui font le reste, à l’écart des frais près, dans les deux sens', () => {
    const p = (montant: number, o: Partial<MouvementPropose> = {}) =>
      propositionsEncaissement(contexte(), [], new Map(), [mouvement({ id: 'r', montant, ...o })], AUJOURD_HUI)
    expect(p(1355.5)).toMatchObject([{ source: 'releve', ligneBancaireId: 'r', montantCentimes: 135550, ecartCentimes: 0, solde: true }])
    expect(p(1350.5)).toMatchObject([{ montantCentimes: 135550, ecartCentimes: -500 }])
    expect(p(1360.5)).toMatchObject([{ montantCentimes: 135550, ecartCentimes: 500 }])
    expect(p(1350.49)).toEqual([])
    expect(p(1360.51)).toEqual([])
    expect(p(500)).toEqual([])
    // Le jour même de la facture, oui, et ce n'est pas un acompte ; la veille, non ; demain, la base le refuserait.
    expect(p(1355.5, { date: '2027-10-01' })).toMatchObject([{ avantLaFacture: false }])
    expect(p(1355.5, { date: '2027-09-30' })).toEqual([])
    expect(p(1355.5, { date: '2027-11-03' })).toEqual([])
    // Un débit, un mouvement d'un autre dossier.
    expect(p(-1355.5)).toEqual([])
    expect(p(1355.5, { dossier_id: 'd2' })).toEqual([])
  })

  it('le seuil se juge sur le reste : 2 % d’un petit reste, 5 € au plus', () => {
    const petite = contexte({
      facture: facture({ montant_ht: 100, montant_tva: 20, montant_ttc: 120 }),
      lignes: [{ facture_id: 'f1', ordre: 1, designation: 'a', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20 }],
    })
    const p = (montant: number) => propositionsEncaissement(petite, [], new Map(), [mouvement({ id: 'r', montant })], AUJOURD_HUI)
    expect(p(117.6)).toHaveLength(1)
    expect(p(117.59)).toEqual([])
    expect(p(122.4)).toHaveLength(1)
    expect(p(122.41)).toEqual([])
  })

  it('ce que le cabinet a classé comme autre chose qu’un paiement de client ne se propose pas', () => {
    const p = (o: Partial<MouvementPropose>) => propositionsEncaissement(contexte(), [], new Map(), [mouvement({ id: 'r', ...o })], AUJOURD_HUI)
    expect(p({})).toHaveLength(1)
    for (const o of [
      { prelevement_personnel: true }, { compte_bilan: '580000' }, { emprunt_id: 'em1' }, { declaration_tva_id: 'dt1' }, { cotisation_id: 'c1' },
    ]) expect(p(o), JSON.stringify(o)).toEqual([])
  })

  it('un crédit qui justifie déjà un encaissement vivant est pris ; retiré ou annulé, il est libre', () => {
    const p = (encaissements: EncaissementLu[]) =>
      propositionsEncaissement(contexte({ encaissements }), [], new Map(), [mouvement({ id: 'r' })], AUJOURD_HUI)
    // Cinq centimes pour une autre facture : sous le seuil des frais, la base accepterait encore le reste sur ce
    // virement — c'est bien parce qu'il est PRIS qu'il ne se propose pas.
    const autre = encaissement({ id: 'e8', facture_id: 'f2', ligne_bancaire_id: 'r', montant: 0.05 })
    expect(refusEnregistrement(contexte({ encaissements: [autre] }), saisie({
      ligneBancaireId: 'r', montant: 1355.5, repartition: [{ taux: 20, montant: 1200 }, { taux: 5.5, montant: 105.5 }, { taux: 0, montant: 50 }],
    }), [mouvement({ id: 'r' })], AUJOURD_HUI)).toBeNull()
    expect(p([autre])).toEqual([])
    expect(p([{ ...autre, retire_le: '2027-10-20T10:00:00Z' }])).toHaveLength(1)
    expect(p([autre, encaissement({ id: 'a8', facture_id: 'f2', montant: -0.05, annule_id: 'e8' })])).toHaveLength(1)
    expect(p([autre, encaissement({ id: 'a8', facture_id: 'f2', montant: -0.05, annule_id: 'e8', retire_le: '2027-10-21T10:00:00Z' })])).toEqual([])
  })

  it('un mouvement de la pièce jumelle ne se propose qu’une fois, comme paiement de la jumelle', () => {
    const p = proposer([mouvement()], [ligne({})])
    expect(p.map((x) => [x.source, x.ligneBancaireId])).toEqual([['jumelle', 'm1']])
  })

  it('un mouvement de la jumelle reste à elle : déjà enregistré ou remboursement, le relevé ne le repropose pas', () => {
    // Un virement groupé qui fait exactement le reste, où la jumelle n'a qu'une part négative.
    const groupe = ligne({ id: 'mg', piece_id: null, montant: 1355.5, reglement_groupe: true })
    expect(proposer([mouvement({ id: 'mg' })], [groupe], {}, [
      { ligne_bancaire_id: 'mg', piece_id: 'autre', montant: 1455.5 }, { ligne_bancaire_id: 'mg', piece_id: 'pj', montant: -100 },
    ])).toEqual([])
    // Sans la jumelle, le même crédit se propose depuis le relevé.
    expect(propositionsEncaissement(contexte({ transmissions: [T] }), [], paiementsDesPieces([groupe], []), [mouvement({ id: 'mg' })], AUJOURD_HUI))
      .toMatchObject([{ source: 'releve', ligneBancaireId: 'mg' }])
    // Déjà enregistré pour cette facture : ni comme paiement de la jumelle, ni depuis le relevé.
    expect(proposer([mouvement()], [ligne({})], { encaissements: [encaissement({ ligne_bancaire_id: 'm1', montant: 100 })] })).toEqual([])
  })

  it('le relevé : le plus petit écart d’abord, le client cité d’abord, puis par date', () => {
    const p = propositionsEncaissement(contexte(), [], new Map(), [
      mouvement({ id: 'r4', date: '2027-10-05', montant: 1352.5 }),
      mouvement({ id: 'r3', date: '2027-10-20', montant: 1355.5 }),
      mouvement({ id: 'r2', date: '2027-10-25', montant: 1355.5, libelle: 'VIR SEPA CLIENT FICTIF' }),
      mouvement({ id: 'r1', date: '2027-10-10', montant: 1355.5 }),
      mouvement({ id: 'r0', date: '2027-10-10', montant: 1355.5 }),
      mouvement({ id: 'r5', date: '2027-10-02', montant: 1358.5 }),
    ], AUJOURD_HUI)
    expect(p.map((x) => x.ligneBancaireId)).toEqual(['r2', 'r0', 'r1', 'r3', 'r5', 'r4'])
    expect(p.map((x) => x.clientCite)).toEqual([true, false, false, false, false, false])
    expect(p.map((x) => x.ecartCentimes)).toEqual([0, 0, 0, 0, 300, -300])
  })

  it('le client se lit aussi dans la ligne brute, quand le libellé est générique', () => {
    const [p] = propositionsEncaissement(contexte(), [], new Map(), [
      mouvement({ id: 'r', libelle: 'Mouvement bancaire', libelle_brut: '15/10/2027;VIR FICTIF;1355,50' }),
    ], AUJOURD_HUI)
    expect(p.clientCite).toBe(true)
  })

  it('rien quand la facture est soldée, rejetée, ou porte un taux que la base refuserait', () => {
    const soldee = contexte({ encaissements: [encaissement({ montant: 1355.5 })], parts: [part({ taux: 20, montant: 1200 }), part({ taux: 5.5, montant: 105.5 }), part({ taux: 0, montant: 50 })] })
    expect(propositionsEncaissement(soldee, [], new Map(), [mouvement({ id: 'r', montant: 1355.5 })], AUJOURD_HUI)).toEqual([])
    const rejetee = contexte({ transmissions: [{ ...T, etat: 'rejete' }] })
    expect(propositionsEncaissement(rejetee, [JUMELLE], paiementsDesPieces([ligne({})], []), [mouvement()], AUJOURD_HUI)).toEqual([])
    const f19 = contexte({
      facture: facture({ montant_ht: 100, montant_tva: 19, montant_ttc: 119 }),
      lignes: [{ facture_id: 'f1', ordre: 1, designation: 'a', quantite: 1, prix_unitaire_ht: 100, taux_tva: 19 }],
    })
    expect(propositionsEncaissement(f19, [], new Map(), [mouvement({ id: 'r', montant: 119 })], AUJOURD_HUI)).toEqual([])
  })

  it('chaque proposition est un encaissement que la base accepterait aujourd’hui', () => {
    const c = contexte({ transmissions: [T] })
    const mouvements = [
      mouvement(), mouvement({ id: 'r1', montant: 1352.5 }), mouvement({ id: 'r2', montant: 1360 }), mouvement({ id: 'm2', montant: 300 }),
    ]
    const props = propositionsEncaissement(c, [JUMELLE], paiementsDesPieces([ligne({}), ligne({ id: 'm2', montant: 300 })], []), mouvements, AUJOURD_HUI)
    // La jumelle d'abord, dans l'ordre de ses paiements ; puis le relevé.
    expect(props.map((p) => `${p.source}:${p.ligneBancaireId}`)).toEqual(['jumelle:m1', 'jumelle:m2', 'releve:r1', 'releve:r2'])
    for (const p of props) {
      expect(refusEnregistrement(c, {
        date: p.date, montant: p.montantCentimes / 100, moyen: 'cheque', ligneBancaireId: p.ligneBancaireId,
        repartition: p.repartition.map((x) => ({ taux: x.taux, montant: x.centimes / 100 })),
      }, mouvements, AUJOURD_HUI), p.ligneBancaireId).toBeNull()
    }
  })
})
