// ===== LA BULLE — constantes du monde =====
export const N = 72;                 // taille de la grille (tuiles)
export const R = 33;                 // rayon du disque habitable (tuiles)
export const CX = N / 2, CY = N / 2; // centre du disque
export const TW = 40, TH = 20;       // tuile isométrique (px)
export const LH = 7;                 // hauteur d'un niveau d'altitude (px)
export const MAXLVL = 16;
export const WATER_H = 0.36;
export const WATER_LVL = Math.round(WATER_H * MAXLVL); // 6

// Temps : l'unité de base est l'heure simulée.
export const DAYS_PER_SEASON = 6;
export const DAYS_PER_YEAR = DAYS_PER_SEASON * 4;
export const HOURS_PER_YEAR = DAYS_PER_YEAR * 24;
export const SEASONS = ['Printemps', 'Été', 'Automne', 'Hiver'];
export const SEASON_ICONS = ['🌸', '☀️', '🍂', '❄️'];

// vitesses : heures simulées par seconde réelle
export const SPEEDS = [
  { label: '⏸', v: 0 },
  { label: '×1', v: 0.2 },
  { label: '×5', v: 1 },
  { label: '×25', v: 5 },
  { label: '×100', v: 20 },
  { label: '×400', v: 80 },
];
export const MAX_STEP = 0.25;  // pas de simulation max (h)
export const MAX_POP = 260;

// types de terrain
export const T = { VOID: 0, DEEP: 1, WATER: 2, SAND: 3, GRASS: 4, HILL: 5, ROCK: 6, SNOW: 7 };

export const AGE = { BABY: 3, CHILD: 12, TEEN: 16 };
