import { sentenceCanUseVocabulary } from "./sentence-coverage.js";
import type { WordExampleRecord } from "./types.js";

interface ExampleWord {
  id: string;
  english: string;
}

interface ExampleSentence {
  referenceAnswer: string;
  promptChinese: string;
}

function tokenPositions(value: string): Array<{ text: string; start: number; end: number }> {
  return Array.from(value.matchAll(/[a-z0-9]+/gi), (match) => ({
    text: match[0].toLowerCase(),
    start: match.index,
    end: match.index + match[0].length
  }));
}

function findWordSpan(sentence: string, word: string): { start: number; end: number } | null {
  const sentenceTokens = tokenPositions(sentence);
  const wordTokens = tokenPositions(word).map((token) => token.text);
  if (!wordTokens.length) return null;
  for (let index = 0; index <= sentenceTokens.length - wordTokens.length; index += 1) {
    if (wordTokens.every((text, offset) => sentenceTokens[index + offset].text === text)) {
      return {
        start: sentenceTokens[index].start,
        end: sentenceTokens[index + wordTokens.length - 1].end
      };
    }
  }
  return null;
}

export function buildWordExamples(
  words: ExampleWord[],
  sentences: ExampleSentence[]
): WordExampleRecord[] {
  const vocabulary = words.map((word) => word.english);
  const examples = new Map<string, WordExampleRecord>();

  for (const sentence of sentences) {
    const english = sentence.referenceAnswer.trim();
    if (
      tokenPositions(english).length < 2 ||
      !sentenceCanUseVocabulary({ referenceAnswer: english, acceptedAnswers: [] }, vocabulary)
    ) {
      continue;
    }
    for (const word of words) {
      if (examples.has(word.id)) continue;
      const span = findWordSpan(english, word.english);
      if (!span) continue;
      examples.set(word.id, {
        wordId: word.id,
        english,
        chinese: sentence.promptChinese,
        before: english.slice(0, span.start),
        focus: english.slice(span.start, span.end),
        after: english.slice(span.end)
      });
    }
  }
  return [...examples.values()];
}
