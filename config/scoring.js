// Alle Gewichte und Schwellen an einer Stelle (SPEC Anhang A). Keine Magic Numbers im Code.
export default {
  version: "1.0.0",
  features: {
    velocityWindowWeeks: 8,
    accelerationWindowWeeks: 4,
    persistenceWindowWeeks: 6,
    crossSourceZThreshold: 1.0,
    cliEpsilon: 0.0001,
    cliDeltaLagWeeks: 8,
    winsor: [0.02, 0.98],
  },
  tms: {
    weights: { velocity: 0.24, acceleration: 0.18, crossSource: 0.18, novelty: 0.14, culturalLift: 0.10, persistence: 0.08, commercial: 0.08 },
    minCoverageForTrendClasses: 0.6,
  },
  weakSignal: { accelerationPct: 0.8, noveltyPct: 0.7, maxLevelPct: 0.5, minPersistence: 0.5 },
  sdi: {
    humanReviewThreshold: 60,
    directionZ: { strongUp: 1.5, up: 0.5, flat: 0.5, down: -0.5 },
    // Richtung je Sensor aus dem Perzentilrang innerhalb der Quelle
    directionPct: { strongUp: 0.8, up: 0.6, down: 0.3 },
  },
  lifecycle: {
    states: ["noise", "emerging_signal", "corroborated_signal", "emerging_trend", "established", "saturating", "declining"],
    transition: {
      noise:               [0.85, 0.13, 0.01, 0.00, 0.00, 0.00, 0.01],
      emerging_signal:     [0.15, 0.55, 0.22, 0.05, 0.00, 0.00, 0.03],
      corroborated_signal: [0.05, 0.10, 0.55, 0.25, 0.02, 0.00, 0.03],
      emerging_trend:      [0.01, 0.02, 0.07, 0.65, 0.20, 0.03, 0.02],
      established:         [0.00, 0.00, 0.01, 0.04, 0.80, 0.12, 0.03],
      saturating:          [0.00, 0.00, 0.00, 0.02, 0.10, 0.70, 0.18],
      declining:           [0.05, 0.02, 0.00, 0.01, 0.02, 0.05, 0.85],
    },
    // Beta-Parameter [alpha, beta] je Zustand und Merkmal (level, velocity, acceleration, crossSource, persistence)
    emissions: {
      noise:               { level: [1.2, 4], velocity: [1.5, 3], acceleration: [2, 2], crossSource: [1, 4], persistence: [1.2, 3] },
      emerging_signal:     { level: [1.5, 4], velocity: [4, 2],   acceleration: [3, 2], crossSource: [1.5, 3], persistence: [2, 2] },
      corroborated_signal: { level: [2, 3],   velocity: [4, 2],   acceleration: [3, 2], crossSource: [4, 1.5], persistence: [3, 1.5] },
      emerging_trend:      { level: [3, 2],   velocity: [5, 1.5], acceleration: [4, 2], crossSource: [4, 1.5], persistence: [4, 1.5] },
      established:         { level: [5, 1.5], velocity: [2, 2],   acceleration: [2, 3], crossSource: [4, 1.5], persistence: [4, 1.5] },
      saturating:          { level: [4, 1.5], velocity: [1.8, 3], acceleration: [1.5, 4], crossSource: [3, 2], persistence: [2, 2] },
      declining:           { level: [3, 2],   velocity: [1.2, 5], acceleration: [1.5, 4], crossSource: [2, 3], persistence: [1.2, 4] },
    },
    confidencePenalties: { seasonalityUnadjusted: 0.85, lowCoverage: 0.8, ukProxy: 0.9 },
    filterSteps: 12,
    noisePrior: 0.2,
  },
  mrs: {
    weights: { momentProximity: 0.30, personalizationPotential: 0.20, emotionalMeaning: 0.15, blankFit: 0.15, finishability: 0.10, commercialPotential: 0.10 },
    whatNotToDoRule: { minTms: 70, maxMrs: 40 },
  },
  opportunityWindowWeeks: {
    emerging_signal: [12, 40], corroborated_signal: [10, 30], emerging_trend: [8, 26],
    established: [4, 16], saturating: [0, 8], declining: [0, 4], noise: [0, 0],
  },
  sei: {
    windowDays: 90,
    weights: { help: 0.20, initiation: 0.20, recurringCommunity: 0.15, peerActivation: 0.15, experimentation: 0.10, answerQuality: 0.10, networkBridges: 0.10 },
    reachMaxShare: 0.05,
    reachCorridor: { zeroBelow: 50, fullFrom: 300, fullTo: 5000, decayTo: 20000, floor: 0.3 },
    saturation: { helpKappa: 4, initiationKappa: 2, peerActivationKappa: 3 },
    minCoverage: 0.5,
  },
  cci: { weights: { completion: 0.6, sequence: 0.25, process: 0.15 }, sequenceDays: 21, minProjects: 3 },
  mmf: {
    weights: { sei: 0.20, makerActivity: 0.15, momentProximity: 0.15, blankCompatibility: 0.15, finishingCompetence: 0.10, learningExperimenting: 0.10, localNetworking: 0.10, commercialExperience: 0.05 },
  },
  bridge: {
    weights: { affinity: 0.45, sei: 0.25, priority: 0.20, readiness: 0.10 },
    affinity_dimension_weights: { style: 0.25, motif: 0.20, technique: 0.20, moment: 0.20, product_type: 0.10, material: 0.05 },
    min_affinity: 0.35,
    min_sei: 50,
    top_n_per_country: 20,
  },
  scorecard: { prioritizeFromRaw: 20, closeLookFromRaw: 24, doubleWeight: ["helps", "initiates"] },
  cos: {
    weights: { audienceFit: 0.20, assortmentFit: 0.15, momentProximity: 0.15, personalizationDiyAffinity: 0.15, regionalRelevance: 0.10, onlineActivity: 0.10, assortmentGap: 0.10, contactability: 0.05 },
  },
  kpi: { mmarWindowDays: 45, multiplierWindowDays: 30 },
};
