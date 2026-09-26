// Laenderpakete: eigene Begriffswelt, Saisonlogik, Plattformgewichte.
// Seeds sind Startbegriffe und muessen von Native Reviewern bestaetigt werden.
export const COUNTRIES = {
  DE: {
    code: "DE", nameDe: "Deutschland", languages: ["de"],
    platformWeights: { google_trends: 1.0, pinterest: 1.0, tiktok: 0.8, etsy: 0.7, instagram: 1.0 },
    momentSeeds: {
      "moment.baptism": ["Taufe", "Taufalbum"],
      "moment.first_communion": ["Kommunion", "Erstkommunion"],
      "moment.confirmation": ["Konfirmation", "Jugendweihe"],
      "moment.school_start": ["Einschulung", "Schulanfang"],
      "moment.wedding": ["Hochzeit", "Gästebuch Hochzeit"],
      "moment.birth": ["Geburt", "Erinnerungsbox Baby"],
    },
    seasonalPeaks: { "moment.first_communion": [4, 5], "moment.school_start": [7, 8, 9], "moment.wedding": [5, 6, 7, 8, 9] },
  },
  SE: {
    code: "SE", nameDe: "Schweden", languages: ["sv"],
    platformWeights: { google_trends: 1.0, pinterest: 1.0, tiktok: 0.8, etsy: 0.6, instagram: 1.0 },
    momentSeeds: {
      "moment.baptism": ["dop", "dopbok"],
      "moment.naming_ceremony": ["namngivning"],
      "moment.confirmation": ["konfirmation"],
      "moment.graduation": ["studenten"],
      "moment.wedding": ["bröllop", "gästbok"],
      "moment.birth": ["nyfödd", "minneslåda"],
    },
    seasonalPeaks: { "moment.graduation": [5, 6], "moment.confirmation": [5, 6], "moment.wedding": [6, 7, 8] },
  },
  IT: { code: "IT", nameDe: "Italien", languages: ["it"], platformWeights: {}, momentSeeds: { "moment.baptism": ["battesimo"], "moment.first_communion": ["prima comunione"], "moment.confirmation": ["cresima"], "moment.wedding": ["matrimonio"], "moment.graduation": ["laurea"] }, seasonalPeaks: {} },
  FR: { code: "FR", nameDe: "Frankreich", languages: ["fr"], platformWeights: {}, momentSeeds: { "moment.baptism": ["baptême"], "moment.first_communion": ["communion"], "moment.wedding": ["mariage"], "moment.birth": ["naissance"] }, seasonalPeaks: {} },
  PL: { code: "PL", nameDe: "Polen", languages: ["pl"], platformWeights: {}, momentSeeds: { "moment.baptism": ["chrzest"], "moment.first_communion": ["pierwsza komunia"], "moment.confirmation": ["bierzmowanie"], "moment.wedding": ["ślub"] }, seasonalPeaks: {} },
  "GB-ENG": { code: "GB-ENG", nameDe: "England", languages: ["en"], platformWeights: {}, momentSeeds: { "moment.baptism": ["christening"], "moment.naming_ceremony": ["naming day"], "moment.wedding": ["wedding guest book"], "moment.graduation": ["graduation"] }, seasonalPeaks: {} },
  NO: { code: "NO", nameDe: "Norwegen", languages: ["nb"], platformWeights: {}, momentSeeds: { "moment.baptism": ["dåp"], "moment.naming_ceremony": ["navnefest"], "moment.confirmation": ["konfirmasjon"], "moment.wedding": ["bryllup"] }, seasonalPeaks: { "moment.confirmation": [4, 5, 6] } },
};

export const COUNTRY_CODES = Object.keys(COUNTRIES);
