// LES MESURES DU BANC (28/11/2026), sorties de debordements.mjs telles quelles pour que gestes.mjs mesure de même après un geste :
// le débordement du panneau central (ou de la fenêtre de la visite) et les boutons recouverts d'une fenêtre superposée. Leurs règles
// sont dites dans l'en-tête de debordements.mjs.

// Les règles du débordement (voir l'en-tête de debordements.mjs), jouées dans la page : rend les fautes, une phrase chacune.
export function mesurerLesDebordements(page, fenetre, nav) {
  return page.evaluate(({ fenetre, nav }) => {
    // Une fenêtre SUPERPOSÉE se mesure contre sa propre carte : centrée sur l'écran, elle n'a pas à tenir dans le
    // panneau central, mais rien ne doit en sortir. Sa carte défile (overflow-y), donc le défilement ne se cherche
    // qu'à l'intérieur : sinon tout son contenu passerait pour « dans un conteneur qui défile », et rien n'y serait vu.
    // Et une fenêtre qui ne s'est pas ouverte est une faute : mesurer un écran sans elle ne prouverait rien.
    const cadre = document.querySelector(fenetre ?? '.main')
    if (!cadre) return [`la fenêtre ${fenetre} ne s’est pas ouverte`]
    const main = cadre.getBoundingClientRect()
    const contenu = fenetre ? `${fenetre} *` : '.main-contenu *'
    const defile = (e) => {
      for (let p = e.parentElement; p && p !== cadre && !p.classList.contains('main'); p = p.parentElement) {
        if (['auto', 'scroll', 'hidden'].includes(getComputedStyle(p).overflowX)) return true
      }
      return false
    }
    const extrait = (e) => (e.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 60)
    // Un élément en `position: fixed` — avec tout ce qu'il porte — n'est pas posé DANS le panneau : il se place contre la
    // fenêtre du navigateur. Sur téléphone, la barre du bas (`div.nav-groupes`) est exactement aussi large que l'écran, donc
    // que le panneau, et chaque visite la citait à « 0 px hors du panneau » (64 fois à 390 px) : des fautes qui n'en étaient
    // pas, parmi lesquelles les vraies passaient inaperçues. Les mesurer contre `.main` n'a pas de sens. Mais la visite d'une
    // FENÊTRE mesure la sienne contre sa carte, et le voile de cette fenêtre est lui-même fixe : l'exclusion y viderait la mesure.
    const fixes = fenetre ? [] : [...document.querySelectorAll(contenu)].filter((e) => getComputedStyle(e).position === 'fixed')
    const trouvees = []
    for (const e of document.querySelectorAll(contenu)) {
      const r = e.getBoundingClientRect()
      if (r.width === 0 || r.height === 0 || defile(e)) continue
      if (fixes.some((f) => f.contains(e))) continue
      // La carte ou la case de grille qui le porte : le premier ancêtre qui en est une.
      const carte = e.parentElement?.closest('.card, .kpi, .widget, .cockpit, .bento > *')
      const cadreCarte = carte ? carte.getBoundingClientRect() : null
      const bord = cadreCarte ? cadreCarte.right : null
      const horsPanneau = r.right > main.right - 1
      const horsCarte = bord !== null && r.right > bord + 1
      // ET PAR LA GAUCHE (25/11/2026) : dans une rangée calée à droite (`justify-content: flex-end`), un élément plus large que la
      // rangée déborde par la GAUCHE — la carte de l'export vers un logiciel, sur téléphone, sortait de 27 px de l'écran sans
      // qu'aucune des règles ci-dessus, qui ne regardaient que le bord droit, ne la voie.
      const aGauchePanneau = r.left < main.left - 1
      const aGaucheCarte = cadreCarte !== null && r.left < cadreCarte.left - 1
      if (!horsPanneau && !horsCarte && !aGauchePanneau && !aGaucheCarte) continue
      if (trouvees.some((t) => t.el.contains(e))) continue
      const ecart = Math.round(horsPanneau ? r.right - main.right : horsCarte ? r.right - bord
        : aGauchePanneau ? main.left - r.left : cadreCarte.left - r.left)
      const ou = horsPanneau ? 'hors du panneau' : horsCarte ? 'hors de sa carte' : aGauchePanneau ? 'hors du panneau, à gauche' : 'hors de sa carte, à gauche'
      trouvees.push({ el: e, texte: `${ecart} px ${ou} — <${e.tagName.toLowerCase()}> ${extrait(e)}` })
    }
    // Un texte plus large que sa boîte : la boîte tient dans sa carte, le mot trop long en sort. Seul l'élément qui
    // porte le texte compte — ses ancêtres débordent avec lui.
    const textes = []
    for (const e of document.querySelectorAll(contenu)) {
      if (e.clientWidth === 0 || defile(e)) continue
      const style = getComputedStyle(e)
      if (style.overflowX !== 'visible' || style.display === 'inline' || e.scrollWidth <= e.clientWidth + 1) continue
      if (![...e.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim())) continue
      if (trouvees.some((t) => t.el.contains(e))) continue
      textes.push(`${e.scrollWidth - e.clientWidth} px de texte hors de sa boîte — <${e.tagName.toLowerCase()}> ${extrait(e)}`)
    }
    // Un mot coupé au milieu (voir l'en-tête). Le même cadre et la même exclusion des éléments fixes que ci-dessus, mais PAS
    // celle des conteneurs qui défilent : un mot coupé dans un `.table-scroll` l'est aussi. Un jeton est une suite sans espace
    // ORDINAIRE — `\s` compterait aussi les insécables, qui doivent rester dans le morceau —, et il se recoupe après un trait
    // d'union ou un tiret, et après une barre oblique sauf entre deux chiffres : le navigateur n'y propose aucune coupure.
    const estChiffre = (c) => c !== undefined && c >= '0' && c <= '9'
    const morceauxDe = (jeton) => {
      const bornes = []
      let debut = 0
      for (let i = 0; i < jeton.length - 1; i++) {
        const c = jeton[i]
        if ('-‐–—'.includes(c) || (c === '/' && !(estChiffre(jeton[i - 1]) && estChiffre(jeton[i + 1])))) {
          bornes.push([debut, i + 1])
          debut = i + 1
        }
      }
      bornes.push([debut, jeton.length])
      return bornes
    }
    // Le morceau tel que l'écran le coupe : une barre verticale devant chaque caractère qui tombe plus bas que le précédent.
    const rangee = document.createRange()
    const coupureDe = (n, debut, fin) => {
      let sortie = ''
      let haut = null
      let i = debut
      for (const car of n.nodeValue.slice(debut, fin)) {
        rangee.setStart(n, i)
        rangee.setEnd(n, i + car.length)
        const r = [...rangee.getClientRects()].find((x) => x.width > 0)
        if (r) {
          if (haut !== null && r.top - haut > 3) sortie += '|'
          haut = r.top
        }
        sortie += car
        i += car.length
      }
      return sortie
    }
    const coupes = []
    const marche = document.createTreeWalker(cadre, NodeFilter.SHOW_TEXT)
    for (let n = marche.nextNode(); n; n = marche.nextNode()) {
      const parent = n.parentElement
      if (!parent || !n.nodeValue.trim() || fixes.some((f) => f.contains(parent))) continue
      for (const jeton of n.nodeValue.matchAll(/[^ \t\n\r]+/g)) {
        for (const [debut, fin] of morceauxDe(jeton[0])) {
          // De 2 à 24 caractères : au-delà (adresse électronique, IBAN, référence longue), couper est admis.
          const longueur = [...jeton[0].slice(debut, fin)].length
          if (longueur < 2 || longueur > 24) continue
          rangee.setStart(n, jeton.index + debut)
          rangee.setEnd(n, jeton.index + fin)
          const sommets = [...rangee.getClientRects()].filter((r) => r.width > 0).map((r) => r.top).sort((a, b) => a - b)
          if (!sommets.some((s, i) => i > 0 && s - sommets[i - 1] > 3)) continue
          coupes.push(`mot coupé au milieu — « ${coupureDe(n, jeton.index + debut, jeton.index + fin)} » dans <${parent.tagName.toLowerCase()}> (${Math.round(parent.getBoundingClientRect().width)} px)`)
        }
      }
    }
    // LA NAVIGATION DU CLIENT (`nav`) : posée en `position: fixed` sur téléphone, elle échappe aux règles ci-dessus. Chacune
    // de ses entrées doit tenir dans sa case, et la barre dans la largeur de l'écran — cinq entrées avec « Mes ventes ».
    const entrees = []
    if (nav) {
      const barreNav = document.querySelector('.sidebar nav')
      if (!barreNav) entrees.push('la navigation du client est absente')
      else {
        const visible = getComputedStyle(barreNav).display !== 'none'
        if (visible && barreNav.scrollWidth > barreNav.clientWidth + 1) {
          entrees.push(`${barreNav.scrollWidth - barreNav.clientWidth} px de navigation hors de la barre`)
        }
        for (const a of barreNav.querySelectorAll('a')) {
          if (!visible || a.clientWidth === 0) continue
          if (a.scrollWidth > a.clientWidth + 1) entrees.push(`entrée « ${a.getAttribute('title')} » : ${a.scrollWidth - a.clientWidth} px hors de sa case`)
          const r = a.getBoundingClientRect()
          if (r.right > window.innerWidth + 1 || r.left < -1) entrees.push(`entrée « ${a.getAttribute('title')} » hors de l’écran`)
        }
        if (!visible) entrees.push('la navigation du client est cachée sur cet écran')
        // La passe du client ne mesure rien si le compte n'est pas celui qui porte « Ventes » : l'entrée doit être là.
        if (!barreNav.querySelector('a[title="Mes ventes"]')) entrees.push('l’entrée « Mes ventes » manque à la navigation')
      }
    }
    return [...trouvees.map((t) => t.texte), ...textes, ...coupes, ...entrees]
  }, { fenetre, nav })
}

// LES BOUTONS D'UNE FENÊTRE SUPERPOSÉE NE SONT RECOUVERTS PAR RIEN (14/10/2026, ligne 34.93 ; voir l'en-tête). La fenêtre est celle de
// la visite (`fenetre`), sinon toute fenêtre `[aria-modal="true"]` ; s'il y en a plusieurs, celle DU DESSUS — le plus grand `z-index` de
// son voile, à égalité la dernière du document : les boutons de celle qu'une autre recouvre le sont à bon droit. La carte est défilée
// de bout en bout, par pas d'une carte moins 60 px (une rangée de boutons tient toujours en entier dans une des positions), la
// dernière étant le bas — là où est la dernière rangée. À chaque position, chaque bouton et chaque lien dont le centre est VISIBLE
// (dans la boîte de tous les ancêtres qui rognent, `overflow`, carte comprise) est sondé au centre et au milieu de ses quatre
// bords, à 2 px du bord : `elementFromPoint` doit rendre le bouton lui-même, l'un de ses descendants ou l'un de ses ancêtres (la
// carte, le voile : ce que le bouton traverse est son propre défilement, pas un recouvrement). Un bouton est ATTEIGNABLE s'il est
// dégagé à une position au moins ; sinon c'est UN RECOUVREMENT, cité avec ce qui recouvre (un point hors de l'écran, `null`, aussi).
// Un seul point ne verrait pas la barre du bas qui mord sur le bas d'un bouton : son centre reste dégagé. Une fenêtre où aucun bouton
// n'est visible est une faute : ce serait une mesure aveugle.
export async function mesurerLesBoutons(page, fenetre) {
  return page.evaluate((fenetre) => {
    const cartes = [...document.querySelectorAll(fenetre ?? '[aria-modal="true"]')]
    if (cartes.length === 0) return { fautes: [], fenetres: 0, boutons: 0, recouverts: 0 }
    const zDe = (c) => Number.parseInt(getComputedStyle(c.parentElement).zIndex, 10) || 0
    const carte = cartes.reduce((haut, c) => {
      if (zDe(c) !== zDe(haut)) return zDe(c) > zDe(haut) ? c : haut
      return haut.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING ? c : haut
    })
    const libelle = (b) => (b.getAttribute('aria-label') || b.innerText || b.title || '').trim().replace(/\s+/g, ' ').slice(0, 40)
    const etiquette = (e) => `<${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ''}${[...e.classList].slice(0, 2).map((c) => `.${c}`).join('')}>`
    // Ce qui rogne un bouton avant qu'il atteigne l'écran : un ancêtre dont `overflow` n'est pas `visible`, jusqu'à la carte.
    const rogne = (b, x, y) => {
      for (let p = b.parentElement; p; p = p.parentElement) {
        const st = getComputedStyle(p)
        if (st.overflowX !== 'visible' || st.overflowY !== 'visible') {
          const r = p.getBoundingClientRect()
          if (x < r.left || x > r.right || y < r.top || y > r.bottom) return true
        }
        if (p === carte) break
      }
      return false
    }
    const defilementInitial = carte.scrollTop
    const bas = Math.max(carte.scrollHeight - carte.clientHeight, 0)
    const pas = Math.max(carte.clientHeight - 60, 40)
    const positions = []
    for (let p = 0; p < bas; p += pas) positions.push(p)
    positions.push(bas)
    // Pour chaque bouton : vu (visible à une position au moins), degage (dégagé à une position au moins), cause (le dernier recouvrement).
    const etat = new Map()
    for (const position of positions) {
      carte.scrollTop = position
      for (const b of carte.querySelectorAll('button, a[href]')) {
        const r = b.getBoundingClientRect()
        if (r.width === 0 || r.height === 0 || getComputedStyle(b).visibility === 'hidden') continue
        const cx = r.left + r.width / 2
        const cy = r.top + r.height / 2
        if (rogne(b, cx, cy)) continue
        const e = etat.get(b) ?? { degage: false, cause: null }
        etat.set(b, e)
        let cause = null
        for (const [x, y] of [[cx, cy], [cx, r.top + 2], [cx, r.bottom - 2], [r.left + 2, cy], [r.right - 2, cy]]) {
          const dessus = document.elementFromPoint(x, y)
          if (dessus === b || (dessus && (b.contains(dessus) || dessus.contains(b)))) continue
          const barre = dessus?.closest('.sidebar nav, .nav-groupes')
          const par = dessus === null ? 'le bord de l’écran' : barre ? `la barre du bas (${etiquette(barre)})` : etiquette(dessus)
          cause = `${par} à ${Math.round(x)}, ${Math.round(y)}`
          break
        }
        if (cause === null) e.degage = true
        else e.cause = cause
      }
    }
    carte.scrollTop = defilementInitial
    const fautes = []
    let recouverts = 0
    for (const [b, e] of etat) {
      if (e.degage) continue
      fautes.push(`bouton « ${libelle(b)} » recouvert par ${e.cause} — à aucune position de la fenêtre défilée de bout en bout`)
      recouverts++
    }
    if (etat.size === 0) fautes.push('aucun bouton visible dans la fenêtre : la mesure ne voit rien')
    return { fautes, fenetres: 1, boutons: etat.size, recouverts }
  }, fenetre)
}
