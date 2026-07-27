import type { SentencePromptRecord } from "./types.js";

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function canBuildAnswer(answer: string, vocabulary: string[]): boolean {
  const answerTokens = tokens(answer);
  if (!answerTokens.length) return false;
  const vocabularyPhrases = vocabulary.map(tokens).filter((phrase) => phrase.length > 0);
  const reachable = Array.from({ length: answerTokens.length + 1 }, () => false);
  reachable[0] = true;

  for (let index = 0; index < answerTokens.length; index += 1) {
    if (!reachable[index]) continue;
    for (const phrase of vocabularyPhrases) {
      const matches = phrase.every(
        (word, phraseIndex) => answerTokens[index + phraseIndex] === word
      );
      if (matches) reachable[index + phrase.length] = true;
    }
  }
  return reachable[answerTokens.length];
}

export function sentenceCanUseVocabulary(
  prompt: Pick<SentencePromptRecord, "referenceAnswer" | "acceptedAnswers">,
  vocabulary: string[]
): boolean {
  return [prompt.referenceAnswer, ...prompt.acceptedAnswers].some((answer) =>
    canBuildAnswer(answer, vocabulary)
  );
}
