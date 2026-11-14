import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  REFUS_ENREGISTREMENT_AVEC_LA_PIECE_CITEE, REFUS_ENREGISTREMENT_DES_REPRISES, refusEnregistrementExportes,
  refusEnregistrementVente, resteAEncaisserDeLaReprise,
  type ContexteFacture, type ContexteVente, type FacturePourEncaissement, type LigneDeFacture, type RepriseDeLaFacture,
  type SaisieEncaissement,
} from './encaissementsFactures'
import {
  CLE_DU_RECU, DRAPEAU_DE_LA_PIECE_RECUE, REFUS_CITER_AVEC_LA_PIECE_RECUE, REFUS_ENCAISSEMENT_DE_LA_PIECE_CITEE,
  encaisseAvantLaRepriseCentimes, recuARepartirEntreLesTaux, recuParLaPieceCiteePrevu, refusDeCiterSelon,
  refusDeLaCitationPourLaPieceRecue,
} from './recuParLaPieceCitee'
import { REFUS_CITER } from './pieceDUneFactureReprise'
import { CLES_DE_LA_REPRISE, CLES_DE_LA_REPRISE_AVEC_SA_PIECE, repriseDeLaFactureRendue } from './reprisesAuClient'
import { definitionsSql, derniereDefinitionSql, fichiersDuSchema } from '../test/schema'
import { messagesSql } from '../test/raiseSql'

// A8Q5Q3-Q2 : CE QUE LA PIÈCE CITÉE D'UNE FACTURE REPRISE A DÉJÀ REÇU, PLANCHER DE SON REGISTRE. Le module redit les refus de
// la migration `recu_par_la_piece_citee` (préparée, puis exportée le jour de son application), confrontés à son texte ; ses
// empreintes et celles de son retour se tiennent ; la lecture de la reprise et les plafonds sous les deux états du drapeau ;
// et l'essai attend les mots du module. Données FICTIVES.

// `FACTURES_IMPORTEES_PREVUES` est levé en production : le jugement d'une facture reprise s'y joue.
vi.mock('./facturesImportees', () => ({ FACTURES_IMPORTEES_PREVUES: true }))

function leFichier(motif: RegExp, dossiers: readonly string[]): string {
  const trouves: string[] = []
  for (const dossier of dossiers) {
    const chemin = new URL(dossier, import.meta.url).pathname
    if (!existsSync(chemin)) continue
    for (const nom of readdirSync(chemin)) if (motif.test(nom)) trouves.push(chemin + nom)
  }
  expect(trouves, String(motif)).toHaveLength(1)
  return readFileSync(trouves[0], 'utf8')
}

const MIGRATION = leFichier(/^\d{14}_recu_par_la_piece_citee\.sql$/, ['../../supabase/preparees/', '../../supabase/schema/'])
const RETOUR = leFichier(/^\d{14}_retour_recu_par_la_piece_citee\.sql$/, ['../../supabase/preparees/retour/'])
const ESSAI = readFileSync(new URL('../../supabase/essais/recuParLaPieceCitee.sql', import.meta.url), 'utf8')
const EXPORTEE = fichiersDuSchema().some((f) => /\d{14}_recu_par_la_piece_citee\.sql$/.test(f.chemin))
const md5 = (texte: string) => createHash('md5').update(texte, 'utf8').digest('hex')
const sansApostrophes = (s: string) => s.replace(/’/g, "'")

/** La définition d'une fonction dans un texte : de son `create` au délimiteur fermant, exclu. */
function fonction(texte: string, nom: string): string {
  const definitions = definitionsSql(nom, [{ chemin: 'migration', texte }])
  expect(definitions, nom).toHaveLength(1)
  return definitions[0].definition
}
const corps = (definition: string) => definition.slice(definition.indexOf('as $$') + 'as $$'.length)
const codesSql = (sql: string) =>
  [...sql.matchAll(/raise exception '(?:[^']|'')*'[\s\S]*?using errcode = '([0-9A-Z]{5})'/g)].map((m) => m[1])

afterEach(() => {
  DRAPEAU_DE_LA_PIECE_RECUE.RECU_PAR_LA_PIECE_CITEE_PREVU = false
})

describe('A8Q5Q3-Q2 — la migration, son retour et le module', () => {
  it('enregistrer_encaissement : les refus d’A8b, et le refus neuf juste avant le plafond d’une reprise', () => {
    const sql = fonction(MIGRATION, 'enregistrer_encaissement')
    expect(messagesSql(sql)).toEqual(REFUS_ENREGISTREMENT_AVEC_LA_PIECE_CITEE.map((r) => r.modele))
    expect(REFUS_ENREGISTREMENT_AVEC_LA_PIECE_CITEE).toHaveLength(REFUS_ENREGISTREMENT_DES_REPRISES.length + 1)
    const rang = REFUS_ENREGISTREMENT_AVEC_LA_PIECE_CITEE.findIndex((r) => r.cle === 'reprise_piece_plusieurs_taux')
    expect(REFUS_ENREGISTREMENT_AVEC_LA_PIECE_CITEE[rang - 1].cle).toBe('repartition_somme')
    expect(REFUS_ENREGISTREMENT_AVEC_LA_PIECE_CITEE[rang + 1].cle).toBe('plafond_reprise')
    expect(codesSql(sql)[rang]).toBe('22023')
    // Celle d'hier — la dernière de l'export tant que la migration n'y est pas — porte les refus d'A8b, sans le neuf.
    if (!EXPORTEE) expect(messagesSql(derniereDefinitionSql('enregistrer_encaissement'))).toEqual(REFUS_ENREGISTREMENT_DES_REPRISES.map((r) => r.modele))
  })

  it('le plancher : le plus grand du déclaré et du reçu au total ; à plusieurs taux, le refus ; le taux garde le déclaré', () => {
    const sql = fonction(MIGRATION, 'enregistrer_encaissement')
    expect(sql).toContain('select coalesce(sum(public.recu_par_la_piece(r.piece_id)), 0) into v_recu\n'
      + '      from public.pieces_des_factures_reprises r where r.facture_id = p_facture_id and r.retire_le is null;')
    expect(sql).toContain('    if v_recu > v_avant * 100 then\n      if not v_un_seul_taux then')
    expect(sql).toContain('      v_avant := v_recu / 100.0;\n    end if;\n    v_plafond := ')
    expect(sql).not.toContain('greatest(v_avant_taux')
  })

  it('citer_piece_de_facture_reprise : ses refus d’hier, puis les deux neufs, au code 23514 ; la facture verrouillée', () => {
    const sql = fonction(MIGRATION, 'citer_piece_de_facture_reprise')
    expect(messagesSql(sql)).toEqual(REFUS_CITER_AVEC_LA_PIECE_RECUE.map((r) => r.modele))
    expect(codesSql(sql)).toEqual(REFUS_CITER_AVEC_LA_PIECE_RECUE.map((r) => r.code))
    expect(sql).toContain('perform 1 from public.factures_emises f where f.id = p_facture_id for no key update;')
    expect(refusDeCiterSelon(false)).toBe(REFUS_CITER)
    expect(refusDeCiterSelon(true)).toBe(REFUS_CITER_AVEC_LA_PIECE_RECUE)
  })

  it('reprise_de_la_facture : les sept clés que la lecture attend, le drapeau levé', () => {
    const construites = [...fonction(MIGRATION, 'reprise_de_la_facture').matchAll(/^\s+'([a-z_]+)', /gm)].map((m) => m[1]).sort()
    expect(construites).toEqual([...CLES_DE_LA_REPRISE_AVEC_SA_PIECE])
    expect(CLES_DE_LA_REPRISE_AVEC_SA_PIECE).toEqual([...CLES_DE_LA_REPRISE, CLE_DU_RECU].sort())
  })

  it('recu_par_la_piece : les trois sources de paiement de la 2035, exécutable par aucun rôle de session', () => {
    const sql = fonction(MIGRATION, 'recu_par_la_piece')
    expect(sql).toContain("where l.piece_id = p_piece_id and l.statut = 'rapprochee'")
    expect(sql).toContain("where g.piece_id = p_piece_id and l.statut = 'rapprochee' and l.reglement_groupe")
    expect(sql).toContain("where o.piece_id = p_piece_id and o.genre = 'paiement' and o.retire_le is null")
    expect(MIGRATION).toContain('revoke all on function public.recu_par_la_piece(uuid) from public, anon, authenticated;')
  })

  it('la garde de fin, le retour et les empreintes se tiennent ; le retour rend les corps de la production', () => {
    const nouveaux = ['citer_piece_de_facture_reprise', 'enregistrer_encaissement', 'reprise_de_la_facture']
      .map((nom) => `${nom}=${md5(corps(fonction(MIGRATION, nom)))}`)
    const attendu = nouveaux.join(',')
    const garde = (texte: string, bloc: string) => {
      const debut = texte.indexOf(`do $${bloc}$`)
      return [...texte.slice(debut, texte.indexOf(`$${bloc}$;`, debut)).matchAll(/'(\w+)=([0-9a-f]{32})/g)].map((m) => `${m[1]}=${m[2]}`).join(',')
    }
    expect(garde(MIGRATION, 'fin')).toBe(attendu)
    expect(garde(RETOUR, 'garde')).toBe(attendu)
    const production = ['citer_piece_de_facture_reprise', 'enregistrer_encaissement', 'reprise_de_la_facture']
      .map((nom) => `${nom}=${md5(corps(derniereDefinitionSql(nom, (f) => !/recu_par_la_piece_citee/.test(f.chemin))))}`)
      .join(',')
    expect(garde(MIGRATION, 'garde')).toBe(production)
    expect(garde(RETOUR, 'fin')).toBe(production)
    expect(MIGRATION).not.toMatch(/\b(drop|truncate)\b|delete from/i)
    expect(RETOUR.split('\n').filter((l) => /^drop /.test(l))).toEqual(['drop function public.recu_par_la_piece(uuid);'])
  })

  it('le drapeau suit l’export : levé le jour où la migration y entre', () => {
    expect(recuParLaPieceCiteePrevu()).toBe(EXPORTEE)
  })

  it('l’essai attend les mots du module', () => {
    expect(ESSAI).toContain(`plusieurs_taux constant text := '${REFUS_ENCAISSEMENT_DE_LA_PIECE_CITEE[0].modele.replace('%', 'R-Q2-1').replace(/'/g, "''")}';`)
    expect(ESSAI).toContain(sansApostrophes(refusDeLaCitationPourLaPieceRecue({
      nomFichier: 'essai-q2-p.pdf', numero: 'R-Q2-1', recuCentimes: 5000, declareCentimes: 0, dejaCentimes: 10000, netCentimes: 12000,
      nombreDeTaux: 1,
    })?.message ?? '—').replace(/'/g, "''"))
    expect(ESSAI).toContain(sansApostrophes(refusDeLaCitationPourLaPieceRecue({
      nomFichier: 'essai-q2-p.pdf', numero: 'R-Q2-1', recuCentimes: 3000, declareCentimes: 0, dejaCentimes: 1000, netCentimes: 23000,
      nombreDeTaux: 2,
    })?.message ?? '—').replace(/'/g, "''"))
  })
})

describe('A8Q5Q3-Q2 — la lecture de la reprise, sous les deux états du drapeau', () => {
  const SIX = {
    reprise_le: '2026-11-01', nature_operation: 'services', encaisse_avant_reprise_centimes: 0,
    encaisse_par_taux: [{ taux: 20, encaisse_centimes: 0 }], credite_par_les_repris_centimes: 0, credite_par_les_repris_par_taux: [],
  }
  it('baissé : six clés, le reçu absent ; sept clés illisibles', () => {
    expect(repriseDeLaFactureRendue(SIX, 'r1')).not.toHaveProperty('recuParSaPieceCentimes')
    expect(repriseDeLaFactureRendue(SIX, 'r1')?.factureId).toBe('r1')
    expect(repriseDeLaFactureRendue({ ...SIX, recu_par_sa_piece_centimes: 5000 }, 'r1')).toBeNull()
  })
  it('levé : sept clés, le reçu lu ; six illisibles, un reçu négatif ou fractionnaire aussi', () => {
    DRAPEAU_DE_LA_PIECE_RECUE.RECU_PAR_LA_PIECE_CITEE_PREVU = true
    expect(repriseDeLaFactureRendue({ ...SIX, recu_par_sa_piece_centimes: 5000 }, 'r1')?.recuParSaPieceCentimes).toBe(5000)
    expect(repriseDeLaFactureRendue({ ...SIX, recu_par_sa_piece_centimes: 0 }, 'r1')?.recuParSaPieceCentimes).toBe(0)
    expect(repriseDeLaFactureRendue(SIX, 'r1')).toBeNull()
    expect(repriseDeLaFactureRendue({ ...SIX, recu_par_sa_piece_centimes: -1 }, 'r1')).toBeNull()
    expect(repriseDeLaFactureRendue({ ...SIX, recu_par_sa_piece_centimes: 12.5 }, 'r1')).toBeNull()
    expect(repriseDeLaFactureRendue({ ...SIX, recu_par_sa_piece_centimes: null }, 'r1')).toBeNull()
  })
})

// Les plafonds, comme la base les juge : R-Q2-1 à un taux (100 € HT à 20 %, 120 € TTC) ou à deux (100 € à 20 %, 100 € à
// 10 %, 230 € TTC), reprise le 01/11/2026 ; les chiffres de l'essai.
const D = 'd1'
const AUJOURD_HUI = '2026-11-13'
const VENTE: ContexteVente = { anneesValidees: [], factures: [] }
const UN_TAUX: LigneDeFacture[] = [{ facture_id: 'r1', ordre: 1, designation: 'Prestation', quantite: 1, prix_unitaire_ht: 100, taux_tva: 20 }]
const DEUX_TAUX: LigneDeFacture[] = [...UN_TAUX, { facture_id: 'r1', ordre: 2, designation: 'Prestation B', quantite: 1, prix_unitaire_ht: 100, taux_tva: 10 }]

function facture(deux: boolean): FacturePourEncaissement {
  return {
    id: 'r1', dossier_id: D, statut: 'importee' as FacturePourEncaissement['statut'], type: 'facture', numero: 'R-Q2-1',
    date_emission: '2025-11-20', emetteur_siret: null, montant_ht: deux ? 200 : 100, montant_tva: deux ? 30 : 20,
    montant_ttc: deux ? 230 : 120, superpdp_invoice_id: null, tiers_nom: 'Client Q2', source_de_la_vente: true,
  } as FacturePourEncaissement
}

function reprise(deux: boolean, declare: number, recu: number | undefined, parTaux?: { taux: number; encaisseCentimes: number }[]): RepriseDeLaFacture {
  return {
    factureId: 'r1', repriseLe: '2026-11-01', natureOperation: 'services', encaisseAvantRepriseCentimes: declare,
    encaisseParTaux: parTaux ?? (deux ? [{ taux: 20, encaisseCentimes: declare }, { taux: 10, encaisseCentimes: 0 }] : [{ taux: 20, encaisseCentimes: declare }]),
    crediteParLesReprisCentimes: 0, crediteParLesReprisParTaux: [],
    ...(recu === undefined ? {} : { recuParSaPieceCentimes: recu }),
  }
}

function contexte(deux: boolean, r: RepriseDeLaFacture): ContexteFacture {
  return {
    dossierId: D, facture: facture(deux), lignes: deux ? DEUX_TAUX : UN_TAUX, transmissions: [], evenementsSuperpdp: [],
    statutsRecus: [], encaissements: [], parts: [], reprise: r,
  }
}

const saisie = (montant: number, taux = 20): SaisieEncaissement =>
  ({ date: '2026-11-01', montant, moyen: 'virement', ligneBancaireId: null, repartition: [{ taux, montant }] })
const juger = (c: ContexteFacture, s: SaisieEncaissement) => refusEnregistrementVente(c, s, [], AUJOURD_HUI, true, VENTE)

describe('A8Q5Q3-Q2 — les plafonds jugés avant le clic, comme la base', () => {
  beforeEach(() => {
    DRAPEAU_DE_LA_PIECE_RECUE.RECU_PAR_LA_PIECE_CITEE_PREVU = false
  })

  it('les refus en vigueur suivent le drapeau', () => {
    expect(refusEnregistrementExportes()).toBe(REFUS_ENREGISTREMENT_DES_REPRISES)
    DRAPEAU_DE_LA_PIECE_RECUE.RECU_PAR_LA_PIECE_CITEE_PREVU = true
    expect(refusEnregistrementExportes()).toBe(REFUS_ENREGISTREMENT_AVEC_LA_PIECE_CITEE)
  })

  it('sans le reçu (la base d’aujourd’hui) : le déclaré seul — 120 s’encaissent, la même vente deux fois', () => {
    expect(juger(contexte(false, reprise(false, 0, undefined)), saisie(120))).toBeNull()
    expect(resteAEncaisserDeLaReprise(contexte(false, reprise(false, 0, undefined)), VENTE, reprise(false, 0, undefined)).resteCentimes).toBe(12000)
  })

  it('un taux, la pièce a reçu 120 : il reste 0,00 € ; 50 reçus : 70 s’encaissent, 71 non', () => {
    expect(juger(contexte(false, reprise(false, 0, 12000)), saisie(120))?.message).toContain('il reste 0,00 € à encaisser.')
    expect(juger(contexte(false, reprise(false, 0, 5000)), saisie(70))).toBeNull()
    expect(juger(contexte(false, reprise(false, 0, 5000)), saisie(71))?.message).toContain('il reste 70,00 € à encaisser.')
    expect(resteAEncaisserDeLaReprise(contexte(false, reprise(false, 0, 5000)), VENTE, reprise(false, 0, 5000)).resteCentimes).toBe(7000)
  })

  it('le déclaré plus grand que le reçu l’emporte : il reste 40,00 €', () => {
    expect(juger(contexte(false, reprise(false, 8000, 5000)), saisie(41))?.message).toContain('il reste 40,00 € à encaisser.')
    expect(encaisseAvantLaRepriseCentimes(reprise(false, 8000, 5000))).toBe(8000)
    expect(encaisseAvantLaRepriseCentimes(reprise(false, 8000, undefined))).toBe(8000)
    expect(encaisseAvantLaRepriseCentimes(reprise(false, 0, 5000))).toBe(5000)
  })

  it('deux taux, la pièce a reçu plus que le déclaré : le refus neuf, juste avant le plafond, sans nom ni montant', () => {
    const r = juger(contexte(true, reprise(true, 0, 3000)), saisie(10))
    expect(r?.cle).toBe('reprise_piece_plusieurs_taux')
    expect(r?.message).toBe(REFUS_ENCAISSEMENT_DE_LA_PIECE_CITEE[0].modele.replace('%', 'R-Q2-1'))
    // Une répartition qui ne fait pas le montant se dit d'abord (son rang précède).
    expect(juger(contexte(true, reprise(true, 0, 3000)), { ...saisie(10), repartition: [{ taux: 20, montant: 9 }] })?.cle).toBe('repartition_somme')
    expect(recuARepartirEntreLesTaux(reprise(true, 0, 3000), 2)).toBe(true)
    expect(recuARepartirEntreLesTaux(reprise(true, 3000, 3000), 2)).toBe(false)
    expect(recuARepartirEntreLesTaux(reprise(false, 0, 3000), 1)).toBe(false)
  })

  it('deux taux, le déclaré couvre le reçu : chaque taux garde son déclaré — 100 s’encaissent à 10 %, 101 non', () => {
    const r = reprise(true, 10000, 3000, [{ taux: 20, encaisseCentimes: 9000 }, { taux: 10, encaisseCentimes: 1000 }])
    expect(juger(contexte(true, r), saisie(100, 10))).toBeNull()
    expect(juger(contexte(true, r), saisie(101, 10))?.message)
      .toBe("À 10 %, l'encaissement dépasserait ce que la facture reprise porte encore, nette de ses avoirs et de ce qui en était encaissé avant la reprise : il reste 100,00 € à encaisser à ce taux.")
  })
})

describe('A8Q5Q3-Q2 — la citation, jugée comme la base', () => {
  const base = { nomFichier: 'p.pdf', numero: 'R-1', declareCentimes: 0, netCentimes: 12000, nombreDeTaux: 1 }
  it('le registre vide, ou le déclaré qui couvre le reçu : rien', () => {
    expect(refusDeLaCitationPourLaPieceRecue({ ...base, recuCentimes: 5000, dejaCentimes: 0, nombreDeTaux: 2 })).toBeNull()
    expect(refusDeLaCitationPourLaPieceRecue({ ...base, recuCentimes: 5000, declareCentimes: 8000, dejaCentimes: 3000 })).toBeNull()
  })
  it('à un taux : juste ce qu’elle porte passe, un centime de plus non', () => {
    expect(refusDeLaCitationPourLaPieceRecue({ ...base, recuCentimes: 5000, dejaCentimes: 7000 })).toBeNull()
    expect(refusDeLaCitationPourLaPieceRecue({ ...base, recuCentimes: 5000, dejaCentimes: 7001 })?.cle).toBe('recue_deja_encaissee')
  })
  it('à plusieurs taux, un registre qui a des encaissements : refusée', () => {
    expect(refusDeLaCitationPourLaPieceRecue({ ...base, recuCentimes: 3000, dejaCentimes: 1000, nombreDeTaux: 2, netCentimes: 23000 })?.cle)
      .toBe('recue_plusieurs_taux')
  })
})
