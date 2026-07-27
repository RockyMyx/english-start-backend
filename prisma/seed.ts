import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required for seeding");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString })
});

const starterWords = [
  ["greeting", "hello", "hello", "你好"],
  ["greeting", "goodbye", "goodbye", "再见"],
  ["greeting", "thank-you", "thank you", "谢谢"],
  ["greeting", "name", "name", "名字"],
  ["number", "one", "one", "一"],
  ["number", "two", "two", "二"],
  ["number", "three", "three", "三"],
  ["number", "four", "four", "四"],
  ["number", "five", "five", "五"],
  ["number", "six", "six", "六"],
  ["number", "seven", "seven", "七"],
  ["number", "eight", "eight", "八"],
  ["number", "nine", "nine", "九"],
  ["number", "ten", "ten", "十"],
  ["question", "what", "what", "什么"],
  ["question", "who", "who", "谁"],
  ["question", "when", "when", "什么时候"],
  ["question", "where", "where", "哪里"],
  ["question", "which", "which", "哪一个"],
  ["question", "how", "how", "怎么；如何"],
  ["question", "how-old", "how old", "多大；几岁"],
  ["question", "how-many", "how many", "多少"],
  ["sentence", "is", "is", "是（用于单数）"],
  ["sentence", "are", "are", "是（用于复数或 you）"],
  ["sentence", "am", "am", "是（用于 I）"],
  ["sentence", "i", "I", "我"],
  ["sentence", "you", "you", "你；你们"],
  ["color", "color", "color", "颜色"],
  ["color", "red", "red", "红色"],
  ["color", "yellow", "yellow", "黄色"],
  ["color", "green", "green", "绿色"],
  ["color", "blue", "blue", "蓝色"],
  ["color", "black", "black", "黑色"],
  ["color", "white", "white", "白色"],
  ["color", "pink", "pink", "粉色"],
  ["school", "book", "book", "书"],
  ["school", "pencil", "pencil", "铅笔"],
  ["school", "bag", "bag", "书包"],
  ["school", "desk", "desk", "课桌"],
  ["school", "chair", "chair", "椅子"],
  ["fruit", "apple", "apple", "苹果"],
  ["fruit", "banana", "banana", "香蕉"],
  ["life", "mother", "mother", "妈妈"],
  ["life", "father", "father", "爸爸"],
  ["life", "sister", "sister", "姐妹"],
  ["life", "brother", "brother", "兄弟"],
  ["life", "cat", "cat", "猫"],
  ["life", "dog", "dog", "狗"],
  ["life", "happy", "happy", "开心的"],
  ["life", "sad", "sad", "难过的"]
] as const;

await prisma.starterVocabulary.updateMany({
  where: { key: { notIn: starterWords.map(([, key]) => key) } },
  data: { active: false }
});

for (const [category, key, english, chinese] of starterWords) {
  const sortOrder = starterWords.findIndex((item) => item[1] === key) + 1;
  await prisma.starterVocabulary.upsert({
    where: { key },
    update: {
      category,
      english,
      normalizedEnglish: english.toLowerCase(),
      chinese,
      sortOrder,
      active: true
    },
    create: {
      key,
      category,
      english,
      normalizedEnglish: english.toLowerCase(),
      chinese,
      sortOrder
    }
  });
}

const sentencePrompts = [
  [
    "hello",
    "hello",
    "你好，我叫艾米。",
    "Hello, my name is Amy.",
    ["hello my name is amy", "hello i am amy", "hi my name is amy", "hi i am amy"],
    "先打招呼，再使用 My name is ... 或 I am ... 介绍名字。"
  ],
  ["goodbye", "goodbye", "再见，妈妈。", "Goodbye, Mom.", ["goodbye mom", "goodbye mother"], "Goodbye 表示再见。"],
  ["thank-you", "thank you", "谢谢你。", "Thank you.", ["thank you", "thanks"], "Thank you 和 Thanks 都可以表达感谢。"],
  ["name", "name", "我的名字叫艾米。", "My name is Amy.", ["my name is amy", "i am amy", "i'm amy"], "My name is ... 用来介绍名字。"],
  ["one-book", "one", "我有一本书。", "I have one book.", ["i have one book", "i have a book"], "one 表示一个。"],
  ["six-years-old", "six", "我六岁。", "I am six.", ["i am six", "i'm six", "i am six years old", "i'm six years old"], "年龄可以直接用 I am + 数字。"],
  ["eight-years-old", "eight", "我八岁。", "I am eight.", ["i am eight", "i'm eight", "i am eight years old", "i'm eight years old"], "年龄可以直接用 I am + 数字。"],
  ["ask-color", "color", "这是什么颜色？", "What color is this?", ["what color is this", "what colour is this"], "What color ...? 用来询问颜色。"],
  ["red", "red", "它是红色的。", "It is red.", ["it is red", "it's red", "this is red"], "It is + 颜色可以描述物品颜色。"],
  ["blue-bag", "blue", "我的书包是蓝色的。", "My bag is blue.", ["my bag is blue", "the bag is blue"], "颜色通常放在 be 动词后面。"],
  ["green-pencil", "green", "这支铅笔是绿色的。", "This pencil is green.", ["this pencil is green", "the pencil is green"], "This pencil 指这支铅笔。"],
  ["my-book", "book", "这是我的书。", "This is my book.", ["this is my book", "it is my book", "it's my book"], "This is my ... 用来介绍自己的物品。"],
  ["a-pencil", "pencil", "我有一支铅笔。", "I have a pencil.", ["i have a pencil", "i've got a pencil"], "I have ... 表示我有……"],
  ["bag-on-chair", "bag", "我的书包在椅子上。", "My bag is on the chair.", ["my bag is on the chair", "the bag is on the chair"], "on the chair 表示在椅子上。"],
  ["my-mother", "mother", "这是我的妈妈。", "This is my mother.", ["this is my mother", "she is my mother", "she's my mother"], "This is my ... 可以介绍家人。"],
  ["happy-father", "father", "我的爸爸很开心。", "My father is happy.", ["my father is happy", "dad is happy", "my dad is happy"], "happy 表示开心的。"],
  ["like-cats", "cat", "我喜欢猫。", "I like cats.", ["i like cats", "i like the cat", "i like cat"], "like 表示喜欢。"],
  ["sad-dog", "sad", "这只狗很难过。", "The dog is sad.", ["the dog is sad", "this dog is sad", "the dog feels sad"], "sad 表示难过的。"]
] as const;

for (const [key, targetWord, promptChinese, referenceAnswer, acceptedAnswers, explanation] of sentencePrompts) {
  const sortOrder = sentencePrompts.findIndex((item) => item[0] === key) + 1;
  await prisma.sentencePrompt.upsert({
    where: { key },
    update: {
      targetWord,
      promptChinese,
      referenceAnswer,
      acceptedAnswers: [...acceptedAnswers],
      explanation,
      sortOrder,
      active: true
    },
    create: {
      key,
      targetWord,
      promptChinese,
      referenceAnswer,
      acceptedAnswers: [...acceptedAnswers],
      explanation,
      sortOrder
    }
  });
}

const dialoguePrompts = [
  [
    "ask-name",
    "Hello! What's your name?",
    "你好！你叫什么名字？",
    "My name is Amy.",
    ["my name is amy", "i am amy", "i'm amy"],
    "回答自己的名字；My name is ...、I am ... 或 I'm ... 都可以。"
  ],
  [
    "ask-age",
    "How old are you?",
    "你多大了？",
    "I'm eight.",
    ["i am six", "i'm six", "i am seven", "i'm seven", "i am eight", "i'm eight", "i am nine", "i'm nine", "i am ten", "i'm ten", "six", "seven", "eight", "nine", "ten"],
    "回答六到十岁中的任意年龄，简短回答或完整句都可以。"
  ],
  [
    "ask-book-color",
    "What color is your book?",
    "你的书是什么颜色？",
    "My book is blue.",
    ["my book is red", "my book is yellow", "my book is green", "my book is blue", "my book is black", "my book is white", "my book is pink", "it is red", "it is blue", "it's red", "it's blue"],
    "用基础包中的任意颜色回答书的颜色。"
  ],
  [
    "ask-pencil",
    "Is this your pencil?",
    "这是你的铅笔吗？",
    "Yes, it is.",
    ["yes", "yes it is", "yes it's mine", "no", "no it is not", "no it isn't"],
    "肯定或否定回答都可以，但要表达这是或不是自己的铅笔。"
  ],
  [
    "ask-family",
    "Who is she?",
    "她是谁？",
    "She is my mother.",
    ["she is my mother", "she's my mother", "she is my sister", "she's my sister"],
    "使用 mother 或 sister 介绍女性家庭成员。"
  ],
  [
    "ask-cat",
    "Do you like cats?",
    "你喜欢猫吗？",
    "Yes, I do.",
    ["yes", "yes i do", "yes i like cats", "no", "no i don't", "no i do not"],
    "肯定或否定回答都可以，表达是否喜欢猫。"
  ],
  [
    "ask-feeling",
    "How are you today?",
    "你今天感觉怎么样？",
    "I am happy.",
    ["i am happy", "i'm happy", "i am sad", "i'm sad", "i am fine", "i'm fine", "fine", "happy", "sad"],
    "使用 happy、sad 或 fine 回答自己的状态。"
  ],
  [
    "reply-thanks",
    "Thank you.",
    "谢谢你。",
    "You're welcome.",
    ["you are welcome", "you're welcome", "welcome", "no problem", "that's okay"],
    "对感谢作出礼貌回应。"
  ]
] as const;

for (const [key, question, questionChinese, referenceAnswer, acceptedAnswers, evaluationHint] of dialoguePrompts) {
  const sortOrder = dialoguePrompts.findIndex((item) => item[0] === key) + 1;
  await prisma.dialoguePrompt.upsert({
    where: { key },
    update: {
      question,
      questionChinese,
      referenceAnswer,
      acceptedAnswers: [...acceptedAnswers],
      evaluationHint,
      sortOrder,
      active: true
    },
    create: {
      key,
      question,
      questionChinese,
      referenceAnswer,
      acceptedAnswers: [...acceptedAnswers],
      evaluationHint,
      sortOrder
    }
  });
}

await prisma.$disconnect();
