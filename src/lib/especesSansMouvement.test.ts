import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { etapesDeLEssai, rejouerLEssai } from '../test/essaiCaisse'
import { codesSql, messagesSql } from '../test/raiseSql'
import { derniereDefinitionSql, fichiersDuSchema, fichiersPrepares } from '../test/schema'
import {
  MOYENS_ENCAISSEMENT, MOYENS_SANS_CREDIT, REFUS_ENREGISTREMENT, REFUS_ESPECES_SUR_UN_CREDIT, REFUS_RATTACHEMENT,
  moyenSansCredit, moyenSurUnCredit, moyensOfferts, rattachableApresLaFrontiere, refusEnregistrement, refusEnregistrementVente,
  refusRattachement,
  type ContexteFacture, type ContexteVente, type EncaissementPourRattachement, type FactureDuDossier, type FacturePourEncaissement,
  type LigneDeFacture, type MouvementClasse, type SaisieEncaissement,
} from './encaissementsFactures'

// LA CAISSE : LE RESSERREMENT (ligne 26.6, étape C6 ; MVP-D2). La migration `especes_sans_mouvement` — PRÉPARÉE dans
// supabase/preparees/, pas encore appliquée ; elle entrera dans l'export, texte inchangé, sous la version de sa ligne
// d'historique — reprend la garde des encaissements (`garder_encaissement_facture`) telle que
// `contre_passation_sur_mouvement_fige` l'a laissée, et n'y fait qu'INSÉRER une règle : un encaissement en espèces ne cite
// aucun crédit, de toute facture, à l'insertion comme au rattachement, la restauration exceptée. Ce garde la confronte à
// l'export au caractère près ; relit dans son texte les mots, le code et la règle que le module redit
// (lib/encaissementsFactures.ts : `REFUS_ESPECES_SUR_UN_CREDIT`, `MOYENS_SANS_CREDIT`, `moyenSurUnCredit`) ; dit qu'aucune
// fonction ne la juge, si bien que le module la place APRÈS tous leurs refus ; confronte son retour arrière
// (supabase/preparees/retour/) ; et l'essai (supabase/essais/caisse.sql, 170 à 179, et 60bb et 74c). Récit : HISTORIQUE.md,
// « LA CAISSE : LE RESSERREMENT (C6, LIGNE 26.6) (PRÉPARÉE, PAS APPLIQUÉE) ». Données FICTIVES.

const GARDE = 'garder_encaissement_facture'
const MIGRATION = /\/\d{14}_especes_sans_mouvement\.sql$/
const md5 = (texte: string) => createHash('md5').update(texte, 'utf8').digest('hex')
const corps = (definition: string) => definition.slice(definition.indexOf('as $$') + 'as $$'.length)
const nomDuFichier = (chemin: string) => chemin.split('/').pop() as string

// La migration, où qu'elle soit : préparée aujourd'hui, dans l'export le jour de son application.
function laMigration(): { chemin: string; texte: string } {
  const f = [...fichiersPrepares(), ...fichiersDuSchema()].find((x) => MIGRATION.test(x.chemin))
  expect(f, 'la migration especes_sans_mouvement, préparée ou dans l’export').toBeDefined()
  return f as { chemin: string; texte: string }
}

// La définition que son texte donne à la garde.
function definitionPosee(texte = laMigration().texte): string {
  const debut = texte.indexOf(`create or replace function public.${GARDE}(`)
  expect(debut).toBeGreaterThan(0)
  return texte.slice(debut, texte.indexOf('$$;', debut))
}

// La définition de la garde que la migration reprend : la dernière de l'export AVANT elle — celle que la production exécute
// tant qu'elle n'est pas appliquée.
function avantLaMigration(): { chemin: string; definition: string } {
  const motif = new RegExp(`create (or replace )?function public\\.${GARDE}\\(`, 'g')
  const nom = nomDuFichier(laMigration().chemin)
  const avant = fichiersDuSchema().filter((f) => nomDuFichier(f.chemin) < nom && new RegExp(motif.source).test(f.texte))
  const { chemin, texte } = avant[avant.length - 1]
  const debut = [...texte.matchAll(motif)].pop()?.index as number
  return { chemin, definition: texte.slice(debut, texte.indexOf('$$;', debut)) }
}

// Le retour arrière, dans supabase/preparees/retour/ : la garde d'hier rendue, sous sa propre garde de tête.
function leRetour(): string {
  const dossier = new URL('../../supabase/preparees/retour/', import.meta.url).pathname
  expect(existsSync(dossier), 'supabase/preparees/retour/').toBe(true)
  const nom = readdirSync(dossier).find((n) => /^\d{14}_retour_especes_sans_mouvement\.sql$/.test(n))
  expect(nom, 'le retour arrière d’especes_sans_mouvement').toBeDefined()
  return readFileSync(dossier + nom, 'utf8')
}

// La règle neuve : ses lignes de CODE au caractère près, précédées dans la garde de leurs lignes de commentaire.
const REGLE = [
  "    if v_ligne.moyen = 'especes'",
  "       and not (tg_op = 'INSERT' and v_ligne.cree_le < now() and public.is_super_admin()) and exists (",
  '         select 1 from public.lignes_bancaires l',
  '          where l.id = v_ligne.ligne_bancaire_id and l.montant > 0) then',
  "      raise exception 'Un encaissement en espèces ne cite aucun crédit du relevé : il s''enregistre sans mouvement, et le dépôt des espèces en banque se classe à part.'",
  "        using errcode = '23514';",
  '    end if;',
]
// Ce qui la précède dans la garde : la règle qui veut un crédit pour un encaissement, un débit pour une contre-passation.
const AVANT_ELLE = [
  "        raise exception 'Une contre-passation se justifie par un débit de son dossier.' using errcode = '23514';",
  '      end if;',
  '    end if;',
]

// Où commence une règle dans les lignes d'une définition : la première de ses lignes de code, puis, en remontant, ses
// lignes de commentaire à la même indentation. Rend [début, fin) ; null si le code n'y est pas une fois, exactement.
function bornes(lignes: string[], code: string[]): [number, number] | null {
  const departs = lignes.map((_, i) => i).filter((i) => code.every((l, k) => lignes[i + k] === l))
  if (departs.length !== 1) return null
  const retrait = code[0].match(/^ */)?.[0] ?? ''
  let debut = departs[0]
  while (debut > 0 && lignes[debut - 1].startsWith(`${retrait}-- `)) debut--
  return [debut, departs[0] + code.length]
}

// La définition sans la règle insérée ; null si elle n'y est pas exactement une fois.
function sansLaRegle(definition: string): string | null {
  const lignes = definition.split('\n')
  const b = bornes(lignes, REGLE)
  if (!b) return null
  return lignes.filter((_, i) => !(i >= b[0] && i < b[1])).join('\n')
}

describe('la migration especes_sans_mouvement reprend la garde des encaissements, et n’y fait qu’insérer une règle', () => {
  it('sa garde de tête exige, avant toute définition, le corps que contre_passation_sur_mouvement_fige a posé, celui de l’export', () => {
    const texte = laMigration().texte
    const hier = avantLaMigration()
    expect(hier.chemin).toMatch(/\/20261027055337_contre_passation_sur_mouvement_fige\.sql$/)
    expect(md5(corps(hier.definition))).toBe('16af585818378356e7b4e58521dbe665')
    const premiereDefinition = texte.indexOf('create or replace function')
    expect(texte.indexOf("<> '16af585818378356e7b4e58521dbe665' then")).toBeGreaterThan(0)
    expect(texte.indexOf("<> '16af585818378356e7b4e58521dbe665' then")).toBeLessThan(premiereDefinition)
    expect(texte).toContain(`if to_regprocedure('public.${GARDE}()') is null`)
    expect(texte).toContain(`where p.oid = to_regprocedure('public.${GARDE}()')), chr(13), ''))`)
  })

  it('la garde est celle d’hier au caractère près, une règle en plus, juste après celle qui veut un crédit ou un débit', () => {
    const posee = definitionPosee()
    expect(sansLaRegle(posee)).toBe(avantLaMigration().definition)
    const lignes = posee.split('\n')
    const [debut, fin] = bornes(lignes, REGLE) as [number, number]
    expect(lignes.slice(debut - AVANT_ELLE.length, debut)).toEqual(AVANT_ELLE)
    expect(lignes[debut]).toMatch(/^ {4}-- Un encaissement EN ESPÈCES ne cite aucun crédit, de toute facture/)
    expect(lignes[fin]).toMatch(/^ {4}-- La restauration \(le super-administrateur insère\) réinsère ce qui a été/)
    // Dans le bloc du mouvement cité, que la garde ne remplit qu'à l'insertion et au rattachement (`v_ligne`).
    const sql = lignes.join('\n')
    expect(sql.indexOf(REGLE[0])).toBeGreaterThan(sql.indexOf('  if v_ligne.ligne_bancaire_id is not null then'))
    expect(sql).toContain("    v_ligne := new;\n  else\n")
  })

  it('la règle : un moyen sans crédit — ceux du module —, un crédit, de toute facture ; la porte de la restauration, celle de la caisse', () => {
    expect(REGLE[0]).toBe(`    if v_ligne.moyen = '${MOYENS_SANS_CREDIT[0]}'`)
    expect(MOYENS_SANS_CREDIT).toEqual(['especes'])
    expect(REGLE[3]).toContain('l.montant > 0')
    // Ni la facture source, ni le mouvement libre : toute facture, tout crédit.
    expect(REGLE.join('\n')).not.toMatch(/v_source|mouvement_libre|encaissements_de_factures/)
    // La porte de la caisse (`garder_la_caisse`) : une ligne RÉINSÉRÉE par le super-administrateur, son instant de création
    // d'avant la transaction ; et à l'insertion seulement — la restauration ne rattache pas.
    expect(derniereDefinitionSql('garder_la_caisse')).toContain("if tg_op = 'INSERT' and v_cree < now() and public.is_super_admin()")
    expect(REGLE[1]).toBe("       and not (tg_op = 'INSERT' and v_ligne.cree_le < now() and public.is_super_admin()) and exists (")
    // `cree_le` prend `now()` par défaut, qu'aucune fonction ne donne : la ligne d'une fonction naît dans la transaction.
    const migrations = fichiersDuSchema().map((f) => f.texte).join('\n')
    expect(migrations).toMatch(/create table public\.encaissements_factures \([\s\S]*?cree_le timestamptz not null default now\(\)/)
    for (const f of ['enregistrer_encaissement', 'annuler_encaissement']) {
      const insertion = derniereDefinitionSql(f).match(/insert into public\.encaissements_factures \(([^)]*)\)/)
      expect(insertion?.[1], f).not.toMatch(/cree_le/)
    }
  })

  it('les mots et le code : ceux que le module redit ; un refus de plus, après celui du débit, rien d’autre ne bouge', () => {
    const hier = avantLaMigration().definition
    const demain = definitionPosee()
    expect(messagesSql(REGLE.join('\n'))).toEqual([REFUS_ESPECES_SUR_UN_CREDIT.modele])
    expect(codesSql(REGLE.join('\n'))).toEqual([REFUS_ESPECES_SUR_UN_CREDIT.code])
    const messages = messagesSql(demain)
    const i = messages.indexOf(REFUS_ESPECES_SUR_UN_CREDIT.modele)
    expect(messages.filter((m) => m === REFUS_ESPECES_SUR_UN_CREDIT.modele)).toHaveLength(1)
    expect(messages.toSpliced(i, 1)).toEqual(messagesSql(hier))
    expect(codesSql(demain).toSpliced(i, 1)).toEqual(codesSql(hier))
    expect(messages[i - 1]).toBe('Une contre-passation se justifie par un débit de son dossier.')
    expect(messages[i + 1]).toBe("Un mouvement déjà classé ne se cite pas : l'encaissement d'une facture source de sa vente ne cite qu'un mouvement que rien d'autre ne classe.")
  })

  it('le texte : une seule définition, ni droit rejoué ni objet retiré, aucune barre oblique inverse ni retour chariot', () => {
    const texte = laMigration().texte
    expect(texte.match(/create (or replace )?function/g)).toHaveLength(1)
    expect(texte).toContain(`create or replace function public.${GARDE}() returns trigger`)
    expect(texte).not.toMatch(/\b(grant|revoke|drop|truncate|alter)\b/i)
    expect(texte).not.toMatch(/\b(create|drop)\s+(table|policy|trigger|index|view)\b/i)
    expect(texte).not.toMatch(/\bcomment on\b/i)
    expect(texte).not.toMatch(/\bdelete from\b/i)
    // Le mot « delete » n'y vient que de la garde reprise, qui nomme l'opération qu'elle refuse, comme hier.
    expect(texte.match(/delete/gi)?.length ?? 0).toBe(avantLaMigration().definition.match(/delete/gi)?.length ?? 0)
    expect(texte).not.toContain('\\')
    expect(texte).not.toContain('\r')
  })

  it('vire au rouge sur une dérive plantée : un mot de la garde hors de la règle, la règle changée, un mot du refus', () => {
    const demain = definitionPosee()
    const hier = avantLaMigration().definition
    const mot = demain.replace("'Un encaissement ne se supprime pas", "'Un encaissement ne se retire pas")
    expect(mot).not.toBe(demain)
    expect(sansLaRegle(mot)).not.toBe(hier)
    for (const [de, vers] of [
      ['ligne_bancaire_id and l.montant > 0) then', 'ligne_bancaire_id and l.montant >= 0) then'],
      ["v_ligne.moyen = 'especes'", "v_ligne.moyen in ('especes', 'compensation')"],
      ['v_ligne.cree_le < now() and ', ''], ["using errcode = '23514';\n    end if;\n    -- La restauration", "using errcode = '22023';\n    end if;\n    -- La restauration"],
    ]) {
      const derive = demain.replace(de, vers)
      expect(derive, de).not.toBe(demain)
      expect(sansLaRegle(derive), de).toBeNull()
    }
    expect(messagesSql(demain.replace('se classe à part.', 'se classe ailleurs.'))).not.toContain(REFUS_ESPECES_SUR_UN_CREDIT.modele)
  })
})

describe('le retour arrière : la garde d’hier, au caractère près, sous sa propre garde de tête', () => {
  it('il exige le corps que la migration a posé, et rend celui de contre_passation_sur_mouvement_fige', () => {
    const retour = leRetour()
    const md5Pose = md5(corps(definitionPosee()))
    const premiereDefinition = retour.indexOf('create or replace function')
    expect(retour.indexOf(`<> '${md5Pose}' then`)).toBeGreaterThan(0)
    expect(retour.indexOf(`<> '${md5Pose}' then`)).toBeLessThan(premiereDefinition)
    expect(definitionPosee(retour)).toBe(avantLaMigration().definition)
    expect(retour.match(/create (or replace )?function/g)).toHaveLength(1)
    expect(retour).not.toMatch(/\b(grant|revoke|drop|truncate|alter)\b/i)
    expect(retour).not.toMatch(/\bdelete from\b/i)
    expect(retour).not.toContain('\\')
    expect(retour).not.toContain('\r')
  })
})

// ── Le module : la règle, à sa place dans l'ordre de la base ─────────────────────────────────────────────────────────

const D = 'd1'
const LIGNES: LigneDeFacture[] = [{ facture_id: 'f1', ordre: 1, designation: 'a', quantite: 1, prix_unitaire_ht: 1000, taux_tva: 20 }]

function facture(o: Partial<FacturePourEncaissement> = {}): FacturePourEncaissement {
  return {
    id: 'f1', dossier_id: D, statut: 'validee', type: 'facture', numero: 'F2027-0042', date_emission: '2027-10-01',
    emetteur_siret: '12345678200010', montant_ht: 1000, montant_tva: 200, montant_ttc: 1200, superpdp_invoice_id: null,
    tiers_nom: 'Client Fictif SAS', source_de_la_vente: true, ...o,
  }
}
const contexte = (o: Partial<ContexteFacture> = {}): ContexteFacture => ({
  dossierId: D, facture: facture(), lignes: LIGNES, transmissions: [], evenementsSuperpdp: [], statutsRecus: [], encaissements: [],
  parts: [], ...o,
})
const FACTURES: FactureDuDossier[] = [
  { id: 'f1', dossier_id: D, numero: 'F2027-0042', type: 'facture', statut: 'validee', facture_origine_id: null, source_de_la_vente: true },
]
const vente = (o: Partial<ContexteVente> = {}): ContexteVente => ({ anneesValidees: [], factures: FACTURES, ...o })
const mouvement = (o: Partial<MouvementClasse> = {}): MouvementClasse => ({
  id: 'm1', dossier_id: D, date: '2027-10-15', montant: 1200, statut: 'non_rapprochee', piece_id: null, cotisation_id: null,
  categorie_id: null, emprunt_id: null, compte_bilan: null, declaration_tva_id: null, ventilee: false, reglement_groupe: false,
  prelevement_personnel: false, encaissements_de_factures: false, ...o,
})
const saisie = (o: Partial<SaisieEncaissement> = {}): SaisieEncaissement => ({
  date: '2027-10-15', montant: 1200, moyen: 'especes', ligneBancaireId: 'm1', repartition: [{ taux: 20, montant: 1200 }], ...o,
})
const AUJOURD_HUI = '2027-11-02'
const ESPECES = { cle: REFUS_ESPECES_SUR_UN_CREDIT.cle, message: REFUS_ESPECES_SUR_UN_CREDIT.modele }

describe('le module : aucune fonction ne juge la règle, la garde la refuse après elles — le module, à cette place', () => {
  it('aucune fonction du registre ne la dit : ni enregistrer, ni rattacher, ni leurs listes de refus', () => {
    for (const f of ['enregistrer_encaissement', 'rattacher_mouvement_encaissement', 'annuler_encaissement']) {
      expect(messagesSql(derniereDefinitionSql(f)), f).not.toContain(REFUS_ESPECES_SUR_UN_CREDIT.modele)
    }
    expect(REFUS_ENREGISTREMENT.map((r) => r.cle as string)).not.toContain(REFUS_ESPECES_SUR_UN_CREDIT.cle)
    expect(REFUS_RATTACHEMENT.map((r) => r.cle as string)).not.toContain(REFUS_ESPECES_SUR_UN_CREDIT.cle)
  })

  it('enregistrer : des espèces sur un crédit, le dernier refus — pour une facture source comme pour une autre, hier et la vente', () => {
    const mouvements = [mouvement()]
    expect(refusEnregistrementVente(contexte(), saisie(), mouvements, AUJOURD_HUI, true, vente())).toEqual(ESPECES)
    const autre = contexte({ facture: facture({ source_de_la_vente: false }) })
    expect(refusEnregistrementVente(autre, saisie(), mouvements, AUJOURD_HUI, true, vente())).toEqual(ESPECES)
    expect(refusEnregistrement(autre, saisie(), mouvements, AUJOURD_HUI, true)).toEqual(ESPECES)
    // Sans mouvement, des espèces passent ; un chèque, une carte… sur le même crédit aussi.
    expect(refusEnregistrementVente(contexte(), saisie({ ligneBancaireId: null }), mouvements, AUJOURD_HUI, true, vente())).toBeNull()
    for (const { moyen } of MOYENS_ENCAISSEMENT.filter((m) => m.moyen !== 'especes')) {
      expect(refusEnregistrementVente(contexte(), saisie({ moyen }), mouvements, AUJOURD_HUI, true, vente()), moyen).toBeNull()
    }
  })

  it('enregistrer : chaque refus de la fonction passe d’abord — le mouvement, son écart, un plafond, la frontière, « Banque »', () => {
    const v = vente()
    const juge = (s: SaisieEncaissement, m = [mouvement()], c = contexte(), banque = true, w = v) =>
      refusEnregistrementVente(c, s, m, AUJOURD_HUI, banque, w)?.cle
    expect(juge(saisie(), [mouvement({ montant: -1200 })])).toBe('mouvement_debit')
    expect(juge(saisie(), [mouvement({ dossier_id: 'autre' })])).toBe('mouvement_hors_dossier')
    expect(juge(saisie(), [mouvement({ montant: 1000 })])).toBe('mouvement_depasse')
    expect(juge(saisie(), [mouvement({ statut: 'rapprochee', categorie_id: 'k1' })])).toBe('mouvement_classe')
    expect(juge(saisie({ montant: 1300, repartition: [{ taux: 20, montant: 1300 }] }), [mouvement({ montant: 1300 })])).toBe('plafond_facture_net')
    expect(juge(saisie(), [mouvement()], contexte(), true, vente({ anneesValidees: [2027] }))).toBe('frontiere')
    expect(juge(saisie(), [mouvement()], contexte(), false)).toBe('mouvement_sans_banque')
    expect(juge(saisie({ moyen: 'troc' }))).toBe('moyen_inconnu')
  })

  it('rattacher : des espèces à un crédit, le dernier refus ; un mouvement figé, un débit, l’écart, d’abord', () => {
    const v = vente()
    const r = (e: Partial<EncaissementPourRattachement>, m: Partial<MouvementClasse> = {}, w = v) =>
      refusRattachement(D, 'e1', 'm1', [{
        id: 'e1', dossier_id: D, facture_id: 'f1', montant: 1200, ligne_bancaire_id: null, annule_id: null, retire_le: null,
        date_encaissement: '2027-10-15', moyen: 'especes', ...e,
      }], [mouvement(m)], w)
    expect(r({})).toEqual(ESPECES)
    expect(r({ moyen: 'cheque' })).toBeNull()
    expect(r({}, { montant: -1200 })?.cle).toBe('mouvement_debit')
    expect(r({}, { montant: 1000 })?.cle).toBe('mouvement_depasse')
    expect(r({}, { date: '2026-12-31' }, vente({ anneesValidees: [2026] }))?.cle).toBe('mouvement_fige')
    // Sa contre-passation, de même moyen, sur un débit : la règle ne la juge pas.
    const cp = refusRattachement(D, 'c1', 'm1', [
      { id: 'e0', dossier_id: D, facture_id: 'f1', montant: 1200, ligne_bancaire_id: null, annule_id: null, retire_le: null, date_encaissement: '2027-10-10', moyen: 'especes' },
      { id: 'c1', dossier_id: D, facture_id: 'f1', montant: -1200, ligne_bancaire_id: null, annule_id: 'e0', retire_le: null, date_encaissement: '2027-10-15', moyen: 'especes' },
    ], [mouvement({ montant: -1200 })], v)
    expect(cp).toBeNull()
  })

  it('la règle elle-même : un moyen sans crédit, un mouvement de montant positif', () => {
    expect(moyenSurUnCredit('especes', { montant: 0.01 })).toBe(true)
    expect(moyenSurUnCredit('especes', { montant: 0 })).toBe(false)
    expect(moyenSurUnCredit('especes', { montant: -5 })).toBe(false)
    expect(moyenSurUnCredit('especes', undefined)).toBe(false)
    expect(moyenSurUnCredit('cheque', { montant: 5 })).toBe(false)
    expect(moyenSurUnCredit(null, { montant: 5 })).toBe(false)
    expect(MOYENS_ENCAISSEMENT.filter((m) => moyenSansCredit(m.moyen)).map((m) => m.moyen)).toEqual(['especes'])
    expect(moyenSansCredit(null)).toBe(false)
    expect(moyenSansCredit('')).toBe(false)
  })

  it('les moyens qu’offre la fenêtre : tous, sauf les espèces sur un crédit imposé — dans l’ordre de la base', () => {
    expect(moyensOfferts(false)).toEqual(MOYENS_ENCAISSEMENT)
    expect(moyensOfferts(true).map((m) => m.moyen)).toEqual(['virement', 'cheque', 'carte', 'prelevement', 'effet', 'compensation', 'autre'])
  })

  it('un encaissement en espèces figé ne se dit pas rattachable au crédit qui le paie (étape VF7a)', () => {
    const fige = {
      id: 'e1', dossier_id: D, facture_id: 'f1', montant: 1200, ligne_bancaire_id: null, annule_id: null, retire_le: null,
      date_encaissement: '2026-12-30', moyen: 'cheque' as const,
    }
    expect(rattachableApresLaFrontiere(fige, vente({ anneesValidees: [2026] }))).toBe(true)
    expect(rattachableApresLaFrontiere({ ...fige, moyen: 'especes' }, vente({ anneesValidees: [2026] }))).toBe(false)
  })
})

// ── L'essai : supabase/essais/caisse.sql, 170 à 179 ──────────────────────────────────────────────────────────────────

describe('l’essai exige le refus de la garde, sous ses mots et son code, de chaque chemin — et admet ce qu’elle laisse passer', () => {
  const ESSAI = readFileSync(new URL('../../supabase/essais/caisse.sql', import.meta.url), 'utf8')
  const etapes = etapesDeLEssai(ESSAI)
  const etape = (numero: string) => etapes.find((e) => e.titre.startsWith(`${numero}. `))
  const MOTS = REFUS_ESPECES_SUR_UN_CREDIT.modele

  it('le refus, sous ses mots et son code : par la fonction (chef, client), au rattachement, en direct, sous la session du super-administrateur', () => {
    for (const [n, profil] of [['171', 'chef'], ['171b', 'chef'], ['172', 'client'], ['174', 'chef'], ['175', 'postgres'],
      ['175b', 'postgres'], ['175c', 'postgres'], ['175d', 'postgres'], ['176b', 'chef'], ['176c', 'postgres']] as const) {
      expect(etape(n), n).toMatchObject({ genre: 'controle3', profil, code: '23514', attendu: MOTS })
    }
    expect(etape('171')?.sql).toContain("enregistrer_encaissement('{S6}', f.id, '2026-03-12', 50, 'especes', '{MS1}'")
    expect(etape('171b')?.sql).toContain("'{N6}'")
    expect(etape('174')?.sql).toContain("rattacher_mouvement_encaissement('{S6}'")
    expect(etape('175c')?.sql).toMatch(/^select set_config\('request\.jwt\.claims', json_build_object\('sub', '\{CHEF\}'/)
    // Une ligne d'avant (son instant de création passé), sous la session du super-administrateur : la porte de la
    // restauration ne s'ouvre qu'à l'INSERTION — la mise à jour qui la rattache à un crédit se refuse.
    expect(etape('175d')?.sql).toMatch(/^select set_config\('request\.jwt\.claims', json_build_object\('sub', '\{CHEF\}'/)
    expect(etape('175d')?.sql).toContain("'2026-03-11 09:00:00+00'")
    expect(etape('175d')?.sql).toMatch(/update encaissements_factures set ligne_bancaire_id = '\{MS1\}'/)
    expect(etape('176b')?.sql).not.toContain('cree_le')
    expect(etape('176c')?.sql).toContain("'2026-03-12 10:00:00+00'")
  })

  it('l’ordre : les refus de la fonction d’abord', () => {
    expect(etape('171c')).toMatchObject({ code: '22023', attendu: "Ce mouvement de 50,00 € justifierait 60,00 € d'encaissements : l'écart dépasse ce que des frais bancaires expliquent." })
    expect(etape('171d')).toMatchObject({ code: '22023', attendu: "Un encaissement se justifie par un crédit : ce mouvement n'en est pas un." })
  })

  it('ce qu’elle laisse passer : des espèces sans mouvement, un chèque, la restauration, la contre-passation sur un débit', () => {
    for (const n of ['172b', '172c', '172d', '174b', '176', '177', '178b']) {
      expect(etape(n), n).toMatchObject({ genre: 'controle3', code: 'OK' })
    }
    expect(etape('176')?.sql).toContain("'2026-03-12 10:00:00+00'")
    expect(etape('177')?.sql).toContain("annuler_encaissement('{S6}', e.id, '2026-03-20', 'ESSAI C6', '{MS3}')")
    expect(etape('178b')?.sql).toContain("rattacher_mouvement_encaissement('{S6}', a.id, '{MS3}')")
  })

  it('sans la migration, ses étapes attendent ; avec elle, celle qu’elle remplace (74c) se tait', () => {
    expect(ESSAI).toContain("prosrc like '%Un encaissement en espèces ne cite aucun crédit du relevé%'")
    expect(ESSAI).toContain("'170. EN ATTENTE de la migration especes_sans_mouvement (étape C6) : '")
    const c74 = etapes.filter((e) => e.titre.startsWith('74c. '))
    expect(c74.map((e) => [e.genre, e.code])).toEqual([['controle3h', '23514'], ['controle3', '23514']])
    expect(c74[1].attendu).toBe(MOTS)
    expect(c74[0].sql).toBe(c74[1].sql)
    // Les espèces que le crédit du 12/03 a remises naissent par la restauration, avec ou sans la migration.
    expect(etape('60bb')).toMatchObject({ genre: 'fait', profil: 'chef', code: 'OK' })
    expect(etape('60bb')?.sql).toContain("'especes', '{MB1}', '2026-03-11 10:00:00+00'")
    expect(etape('60b')?.sql).not.toContain('{MB1}')
  })

  // Le banc de la caisse (src/test/essaiCaisse.ts) rejoue le MODULE DE LA CAISSE ; la règle des espèces est celle du registre
  // des encaissements, que ce fichier-ci confronte. Il lit chaque étape de l'étape C6 — ses identifiants compris, que le
  // bloc de l'essai déclare sans point-virgule — et n'en juge aucune : 74c d'hier se tait, remplacée, et le catalogue reste
  // une lecture de la base.
  it('le banc de la caisse lit ces étapes sans en juger aucune : la règle est celle du registre, pas de la caisse', () => {
    const issues = rejouerLEssai(ESSAI, '2026-10-29')
    const c6 = issues.filter((i) => /3h?$/.test(i.etape.genre))
    expect(c6).toHaveLength(etapes.filter((e) => /3h?$/.test(e.genre)).length)
    expect(c6.filter((i) => i.genre === 'jugee')).toEqual([])
    expect(c6.filter((i) => i.genre !== 'jugee' && i.raison === 'une capture manque').map((i) => i.etape.titre.split(' ')[0]))
      .toEqual(['170.'])
    const raison = (titre: string) => c6.find((i) => i.etape.titre.startsWith(titre))
    expect(raison('74c. le rattacher')).toMatchObject({
      genre: 'hors_module', raison: 'remplacée par la migration de l’étape C6 (especes_sans_mouvement)',
    })
    for (const n of ['179. ', '179b. ']) expect(raison(n), n).toMatchObject({ genre: 'hors_module', raison: 'une lecture : la base, pas le module' })
  })
})
