import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  AVOIR_NE_PRECEDE_PAS, REFUS_AVOIR_D_UNE_REPRISE, REFUS_ENCAISSEMENT_D_UNE_REPRISE, refusAvecLesNeufs,
} from './encaissementsDesReprises'
import { REFUS_ENREGISTREMENT, remplirModele } from './encaissementsFactures'

// LES ENCAISSEMENTS ET L'AVOIR D'UNE FACTURE REPRISE (ligne 51.5, étape A8b) : le module redit les refus neufs de la
// migration `factures_reprises_encaissements` — préparée le 10/11/2026, dans l'export le jour de son application —, à leur
// place parmi ceux d'hier, que son retour porte au texte de l'export ; et les deux fichiers se tiennent l'un l'autre par
// leurs empreintes. La migration se cherche où qu'elle soit, une fois ; le retour reste dans supabase/preparees/retour.

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

const MIGRATION = leFichier(/^\d{14}_factures_reprises_encaissements\.sql$/, ['../../supabase/preparees/', '../../supabase/schema/'])
const RETOUR = leFichier(/^\d{14}_retour_factures_reprises_encaissements\.sql$/, ['../../supabase/preparees/retour/'])
const ESSAI = readFileSync(new URL('../../supabase/essais/encaissementsDesReprises.sql', import.meta.url), 'utf8')

const SEPT = [
  'calcul_vente_facturee', 'ecriture_attendue_vente_facturee', 'ecritures_attendues_de_la_periode', 'enregistrer_encaissement',
  'enregistrer_facture', 'garder_encaissement_facture', 'ventes_facturees_de_la_simulation',
] as const

/** Une fonction d'un texte : de son `create … function public.<nom>(` au `$$;` qui la ferme, exclu. */
function fonction(texte: string, nom: string): string {
  const m = new RegExp(`create (or replace )?function public\\.${nom}\\(`, 'i').exec(texte)
  expect(m, nom).not.toBeNull()
  const debut = (m as RegExpExecArray).index
  return texte.slice(debut, texte.indexOf('$$;', debut))
}

/** Son corps, tel que la base le garde (`prosrc`) : ce qui suit `as $$`. */
const corps = (definition: string) => definition.slice(definition.indexOf('as $$') + 'as $$'.length)
const md5 = (texte: string) => createHash('md5').update(texte, 'utf8').digest('hex')

const messagesSql = (sql: string) => [...sql.matchAll(/raise exception '((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"))
const codesSql = (sql: string) =>
  [...sql.matchAll(/raise exception '(?:[^']|'')*'[\s\S]*?using errcode = '([0-9A-Z]{5})'/g)].map((m) => m[1])

/** Les empreintes qu'une garde compare (`nom=md5`), dans le bloc `do $<nom>$ … $<nom>$` donné. */
function empreintesDeLaGarde(texte: string, bloc: string): Map<string, string> {
  const debut = texte.indexOf(`do $${bloc}$`)
  expect(debut, bloc).toBeGreaterThanOrEqual(0)
  const garde = texte.slice(debut, texte.indexOf(`$${bloc}$;`, debut))
  return new Map([...garde.matchAll(/'(\w+)=([0-9a-f]{32})/g)].map((m) => [m[1], m[2]] as [string, string]))
}

const CLES_NEUVES = new Set<string>(REFUS_ENCAISSEMENT_D_UNE_REPRISE.map((r) => r.cle))

describe('enregistrer_encaissement : les refus d’hier, et les quatre neufs à leur place', () => {
  it('le texte de la migration porte les refus d’hier — ceux du module, ceux du retour —, les neufs insérés là où le module les place', () => {
    // Les refus d'hier : ceux que REFUS_ENREGISTREMENT confronte à l'export (sans les neufs, le jour où il les portera).
    const hier = REFUS_ENREGISTREMENT.filter((r) => !CLES_NEUVES.has(r.cle))
    expect(hier.map((r) => r.modele)).toEqual(messagesSql(fonction(RETOUR, 'enregistrer_encaissement')))
    const attendus = refusAvecLesNeufs(hier, REFUS_ENCAISSEMENT_D_UNE_REPRISE).map((r) => r.modele)
    expect(messagesSql(fonction(MIGRATION, 'enregistrer_encaissement'))).toEqual(attendus)
    expect(attendus).toHaveLength(hier.length + 4)
  })

  it('chaque refus neuf en 22023, et ceux d’hier sous leur code d’hier', () => {
    const hier = REFUS_ENREGISTREMENT.filter((r) => !CLES_NEUVES.has(r.cle))
    const avec = refusAvecLesNeufs(hier, REFUS_ENCAISSEMENT_D_UNE_REPRISE)
    const codesHier = codesSql(fonction(RETOUR, 'enregistrer_encaissement'))
    const codes = codesSql(fonction(MIGRATION, 'enregistrer_encaissement'))
    expect(codes).toHaveLength(avec.length)
    let k = 0
    avec.forEach((r, i) => expect(codes[i], r.cle).toBe(CLES_NEUVES.has(r.cle) ? '22023' : codesHier[k++]))
  })

  it('un refus d’hier introuvable lève, plutôt que de placer un neuf ailleurs', () => {
    expect(() => refusAvecLesNeufs([{ cle: 'acces', modele: 'x' }], REFUS_ENCAISSEMENT_D_UNE_REPRISE)).toThrow(/rejetee/)
  })
})

describe('enregistrer_facture : l’avoir d’une facture reprise', () => {
  it('les refus d’hier (le texte de l’export, que le retour rend), les deux neufs après « Un avoir ne précède pas »', () => {
    const hier = messagesSql(fonction(RETOUR, 'enregistrer_facture')).map((m) => ({ cle: m, modele: m }))
    expect(hier.filter((r) => r.modele === AVOIR_NE_PRECEDE_PAS)).toHaveLength(1)
    const attendus = refusAvecLesNeufs(hier, REFUS_AVOIR_D_UNE_REPRISE).map((r) => r.modele)
    expect(messagesSql(fonction(MIGRATION, 'enregistrer_facture'))).toEqual(attendus)
  })

  it('les trois chaînes que la garde de tête de la numérotation qui continue (A9a) lit d’elle sont intactes', () => {
    const texte = fonction(MIGRATION, 'enregistrer_facture')
    for (const chaine of [
      'v_numero := attribuer_numero_facture(p_dossier_id, extract(year from v_date_emission)::integer, v_type);',
      'v_cabinet := public.admin_du_dossier(p_dossier_id);',
      'mandataire_nom = v_mandataire',
    ]) expect(texte, chaine).toContain(chaine)
  })
})

describe('la migration et son retour se tiennent par leurs empreintes', () => {
  it('la garde de tête de la migration attend les corps que le retour rend (l’export) ; celle du retour, les corps de la migration', () => {
    const tete = empreintesDeLaGarde(MIGRATION, 'garde')
    const retourTete = empreintesDeLaGarde(RETOUR, 'garde')
    const retourFin = empreintesDeLaGarde(RETOUR, 'fin')
    for (const nom of SEPT) {
      const avant = md5(corps(fonction(RETOUR, nom)))
      const apres = md5(corps(fonction(MIGRATION, nom)))
      expect(tete.get(nom), nom).toBe(avant)
      expect(retourFin.get(nom), nom).toBe(avant)
      expect(retourTete.get(nom), nom).toBe(apres)
      expect(apres, nom).not.toBe(avant)
    }
    // La production du 10/11/2026 (des SELECT de pg_proc) : l'empreinte d'`enregistrer_facture` que la migration préparée
    // e7a attend aussi — la seconde des deux à coller se reprendra sur la première.
    expect(tete.get('enregistrer_facture')).toBe('6dc9348ceef8ae5fd72568748e60fa6b')
  })

  it('le retour retire la fonction neuve, et n’en retire aucune autre', () => {
    expect([...RETOUR.matchAll(/^drop function ([^;]+);/gmi)].map((m) => m[1])).toEqual(['public.montants_par_taux_du_document(uuid)'])
    expect(MIGRATION).not.toMatch(/^\s*drop /im)
  })
})

describe('l’essai attend les mots du module', () => {
  const texte = ESSAI.replace(/''/g, "'")
  const modele = (cle: string) =>
    [...REFUS_ENCAISSEMENT_D_UNE_REPRISE, ...REFUS_AVOIR_D_UNE_REPRISE].find((r) => r.cle === cle)?.modele ?? ''

  it('chaque refus neuf, rempli des valeurs de son étape', () => {
    for (const [cle, valeurs] of [
      ['reprise_mixte', ['R-MIXTE-1']],
      ['avant_la_reprise', ['R-SERV-1', '%s']],
      ['plafond_reprise', ['1009,99']],
      ['plafond_reprise_taux', ['10', '110,00']],
      ['plafond_reprise_taux', ['20', '899,99']],
      ['plafond_reprise_taux', ['10', '0,00']],
      ['avoir_reprise_mixte', ['R-MIXTE-1']],
      ['avoir_avant_la_reprise', ['R-BIENS-1', '%s']],
    ] as const) {
      expect(texte, `${cle} ${valeurs.join(' ')}`).toContain(remplirModele(modele(cle), valeurs))
    }
  })
})
