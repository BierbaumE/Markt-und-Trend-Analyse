export default {
  timezoneDisplay: "Europe/Berlin",
  batch: { conceptsPerMessage: 25, signalsPerMessage: 25, maxSubrequests: 40 },
  retention: { creatorCandidateDays: 90, rejectedDays: 30, rawSignalInD1Days: 90, counterpartHashDays: 180 },
  models: { extraction: "claude-haiku-4-5-20251001", report: "claude-sonnet-5", textEmbedding: "@cf/baai/bge-m3" },
  llm: { temperature: 0, maxCostPerRunUsd: 2.0 },
  taskRules: {
    blankSentNoArrivalDays: 7,
    blankReceivedNoCreationDays: 5,
    companyNoInteractionDays: 14,
  },
};
