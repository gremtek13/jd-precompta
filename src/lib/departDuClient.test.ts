import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DEPART_DU_CLIENT_PREVU, INTERDITS_DU_DOSSIER_CONSERVE, REFUS_DU_DEPART, ceQueDitLaConservation, ceQueDitLaRemise,
  ceQueLaSuppressionPerd, confirmationDeLaConservation, dateDite, exercicesSansPaquet, motsDuRefus, refusDeLaConservation,
  refusDeLaSuppressionAuDepart, termeAPoser, termeDeConservation, type ConservationEnCours, type ExerciceValideDuDepart,
  type PaquetTelecharge,
} from './departDuClient'

// LE DÉPART D'UN CLIENT (ligne 44, INAL5) : le module redit les refus de la migration `depart_du_client` — préparée le
// 11/11/2026, dans l'export le jour de son application —, à leurs mots et à leur code, et la règle de la garde de la
// suppression (le terme de chaque exercice, l'empreinte du paquet) ; l'essai et rls.sql attendent les mêmes mots.

function leFichier(motif: RegExp, chemins: readonly string[]): string {
  const trouves: string[] = []
  for (const relatif of chemins) {
    const chemin = new URL(relatif, import.meta.url).pathname
    let noms: string[] = []
    try { noms = readdirSync(chemin) } catch { continue }
    for (const nom of noms) if (motif.test(nom)) trouves.push(chemin + nom)
  }
  expect(trouves, String(motif)).toHaveLength(1)
  return readFileSync(trouves[0], 'utf8')
}

const MIGRATION = leFichier(/^\d{14}_depart_du_client\.sql$/, ['../../supabase/preparees/', '../../supabase/schema/'])
const RETOUR = leFichier(/^\d{14}_retour_depart_du_client\.sql$/, ['../../supabase/preparees/retour/'])
const ESSAI = readFileSync(new URL('../../supabase/essais/departDuClient.sql', import.meta.url), 'utf8')
const RLS = readFileSync(new URL('../../supabase/essais/rls.sql', import.meta.url), 'utf8')

/** Les refus d'un texte SQL : leurs mots et leur code. */
const refusSql = (sql: string) =>
  [...sql.matchAll(/raise exception '((?:[^']|'')*)'[\s\S]*?using errcode = '([0-9A-Z]{5})'/g)].map(([, mots, code]) => ({ mots, code }))

const exercice = (annee: number, empreinte = `e${annee}`): ExerciceValideDuDepart => ({ annee, empreinte })
const paquet = (annee: number, empreinte = `e${annee}`): PaquetTelecharge => ({ annee, empreinte_exercice: empreinte, telecharge_le: '2027-03-01T10:00:00Z' })
const conservation = (jusqu_au: string, dernier_exercice = 2026): ConservationEnCours => ({ jusqu_au, dernier_exercice, posee_le: '2027-02-01T10:00:00Z' })

describe('le drapeau et la migration', () => {
  it('le drapeau est baissé tant que la migration n’est pas dans l’export', () => {
    const exportee = readdirSync(new URL('../../supabase/schema/', import.meta.url).pathname).some((n) => /_depart_du_client\.sql$/.test(n))
    expect(DEPART_DU_CLIENT_PREVU).toBe(exportee)
  })

  it('chaque refus du module est un refus de la migration, à ses mots et à son code', () => {
    const sql = refusSql(MIGRATION)
    for (const [cle, { code, modele }] of Object.entries(REFUS_DU_DEPART)) {
      expect(sql.filter((r) => r.mots === modele && r.code === code), cle).not.toHaveLength(0)
    }
  })

  it('les interdits du dossier conservé sont les arguments des quatre déclencheurs de la garde, dans l’ordre', () => {
    const args = [...MIGRATION.matchAll(/before insert(?: or update of dossier_id)? on public\.([a-z_]+)\n  for each row execute function public\.garder_dossier_conserve\('([^']+)'\)/gi)]
      .map(([, table, mots]) => ({ table, mots }))
    expect(args).toEqual(INTERDITS_DU_DOSSIER_CONSERVE.map((i) => ({ table: i.table, mots: i.mots })))
  })

  it('le terme est le 31 décembre de la dixième année, dans la fonction, la contrainte et la garde', () => {
    expect(MIGRATION).toContain('v_jusqu := make_date(v_dernier + 10, 12, 31);')
    expect(MIGRATION).toContain('check (jusqu_au = make_date(dernier_exercice + 10, 12, 31))')
    expect(MIGRATION).toContain('make_date(ev.annee + 10, 12, 31) >= v_jour')
    expect(MIGRATION).toContain("v_jour date := (now() at time zone 'Europe/Paris')::date;")
    expect(MIGRATION).toContain('p.empreinte_exercice = ev.empreinte')
  })

  it('le retour retire tout ce que la migration crée, et rien d’autre', () => {
    const crees = [...MIGRATION.matchAll(/create (table|function|trigger) public\.([a-z_]+)|create trigger ([a-z_]+)/gi)]
      .map(([, , nom, trigger]) => nom ?? trigger).sort()
    const retires = [...RETOUR.matchAll(/drop (?:table|function|trigger) (?:public\.)?([a-z_]+)/gi)].map(([, nom]) => nom).sort()
    // Le déclencheur de la table des conservations part avec elle (ses policies et son index aussi).
    expect(retires).toEqual(crees.filter((nom) => nom !== 'conservations_des_dossiers_gardes'))
  })

  it('l’essai et rls.sql attendent les mots du module', () => {
    expect(ESSAI).toContain(motsDuRefus('acces'))
    expect(ESSAI).toContain(motsDuRefus('aucunExercice'))
    expect(ESSAI).toContain(motsDuRefus('accesClient', 1))
    expect(ESSAI).toContain(motsDuRefus('pasConserve'))
    expect(ESSAI).toContain(motsDuRefus('suppressionAvantLeTerme', '31/12/2036'))
    expect(ESSAI).toContain(motsDuRefus('dejaConserve', '31/12/2036'))
    expect(ESSAI).toContain('Le paquet d’archive n’a pas été téléchargé pour l’exercice validé 2026.')
    expect(RLS).toContain(motsDuRefus('acces'))
    expect(RLS).toContain('DP. le départ d\'\'un client : EN ATTENTE de la migration depart_du_client')
  })
})

describe('le terme et les paquets', () => {
  it('le terme d’un exercice', () => {
    expect(termeDeConservation(2026)).toBe('2036-12-31')
    expect(dateDite('2036-12-31')).toBe('31/12/2036')
    expect(termeAPoser([exercice(2025), exercice(2026)])).toEqual({ dernier: 2026, jusquAu: '2036-12-31' })
    expect(termeAPoser([])).toBeNull()
  })

  it('un paquet ne compte qu’à l’empreinte de son exercice ; un exercice clos n’en demande plus', () => {
    const exercices = [exercice(2014), exercice(2025), exercice(2026)]
    expect(exercicesSansPaquet(exercices, [], '2027-03-01')).toEqual([2025, 2026])
    expect(exercicesSansPaquet(exercices, [paquet(2025)], '2027-03-01')).toEqual([2026])
    expect(exercicesSansPaquet(exercices, [paquet(2025), paquet(2026, 'autre')], '2027-03-01')).toEqual([2026])
    expect(exercicesSansPaquet(exercices, [paquet(2025), paquet(2026)], '2027-03-01')).toEqual([])
    // Le 31 décembre de la dixième année compte encore ; le lendemain, plus.
    expect(exercicesSansPaquet([exercice(2025)], [], '2035-12-31')).toEqual([2025])
    expect(exercicesSansPaquet([exercice(2025)], [], '2036-01-01')).toEqual([])
  })
})

describe('les refus avant le clic', () => {
  const base = { superAdministrateur: false, conservation: null, exercices: [exercice(2025), exercice(2026)], paquets: [], jour: '2027-03-01' }

  it('la suppression : la conservation qui court, puis les paquets ; le super-administrateur n’est retenu par rien', () => {
    expect(refusDeLaSuppressionAuDepart({ ...base, conservation: conservation('2036-12-31') }))
      .toBe('Ce dossier est conservé jusqu’au 31/12/2036 : il ne se supprime pas avant. Seul le super-administrateur le retire plus tôt.')
    expect(refusDeLaSuppressionAuDepart(base)).toBe(motsDuRefus('paquetsManquants', '2025, 2026'))
    expect(refusDeLaSuppressionAuDepart({ ...base, paquets: [paquet(2025), paquet(2026)] })).toBeNull()
    expect(refusDeLaSuppressionAuDepart({ ...base, superAdministrateur: true, conservation: conservation('2036-12-31') })).toBeNull()
    expect(refusDeLaSuppressionAuDepart({ ...base, exercices: [] })).toBeNull()
    // Une conservation échue : plus rien à conserver.
    expect(refusDeLaSuppressionAuDepart({ ...base, exercices: [exercice(2014)], conservation: conservation('2024-12-31', 2014) })).toBeNull()
  })

  it('la conservation, dans l’ordre de la fonction', () => {
    const p = { estChef: true, conservation: null, exercices: [exercice(2026)], accesClient: 0 }
    expect(refusDeLaConservation({ ...p, estChef: false, accesClient: 2 })).toBe(motsDuRefus('acces'))
    expect(refusDeLaConservation({ ...p, conservation: conservation('2036-12-31'), exercices: [] }))
      .toBe('Ce dossier est déjà conservé jusqu’au 31/12/2036.')
    expect(refusDeLaConservation({ ...p, exercices: [], accesClient: 1 })).toBe(motsDuRefus('aucunExercice'))
    expect(refusDeLaConservation({ ...p, accesClient: 2 }))
      .toBe('Ce dossier a encore 2 accès client : un dossier conservé n’en a aucun. Les retirer d’abord (onglet Accès).')
    expect(refusDeLaConservation(p)).toBeNull()
  })
})

describe('les mots de la carte et des confirmations', () => {
  it('la remise dit les paquets qui manquent, ou qu’il n’y en a pas', () => {
    expect(ceQueDitLaRemise({ exercices: [exercice(2025), exercice(2026)], manquants: [2026] }))
      .toContain('Il manque le paquet de l’exercice 2026 : la suppression attend ce téléchargement.')
    expect(ceQueDitLaRemise({ exercices: [exercice(2025), exercice(2026)], manquants: [2025, 2026] }))
      .toContain('Il manque les paquets des exercices 2025, 2026')
    expect(ceQueDitLaRemise({ exercices: [exercice(2026)], manquants: [] })).toContain('Tous les paquets sont téléchargés')
    expect(ceQueDitLaRemise({ exercices: [], manquants: [] })).toContain('aucun exercice n’est validé')
  })

  it('la conservation dit son terme, posée ou à poser', () => {
    expect(ceQueDitLaConservation({ conservation: conservation('2036-12-31'), aPoser: null })).toContain('conservé jusqu’au 31/12/2036')
    expect(ceQueDitLaConservation({ conservation: null, aPoser: { dernier: 2026, jusquAu: '2036-12-31' } })).toContain('jusqu’au 31/12/2036')
    expect(ceQueDitLaConservation({ conservation: null, aPoser: null })).toContain('Valider d’abord le dernier exercice')
    expect(confirmationDeLaConservation('Dossier fictif', { dernier: 2026, jusquAu: '2036-12-31' }))
      .toBe('Conserver « Dossier fictif » jusqu’au 31/12/2036 : dix ans après l’exercice 2026. Le dossier ne recevra plus de pièce, '
        + 'd’écriture, d’accès client ni de validation, et ne se supprimera pas avant cette date.')
  })

  it('la confirmation de la suppression nomme les paquets', () => {
    const exercices = [exercice(2025), exercice(2026)]
    expect(ceQueLaSuppressionPerd({ exercices, manquants: [2026], conservation: null, jour: '2027-03-01' }))
      .toContain('Le paquet d’archive des exercices 2026 n’a pas été téléchargé')
    expect(ceQueLaSuppressionPerd({ exercices, manquants: [], conservation: null, jour: '2027-03-01' }))
      .toContain('(2025, 2026) ont été téléchargés')
    expect(ceQueLaSuppressionPerd({ exercices, manquants: [], conservation: conservation('2036-12-31'), jour: '2027-03-01' }))
      .toContain('seul le super-administrateur le supprime avant')
    expect(ceQueLaSuppressionPerd({ exercices: [], manquants: [], conservation: null, jour: '2027-03-01' })).toBe('')
  })
})
