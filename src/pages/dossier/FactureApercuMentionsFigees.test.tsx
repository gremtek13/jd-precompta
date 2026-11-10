import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FactureApercu from './FactureApercu'
import { factureFigee, IBAN_ESSAI } from '../../test/mentionsFigees'
import { empreinteDe, logoDe } from '../../test/logoFictif'
import { SIRET_VENDEUR, TVA_VENDEUR } from '../../test/facturesCii'
import { FACTURE_D_AVANT, INDEMNITE_DE_RECOUVREMENT } from '../../lib/mentionsFigeesVue'
import { formatMoney } from '../../lib/format'
import { MENTIONS_DES_REGIMES } from '../../lib/factureInternationale'
import type { DossierCii } from '../../lib/factureCii'

// L'APERÇU D'UNE FACTURE QUI A FIGÉ SES MENTIONS (étape A7b) — le document qu'on imprime et qu'on envoie, le même aux deux
// espaces. Ce que ces cas gardent : il n'imprime que les colonnes FIGÉES de la facture — une valeur du dossier changée après la
// validation (son statut de TVA, son identité, ses paramètres) ne change rien —, le logo seulement vérifié à son empreinte
// figée, l'unité et la référence des lignes ; une facture d'avant s'imprime comme hier, et l'écran — jamais le papier — le
// dit ; le drapeau baissé, tout s'imprime comme hier. Données FICTIVES.

const faux = vi.hoisted(() => ({
  lignes: [] as Record<string, unknown>[],
  seau: new Map<string, Blob>(),
  telechargements: [] as string[],
  urls: [] as string[],
  revoquees: [] as string[],
  figees: true,
  international: false,
}))

vi.mock('../../lib/mentionsFigees', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/mentionsFigees')>()),
  get MENTIONS_FIGEES_EXPORTEES() { return faux.figees },
}))

// Le client établi hors de France (étape e7b) : `FACTURE_INTERNATIONALE_EXPORTEE` joué par un accesseur, BAISSÉ par défaut —
// chaque cas d'hier s'y rejoue tel quel ; levé, le bloc qui suit.
vi.mock('../../lib/factureInternationale', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/factureInternationale')>()),
  get FACTURE_INTERNATIONALE_EXPORTEE() { return faux.international },
}))

// `ACOMPTES_PREVUS` forcé BAISSÉ : ces cas éprouvent l'écran d'avant l'acompte d'un devis, qui reste éprouvé tant que son
// code existe ; leur faux client ne sert pas les lectures de l'acompte. Le drapeau levé : FactureApercuAcompte.test.tsx.
vi.mock('../../lib/devis', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/devis')>()),
  ACOMPTES_PREVUS: false,
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table !== 'facture_lignes') throw new Error(`Table non attendue dans ce test : ${table}`)
      const requete = { select: () => requete, eq: () => requete, order: () => Promise.resolve({ data: faux.lignes, error: null }) }
      return requete
    },
    storage: {
      from: (seau: string) => {
        if (seau !== 'ventes') throw new Error(`Seau non attendu dans ce test : ${seau}`)
        return {
          download: async (chemin: string) => {
            faux.telechargements.push(chemin)
            const fichier = faux.seau.get(chemin)
            return fichier ? { data: fichier, error: null } : { data: null, error: { status: 404, message: 'Object not found' } }
          },
        }
      },
    },
  },
}))

// Le dossier tel que la page le lit AUJOURD'HUI : il a changé depuis la validation — franchisé sans numéro de TVA. Une facture
// figée n'en tient aucun compte.
const DOSSIER_CHANGE: DossierCii = { statut_tva: 'franchise', article_exoneration: null, numero_tva_attribue: false }
const LIGNE = { id: 'l1', facture_id: 'f1', ordre: 0, designation: 'Séance d’essai', quantite: 2, prix_unitaire_ht: 50, taux_tva: 20, unite: 'HUR', reference: 'SEA-01', nature: 'services', article_id: 'a1' }

beforeEach(() => {
  faux.lignes = [LIGNE]
  faux.seau = new Map()
  faux.telechargements = []
  faux.urls = []
  faux.revoquees = []
  faux.figees = true
  faux.international = false
  // jsdom n'a pas de fabrique d'adresses d'objet : une fausse, qui note ce qu'elle crée et ce qu'on révoque.
  URL.createObjectURL = () => { const url = `blob:logo-${faux.urls.length + 1}`; faux.urls.push(url); return url }
  URL.revokeObjectURL = (url: string) => { faux.revoquees.push(url) }
})
afterEach(() => cleanup())

const texte = () => (document.querySelector('.facture-imprimable')?.textContent ?? '').replace(/[  ]/g, ' ')
// Ce que le papier porte : la carte, moins ce que l'impression retire (la rangée des boutons, les avis de l'écran).
function papier(): string {
  const carte = document.querySelector('.facture-imprimable')!.cloneNode(true) as HTMLElement
  carte.querySelectorAll('.facture-imprimable-actions, .facture-imprimable-avis').forEach((n) => n.remove())
  return (carte.textContent ?? '').replace(/[  ]/g, ' ')
}
const lisible = (t: string) => t.replace(/[  ]/g, ' ')

describe('l’aperçu d’une facture figée n’imprime que ses colonnes figées', () => {
  it('le nom légal, l’identité, le numéro de TVA écrit par la base — même sous un dossier qui a changé depuis', async () => {
    render(<FactureApercu facture={factureFigee({ forme_juridique: '5710', capital: 1000, rcs_ville: 'Lyon', mentions_identite: 'Capital variable', denomination_imprimee: 'Essai SAS' })} dossier={DOSSIER_CHANGE} onClose={() => {}} />)
    await screen.findByText('Séance d’essai')
    const p = papier()
    expect(p).toContain('Essai SAS')
    expect(p).not.toContain('Nom interne du dossier')
    expect(p).toContain(lisible(`SAS, société par actions simplifiée au capital de ${formatMoney(1000)}`))
    expect(p).toContain('RCS Lyon 123 456 782')
    expect(p).toContain('Capital variable')
    expect(p).toContain(`SIRET ${SIRET_VENDEUR}`)
    // Le dossier, aujourd'hui franchisé sans numéro, n'imprimerait aucun numéro : la facture garde le sien.
    expect(p).toContain(`N° TVA intracommunautaire ${TVA_VENDEUR}`)
  })

  it('un numéro de TVA que la facture n’a pas figé ne s’imprime pas, même sous un dossier redevable aujourd’hui', async () => {
    render(<FactureApercu facture={factureFigee({ numero_tva_imprime: null })} dossier={{ statut_tva: 'redevable', article_exoneration: null, numero_tva_attribue: false }} onClose={() => {}} />)
    await screen.findByText('Séance d’essai')
    expect(papier()).not.toMatch(/N° TVA intracommunautaire/)
  })

  it('les conditions de paiement d’un professionnel, l’indemnité, le RIB figé, les mentions complémentaires, le pied de page', async () => {
    render(<FactureApercu facture={factureFigee()} dossier={DOSSIER_CHANGE} onClose={() => {}} />)
    await screen.findByText('Séance d’essai')
    const p = papier()
    for (const attendu of [
      'Moyen de paiement préféré : virement.', 'Pas d’escompte pour paiement anticipé.',
      'Pénalités de retard : trois fois le taux d’intérêt légal.', lisible(INDEMNITE_DE_RECOUVREMENT),
      'Coordonnées bancaires', 'IBAN FR76 9999 9000 0100 0000 0000 600', 'BIC ESSAFR10', 'Titulaire du compte : CAMILLE ESSAI',
      'Membre d’une association agréée.', 'Camille Essai EI — merci de votre confiance',
    ]) expect(p, attendu).toContain(attendu)
    expect(p).toContain('Camille Essai EI')
  })

  it('à un particulier : ni escompte, ni pénalités, ni indemnité ; le RIB et le moyen préféré, si', async () => {
    render(<FactureApercu facture={factureFigee({ type_client: 'non_assujetti' })} dossier={DOSSIER_CHANGE} onClose={() => {}} />)
    await screen.findByText('Séance d’essai')
    const p = papier()
    expect(p).not.toContain('Pénalités de retard')
    expect(p).not.toContain('escompte')
    expect(p).not.toContain('Indemnité forfaitaire')
    expect(p).toContain('Moyen de paiement préféré : virement.')
    expect(p).toContain(`IBAN FR76 9999 9000 0100 0000 0000 600`)
    expect(IBAN_ESSAI.startsWith('FR76')).toBe(true)
  })

  it('sans RIB figé, aucun RIB — même si le dossier en a un aujourd’hui (rien n’est relu)', async () => {
    render(<FactureApercu facture={factureFigee({ iban_imprime: null, bic_imprime: null, titulaire_imprime: null, rib_parametres_id: null })} dossier={DOSSIER_CHANGE} onClose={() => {}} />)
    await screen.findByText('Séance d’essai')
    expect(papier()).not.toMatch(/IBAN|Coordonnées bancaires/)
  })

  it('l’unité et la référence de chaque ligne', async () => {
    faux.lignes = [LIGNE, { ...LIGNE, id: 'l2', ordre: 1, designation: 'Forfait', unite: null, reference: null }]
    render(<FactureApercu facture={factureFigee()} dossier={DOSSIER_CHANGE} onClose={() => {}} />)
    await screen.findByText('Forfait')
    expect(screen.getByRole('columnheader', { name: 'Unité' })).toBeTruthy()
    expect(Array.from(document.querySelectorAll('td[data-libelle="Unité"]')).map((c) => c.textContent)).toEqual(['heure', ''])
    expect(screen.getByText('Réf. SEA-01')).toBeTruthy()
  })

  it('le numéro d’engagement s’imprime pour tout acheteur, sous « Bon de commande » hors d’un organisme public (A7B-Q3)', async () => {
    render(<FactureApercu facture={factureFigee({ type_client: 'assujetti', numero_engagement: 'BC-42' })} dossier={DOSSIER_CHANGE} onClose={() => {}} />)
    await screen.findByText('Séance d’essai')
    expect(papier()).toContain('Bon de commande : BC-42')
    expect(papier()).not.toContain('Numéro d’engagement')
  })

  it('aucun avis à l’écran pour une facture figée sans logo', async () => {
    render(<FactureApercu facture={factureFigee()} dossier={DOSSIER_CHANGE} onClose={() => {}} />)
    await screen.findByText('Séance d’essai')
    expect(document.querySelector('.facture-imprimable-avis')).toBeNull()
  })
})

// LE MANDAT (étape P4) : une facture que le cabinet a validée (`mandataire_nom` figé) imprime sous l'identité de l'émetteur « Facture
// établie par <cabinet> au nom et pour le compte de <nom légal> » — « Avoir établi par … » pour un avoir —, le même aux deux
// espaces ; sans mandataire, une facture d'avant, ou le drapeau baissé, rien.
describe('le mandat de facturation s’imprime sous l’identité de l’émetteur', () => {
  const MENTION = 'Facture établie par Cabinet Fictif au nom et pour le compte de Camille Essai EI'
  const dossier = DOSSIER_CHANGE

  it('une facture validée par le cabinet : la mention, juste sous l’identité de l’émetteur et avant le client', async () => {
    render(<FactureApercu facture={factureFigee({ mandataire_nom: 'Cabinet Fictif' })} dossier={dossier} onClose={() => {}} />)
    await screen.findByText('Séance d’essai')
    const p = papier()
    expect(p).toContain(MENTION)
    expect(p.indexOf(`N° TVA intracommunautaire ${TVA_VENDEUR}`)).toBeLessThan(p.indexOf(MENTION))
    expect(p.indexOf(MENTION)).toBeLessThan(p.indexOf('Facturé à'))
    // Aucune mise en page en ligne : ce qui s'imprime ne la porte pas (CLAUDE.md).
    const noeud = Array.from(document.querySelectorAll('.facture-imprimable div')).find((n) => n.textContent === MENTION)!
    expect(noeud.getAttribute('style')).toBeNull()
  })

  it('le nom légal est celui que l’aperçu imprime pour l’émetteur : la dénomination figée, sinon le nom de la facture', async () => {
    render(<FactureApercu facture={factureFigee({ mandataire_nom: 'Cabinet Fictif', denomination_imprimee: null })} dossier={dossier} onClose={() => {}} />)
    await screen.findByText('Séance d’essai')
    expect(papier()).toContain('Facture établie par Cabinet Fictif au nom et pour le compte de Nom interne du dossier')
  })

  it('un avoir : « Avoir établi par … »', async () => {
    render(<FactureApercu facture={factureFigee({ type: 'avoir', numero: 'A2027-0001', mandataire_nom: 'Cabinet Fictif' })} dossier={dossier} onClose={() => {}} />)
    await screen.findByText('Séance d’essai')
    expect(papier()).toContain('Avoir établi par Cabinet Fictif au nom et pour le compte de Camille Essai EI')
    expect(papier()).not.toContain('Facture établie par')
  })

  it('sans mandataire figé (le client « Ventes » a validé) : rien', async () => {
    render(<FactureApercu facture={factureFigee({ mandataire_nom: null })} dossier={dossier} onClose={() => {}} />)
    await screen.findByText('Séance d’essai')
    expect(papier()).not.toMatch(/établie? par|au nom et pour le compte/)
  })

  it('une facture d’avant A7 s’imprime comme hier, même si sa colonne porte un nom ; le drapeau baissé aussi', async () => {
    render(<FactureApercu facture={factureFigee({ mentions_figees: false, mandataire_nom: 'Cabinet Fictif' })} dossier={dossier} onClose={() => {}} />)
    await screen.findByText('Séance d’essai')
    expect(papier()).not.toMatch(/établie? par|au nom et pour le compte/)
    cleanup()
    faux.figees = false
    render(<FactureApercu facture={factureFigee({ mandataire_nom: 'Cabinet Fictif' })} dossier={dossier} onClose={() => {}} />)
    await screen.findByText('Séance d’essai')
    expect(papier()).not.toMatch(/établie? par|au nom et pour le compte/)
  })
})

describe('le client établi hors de France : ses colonnes figées et la mention de son régime (étape e7b)', () => {
  const AUTOLIQUIDEE = { client_pays: 'DE', client_numero_tva: 'DE123456789', regime_international: 'autoliquidation_ue' as const, type_client: 'etranger' as const }

  it('drapeau levé, une facture figée imprime le pays, le numéro de TVA du client et la mention de son régime', async () => {
    faux.international = true
    render(<FactureApercu facture={factureFigee(AUTOLIQUIDEE)} dossier={DOSSIER_CHANGE} onClose={() => {}} />)
    await screen.findByText('Séance d’essai')
    const p = papier()
    expect(p).toContain('Pays : DE')
    expect(p).toContain('N° TVA DE123456789')
    expect(p).toContain(MENTIONS_DES_REGIMES.autoliquidation_ue)
  })

  it('drapeau baissé, la même facture s’imprime comme hier ; levé, une facture d’avant et une facture sans ces colonnes aussi', async () => {
    const hier = (f: Parameters<typeof factureFigee>[0]) => {
      render(<FactureApercu facture={factureFigee(f)} dossier={DOSSIER_CHANGE} onClose={() => {}} />)
      return screen.findByText('Séance d’essai').then(() => { const p = papier(); cleanup(); return p })
    }
    const sansRien = await hier({ type_client: 'etranger' })
    const baisse = await hier(AUTOLIQUIDEE)
    expect(baisse).toBe(sansRien)
    expect(baisse).not.toContain(MENTIONS_DES_REGIMES.autoliquidation_ue)
    faux.international = true
    expect(await hier({ type_client: 'etranger' })).toBe(sansRien)
    const dAvant = await hier({ ...AUTOLIQUIDEE, mentions_figees: false })
    expect(dAvant).not.toContain('Pays : DE')
    expect(dAvant).not.toContain(MENTIONS_DES_REGIMES.autoliquidation_ue)
  })
})

describe('le logo figé, vérifié à son empreinte figée avant toute image', () => {
  it('le fichier qui rend l’empreinte figée s’affiche ; l’adresse d’objet est révoquée au démontage', async () => {
    const octets = logoDe(1)
    const empreinte = await empreinteDe(octets)
    const chemin = `d1/logos/${empreinte}.png`
    faux.seau.set(chemin, new Blob([octets]))
    render(<FactureApercu facture={factureFigee({ logo_chemin: chemin, logo_sha256: empreinte })} dossier={DOSSIER_CHANGE} onClose={() => {}} />)
    const image = await screen.findByAltText('Logo') as HTMLImageElement
    expect(image.getAttribute('src')).toBe('blob:logo-1')
    expect(document.querySelector('.facture-imprimable-avis')).toBeNull()
    cleanup()
    expect(faux.revoquees).toEqual(['blob:logo-1'])
  })

  it('un fichier qui ne rend PAS l’empreinte figée (le logo a changé) ne s’affiche pas, et l’écran le dit', async () => {
    const empreinteFigee = await empreinteDe(logoDe(1))
    const chemin = `d1/logos/${empreinteFigee}.png`
    // Le fichier sous ce nom n'est pas celui que la facture a figé.
    faux.seau.set(chemin, new Blob([logoDe(2)]))
    render(<FactureApercu facture={factureFigee({ logo_chemin: chemin, logo_sha256: empreinteFigee })} dossier={DOSSIER_CHANGE} onClose={() => {}} />)
    await waitFor(() => expect(texte()).toMatch(/n’est pas le logo que la facture a figé \(son empreinte diffère\) : il ne s’imprime pas/))
    expect(screen.queryByAltText('Logo')).toBeNull()
    expect(faux.urls).toEqual([])
    // L'avis est de l'écran : le papier ne le porte pas.
    expect(papier()).not.toMatch(/empreinte/)
  })

  it('un fichier absent du stockage : rien ne s’affiche, et l’écran le dit', async () => {
    const empreinte = await empreinteDe(logoDe(3))
    render(<FactureApercu facture={factureFigee({ logo_chemin: `d1/logos/${empreinte}.png`, logo_sha256: empreinte })} dossier={DOSSIER_CHANGE} onClose={() => {}} />)
    await waitFor(() => expect(texte()).toMatch(/n’est pas \(ou plus\) rendu par le stockage/))
    expect(screen.queryByAltText('Logo')).toBeNull()
  })
})

describe('une facture d’avant s’imprime comme hier, et l’écran — jamais le papier — le dit', () => {
  it('le nom qu’elle porte, le numéro de TVA du jour, sans conditions ni RIB ; l’avis de l’écran', async () => {
    const dAvant = factureFigee({ mentions_figees: false, denomination_imprimee: null, numero_tva_imprime: null, iban_imprime: null, escompte: null, penalites: null, moyen_prefere: null, mentions_complementaires: null, pied_de_page: null, parametres_id: null, bic_imprime: null, titulaire_imprime: null, rib_parametres_id: null })
    render(<FactureApercu facture={dAvant} dossier={{ statut_tva: 'redevable', article_exoneration: null, numero_tva_attribue: false }} onClose={() => {}} />)
    await screen.findByText('Séance d’essai')
    expect(document.querySelector('.facture-imprimable-avis')?.textContent).toContain(FACTURE_D_AVANT)
    const p = papier()
    expect(p).toContain('Nom interne du dossier')
    expect(p).toContain(`N° TVA intracommunautaire ${TVA_VENDEUR}`)
    expect(p).not.toMatch(/Coordonnées bancaires|Moyen de paiement|Indemnité|Réf\./)
    expect(screen.queryByRole('columnheader', { name: 'Unité' })).toBeNull()
  })
})

describe('le drapeau baissé : tout s’imprime comme hier, même une facture figée', () => {
  it('le nom qu’elle porte, le numéro de TVA recalculé du dossier, rien de figé, aucun avis', async () => {
    faux.figees = false
    render(<FactureApercu facture={factureFigee()} dossier={DOSSIER_CHANGE} onClose={() => {}} />)
    await screen.findByText('Séance d’essai')
    const p = papier()
    expect(p).toContain('Nom interne du dossier')
    expect(p).not.toContain('Camille Essai EI')
    expect(p).not.toMatch(/N° TVA intracommunautaire|IBAN|Unité|Réf\./)
    expect(document.querySelector('.facture-imprimable-avis')).toBeNull()
  })
})

describe('l’impression retire l’avis de l’écran', () => {
  it('index.css pose la règle de l’écran avant le bloc d’impression, qui la cache', () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../index.css'), 'utf8')
    const impression = css.indexOf('@media print {')
    expect(css.indexOf('.facture-imprimable-avis {')).toBeGreaterThan(-1)
    expect(css.indexOf('.facture-imprimable-avis {')).toBeLessThan(impression)
    expect(css.slice(impression)).toMatch(/\.facture-imprimable-avis \{ display: none; \}/)
  })

  it('l’avis ne porte aucun style en ligne, que l’impression ne saurait défaire', async () => {
    render(<FactureApercu facture={factureFigee({ mentions_figees: false })} dossier={DOSSIER_CHANGE} onClose={() => {}} />)
    await screen.findByText('Séance d’essai')
    expect(document.querySelector('.facture-imprimable-avis')!.getAttribute('style')).toBeNull()
  })
})
