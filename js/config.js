// Constantes du jeu — partagées entre la simulation, le rendu et le réseau.
(function (global) {
  const CFG = {
    WORLD: 4000,            // taille du monde (carré)
    PELLET_COUNT: 700,      // nourriture présente en permanence
    PELLET_MASS: 1,
    START_MASS: 25,
    MIN_CELL_MASS: 9,
    MAX_CELLS: 16,          // nombre max de cellules par joueur
    EAT_RATIO: 1.25,        // il faut être 25 % plus gros pour manger
    MIN_SPLIT_MASS: 36,
    SPLIT_IMPULSE: 780,     // px/s
    MERGE_BASE_MS: 12000,   // délai avant re-fusion
    MERGE_PER_MASS_MS: 15,
    MIN_EJECT_MASS: 36,
    EJECT_LOSS: 18,         // masse perdue par éjection
    EJECT_MASS: 14,         // masse du blob éjecté
    EJECT_SPEED: 820,
    VIRUS_COUNT: 14,
    VIRUS_MASS: 100,
    VIRUS_FEED_TO_SPLIT: 7, // éjections pour faire tirer un virus
    VIRUS_EXPLODE_MASS: 133,
    DECAY_RATE: 0.0006,     // perte de masse /s (proportionnelle)
    TICK_MS: 33,            // simulation ~30 Hz
    NET_MS: 66,             // envoi d'état ~15 Hz
    BOT_NAMES: [
      'Amibe', 'Blob', 'Cyto', 'Dot', 'Ekto', 'Flux', 'Gel', 'Halo',
      'Iris', 'Jelly', 'Kylo', 'Lump', 'Mito', 'Nano', 'Orbe', 'Pion',
      'Quark', 'Ribo', 'Spore', 'Toxo', 'Umi', 'Virgo', 'Wob', 'Xeno',
    ],
  };

  CFG.radius = function (mass) { return 4 + Math.sqrt(mass) * 4.5; };
  CFG.speed = function (mass) { return 230 * Math.pow(mass / CFG.START_MASS, -0.22); };
  CFG.mergeDelay = function (mass) { return CFG.MERGE_BASE_MS + mass * CFG.MERGE_PER_MASS_MS; };

  if (typeof module !== 'undefined' && module.exports) module.exports = CFG;
  else global.CFG = CFG;
})(typeof window !== 'undefined' ? window : globalThis);
