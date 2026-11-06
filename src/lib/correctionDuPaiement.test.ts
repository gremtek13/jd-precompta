import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ORDRE_DES_REFUS, MOTS_DE_LA_CAISSE, premierJourNegatif, type DossierDeLaCaisse, type EtatDeLaCaisse, type OperationDeLaCaisse,
} from './caisse'
import {
  CORRECTION_DU_PAIEMENT_EXPORTEE, correctionOfferte, correctionOfferteSelon, correctionSansChangement, jugerLaCorrection,
  jugerLaCorrectionDuClientSelon, jugerLaCorrectionSelon, MOTS_DE_LA_CORRECTION, motsDuRemedeSelon, ORDRE_DE_LA_CORRECTION,
} from './correctionDuPaiement'
import type { DonneesDeLaCaisse } from './caisseEcran'
import { motsDuCabinet } from './espaceVentes'
import { correctionDeLaFiche, formulaireDeLaCorrection, verdictDeLaCorrection } from './paiementParLaCaisseEcran'
import type { OperationCaisse } from './types'
import {
  MOTS, MOTS_DU_PAIEMENT, ORDRE_DU_PAIEMENT, paiementsParLaCaisseSelon, type PieceDuPaiement, type PieceDuPaiementDuClient,
} from './paiementParLaCaisse'
import { PLAN_PAR_DEFAUT } from './planComptable'
import { paiementsDesPieces } from './rattachement'
import { entierTire, tirage } from '../test/encaissementsBatterie'
import { fichiersDuSchema, fichiersPrepares } from '../test/schema'
import { LIBELLES_PAR_DEFAUT, PREFIXES_PAR_DEFAUT } from '../test/modeles'

// CORRIGER UN PAIEMENT EN ESPÈCES D'UN SEUL GESTE, CONFRONTÉ À LA BASE (C12B-Q1 ; ligne 26.6). La migration
// `correction_du_paiement_par_la_caisse` — préparée dans supabase/preparees/, dans l'export sous la version de sa ligne
// d'historique le jour de son application, texte inchangé — pose `remplacer_paiement_par_la_caisse`. Ce garde la confronte :
//   1. à son texte : les mots et l'ordre de ses refus relus dans le corps de la fonction ; les cinq premiers, recopiés du
//      retrait, confrontés à ceux de `retirer_operation_caisse` au caractère près ; la délégation au paiement
//      (`regler_piece_par_la_caisse`, dans la sous-transaction « JDC12 ») et au retrait (`retirer_operation_caisse`) ; sa garde
//      de tête, ses empreintes relues en chaîne ; ce qu'elle crée, rien de retiré ; son retour arrière ;
//   2. au module (lib/correctionDuPaiement.ts), cas par cas, et par une batterie : la caisse jamais négative après une
//      correction acceptée ; les moteurs ne comptent que le paiement vivant ;
//   3. aux essais qui la jouent (caisse.sql 270 à 289, le bloc CQ de rls.sql, le filet de la validation) — le banc de
//      lib/caisse.test.ts rejoue les étapes de caisse.sql par ce module, au verdict de la base.
// Récit : HISTORIQUE.md, « LA CAISSE : CORRIGER UN PAIEMENT EN ESPÈCES D'UN SEUL GESTE (C12B-Q1) (PRÉPARÉE, PAS APPLIQUÉE) ».
// Données FICTIVES.

const MIGRATION = /\/\d{14}_correction_du_paiement_par_la_caisse\.sql$/
const md5 = (texte: string) => createHash('md5').update(texte, 'utf8').digest('hex')
const nomDuFichier = (chemin: string) => chemin.split('/').pop() as string
const lire = (chemin: string) => readFileSync(new URL(`../../${chemin}`, import.meta.url), 'utf8')
const sansApostrophes = (s: string) => s.replace(/''/g, "'").replace(/’/g, "'")

// La migration, où qu'elle soit : préparée aujourd'hui, dans l'export le jour de son application — jamais aux deux.
function laMigration(): { chemin: string; texte: string } {
  const trouvees = [...fichiersPrepares(), ...fichiersDuSchema()].filter((x) => MIGRATION.test(x.chemin))
  expect(trouvees.map((f) => f.chemin), 'la migration correction_du_paiement_par_la_caisse, préparée OU dans l’export').toHaveLength(1)
  return trouvees[0]
}

// Les définitions qu'un texte donne à une fonction, chacune de son « create » au « $$; » qui la ferme.
function definitionsDans(texte: string, fonction: string): string[] {
  return [...texte.matchAll(new RegExp(`create (?:or replace )?function public\\.${fonction}\\(`, 'g'))]
    .map((m) => texte.slice(m.index, texte.indexOf('$$;', m.index)))
}

// La définition d'une fonction avant la migration : la dernière que lui donnent l'export et les migrations préparées dont le
// nom précède celui de la migration, dans l'ordre de leurs noms.
function avantLaMigration(fonction: string): string {
  const nom = nomDuFichier(laMigration().chemin)
  const avant = [...fichiersDuSchema(), ...fichiersPrepares()]
    .filter((f) => nomDuFichier(f.chemin) < nom)
    .sort((a, b) => (nomDuFichier(a.chemin) < nomDuFichier(b.chemin) ? -1 : 1))
    .flatMap((f) => definitionsDans(f.texte, fonction))
  expect(avant.length, fonction).toBeGreaterThan(0)
  return avant[avant.length - 1]
}

// Le corps tel que `pg_proc.prosrc` le garde : ce qui suit les dollars qui l'ouvrent, jusqu'à ceux qui le ferment.
const prosrc = (definition: string) => definition.slice(definition.indexOf('as $$') + 'as $$'.length)

/** Les `raise exception` d'un corps, dans l'ordre du texte : leur gabarit (l'apostrophe doublée rendue simple) et leur code. */
function raises(corps: string): { gabarit: string; code: string }[] {
  return [...corps.matchAll(/raise exception '((?:[^']|'')*)'([^;]*);/g)].map((m) => ({
    gabarit: m[1].replace(/''/g, "'"),
    code: /using errcode = '(\w+)'/.exec(m[2])?.[1] ?? '',
  }))
}
const lus = (r: { gabarit: string; code: string }[]) => r.map((x) => `${x.code} ${sansApostrophes(x.gabarit)}`)
const attendus = (cles: readonly string[]) => cles.map((c) => {
  const mot = (MOTS as Record<string, { code: string; gabarit: string }>)[c] ?? (MOTS_DE_LA_CORRECTION as Record<string, { code: string; gabarit: string }>)[c]
  return `${mot.code} ${sansApostrophes(mot.gabarit)}`
})

/** Les lignes de code d'un corps (sans les commentaires ni les lignes vides), chacune ramenée à elle-même. */
const lignesDeCode = (corps: string) => corps.split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('--'))

/** Les cinq premiers refus du retrait, en code : de la lecture de l'opération à la fin du refus de la frontière. */
function cinqRefus(corps: string, variable: string): string[] {
  const lignes = lignesDeCode(corps)
  const debut = lignes.findIndex((l) => l === `select o.* into ${variable} from public.operations_caisse o`)
  const fige = lignes.findIndex((l) => l.startsWith(`public.exercice_fige(p_dossier_id, extract(year from ${variable}.date)::integer)`))
  expect(debut, variable).toBeGreaterThan(0)
  expect(fige, variable).toBeGreaterThan(debut)
  return lignes.slice(debut, fige + 2)
}

const CORPS = () => prosrc(definitionsDans(laMigration().texte, 'remplacer_paiement_par_la_caisse')[0])

describe('la migration correction_du_paiement_par_la_caisse', () => {
  it('est là, préparée ou dans l’export, une fois, après les migrations de la caisse qu’elle suppose', () => {
    const nom = nomDuFichier(laMigration().chemin)
    const tous = [...fichiersDuSchema(), ...fichiersPrepares()].map((f) => nomDuFichier(f.chemin))
    for (const avant of ['paiement_par_la_caisse', 'validation_des_paiements_par_la_caisse', 'caisse_du_client']) {
      const trouve = tous.filter((n) => new RegExp(`^\\d{14}_${avant}\\.sql$`).test(n))
      expect(trouve, avant).toHaveLength(1)
      expect(trouve[0] < nom, avant).toBe(true)
    }
  })

  it('le drapeau suit le fichier : levé le jour où la migration entre dans l’export, jamais avant', () => {
    expect(CORRECTION_DU_PAIEMENT_EXPORTEE).toBe(fichiersDuSchema().some((f) => MIGRATION.test(f.chemin)))
  })

  it('le texte : une fonction neuve, son commentaire, ses droits — rien de remplacé, rien de retiré', () => {
    const texte = laMigration().texte
    const sansCommentaires = lignesDeCode(texte).join('\n')
    expect([...sansCommentaires.matchAll(/create (or replace )?function public\.(\w+)\(/g)].map((m) => `${m[1] ? 'r' : 'c'} ${m[2]}`))
      .toEqual(['c remplacer_paiement_par_la_caisse'])
    expect(sansCommentaires).toContain('comment on function public.remplacer_paiement_par_la_caisse(uuid, uuid, date, numeric) is')
    expect([...sansCommentaires.matchAll(/\b(grant|revoke) execute on function public\.([^;]*);/g)].map((m) => `${m[1]} ${m[2]}`)).toEqual([
      'revoke remplacer_paiement_par_la_caisse(uuid, uuid, date, numeric) from public, anon',
      'grant remplacer_paiement_par_la_caisse(uuid, uuid, date, numeric) to authenticated',
    ])
    expect(sansCommentaires.match(/\b(grant|revoke)\b/gi)).toHaveLength(2)
    // Ni objet, ni donnée, ni ligne retirés par le texte — ni même par le corps : le retrait de l'ancien passe par sa
    // fonction (le détecteur d'`apply_migration` ne lit aucune suppression).
    expect(texte).not.toMatch(/\b(drop|truncate|delete)\b/i)
    expect(sansCommentaires).not.toMatch(/\b(alter table|create policy|create trigger|create table)\b/i)
    expect(definitionsDans(texte, 'remplacer_paiement_par_la_caisse')[0].replace(/\s+/g, ' ')).toContain(
      'create function public.remplacer_paiement_par_la_caisse(p_dossier_id uuid, p_operation_id uuid, p_date date, p_montant numeric) '
      + 'returns public.operations_caisse language plpgsql security definer set search_path = public as $$')
    expect(texte).not.toContain('\\')
    expect(texte).not.toContain('\r')
  })

  it('sa garde de tête, avant toute définition : une seconde application, les migrations qu’elle suppose, treize corps à leur empreinte d’hier', () => {
    const texte = laMigration().texte
    const garde = texte.slice(texte.indexOf('do $garde$'), texte.indexOf('$garde$;'))
    expect(texte.indexOf('do $garde$')).toBeLessThan(texte.indexOf('\ncreate '))
    expect(garde).toContain("'La migration correction_du_paiement_par_la_caisse est déjà en base : elle ne s''applique pas deux fois.'")
    expect(garde).toContain("if to_regprocedure('public.caisse_du_client(uuid, integer)') is null")
    const epinglees = [...garde.matchAll(/\('(\w+)', 'public\.(\w+)\(([^)]*)\)', '([0-9a-f]{32})'\)/g)]
      .map((m) => ({ nom: m[1], fonction: m[2], empreinte: m[4] }))
    expect(epinglees.map((e) => e.nom)).toEqual([
      'qui_ecrit_la_caisse', 'cle_validation', 'frontiere_validation', 'exercice_fige', 'regler_piece_par_la_caisse',
      'retirer_operation_caisse', 'premier_jour_negatif_de_la_caisse', 'texte_caisse_negative', 'garder_operation_caisse',
      'garder_ecriture_de_caisse', 'garder_la_caisse', 'garder_piece_payee_par_la_caisse', 'valider_exercice',
    ])
    // Chaque empreinte, relue en chaîne : celle de la dernière définition d'hier, dans l'export et les migrations préparées.
    for (const e of epinglees) {
      expect(e.fonction, e.nom).toBe(e.nom)
      expect(md5(prosrc(avantLaMigration(e.nom))), e.nom).toBe(e.empreinte)
    }
    expect(garde).toContain('if v_nombre <> 1 or v_empreinte is distinct from v_attendue.empreinte then')
    expect(garde).toContain("select md5(replace(p.prosrc, chr(13), '')) into v_empreinte from pg_proc p")
    expect(garde).toContain("c.conname = 'operations_caisse_un_remplacement' and c.contype = 'u'")
  })
})

describe('les mots et l’ordre des refus, relus dans le corps de la fonction', () => {
  it('l’accès d’abord, avant toute lecture', () => {
    const corps = CORPS()
    const acces = corps.search(/public\.qui_ecrit_la_caisse\(p_dossier_id\)/)
    expect(acces).toBeGreaterThan(0)
    expect(acces).toBeLessThan(corps.search(/raise exception/))
    expect(acces).toBeLessThan(corps.search(/\bfrom public\./))
  })

  it('ses refus à elle : les cinq du retrait, puis le genre — l’ordre du module, son code et ses mots', () => {
    const propres = raises(CORPS()).filter((r) => r.gabarit !== '%' && r.code !== 'JDC12')
    expect(lus(propres)).toEqual(attendus([...ORDRE_DES_REFUS.retirer_operation_caisse, 'pas_un_paiement']))
    expect(ORDRE_DE_LA_CORRECTION.slice(0, propres.length)).toEqual([...ORDRE_DES_REFUS.retirer_operation_caisse, 'pas_un_paiement'])
    // Aucun autre que le signal de la sous-transaction : la caisse négative et les refus du nouveau viennent des fonctions
    // qu'elle appelle (`regler_piece_par_la_caisse`, puis `retirer_operation_caisse`), sous leurs mots.
    expect(raises(CORPS()).filter((r) => r.gabarit === '%' || r.code === 'JDC12').map((r) => r.code)).toEqual(['JDC12'])
  })

  it('les cinq recopiés du retrait sont ceux de `retirer_operation_caisse`, au caractère près — la variable exceptée', () => {
    const retrait = prosrc(avantLaMigration('retirer_operation_caisse'))
    expect(cinqRefus(CORPS(), 'v_ancien')).toEqual(cinqRefus(retrait, 'v_operation').map((l) => l.replace(/v_operation\b/g, 'v_ancien')))
    // Et sous les mêmes verrous, pris dans le même ordre, après l'accès.
    for (const verrou of ['perform pg_advisory_xact_lock_shared(public.cle_validation(p_dossier_id));',
      "perform pg_advisory_xact_lock(hashtextextended('jd.caisse:' || p_dossier_id::text, 0));"]) {
      expect(lignesDeCode(CORPS()), verrou).toContain(verrou)
      expect(lignesDeCode(retrait), verrou).toContain(verrou)
    }
  })

  it('le seul mot neuf est dit une fois dans la migration, et nulle part ailleurs dans le schéma', () => {
    const migration = laMigration()
    const ailleurs = [...fichiersDuSchema(), ...fichiersPrepares()].filter((f) => f.chemin !== migration.chemin)
      .map((f) => sansApostrophes(f.texte)).join('\n')
    const gabarit = sansApostrophes(MOTS_DE_LA_CORRECTION.pas_un_paiement.gabarit)
    expect(sansApostrophes(migration.texte).split(gabarit).length - 1).toBeGreaterThanOrEqual(1)
    expect(ailleurs.includes(gabarit)).toBe(false)
    // Le code de la sous-transaction, que la fonction seule lève et rattrape.
    expect(ailleurs.includes("'JDC12'")).toBe(false)
  })

  it('le nouveau, jugé par `regler_piece_par_la_caisse` ELLE-MÊME dans une sous-transaction défaite aussitôt, l’ancien retiré', () => {
    const code = lignesDeCode(CORPS())
    const debut = code.indexOf('begin', code.indexOf("raise exception 'Seul le paiement d''une pièce par la caisse se corrige ainsi : une autre opération de la caisse se remplace.'"))
    expect(code.slice(debut, debut + 11)).toEqual([
      'begin',
      "perform set_config('jd.caisse', v_ancien.id::text, true);",
      'update public.operations_caisse set retire_le = now(), retire_par = auth.uid()',
      'where id = v_ancien.id;',
      "perform set_config('jd.caisse', '', true);",
      'v_nouveau := public.regler_piece_par_la_caisse(p_dossier_id, v_ancien.piece_id, p_date, p_montant);',
      "raise exception 'Le paiement corrigé est jugé : il s''écrit maintenant avec son lien.' using errcode = 'JDC12';",
      "exception when sqlstate 'JDC12' then",
      'null;',
      'end;',
      'v_nouveau.remplace_id := v_ancien.id;',
    ])
    // Un seul rattrapage, le sien : tout autre refus remonte tel quel, sous ses mots et son code.
    expect(CORPS().match(/\bexception when\b/g)).toHaveLength(1)
    // La pièce de l'ancien, verrouillée en partage jusqu'à la fin, avant la sous-transaction (son verrou tombe avec elle).
    expect(code.indexOf('perform 1 from public.pieces p where p.id = v_ancien.piece_id for share;')).toBeGreaterThan(0)
    expect(code.indexOf('perform 1 from public.pieces p where p.id = v_ancien.piece_id for share;')).toBeLessThan(debut)
    // Le retrait de l'ancien dans la sous-transaction : celui de `retirer_operation_caisse`, ses deux colonnes seulement.
    expect(prosrc(avantLaMigration('retirer_operation_caisse'))).toContain(
      'update public.operations_caisse set retire_le = now(), retire_par = auth.uid()\n   where id = v_operation.id')
  })

  it('puis le nouveau écrit, son lien en plus, sous son réglage ; l’ancien retiré par `retirer_operation_caisse`, ses lignes avec lui', () => {
    const code = lignesDeCode(CORPS())
    const fin = code.indexOf('v_nouveau.remplace_id := v_ancien.id;')
    expect(code.slice(fin)).toEqual([
      'v_nouveau.remplace_id := v_ancien.id;',
      "perform set_config('jd.caisse', v_nouveau.id::text, true);",
      'insert into public.operations_caisse select (v_nouveau).*;',
      "perform set_config('jd.caisse', '', true);",
      'perform public.retirer_operation_caisse(p_dossier_id, v_ancien.id);',
      'return v_nouveau;',
      'end',
    ])
    // Le retrait retire toutes les lignes du brouillon de l'opération, puis juge la caisse sous les mots de son geste.
    const retrait = prosrc(avantLaMigration('retirer_operation_caisse'))
    expect(retrait).toContain('delete from public.ecritures_brouillon where operation_caisse_id = v_operation.id;')
    expect(retrait).toMatch(/raise exception '%', public\.texte_caisse_negative\('retrait_' \|\| v_operation\.genre, v_operation\.montant, v_jour, v_solde\)/)
  })
})

describe('le retour arrière', () => {
  function leRetour(): string {
    const dossier = new URL('../../supabase/preparees/retour/', import.meta.url).pathname
    expect(existsSync(dossier), 'supabase/preparees/retour/').toBe(true)
    const nom = readdirSync(dossier).find((n) => /^\d{14}_retour_correction_du_paiement_par_la_caisse\.sql$/.test(n))
    expect(nom, 'le retour arrière de correction_du_paiement_par_la_caisse').toBeDefined()
    return readFileSync(dossier + nom, 'utf8')
  }

  it('exige la fonction que la migration a posée, à son empreinte, puis la retire — et rien d’autre', () => {
    const retour = leRetour()
    const garde = retour.slice(retour.indexOf('do $garde$'), retour.indexOf('$garde$;'))
    expect(garde).toContain(`'${md5(CORPS())}'`)
    expect(garde).toContain("'La migration correction_du_paiement_par_la_caisse n''est pas en base (ou ce retour est déjà fait) : rien à défaire.'")
    const code = lignesDeCode(retour.slice(retour.indexOf('$garde$;')))
    expect(code.filter((l) => /^(drop|create|alter|grant|revoke|comment|delete|update|insert)\b/i.test(l)))
      .toEqual(['drop function public.remplacer_paiement_par_la_caisse(uuid, uuid, date, numeric);'])
    expect(retour).not.toContain('\\')
    expect(retour).not.toContain('\r')
  })
})

// ── Le module, cas par cas ───────────────────────────────────────────────────────────────────────────────────────────

const AUJOURDHUI = '2026-11-04'
const MODELE = { mode: 'tresorerie' as const, compteNotesDeFrais: '455000', plan: PLAN_PAR_DEFAUT, libelles: LIBELLES_PAR_DEFAUT, prefixes: PREFIXES_PAR_DEFAUT }

function caisse(o: Partial<EtatDeLaCaisse> = {}): EtatDeLaCaisse {
  return { compteCaisse: MODELE.plan.caisse, ouvertures: [], operations: [], mouvements: [], encaissements: [], factures: [], ...o }
}

function operation(o: Partial<OperationDeLaCaisse>): OperationDeLaCaisse {
  return {
    id: 'o', genre: 'apport', date: '2026-03-01', montant: 200, retire_le: null, origine: 'cabinet', cree_par: 'chef',
    remplace_id: null, categorie_id: null, taux_tva: null, encaissements_du_jour: null, piece_id: null, ...o,
  }
}

function piece(o: Partial<PieceDuPaiement>): PieceDuPaiement {
  return { id: 'qa', type_piece: 'achat', statut: 'validee', montant_ttc: 100, devise: 'EUR', exemplaire: null, paiementsDuReleve: [], ...o }
}

// La caisse de l'essai (XQ) : 200 € apportés le 01/03, l'achat QA payé par le chef le 05/03 (100 €, la pièce validée), l'achat QB
// payé par le client le 06/03 (40 €), la vente QV encaissée le 07/03 (80 €), un prélèvement de 120 € le 08/03 — 20 € à la fin.
const OPERATIONS: OperationDeLaCaisse[] = [
  operation({ id: 'apport' }),
  operation({ id: 'pa', genre: 'paiement', date: '2026-03-05', montant: -100, piece_id: 'qa' }),
  operation({ id: 'pb', genre: 'paiement', date: '2026-03-06', montant: -40, piece_id: 'qb', origine: 'client', cree_par: 'client' }),
  operation({ id: 'pv', genre: 'paiement', date: '2026-03-07', montant: 80, piece_id: 'qv' }),
  operation({ id: 'prel', genre: 'prelevement', date: '2026-03-08', montant: 120 }),
]
const PIECES: PieceDuPaiement[] = [
  piece({}), piece({ id: 'qb', statut: 'a_valider', montant_ttc: 40 }), piece({ id: 'qv', type_piece: 'vente', montant_ttc: 80 }),
]

function dossier(o: Partial<DossierDeLaCaisse> = {}): DossierDeLaCaisse {
  return {
    quiEcrit: 'cabinet', utilisateur: 'chef', modele: MODELE, assujetti: false, aujourdhui: AUJOURDHUI, ouverture: null,
    anneesValidees: [], categories: [], caisse: caisse({ operations: OPERATIONS }), natureDesRecettesDuClient: null, ...o,
  }
}

const juger = (operationId: string | null, date: string | null, montant: number | null, d: DossierDeLaCaisse = dossier()) =>
  jugerLaCorrectionSelon(true, operationId, { date, montant }, d, PIECES, '2026-11-04T10:00:00Z', 'nouveau')
const refusDit = (j: ReturnType<typeof juger>) => (j.etat === 'refuse' ? `${j.refus.code} ${j.refus.message}` : j.etat)

describe('le drapeau', () => {
  it('baissé, rien ne se juge ni ne s’offre ; levé, la correction se juge', () => {
    const saisie = { date: '2026-03-04', montant: -100 }
    expect(jugerLaCorrectionSelon(false, 'pa', saisie, dossier(), PIECES, 'i', 'n')).toEqual({ etat: 'absent' })
    expect(jugerLaCorrectionDuClientSelon(false, 'pb', saisie, dossier(), [], 'i', 'n')).toEqual({ etat: 'absent' })
    expect(jugerLaCorrectionSelon(true, 'pa', saisie, dossier(), PIECES, 'i', 'n').etat).toBe('accepte')
    expect(jugerLaCorrection('pa', saisie, dossier(), PIECES, 'i', 'n').etat).toBe(CORRECTION_DU_PAIEMENT_EXPORTEE ? 'accepte' : 'absent')
    const paiement = OPERATIONS[1]
    expect(correctionOfferteSelon(false, paiement)).toBe(false)
    expect(correctionOfferteSelon(true, paiement)).toBe(true)
    expect(correctionOfferte(paiement)).toBe(CORRECTION_DU_PAIEMENT_EXPORTEE)
    // Ni un paiement retiré, ni une autre opération.
    expect(correctionOfferteSelon(true, { ...paiement, retire_le: '2026-03-09T08:00:00Z' })).toBe(false)
    expect(correctionOfferteSelon(true, OPERATIONS[0])).toBe(false)
  })
})

describe('la correction, jugée par le module comme la base la juge', () => {
  it('l’ordre écrit une fois : les cinq du retrait, le genre, puis ceux du paiement d’une pièce', () => {
    expect(ORDRE_DE_LA_CORRECTION).toEqual([
      'operation_inconnue', 'operation_du_cabinet', 'operation_d_un_autre_acces', 'operation_retiree', 'frontiere', 'pas_un_paiement',
      ...ORDRE_DU_PAIEMENT.regler_piece_par_la_caisse,
    ])
    expect(MOTS_DE_LA_CORRECTION.pas_un_paiement.code).toBe('22023')
  })

  it('l’accès, puis l’ancien : inconnu, du cabinet ou d’un autre accès pour le client, retiré, figé, puis son genre', () => {
    expect(refusDit(juger('pa', '2026-03-04', -100, dossier({ quiEcrit: null })))).toBe(`42501 ${MOTS_DE_LA_CAISSE.acces.gabarit}`)
    expect(refusDit(juger('inconnue', '2026-03-04', -100))).toBe(`P0002 ${MOTS_DE_LA_CAISSE.operation_inconnue.gabarit}`)
    expect(refusDit(juger(null, null, null))).toBe(`P0002 ${MOTS_DE_LA_CAISSE.operation_inconnue.gabarit}`)
    const client = dossier({ quiEcrit: 'client', utilisateur: 'client' })
    expect(refusDit(juger('pa', '2026-03-04', -100, client))).toBe(`42501 ${MOTS_DE_LA_CAISSE.operation_du_cabinet.gabarit}`)
    expect(refusDit(juger('pb', '2026-03-04', -40, dossier({ quiEcrit: 'client', utilisateur: 'un-autre' }))))
      .toBe(`42501 ${MOTS_DE_LA_CAISSE.operation_d_un_autre_acces.gabarit}`)
    const retire = dossier({ caisse: caisse({ operations: OPERATIONS.map((o) => (o.id === 'pa' ? { ...o, retire_le: 'x' } : o)) }) })
    expect(refusDit(juger('pa', '2026-03-04', -100, retire))).toBe(`P0002 ${MOTS_DE_LA_CAISSE.operation_retiree.gabarit}`)
    expect(refusDit(juger('pa', '2027-03-04', -100, dossier({ anneesValidees: [2026] }))))
      .toBe('23514 L\'exercice 2026 est validé : sa caisse ne change plus.')
    expect(refusDit(juger('apport', null, null))).toBe(`22023 ${MOTS_DE_LA_CORRECTION.pas_un_paiement.gabarit}`)
    // Le client corrige le sien : accepté.
    expect(juger('pb', '2026-03-03', -40, client).etat).toBe('accepte')
  })

  it('le nouveau, de la même pièce, sous les refus du paiement : la date, le montant, le sens', () => {
    expect(refusDit(juger('pa', null, -100))).toBe(`22023 ${MOTS.date_absente.gabarit}`)
    expect(refusDit(juger('pa', '2026-03-04', 0))).toBe(`22023 ${MOTS.montant_nul.gabarit}`)
    expect(refusDit(juger('pa', '2026-03-04', 100))).toBe(`22023 ${MOTS.sens.gabarit}`)
    expect(refusDit(juger('pa', '2026-11-05', -100))).toBe('22023 Une opération de caisse ne se date pas dans l\'avenir : nous sommes le 04/11/2026.')
    expect(refusDit(juger('pa', '2025-12-31', -100, dossier({ ouverture: '2026-01-01' }))))
      .toBe('22023 Cette opération précède l\'ouverture du dossier, le 01/01/2026 : elle est dans les comptes repris.')
  })

  it('le plafond et le reste au centime ne comptent plus l’ancien : le même montant à un autre jour passe', () => {
    expect(juger('pa', '2026-03-04', -100).etat).toBe('accepte')
    expect(refusDit(juger('pa', '2026-03-04', -100.01))).toBe(`22023 ${MOTS_DU_PAIEMENT.au_dela.gabarit}`)
    expect(refusDit(juger('pa', '2026-03-05', -99.99))).toBe('22023 Ce paiement laisserait 0,01 € à régler sur cette pièce : sous '
      + 'l\'écart où une pièce se dit réglée, son écriture ne s\'équilibrerait pas. Le montant exact qui la règle est une sortie de 100,00 € '
      + '— ou corrige d\'abord le montant de la pièce.')
    expect(refusDit(juger('pb', '2026-03-06', -39.99, dossier({ quiEcrit: 'client', utilisateur: 'client' }))))
      .toBe(`22023 ${MOTS_DU_PAIEMENT.au_centime_client.gabarit}`)
  })

  it('la caisse : le nouveau qui la viderait, sous ses mots ; l’ancien qui l’apportait, sous ceux de son retrait ; un instant sous zéro passe', () => {
    expect(refusDit(juger('pa', '2026-02-28', -100))).toBe('23514 Ce paiement de 100,00 € rendrait la caisse négative le 28/02/2026 '
      + '(−100,00 €) : saisis d\'abord les recettes en espèces qui le précèdent ; si tu as payé de ta poche, ce n\'est pas la caisse : c\'est '
      + 'une note de frais.')
    expect(refusDit(juger('pv', '2026-03-09', 80))).toBe('23514 Retirer ce paiement de 80,00 € rendrait la caisse négative le 08/03/2026 '
      + '(−60,00 €) : retire d\'abord les sorties d\'espèces qui le suivent.')
    // Avancé au 06/03 : sans l'ancien ni le nouveau, le 08/03 serait à −60 € ; avec le nouveau, 20 €.
    expect(juger('pv', '2026-03-06', 80).etat).toBe('accepte')
  })

  it('ce qui s’écrit : le nouveau de la même pièce, son lien, son origine ; l’ancien retiré ; la caisse qui en résulte', () => {
    const j = juger('pb', '2026-03-03', -40, dossier({ quiEcrit: 'client', utilisateur: 'client' }))
    expect(j.etat).toBe('accepte')
    if (j.etat !== 'accepte') return
    expect(j.ancien.id).toBe('pb')
    expect(j.operation).toEqual({
      id: 'nouveau', genre: 'paiement', date: '2026-03-03', montant: -40, categorie_id: null, taux_tva: null,
      encaissements_du_jour: null, piece_id: 'qb', origine: 'client', cree_par: 'client', remplace_id: 'pb', retire_le: null,
    })
    expect(j.caisse.operations.find((o) => o.id === 'pb')?.retire_le).toBe('2026-11-04T10:00:00Z')
    expect(j.caisse.operations.filter((o) => o.id === 'nouveau')).toEqual([j.operation])
  })

  it('la branche du client ne lit ni le montant de la pièce ni sa désignation : la base juge le reste au centime après le clic', () => {
    const pieces: PieceDuPaiementDuClient[] = [{ id: 'qb', type_piece: 'achat', especesEntrent: false }]
    const client = dossier({ quiEcrit: 'client', utilisateur: 'client' })
    const saisie = { date: '2026-03-06', montant: -39.99 }
    expect(jugerLaCorrectionDuClientSelon(true, 'pb', saisie, client, pieces, 'i', 'n').etat).toBe('accepte')
    expect(jugerLaCorrectionDuClientSelon(true, 'pb', { ...saisie, montant: 39.99 }, client, pieces, 'i', 'n'))
      .toEqual({ etat: 'refuse', refus: { code: '22023', message: MOTS.sens.gabarit } })
    expect(jugerLaCorrectionDuClientSelon(true, 'pb', saisie, client, [], 'i', 'n'))
      .toEqual({ etat: 'refuse', refus: { code: 'P0002', message: MOTS.piece_inconnue.gabarit } })
  })

  it('une correction sans changement — le même jour, le même montant au centime — : la règle du formulaire', () => {
    const ancien = { date: '2026-03-05', montant: -100 }
    expect(correctionSansChangement(ancien, { date: '2026-03-05', montant: -100 })).toBe(true)
    expect(correctionSansChangement(ancien, { date: '2026-03-05', montant: -100.0 })).toBe(true)
    expect(correctionSansChangement(ancien, { date: '2026-03-04', montant: -100 })).toBe(false)
    expect(correctionSansChangement(ancien, { date: '2026-03-05', montant: -99.99 })).toBe(false)
    expect(correctionSansChangement(ancien, { date: '2026-03-05', montant: -100.001 })).toBe(false)
    expect(correctionSansChangement(ancien, { date: '2026-03-05', montant: null })).toBe(false)
  })
})

describe('la caisse jamais négative après une correction acceptée — une batterie tirée', () => {
  it('sur 3 000 caisses tirées, toute correction acceptée laisse une caisse qui ne passe jamais sous zéro', () => {
    const suivant = tirage(20261104)
    let acceptees = 0
    let refusees = 0
    for (let n = 0; n < 3000; n++) {
      // Une caisse tirée, jamais négative au départ : des apports, des prélèvements, des paiements d'achats et de ventes.
      const operations: OperationDeLaCaisse[] = []
      const pieces: PieceDuPaiement[] = []
      for (let k = 0; k < 2 + entierTire(suivant, 6); k++) {
        const jour = `2026-03-${String(1 + entierTire(suivant, 20)).padStart(2, '0')}`
        const centimes = 100 + entierTire(suivant, 20000)
        const genre = (['apport', 'prelevement', 'paiement', 'paiement'] as const)[entierTire(suivant, 4)]
        if (genre === 'paiement') {
          const vente = entierTire(suivant, 2) === 0
          const id = `q${k}`
          pieces.push(piece({ id, type_piece: vente ? 'vente' : 'achat', statut: 'a_valider', montant_ttc: null }))
          operations.push(operation({ id: `p${k}`, genre, date: jour, montant: (vente ? 1 : -1) * centimes / 100, piece_id: id }))
        } else {
          operations.push(operation({ id: `o${k}`, genre, date: jour, montant: centimes / 100 }))
        }
        if (premierJourNegatif(caisse({ operations })) != null) operations.pop()
      }
      const paiements = operations.filter((o) => o.genre === 'paiement')
      if (paiements.length === 0) continue
      const ancien = paiements[entierTire(suivant, paiements.length)]
      const centimes = 100 + entierTire(suivant, 20000)
      const date = `2026-03-${String(1 + entierTire(suivant, 20)).padStart(2, '0')}`
      const signe = Math.sign(ancien.montant)
      const d = dossier({ caisse: caisse({ operations }) })
      const j = jugerLaCorrectionSelon(true, ancien.id, { date, montant: signe * centimes / 100 }, d, pieces, 'i', 'nouveau')
      if (j.etat === 'accepte') {
        acceptees++
        expect(premierJourNegatif(j.caisse), `tirage ${n}`).toBeNull()
        expect(j.caisse.operations.filter((o) => o.retire_le == null && o.genre === 'paiement' && o.piece_id === ancien.piece_id))
          .toEqual([j.operation])
      } else {
        refusees++
        expect(j.etat).toBe('refuse')
      }
    }
    // Le plancher qui sépare « tout juste » d'« aveugle » : des deux issues, en nombre.
    expect(acceptees).toBeGreaterThan(500)
    expect(refusees).toBeGreaterThan(100)
  })
})

describe('les moteurs ne comptent que le paiement vivant : un paiement corrigé ne compte jamais deux fois', () => {
  it('l’ancien, retiré par la base, et le nouveau qui le remplace : un seul paiement de la pièce, celui du nouveau', () => {
    const operations = [
      { id: 'ancien', genre: 'paiement' as const, piece_id: 'qa', date: '2026-03-05', montant: -100, retire_le: '2026-03-09T08:00:00Z', remplace_id: null },
      { id: 'nouveau', genre: 'paiement' as const, piece_id: 'qa', date: '2026-03-04', montant: -100, retire_le: null, remplace_id: 'ancien' },
    ]
    const parts = paiementsParLaCaisseSelon(true, operations)
    expect(parts).toEqual([{ operation_caisse_id: 'nouveau', piece_id: 'qa', date: '2026-03-04', montant: -100 }])
    const parPiece = paiementsDesPieces([], [], [], parts)
    expect(parPiece.get('qa')?.map((p) => ('operation_caisse_id' in p ? p.operation_caisse_id : null))).toEqual(['nouveau'])
    // Et même si la base n'avait pas retiré l'ancien (une restauration fautive) : désigné par le nouveau, il ne compte pas.
    const fautif = paiementsParLaCaisseSelon(true, operations.map((o) => ({ ...o, retire_le: null })))
    expect(fautif.map((p) => p.operation_caisse_id)).toEqual(['nouveau'])
  })
})

describe('les essais jouent la migration, et attendent sans elle', () => {
  it('caisse.sql : les contrôles 270 à 289 sous le genre « …6 », 162 sous « …46h », la ligne EN ATTENTE', () => {
    const essai = lire('supabase/essais/caisse.sql')
    const etapes = [...essai.matchAll(/\n {4}array\['(\w+)', '(\d+)[a-z]*\. /g)].map((m) => ({ genre: m[1], numero: Number(m[2]) }))
    const neuves = etapes.filter((e) => e.numero >= 270 && e.numero <= 289)
    expect(neuves.length).toBeGreaterThanOrEqual(80)
    expect(neuves.every((e) => /6$/.test(e.genre)), neuves.filter((e) => !/6$/.test(e.genre)).map((e) => e.numero).join(',')).toBe(true)
    expect(essai).toContain("array['valeur46h', '162. … avec elle, le paiement d''une pièce aussi (sans la migration de C12B-Q1)'")
    expect(essai).toContain("c12 boolean := to_regprocedure('public.remplacer_paiement_par_la_caisse(uuid, uuid, date, numeric)') is not null;")
    expect(essai).toContain("'270. EN ATTENTE de la migration correction_du_paiement_par_la_caisse (C12B-Q1) : '")
    // Chaque refus propre à la fonction y est attendu, sous son code, mots pour mots ; et ceux du paiement qu'elle délègue.
    for (const cle of [...ORDRE_DES_REFUS.retirer_operation_caisse.filter((c) => c !== 'frontiere'), 'pas_un_paiement'] as const) {
      const mot = cle === 'pas_un_paiement' ? MOTS_DE_LA_CORRECTION.pas_un_paiement : MOTS_DE_LA_CAISSE[cle]
      expect(essai, cle).toContain(`'${mot.code}', '${mot.gabarit.replace(/'/g, "''")}'`)
    }
    for (const cle of ['tresorerie', 'date_absente', 'date_avant_2000', 'montant_absent', 'montant_centime', 'montant_nul', 'montant_borne',
      'sens', 'au_dela', 'au_centime_client'] as const) {
      expect(essai, cle).toContain(`'${MOTS[cle].code}', '${MOTS[cle].gabarit.replace(/'/g, "''")}'`)
    }
  })

  it('rls.sql : le bloc CQ, EN ATTENTE sans la migration ; le filet de la validation joue un paiement corrigé', () => {
    const rls = lire('supabase/essais/rls.sql')
    expect(rls).toContain('-- ══ CQ. Corriger un paiement par la caisse (C12B-Q1')
    expect(rls).toContain("if to_regprocedure('public.remplacer_paiement_par_la_caisse(uuid, uuid, date, numeric)') is null then")
    expect(rls).toContain("'CQ. corriger un paiement par la caisse : EN ATTENTE de la migration correction_du_paiement_par_la_caisse'")
    const filet = lire('supabase/essais/validationDesPaiementsParLaCaisse.sql')
    expect(filet).toContain('remplacer_paiement_par_la_caisse(')
  })
})

describe('les mots du remède, selon le drapeau', () => {
  it('baissé : ceux d’hier, au caractère près ; levé : la correction, depuis la fiche de la pièce', () => {
    expect(motsDuRemedeSelon(false)).toEqual({
      pastille: 'Se retire depuis la fiche de la pièce',
      aideDuClient: 'Pour corriger un paiement, retire-le puis enregistre le bon.',
      finDuRetraitDuClient: 'Pour le corriger, retire-le puis enregistre le bon.',
      detail: 'Dans l’onglet Caisse, retirer le paiement, puis le saisir de nouveau depuis la fiche de la pièce, au montant exact — '
        + 'ou corriger la pièce.',
      prealable: 'Retirer le paiement, puis le saisir de nouveau au montant exact — ou corriger la pièce — avant la validation.',
      point: 'à retirer, puis à saisir de nouveau',
    })
    const hier = motsDuRemedeSelon(false) as Record<string, string>
    const leve = motsDuRemedeSelon(true) as Record<string, string>
    expect(Object.keys(leve)).toEqual(Object.keys(hier))
    for (const cle of Object.keys(leve)) expect(leve[cle], cle).not.toBe(hier[cle])
    // Ce que le client lit : tutoyé, aucune forme du cabinet ; ce que le cabinet lit ne renvoie plus à l'onglet Caisse, qui
    // n'offre aucun geste sur un paiement.
    expect(motsDuCabinet(leve.aideDuClient)).toEqual([])
    expect(motsDuCabinet(leve.finDuRetraitDuClient)).toEqual([])
    expect(leve.detail).not.toMatch(/onglet Caisse/)
    expect(leve.detail).toContain('fiche de la pièce')
  })

  it('aucun écran n’écrit plus les mots d’hier en dur : ils ne vivent que dans la table, que chaque écran lit', () => {
    const racine = new URL('../', import.meta.url).pathname
    const sources = readdirSync(racine, { recursive: true }).map(String)
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.startsWith('test/'))
    expect(sources.length).toBeGreaterThan(300)
    const hier = Object.values(motsDuRemedeSelon(false) as Record<string, string>)
    const fautifs = sources.filter((f) => !f.endsWith('lib/correctionDuPaiement.ts'))
      .filter((f) => { const t = readFileSync(racine + f, 'utf8'); return hier.some((m) => t.includes(m)) })
    expect(fautifs).toEqual([])
    // Et la table est lue là où ces mots se disent.
    for (const [fichier, cle] of [
      ['pages/dossier/CaisseTab.tsx', 'pastille'], ['pages/PaiementParMaCaisse.tsx', 'aideDuClient'],
      ['lib/paiementDeMesPieces.ts', 'finDuRetraitDuClient'], ['lib/controlesDeLaCaisse.ts', 'detail'],
      ['lib/prealablesValidation.ts', 'prealable'], ['lib/pointsDeLaChecklist.ts', 'point'],
    ] as const) {
      expect(readFileSync(racine + fichier, 'utf8'), fichier).toContain(`motsDuRemedeSelon(CORRECTION_DU_PAIEMENT_EXPORTEE).${cle}`)
    }
  })
})

describe('la fiche d’une pièce, côté cabinet (lib/paiementParLaCaisseEcran.ts)', () => {
  const ops = (): OperationCaisse[] => OPERATIONS.map((o) => ({
    ...o, dossier_id: 'd', cree_le: '2026-03-01T08:00:00Z', retire_par: null,
  } as OperationCaisse))
  const donnees = (): DonneesDeLaCaisse => ({
    operations: ops(), ouvertures: [], mouvements: [], especes: { etat: 'sans_objet' }, categories: [], piecesPayees: [],
  })
  const ctx = { modele: MODELE, assujettiTva: false, aujourdhui: AUJOURDHUI, anneesValidees: [] as number[] }
  const pa = () => ops().find((o) => o.id === 'pa')!

  it('selon le drapeau : baissé, rien ne s’offre et le verdict est absent ; levé, la correction s’offre et se juge', () => {
    const offerte = correctionDeLaFiche(pa(), ctx, donnees())
    const verdict = verdictDeLaCorrection({ date: '2026-03-04', montant: '-100' }, pa(), ctx, donnees(), PIECES[0])
    if (CORRECTION_DU_PAIEMENT_EXPORTEE) {
      expect(offerte).toEqual({ offerte: true, refus: null })
      expect(verdict.etat).toBe('permis')
    } else {
      expect(offerte).toEqual({ offerte: false })
      expect(verdict).toEqual({ etat: 'absent' })
    }
  })

  it('le formulaire s’ouvre sur le jour et le montant signé du paiement', () => {
    expect(formulaireDeLaCorrection(pa())).toEqual({ date: '2026-03-05', montant: '-100,00' })
    expect(formulaireDeLaCorrection({ date: '2026-03-07', montant: 80 })).toEqual({ date: '2026-03-07', montant: '80,00' })
    expect(formulaireDeLaCorrection({ date: '2026-03-07', montant: -0.5 })).toEqual({ date: '2026-03-07', montant: '-0,50' })
  })
})
