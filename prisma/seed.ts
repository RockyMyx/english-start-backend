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
  ["greeting", "yes", "yes", "是；好的"],
  ["greeting", "no", "no", "不；不是"],
  ["greeting", "good", "good", "好的；不错的"],
  ["greeting", "ok", "OK", "好的；可以"],
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
  ["sentence", "he", "he", "他"],
  ["sentence", "she", "she", "她"],
  ["sentence", "his", "his", "他的"],
  ["sentence", "her", "her", "她的"],
  ["sentence", "it", "it", "它"],
  ["sentence", "this", "this", "这；这个"],
  ["sentence", "that", "that", "那；那个"],
  ["sentence", "my", "my", "我的"],
  ["sentence", "your", "your", "你的；你们的"],
  ["sentence", "me", "me", "我（宾格）"],
  ["sentence", "have", "have", "有"],
  ["sentence", "do", "do", "做；助动词"],
  ["sentence", "like", "like", "喜欢"],
  ["sentence", "want", "want", "想要"],
  ["sentence", "can", "can", "能；会"],
  ["sentence", "not", "not", "不；不是"],
  ["sentence", "a", "a", "一个（用于辅音音素前）"],
  ["sentence", "an", "an", "一个（用于元音音素前）"],
  ["sentence", "the", "the", "这个；那个（定冠词）"],
  ["sentence", "in", "in", "在……里面"],
  ["sentence", "on", "on", "在……上面"],
  ["sentence", "here", "here", "这里"],
  ["sentence", "there", "there", "那里"],
  ["color", "color", "color", "颜色"],
  ["color", "red", "red", "红色"],
  ["color", "yellow", "yellow", "黄色"],
  ["color", "green", "green", "绿色"],
  ["color", "blue", "blue", "蓝色"],
  ["color", "black", "black", "黑色"],
  ["color", "white", "white", "白色"],
  ["school", "book", "book", "书"],
  ["school", "pencil", "pencil", "铅笔"],
  ["school", "bag", "bag", "书包"],
  ["school", "table", "table", "桌子"],
  ["school", "chair", "chair", "椅子"],
  ["fruit", "apple", "apple", "苹果"],
  ["fruit", "banana", "banana", "香蕉"],
  ["life", "cat", "cat", "猫"],
  ["life", "dog", "dog", "狗"]
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
    "你好，这是我的书。",
    "Hello, this is my book.",
    ["hello this is my book"],
    "先用 Hello 打招呼，再用 This is my ... 介绍物品。"
  ],
  ["name", "name", "这是我的名字。", "This is my name.", ["this is my name"], "This is my ... 用来介绍自己的事物。"],
  ["one-book", "one", "我有一本书。", "I have one book.", ["i have one book", "i have a book"], "one 表示一个。"],
  ["six-years-old", "six", "我六岁。", "I am six.", ["i am six", "i'm six", "i am six years old", "i'm six years old"], "年龄可以直接用 I am + 数字。"],
  ["eight-years-old", "eight", "我八岁。", "I am eight.", ["i am eight", "i'm eight", "i am eight years old", "i'm eight years old"], "年龄可以直接用 I am + 数字。"],
  ["ask-color", "color", "这是什么颜色？", "What color is this?", ["what color is this", "what colour is this"], "What color ...? 用来询问颜色。"],
  ["red", "red", "它是红色的。", "It is red.", ["it is red", "it's red", "this is red"], "It is + 颜色可以描述物品颜色。"],
  ["blue-bag", "blue", "我的书包是蓝色的。", "My bag is blue.", ["my bag is blue", "the bag is blue"], "颜色通常放在 be 动词后面。"],
  ["green-pencil", "green", "这支铅笔是绿色的。", "This pencil is green.", ["this pencil is green", "the pencil is green"], "This pencil 指这支铅笔。"],
  ["my-book", "book", "这是我的书。", "This is my book.", ["this is my book", "it is my book", "it's my book"], "This is my ... 用来介绍自己的物品。"],
  ["a-pencil", "pencil", "我有一支铅笔。", "I have a pencil.", ["i have a pencil", "i've got a pencil"], "I have ... 表示我有……"],
  ["an-apple", "an", "我有一个苹果。", "I have an apple.", ["i have an apple"], "元音音素前使用 an。"],
  ["this-table", "table", "这是一张桌子。", "This is a table.", ["this is a table"], "This is a ... 用来介绍眼前的物品。"],
  ["that-chair", "chair", "那是一把椅子。", "That is a chair.", ["that is a chair"], "That 表示离说话者较远的人或物。"],
  ["his-book", "his", "这是他的书。", "This is his book.", ["this is his book"], "his 表示他的。"],
  ["her-bag", "her", "那是她的书包。", "That is her bag.", ["that is her bag"], "her 表示她的。"],
  ["have-cat", "cat", "我有一只猫。", "I have a cat.", ["i have a cat"], "I have ... 表示我有……"],
  ["this-dog", "dog", "这是一只狗。", "This is a dog.", ["this is a dog", "it is a dog"], "This is a ... 可以介绍动物。"],
  ["like-apple", "like", "我喜欢这个苹果。", "I like the apple.", ["i like the apple"], "like 表示喜欢。"],
  ["want-banana", "want", "我想要一根香蕉。", "I want a banana.", ["i want a banana"], "want 表示想要。"],
  ["can-do-it", "can", "我能做到。", "I can do it.", ["i can do it"], "can 表示能、会。"],
  ["book-not-red", "not", "这本书不是红色的。", "The book is not red.", ["the book is not red"], "not 用来表达否定。"],
  ["the-book", "the", "这本书是红色的。", "The book is red.", ["the book is red"], "the 用在明确的人或物前。"],
  ["book-on-table", "on", "书在桌子上。", "The book is on the table.", ["the book is on the table"], "on 表示在……上面。"],
  ["pencil-in-bag", "in", "铅笔在书包里。", "The pencil is in the bag.", ["the pencil is in the bag"], "in 表示在……里面。"],
  ["book-here", "here", "书在这里。", "The book is here.", ["the book is here"], "here 表示这里。"],
  ["bag-there", "there", "书包在那里。", "The bag is there.", ["the bag is there"], "there 表示那里。"]
] as const;

await prisma.sentencePrompt.updateMany({
  where: { key: { notIn: sentencePrompts.map(([key]) => key) } },
  data: { active: false }
});

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
    ["my book is red", "my book is yellow", "my book is green", "my book is blue", "my book is black", "my book is white", "it is red", "it is blue", "it's red", "it's blue"],
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
    "ask-he-age",
    "Is he six?",
    "他六岁吗？",
    "Yes, he is.",
    ["yes", "yes he is", "no", "no he is not", "no he isn't"],
    "使用 Yes 或 No 回答他的年龄是否正确。"
  ],
  [
    "ask-have-cat",
    "Do you have a cat?",
    "你有猫吗？",
    "Yes, I do.",
    ["yes", "yes i do", "no", "no i don't", "no i do not"],
    "肯定或否定回答都可以，表达自己是否有猫。"
  ],
  [
    "ask-feeling",
    "How are you?",
    "你怎么样？",
    "I am good.",
    ["i am good", "i'm good", "good", "i am ok", "i'm ok", "ok"],
    "使用 good 或 OK 回答自己的状态。"
  ],
  [
    "ask-that-bag",
    "Is that your bag?",
    "那是你的书包吗？",
    "Yes, it is.",
    ["yes", "yes it is", "no", "no it is not", "no it isn't"],
    "使用 Yes 或 No 回答物品是否属于自己。"
  ]
] as const;

await prisma.dialoguePrompt.updateMany({
  where: { key: { notIn: dialoguePrompts.map(([key]) => key) } },
  data: { active: false }
});

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
