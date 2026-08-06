import type {
  AssessmentDifficulty,
  AssessmentDimension,
  AssessmentScores,
  InitialAssessmentAnswer,
  InitialAssessmentQuestion,
  LearningGoal
} from "../domain/types.js";
import { AppError } from "../lib/errors.js";

export const AGE_BANDS = ["3-5", "6-7", "8-9", "10-12", "13+"] as const;
export const GRADE_LEVELS = [
  "PRESCHOOL",
  "GRADE_1",
  "GRADE_2",
  "GRADE_3",
  "GRADE_4",
  "GRADE_5",
  "GRADE_6_PLUS"
] as const;
export const ENGLISH_EXPERIENCES = ["NONE", "UNDER_6_MONTHS", "6_TO_12_MONTHS", "OVER_1_YEAR"] as const;
export const LEARNING_GOALS: LearningGoal[] = [
  "BALANCED",
  "VOCABULARY",
  "SPELLING",
  "PRONUNCIATION",
  "SPEAKING",
  "SCHOOL"
];

interface AssessmentQuestionDefinition extends InitialAssessmentQuestion {
  correctOptionId?: string;
  acceptedAnswers?: string[];
  referenceText?: string;
}

const QUESTIONS: AssessmentQuestionDefinition[] = [
  {
    key: "recognition-apple",
    dimension: "RECOGNITION",
    type: "TEXT",
    prompt: "apple",
    instruction: "写出这个英文单词的中文意思",
    audioText: null,
    options: [],
    acceptedAnswers: ["苹果"]
  },
  {
    key: "recognition-blue",
    dimension: "RECOGNITION",
    type: "TEXT",
    prompt: "blue",
    instruction: "写出这个英文单词的中文意思",
    audioText: null,
    options: [],
    acceptedAnswers: ["蓝色", "蓝"]
  },
  {
    key: "recognition-book",
    dimension: "RECOGNITION",
    type: "CHOICE",
    prompt: "书",
    instruction: "选择对应的英文",
    audioText: null,
    options: [
      { id: "bag", text: "bag" },
      { id: "book", text: "book" },
      { id: "pencil", text: "pencil" }
    ],
    correctOptionId: "book"
  },
  {
    key: "recognition-where",
    dimension: "RECOGNITION",
    type: "TEXT",
    prompt: "where",
    instruction: "写出这个英文单词的中文意思",
    audioText: null,
    options: [],
    acceptedAnswers: ["哪里", "哪儿"]
  },
  {
    key: "recognition-thank-you",
    dimension: "RECOGNITION",
    type: "CHOICE",
    prompt: "听发音并选择意思",
    instruction: "点击播放后选择正确答案",
    audioText: "thank you",
    options: [
      { id: "hello", text: "你好" },
      { id: "thank-you", text: "谢谢" },
      { id: "goodbye", text: "再见" }
    ],
    correctOptionId: "thank-you"
  },
  {
    key: "recognition-how-old",
    dimension: "RECOGNITION",
    type: "TEXT",
    prompt: "how old",
    instruction: "写出这个英文短语的中文意思",
    audioText: null,
    options: [],
    acceptedAnswers: ["多大", "几岁"]
  },
  {
    key: "spelling-cat",
    dimension: "SPELLING",
    type: "TEXT",
    prompt: "猫",
    instruction: "根据中文意思，写出英文单词",
    audioText: "cat",
    options: [],
    acceptedAnswers: ["cat"]
  },
  {
    key: "spelling-red",
    dimension: "SPELLING",
    type: "TEXT",
    prompt: "红色",
    instruction: "根据中文意思，写出英文单词",
    audioText: "red",
    options: [],
    acceptedAnswers: ["red"]
  },
  {
    key: "spelling-book",
    dimension: "SPELLING",
    type: "TEXT",
    prompt: "书",
    instruction: "根据中文意思，写出英文单词",
    audioText: "book",
    options: [],
    acceptedAnswers: ["book"]
  },
  {
    key: "spelling-apple",
    dimension: "SPELLING",
    type: "TEXT",
    prompt: "苹果",
    instruction: "根据中文意思，写出英文单词",
    audioText: "apple",
    options: [],
    acceptedAnswers: ["apple"]
  },
  {
    key: "pronunciation-cat",
    dimension: "PRONUNCIATION",
    type: "VOICE",
    prompt: "cat",
    instruction: "按住录音并跟读",
    audioText: "cat",
    options: [],
    referenceText: "cat"
  },
  {
    key: "pronunciation-yellow",
    dimension: "PRONUNCIATION",
    type: "VOICE",
    prompt: "yellow",
    instruction: "按住录音并跟读",
    audioText: "yellow",
    options: [],
    referenceText: "yellow"
  },
  {
    key: "pronunciation-thank-you",
    dimension: "PRONUNCIATION",
    type: "VOICE",
    prompt: "thank you",
    instruction: "按住录音并跟读",
    audioText: "thank you",
    options: [],
    referenceText: "thank you"
  },
  {
    key: "expression-age",
    dimension: "EXPRESSION",
    type: "TEXT",
    prompt: "我八岁。",
    instruction: "用英文写出这个句子",
    audioText: null,
    options: [],
    acceptedAnswers: ["i am eight", "im eight", "i'm eight"]
  },
  {
    key: "expression-blue-book",
    dimension: "EXPRESSION",
    type: "TEXT",
    prompt: "我的书是蓝色的。",
    instruction: "用英文写出这个句子",
    audioText: null,
    options: [],
    acceptedAnswers: ["my book is blue"]
  },
  {
    key: "expression-like-apple",
    dimension: "EXPRESSION",
    type: "TEXT",
    prompt: "我喜欢苹果。",
    instruction: "用英文写出这个句子",
    audioText: null,
    options: [],
    acceptedAnswers: ["i like apple", "i like apples"]
  },
  {
    key: "recognition-cat",
    dimension: "RECOGNITION",
    type: "TEXT",
    prompt: "cat",
    instruction: "写出这个英文单词的中文意思",
    audioText: null,
    options: [],
    acceptedAnswers: ["猫"]
  },
  {
    key: "recognition-which",
    dimension: "RECOGNITION",
    type: "TEXT",
    prompt: "which",
    instruction: "写出这个英文单词的中文意思",
    audioText: null,
    options: [],
    acceptedAnswers: ["哪一个", "哪个"]
  },
  {
    key: "recognition-how-many",
    dimension: "RECOGNITION",
    type: "TEXT",
    prompt: "how many",
    instruction: "写出这个英文短语的中文意思",
    audioText: null,
    options: [],
    acceptedAnswers: ["多少"]
  },
  {
    key: "recognition-there",
    dimension: "RECOGNITION",
    type: "CHOICE",
    prompt: "那里",
    instruction: "选择对应的英文",
    audioText: null,
    options: [
      { id: "here", text: "here" },
      { id: "there", text: "there" },
      { id: "where", text: "where" }
    ],
    correctOptionId: "there"
  },
  {
    key: "recognition-want",
    dimension: "RECOGNITION",
    type: "TEXT",
    prompt: "want",
    instruction: "写出这个英文单词的中文意思",
    audioText: null,
    options: [],
    acceptedAnswers: ["想要", "想"]
  },
  {
    key: "spelling-yellow",
    dimension: "SPELLING",
    type: "TEXT",
    prompt: "黄色",
    instruction: "根据中文意思，写出英文单词",
    audioText: "yellow",
    options: [],
    acceptedAnswers: ["yellow"]
  },
  {
    key: "spelling-pencil",
    dimension: "SPELLING",
    type: "TEXT",
    prompt: "铅笔",
    instruction: "根据中文意思，写出英文单词",
    audioText: "pencil",
    options: [],
    acceptedAnswers: ["pencil"]
  },
  {
    key: "spelling-banana",
    dimension: "SPELLING",
    type: "TEXT",
    prompt: "香蕉",
    instruction: "根据中文意思，写出英文单词",
    audioText: "banana",
    options: [],
    acceptedAnswers: ["banana"]
  },
  {
    key: "pronunciation-how-many",
    dimension: "PRONUNCIATION",
    type: "VOICE",
    prompt: "how many",
    instruction: "按住录音并跟读",
    audioText: "how many",
    options: [],
    referenceText: "how many"
  },
  {
    key: "pronunciation-pencil",
    dimension: "PRONUNCIATION",
    type: "VOICE",
    prompt: "pencil",
    instruction: "按住录音并跟读",
    audioText: "pencil",
    options: [],
    referenceText: "pencil"
  },
  {
    key: "expression-yellow-pencil",
    dimension: "EXPRESSION",
    type: "TEXT",
    prompt: "我有一支黄色的铅笔。",
    instruction: "用英文写出这个句子",
    audioText: null,
    options: [],
    acceptedAnswers: ["i have a yellow pencil"]
  },
  {
    key: "expression-where-book",
    dimension: "EXPRESSION",
    type: "TEXT",
    prompt: "我的书在哪里？",
    instruction: "用英文写出这个句子",
    audioText: null,
    options: [],
    acceptedAnswers: ["where is my book", "wheres my book", "where's my book"]
  }
];

const QUESTION_KEYS: Record<AssessmentDifficulty, string[]> = {
  FOUNDATION: [
    "recognition-apple",
    "recognition-blue",
    "recognition-book",
    "recognition-thank-you",
    "recognition-cat",
    "spelling-cat",
    "spelling-red",
    "spelling-book",
    "pronunciation-cat",
    "pronunciation-yellow",
    "expression-age",
    "expression-like-apple"
  ],
  STANDARD: [
    "recognition-apple",
    "recognition-blue",
    "recognition-book",
    "recognition-where",
    "recognition-thank-you",
    "recognition-how-old",
    "spelling-cat",
    "spelling-red",
    "spelling-book",
    "spelling-apple",
    "pronunciation-cat",
    "pronunciation-yellow",
    "pronunciation-thank-you",
    "expression-age",
    "expression-blue-book",
    "expression-like-apple"
  ],
  ADVANCED: [
    "recognition-where",
    "recognition-how-old",
    "recognition-which",
    "recognition-how-many",
    "recognition-there",
    "recognition-want",
    "spelling-apple",
    "spelling-yellow",
    "spelling-pencil",
    "spelling-banana",
    "pronunciation-thank-you",
    "pronunciation-how-many",
    "pronunciation-pencil",
    "expression-blue-book",
    "expression-yellow-pencil",
    "expression-where-book"
  ]
};

function normalizeAnswer(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[.,!?;:'’"]/g, "")
    .replace(/\s+/g, " ");
}

function assessmentQuestionDefinitions(
  difficulty: AssessmentDifficulty
): AssessmentQuestionDefinition[] {
  return QUESTION_KEYS[difficulty].map((key) => {
    const question = QUESTIONS.find((item) => item.key === key);
    if (!question) throw new Error(`Missing assessment question: ${key}`);
    return question;
  });
}

export function assessmentQuestions(
  difficulty: AssessmentDifficulty = "STANDARD"
): InitialAssessmentQuestion[] {
  return assessmentQuestionDefinitions(difficulty).map(
    ({ correctOptionId: _correct, acceptedAnswers: _accepted, referenceText: _reference, ...question }) => question
  );
}

export function assessmentQuestion(
  key: string,
  difficulty: AssessmentDifficulty = "STANDARD"
): AssessmentQuestionDefinition {
  const question = assessmentQuestionDefinitions(difficulty).find((item) => item.key === key);
  if (!question) throw new AppError(404, "ASSESSMENT_QUESTION_NOT_FOUND", "测评题目不存在");
  return question;
}

export function assessmentDifficultyForExperience(
  englishExperience: string | null
): AssessmentDifficulty {
  if (englishExperience === "OVER_1_YEAR") return "ADVANCED";
  if (englishExperience === "6_TO_12_MONTHS") return "STANDARD";
  return "FOUNDATION";
}

export function assessTextAnswer(
  question: AssessmentQuestionDefinition,
  answer: string
): { correct: boolean; score: number; feedback: string } {
  if (question.type === "VOICE") {
    throw new AppError(400, "VOICE_ANSWER_REQUIRED", "该题需要提交录音");
  }
  const normalized = normalizeAnswer(answer);
  const correct = question.type === "CHOICE"
    ? normalized === normalizeAnswer(question.correctOptionId || "")
    : (question.acceptedAnswers || []).some((item) => normalizeAnswer(item) === normalized);
  return {
    correct,
    score: correct ? 100 : 0,
    feedback: correct ? "回答正确" : "已记录，本次测评结束后会综合分析"
  };
}

export function assessmentProfileComplete(profile: {
  ageBand: string | null;
  gradeLevel: string | null;
  englishExperience: string | null;
  learningGoals: LearningGoal[];
}): boolean {
  return Boolean(
    profile.ageBand &&
      profile.gradeLevel &&
      profile.englishExperience &&
      profile.learningGoals.length
  );
}

function dimensionScore(
  answers: InitialAssessmentAnswer[],
  dimension: AssessmentDimension
): number | null {
  const scores = answers
    .filter((answer) => answer.dimension === dimension && answer.result !== "SKIPPED")
    .map((answer) => answer.score)
    .filter((score): score is number => typeof score === "number");
  if (!scores.length) return null;
  return Math.round(scores.reduce((total, score) => total + score, 0) / scores.length);
}

const dimensionLabels: Record<AssessmentDimension, string> = {
  RECOGNITION: "认读",
  SPELLING: "拼写",
  PRONUNCIATION: "发音",
  EXPRESSION: "表达"
};

const goalDimensions: Partial<Record<LearningGoal, AssessmentDimension>> = {
  VOCABULARY: "RECOGNITION",
  SPELLING: "SPELLING",
  PRONUNCIATION: "PRONUNCIATION",
  SPEAKING: "EXPRESSION",
  SCHOOL: "SPELLING"
};

export function calculateAssessmentResult(
  answers: InitialAssessmentAnswer[],
  learningGoals: LearningGoal[],
  difficulty: AssessmentDifficulty = "STANDARD"
): { level: string; scores: AssessmentScores; summary: string } {
  const scores: AssessmentScores = {
    recognition: dimensionScore(answers, "RECOGNITION"),
    spelling: dimensionScore(answers, "SPELLING"),
    pronunciation: dimensionScore(answers, "PRONUNCIATION"),
    expression: dimensionScore(answers, "EXPRESSION")
  };
  const difficultyBonus: Record<AssessmentDifficulty, number> = {
    FOUNDATION: 0,
    STANDARD: 10,
    ADVANCED: 20
  };
  const calibrated = (score: number | null) => Math.min(100, (score || 0) + difficultyBonus[difficulty]);
  const recognition = calibrated(scores.recognition);
  const spelling = calibrated(scores.spelling);
  const expression = calibrated(scores.expression);
  const level = recognition < 60
    ? "启蒙起步"
    : spelling < 60
      ? "基础认读"
      : expression < 60
        ? "词汇运用"
        : "初步表达";

  const entries: Array<[AssessmentDimension, number | null]> = [
    ["RECOGNITION", scores.recognition],
    ["SPELLING", scores.spelling],
    ["PRONUNCIATION", scores.pronunciation],
    ["EXPRESSION", scores.expression]
  ];
  const assessed = entries.filter((item): item is [AssessmentDimension, number] => item[1] !== null);
  assessed.sort((left, right) => left[1] - right[1]);
  const weakest = assessed[0]?.[0] || "RECOGNITION";
  const preferredDimensions = learningGoals
    .map((goal) => goalDimensions[goal])
    .filter((dimension): dimension is AssessmentDimension => Boolean(dimension));
  const preferred = assessed
    .filter(([dimension]) => preferredDimensions.includes(dimension))
    .sort((left, right) => left[1] - right[1])[0]?.[0];
  const focus = preferred || weakest;
  return {
    level,
    scores,
    summary: `当前处于“${level}”阶段，建议优先加强${dimensionLabels[focus]}练习，并保持其他能力的均衡训练。`
  };
}

export function validateLearnerProfile(input: {
  ageBand: string;
  gradeLevel: string;
  englishExperience: string;
  learningGoals: string[];
}): asserts input is {
  ageBand: (typeof AGE_BANDS)[number];
  gradeLevel: (typeof GRADE_LEVELS)[number];
  englishExperience: (typeof ENGLISH_EXPERIENCES)[number];
  learningGoals: LearningGoal[];
} {
  if (!AGE_BANDS.includes(input.ageBand as (typeof AGE_BANDS)[number])) {
    throw new AppError(400, "INVALID_AGE_BAND", "年龄段不正确");
  }
  if (!GRADE_LEVELS.includes(input.gradeLevel as (typeof GRADE_LEVELS)[number])) {
    throw new AppError(400, "INVALID_GRADE_LEVEL", "年级不正确");
  }
  if (!ENGLISH_EXPERIENCES.includes(input.englishExperience as (typeof ENGLISH_EXPERIENCES)[number])) {
    throw new AppError(400, "INVALID_ENGLISH_EXPERIENCE", "英语接触时间不正确");
  }
  if (!input.learningGoals.length || input.learningGoals.length > 6) {
    throw new AppError(400, "INVALID_LEARNING_GOALS", "请至少选择一个学习目标");
  }
  if (new Set(input.learningGoals).size !== input.learningGoals.length || input.learningGoals.some((goal) => !LEARNING_GOALS.includes(goal as LearningGoal))) {
    throw new AppError(400, "INVALID_LEARNING_GOALS", "学习目标不正确");
  }
}

export function assessmentReferenceText(
  questionKey: string,
  difficulty: AssessmentDifficulty = "STANDARD"
): string {
  const question = assessmentQuestion(questionKey, difficulty);
  if (question.type !== "VOICE" || !question.referenceText) {
    throw new AppError(400, "VOICE_ANSWER_NOT_ALLOWED", "该题不需要录音");
  }
  return question.referenceText;
}
