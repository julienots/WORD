// Starter templates. Inserted as HTML into a blank .docx: SuperDoc converts them to native Word
// paragraphs, headings (Titre 1/2/3 styles, so the table of contents works), lists and tables.
const today = () => new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

export const TEMPLATES = [
  {
    id: 'lettre',
    name: 'Lettre',
    hint: 'Courrier formel',
    accent: '#2F5496',
    html: () => `
<p><strong>Prénom Nom</strong><br>Adresse<br>Code postal Ville<br>Téléphone · e-mail</p>
<p style="text-align:right">Destinataire<br>Adresse<br>Code postal Ville</p>
<p style="text-align:right">À Ville, le ${today()}</p>
<p><strong>Objet :</strong> objet de la lettre</p>
<p>Madame, Monsieur,</p>
<p>Corps de la lettre. Présentez ici le contexte et l'objet de votre demande.</p>
<p>Développez vos arguments dans un deuxième paragraphe.</p>
<p>Dans l'attente de votre réponse, je vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.</p>
<p style="text-align:right">Prénom Nom</p>`,
  },
  {
    id: 'cv',
    name: 'CV',
    hint: 'Curriculum vitæ',
    accent: '#c27c0e',
    html: () => `
<h1>Prénom NOM</h1>
<p>Intitulé du poste recherché<br>Ville · 06 00 00 00 00 · prenom.nom@mail.com</p>
<h2>Profil</h2>
<p>Deux ou trois phrases qui résument votre parcours, vos points forts et votre objectif.</p>
<h2>Expérience professionnelle</h2>
<h3>Poste — Entreprise (2023 – aujourd'hui)</h3>
<ul><li>Réalisation ou responsabilité principale</li><li>Résultat chiffré obtenu</li></ul>
<h3>Poste — Entreprise (2020 – 2023)</h3>
<ul><li>Réalisation ou responsabilité principale</li><li>Résultat chiffré obtenu</li></ul>
<h2>Formation</h2>
<p><strong>Diplôme</strong> — École, Ville (année)</p>
<h2>Compétences</h2>
<ul><li>Compétence technique</li><li>Langues : français (natif), anglais (courant)</li><li>Logiciels</li></ul>
<h2>Centres d'intérêt</h2>
<p>Sport, voyages, associations…</p>`,
  },
  {
    id: 'rapport',
    name: 'Rapport',
    hint: 'Avec sommaire',
    accent: '#1F3763',
    html: () => `
<h1>Titre du rapport</h1>
<p>Auteur · ${today()}</p>
<h2>1. Introduction</h2>
<p>Présentez le contexte, la problématique et les objectifs du rapport.</p>
<h2>2. Analyse</h2>
<h3>2.1 Constats</h3>
<p>Décrivez les observations principales.</p>
<h3>2.2 Données</h3>
<table><tr><th>Indicateur</th><th>Valeur</th><th>Évolution</th></tr><tr><td>Indicateur A</td><td>0</td><td>+0 %</td></tr><tr><td>Indicateur B</td><td>0</td><td>−0 %</td></tr></table>
<h2>3. Recommandations</h2>
<ol><li>Première recommandation</li><li>Deuxième recommandation</li><li>Troisième recommandation</li></ol>
<h2>4. Conclusion</h2>
<p>Synthèse et prochaines étapes.</p>`,
  },
  {
    id: 'reunion',
    name: 'Compte rendu',
    hint: 'De réunion',
    accent: '#2e7d32',
    html: () => `
<h1>Compte rendu de réunion</h1>
<p><strong>Date :</strong> ${today()}<br><strong>Lieu :</strong> …<br><strong>Participants :</strong> …<br><strong>Rédacteur :</strong> …</p>
<h2>Ordre du jour</h2>
<ol><li>Point 1</li><li>Point 2</li><li>Questions diverses</li></ol>
<h2>Discussions</h2>
<p>Résumé des échanges pour chaque point.</p>
<h2>Décisions</h2>
<ul><li>Décision prise</li></ul>
<h2>Actions à mener</h2>
<table><tr><th>Action</th><th>Responsable</th><th>Échéance</th></tr><tr><td>…</td><td>…</td><td>…</td></tr><tr><td>…</td><td>…</td><td>…</td></tr></table>
<p><strong>Prochaine réunion :</strong> …</p>`,
  },
  {
    id: 'facture',
    name: 'Facture',
    hint: 'Devis / facture',
    accent: '#b71c1c',
    html: () => `
<h1>FACTURE N° 0001</h1>
<p><strong>Votre entreprise</strong><br>Adresse · SIRET · TVA</p>
<p style="text-align:right"><strong>Client</strong><br>Nom · Adresse</p>
<p>Date : ${today()}<br>Échéance : 30 jours</p>
<table><tr><th>Désignation</th><th>Qté</th><th>Prix unitaire HT</th><th>Total HT</th></tr><tr><td>Prestation</td><td>1</td><td>0,00 €</td><td>0,00 €</td></tr><tr><td></td><td></td><td>Total HT</td><td>0,00 €</td></tr><tr><td></td><td></td><td>TVA 20 %</td><td>0,00 €</td></tr><tr><td></td><td></td><td>Total TTC</td><td>0,00 €</td></tr></table>
<p>Conditions de paiement : virement bancaire. IBAN : …</p>`,
  },
];

/** Convert imported plain text to simple HTML paragraphs. */
export function textToHtml(text) {
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/**
 * Prepare HTML for SuperDoc's converter:
 *  - a block ending with bold/italic leaks that formatting into the following blocks
 *    (engine quirk) → close it with an invisible zero-width space;
 *  - plain paragraphs get Word-like "8 pt after" spacing.
 */
export function prepareHtml(html, { spacing = true } = {}) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const root = tpl.content;
  for (const el of root.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,td,th')) {
    let last = el.lastChild;
    while (last && last.nodeType === 3 && !last.textContent.trim()) last = last.previousSibling;
    if (last && last.nodeType === 1 && last.tagName !== 'BR' && !/^(UL|OL|TABLE|P)$/.test(last.tagName)) {
      el.appendChild(document.createTextNode('​'));
    }
    if (spacing && el.tagName === 'P' && !el.closest('td,th,li') && !/margin/.test(el.getAttribute('style') || '')) {
      el.style.marginBottom = '8pt';
    }
  }
  const div = document.createElement('div');
  div.appendChild(root);
  return div.innerHTML;
}

/** Insert HTML at the very start of the body (before the first paragraph). */
export async function insertHtmlAtStart(doc, html, opts) {
  const value = prepareHtml(html, opts);
  let target;
  try {
    const f = await doc.find({ select: { type: 'node', nodeType: 'paragraph' }, limit: 1 });
    target = f?.items?.[0]?.address;
  } catch {
    /* empty document */
  }
  return doc.insert(target ? { type: 'html', value, target, placement: 'before' } : { type: 'html', value });
}

/** Small Markdown → HTML converter for imports (headings, emphasis, lists, quotes, code, links, tables, rules). */
export function mdToHtml(md) {
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const inline = (s) =>
    esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (m, t, u) => (/^(https?:|mailto:)/i.test(u) ? `<a href="${u.replace(/"/g, '%22')}">${t}</a>` : t))
      .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, '<strong>$2</strong>')
      .replace(/(\*|_)(?=\S)(.+?)(?<=\S)\1/g, '<em>$2</em>')
      .replace(/~~(.+?)~~/g, '<s>$1</s>');
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  const isTableSep = (l) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l || '');
  const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim()));
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) {
      i++;
      continue;
    }
    let m;
    if (/^```/.test(l)) {
      const code = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(esc(lines[i++]));
      i++;
      out.push(`<p style="font-family:'Courier New'">${code.join('<br>')}</p>`);
    } else if ((m = l.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/))) {
      out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`);
      i++;
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) {
      out.push('<hr>');
      i++;
    } else if (l.includes('|') && isTableSep(lines[i + 1])) {
      const head = cells(l);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
      out.push(`<table><tr>${head.map((c) => `<th>${c}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`);
    } else if (/^\s*>/.test(l)) {
      const q = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote><p>${inline(q.join(' '))}</p></blockquote>`);
    } else if (/^\s*([-*+]|\d+[.)])\s+/.test(l)) {
      const ordered = /^\s*\d/.test(l);
      const items = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
        items.push(inline(lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, '').replace(/^\[( |x)\]\s*/i, (m0, x) => (x.trim() ? '☑ ' : '☐ '))));
        i++;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((t) => `<li>${t}</li>`).join('')}</${tag}>`);
    } else {
      const para = [];
      while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|\s*>|\s*([-*+]|\d+[.)])\s+)/.test(lines[i])) para.push(lines[i++]);
      out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    }
  }
  return out.join('\n');
}
