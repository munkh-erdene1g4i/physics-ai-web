import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

function safeParseJSON(raw) {
  let text = raw.trim();
  text = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "");

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1);
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    const fixed = text.replace(/\\(?!["\\/bfnrtu])/g, "\\\\");
    return JSON.parse(fixed);
  }
}

// A, B, C, D хувилбаруудыг санамсаргүй байдлаар хольж, зөв хариултын индексийг шинэчлэх
function shuffleOptions(questions) {
  if (!Array.isArray(questions)) return questions;
  return questions.map((q) => {
    if (!Array.isArray(q.options) || q.options.length < 2) return q;
    const correctText = q.options[q.correctIndex];
    const shuffled = [...q.options];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return {
      ...q,
      options: shuffled,
      correctIndex: shuffled.indexOf(correctText),
    };
  });
}

async function callOpenRouter(systemPrompt, userPrompt, maxTokens = 4000) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY олдсонгүй. .env эсвэл Render-ийн Environment хэсгээ шалгана уу.");
  }

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "[https://physics-ai-web.onrender.com](https://physics-ai-web.onrender.com)",
      "X-Title": "Physics AI Web",
    },
    body: JSON.stringify({
      model: "openrouter/free",
      temperature: 0.4,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  const result = await response.json();
  if (!response.ok) {
    console.error("OpenRouter Error:", result);
    throw new Error(result.error?.message || "OpenRouter API дээр алдаа гарлаа.");
  }

  const content = result.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("AI загвар хоосон хариулт буцаалаа. Дахин оролдоно уу.");
  }

  return safeParseJSON(content);
}

// 1. Тест үүсгэх зам (Хугацаа, Түвшин, Даалгаврын тоо)
app.post("/api/generate", async (req, res) => {
  try {
    const { topic, minutes, difficulty, questionCount } = req.body;

    if (!topic || !topic.trim()) {
      return res.status(400).json({ error: "Физикийн сэдвээ оруулна уу." });
    }

    const duration = Math.min(180, Math.max(3, parseInt(minutes, 10) || 10));
    const count = Math.min(30, Math.max(1, parseInt(questionCount, 10) || 10));
    const maxTokens = Math.min(6000, Math.max(3000, count * 300));

    const levelMap = {
      "Анхан шат": "Анхан шат — үндсэн ойлголт, тодорхойлолт, нэгж шилжүүлэг болон 1 үйлдэлтэй энгийн томьёо ашиглах хөнгөн бодлогууд.",
      "Дунд шат": "Дунд шат — сурах бичгийн стандарт бодлогууд, томьёо хувиргаж бодох, 2-3 үйлдэлтэй дундаж хүндрэлтэй даалгаврууд.",
      "Хүндэвтэр": "Хүндэвтэр — ЭЕШ болон олимпиадын бэлтгэлийн түвшний, хэд хэдэн хууль хослуулан бодох, сэтгэлгээ ба тооцоолол шаардсан хүндэвтэр бодлогууд.",
    };
    const selectedLevel = levelMap[difficulty] ? difficulty : "Дунд шат";
    const levelDesc = levelMap[selectedLevel];

    const systemPrompt = `Чи бол ЕБС-ийн ахлах ангийн Физикийн мэргэжлийн багш. Физикээс өөр ямар ч сэдэвт хариулахгүй.
ЧУХАЛ: JSON дотор LaTeX томьёо бичихдээ $...$ хаалт ашиглаж, бүх \\ тэмдэгтийг ЗААВАЛ давхар \\\\ гэж бич (жишээ нь: $\\\\frac{a}{b}$, $F = m \\\\cdot a$, $\\\\Delta t$).
Ямар ч нэмэлт тайлбар бичилгүйгээр ЗӨВХӨН дараах бүтэцтэй цэвэр JSON буцаа:
{
  "isPhysics": true эсвэл false,
  "rejectionMessage": "Физикийн сэдэв биш бол татгалзсан тайлбар, мөн бол хоосон текст",
  "topicTitle": "Шалгалтын гарчиг",
  "questions": [
    {
      "question": "Асуултын текст",
      "options": ["Сонголт A", "Сонголт B", "Сонголт C", "Сонголт D"],
      "correctIndex": 0,
      "explanation": "Бодолт болон зөв хариултын 1-2 өгүүлбэр товч тайлбар"
    }
  ]
}`;

    const userPrompt = `Хэрэглэгчийн оруулсан сэдэв: "${topic.trim()}"
Өгөгдсөн хугацаа: ${duration} минут.
Шалгалтын түвшин: ${levelDesc}
Даалгаврын тоо: Яг ${count} ширхэг.

Заавар:
1. Энэ сэдэв нь Физикийн шинжлэх ухаанд хамаарах эсэхийг шалга.
2. Хэрэв Физикт хамаарахгүй бол "isPhysics": false болгоод "rejectionMessage" хэсэгт "Уучлаарай, энэ систем зөвхөн Физикийн хичээлийн сэдвээр шалгалт авдаг." гэж бичээд questions массивыг хоосон [] буцаа.
3. Хэрэв Физикийн сэдэв мөн бол "isPhysics": true болгоод сонгосон "${selectedLevel}" түвшинд яг тохирсон ${count} ширхэг 4 сонголттой тест зохио (correctIndex нь 0-3 хооронд бүхэл тоо байна).
4. Тайлбар (explanation) хэсгийг маш товч, оновчтой 1-2 өгүүлбэрээр бич.
5. Бүх бичвэр цэвэрхэн, алдаагүй Монгол хэлээр байна.`;

    const data = await callOpenRouter(systemPrompt, userPrompt, maxTokens);
    if (data.isPhysics && data.questions) {
      data.questions = shuffleOptions(data.questions);
    }
    res.json(data);
  } catch (error) {
    console.error("Generate Error:", error);
    res.status(500).json({ error: error.message || "Тест боловсруулах явцад алдаа гарлаа." });
  }
});

// 2. Алдсан асуултууд дээр үндэслэн онол боловсруулах зам
app.post("/api/remedial-theory", async (req, res) => {
  try {
    const { topicTitle, wrongQuestions } = req.body;

    if (!wrongQuestions || wrongQuestions.length === 0) {
      return res.json({ advice: "", theory: [] });
    }

    const systemPrompt = `Чи бол ЕБС-ийн ахлах ангийн Физикийн багш. Сурагчийн шалгалт дээр алдсан асуултуудыг шинжилж, яг дутуу ойлгосон онол, томьёо, хуулийг нь маш ойлгомжтой тайлбарлаж өгнө.
ЧУХАЛ: JSON дотор LaTeX томьёо бичихдээ $...$ хаалт ашиглаж, бүх \\ тэмдэгтийг ЗААВАЛ давхар \\\\ гэж бич (жишээ нь: $\\\\frac{a}{b}$, $F = m \\\\cdot a$).
Ямар ч нэмэлт тайлбар бичилгүйгээр ЗӨВХӨН дараах JSON форматаар буцаа:
{
  "advice": "Сурагчид өгөх 1-2 өгүүлбэр ерөнхий зөвлөгөө",
  "theory": [
    {
      "heading": "Алдсан ойлголт эсвэл хуулийн нэр",
      "content": "Ойлгомжтой онолын тайлбар, гол томьёог LaTeX хэлбэрээр оруулна"
    }
  ]
}`;

    const mistakesText = wrongQuestions
      .map(
        (item, idx) =>
          `${idx + 1}. Асуулт: ${item.question}\n   Сурагчийн хариулт: ${item.userAnswer}\n   Зөв хариулт: ${item.correctAnswer}`
      )
      .join("\n\n");

    const userPrompt = `Сэдэв: "${topicTitle}"
Сурагчийн алдсан эсвэл хариулаагүй асуултууд:
${mistakesText}

Эдгээр алдаан дээр үндэслэн сурагч чухам ямар онол, томьёо, физик утгыг андуурсан байгааг тодорхойлж, 2-4 хэсгээс бүрдсэн цэгцтэй давтлага онол боловсруулж өг. Бүх бичвэр цэвэрхэн Монгол хэлээр байна.`;

    const data = await callOpenRouter(systemPrompt, userPrompt, 3000);
    res.json(data);
  } catch (error) {
    console.error("Remedial Theory Error:", error);
    res.status(500).json({ error: error.message || "Давтлага онол боловсруулахад алдаа гарлаа." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Сервер http://localhost:${PORT} дээр ажиллаж байна`);
});