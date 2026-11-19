import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LIBELLES_DES_MODULES, MODULES_OPTIONNELS, refusDExtinction, refusDeFermeture, type ModuleOptionnel } from './modulesDuCabinet'
import {
  ASSURANCE_MALADIE_JUGEE_PAR_LA_BASE,
  ENCAISSEMENTS_A_DECLARER,
  RIEN_N_EST_SUPPRIME,
  casesDuCabinet,
  dossiersQuiRetiennent,
  motsDeLaConfirmation,
  optionsDesCabinets,
  phraseDeLaDependance,
  type DossierDuParc,
} from './optionsDuCabinetVue'

// L'ÉCRAN DES OPTIONS DES CABINETS (conception 56, OPT4) : le module pur, et ce qu'il tient de la migration préparée d'OPT1
// — le critère de l'extinction gardée de chaque module que l'écran sait lire, l'ordre des dossiers nommés, l'ordre des
// deux refus de la fermeture, les paramètres de `regler_option_du_cabinet` —, confronté au TEXTE de la migration. Les mots
// des refus eux-mêmes sont ceux de lib/modulesDuCabinet.ts, que modulesDuCabinet.test.ts confronte déjà.

const MIGRATION = readFileSync(new URL('../../supabase/preparees/20261119130000_options_des_cabinets.sql', import.meta.url), 'utf8')
const REGLER = /create function public\.regler_option_du_cabinet\([\s\S]*?\n\$\$;\n/.exec(MIGRATION)?.[0] ?? ''
const LECTURE = readFileSync(new URL('./optionsDesCabinetsLecture.ts', import.meta.url), 'utf8')

const TOUS: readonly ModuleOptionnel[] = MODULES_OPTIONNELS

const dossier = (d: Partial<DossierDuParc>): DossierDuParc => ({
  id: 'd0', cabinet_id: 'c1', nom: 'Dossier', ventes_par_les_factures: false, ...d,
})

describe('ce que l’écran tient de la migration', () => {
  it('la migration est lue : la fonction de réglage est là', () => {
    expect(REGLER.length).toBeGreaterThan(1000)
  })

  it('la facturation est retenue par un dossier basculé, la facture électronique par un envoi des deux tables, l’assurance maladie par la base seule', () => {
    expect(REGLER).toMatch(/if p_module = 'facturation' then[\s\S]*?where d\.cabinet_id = p_cabinet_id and d\.ventes_par_les_factures;/)
    expect(REGLER).toMatch(/elsif p_module = 'facture_electronique' then[\s\S]*?public\.transmissions_factures t where t\.dossier_id = d\.id and t\.etat = 'envoi'[\s\S]*?public\.transmissions_encaissements t where t\.dossier_id = d\.id and t\.etat = 'envoi'/)
    // L'assurance maladie, par une table que la base seule lit, sous condition qu'elle existe : l'écran ne la juge pas.
    expect(REGLER).toMatch(/elsif p_module = 'assurance_maladie' and to_regclass\('public\.[a-z_]+'\) is not null then/)
    // Et la lecture de l'écran lit les mêmes : la bascule des dossiers, et les envois des deux tables à l'état `envoi`.
    expect(LECTURE).toMatch(/from\('dossiers'\)\.select\('id, cabinet_id, nom, ventes_par_les_factures'/)
    expect(LECTURE).toMatch(/from\('transmissions_factures'\)[\s\S]*?\.eq\('etat', 'envoi'\)/)
    expect(LECTURE).toMatch(/from\('transmissions_encaissements'\)[\s\S]*?\.eq\('etat', 'envoi'\)/)
  })

  it('les dossiers se nomment dans l’ordre de la base : le nom en collate "C", puis l’identifiant', () => {
    expect(REGLER.match(/order by d\.nom collate "C", d\.id/g)).toHaveLength(3)
    const dossiers = [
      dossier({ id: 'b', nom: 'émile', ventes_par_les_factures: true }),
      dossier({ id: 'z', nom: 'Zoé', ventes_par_les_factures: true }),
      dossier({ id: 'a', nom: 'Zoé', ventes_par_les_factures: true }),
      dossier({ id: 'c', nom: 'abel', ventes_par_les_factures: true }),
      dossier({ id: 'x', cabinet_id: 'autre', nom: 'Ailleurs', ventes_par_les_factures: true }),
    ]
    // En « C », les majuscules avant les minuscules, et une lettre accentuée après toutes.
    expect(dossiersQuiRetiennent('facturation', 'c1', dossiers, new Set())).toEqual(['Zoé', 'Zoé', 'abel', 'émile'])
    expect(dossiersQuiRetiennent('facturation', 'c1', dossiers, new Set())?.length).toBe(4)
  })

  it('fermer se refuse d’abord sous un module qui le suppose, puis sous un dossier : l’ordre de la fonction', () => {
    const modules = REGLER.indexOf('ne se ferme pas tant qu')
    const dossiers = REGLER.indexOf('Le module « % » ne se ferme pas : %')
    expect(modules).toBeGreaterThan(0)
    expect(dossiers).toBeGreaterThan(modules)
    const cases = casesDuCabinet(TOUS, () => ['Dossier basculé'])
    const facturation = cases.find((c) => c.module === 'facturation')!
    expect(facturation.refus).toBe(refusDeFermeture('facturation', TOUS))
    const sansHonoraires = casesDuCabinet(TOUS.filter((m) => m !== 'honoraires'), () => ['Dossier basculé'])
    expect(sansHonoraires.find((c) => c.module === 'facturation')!.refus).toBe(refusDExtinction('facturation', ['Dossier basculé']))
  })

  it('l’écran appelle la fonction sous ses trois paramètres', () => {
    expect(REGLER).toMatch(/^create function public\.regler_option_du_cabinet\(p_cabinet_id uuid, p_module text, p_ouverte boolean\)/i)
    expect(LECTURE).toMatch(/rpc\('regler_option_du_cabinet', \{ p_cabinet_id: cabinetId, p_module: module, p_ouverte: ouverte \}\)/)
  })
})

describe('les options d’un cabinet, lues de ses lignes', () => {
  it('une ligne absente est un module fermé ; aucune ligne, le cabinet est neuf (le socle seul)', () => {
    const lues = optionsDesCabinets(['c1', 'c2'], [
      { cabinet_id: 'c1', module: 'honoraires', ouverte: true },
      { cabinet_id: 'c1', module: 'facturation', ouverte: true },
      { cabinet_id: 'c1', module: 'tenue', ouverte: false },
    ])
    expect(lues.get('c1')).toEqual({ etat: 'lues', ouverts: ['facturation', 'honoraires'], neuf: false })
    expect(lues.get('c2')).toEqual({ etat: 'lues', ouverts: [], neuf: true })
  })

  it('une ligne d’une forme inconnue ou un module rendu deux fois rend le cabinet illisible, lui seul', () => {
    const lues = optionsDesCabinets(['c1', 'c2', 'c3'], [
      { cabinet_id: 'c1', module: 'compta', ouverte: true },
      { cabinet_id: 'c2', module: 'tenue', ouverte: true },
      { cabinet_id: 'c2', module: 'tenue', ouverte: false },
      { cabinet_id: 'c3', module: 'tenue', ouverte: 'oui' },
      { cabinet_id: 'inconnu', module: 'tenue', ouverte: true },
    ])
    expect(lues.get('c1')?.etat).toBe('illisibles')
    expect(lues.get('c2')).toEqual({ etat: 'illisibles', motif: 'un module est rendu deux fois' })
    expect(lues.get('c3')?.etat).toBe('illisibles')
    expect(lues.has('inconnu')).toBe(false)
  })
})

describe('les cases d’un cabinet', () => {
  it('huit cases dans l’ordre de la liste ; ouvrir les honoraires ouvre aussi la facturation, dit sous la case', () => {
    const cases = casesDuCabinet([], () => [])
    expect(cases.map((c) => c.module)).toEqual([...MODULES_OPTIONNELS])
    expect(cases.every((c) => c.geste === 'ouvrir' && c.refus === null)).toBe(true)
    const honoraires = cases.find((c) => c.module === 'honoraires')!
    expect(honoraires.ouvreAussi).toEqual(['facturation'])
    expect(phraseDeLaDependance(honoraires)).toBe('Suppose « Facturation ».')
    expect(phraseDeLaDependance(cases[0])).toBeNull()
    // La facturation déjà ouverte : les honoraires n'ouvrent rien d'autre.
    expect(casesDuCabinet(['facturation'], () => []).find((c) => c.module === 'honoraires')!.ouvreAussi).toEqual([])
  })

  it('un module que rien ne retient se ferme ; l’assurance maladie, que l’écran ne sait pas juger, s’offre et la base dira', () => {
    const cases = casesDuCabinet(TOUS, (m) => dossiersQuiRetiennent(m, 'c1', [dossier({ ventes_par_les_factures: true })], new Set(['d0'])))
    const refus = Object.fromEntries(cases.map((c) => [c.module, c.refus]))
    expect(refus.tenue).toBeNull()
    expect(refus.assurance_maladie).toBeNull()
    expect(refus.facture_electronique).toBe(
      'Le module « Facture électronique » ne se ferme pas : une facture ou une déclaration d\'encaissement de ces dossiers est partie vers une plateforme sans issue connue : « Dossier ».',
    )
    expect(refus.facturation).toMatch(/^Le module « Facturation » ne se ferme pas tant qu'un module qui le suppose est ouvert : « Honoraires du cabinet »\.$/)
    expect(dossiersQuiRetiennent('assurance_maladie', 'c1', [], new Set())).toBeNull()
    expect(dossiersQuiRetiennent('tenue', 'c1', [dossier({ ventes_par_les_factures: true })], new Set(['d0']))).toEqual([])
  })
})

describe('les mots de la confirmation', () => {
  const cases = casesDuCabinet(['facturation', 'facture_electronique', 'assurance_maladie'], () => [])
  const caseDe = (m: ModuleOptionnel) => cases.find((c) => c.module === m)!

  it('ouvrir nomme le cabinet, le module, ce qui s’ouvre, et ce qui s’ouvre avec lui', () => {
    const mots = motsDeLaConfirmation('Cabinet Fictif', casesDuCabinet([], () => []).find((c) => c.module === 'honoraires')!)
    expect(mots.titre).toBe('Ouvrir le module « Honoraires du cabinet » au cabinet « Cabinet Fictif » ?')
    expect(mots.phrases[0]).toMatch(/^Ce qui s’ouvre aux écrans du cabinet « Cabinet Fictif » : Le dossier du cabinet/)
    expect(mots.phrases[1]).toBe('S’ouvre aussi, que ce module suppose : « Facturation ».')
    expect(mots.bouton).toBe('Ouvrir le module')
  })

  it('fermer nomme ce qui disparaît des écrans, dit que rien n’est supprimé, et ce que l’écran ne juge pas', () => {
    const facturation = motsDeLaConfirmation('Cabinet Fictif', caseDe('facturation'))
    expect(facturation.titre).toBe(`Fermer le module « ${LIBELLES_DES_MODULES.facturation} » au cabinet « Cabinet Fictif » ?`)
    expect(facturation.phrases).toEqual([
      expect.stringMatching(/^Ce qui disparaît des écrans du cabinet « Cabinet Fictif » et de ses clients : Les factures/),
      RIEN_N_EST_SUPPRIME,
    ])
    expect(motsDeLaConfirmation('X', caseDe('facture_electronique')).phrases).toContain(ENCAISSEMENTS_A_DECLARER)
    expect(motsDeLaConfirmation('X', caseDe('assurance_maladie')).phrases).toContain(ASSURANCE_MALADIE_JUGEE_PAR_LA_BASE)
    expect(facturation.bouton).toBe('Fermer le module')
  })
})
