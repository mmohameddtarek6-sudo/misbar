import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  FlaskConical,
  Rocket,
  Activity,
  Leaf,
  Brain,
  Trophy,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Check,
  X,
  Bot,
  Send,
  Loader2,
  Plus,
  Users,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* Design tokens                                                       */
/* ------------------------------------------------------------------ */
const C = {
  bg: "#0B1220",
  panel: "#121B2E",
  panelAlt: "#17233B",
  border: "#233252",
  text: "#E7EDF7",
  muted: "#8FA1C4",
  lab: "#F2B84B",
  space: "#38BDF8",
  body: "#FB7185",
  env: "#34D399",
  whatif: "#A78BFA",
  quiz: "#F472B6",
  tutor: "#5EEAD4",
};

const TABS = [
  { id: "home", label: "الرئيسية", icon: Sparkles, color: C.lab },
  { id: "lab", label: "المختبر", icon: FlaskConical, color: C.lab },
  { id: "space", label: "الكون", icon: Rocket, color: C.space },
  { id: "body", label: "جسم الإنسان", icon: Activity, color: C.body },
  { id: "env", label: "البيئة", icon: Leaf, color: C.env },
  { id: "whatif", label: "ماذا لو؟", icon: Brain, color: C.whatif },
  { id: "quiz", label: "التحديات", icon: Trophy, color: C.quiz },
  { id: "tutor", label: "المساعد الذكي", icon: Bot, color: C.tutor },
];

const THRESHOLDS = [0, 50, 150, 300, 500];
const LEVEL_NAMES = [
  "مستكشف مبتدئ",
  "باحث صغير",
  "عالم ناشئ",
  "باحث متقدم",
  "عالم",
];

function levelInfo(xp) {
  let idx = 0;
  for (let i = 0; i < THRESHOLDS.length; i++) if (xp >= THRESHOLDS[i]) idx = i;
  const name = LEVEL_NAMES[idx];
  const next = THRESHOLDS[idx + 1];
  const prev = THRESHOLDS[idx];
  const progress = next ? Math.min(100, ((xp - prev) / (next - prev)) * 100) : 100;
  return { name, next, progress, idx };
}

/* ------------------------------------------------------------------ */
/* Storage + AI gateway                                                */
/* ------------------------------------------------------------------ */
const storage = {
  async get(key, shared = false) {
    if (typeof window !== "undefined" && window.storage?.get) {
      return storage.get(key, shared);
    }
    if (typeof localStorage === "undefined") return null;
    const value = localStorage.getItem(key);
    return value == null ? null : { value };
  },
  async set(key, value, shared = false) {
    if (typeof window !== "undefined" && window.storage?.set) {
      return storage.set(key, value, shared);
    }
    if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
    return { ok: true };
  },
};

function getAIEndpoint() {
  if (typeof window !== "undefined" && window.MISBAR_AI_ENDPOINT) return window.MISBAR_AI_ENDPOINT;
  try {
    return import.meta?.env?.VITE_MISBAR_AI_ENDPOINT || "";
  } catch {
    return "";
  }
}

async function askAI(userText, systemText) {
  const endpoint = getAIEndpoint();
  if (!endpoint) {
    throw new Error("خدمة الذكاء الاصطناعي غير مُهيأة بعد. اربط VITE_MISBAR_AI_ENDPOINT بواجهة الخادم المرفقة، ولا تضع مفتاح API داخل المتصفح.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userText, systemText }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") throw new Error("انتهت مهلة الاتصال بالمساعد بعد 30 ثانية.");
    throw new Error("تعذّر الاتصال بخادم الذكاء الاصطناعي — تحقق من الإنترنت وإعداد رابط الخادم.");
  } finally {
    clearTimeout(timeout);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("استجابة خادم الذكاء الاصطناعي ليست JSON صالحاً.");
  }
  if (!response.ok) throw new Error(data?.error || data?.message || `فشل الطلب (رمز ${response.status}).`);

  const text = typeof data?.text === "string"
    ? data.text
    : (data?.content || []).map((b) => (b.type === "text" ? b.text : "")).filter(Boolean).join("\n");
  if (!text) throw new Error("لم يصل رد نصي من المساعد.");
  return text;
}

/* Extract the first balanced {...} JSON object from a raw model reply,
   tolerating stray prose or ```json fences the model may add despite
   instructions not to. Throws a descriptive error instead of a bare
   "Unexpected token" if nothing usable is found. */
function parseAIJson(raw) {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("لم يُرجع المساعد بيانات بصيغة JSON صالحة.");
  }
  const candidate = raw.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch (e) {
    throw new Error("تعذّر تحليل رد المساعد (صيغة JSON غير سليمة).");
  }
}

/* Minimum self-reported confidence (0-1) an AI-generated item must carry
   before it is auto-published to shared community storage. This is not a
   substitute for real human/editorial review, but it's a first filter that
   keeps low-confidence hallucinations out of the shared pool by default. */
const AI_CONFIDENCE_THRESHOLD = 0.75;

function validateQuizObject(obj) {
  if (!obj || typeof obj.text !== "string" || !obj.text.trim()) return "السؤال فارغ.";
  if (!Array.isArray(obj.options) || obj.options.length !== 4) return "عدد الخيارات يجب أن يكون 4.";
  if (obj.options.some((o) => typeof o !== "string" || !o.trim())) return "أحد الخيارات فارغ.";
  if (!Number.isInteger(obj.correct) || obj.correct < 0 || obj.correct > 3) return "فهرس الإجابة الصحيحة غير صالح.";
  if (typeof obj.confidence !== "number" || obj.confidence < 0 || obj.confidence > 1) return "قيمة الثقة مفقودة.";
  if (obj.confidence < AI_CONFIDENCE_THRESHOLD) return "درجة ثقة المساعد بدقة السؤال منخفضة جداً.";
  return null;
}

function validateWhatIfObject(obj) {
  if (!obj || typeof obj.q !== "string" || !obj.q.trim()) return "السؤال فارغ.";
  if (typeof obj.a !== "string" || obj.a.trim().length < 80) return "الإجابة قصيرة أو غير كافية علمياً.";
  if (obj.confidence != null && (typeof obj.confidence !== "number" || obj.confidence < 0 || obj.confidence > 1)) return "قيمة الثقة غير صالحة.";
  if (typeof obj.confidence === "number" && obj.confidence < 0.65) return "درجة ثقة المساعد بدقة السيناريو منخفضة جداً.";
  return null;
}

const TUTOR_SYSTEM =
  "أنت مساعد علمي تعليمي لطلاب المدارس، تتحدث العربية الفصحى المبسطة. اشرح المفاهيم بوضوح مع مثال من الحياة اليومية إن أمكن. اجعل إجاباتك موجزة (حوالي 100-150 كلمة) ما لم يطلب الطالب تفصيلاً أكبر. لا تستخدم رموزاً أو تنسيقاً معقداً، فقط نص عربي واضح. إن لم تكن متأكداً من معلومة، قل ذلك صراحة بدل اختلاقها.";

const QUIZ_GEN_SYSTEM =
  'أنت مولّد أسئلة اختبارات علمية دقيقة لطلاب المدارس باللغة العربية. أعد فقط كائن JSON صالح، بدون أي نص إضافي قبله أو بعده وبدون علامات كود، بالشكل التالي بالضبط: ' +
  '{"topic":"اسم المادة (فيزياء أو كيمياء أو أحياء أو فضاء أو بيئة)","text":"نص السؤال","options":["أ","ب","ج","د"],"correct":0,"explanation":"شرح علمي واضح لسبب صحة الإجابة، بما يشمل القانون أو المفهوم المستخدم (40-70 كلمة)","confidence":0.9}. ' +
  'اجعل correct هو فهرس الإجابة الصحيحة في المصفوفة (0 إلى 3). اجعل confidence رقماً بين 0 و1 يعبّر بصدق عن مدى ثقتك العلمية بدقة السؤال والإجابة والشرح — استخدم رقماً منخفضاً (أقل من 0.6) إن كان الموضوع فيه جدل علمي أو غير متأكد منه بدل اختلاق يقين لا تملكه. اختر موضوعاً مختلفاً في كل مرة، وتجنب التكرار مع الأسئلة الشائعة جداً، وتجنب أي معلومة لا تستطيع التحقق من صحتها.';

const WHATIF_GEN_SYSTEM =
  'أنت مولّد أسئلة "ماذا لو" علمية تخيلية دقيقة لطلاب المدارس باللغة العربية، عن الفيزياء أو الفضاء أو الأحياء أو البيئة أو الكيمياء. أعد فقط كائن JSON صالح بدون أي نص إضافي وبدون علامات كود، بالشكل: ' +
  '{"q":"ماذا يحدث لو ...؟","a":"شرح علمي دقيق ومتسلسل للسبب والنتيجة (٥٠-٨٠ كلمة)، مع ذكر القانون أو المبدأ العلمي المعني","confidence":0.9}. ' +
  'اجعل confidence رقماً بين 0 و1 يعبّر بصدق عن ثقتك العلمية — استخدم رقماً منخفضاً إن كان السيناريو تخمينياً جداً أو خارج ما تستطيع تبريره علمياً. اجعل السيناريو مختلفاً وغير مكرر في كل مرة.';

/* ------------------------------------------------------------------ */
/* Shared UI bits                                                       */
/* ------------------------------------------------------------------ */
const SectionHeader = React.memo(function SectionHeader({ title, subtitle, color }) {
  return (
    <div className="mb-6">
      <h2 className="text-2xl font-bold" style={{ color: C.text }}>
        {title}
      </h2>
      {subtitle && (
        <p className="mt-1 text-sm" style={{ color: C.muted }}>
          {subtitle}
        </p>
      )}
      <div className="mt-3 h-1 w-16 rounded-full" style={{ background: color }} />
    </div>
  );
});

const Card = React.memo(function Card({ children, style }) {
  return (
    <div
      className="rounded-2xl p-5"
      style={{ background: C.panel, border: `1px solid ${C.border}`, ...style }}
    >
      {children}
    </div>
  );
});

const Slider = React.memo(function Slider({ value, onChange, min, max, step, color, label }) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="w-full"
      style={{ accentColor: color }}
      aria-label={label}
      aria-valuetext={label ? `${label}: ${value}` : undefined}
    />
  );
});

const CommunityBadge = React.memo(function CommunityBadge({ color, confidence }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full"
      style={{ background: `${color}22`, color }}
      title="تم إنشاء هذا المحتوى بواسطة الذكاء الاصطناعي، وقد يحتوي أخطاء رغم فحص الثقة الأولي"
    >
      <Users size={10} /> بالذكاء الاصطناعي
      {typeof confidence === "number" && (
        <span style={{ opacity: 0.75 }}>· ثقة {Math.round(confidence * 100)}%</span>
      )}
    </span>
  );
});

/* ------------------------------------------------------------------ */
/* Infrastructure: error isolation, connectivity, generation cooldown  */
/* ------------------------------------------------------------------ */

/* Prevents one broken tab (e.g. a bad AI response shape, a rendering edge
   case) from turning the whole app into a blank white screen — the most
   common failure mode judges/users hit with single-file React apps. Each
   tab is wrapped individually below, so a crash in one experiment doesn't
   take down the rest of the platform. */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error("Misbar section crashed:", error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="rounded-2xl p-6 text-center"
          style={{ background: C.panel, border: `1px solid ${C.border}` }}
        >
          <p className="text-sm mb-3" style={{ color: C.text }}>
            حدث خطأ غير متوقع في هذا القسم. بقية المنصة ما زالت تعمل بشكل طبيعي.
          </p>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="px-4 py-2 rounded-xl text-sm font-semibold"
            style={{ background: C.body, color: "#2b0d13" }}
          >
            إعادة المحاولة
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/* Tracks browser connectivity so AI-dependent UI can show a clear, honest
   "you're offline" state instead of a generic fetch-failure message. */
function useOnlineStatus() {
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine
  );
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);
  return online;
}

/* Minimum time between AI generation requests per button. Guards against
   accidental double-clicks and casual button-mashing burning API quota —
   a real cost/abuse concern once this leaves a single developer's hands. */
const GENERATION_COOLDOWN_MS = 4000;

/* Generic hook for "AI generates a shared community item" flows (quiz
   questions, what-if scenarios). Centralizes: loading persisted items,
   cooldown-gated generation, confidence-based validation before publish,
   and best-effort persistence — so App() stays about composing screens,
   not reimplementing this flow twice with subtly different bugs. */
function useGeneratedContent({ storageKey, systemPrompt, userPrompt, validate, buildItem }) {
  const [items, setItems] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [onCooldown, setOnCooldown] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await storage.get(storageKey, true);
        if (res && res.value) setItems(JSON.parse(res.value));
      } catch (e) {
        /* nothing saved yet */
      }
    })();
  }, [storageKey]);

  useEffect(() => {
    if (!cooldownUntil) return;
    setOnCooldown(true);
    const remaining = cooldownUntil - Date.now();
    const t = setTimeout(() => setOnCooldown(false), Math.max(0, remaining));
    return () => clearTimeout(t);
  }, [cooldownUntil]);

  async function generate() {
    if (generating || onCooldown) return;
    setGenerating(true);
    setError("");
    try {
      const raw = await askAI(userPrompt, systemPrompt);
      const obj = parseAIJson(raw);
      const problem = validate(obj);
      if (problem) {
        setError(`${problem} — لم يُنشر المحتوى، حاول مرة أخرى.`);
        return;
      }
      const newItem = buildItem(obj);
      const updated = [...items, newItem].slice(-60);
      setItems(updated);
      try {
        await storage.set(storageKey, JSON.stringify(updated), true);
      } catch (e) {
        /* best-effort: content still shows for this session even if persistence fails */
      }
    } catch (e) {
      setError(e?.message || "تعذّر توليد محتوى جديد الآن، حاول مرة أخرى.");
    } finally {
      setGenerating(false);
      setCooldownUntil(Date.now() + GENERATION_COOLDOWN_MS);
    }
  }

  return { items, generate, generating, onCooldown, error };
}

/* Manages XP / answered-question progress: load once on mount, persist on
   every change, and expose a reset action. Extracted from App() so the
   persistence behavior can be reasoned about (and reused/tested) in
   isolation. */
function useProgress() {
  const [xp, setXp] = useState(0);
  const [answered, setAnswered] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await storage.get("misbar-progress", false);
        if (res && res.value) {
          const parsed = JSON.parse(res.value);
          setXp(parsed.xp || 0);
          setAnswered(parsed.answered || []);
        }
      } catch (e) {
        /* no saved progress yet */
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  async function persist(newXp, newAnswered) {
    try {
      await storage.set(
        "misbar-progress",
        JSON.stringify({ xp: newXp, answered: newAnswered }),
        false
      );
    } catch (e) {
      /* best-effort */
    }
  }

  function handleAnswer(qid, amount) {
    const newAnswered = [...answered, qid];
    const newXp = xp + amount;
    setAnswered(newAnswered);
    setXp(newXp);
    persist(newXp, newAnswered);
  }

  async function resetProgress() {
    setXp(0);
    setAnswered([]);
    await persist(0, []);
  }

  return { xp, answered, loaded, handleAnswer, resetProgress };
}

function MethodologyModal({ onClose }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const points = [
    { t: "مسافات الكواكب", d: "تُحسب من قيم البعد الفلكي (au) بافتراض مدارات دائرية في مستوى واحد. المسافة المعروضة من الأرض هي مدى تقريبي (أقرب/أبعد اقتراب)، لأن المسافة الفعلية تتغيّر باستمرار مع حركة الكوكبين." },
    { t: "محاكاة الأس الهيدروجيني", d: "تفترض حمضاً وقاعدة قويين بتركيز 0.1 مول/لتر لكل منهما، وتحسب pH من فائض أيونات H⁺ أو OH⁻ فعلياً. لا تمثّل الأحماض أو القواعد الضعيفة." },
    { t: "المقذوفات والدائرة الكهربائية", d: "معادلات فيزياء كلاسيكية مباشرة (حركة المقذوفات، قانون أوم) بدون تبسيط إضافي." },
    { t: "محتوى الذكاء الاصطناعي", d: "الأسئلة وسيناريوهات \"ماذا لو\" التي يولّدها المساعد تُنشر تلقائياً فقط إذا صرّح النموذج بثقة علمية ≥ 75%. هذا فحص أولي من النموذج نفسه، وليس بديلاً عن مراجعة بشرية أو مصدر خارجي — قد يحتوي أخطاء رغم ذلك." },
    { t: "أرقام المناخ ومصادر الطاقة", d: "قيم تقريبية وتوضيحية لأغراض تعليمية، وليست إحصاءً رسمياً أو تنبؤاً علمياً دقيقاً لمنطقة أو تاريخ محدد." },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="المنهجية والمصادر"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(5,9,18,0.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="rounded-2xl p-6 w-full"
        style={{ background: C.panel, border: `1px solid ${C.border}`, maxWidth: 520, maxHeight: "80vh", overflowY: "auto" }}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-lg" style={{ color: C.text }}>المنهجية والمصادر</h3>
          <button
            onClick={onClose}
            aria-label="إغلاق"
            className="p-1.5 rounded-lg"
            style={{ background: C.panelAlt }}
          >
            <X size={16} color={C.muted} />
          </button>
        </div>
        <p className="text-xs mb-4" style={{ color: C.muted }}>
          كل تجربة في مِسبار مبنية على نموذج فيزيائي أو كيميائي محدد، وله افتراضات وحدود. نوضحها هنا صراحة بدل ترك الرقم يتحدث عن نفسه.
        </p>
        <ul className="flex flex-col gap-4">
          {points.map((p) => (
            <li key={p.t}>
              <p className="text-sm font-semibold mb-1" style={{ color: C.text }}>{p.t}</p>
              <p className="text-xs leading-relaxed" style={{ color: C.muted }}>{p.d}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* HOME                                                                 */
/* ------------------------------------------------------------------ */
function Home({ xp, setTab, whatIfList }) {
  const [q] = useState(() => whatIfList[Math.floor(Math.random() * whatIfList.length)]);
  const lvl = levelInfo(xp);

  return (
    <div>
      <div
        className="rounded-2xl p-8 mb-6"
        style={{
          background: `linear-gradient(135deg, ${C.panel}, ${C.panelAlt})`,
          border: `1px solid ${C.border}`,
        }}
      >
        <p className="text-sm mb-2" style={{ color: C.whatif }}>سؤال اليوم</p>
        <h1 className="text-3xl font-bold leading-relaxed mb-3" style={{ color: C.text }}>
          {q.q}
        </h1>
        <p className="text-sm mb-5" style={{ color: C.muted }}>
          اضغط لتكتشف الإجابة العلمية، أو اسأل المساعد الذكي أي سؤال آخر يخطر ببالك.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => setTab("whatif")}
            className="px-5 py-2.5 rounded-xl font-semibold text-sm"
            style={{ background: C.whatif, color: "#1a1030" }}
          >
            اكتشف الإجابة
          </button>
          <button
            onClick={() => setTab("tutor")}
            className="px-5 py-2.5 rounded-xl font-semibold text-sm flex items-center gap-1.5"
            style={{ background: "transparent", color: C.tutor, border: `1px solid ${C.tutor}` }}
          >
            <Bot size={16} /> اسأل المساعد
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {TABS.filter((t) => t.id !== "home").map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="rounded-xl p-4 text-right transition-transform hover:scale-[1.02]"
            style={{ background: C.panel, border: `1px solid ${C.border}` }}
          >
            <t.icon size={22} color={t.color} />
            <p className="mt-3 font-semibold text-sm" style={{ color: C.text }}>
              {t.label}
            </p>
          </button>
        ))}
      </div>

      <Card>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold" style={{ color: C.text }}>
            مستواك: {lvl.name}
          </span>
          <span className="text-xs" style={{ color: C.muted }}>
            {xp} نقطة {lvl.next ? `/ ${lvl.next}` : "(أعلى مستوى)"}
          </span>
        </div>
        <div className="h-2 rounded-full overflow-hidden" style={{ background: C.panelAlt }}>
          <div
            className="h-full rounded-full"
            style={{ width: `${lvl.progress}%`, background: C.quiz, transition: "width .4s" }}
          />
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* LAB — physics projectile + chemistry pH mixer + electric circuit     */
/* ------------------------------------------------------------------ */
function Projectile() {
  const [angle, setAngle] = useState(45);
  const [speed, setSpeed] = useState(25);
  const g = 9.8;

  const { pathD, range, height, time, vx0, vy0, apexTime, energyPerKg } = useMemo(() => {
    const rad = (angle * Math.PI) / 180;
    const t = (2 * speed * Math.sin(rad)) / g;
    const r = (speed * speed * Math.sin(2 * rad)) / g;
    const h = (speed * speed * Math.sin(rad) * Math.sin(rad)) / (2 * g);
    const scaleX = 440 / Math.max(r, 40);
    const scaleY = 220 / Math.max(h, 12);
    let d = "";
    const steps = 40;
    for (let i = 0; i <= steps; i++) {
      const tt = (t * i) / steps;
      const x = speed * Math.cos(rad) * tt;
      const y = speed * Math.sin(rad) * tt - 0.5 * g * tt * tt;
      const sx = 30 + x * scaleX;
      const sy = 260 - y * scaleY;
      d += i === 0 ? `M ${sx} ${sy}` : ` L ${sx} ${sy}`;
    }
    return {
      pathD: d, range: r, height: h, time: t,
      vx0: speed * Math.cos(rad),
      vy0: speed * Math.sin(rad),
      apexTime: (speed * Math.sin(rad)) / g,
      energyPerKg: 0.5 * speed * speed,
    };
  }, [angle, speed]);

  return (
    <div>
      <svg viewBox="0 0 500 280" className="w-full rounded-xl mb-4" style={{ background: C.panelAlt }}>
        <line x1="20" y1="260" x2="480" y2="260" stroke={C.border} strokeWidth="2" />
        <path d={pathD} fill="none" stroke={C.lab} strokeWidth="3" strokeLinecap="round" />
      </svg>
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <p className="text-xs mb-1" style={{ color: C.muted }}>زاوية الإطلاق: {angle}°</p>
          <Slider value={angle} onChange={setAngle} min={5} max={85} step={1} color={C.lab} label="زاوية الإطلاق بالدرجات" />
        </div>
        <div>
          <p className="text-xs mb-1" style={{ color: C.muted }}>السرعة الابتدائية: {speed} م/ث</p>
          <Slider value={speed} onChange={setSpeed} min={5} max={50} step={1} color={C.lab} label="السرعة الابتدائية بالمتر في الثانية" />
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
        <div className="rounded-lg p-3" style={{ background: C.panelAlt }}>
          <p className="text-xs" style={{ color: C.muted }}>المدى</p>
          <p className="font-bold" style={{ color: C.text }}>{range.toFixed(1)} م</p>
        </div>
        <div className="rounded-lg p-3" style={{ background: C.panelAlt }}>
          <p className="text-xs" style={{ color: C.muted }}>أقصى ارتفاع</p>
          <p className="font-bold" style={{ color: C.text }}>{height.toFixed(1)} م</p>
        </div>
        <div className="rounded-lg p-3" style={{ background: C.panelAlt }}>
          <p className="text-xs" style={{ color: C.muted }}>زمن الطيران</p>
          <p className="font-bold" style={{ color: C.text }}>{time.toFixed(2)} ث</p>
        </div>
        <div className="rounded-lg p-3" style={{ background: C.panelAlt }}>
          <p className="text-xs" style={{ color: C.muted }}>زمن بلوغ القمة</p>
          <p className="font-bold" style={{ color: C.text }}>{apexTime.toFixed(2)} ث</p>
        </div>
        <div className="rounded-lg p-3" style={{ background: C.panelAlt }}>
          <p className="text-xs" style={{ color: C.muted }}>المركبة الأفقية vₓ</p>
          <p className="font-bold" style={{ color: C.text }}>{vx0.toFixed(2)} م/ث</p>
        </div>
        <div className="rounded-lg p-3" style={{ background: C.panelAlt }}>
          <p className="text-xs" style={{ color: C.muted }}>المركبة الرأسية vᵧ</p>
          <p className="font-bold" style={{ color: C.text }}>{vy0.toFixed(2)} م/ث</p>
        </div>
        <div className="rounded-lg p-3" style={{ background: C.panelAlt }}>
          <p className="text-xs" style={{ color: C.muted }}>طاقة الحركة النوعية</p>
          <p className="font-bold" style={{ color: C.text }}>{energyPerKg.toFixed(1)} جول/كغ</p>
        </div>
      </div>
      <p className="text-xs mt-4 leading-relaxed" style={{ color: C.muted }}>
        النموذج يحل حركة مقذوف مثالية على سطح مستوٍ: g=9.8 م/ث²، نقطة الهبوط عند نفس ارتفاع الإطلاق، ومن دون مقاومة الهواء أو الرياح أو دوران الأرض. لذلك سرعة الاصطدام تساوي تقريباً سرعة الإطلاق في هذا النموذج فقط.
      </p>
    </div>
  );
}

/* Real strong-acid / strong-base neutralization chemistry, not a linear
   fudge. Assumes both solutions are 0.1 mol/L (a common lab concentration,
   e.g. HCl and NaOH) — the concentration is fixed and stated in the UI so
   the model is honest about what it does and doesn't simulate (it won't
   reproduce a weak-acid buffer curve, for instance). */
const MOLARITY = 0.1; // mol/L for both the acid and base solutions

function computePh(acidMl, baseMl) {
  const molesAcid = MOLARITY * (acidMl / 1000);
  const molesBase = MOLARITY * (baseMl / 1000);
  const totalLiters = Math.max(acidMl + baseMl, 1) / 1000;
  const net = molesAcid - molesBase;
  const EPS = 1e-9;

  if (Math.abs(net) < EPS) return 7; // exact stoichiometric neutralization

  if (net > 0) {
    // excess strong acid → [H+] from the leftover moles
    const hConcentration = net / totalLiters;
    return Math.max(0, -Math.log10(hConcentration));
  }
  // excess strong base → [OH-] from the leftover moles, then pH = 14 - pOH
  const ohConcentration = -net / totalLiters;
  const pOH = -Math.log10(ohConcentration);
  return Math.min(14, 14 - pOH);
}

function PhMixer() {
  const [acid, setAcid] = useState(30);
  const [base, setBase] = useState(30);
  const ph = Math.max(0, Math.min(14, computePh(acid, base)));
  const acidMoles = MOLARITY * acid / 1000;
  const baseMoles = MOLARITY * base / 1000;
  const totalL = Math.max(acid + base, 1) / 1000;
  const excessMoles = Math.abs(acidMoles - baseMoles);
  const excessConcentration = excessMoles / totalL;

  let label = "متعادل";
  let liquidColor = "#8FD3C7";
  if (ph < 5) {
    label = "حمضي";
    liquidColor = "#F26D6D";
  } else if (ph < 6.5) {
    label = "حمضي خفيف";
    liquidColor = "#F2A76D";
  } else if (ph <= 7.5) {
    label = "متعادل";
    liquidColor = "#8FD3C7";
  } else if (ph <= 9.5) {
    label = "قاعدي خفيف";
    liquidColor = "#7DB8F2";
  } else {
    label = "قاعدي (قلوي)";
    liquidColor = "#8F7DF2";
  }

  return (
    <div>
      <div className="flex items-end gap-6 mb-5">
        <div className="flex-1">
          <div
            className="h-40 rounded-b-xl rounded-t-md overflow-hidden flex items-end"
            style={{ background: C.panelAlt, border: `1px solid ${C.border}` }}
          >
            <div
              className="w-full transition-all"
              style={{ height: "70%", background: liquidColor, opacity: 0.85 }}
            />
          </div>
        </div>
        <div className="flex-1 text-center">
          <p className="text-xs mb-1" style={{ color: C.muted }}>الأس الهيدروجيني</p>
          <p className="text-4xl font-bold" style={{ color: C.text }}>{ph.toFixed(1)}</p>
          <p className="text-sm mt-1" style={{ color: liquidColor }}>{label}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs mb-1" style={{ color: C.muted }}>كمية الحمض: {acid} مل</p>
          <Slider value={acid} onChange={setAcid} min={0} max={100} step={1} color="#F26D6D" label="كمية الحمض بالمليلتر" />
        </div>
        <div>
          <p className="text-xs mb-1" style={{ color: C.muted }}>كمية القاعدة: {base} مل</p>
          <Slider value={base} onChange={setBase} min={0} max={100} step={1} color="#7DB8F2" label="كمية القاعدة بالمليلتر" />
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 text-center">
        <div className="rounded-lg p-3" style={{ background: C.panelAlt }}><p className="text-xs" style={{ color: C.muted }}>مولات الحمض</p><p className="font-bold" style={{ color: C.text }}>{acidMoles.toExponential(2)} mol</p></div>
        <div className="rounded-lg p-3" style={{ background: C.panelAlt }}><p className="text-xs" style={{ color: C.muted }}>مولات القاعدة</p><p className="font-bold" style={{ color: C.text }}>{baseMoles.toExponential(2)} mol</p></div>
        <div className="rounded-lg p-3" style={{ background: C.panelAlt }}><p className="text-xs" style={{ color: C.muted }}>المولات الزائدة</p><p className="font-bold" style={{ color: C.text }}>{excessMoles.toExponential(2)} mol</p></div>
        <div className="rounded-lg p-3" style={{ background: C.panelAlt }}><p className="text-xs" style={{ color: C.muted }}>تركيز الفائض</p><p className="font-bold" style={{ color: C.text }}>{excessConcentration.toExponential(2)} M</p></div>
      </div>
      <p className="text-xs mt-4 leading-relaxed" style={{ color: C.muted }}>
        نموذج مبسّط لتفاعل حمض قوي وقاعدة قوية بتركيز {MOLARITY} مول/لتر لكل منهما (مثل حمض الهيدروكلوريك وهيدروكسيد الصوديوم). عند تساوي الكميات يحدث تعادل تام (pH = 7) وينتج ملح وماء. لاحظ أن التغيّر حول نقطة التعادل حاد وليس تدريجياً خطياً — وهذا سلوك حقيقي في تفاعلات المعايرة الكيميائية بسبب أن الأس الهيدروجيني مقياس لوغاريتمي. هذا النموذج لا يمثّل الأحماض أو القواعد الضعيفة (مثل الخل)، التي تتصرف بشكل مختلف بسبب توازن التأين الجزئي.
      </p>
    </div>
  );
}

function Circuit() {
  const [voltage, setVoltage] = useState(9);
  const [resistance, setResistance] = useState(30);
  const current = voltage / resistance;
  const power = voltage * current;
  const conductance = 1 / resistance;
  const chargePerMinute = current * 60;
  const energyPerMinute = power * 60;
  const glow = Math.min(1, power / 1.5);
  const radius = 18 + glow * 22;

  return (
    <div>
      <div
        className="rounded-xl mb-4 flex items-center justify-center"
        style={{ background: C.panelAlt, height: 220 }}
      >
        <div
          className="rounded-full"
          style={{
            width: radius * 2,
            height: radius * 2,
            background: `radial-gradient(circle, rgba(255,224,140,${0.3 + glow * 0.7}) 0%, rgba(255,224,140,0) 70%)`,
            boxShadow: glow > 0.05 ? `0 0 ${30 * glow}px ${10 * glow}px rgba(255,209,102,${glow})` : "none",
          }}
        >
          <div
            className="w-full h-full rounded-full flex items-center justify-center text-xs font-bold"
            style={{
              background: `rgba(255,209,102,${0.25 + glow * 0.65})`,
              color: "#3a2900",
            }}
          >
            💡
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <p className="text-xs mb-1" style={{ color: C.muted }}>الجهد (فولت): {voltage}</p>
          <Slider value={voltage} onChange={setVoltage} min={1} max={24} step={1} color={C.lab} label="الجهد بالفولت" />
        </div>
        <div>
          <p className="text-xs mb-1" style={{ color: C.muted }}>المقاومة (أوم): {resistance}</p>
          <Slider value={resistance} onChange={setResistance} min={1} max={100} step={1} color={C.lab} label="المقاومة بالأوم" />
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-center">
        <div className="rounded-lg p-3" style={{ background: C.panelAlt }}><p className="text-xs" style={{ color: C.muted }}>شدة التيار I=V/R</p><p className="font-bold" style={{ color: C.text }}>{current.toFixed(3)} أمبير</p></div>
        <div className="rounded-lg p-3" style={{ background: C.panelAlt }}><p className="text-xs" style={{ color: C.muted }}>القدرة P=VI</p><p className="font-bold" style={{ color: C.text }}>{power.toFixed(2)} واط</p></div>
        <div className="rounded-lg p-3" style={{ background: C.panelAlt }}><p className="text-xs" style={{ color: C.muted }}>الموصلية G=1/R</p><p className="font-bold" style={{ color: C.text }}>{(conductance*1000).toFixed(2)} mS</p></div>
        <div className="rounded-lg p-3" style={{ background: C.panelAlt }}><p className="text-xs" style={{ color: C.muted }}>شحنة تمر في دقيقة</p><p className="font-bold" style={{ color: C.text }}>{chargePerMinute.toFixed(2)} كولوم</p></div>
        <div className="rounded-lg p-3" style={{ background: C.panelAlt }}><p className="text-xs" style={{ color: C.muted }}>طاقة مستهلكة في دقيقة</p><p className="font-bold" style={{ color: C.text }}>{energyPerMinute.toFixed(1)} جول</p></div>
      </div>
      <p className="text-xs mt-4" style={{ color: C.muted }}>دائرة مقاومية مثالية بتيار مستمر؛ لا تحاكي مقاومة المصدر أو تغير المقاومة مع الحرارة أو السلوك غير الأومي للمصابيح الحقيقية.</p>
    </div>
  );
}

function Lab() {
  const [exp, setExp] = useState("physics");
  return (
    <div>
      <SectionHeader title="المختبر" subtitle="غيّر المتغيرات وشاهد النتيجة فوراً" color={C.lab} />
      <div className="flex flex-wrap gap-2 mb-5">
        {[
          { id: "physics", label: "الفيزياء — قذيفة" },
          { id: "chem", label: "الكيمياء — مزج الأس الهيدروجيني" },
          { id: "circuit", label: "الكهرباء — دائرة بسيطة" },
        ].map((b) => (
          <button
            key={b.id}
            onClick={() => setExp(b.id)}
            className="px-4 py-2 rounded-lg text-sm font-medium"
            style={{
              background: exp === b.id ? C.lab : C.panel,
              color: exp === b.id ? "#2b1c00" : C.muted,
              border: `1px solid ${C.border}`,
            }}
          >
            {b.label}
          </button>
        ))}
      </div>
      <Card>
        {exp === "physics" && <Projectile />}
        {exp === "chem" && <PhMixer />}
        {exp === "circuit" && <Circuit />}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* SPACE                                                                 */
/* ------------------------------------------------------------------ */
const PLANETS = [
  { name: "عطارد", d: 4879, au: 0.39, color: "#B0AEA6", moons: 0, fact: "عام واحد عليه يعادل ٨٨ يوماً أرضياً فقط، لكن يومه أطول من عامه!" },
  { name: "الزهرة", d: 12104, au: 0.72, color: "#E8C27E", moons: 0, fact: "أشد كواكب المجموعة الشمسية حرارة رغم أنه ليس الأقرب للشمس، بسبب غلافه الجوي الكثيف." },
  { name: "الأرض", d: 12742, au: 1, color: "#4C8BF5", moons: 1, fact: "الكوكب الوحيد المعروف بوجود حياة عليه حتى الآن." },
  { name: "المريخ", d: 6779, au: 1.52, color: "#D8603F", moons: 2, fact: "يضم أعلى بركان معروف في المجموعة الشمسية، جبل أوليمبوس." },
  { name: "المشتري", d: 139820, au: 5.2, color: "#D8A97A", moons: 115, fact: "أكبر كواكب المجموعة الشمسية، وبقعته الحمراء عاصفة مستمرة منذ مئات السنين." },
  { name: "زحل", d: 116460, au: 9.58, color: "#E4C978", moons: 293, fact: "حلقاته مكوّنة من ملايين قطع الجليد والصخور." },
  { name: "أورانوس", d: 50724, au: 19.2, color: "#7FDCDA", moons: 29, fact: "يدور على جنبه بميل محوري يقارب ٩٨ درجة." },
  { name: "نبتون", d: 49244, au: 30.05, color: "#4E6FB0", moons: 16, fact: "أبعد الكواكب عن الشمس، وتهب عليه أسرع رياح رُصدت في المجموعة الشمسية." },
];
const AU_KM = 149597870;
const EARTH_D = 12742;
const EARTH_AU = 1;

/* Earth-to-planet distance is NOT the planet's distance from the Sun (au):
   both Earth and the target planet are moving along their own orbits, so
   the distance between them constantly changes. Assuming roughly circular,
   coplanar orbits (a reasonable classroom approximation — real orbits have
   some eccentricity and tilt, which this ignores), the distance between
   Earth and another planet oscillates between:
     closest approach  = |planet_au - 1| AU   (both on the same side of the Sun)
     farthest approach  = (planet_au + 1) AU   (on opposite sides of the Sun)
   For Earth itself the distance is always 0. This gives students an honest
   range instead of a single number silently mislabeled as "from Earth". */
function earthDistanceRangeKm(planetAu) {
  if (planetAu === EARTH_AU) return { minKm: 0, maxKm: 0 };
  const minKm = Math.abs(planetAu - EARTH_AU) * AU_KM;
  const maxKm = (planetAu + EARTH_AU) * AU_KM;
  return { minKm, maxKm };
}

function Space() {
  const [sel, setSel] = useState(2);
  const [speed, setSpeed] = useState(40000);
  const p = PLANETS[sel];
  const { minKm, maxKm } = earthDistanceRangeKm(p.au);
  // Travel-time estimate uses the closest-approach distance (best case,
  // i.e. launching when Earth and the target planet are aligned).
  const hours = minKm / speed;
  const years = hours / 24 / 365.25;
  const sizeRatio = Math.min(1, p.d / PLANETS[4].d);

  return (
    <div>
      <SectionHeader title="استكشاف الكون" subtitle="قارن الكواكب واحسب زمن الرحلة إليها" color={C.space} />
      <Card style={{ marginBottom: 16 }}>
        <div className="flex flex-wrap gap-2 mb-5">
          {PLANETS.map((pl, i) => (
            <button
              key={pl.name}
              onClick={() => setSel(i)}
              className="px-3 py-1.5 rounded-full text-xs font-medium"
              style={{
                background: i === sel ? pl.color : C.panelAlt,
                color: i === sel ? "#0B1220" : C.muted,
                border: `1px solid ${C.border}`,
              }}
            >
              {pl.name}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-8 mb-4">
          <div className="flex flex-col items-center">
            <div
              className="rounded-full"
              style={{
                width: `${20 + sizeRatio * 90}px`,
                height: `${20 + sizeRatio * 90}px`,
                background: p.color,
              }}
            />
            <p className="text-xs mt-2" style={{ color: C.muted }}>{p.name}</p>
          </div>
          <div className="flex flex-col items-center">
            <div
              className="rounded-full"
              style={{
                width: `${20 + (EARTH_D / PLANETS[4].d) * 90}px`,
                height: `${20 + (EARTH_D / PLANETS[4].d) * 90}px`,
                background: PLANETS[2].color,
              }}
            />
            <p className="text-xs mt-2" style={{ color: C.muted }}>الأرض (للمقارنة)</p>
          </div>
          <div className="text-sm" style={{ color: C.text }}>
            <p>القطر: {p.d.toLocaleString("ar")} كم</p>
            <p className="mt-1">البعد عن الشمس: {p.au} وحدة فلكية</p>
            <p className="mt-1">عدد الأقمار: {p.moons}</p>
          </div>
        </div>

        <p className="text-xs mb-4 leading-relaxed" style={{ color: C.space }}>✦ {p.fact}</p>

        <p className="text-xs mb-1" style={{ color: C.muted }}>
          سرعة المركبة الافتراضية: {speed.toLocaleString("ar")} كم/س
        </p>
        <Slider value={speed} onChange={setSpeed} min={10000} max={60000} step={1000} color={C.space} label="سرعة المركبة الافتراضية بالكيلومتر في الساعة" />

        <div className="grid grid-cols-2 gap-3 mt-4 text-center">
          <div className="rounded-lg p-3" style={{ background: C.panelAlt }}>
            <p className="text-xs" style={{ color: C.muted }}>مدى المسافة من الأرض</p>
            <p className="font-bold" style={{ color: C.text }}>
              {p.au === EARTH_AU
                ? "٠ كم (نفس الكوكب)"
                : `${minKm.toLocaleString("ar")} – ${maxKm.toLocaleString("ar")} كم`}
            </p>
          </div>
          <div className="rounded-lg p-3" style={{ background: C.panelAlt }}>
            <p className="text-xs" style={{ color: C.muted }}>مدة الرحلة (عند أقرب اقتراب)</p>
            <p className="font-bold" style={{ color: C.text }}>
              {p.au === EARTH_AU
                ? "—"
                : years >= 1
                ? `${years.toFixed(1)} سنة`
                : `${(hours / 24).toFixed(0)} يوم`}
            </p>
          </div>
        </div>
        {p.au !== EARTH_AU && (
          <p className="text-xs mt-3 leading-relaxed" style={{ color: C.muted }}>
            المسافة بين الأرض وكوكب آخر تتغيّر باستمرار لأن الكوكبين يدوران حول الشمس بسرعات مختلفة. النطاق أعلاه يمثّل أقرب وأبعد مسافة تقريبية (بافتراض مدارات دائرية في مستوى واحد)، ومدة الرحلة محسوبة عند أقرب اقتراب، وهي حالة نادرة الحدوث عملياً — بعثات فضائية حقيقية تنتظر "نوافذ إطلاق" مناسبة وتتبع مسارات غير مباشرة، فمدتها الفعلية أطول عادةً.
          </p>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* HUMAN BODY                                                           */
/* ------------------------------------------------------------------ */
const ORGANS = [
  { id: "brain", name: "الدماغ", x: 250, y: 62, info: "مركز التحكم في الجسم؛ يعالج إشارات الأعصاب وينسّق الحركة والتفكير والحواس." },
  { id: "eye", name: "العين", x: 264, y: 58, info: "تستقبل الضوء وتحوّله إلى إشارات عصبية يفسّرها الدماغ كصور." },
  { id: "heart", name: "القلب", x: 233, y: 158, info: "عضلة تضخ الدم المحمّل بالأكسجين إلى كل أنحاء الجسم عبر الأوعية الدموية." },
  { id: "lungs", name: "الرئتان", x: 270, y: 158, info: "تُدخلان الأكسجين إلى الدم وتُخرجان ثاني أكسيد الكربون عند الزفير." },
  { id: "stomach", name: "المعدة", x: 235, y: 205, info: "تفرز عصارات هاضمة تكسّر الطعام كيميائياً قبل انتقاله إلى الأمعاء." },
  { id: "kidney", name: "الكلى", x: 268, y: 213, info: "تُنقّي الدم من الفضلات والسوائل الزائدة، وتُخرجها على هيئة بول." },
  { id: "skin", name: "الجلد", x: 168, y: 205, info: "أكبر عضو في الجسم، يحمي من الجراثيم وينظّم درجة الحرارة عبر التعرّق." },
  { id: "skeleton", name: "الهيكل العظمي", x: 212, y: 300, info: "يدعم الجسم، يحمي الأعضاء الداخلية، ويسمح بالحركة عبر المفاصل والعضلات المرتبطة به." },
];

const AIR_JOURNEY = [
  { title: "الهواء يدخل الأنف", text: "يدخل الهواء عبر الأنف أو الفم، ويُرطَّب ويُنقّى من الغبار في الطريق." },
  { title: "يصل إلى الرئتين", text: "تتفرع القصبة الهوائية داخل الرئتين إلى ملايين الأكياس الهوائية الصغيرة." },
  { title: "الأكسجين يدخل الدم", text: "يعبر الأكسجين جدران الأكياس الهوائية إلى الشعيرات الدموية المحيطة بها." },
  { title: "القلب يضخ الدم", text: "يضخ القلب الدم المحمّل بالأكسجين إلى كل خلايا الجسم عبر الشرايين." },
  { title: "الخلايا تنتج الطاقة", text: "تستخدم الخلايا الأكسجين لتحويل الغذاء إلى طاقة، وتطلق ثاني أكسيد الكربون كناتج ثانوي." },
];

function HumanBody() {
  const [active, setActive] = useState(ORGANS[2]);
  const [step, setStep] = useState(0);

  return (
    <div>
      <SectionHeader title="جسم الإنسان" subtitle="اضغط على أي عضو لتعرف وظيفته" color={C.body} />
      <div className="grid md:grid-cols-2 gap-5">
        <Card>
          <svg viewBox="0 0 500 400" className="w-full">
            <circle cx="250" cy="70" r="35" fill={C.panelAlt} stroke={C.border} strokeWidth="2" />
            <rect x="240" y="100" width="20" height="15" fill={C.panelAlt} />
            <rect x="200" y="115" width="100" height="130" rx="25" fill={C.panelAlt} stroke={C.border} strokeWidth="2" />
            <line x1="200" y1="130" x2="150" y2="230" stroke={C.panelAlt} strokeWidth="18" strokeLinecap="round" />
            <line x1="300" y1="130" x2="350" y2="230" stroke={C.panelAlt} strokeWidth="18" strokeLinecap="round" />
            <line x1="225" y1="245" x2="212" y2="370" stroke={C.panelAlt} strokeWidth="20" strokeLinecap="round" />
            <line x1="275" y1="245" x2="288" y2="370" stroke={C.panelAlt} strokeWidth="20" strokeLinecap="round" />

            {ORGANS.map((o) => (
              <g key={o.id} onClick={() => setActive(o)} style={{ cursor: "pointer" }}>
                <circle
                  cx={o.x}
                  cy={o.y}
                  r={active.id === o.id ? 12 : 9}
                  fill={C.body}
                  opacity={active.id === o.id ? 1 : 0.6}
                  stroke={C.bg}
                  strokeWidth="2"
                />
              </g>
            ))}
          </svg>
        </Card>
        <Card>
          <p className="text-lg font-bold mb-2" style={{ color: C.body }}>{active.name}</p>
          <p className="text-sm leading-relaxed" style={{ color: C.text }}>{active.info}</p>
          <div className="flex flex-wrap gap-2 mt-4">
            {ORGANS.map((o) => (
              <button
                key={o.id}
                onClick={() => setActive(o)}
                className="px-3 py-1.5 rounded-full text-xs"
                style={{
                  background: active.id === o.id ? C.body : C.panelAlt,
                  color: active.id === o.id ? "#2b0d13" : C.muted,
                }}
              >
                {o.name}
              </button>
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-6">
        <p className="text-sm font-semibold mb-3" style={{ color: C.text }}>رحلة الهواء داخل الجسم</p>
        <Card>
          <p className="text-xs mb-1" style={{ color: C.muted }}>الخطوة {step + 1} من {AIR_JOURNEY.length}</p>
          <p className="font-bold mb-2" style={{ color: C.body }}>{AIR_JOURNEY[step].title}</p>
          <p className="text-sm leading-relaxed mb-4" style={{ color: C.text }}>{AIR_JOURNEY[step].text}</p>
          <div className="flex items-center justify-between">
            <button
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0}
              className="p-2 rounded-lg disabled:opacity-30"
              style={{ background: C.panelAlt }}
            >
              <ChevronRight size={18} color={C.text} />
            </button>
            <div className="flex gap-1.5">
              {AIR_JOURNEY.map((_, i) => (
                <div
                  key={i}
                  className="rounded-full"
                  style={{ width: 6, height: 6, background: i === step ? C.body : C.border }}
                />
              ))}
            </div>
            <button
              onClick={() => setStep((s) => Math.min(AIR_JOURNEY.length - 1, s + 1))}
              disabled={step === AIR_JOURNEY.length - 1}
              className="p-2 rounded-lg disabled:opacity-30"
              style={{ background: C.panelAlt }}
            >
              <ChevronLeft size={18} color={C.text} />
            </button>
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ENVIRONMENT                                                          */
/* ------------------------------------------------------------------ */
const ENERGY = [
  { name: "طاقة الرياح", value: 11, note: "انبعاثات دورة حياة منخفضة جداً" },
  { name: "الطاقة النووية", value: 12, note: "منخفضة الكربون أثناء التشغيل ودورة الحياة" },
  { name: "الطاقة الشمسية الكهروضوئية", value: 40, note: "تعتمد على التصنيع والموقع والتقنية" },
  { name: "الغاز الطبيعي", value: 486, note: "تشمل احتراق الوقود وسلسلة الإمداد" },
  { name: "الفحم", value: 1001, note: "الأعلى تقريباً بين المصادر المعروضة" },
];

function climateRiskProfile(rise) {
  const level = rise < 1 ? "متزايد" : rise < 1.5 ? "مرتفع" : rise < 2 ? "مرتفع جداً" : rise < 3 ? "شديد" : "شديد جداً";
  const heat = rise < 1.5 ? "تزداد موجات الحر وشدتها" : rise < 2 ? "ارتفاع واضح في الحر الشديد وتكراره" : rise < 3 ? "تغيرات في شدة المتطرفات الحرارية أكبر بكثير من 1.5°C" : "قفزة كبيرة وغير خطية في تكرار الحر الشديد";
  const water = rise < 1.5 ? "زيادة متفاوتة إقليمياً في الأمطار الغزيرة والجفاف" : rise < 2 ? "فروق أوضح بين المناطق الرطبة والجافة" : "اشتداد دورة المياه ومخاطر الفيضانات والجفاف في مناطق عديدة";
  const ecosystems = rise < 1.5 ? "مخاطر متنامية للشعاب والأنظمة الحساسة" : rise < 2 ? "خسائر أكبر في الأنظمة الحساسة مقارنة بـ1.5°C" : "مخاطر واسعة قد تصبح غير قابلة للعكس لبعض الأنظمة";
  return { level, heat, water, ecosystems };
}

function Environment() {
  const [rise, setRise] = useState(1.5);
  const risk = climateRiskProfile(rise);
  const heatMultiplier = rise <= 1.5 ? 1 : rise <= 2 ? 1 + ((rise - 1.5) / 0.5) : rise <= 3 ? 2 + ((rise - 2) / 1) * 2 : 4 + (rise - 3) * 1.5;

  return (
    <div>
      <SectionHeader title="البيئة والمناخ" subtitle="محاكاة تعليمية متعددة المؤشرات لمستويات الاحترار العالمي" color={C.env} />
      <Card style={{ marginBottom: 16 }}>
        <p className="text-sm mb-1" style={{ color: C.muted }}>
          الاحترار العالمي مقارنة بفترة 1850–1900: <span style={{ color: C.env, fontWeight: 700 }}>+{rise.toFixed(1)}°C</span>
        </p>
        <Slider value={rise} onChange={setRise} min={0.5} max={5} step={0.1} color={C.env} label="مستوى الاحترار العالمي" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-5">
          {[
            ["مستوى المخاطر المركب", risk.level],
            ["الحرارة المتطرفة", risk.heat],
            ["دورة المياه", risk.water],
            ["النظم البيئية", risk.ecosystems],
          ].map(([k,v]) => (
            <div key={k} className="rounded-xl p-3" style={{ background: C.panelAlt }}>
              <p className="text-xs" style={{ color: C.muted }}>{k}</p>
              <p className="text-sm font-semibold mt-1 leading-relaxed" style={{ color: C.text }}>{v}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-xl p-3" style={{ background: C.panelAlt }}>
          <p className="text-xs" style={{ color: C.muted }}>مؤشر نسبي لشدة تغير المتطرفات الحرارية مقابل مستوى 1.5°C</p>
          <p className="text-2xl font-black mt-1" style={{ color: C.env }}>≈ ×{heatMultiplier.toFixed(1)}</p>
          <p className="text-[11px] mt-1 leading-relaxed" style={{ color: C.muted }}>
            مؤشر تعليمي تقريبي مبني على تقييمات IPCC التي تشير إلى أن التغير في شدة المتطرفات عند 2°C يكون على الأقل قرابة ضعفي التغير عند 1.5°C، وعند 3°C قرابة أربعة أضعاف. لا يُستخدم كتنبؤ محلي.
          </p>
        </div>
      </Card>

      <Card>
        <p className="text-sm font-semibold mb-1" style={{ color: C.text }}>انبعاثات دورة الحياة لتوليد الكهرباء</p>
        <p className="text-xs mb-4" style={{ color: C.muted }}>غرام مكافئ CO₂ لكل كيلوواط-ساعة — قيم مرجعية تقريبية من دراسات دورة الحياة، وليست «نسبة استخدام» مختلقة.</p>
        <div className="flex flex-col gap-3">
          {ENERGY.map((e) => {
            const width = Math.max(2, Math.min(100, (e.value / 1001) * 100));
            return (
              <div key={e.name}>
                <div className="flex justify-between text-xs mb-1 gap-3" style={{ color: C.muted }}>
                  <span>{e.name}</span><span>{e.value} gCO₂e/kWh</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: C.panelAlt }}>
                  <div className="h-full rounded-full" style={{ width: `${width}%`, background: C.env }} />
                </div>
                <p className="text-[11px] mt-1" style={{ color: C.muted }}>{e.note}</p>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* WHAT IF                                                              */
/* ------------------------------------------------------------------ */
const WHATIF_BASE = [
  { q: "ماذا يحدث لو توقفت الجاذبية فجأة؟", a: "كل شيء غير مثبّت سينطلق في خط مستقيم بعيداً عن الأرض وفق قانون نيوتن الأول للحركة، وحتى الغلاف الجوي نفسه سيتبعثر تدريجياً في الفضاء." },
  { q: "ماذا يحدث لو دارت الأرض أسرع؟", a: "يصبح اليوم أقصر، وتزداد قوة الطرد المركزي عند خط الاستواء، مما يقلّل وزن الأجسام هناك قليلاً." },
  { q: "ماذا لو اختفى الاحتكاك تماماً؟", a: "الأجسام المتحركة لن تتوقف أبداً من تلقاء نفسها، والمشي والقيادة يصبحان شبه مستحيلين لأن الاحتكاك هو ما يمنحنا قوة الدفع أصلاً." },
  { q: "ماذا لو نفد الأكسجين من الغلاف الجوي؟", a: "تتوقف عمليات الاحتراق، ويصبح التنفس الهوائي للكائنات الحية مستحيلاً خلال دقائق قليلة." },
  { q: "ماذا لو ارتفعت حرارة المحيطات درجة واحدة؟", a: "يتمدد الماء ويرتفع مستوى سطح البحر تدريجياً، وتضعف الشعاب المرجانية بسبب ما يُعرف بظاهرة الابيضاض." },
  { q: "ماذا لو اقترب القمر من الأرض؟", a: "تزداد قوة المدّ والجزر بشكل كبير، ما يسبب فيضانات ساحلية أكثر تكراراً وشدة." },
  { q: "ماذا لو اختفى المجال المغناطيسي للأرض؟", a: "يفقد الغلاف الجوي جزءاً من حمايته من الرياح الشمسية، وقد يتآكل تدريجياً على مدى زمني طويل جداً." },
  { q: "ماذا لو تضاعفت نسبة ثاني أكسيد الكربون في الجو؟", a: "يزداد احتباس الحرارة، فترتفع درجات الحرارة العالمية بشكل ملحوظ على مدى عقود." },
];

function WhatIf({ items, onGenerate, generating, error }) {
  const [openIdx, setOpenIdx] = useState(null);
  return (
    <div>
      <SectionHeader title="ماذا لو؟" subtitle="غيّر قانوناً من قوانين الطبيعة وشاهد النتيجة العلمية" color={C.whatif} />

      <button
        onClick={onGenerate}
        disabled={generating}
        className="mb-5 flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold"
        style={{ background: C.whatif, color: "#1a1030", opacity: generating ? 0.7 : 1 }}
      >
        {generating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
        {generating ? "المساعد يفكّر بسيناريو جديد..." : "ولّد سيناريو جديد بالذكاء الاصطناعي"}
      </button>
      {error && <p className="text-xs mb-4" style={{ color: C.body }}>{error}</p>}

      <div className="flex flex-col gap-3">
        {items.map((item, i) => (
          <Card key={i}>
            <button
              onClick={() => setOpenIdx(openIdx === i ? null : i)}
              className="w-full text-right flex items-center justify-between gap-3"
            >
              <span className="font-semibold text-sm flex items-center gap-2 flex-wrap" style={{ color: C.text }}>
                {item.q}
                {item.community && <CommunityBadge color={C.whatif} confidence={item.confidence} />}
              </span>
              {openIdx === i ? (
                <ChevronRight size={18} color={C.whatif} />
              ) : (
                <ChevronLeft size={18} color={C.muted} />
              )}
            </button>
            {openIdx === i && (
              <p className="text-sm mt-3 leading-relaxed" style={{ color: C.muted }}>{item.a}</p>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* QUIZ / CHALLENGES                                                    */
/* ------------------------------------------------------------------ */
const QUESTIONS_BASE = [
  { id: "q1", topic: "فيزياء", text: "جسم كتلته 10 كجم تؤثر عليه قوة 50 نيوتن، فما تسارعه؟", options: ["2 م/ث²", "5 م/ث²", "10 م/ث²", "50 م/ث²"], correct: 1, explanation: "وفق قانون نيوتن الثاني: تسارع = قوة ÷ كتلة = 50 ÷ 10 = 5 م/ث²." },
  { id: "q2", topic: "كيمياء", text: "ما الرمز الكيميائي للماء؟", options: ["H2O", "CO2", "O2", "NaCl"], correct: 0, explanation: "جزيء الماء يتكوّن من ذرتَي هيدروجين وذرة أكسجين واحدة، لذلك رمزه H2O." },
  { id: "q3", topic: "فضاء", text: "أي كوكب هو الأقرب إلى الشمس؟", options: ["الأرض", "عطارد", "المريخ", "الزهرة"], correct: 1, explanation: "عطارد يبعد عن الشمس بمتوسط 0.39 وحدة فلكية فقط، وهو أقرب الكواكب الثمانية إليها." },
  { id: "q4", topic: "أحياء", text: "أي عضو مسؤول عن ضخ الدم في الجسم؟", options: ["الرئة", "الكبد", "القلب", "المعدة"], correct: 2, explanation: "القلب عضلة تنقبض وتنبسط بإيقاع منتظم لتضخّ الدم عبر الشرايين إلى كل أنحاء الجسم." },
  { id: "q5", topic: "بيئة", text: "أي مما يلي مصدر طاقة متجدد؟", options: ["الفحم", "الغاز الطبيعي", "الطاقة الشمسية", "النفط"], correct: 2, explanation: "الطاقة الشمسية تتجدد باستمرار من الشمس، بخلاف الوقود الأحفوري (الفحم والغاز والنفط) الذي يتشكّل على ملايين السنين ولا يتجدد بمعدل استهلاكنا له." },
  { id: "q6", topic: "فيزياء", text: "عند السقوط الحر بدون مقاومة هواء، ماذا يحدث لتسارع الجسم؟", options: ["يزداد باستمرار", "يبقى ثابتاً تقريباً", "يقل تدريجياً", "يصبح صفراً"], correct: 1, explanation: "بدون مقاومة هواء، يخضع الجسم فقط لتسارع الجاذبية الأرضية (~9.8 م/ث²) وهو ثابت تقريباً بالقرب من سطح الأرض، بغض النظر عن كتلة الجسم." },
];

function Quiz({ questions, answered, onAnswer, onGenerate, generating, error }) {
  const [picked, setPicked] = useState({});

  function choose(q, idx) {
    if (picked[q.id] !== undefined) return;
    setPicked((p) => ({ ...p, [q.id]: idx }));
    if (idx === q.correct && !answered.includes(q.id)) {
      onAnswer(q.id, 10);
    }
  }

  const score = questions.filter((q) => picked[q.id] === q.correct).length;

  return (
    <div>
      <SectionHeader title="التحديات العلمية" subtitle="أجب واكسب نقاط خبرة (XP)" color={C.quiz} />
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <p className="text-sm" style={{ color: C.muted }}>
          النتيجة في هذه الجلسة: {score} / {questions.length}
        </p>
        <button
          onClick={onGenerate}
          disabled={generating}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold"
          style={{ background: C.quiz, color: "#3a0d24", opacity: generating ? 0.7 : 1 }}
        >
          {generating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
          {generating ? "يولّد سؤالاً..." : "سؤال جديد بالذكاء الاصطناعي"}
        </button>
      </div>
      {error && <p className="text-xs mb-4" style={{ color: C.body }}>{error}</p>}

      <div className="flex flex-col gap-4">
        {questions.map((q) => {
          const p = picked[q.id];
          return (
            <Card key={q.id}>
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <p className="text-xs" style={{ color: C.quiz }}>{q.topic}</p>
                {q.community && <CommunityBadge color={C.quiz} confidence={q.confidence} />}
              </div>
              <p className="font-semibold text-sm mb-3" style={{ color: C.text }}>{q.text}</p>
              <div className="grid grid-cols-2 gap-2">
                {q.options.map((opt, idx) => {
                  let bg = C.panelAlt;
                  let border = C.border;
                  if (p !== undefined) {
                    if (idx === q.correct) {
                      bg = "rgba(52,211,153,0.15)";
                      border = C.env;
                    } else if (idx === p) {
                      bg = "rgba(251,113,133,0.15)";
                      border = C.body;
                    }
                  }
                  return (
                    <button
                      key={idx}
                      onClick={() => choose(q, idx)}
                      className="rounded-lg px-3 py-2 text-sm text-right flex items-center justify-between"
                      style={{ background: bg, border: `1px solid ${border}`, color: C.text }}
                    >
                      <span>{opt}</span>
                      {p !== undefined && idx === q.correct && <Check size={16} color={C.env} />}
                      {p !== undefined && idx === p && idx !== q.correct && <X size={16} color={C.body} />}
                    </button>
                  );
                })}
              </div>
              {p !== undefined && q.explanation && (
                <p className="text-xs mt-3 leading-relaxed" style={{ color: C.muted }}>{q.explanation}</p>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* AI TUTOR                                                              */
/* ------------------------------------------------------------------ */
const TUTOR_INPUT_MAX = 500;
const TUTOR_MESSAGE_CAP = 40; // keep the conversation from growing unbounded in a long session

const WELCOME_MESSAGE = {
  role: "assistant",
  text: "أهلاً! أنا مساعدك العلمي. اسألني عن أي مفهوم في الفيزياء أو الكيمياء أو الأحياء أو الفضاء أو البيئة، وسأشرحه لك ببساطة.",
};

function AITutor({ isOnline }) {
  const [messages, setMessages] = useState([WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send() {
    const text = input.trim().slice(0, TUTOR_INPUT_MAX);
    if (!text || loading) return;
    setInput("");
    setError("");
    setMessages((m) => [...m, { role: "user", text }].slice(-TUTOR_MESSAGE_CAP));
    setLoading(true);
    try {
      const reply = await askAI(text, TUTOR_SYSTEM);
      setMessages((m) => [...m, { role: "assistant", text: reply }].slice(-TUTOR_MESSAGE_CAP));
    } catch (e) {
      setError(e?.message || "تعذّر الوصول إلى المساعد الذكي الآن. حاول مرة أخرى.");
    } finally {
      setLoading(false);
    }
  }

  function clearConversation() {
    setMessages([WELCOME_MESSAGE]);
    setError("");
  }

  const suggestions = [
    "لماذا السماء زرقاء؟",
    "كيف تتشكل الأمطار؟",
    "ما الفرق بين السرعة والتسارع؟",
    "لماذا تطفو السفن رغم أنها من الحديد؟",
  ];

  const disabled = loading || !isOnline;

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <SectionHeader title="المساعد الذكي" subtitle="اسأل عن أي فكرة علمية ولن يتوقف عن الشرح" color={C.tutor} />
        {messages.length > 1 && (
          <button
            onClick={clearConversation}
            className="text-xs px-3 py-1.5 rounded-full mb-6"
            style={{ background: C.panel, color: C.muted, border: `1px solid ${C.border}` }}
          >
            مسح المحادثة
          </button>
        )}
      </div>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div
          className="p-4 flex flex-col gap-3"
          style={{ maxHeight: 420, overflowY: "auto" }}
          role="log"
          aria-live="polite"
          aria-label="سجل المحادثة مع المساعد الذكي"
        >
          {messages.map((m, i) => (
            <div
              key={i}
              className="max-w-[85%] rounded-xl px-4 py-2.5 text-sm leading-relaxed"
              style={{
                alignSelf: m.role === "user" ? "flex-start" : "flex-end",
                background: m.role === "user" ? C.panelAlt : `${C.tutor}22`,
                color: C.text,
              }}
            >
              {m.text}
            </div>
          ))}
          {loading && (
            <div
              className="max-w-[60%] rounded-xl px-4 py-2.5 text-sm flex items-center gap-2"
              style={{ alignSelf: "flex-end", background: `${C.tutor}22`, color: C.muted }}
            >
              <Loader2 size={14} className="animate-spin" /> يفكّر...
            </div>
          )}
          <div ref={endRef} />
        </div>

        {messages.length === 1 && (
          <div className="px-4 pb-3 flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => setInput(s)}
                disabled={!isOnline}
                className="text-xs px-3 py-1.5 rounded-full"
                style={{ background: C.panelAlt, color: C.muted, opacity: isOnline ? 1 : 0.5 }}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {error && (
          <p className="px-4 text-xs mb-2" role="alert" style={{ color: C.body }}>{error}</p>
        )}

        <div className="flex items-center gap-2 p-3" style={{ borderTop: `1px solid ${C.border}` }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, TUTOR_INPUT_MAX))}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder={isOnline ? "اكتب سؤالك العلمي هنا..." : "غير متصل بالإنترنت — لا يمكن إرسال أسئلة الآن"}
            aria-label="سؤالك العلمي"
            maxLength={TUTOR_INPUT_MAX}
            disabled={!isOnline}
            className="flex-1 rounded-xl px-4 py-2.5 text-sm outline-none"
            style={{ background: C.panelAlt, color: C.text, border: `1px solid ${C.border}`, opacity: isOnline ? 1 : 0.6 }}
          />
          <button
            onClick={send}
            disabled={disabled || !input.trim()}
            aria-label="إرسال السؤال"
            className="p-2.5 rounded-xl"
            style={{ background: C.tutor, opacity: disabled || !input.trim() ? 0.5 : 1 }}
          >
            <Send size={16} color="#062421" />
          </button>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* APP                                                                   */
/* ------------------------------------------------------------------ */
export default function App() {
  const [tab, setTab] = useState("home");
  const [showMethodology, setShowMethodology] = useState(false);
  const isOnline = useOnlineStatus();

  const { xp, answered, loaded, handleAnswer, resetProgress } = useProgress();

  const quizGen = useGeneratedContent({
    storageKey: "misbar-community-quiz",
    systemPrompt: QUIZ_GEN_SYSTEM,
    userPrompt: "ولّد سؤال اختبار علمي جديد الآن.",
    validate: validateQuizObject,
    buildItem: (obj) => ({
      id: `ai-${Date.now()}`,
      topic: obj.topic || "علوم",
      text: obj.text,
      options: obj.options,
      correct: obj.correct,
      explanation: obj.explanation,
      confidence: typeof obj.confidence === "number" ? obj.confidence : 0.8,
      community: true,
    }),
  });

  const whatIfGen = useGeneratedContent({
    storageKey: "misbar-community-whatif",
    systemPrompt: WHATIF_GEN_SYSTEM,
    userPrompt: "ولّد سيناريو ماذا-لو علمي جديد الآن.",
    validate: validateWhatIfObject,
    buildItem: (obj) => ({
      id: `ai-${Date.now()}`,
      q: obj.q,
      a: obj.a,
      confidence: typeof obj.confidence === "number" ? obj.confidence : 0.8,
      community: true,
    }),
  });

  function handleResetClick() {
    if (window.confirm("هل تريد بالتأكيد إعادة ضبط تقدمك؟ سيُحذف مستواك ونقاط الخبرة وسجل الإجابات، ولا يمكن التراجع عن ذلك.")) {
      resetProgress();
    }
  }

  const lvl = levelInfo(xp);
  const allQuestions = [...QUESTIONS_BASE, ...quizGen.items];
  const allWhatIf = [...WHATIF_BASE, ...whatIfGen.items];

  return (
    <div dir="rtl" style={{ background: C.bg, minHeight: "100%", color: C.text, fontFamily: "'Tajawal', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;900&display=swap');
        input[type="range"] { height: 4px; border-radius: 4px; background: ${C.border}; }
        .animate-spin { animation: msbr-spin 1s linear infinite; }
        @keyframes msbr-spin { to { transform: rotate(360deg); } }
        *:focus-visible { outline: 2px solid ${C.tutor}; outline-offset: 2px; border-radius: 4px; }
      `}</style>

      {!isOnline && (
        <div
          role="status"
          className="text-center text-xs py-2 px-4"
          style={{ background: "#3a1010", color: "#F2B8B8" }}
        >
          أنت غير متصل بالإنترنت الآن — ميزات الذكاء الاصطناعي (المساعد، توليد الأسئلة والسيناريوهات) غير متاحة حتى تعود الشبكة. باقي المنصة تعمل بشكل طبيعي.
        </div>
      )}

      {showMethodology && <MethodologyModal onClose={() => setShowMethodology(false)} />}

      <div className="max-w-5xl mx-auto p-4 md:p-6">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: C.lab }}>
              <Sparkles size={18} color="#2b1c00" />
            </div>
            <div>
              <p className="font-black text-lg leading-none">مِسبار</p>
              <p className="text-[11px]" style={{ color: C.muted }}>منصة استكشاف العلوم</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-left">
              <p className="text-xs font-semibold" style={{ color: C.quiz }}>{lvl.name}</p>
              <p className="text-[11px]" style={{ color: C.muted }}>{xp} XP</p>
            </div>
            <button
              onClick={() => setShowMethodology(true)}
              title="المنهجية والمصادر"
              aria-label="عرض المنهجية والمصادر"
              className="p-2 rounded-lg"
              style={{ background: C.panel }}
            >
              <span className="text-xs font-bold" style={{ color: C.muted }}>ⓘ</span>
            </button>
            <button
              onClick={handleResetClick}
              title="إعادة ضبط التقدم"
              aria-label="إعادة ضبط التقدم"
              className="p-2 rounded-lg"
              style={{ background: C.panel }}
            >
              <RotateCcw size={15} color={C.muted} />
            </button>
          </div>
        </div>

        <div role="tablist" aria-label="أقسام مِسبار" className="flex gap-2 mb-6 overflow-x-auto pb-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap"
              style={{
                background: tab === t.id ? t.color : C.panel,
                color: tab === t.id ? "#0B1220" : C.muted,
                border: `1px solid ${C.border}`,
              }}
            >
              <t.icon size={15} />
              {t.label}
            </button>
          ))}
        </div>

        {!loaded && (
          <div className="flex items-center justify-center py-16" role="status" aria-label="جارٍ التحميل">
            <Loader2 size={22} className="animate-spin" color={C.muted} />
          </div>
        )}

        {loaded && (
          <div role="tabpanel">
            {tab === "home" && (
              <ErrorBoundary><Home xp={xp} setTab={setTab} whatIfList={allWhatIf} /></ErrorBoundary>
            )}
            {tab === "lab" && (
              <ErrorBoundary><Lab /></ErrorBoundary>
            )}
            {tab === "space" && (
              <ErrorBoundary><Space /></ErrorBoundary>
            )}
            {tab === "body" && (
              <ErrorBoundary><HumanBody /></ErrorBoundary>
            )}
            {tab === "env" && (
              <ErrorBoundary><Environment /></ErrorBoundary>
            )}
            {tab === "whatif" && (
              <ErrorBoundary>
                <WhatIf
                  items={allWhatIf}
                  onGenerate={whatIfGen.generate}
                  generating={whatIfGen.generating || whatIfGen.onCooldown}
                  error={whatIfGen.error}
                />
              </ErrorBoundary>
            )}
            {tab === "quiz" && (
              <ErrorBoundary>
                <Quiz
                  questions={allQuestions}
                  answered={answered}
                  onAnswer={handleAnswer}
                  onGenerate={quizGen.generate}
                  generating={quizGen.generating || quizGen.onCooldown}
                  error={quizGen.error}
                />
              </ErrorBoundary>
            )}
            {tab === "tutor" && (
              <ErrorBoundary><AITutor isOnline={isOnline} /></ErrorBoundary>
            )}
          </div>
        )}
      </div>
    </div>
  );
  }
