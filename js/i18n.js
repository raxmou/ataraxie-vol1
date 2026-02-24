const STRINGS = {
  "toggle.territory": { fr: "Territoire", en: "Territory" },
  "toggle.sigil": { fr: "Sigle", en: "Sigil" },
  "character.title": { fr: "Qui es-tu\u202f?", en: "Who are you?" },
  "character.confirm": { fr: "Confirmer", en: "Confirm" },
  "about.close": { fr: "Fermer", en: "Close" },
  "about.text": {
    fr: "Ce projet appuie la sortie de la compilation du n\u00e9o-label parisien Ataraxie\u00a0: <em>My Land is Eating my Territory</em>.",
    en: "This project accompanies the release of the compilation from the Parisian neo-label Ataraxie\u00a0: <em>My Land is Eating my Territory</em>.",
  },
  "about.changeCharacter": { fr: "Changer de personnage", en: "Change character" },
  "about.madeBy": {
    fr: "Site cr\u00e9\u00e9 et open sourc\u00e9 par <a href=\"https://instagram.com/rax_mou\" target=\"_blank\" rel=\"noopener noreferrer\">rax</a>",
    en: "Website created & open sourced by <a href=\"https://instagram.com/rax_mou\" target=\"_blank\" rel=\"noopener noreferrer\">rax</a>",
  },
  "about.noAi": {
    fr: "Aucune IA n\u2019a \u00e9t\u00e9 bless\u00e9e durant la cr\u00e9ation",
    en: "No AI was hurt during creation",
  },
  "loading.mapData": { fr: "Chargement des donn\u00e9es\u2026", en: "Loading map data\u2026" },
  "loading.stateViews": {
    fr: "Pr\u00e9paration des vues ${current}/${total}\u2026",
    en: "Preparing state views ${current}/${total}\u2026",
  },
  "info.explore": { fr: "Explorer la carte", en: "Explore the map" },
  "info.selectState": {
    fr: "S\u00e9lectionne un territoire pour le d\u00e9couvrir ici.",
    en: "Select a state to see it here.",
  },
  "info.loading": { fr: "Chargement\u2026", en: "Loading details\u2026" },
  "info.noTrack": { fr: "Pas de morceau.", en: "No track assigned." },
  "fallback.explore": {
    fr: "Explorer le territoire ${id}",
    en: "Explore territory ${id}",
  },
  "fallback.direction": {
    fr: "Et maintenant, quelle direction prends-tu\u202f?",
    en: "And now, which direction do you take?",
  },
  "gesture.hints": {
    fr: "Tourner \u2192 vitesse\nSecouer \u2192 2x\nGlisser \u2192 chercher",
    en: "Rotate \u2192 speed\nShake \u2192 2x\nSwipe \u2192 seek",
  },
  "menu.pause": { fr: "Pause", en: "Pause" },
  "menu.play": { fr: "Jouer", en: "Play" },
  "menu.restart": { fr: "Red\u00e9marrer le temps", en: "Restart time" },
  "menu.meaning": {
    fr: "Quel est le sens de la vie\u202f?",
    en: "What is the meaning of life?",
  },
  "menu.gestures": { fr: "Gestes sablier", en: "Hourglass gestures" },
  "menu.about": { fr: "\u00c0 propos", en: "About" },
  "continue.exploring": { fr: "Continuer l\u2019exploration", en: "Continue exploring" },
  "bark.where": { fr: "O\u00f9 ai-je donc atterri\u202f?", en: "Where have I landed?" },
  "bark.discover": {
    fr: "Ne devrait-on pas essayer de d\u00e9couvrir ce territoire\u202f?",
    en: "Shouldn\u2019t we try to discover this territory?",
  },
  "bark.finale": {
    fr: "On dirait que j\u2019ai dessin\u00e9 les contours de mon territoire, bravo et merci \u00e0 toi",
    en: "It seems I\u2019ve drawn the borders of my territory, bravo and thank you",
  },
  "error.title": { fr: "Erreur", en: "Error" },
  "error.body": {
    fr: "Impossible de charger les donn\u00e9es.",
    en: "Could not load map data.",
  },
  "state.noState": { fr: "Aucun \u00e9tat sp\u00e9cifi\u00e9", en: "No state specified" },
  "state.noStateBody": {
    fr: "Ajoute ?state=&lt;id&gt; dans l\u2019URL.",
    en: "Provide ?state=&lt;id&gt; in the URL.",
  },
  "state.noGeometry": {
    fr: "Aucune g\u00e9om\u00e9trie trouv\u00e9e.",
    en: "No geometry found for this state.",
  },
  "state.backToMap": { fr: "\u2190 Retour \u00e0 la carte", en: "\u2190 Back to full map" },
};

const DRAG_PHRASES_FR = [
  "Aimes-tu l\u2019autorit\u00e9\u202f?",
  "Habites-tu cet instant\u202f?",
  "Si je cours assez vite, est-ce que j\u2019arrive \u00e0 hier\u202f?",
  "Quelle heure il est pour une pierre\u202f?",
  "Le pr\u00e9sent, c\u2019est \u00e0 gauche ou \u00e0 droite\u202f?",
  "Un drapeau plant\u00e9 dans le sol, \u00e7a fait mal \u00e0 la terre\u202f?",
  "Est-ce que la pluie demande un visa avant de tomber\u202f?",
  "Combien de g\u00e9n\u00e9rations faut-il pour qu\u2019un envahisseur devienne un autochtone\u202f?",
  "O\u00f9 dorment les lieux qu\u2019on a quitt\u00e9s\u202f?",
  "Reste-t-il une odeur l\u00e0 o\u00f9 quelqu\u2019un a pleur\u00e9\u202f?",
  "Le mardi existe-t-il aussi dans la for\u00eat\u202f?",
  "Si on d\u00e9place une fronti\u00e8re, le sol s\u2019en aper\u00e7oit\u202f?",
];

const DRAG_PHRASES_EN = [
  "Do you like authority?",
  "Are you inhabiting this moment?",
  "If I run fast enough, can I reach yesterday?",
  "What time is it for a stone?",
  "The present\u2014is it left or right?",
  "A flag planted in the ground\u2014does it hurt the earth?",
  "Does the rain apply for a visa before falling?",
  "How many generations before an invader becomes a native?",
  "Where do the places we left behind sleep?",
  "Does a scent linger where someone cried?",
  "Does Tuesday also exist in the forest?",
  "If you move a border, does the ground notice?",
];

const STORAGE_KEY = "ataraxie-lang";

export const getLang = () => {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "fr" || stored === "en") return stored;
  const nav = (navigator.language || "").slice(0, 2).toLowerCase();
  return nav === "en" ? "en" : "fr";
};

export const setLang = (lang) => {
  localStorage.setItem(STORAGE_KEY, lang);
  location.reload();
};

export const t = (key, vars) => {
  const entry = STRINGS[key];
  if (!entry) return key;
  let str = entry[getLang()] ?? entry.fr ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(`\${${k}}`, v);
    }
  }
  return str;
};

export const getDragPhrases = () =>
  getLang() === "en" ? DRAG_PHRASES_EN : DRAG_PHRASES_FR;

export const getTracksUrl = (baseUrl) => {
  if (!baseUrl || getLang() !== "en") return baseUrl;
  return baseUrl.replace(/tracks\.json$/, "tracks-en.json");
};

export const applyStaticTranslations = () => {
  document.documentElement.lang = getLang();

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n;
    const entry = STRINGS[key];
    if (!entry) return;
    const val = entry[getLang()] ?? entry.fr;
    if (el.tagName === "P" && val.includes("<")) {
      el.innerHTML = val;
    } else {
      el.textContent = val;
    }
  });

  document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    const key = el.dataset.i18nAria;
    const entry = STRINGS[key];
    if (!entry) return;
    el.setAttribute("aria-label", entry[getLang()] ?? entry.fr);
  });
};
