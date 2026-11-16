import { describe, expect, it } from 'vitest'
import { ACCES_EN_COURS, ACCES_SANS_OBJET, type AccesDuDossier } from './auteursVentes'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ACCES, AUCUN_CHANGEMENT_TRACE, GESTES, INTITULE_SANS_ADRESSE, LIBELLE_DE_L_ACCES, MENTIONS_DE_L_AUTEUR, TITRES_DE_L_AUTEUR,
  TITRE_DE_L_OUVERTURE_ATTESTEE, TITRE_DU_COMPTE_DU_CABINET_NOMME, auteurDuGeste, auteurMontre, comptesANommer,
  groupesDeLaTrace, ligneDeTrace, nombreDeChangements, ordreDeLaTrace, phraseDeLaTrace, quandADitLaTrace, traceDeLaLecture,
  type LigneDeTrace,
} from './traceDesDroitsVue'
import { ACCES_DANS_LA_TRACE_PREVU, ARRIVEE_ET_DEPART_DES_ACCES_EXPORTEE } from './traceDesDroits'
import { DOMAINES, definitionDe, type Domaine } from './droitsAcces'
import type { TraceDesDroits } from './types'
import { ouverturesDeLaLecture } from './ouverturesAttestees'
import { fichiersDuSchema } from '../test/schema'

// LA RÈGLE D'AFFICHAGE DE LA TRACE DES DROITS (étape P1-trace) : ses mots, son auteur, ses regroupements. Aucun client ici.

const brute = (o: Partial<TraceDesDroits> = {}): TraceDesDroits => ({
  id: 't1', dossier_id: 'd1', acces_id: 'm1', client_id: 'u-client', droit: 'ventes', coche: true, geste: 'changement',
  auteur_id: 'u-cabinet', fait_le: '2026-11-08T09:12:00Z', ...o,
})
const ligne = (o: Partial<TraceDesDroits> = {}): LigneDeTrace => {
  const l = ligneDeTrace(brute(o))
  if (l === null) throw new Error('ligne d’essai illisible')
  return l
}
const lus = (...comptes: string[]): AccesDuDossier => ({ etat: 'lus', comptes })

describe('une ligne jugée', () => {
  it('reprend ce que la base a écrit, et refuse tout mot, toute date qu’elle ne connaît pas', () => {
    expect(ligneDeTrace(brute())).toMatchObject({ droit: 'ventes', geste: 'changement', coche: true, accesId: 'm1', auteurId: 'u-cabinet' })
    expect(ligneDeTrace(brute({ droit: 'rendez-vous' }))).toBeNull()
    expect(ligneDeTrace(brute({ geste: 'suppression' }))).toBeNull()
    expect(ligneDeTrace(brute({ fait_le: 'hier' }))).toBeNull()
    expect(ligneDeTrace(brute({ acces_id: '' }))).toBeNull()
  })

  it('connaît les sept droits de la contrainte de la base, chacun à son libellé d’application', () => {
    // La contrainte `trace_des_droits_droit` de l'export : ses mots sont ceux que l'écran sait nommer.
    const migration = fichiersDuSchema().find((f) => /_trace_des_droits\.sql$/.test(f.chemin))!.texte
    const mots = /check \(droit in \(([^)]*)\)\)/.exec(migration)![1].split(',').map((m) => m.trim().replace(/'/g, ''))
    expect(mots).toHaveLength(7)
    for (const m of mots) {
      const l = ligneDeTrace(brute({ droit: m }))
      expect(l, m).not.toBeNull()
      expect(phraseDeLaTrace(l!).libelle).toBe(definitionDe(l!.droit as Domaine).libelle)
    }
    // Et les libellés de l'onglet sont les mêmes mots (« Notes de frais », pas « frais »).
    expect(phraseDeLaTrace(ligne({ droit: 'frais' })).libelle).toBe('Notes de frais')
    expect(DOMAINES.map((d) => d.libelle)).toContain(phraseDeLaTrace(ligne({ droit: 'ventes' })).libelle)
    const gestes = /check \(geste in \(([^)]*)\)\)/.exec(migration)![1].split(',').map((m) => m.trim().replace(/'/g, ''))
    expect([...gestes].sort()).toEqual([...GESTES].sort())
  })
})

describe('ce que dit une ligne de la case', () => {
  it('coche ou décoche pour un changement ; arrive cochée à la création ; part cochée avec l’accès retiré', () => {
    expect(phraseDeLaTrace(ligne({ coche: true }))).toEqual({ libelle: 'Ventes', etat: 'cochée' })
    expect(phraseDeLaTrace(ligne({ coche: false, droit: 'banque' }))).toEqual({ libelle: 'Banque', etat: 'décochée' })
    expect(phraseDeLaTrace(ligne({ geste: 'creation', coche: true, droit: 'caisse' })).etat).toBe('cochée à la création de l’accès')
    // Un retrait s'écrit case décochée : ce n'est pas un décochage, c'est l'accès qui s'en va en la portant.
    expect(phraseDeLaTrace(ligne({ geste: 'retrait', coche: false, droit: 'comptes' })))
      .toEqual({ libelle: 'Comptes', etat: 'cochée jusqu’au retrait de l’accès' })
  })

  it('date à Paris, quel que soit le fuseau de qui regarde (heure d’été et d’hiver)', () => {
    expect(quandADitLaTrace('2026-11-08T09:12:00Z')).toBe('08/11/2026 à 10:12')
    expect(quandADitLaTrace('2026-07-14T22:30:00Z')).toBe('15/07/2026 à 00:30')
  })
})

describe('qui a fait le geste', () => {
  it('« sans session » quand l’auteur est nul, quelle que soit la liste des accès', () => {
    for (const acces of [lus('u-client'), ACCES_EN_COURS, ACCES_SANS_OBJET, { etat: 'incomplets', motif: 'x' } as AccesDuDossier]) {
      expect(auteurDuGeste(acces, { auteurId: null, clientId: 'u-client' })).toBe('sans_session')
    }
    expect(auteurDuGeste(lus(), { auteurId: '', clientId: 'u-client' })).toBe('sans_session')
  })

  it('« le client » : le titulaire de l’accès lui-même, ou un compte qui porte un accès du dossier sur une liste lue en entier', () => {
    expect(auteurDuGeste(ACCES_EN_COURS, { auteurId: 'u-client', clientId: 'u-client' })).toBe('client')
    expect(auteurDuGeste(lus('u-autre'), { auteurId: 'u-autre', clientId: 'u-client' })).toBe('client')
  })

  it('une liste en cours, partielle ou en échec ne reconnaît pas un autre compte comme le client', () => {
    for (const acces of [ACCES_EN_COURS, ACCES_SANS_OBJET, { etat: 'incomplets', motif: 'x' } as AccesDuDossier]) {
      expect(auteurDuGeste(acces, { auteurId: 'u-autre', clientId: 'u-client' })).toBe('cabinet')
    }
  })

  it('« le cabinet » : tout autre compte connecté, jamais l’identifiant', () => {
    expect(auteurDuGeste(lus('u-client'), { auteurId: 'u-cabinet', clientId: 'u-client' })).toBe('cabinet')
    expect(Object.values(MENTIONS_DE_L_AUTEUR)).toEqual(['Sans session', 'Le client', 'Le cabinet'])
  })

  it('ce « cabinet » est prouvé par la base : tout chemin d’écriture de `memberships` d’une session exige `admin_du_dossier`', () => {
    const sql = fichiersDuSchema().map((f) => f.texte).join('\n')
    const sansCommentaires = sql.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')
    // Les policies d'écriture de la table : la dernière définition de chacune, et aucune de mise à jour ni `for all`.
    const policies = [...sansCommentaires.matchAll(/create policy (memberships_\w+) on (?:public\.)?memberships\s+for (\w+)([^;]*);/gi)]
    const derniere = new Map(policies.map((m) => [m[1], { evenement: m[2], texte: m[3] }]))
    expect([...derniere.keys()].sort()).toEqual(['memberships_delete', 'memberships_select', 'memberships_write'])
    expect(derniere.get('memberships_write')).toMatchObject({ evenement: 'insert' })
    expect(derniere.get('memberships_write')!.texte).toContain('admin_du_dossier(dossier_id)')
    expect(derniere.get('memberships_delete')).toMatchObject({ evenement: 'delete' })
    expect(derniere.get('memberships_delete')!.texte).toContain('admin_du_dossier(dossier_id)')
    // La seule fonction qui écrit les droits est celle à cinq paramètres (les formes à quatre et à trois n'en sont que des
    // enveloppes qui la rappellent) : elle juge l'appelant AVANT d'écrire.
    // Une signature par nombre de paramètres, la DERNIÈRE définition l'emportant (les migrations se rejouent dans l'ordre).
    const parSignature = new Map<number, RegExpMatchArray>()
    for (const m of sansCommentaires.matchAll(/create (?:or replace )?function public\.changer_droits_acces\(([^)]*)\)[\s\S]*?\n\$\$;/gi)) {
      parSignature.set(m[1].split(',').length, m)
    }
    const definitions = [...parSignature.values()]
    const aCinq = definitions.filter((d) => d[1].includes('p_comptes'))
    expect(aCinq).toHaveLength(1)
    const corps = aCinq[0][0]
    expect(corps).toContain('not public.admin_du_dossier(v_dossier)')
    expect(corps.indexOf('admin_du_dossier')).toBeLessThan(corps.indexOf('update public.memberships'))
    for (const d of definitions.filter((d) => !d[1].includes('p_comptes'))) {
      expect(d[0]).toContain('return public.changer_droits_acces(')
      expect(d[0]).not.toContain('update public.memberships')
    }
  })
})

describe('la lecture jugée', () => {
  it('entière et connue : aucun motif, et la trace peut dire le vide', () => {
    expect(traceDeLaLecture({ lignes: [], complete: true, motif: null })).toEqual({ lignes: [], motif: null })
  })

  it('lue en partie : les lignes restent, le motif de la lecture aussi', () => {
    const jugee = traceDeLaLecture({ lignes: [brute()], complete: false, motif: '1 ligne(s) lue(s) sur 3 annoncée(s)' })
    expect(jugee.lignes).toHaveLength(1)
    expect(jugee.motif).toBe('1 ligne(s) lue(s) sur 3 annoncée(s)')
  })

  it('une ligne aux mots inconnus se compte et rend la lecture partielle, même sur une lecture entière', () => {
    const jugee = traceDeLaLecture({ lignes: [brute(), brute({ id: 't2', droit: 'inconnu' })], complete: true, motif: null })
    expect(jugee.lignes.map((l) => l.id)).toEqual(['t1'])
    expect(jugee.motif).toContain('1 ligne(s) portent un droit, un geste ou une date que cet écran ne connaît pas')
  })

  it('range les plus récentes d’abord, l’identifiant départageant deux instants égaux', () => {
    const rangees = ordreDeLaTrace([
      ligne({ id: 'b', fait_le: '2026-11-08T09:00:00Z' }), ligne({ id: 'a', fait_le: '2026-11-08T09:00:00Z' }),
      ligne({ id: 'c', fait_le: '2026-11-09T09:00:00Z' }),
    ])
    expect(rangees.map((l) => l.id)).toEqual(['c', 'a', 'b'])
  })
})

describe('la trace rangée par accès', () => {
  const lignes = [
    ligne({ id: 't1', acces_id: 'm1' }),
    ligne({ id: 't2', acces_id: 'm1', fait_le: '2026-11-09T09:00:00Z', droit: 'banque' }),
    ligne({ id: 't3', acces_id: 'm-parti', fait_le: '2026-11-07T18:00:00Z' }),
  ]

  it('un groupe par accès lu — même sans ligne —, le plus récent d’abord, puis les accès retirés', () => {
    const groupes = groupesDeLaTrace(lignes, [{ id: 'm1', email: 'client@exemple.fr' }, { id: 'm2', email: null }], true, null)
    expect(groupes.map((g) => [g.intitule, g.etat, g.lignes.map((l) => l.id)])).toEqual([
      ['client@exemple.fr', 'present', ['t2', 't1']],
      [INTITULE_SANS_ADRESSE, 'present', []],
      ['Accès retiré depuis (tracé dès le 07/11/2026 à 19:00)', 'retire', ['t3']],
    ])
  })

  it('lue en partie, la liste ne dit pas « retiré » : un accès absent est seulement absent de ce qui a été lu', () => {
    const groupes = groupesDeLaTrace(lignes, [{ id: 'm1', email: 'client@exemple.fr' }], false, null)
    expect(groupes[1]).toMatchObject({ etat: 'absent' })
    expect(groupes[1].intitule).toContain('absent de la liste lue')
    expect(groupes[1].intitule).not.toContain('retiré')
  })

  it('ne montre jamais un identifiant', () => {
    const groupes = groupesDeLaTrace(lignes, [{ id: 'm1', email: null }], true, null)
    const texte = JSON.stringify(groupes.map((g) => g.intitule)) + JSON.stringify(lignes.map((l) => [phraseDeLaTrace(l), quandADitLaTrace(l.instant)]))
    for (const id of ['m1', 'm-parti', 'u-client', 'u-cabinet']) expect(texte).not.toContain(id)
  })

  // P1T-E2 : l'adresse retenue au départ nomme l'accès parti, daté de son départ ; un accès PRÉSENT garde l'adresse de la
  // liste, même si une adresse retenue existe (un accès revenu) ; sans adresse retenue, l'intitulé d'hier.
  const retenues = new Map([
    ['m-parti', { adresse: 'ancien@exemple.fr', retireLe: '2026-11-10T08:30:00Z' }],
    ['m1', { adresse: 'perime@exemple.fr', retireLe: '2026-11-01T08:30:00Z' }],
  ])

  it('un accès retiré se nomme par l’adresse retenue à son départ, datée de ce départ', () => {
    const groupes = groupesDeLaTrace(lignes, [{ id: 'm1', email: 'client@exemple.fr' }], true, retenues)
    expect(groupes.map((g) => [g.intitule, g.etat])).toEqual([
      ['client@exemple.fr', 'present'],
      ['ancien@exemple.fr — accès retiré le 10/11/2026 à 09:30', 'retire'],
    ])
  })

  it('lue en partie, la liste dit l’accès absent, sous son adresse retenue, sans le dire retiré', () => {
    const groupes = groupesDeLaTrace(lignes, [{ id: 'm1', email: 'client@exemple.fr' }], false, retenues)
    expect(groupes[1]).toMatchObject({ etat: 'absent', intitule: 'ancien@exemple.fr — absent de la liste lue (parti le 10/11/2026 à 09:30)' })
  })

  it('sans adresse retenue pour cet accès, ou sans la table (`null`), l’intitulé d’hier', () => {
    for (const adresses of [null, new Map(), new Map([['autre', { adresse: 'x@exemple.fr', retireLe: '2026-11-10T08:30:00Z' }]])]) {
      const groupes = groupesDeLaTrace(lignes, [{ id: 'm1', email: 'client@exemple.fr' }], true, adresses)
      expect(groupes[1].intitule).toBe('Accès retiré depuis (tracé dès le 07/11/2026 à 19:00)')
    }
  })

  it('compte au singulier et au pluriel, et le vide ne s’explique que par la date de mise en base', () => {
    expect(nombreDeChangements(1)).toBe('1 changement')
    expect(nombreDeChangements(3)).toBe('3 changements')
    expect(AUCUN_CHANGEMENT_TRACE).toContain('07/11/2026')
  })
})

// L'ACCÈS LUI-MÊME DANS LA TRACE (P1T-Q2, migration préparée `arrivee_et_depart_des_acces`) : le huitième mot, connu de
// l'écran sous `ACCES_DANS_LA_TRACE_PREVU` seulement (levé le 15/11/2026, avant le collage), et sous ses deux formes
// seulement ; ce que la carte en DIT, sous `ARRIVEE_ET_DEPART_DES_ACCES_EXPORTEE`, qui suit l'export.
describe('l’accès lui-même dans la trace (P1T-Q2)', () => {
  const PREPAREE = readFileSync(join(__dirname, '../../supabase/schema/20261115130614_arrivee_et_depart_des_acces.sql'), 'utf8')
  const arrivee = brute({ id: 'a1', droit: 'acces', geste: 'creation', coche: true })
  const depart = brute({ id: 'a2', droit: 'acces', geste: 'retrait', coche: false, fait_le: '2026-11-09T09:12:00Z' })

  it('le drapeau de la lecture est levé avant le collage, et la valeur par défaut le suit', () => {
    expect(ACCES_DANS_LA_TRACE_PREVU).toBe(true)
    expect(ligneDeTrace(arrivee)).toMatchObject({ droit: ACCES, geste: 'creation', coche: true })
    expect(traceDeLaLecture({ lignes: [brute(), arrivee], complete: true, motif: null }).motif).toBeNull()
  })

  it('la migration en base (15/11/2026) : l’export admet le huitième mot, et une trace des sept cases se lit de même, le mot connu ou non', () => {
    // La contrainte de l'export, la dernière définition de `trace_des_droits_droit` : les sept cases, puis « acces ».
    const definitions = fichiersDuSchema().flatMap((f) => [...f.texte.matchAll(/constraint trace_des_droits_droit\s+check \(droit in \(([^)]*)\)\)/gi)]
      .map((m) => m[1].split(',').map((x) => x.trim().replace(/'/g, ''))))
    expect(definitions.length).toBeGreaterThan(0)
    expect(definitions[definitions.length - 1]).toEqual(['ventes', 'banque', 'caisse', 'comptes', 'achats', 'frais', 'documents', 'acces'])
    // Toute ligne d'une CASE se juge de même, le mot connu ou non.
    for (const droit of definitions[definitions.length - 1].filter((d) => d !== 'acces')) {
      for (const geste of GESTES) {
        for (const coche of [true, false]) {
          const b = brute({ droit, geste, coche })
          expect(ligneDeTrace(b, true), `${droit} ${geste} ${coche}`).toEqual(ligneDeTrace(b, false))
        }
      }
    }
  })

  it('baissé (l’état d’avant) : une ligne « acces » est un mot inconnu, et rend la lecture partielle', () => {
    expect(ligneDeTrace(arrivee, false)).toBeNull()
    const jugee = traceDeLaLecture({ lignes: [brute(), arrivee], complete: true, motif: null }, false)
    expect(jugee.lignes.map((l) => l.id)).toEqual(['t1'])
    expect(jugee.motif).toContain('1 ligne(s) portent un droit, un geste ou une date que cet écran ne connaît pas')
  })

  it('ce que la carte dit de la trace suit l’export : levé dès que la migration y est', () => {
    expect(ARRIVEE_ET_DEPART_DES_ACCES_EXPORTEE)
      .toBe(fichiersDuSchema().some((f) => /\d{14}_arrivee_et_depart_des_acces\.sql$/.test(f.chemin)))
  })

  it('levé : l’arrivée et le départ se lisent, ouvert et retiré, à leur libellé', () => {
    expect(ligneDeTrace(arrivee, true)).toMatchObject({ droit: ACCES, geste: 'creation', coche: true })
    expect(phraseDeLaTrace(ligneDeTrace(arrivee, true)!)).toEqual({ libelle: LIBELLE_DE_L_ACCES, etat: 'ouvert' })
    expect(phraseDeLaTrace(ligneDeTrace(depart, true)!)).toEqual({ libelle: LIBELLE_DE_L_ACCES, etat: 'retiré' })
    const jugee = traceDeLaLecture({ lignes: [brute(), arrivee, depart], complete: true, motif: null }, true)
    // Les plus récentes d'abord ; à l'instant égal (l'arrivée et la case du 08/11), l'identifiant.
    expect(jugee.lignes.map((l) => l.id)).toEqual(['a2', 'a1', 't1'])
    expect(jugee.motif).toBeNull()
  })

  it('levé : un « changement » de l’accès, ou une case qui contredit le geste, reste un mot inconnu', () => {
    expect(ligneDeTrace(brute({ droit: 'acces', geste: 'changement', coche: true }), true)).toBeNull()
    expect(ligneDeTrace(brute({ droit: 'acces', geste: 'creation', coche: false }), true)).toBeNull()
    expect(ligneDeTrace(brute({ droit: 'acces', geste: 'retrait', coche: true }), true)).toBeNull()
  })

  it('le mot est celui que la migration préparée admet, en plus des sept cases, et que son déclencheur écrit', () => {
    const mots = /check \(droit in \(([^)]*)\)\)/.exec(PREPAREE)![1].split(',').map((m) => m.trim().replace(/'/g, ''))
    expect(mots).toEqual(['ventes', 'banque', 'caisse', 'comptes', 'achats', 'frais', 'documents', ACCES])
    expect(PREPAREE).toContain(`values (new.dossier_id, new.id, new.user_id, '${ACCES}', true, 'creation', v_auteur);`)
    expect(PREPAREE).toContain(`values (old.dossier_id, old.id, old.user_id, '${ACCES}', false, 'retrait', v_auteur);`)
  })
})

// QUI A OUVERT UN ACCÈS (P1TQ2-Q1) : seule l'ARRIVÉE d'un accès écrite sans session s'attribue, par l'attestation du cabinet,
// et son compte ne se nomme que par l'adresse que la session de qui regarde lit dans l'équipe ; tout le reste, comme P1T-E1.
describe('l’auteur montré, l’attestation d’une ouverture lue', () => {
  const arrivee = ligne({ id: 't-a', droit: ACCES, geste: 'creation', coche: true, auteur_id: null })
  const attestee = ouverturesDeLaLecture({
    lignes: [{ id: 'a1', dossier_id: 'd1', acces_id: 'm1', trace_id: 't-a', auteur_id: 'u-chef', atteste_le: '2026-11-16T09:00:00Z' }],
    complete: true, motif: null,
  })

  it('l’arrivée attestée : « Le cabinet », son adresse si la session la lit, et ce que le survol dit', () => {
    expect(auteurMontre(lus(), arrivee, attestee, new Map([['u-chef', 'chef@cabinet.example']])))
      .toEqual({ mention: MENTIONS_DE_L_AUTEUR.cabinet, adresse: 'chef@cabinet.example', titre: TITRE_DE_L_OUVERTURE_ATTESTEE })
    expect(auteurMontre(lus(), arrivee, attestee, new Map()))
      .toEqual({ mention: MENTIONS_DE_L_AUTEUR.cabinet, adresse: null, titre: TITRE_DE_L_OUVERTURE_ATTESTEE })
  })

  it('sans attestation, ou sans lecture, l’arrivée reste « Sans session »', () => {
    const sansSession = { mention: MENTIONS_DE_L_AUTEUR.sans_session, adresse: null, titre: TITRES_DE_L_AUTEUR.sans_session }
    expect(auteurMontre(lus(), arrivee, null, null)).toEqual(sansSession)
    expect(auteurMontre(lus(), { ...arrivee, id: 't-autre' }, attestee, new Map([['u-chef', 'chef@cabinet.example']]))).toEqual(sansSession)
  })

  it('une case, un départ, ou une arrivée écrite sous une session ne s’attribuent jamais par l’attestation', () => {
    const equipe = new Map([['u-chef', 'chef@cabinet.example']])
    for (const autre of [
      ligne({ id: 't-a', droit: 'banque', geste: 'creation', coche: true, auteur_id: null }),
      ligne({ id: 't-a', droit: ACCES, geste: 'retrait', coche: false, auteur_id: null }),
    ]) {
      expect(auteurMontre(lus(), autre, attestee, equipe).adresse).toBeNull()
      expect(auteurMontre(lus(), autre, attestee, equipe).mention).toBe(MENTIONS_DE_L_AUTEUR.sans_session)
    }
    const sousSession = ligne({ id: 't-a', droit: ACCES, geste: 'creation', coche: true, auteur_id: 'u-collegue' })
    expect(auteurMontre(lus(), sousSession, attestee, equipe))
      .toEqual({ mention: MENTIONS_DE_L_AUTEUR.cabinet, adresse: null, titre: TITRES_DE_L_AUTEUR.cabinet })
  })
})

// P1TQ2Q1-Q1 (tranchée par le cabinet le 16/11/2026) : le compte du cabinet qui a coché, décoché ou retiré se nomme par l'adresse
// que la session de qui regarde lit dans l'équipe ; sinon « Le cabinet ». Le client et « sans session » ne se nomment jamais.
describe('le compte du cabinet derrière un geste', () => {
  const equipe = new Map([['u-cabinet', 'chef@cabinet.example'], ['u-client', 'client-aussi@cabinet.example']])

  it('les comptes à nommer : les auteurs connectés, hors du titulaire de la ligne, triés, sans doublon', () => {
    expect(comptesANommer([
      ligne({ id: 't1', auteur_id: 'u-z' }), ligne({ id: 't2', auteur_id: null }), ligne({ id: 't3', auteur_id: 'u-client' }),
      ligne({ id: 't4', auteur_id: 'u-a' }), ligne({ id: 't5', auteur_id: 'u-z' }),
    ])).toEqual(['u-a', 'u-z'])
    expect(comptesANommer([])).toEqual([])
  })

  it('une case cochée, décochée, un accès retiré par le cabinet : « Le cabinet », suivi de l’adresse lue', () => {
    for (const geste of [
      ligne({ id: 'a', droit: 'ventes', coche: true }), ligne({ id: 'b', droit: 'banque', coche: false }),
      ligne({ id: 'c', droit: ACCES, geste: 'retrait', coche: false }),
    ]) {
      expect(auteurMontre(lus(), geste, null, equipe))
        .toEqual({ mention: MENTIONS_DE_L_AUTEUR.cabinet, adresse: 'chef@cabinet.example', titre: TITRE_DU_COMPTE_DU_CABINET_NOMME })
    }
  })

  it('l’adresse non lue (un autre membre), ou l’équipe absente : « Le cabinet », sans adresse', () => {
    const cabinet = { mention: MENTIONS_DE_L_AUTEUR.cabinet, adresse: null, titre: TITRES_DE_L_AUTEUR.cabinet }
    expect(auteurMontre(lus(), ligne(), null, new Map())).toEqual(cabinet)
    expect(auteurMontre(lus(), ligne(), null, null)).toEqual(cabinet)
  })

  it('le client et « sans session » ne se nomment jamais par l’équipe', () => {
    expect(auteurMontre(lus(), ligne({ auteur_id: 'u-client' }), null, equipe))
      .toEqual({ mention: MENTIONS_DE_L_AUTEUR.client, adresse: null, titre: TITRES_DE_L_AUTEUR.client })
    expect(auteurMontre(lus('u-cabinet'), ligne(), null, equipe).adresse).toBeNull()
    expect(auteurMontre(lus(), ligne({ auteur_id: null }), null, equipe).adresse).toBeNull()
  })
})
