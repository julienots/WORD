// ===== générateur de noms =====
import { pick, chance } from './util.js';
const ON = ['ka', 'lo', 'mi', 'ra', 'to', 'na', 'el', 'ar', 'su', 've', 'do', 'ri', 'ya', 'zo', 'ti', 'en', 'ul', 'ma', 'be', 'shi', 'ko', 'la', 'ny', 'or', 'ae', 'th', 'is', 'ga', 'fe', 'mo'];
const F_END = ['a', 'ia', 'ie', 'e', 'ine', 'ya', 'ra', 'lia', 'na', 'elle'];
const M_END = ['o', 'ar', 'an', 'ek', 'us', 'or', 'il', 'en', 'ok', 'im'];
const cap = (s) => s[0].toUpperCase() + s.slice(1);
export function makeName(sex) {
  let s = pick(ON); if (chance(0.6)) s += pick(ON);
  s += sex === 'F' ? pick(F_END) : pick(M_END);
  s = s.replace(/(.)\1\1/g, '$1$1');
  return cap(s.slice(0, 9));
}
const TN = ['du Lac', 'de la Pierre', 'des Cendres', 'du Vent', 'de l’Aube', 'des Racines', 'du Cerf', 'de la Source', 'du Loup', 'des Étoiles', 'de la Paroi', 'du Soleil Captif', 'des Brumes', 'de l’Ambre', 'des Collines', 'du Silence'];
const TP = ['Clan', 'Peuple', 'Tribu', 'Enfants', 'Gens', 'Lignée'];
export function makeTribeName(used = []) {
  for (let i = 0; i < 30; i++) { const n = pick(TP) + ' ' + pick(TN); if (!used.includes(n)) return n; }
  return 'Clan ' + makeName('M');
}
export const TRIBE_COLORS = ['#d9534f', '#3b7dd8', '#e0a526', '#8e44ad', '#16a085', '#e67e22', '#c0398b', '#2c9c4a', '#5d6d7e', '#00a3c4'];
