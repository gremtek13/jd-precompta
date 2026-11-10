import { describe, expect, it } from 'vitest'
import { ACCES_EN_COURS, ACCES_SANS_OBJET, type AccesDuDossier } from './auteursVentes'
import {
  AUCUN_CHANGEMENT_TRACE, GESTES, INTITULE_SANS_ADRESSE, MENTIONS_DE_L_AUTEUR, auteurDuGeste, groupesDeLaTrace, ligneDeTrace,
  nombreDeChangements, ordreDeLaTrace, phraseDeLaTrace, quandADitLaTrace, traceDeLaLecture, type LigneDeTrace,
} from './traceDesDroitsVue'
import { DOMAINES, definitionDe } from './droitsAcces'
import type { TraceDesDroits } from './types'
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
      expect(phraseDeLaTrace(l!).libelle).toBe(definitionDe(l!.droit).libelle)
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
    const groupes = groupesDeLaTrace(lignes, [{ id: 'm1', email: 'client@exemple.fr' }, { id: 'm2', email: null }], true)
    expect(groupes.map((g) => [g.intitule, g.etat, g.lignes.map((l) => l.id)])).toEqual([
      ['client@exemple.fr', 'present', ['t2', 't1']],
      [INTITULE_SANS_ADRESSE, 'present', []],
      ['Accès retiré depuis (tracé dès le 07/11/2026 à 19:00)', 'retire', ['t3']],
    ])
  })

  it('lue en partie, la liste ne dit pas « retiré » : un accès absent est seulement absent de ce qui a été lu', () => {
    const groupes = groupesDeLaTrace(lignes, [{ id: 'm1', email: 'client@exemple.fr' }], false)
    expect(groupes[1]).toMatchObject({ etat: 'absent' })
    expect(groupes[1].intitule).toContain('absent de la liste lue')
    expect(groupes[1].intitule).not.toContain('retiré')
  })

  it('ne montre jamais un identifiant', () => {
    const groupes = groupesDeLaTrace(lignes, [{ id: 'm1', email: null }], true)
    const texte = JSON.stringify(groupes.map((g) => g.intitule)) + JSON.stringify(lignes.map((l) => [phraseDeLaTrace(l), quandADitLaTrace(l.instant)]))
    for (const id of ['m1', 'm-parti', 'u-client', 'u-cabinet']) expect(texte).not.toContain(id)
  })

  it('compte au singulier et au pluriel, et le vide ne s’explique que par la date de mise en base', () => {
    expect(nombreDeChangements(1)).toBe('1 changement')
    expect(nombreDeChangements(3)).toBe('3 changements')
    expect(AUCUN_CHANGEMENT_TRACE).toContain('07/11/2026')
  })
})
