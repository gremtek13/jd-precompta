import { describe, expect, it } from 'vitest'
import {
  compteDesIssues, ecartsEnPhrases, libelleImporter, phraseDeLIssue, phrasesDuBilan, phrasesDuPlan, refusSaisie, SAISIE_VIDE,
  saisieComplete, titreDuPlan,
} from './plateformeClient'
import type { FluxVu, IssueImport, PlanReception } from './receptionPlateforme'

const flux: FluxVu = {
  id: 'f1', sens: 'achat', syntaxe: 'CII', direction: 'In', nom: 'FA-1.xml', recu_le: null,
  mis_a_jour: '2026-10-01T10:00:00.000Z', etat: 'pret',
}
const saisie = (o: Partial<typeof SAISIE_VIDE> = {}) => ({
  ...SAISIE_VIDE, nom: 'Plateforme', url_flux: 'https://pa.exemple.fr/afnor', url_jeton: 'https://pa.exemple.fr/jeton',
  client_id: 'cabinet', client_secret: 'secret', ...o,
})

describe('refusSaisie', () => {
  it('un formulaire qu’on commence à remplir ne crie pas', () => {
    expect(refusSaisie(SAISIE_VIDE)).toBeNull()
    expect(refusSaisie(saisie())).toBeNull()
  })

  it('une adresse en clair est refusée : la fonction y enverrait un secret', () => {
    expect(refusSaisie(saisie({ url_flux: 'http://pa.exemple.fr' })))
      .toBe('L’adresse du service des flux doit commencer par https:// — la fonction y envoie un secret.')
    expect(refusSaisie(saisie({ url_jeton: ' http://pa.exemple.fr/jeton ' })))
      .toBe('L’adresse des jetons doit commencer par https:// — la fonction y envoie un secret.')
    expect(refusSaisie(saisie({ url_flux: 'HTTPS://PA.EXEMPLE.FR' }))).toBeNull()
  })

  it('un nom trop long, une organisation avec une espace ou un accent', () => {
    expect(refusSaisie(saisie({ nom: 'x'.repeat(81) }))).toBe('Le nom de la plateforme tient en 80 caractères au plus.')
    expect(refusSaisie(saisie({ nom: 'x'.repeat(80) }))).toBeNull()
    expect(refusSaisie(saisie({ organisation_id: 'mon organisation' })))
      .toBe('L’organisation s’écrit sans espace ni accent : c’est une valeur d’en-tête.')
    expect(refusSaisie(saisie({ organisation_id: 'société' }))).not.toBeNull()
    expect(refusSaisie(saisie({ organisation_id: ' org-42 ' }))).toBeNull()
  })
})

describe('saisieComplete', () => {
  it('à la création, le secret est exigé ; à la modification, vide, il est gardé', () => {
    expect(saisieComplete(saisie(), true)).toBe(true)
    expect(saisieComplete(saisie({ client_secret: '  ' }), true)).toBe(false)
    expect(saisieComplete(saisie({ client_secret: '' }), false)).toBe(true)
  })

  it('le nom, les deux adresses et l’identifiant sont exigés', () => {
    for (const cle of ['nom', 'url_flux', 'url_jeton', 'client_id'] as const) {
      expect(saisieComplete(saisie({ [cle]: ' ' }), false)).toBe(false)
    }
    // L'organisation et la portée sont facultatives.
    expect(saisieComplete(saisie({ organisation_id: '', portee: '' }), true)).toBe(true)
  })
})

describe('ecartsEnPhrases', () => {
  it('rien d’écarté : rien à dire', () => {
    expect(ecartsEnPhrases({ autre_flux: 0, illisible: 0, format: 0, statut_inconnu: 0, doublons: 0 })).toEqual([])
  })

  it('chaque écart se dit avec son nombre, accordé, dans un ordre fixe', () => {
    expect(ecartsEnPhrases({ autre_flux: 3, illisible: 0, format: 1, statut_inconnu: 0, doublons: 2 })).toEqual([
      '3 messages écartés : ce ne sont pas des factures (statuts de cycle de vie, e-reporting)',
      '1 facture écartée : dans un format que l’application ne lit pas',
      '2 doublons écartés : des factures que la plateforme a listées plus d’une fois',
    ])
    expect(ecartsEnPhrases({ autre_flux: 0, illisible: 1, format: 0, statut_inconnu: 4, doublons: 0 })).toEqual([
      '1 facture écartée : sans identifiant ou sans date de mise à jour lisible',
      '4 factures écartées : la plateforme ne dit pas si elles sont prêtes',
    ])
  })

  it('au singulier, la phrase change aussi son pronom ; le pluriel commence à deux', () => {
    expect(ecartsEnPhrases({ autre_flux: 1, illisible: 2, format: 2, statut_inconnu: 1, doublons: 1 })).toEqual([
      '1 message écarté : ce n’est pas une facture (statut de cycle de vie, e-reporting)',
      '2 factures écartées : sans identifiant ou sans date de mise à jour lisible',
      '2 factures écartées : dans un format que l’application ne lit pas',
      '1 facture écartée : la plateforme ne dit pas si elle est prête',
      '1 doublon écarté : une facture que la plateforme a listée deux fois',
    ])
  })
})

describe('compteDesIssues et phraseDeLIssue', () => {
  const issues: IssueImport[] = [
    { statut: 'importee', flux, pieceId: 'p1', avertissements: [] },
    { statut: 'importee', flux, pieceId: 'p2', avertissements: ['Sans version lisible : indisponible.', 'Total de la TVA absent.'] },
    { statut: 'deja_importee', flux },
    { statut: 'doublon', flux },
    { statut: 'autre_entreprise', flux, siren: '987654321' },
    { statut: 'echec', flux, definitif: true, message: 'Cette facture n’existe plus chez la plateforme.' },
    { statut: 'echec', flux, definitif: false, message: 'Indisponible.' },
    { statut: 'interrompu', flux, raison: 'acces', message: 'La plateforme refuse l’accès.' },
  ]

  it('compte chaque issue', () => {
    expect(compteDesIssues(issues)).toEqual({ importee: 2, deja_importee: 1, doublon: 1, autre_entreprise: 1, echec: 2, interrompu: 1 })
    expect(compteDesIssues([])).toEqual({ importee: 0, deja_importee: 0, doublon: 0, autre_entreprise: 0, echec: 0, interrompu: 0 })
  })

  it('dit ce qu’il faut savoir de chacune, et ce qu’on peut y faire', () => {
    expect(issues.map(phraseDeLIssue)).toEqual([
      'importée — à vérifier : ',
      'importée — à vérifier : Sans version lisible : indisponible. Total de la TVA absent.',
      'déjà dans le dossier.',
      'son fichier est déjà au dossier : rien n’est importé une seconde fois.',
      'adressée à l’entreprise de SIREN 987654321, pas à ce dossier : elle n’est pas importée. Si le SIRET du dossier '
        + 'était faux, corrigez-le puis reprenez la recherche du début.',
      'Cette facture n’existe plus chez la plateforme. Elle ne s’importera pas telle quelle.',
      'Indisponible. Elle reviendra à la prochaine recherche.',
      'La plateforme refuse l’accès.',
    ])
  })

  it('des remarques que la note interne n’a pas gardées se disent une dernière fois, comme telles (espace client, P0)', () => {
    const issue: IssueImport = {
      statut: 'importee', flux, pieceId: 'p3', avertissements: ['Total TTC absent'], noteNonGardee: 'connexion perdue',
    }
    expect(phraseDeLIssue(issue)).toBe('importée — à vérifier : Total TTC absent Ces remarques ne sont PAS dans sa note '
      + 'interne (connexion perdue) : reportez-les dans sa fiche avant de la valider.')
    expect(compteDesIssues([issue])).toMatchObject({ importee: 1 })
  })
})

describe('le plan et le bilan en phrases accordées', () => {
  const plan = (o: Partial<PlanReception> = {}): PlanReception => ({ aImporter: [], dejaImportes: [], enAttente: [], rejetes: [], ...o })
  const compte = (o: Partial<Record<IssueImport['statut'], number>> = {}) => (
    { importee: 0, deja_importee: 0, doublon: 0, autre_entreprise: 0, echec: 0, interrompu: 0, ...o })

  it('le titre et le bouton : « Importer les 1 facture(s) » ne se lit pas', () => {
    expect(titreDuPlan(0)).toBe('Aucune nouvelle facture à importer')
    expect(titreDuPlan(1)).toBe('1 facture à importer')
    expect(titreDuPlan(2)).toBe('2 factures à importer')
    expect(libelleImporter(1)).toBe('Importer la facture')
    expect(libelleImporter(2)).toBe('Importer les 2 factures')
  })

  it('ce que la recherche a vu sans le proposer : une phrase par cas, au singulier comme au pluriel', () => {
    expect(phrasesDuPlan(plan())).toEqual([])
    expect(phrasesDuPlan(plan({ aImporter: [flux, flux] }))).toEqual([])
    expect(phrasesDuPlan(plan({ dejaImportes: [flux], enAttente: [flux], rejetes: [flux] }))).toEqual([
      '1 déjà importée : elle ne revient pas.',
      '1 encore en traitement chez la plateforme : elle reviendra à une prochaine recherche.',
      '1 rejetée par la plateforme : elle ne s’importe pas.',
    ])
    expect(phrasesDuPlan(plan({ dejaImportes: [flux, flux], enAttente: [flux, flux, flux], rejetes: [flux, flux] }))).toEqual([
      '2 déjà importées : elles ne reviennent pas.',
      '3 encore en traitement chez la plateforme : elles reviendront à une prochaine recherche.',
      '2 rejetées par la plateforme : elles ne s’importent pas.',
    ])
  })

  it('le bilan : rien d’importé se dit sans renvoyer vers Justificatifs, et l’interruption n’y est pas', () => {
    expect(phrasesDuBilan(compte())).toEqual(['Aucune facture importée.'])
    expect(phrasesDuBilan(compte({ importee: 1, deja_importee: 1, doublon: 1, autre_entreprise: 1, echec: 1, interrompu: 1 }))).toEqual([
      '1 facture importée, « à valider » dans Justificatifs.',
      '1 déjà dans le dossier.',
      '1 dont le fichier est déjà au dossier (déposé autrement) : non importée.',
      '1 adressée à une autre entreprise : non importée.',
      '1 en échec.',
    ])
    expect(phrasesDuBilan(compte({ importee: 3, deja_importee: 2, doublon: 2, autre_entreprise: 2, echec: 2 }))).toEqual([
      '3 factures importées, « à valider » dans Justificatifs.',
      '2 déjà dans le dossier.',
      '2 dont le fichier est déjà au dossier (déposé autrement) : non importées.',
      '2 adressées à une autre entreprise : non importées.',
      '2 en échec.',
    ])
  })
})
