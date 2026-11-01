import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { refusDeLaSaisie, type DossierDeLaCaisse, type EtatDeLaCaisse, type OperationDeLaCaisse, type SaisieDeCaisse } from './caisse'
import {
  contrepartieDuPaiement, jugerLeReglement, jugerLeReglementSelon, MOTS, MOTS_DU_PAIEMENT, ORDRE_DU_PAIEMENT,
  PAIEMENT_PAR_LA_CAISSE_EXPORTE, refusDeLaContrepartie, refusDuChangementDeLaPiece, refusDuMouvementAvantLOuverture,
  resteAuCentime, type PieceDuPaiement, type PieceGardee,
} from './paiementParLaCaisse'
import { PLAN_DECALE, PLAN_PAR_DEFAUT } from './planComptable'
import { commeLike, etapesDeLEssai } from '../test/essaiCaisse'
import { fichiersDuSchema, fichiersPrepares } from '../test/schema'

// LE PAIEMENT D'UNE PIÈCE PAR LA CAISSE, CONFRONTÉ À LA BASE (ligne 26.6, étape C8). Deux juges, comme pour lib/caisse.ts :
//   1. LE TEXTE DE LA MIGRATION `paiement_par_la_caisse`, où qu'elle soit (préparée aujourd'hui, dans l'export le jour de
//      son application) : les mots de chaque refus neuf et leur ordre sont RELUS dans le corps des fonctions ;
//   2. L'ESSAI (supabase/essais/caisse.sql, étapes 200 à 231), ce que la base a RÉPONDU sur la réplique : le banc de
//      lib/caisse.test.ts en rejoue les étapes par ce module ; ici, celles que ce banc ne rejoue pas (le registre des
//      encaissements de B8) se jugent cas par cas, leurs verdicts lus dans l'essai.

const ESSAI = readFileSync(new URL('../../supabase/essais/caisse.sql', import.meta.url), 'utf8')
const AUJOURDHUI = '2026-10-29'
const sansApostrophes = (s: string) => s.replace(/''/g, "'").replace(/’/g, "'")

const MIGRATIONS = [...fichiersDuSchema(), ...fichiersPrepares()]
  .sort((a, b) => (a.chemin.split('/').pop()! < b.chemin.split('/').pop()! ? -1 : 1))
const MIGRATION = MIGRATIONS.find((f) => /\d{14}_paiement_par_la_caisse\.sql$/.test(f.chemin))

/** La dernière définition d'une fonction, dans l'export et les migrations préparées, dans l'ordre de leurs versions. */
function definition(nom: string): string {
  const motif = new RegExp(`create (?:or replace )?function public\\.${nom}\\(`, 'g')
  const fichier = MIGRATIONS.filter((f) => new RegExp(motif.source).test(f.texte)).pop()
  if (!fichier) throw new Error(`${nom} introuvable`)
  const debut = [...fichier.texte.matchAll(motif)].pop()!.index
  return fichier.texte.slice(debut, fichier.texte.indexOf('\n$$;', debut))
}

/** Les `raise exception` d'un corps, dans l'ordre du texte : leur gabarit et leur code. */
function raises(corps: string): { gabarit: string; code: string }[] {
  return [...corps.matchAll(/raise exception '((?:[^']|'')*)'([^;]*);/g)].map((m) => ({
    gabarit: m[1].replace(/''/g, "'"),
    code: /using errcode = '(\w+)'/.exec(m[2])?.[1] ?? '',
  }))
}

const attendus = (cles: readonly (keyof typeof MOTS)[]) => cles.map((c) => `${MOTS[c].code} ${sansApostrophes(MOTS[c].gabarit)}`)
const lus = (r: { gabarit: string; code: string }[]) => r.map((x) => `${x.code} ${sansApostrophes(x.gabarit)}`)

describe('les mots et l’ordre des refus neufs, relus dans le texte de la migration', () => {
  it('la migration est là, préparée ou dans l’export, une fois', () => {
    expect(MIGRATION).toBeDefined()
    expect(MIGRATIONS.filter((f) => /_paiement_par_la_caisse\.sql$/.test(f.chemin))).toHaveLength(1)
  })

  it('le paiement d’une pièce : l’accès d’abord, puis chaque refus, son code et ses mots, dans l’ordre du texte', () => {
    const corps = definition('regler_piece_par_la_caisse')
    const acces = corps.search(/public\.qui_ecrit_la_caisse\(p_dossier_id\)/)
    expect(acces).toBeGreaterThan(0)
    expect(acces).toBeLessThan(corps.search(/raise exception/))
    expect(acces).toBeLessThan(corps.search(/\bfrom public\./))
    // La caisse négative, dont le texte vient de `texte_caisse_negative`, à part.
    expect(lus(raises(corps).filter((r) => r.gabarit !== '%'))).toEqual(attendus(ORDRE_DU_PAIEMENT.regler_piece_par_la_caisse))
    expect(corps).toContain("raise exception '%', public.texte_caisse_negative('paiement', p_montant, v_jour, v_solde) using errcode = '23514';")
  })

  it('la contrepartie : la voie neuve de la garde du brouillon, entre ses refus d’hier', () => {
    const tous = lus(raises(definition('garder_ecriture_de_caisse')))
    const neufs = attendus(ORDRE_DU_PAIEMENT.contrepartie)
    const debut = tous.indexOf(neufs[0])
    expect(debut).toBeGreaterThan(0)
    expect(tous.slice(debut, debut + neufs.length)).toEqual(neufs)
    // Avant elle, les deux refus d'hier d'une ligne qu'on supprime ou modifie — et, entre eux depuis la relecture du
    // 01/11/2026, la pièce supprimée sous la contrepartie de son paiement, sous ses mots et le code de la clé qui la retient ;
    // après, la porte d'hier et l'opération suivie.
    expect(tous.slice(0, debut).map((x) => x.slice(0, 6))).toEqual(['42501 ', '23503 ', '42501 '])
    expect(tous[1]).toBe(attendus(['piece_payee_supprimee'])[0])
    expect(tous.slice(debut + neufs.length)).toEqual([
      '42501 L\'écriture d\'une opération de caisse ne s\'écrit qu\'avec cette opération, par la fonction de la caisse.',
      neufs[0],
    ])
  })

  it('la pièce payée et le mouvement d’avant l’ouverture : chaque refus, dans l’ordre du texte', () => {
    expect(lus(raises(definition('garder_piece_payee_par_la_caisse')))).toEqual(attendus(ORDRE_DU_PAIEMENT.garder_piece_payee_par_la_caisse))
    expect(lus(raises(definition('garder_caisse_depuis_l_ouverture')))).toEqual(attendus(ORDRE_DU_PAIEMENT.garder_caisse_depuis_l_ouverture))
  })

  it('chaque mot neuf est dit une fois dans la migration, et nulle part ailleurs dans le schéma', () => {
    const ailleurs = MIGRATIONS.filter((f) => f !== MIGRATION).map((f) => sansApostrophes(f.texte)).join('\n')
    for (const [cle, { gabarit }] of Object.entries(MOTS_DU_PAIEMENT)) {
      // La contrepartie qui ne suit pas son paiement reprend les mots d'hier : la seule clé que la migration `caisse` dit aussi.
      if (cle === 'contrepartie_ne_suit_pas') continue
      // Le plus long morceau sans `%` : ce que le gabarit a de propre (son début peut être celui d'un refus d'hier).
      const propre = sansApostrophes(gabarit).split('%').reduce((a, b) => (b.length > a.length ? b : a))
      expect(sansApostrophes(MIGRATION!.texte).includes(propre), cle).toBe(true)
      expect(ailleurs.includes(propre), cle).toBe(false)
    }
  })
})

describe('le drapeau', () => {
  it('reste baissé tant que la migration n’est pas dans l’export', () => {
    expect(PAIEMENT_PAR_LA_CAISSE_EXPORTE).toBe(fichiersDuSchema().some((f) => /\d{14}_paiement_par_la_caisse\.sql$/.test(f.chemin)))
  })

  it('baissé, rien ne se règle ni ne se juge ; levé, le paiement se juge', () => {
    const saisie = { piece_id: 'qa', date: '2026-03-05', montant: -10 }
    expect(jugerLeReglementSelon(false, saisie, dossier(), [ACHAT], 'p')).toEqual({ etat: 'absent' })
    expect(jugerLeReglementSelon(true, saisie, dossier(), [ACHAT], 'p').etat).toBe('accepte')
    expect(jugerLeReglement(saisie, dossier(), [ACHAT], 'p').etat).toBe(PAIEMENT_PAR_LA_CAISSE_EXPORTE ? 'accepte' : 'absent')
  })
})

// ── Le module, cas par cas ───────────────────────────────────────────────────────────────────────────────────────────

const MODELE = { mode: 'tresorerie' as const, compteNotesDeFrais: '455000', plan: PLAN_PAR_DEFAUT }

function caisse(o: Partial<EtatDeLaCaisse> = {}): EtatDeLaCaisse {
  return { compteCaisse: MODELE.plan.caisse, ouvertures: [], operations: [], mouvements: [], encaissements: [], factures: [], ...o }
}

function operation(o: Partial<OperationDeLaCaisse>): OperationDeLaCaisse {
  return {
    id: 'o', genre: 'apport', date: '2026-03-01', montant: 500, retire_le: null, origine: 'cabinet', cree_par: 'chef',
    remplace_id: null, categorie_id: null, taux_tva: null, encaissements_du_jour: null, piece_id: null, ...o,
  }
}

function dossier(o: Partial<DossierDeLaCaisse> = {}): DossierDeLaCaisse {
  return {
    quiEcrit: 'cabinet', utilisateur: 'chef', modele: MODELE, assujetti: false, aujourdhui: AUJOURDHUI, ouverture: null,
    anneesValidees: [], categories: [{ id: 'k', dossier_id: 'd', libelle: 'Honoraires', compte_comptable: '706000' }],
    caisse: caisse({ operations: [operation({ id: 'apport' })] }), natureDesRecettesDuClient: null, ...o,
  }
}

function piece(o: Partial<PieceDuPaiement>): PieceDuPaiement {
  return { id: 'qa', type_piece: 'achat', statut: 'a_valider', montant_ttc: 100, devise: 'EUR', exemplaire: null, paiementsDuReleve: [], ...o }
}

const ACHAT = piece({})
const juger = (saisie: { piece_id: string | null; date: string | null; montant: number | null }, d = dossier(), pieces = [ACHAT]) => {
  const j = jugerLeReglementSelon(true, saisie, d, pieces, 'p')
  if (j.etat === 'absent') throw new Error('le drapeau levé ne rend jamais « absent »')
  return j.etat === 'refuse' ? j.refus : null
}

describe('jugerLeReglementSelon — le paiement d’une pièce par la caisse', () => {
  it('le paiement accepté : une opération de genre paiement qui cite sa pièce, l’origine et l’auteur de qui écrit', () => {
    const j = jugerLeReglementSelon(true, { piece_id: 'qa', date: '2026-03-05', montant: -30 }, dossier({ quiEcrit: 'client', utilisateur: 'u' }), [ACHAT], 'p')
    expect(j.etat).toBe('accepte')
    if (j.etat !== 'accepte') return
    expect(j.operation).toEqual({
      id: 'p', genre: 'paiement', date: '2026-03-05', montant: -30, categorie_id: null, taux_tva: null, encaissements_du_jour: null,
      piece_id: 'qa', origine: 'client', cree_par: 'u', remplace_id: null, retire_le: null,
    })
    expect(j.caisse.operations.map((o) => o.id)).toEqual(['apport', 'p'])
  })

  it('l’exemplaire d’une facture source se refuse sous son numéro, un exemplaire sans numéro aussi ; celui d’une autre se paie', () => {
    const exemplaire = (source: boolean, numero: string | null) => piece({ id: 'qx', type_piece: 'vente', exemplaire: { numero, source_de_la_vente: source } })
    expect(juger({ piece_id: 'qx', date: '2026-03-05', montant: 10 }, dossier(), [exemplaire(true, 'F2026-0007')])?.message)
      .toBe('Cette pièce est l\'exemplaire de la facture F2026-0007, qui compte sa vente : enregistre l\'encaissement en espèces de la facture.')
    expect(juger({ piece_id: 'qx', date: '2026-03-05', montant: 10 }, dossier(), [exemplaire(true, null)])?.message)
      .toContain('de la facture (sans numéro), qui compte sa vente')
    expect(juger({ piece_id: 'qx', date: '2026-03-05', montant: 10 }, dossier(), [exemplaire(false, 'F2026-0008')])).toBeNull()
  })

  it('le sens : l’avoir se lit au signe du montant de la pièce ; une pièce sans montant suit son type', () => {
    expect(juger({ piece_id: 'qa', date: '2026-03-05', montant: 5 }, dossier(), [piece({ montant_ttc: -15 })])).toBeNull()
    expect(juger({ piece_id: 'qa', date: '2026-03-05', montant: -5 }, dossier(), [piece({ montant_ttc: null })])).toBeNull()
    expect(juger({ piece_id: 'qa', date: '2026-03-05', montant: 5 }, dossier(), [piece({ montant_ttc: null })])?.code).toBe('22023')
    expect(juger({ piece_id: 'qa', date: '2026-03-05', montant: -5 }, dossier(), [piece({ montant_ttc: 0 })])).toBeNull()
  })

  it('le plafond : une pièce validée, ses paiements par la caisse non retirés, au centime, en valeur absolue', () => {
    const validee = piece({ statut: 'validee', montant_ttc: 50 })
    const deja = dossier({ caisse: caisse({ operations: [
      operation({ id: 'apport' }),
      operation({ id: 'p1', genre: 'paiement', date: '2026-03-02', montant: -30, piece_id: 'qa' }),
      operation({ id: 'p2', genre: 'paiement', date: '2026-03-02', montant: -40, piece_id: 'qa', retire_le: '2026-03-03T08:00:00Z' }),
      operation({ id: 'p3', genre: 'paiement', date: '2026-03-02', montant: -40, piece_id: 'autre' }),
    ] }) })
    expect(juger({ piece_id: 'qa', date: '2026-03-05', montant: -20 }, deja, [validee])).toBeNull()
    expect(juger({ piece_id: 'qa', date: '2026-03-05', montant: -20.01 }, deja, [validee])?.message)
      .toBe(MOTS_DU_PAIEMENT.au_dela.gabarit)
    // Un avoir de fournisseur de 15 € : 15 € d'entrées au plus.
    expect(juger({ piece_id: 'qa', date: '2026-03-05', montant: 15 }, dossier(), [piece({ statut: 'validee', montant_ttc: -15 })])).toBeNull()
    expect(juger({ piece_id: 'qa', date: '2026-03-05', montant: 15.01 }, dossier(), [piece({ statut: 'validee', montant_ttc: -15 })])?.message)
      .toBe(MOTS_DU_PAIEMENT.au_dela.gabarit)
    // Une pièce validée sans montant n'a pas de plafond.
    expect(juger({ piece_id: 'qa', date: '2026-03-05', montant: -400 }, dossier(), [piece({ statut: 'validee', montant_ttc: null })])).toBeNull()
  })

  it('la caisse jamais négative : une sortie, sous les mots du geste « paiement » ; une entrée ne se juge pas', () => {
    expect(juger({ piece_id: 'qa', date: '2026-02-28', montant: -1 })).toEqual({
      code: '23514',
      message: 'Ce paiement de 1,00 € rendrait la caisse négative le 28/02/2026 (−1,00 €) : saisis d\'abord les recettes en espèces qui le précèdent ; si tu as payé de ta poche, ce n\'est pas la caisse : c\'est une note de frais.',
    })
    expect(juger({ piece_id: 'qv', date: '2026-02-28', montant: 1 }, dossier(), [piece({ id: 'qv', type_piece: 'vente' })])).toBeNull()
  })

  it('l’ordre, au bord de chaque refus : l’accès, la trésorerie, la pièce, le type, l’exemplaire, la date, le montant, le sens', () => {
    expect(juger({ piece_id: null, date: null, montant: null }, dossier({ quiEcrit: null }))?.message).toBe('Accès refusé à ce dossier.')
    expect(juger({ piece_id: null, date: null, montant: null }, dossier({ modele: { ...MODELE, mode: 'engagement' } }))?.code).toBe('22023')
    expect(juger({ piece_id: 'inconnue', date: null, montant: null })?.code).toBe('P0002')
    expect(juger({ piece_id: 'qa', date: null, montant: null }, dossier(), [piece({ type_piece: 'autre' })])?.message)
      .toBe(MOTS_DU_PAIEMENT.ni_achat_ni_vente.gabarit)
    expect(juger({ piece_id: 'qa', date: '1999-12-31', montant: 0 })?.message).toBe('Une opération de caisse ne se date pas avant l\'an 2000.')
    expect(juger({ piece_id: 'qa', date: '2026-03-05', montant: 10.005 })?.message).toBe('Le montant d\'une opération de caisse est au centime.')
    expect(juger({ piece_id: 'qa', date: '2026-03-05', montant: 25 }, dossier(), [piece({ statut: 'validee', montant_ttc: 10 })])?.message)
      .toBe(MOTS_DU_PAIEMENT.sens.gabarit)
  })
})

// LE RESTE AU CENTIME (relecture du 01/11/2026, le défaut 2 ; C9-Q1, sur sa recommandation) : la caisse n'aligne pas la pièce,
// elle REFUSE le paiement qui la laisserait dans l'écart où la banque l'alignerait sans l'atteindre au centime, et dit le
// montant exact. Les mêmes règles que le bloc 9 bis de `regler_piece_par_la_caisse` (caisse.sql, 232) : le total de TOUS les
// paiements de la pièce, en valeur absolue, une pièce en euros et de montant lu.
describe('le reste au centime — la caisse refuse là où la banque alignerait', () => {
  const quarante = (o: Partial<PieceDuPaiement> = {}) => piece({ statut: 'validee', montant_ttc: 40, ...o })
  const payer = (montant: number, p: PieceDuPaiement, d = dossier()) => juger({ piece_id: 'qa', date: '2026-03-05', montant }, d, [p])

  it('39,99 € pour 40,00 € : refusé sous le montant exact ; 40,00 € passe ; au-delà de l’écart (2 %, 0,80 €), un paiement en partie passe', () => {
    expect(payer(-39.99, quarante())).toEqual({ code: '22023', message: "Ce paiement laisserait 0,01 € à régler sur cette pièce : sous l'écart où une pièce se dit réglée, son écriture ne s'équilibrerait pas. Le montant exact qui la règle est une sortie de 40,00 € — ou corrige d'abord le montant de la pièce." })
    expect(payer(-40, quarante())).toBeNull()
    expect(payer(-39.2, quarante())?.code).toBe('22023')
    expect(payer(-39.19, quarante())).toBeNull()
  })

  it('au-delà d’une pièce à valider (qui n’a pas de plafond) : « payés en trop », et le montant exact ; validée, le plafond d’abord', () => {
    expect(payer(-40.01, quarante({ statut: 'a_valider' }))?.message)
      .toBe("Ce paiement laisserait 0,01 € payés en trop sur cette pièce : sous l'écart où une pièce se dit réglée, son écriture ne s'équilibrerait pas. Le montant exact qui la règle est une sortie de 40,00 € — ou corrige d'abord le montant de la pièce.")
    expect(payer(-40.01, quarante())?.message).toBe(MOTS_DU_PAIEMENT.au_dela.gabarit)
  })

  it('tous ses paiements comptent : le relevé et la caisse ; déjà réglée, le centime de plus se dit tel', () => {
    expect(payer(-19.99, quarante({ paiementsDuReleve: [{ montant: -20 }] }))?.message).toMatch(/0,01 € à régler .* une sortie de 20,00 €/)
    const parLaCaisse = dossier({ caisse: caisse({ operations: [operation({ id: 'apport' }), operation({ id: 'p1', genre: 'paiement', date: '2026-03-02', montant: -20, piece_id: 'qa' })] }) })
    expect(payer(-19.99, quarante(), parLaCaisse)?.message).toMatch(/0,01 € à régler .* une sortie de 20,00 €/)
    expect(payer(-20, quarante(), parLaCaisse)).toBeNull()
    // Un paiement retiré ne compte plus.
    const retire = dossier({ caisse: caisse({ operations: [operation({ id: 'apport' }), operation({ id: 'p1', genre: 'paiement', date: '2026-03-02', montant: -20, piece_id: 'qa', retire_le: '2026-03-03T08:00:00Z' })] }) })
    expect(payer(-39.99, quarante(), retire)?.message).toMatch(/une sortie de 40,00 €/)
    expect(payer(-0.01, quarante({ statut: 'a_valider', paiementsDuReleve: [{ montant: -40 }] }))?.message)
      .toBe("Cette pièce est déjà réglée par ses autres paiements : ce paiement la paierait de 0,01 € en trop, sous l'écart où une pièce se dit réglée, et son écriture ne s'équilibrerait pas.")
  })

  it('le client : les mots qui ne disent pas le montant de la pièce', () => {
    expect(payer(-39.99, quarante(), dossier({ quiEcrit: 'client', utilisateur: 'u' }))).toEqual({ code: '22023', message: MOTS_DU_PAIEMENT.au_centime_client.gabarit })
  })

  it('un avoir : une entrée, et le montant exact se dit tel ; une pièce en devise, ou sans montant, ne se juge pas au centime', () => {
    expect(payer(39.99, quarante({ montant_ttc: -40 }))?.message).toMatch(/0,01 € à régler .* une entrée de 40,00 €/)
    expect(payer(-39.99, quarante({ devise: 'USD' }))).toBeNull()
    expect(payer(-39.99, piece({ montant_ttc: null }))).toBeNull()
  })

  // LA RÈGLE EXACTE, EN CENTIMES — celle de la base, en `numeric` : un reste R non nul, |R| ≤ 2 % du montant et ≤ 5 € —, contre le
  // module (en flottants, par `ecartAvecBanque`), au bord de chaque écart : le module refuse exactement là où la base refuse.
  it('au bord de l’écart, le module et la règle exacte de la base rendent le même verdict', () => {
    const montants = [1, 49, 50, 51, 99, 100, 101, 1999, 2000, 2001, 4000, 4081, 4082, 24999, 25000, 25001, 100000, 123457]
    let juges = 0
    for (const ttc of montants) {
      for (const avant of [0, -Math.floor(ttc / 2), -ttc]) {
        for (let p = -ttc - 600; p <= -ttc + 600; p++) {
          if (p === 0) continue
          const reste = ttc - Math.abs(avant + p)
          const base = reste !== 0 && Math.abs(reste) * 50 <= ttc && Math.abs(reste) <= 500
          const module = resteAuCentime(piece({ montant_ttc: ttc / 100, paiementsDuReleve: avant === 0 ? [] : [{ montant: avant / 100 }] }), caisse(), p)
          expect(module !== null, `${ttc} ${avant} ${p}`).toBe(base)
          if (module !== null) {
            expect(module.resteApres).toBe(reste)
            const exact = Math.sign(p) * ttc - avant
            expect(module.exact).toBe(Math.sign(exact) === Math.sign(p) ? exact : null)
          }
          juges++
        }
      }
    }
    expect(juges).toBeGreaterThan(60000)
  })
})

describe('refusDeLaContrepartie — la contrepartie d’un paiement', () => {
  const paiement = operation({ id: 'p', genre: 'paiement', date: '2026-03-05', montant: -30, piece_id: 'qa' })
  const etat = caisse({ operations: [operation({ id: 'apport' }), paiement] })
  const ligne = { date: '2026-03-05', compte: '530000', sens: 'credit' as const, montant: 30, piece_id: 'qa', operation_caisse_id: 'p' }

  it('celle que l’application compose est celle que la garde admet, au plan du dossier', () => {
    expect(contrepartieDuPaiement(paiement, etat.compteCaisse)).toEqual(ligne)
    expect(refusDeLaContrepartie(contrepartieDuPaiement(paiement, etat.compteCaisse)!, etat, [])).toBeNull()
    const decale = caisse({ ...etat, compteCaisse: PLAN_DECALE.caisse })
    const entree = operation({ id: 'e', genre: 'paiement', date: '2026-03-06', montant: 12.5, piece_id: 'qv' })
    expect(contrepartieDuPaiement(entree, decale.compteCaisse)).toEqual({ date: '2026-03-06', compte: PLAN_DECALE.caisse, sens: 'debit', montant: 12.5, piece_id: 'qv', operation_caisse_id: 'e' })
    expect(contrepartieDuPaiement({ ...entree, piece_id: null }, '530000')).toBeNull()
  })

  it('chaque refus, dans l’ordre : son paiement, le compte du plan, le sens, la part', () => {
    expect(refusDeLaContrepartie({ ...ligne, date: '2026-03-06', compte: '512000' }, etat, [])?.message).toBe(MOTS_DU_PAIEMENT.contrepartie_ne_suit_pas.gabarit)
    expect(refusDeLaContrepartie({ ...ligne, piece_id: 'autre' }, etat, [])?.message).toBe(MOTS_DU_PAIEMENT.contrepartie_ne_suit_pas.gabarit)
    expect(refusDeLaContrepartie({ ...ligne, operation_caisse_id: 'inconnu' }, etat, [])?.code).toBe('23514')
    expect(refusDeLaContrepartie(ligne, caisse({ operations: [{ ...paiement, retire_le: '2026-03-06T08:00:00Z' }] }), [])?.message)
      .toBe(MOTS_DU_PAIEMENT.contrepartie_ne_suit_pas.gabarit)
    expect(refusDeLaContrepartie({ ...ligne, compte: '512000', sens: 'debit' }, etat, [])?.message)
      .toBe('La contrepartie d\'un paiement par la caisse s\'écrit au compte de la caisse du dossier (530000).')
    expect(refusDeLaContrepartie({ ...ligne, sens: 'debit', montant: 31 }, etat, [])?.message).toBe(MOTS_DU_PAIEMENT.contrepartie_sens.gabarit)
    expect(refusDeLaContrepartie({ ...ligne, montant: 30.01 }, etat, [])?.message).toBe(MOTS_DU_PAIEMENT.contrepartie_au_dela.gabarit)
    expect(refusDeLaContrepartie({ ...ligne, montant: 10 }, etat, [{ montant: 20 }])).toBeNull()
    expect(refusDeLaContrepartie({ ...ligne, montant: 10.01 }, etat, [{ montant: 20 }])?.message).toBe(MOTS_DU_PAIEMENT.contrepartie_au_dela.gabarit)
  })
})

describe('refusDuChangementDeLaPiece — la pièce qu’un paiement cite', () => {
  const avant: PieceGardee = { id: 'qa', dossier_id: 'd', type_piece: 'achat', facture_id: null }
  const vivant = [{ genre: 'paiement' as const, piece_id: 'qa', retire_le: null }]
  const retire = [{ genre: 'paiement' as const, piece_id: 'qa', retire_le: '2026-03-06T08:00:00Z' }]
  const SOURCE = { numero: 'F2026-0001', source_de_la_vente: true }

  it('le dossier, même le paiement retiré ; le type et la désignation, tant qu’il ne l’est pas', () => {
    expect(refusDuChangementDeLaPiece(avant, { ...avant, dossier_id: 'w' }, retire, null)?.message).toBe(MOTS_DU_PAIEMENT.piece_change_de_dossier.gabarit)
    expect(refusDuChangementDeLaPiece(avant, { ...avant, type_piece: 'note_frais' }, vivant, null)?.message).toBe(MOTS_DU_PAIEMENT.piece_change_de_type.gabarit)
    expect(refusDuChangementDeLaPiece(avant, { ...avant, type_piece: 'autre' }, vivant, null)?.message).toBe(MOTS_DU_PAIEMENT.piece_change_de_type.gabarit)
    expect(refusDuChangementDeLaPiece(avant, { ...avant, type_piece: 'note_frais' }, retire, null)).toBeNull()
    expect(refusDuChangementDeLaPiece(avant, { ...avant, type_piece: 'vente' }, vivant, null)).toBeNull()
    expect(refusDuChangementDeLaPiece(avant, { ...avant, dossier_id: 'w' }, [], null)).toBeNull()
    const vente = { ...avant, type_piece: 'vente' as const }
    expect(refusDuChangementDeLaPiece(vente, { ...vente, facture_id: 'f' }, vivant, SOURCE)?.message)
      .toBe('Cette pièce est payée par la caisse : elle ne devient l\'exemplaire de la facture F2026-0001, qui compte sa vente, qu\'une fois ce paiement retiré — l\'encaissement en espèces de la facture le remplace.')
    expect(refusDuChangementDeLaPiece(vente, { ...vente, facture_id: 'f' }, vivant, { ...SOURCE, source_de_la_vente: false })).toBeNull()
    expect(refusDuChangementDeLaPiece(vente, { ...vente, facture_id: 'f' }, retire, SOURCE)).toBeNull()
    // L'ordre : le dossier d'abord.
    expect(refusDuChangementDeLaPiece(avant, { ...avant, dossier_id: 'w', type_piece: 'autre' }, vivant, null)?.message)
      .toBe(MOTS_DU_PAIEMENT.piece_change_de_dossier.gabarit)
  })
})

describe('refusDuMouvementAvantLOuverture — la caisse bornée par son ouverture', () => {
  const reprise = caisse({ ouvertures: [{ date: '2026-01-01', compte: '512000', sens: 'debit', montant: 50 }] })

  it('d’avant l’ouverture du dossier, il ne se classe pas sur la caisse ; le jour même, oui ; sur un autre compte, la garde se tait', () => {
    expect(refusDuMouvementAvantLOuverture({ date: '2025-12-31', compte_bilan: null }, '530000', reprise)).toEqual({
      code: '23514', message: 'Ce mouvement précède l\'ouverture du dossier, le 01/01/2026 : il est déjà dans les comptes repris, et ne se classe pas sur la caisse.',
    })
    expect(refusDuMouvementAvantLOuverture({ date: '2026-01-01', compte_bilan: null }, '530000', reprise)).toBeNull()
    expect(refusDuMouvementAvantLOuverture({ date: '2025-12-31', compte_bilan: null }, '580000', reprise)).toBeNull()
    expect(refusDuMouvementAvantLOuverture({ date: '2025-12-31', compte_bilan: null }, '530000', caisse())).toBeNull()
    // Déjà sur la caisse : il se retire comme hier.
    expect(refusDuMouvementAvantLOuverture({ date: '2025-12-31', compte_bilan: '530000' }, '530000', reprise)).toBeNull()
    // Le compte de la caisse est celui du plan.
    expect(refusDuMouvementAvantLOuverture({ date: '2025-12-31', compte_bilan: null }, PLAN_DECALE.caisse, { ...reprise, compteCaisse: PLAN_DECALE.caisse })?.code).toBe('23514')
  })
})

describe('l’ensemble du jour d’une recette, sur le jeu de l’essai (B8, le 12/03) : les mots de la base', () => {
  // B8 a basculé : sa facture source F2026-0001 porte des espèces le 12/03 (216g2), et la pièce de vente QB1 un paiement par
  // la caisse de 15 € ce jour-là (214h). Le banc ne rejoue pas le registre des encaissements : ces verdicts se lisent ici.
  const etapes = etapesDeLEssai(ESSAI)
  const attendu = (numero: string) => {
    const e = etapes.find((x) => x.titre.startsWith(`${numero} `))!
    return { code: e.code, attendu: sansApostrophes(e.attendu) }
  }
  const b8 = dossier({
    categories: [{ id: 'kb8', dossier_id: 'b8', libelle: 'Honoraires', compte_comptable: '706000' }],
    caisse: caisse({
      factures: [{ id: 'f', numero: 'F2026-0001', source_de_la_vente: true }],
      encaissements: [{ id: 'enc', facture_id: 'f', date_encaissement: '2026-03-12', montant: 50, moyen: 'especes', ligne_bancaire_id: null, annule_id: null, retire_le: null }],
      operations: [operation({ id: 'pqb1', genre: 'paiement', date: '2026-03-12', montant: 15, piece_id: 'qb1' })],
      piecesDeVente: ['qb1'],
    }),
  })
  const recette = (ensemble: string[]): SaisieDeCaisse => ({
    genre: 'recette', date: '2026-03-12', montant: 25, categorie_id: 'kb8', taux_tva: null, encaissements_du_jour: ensemble,
    ecritures: [{ compte: '530000', sens: 'debit', montant: 25 }, { compte: '706000', sens: 'credit', montant: 25 }],
  })
  const juge = (numero: string, s: SaisieDeCaisse) => {
    const r = refusDeLaSaisie(s, b8)
    const a = attendu(numero)
    if (a.code === 'OK') expect(r, numero).toBeNull()
    else {
      expect(r?.code, numero).toBe(a.code)
      expect(commeLike(a.attendu, sansApostrophes(r!.message)), `${numero} : ${r?.message}`).toBe(true)
    }
  }

  it('216h à 216j : l’encaissement qui manque d’abord, puis le paiement qui manque ; les deux reconnus, la recette passe', () => {
    juge('216h.', recette([]))
    juge('216i.', recette(['enc']))
    juge('216j.', recette(['enc', 'pqb1']))
  })

  it('sans les pièces de vente lues, aucun paiement n’est d’une pièce de vente : l’ensemble d’hier (le chemin par défaut)', () => {
    const sans = { ...b8, caisse: { ...b8.caisse, piecesDeVente: undefined } }
    expect(refusDeLaSaisie(recette(['enc']), sans)).toBeNull()
    expect(refusDeLaSaisie(recette(['enc', 'pqb1']), sans)?.message)
      .toBe(MOTS.ensemble_paiement_en_trop.gabarit)
  })
})
