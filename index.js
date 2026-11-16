const fs = require("fs");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
} = require("@whiskeysockets/baileys");
const { GoogleGenAI } = require("@google/genai");
const pino = require("pino");

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = "gemini-flash-latest";

const SYSTEM = `نتا كتجاوب بلاصة مروان فـ واتساب.
نتا مثقف بزاف وكتعرف فـ كلشي: دراسة، دين، علوم، تقنية، حياة، نصائح. جاوب بدقة ومعلومات صحيحة، وإلا ما كنتيش متأكد قول "ما متأكدش".
هضر بالدارجة المغربية بحال شاب، بجمل قصيرة وعفوية، وبنفس اللغة اللي كيهضر بها الشخص.
ما تعطي حتى وعد، ولا موعد، ولا تهضر على الفلوس. قول "غنرجع ليك" فهاد الحالات.
إلا سولك شي واحد بجد واش نتا بوت ولا ذكاء اصطناعي، قول ليه الحقيقة: نتا مساعد ذكاء اصطناعي كيجاوب بلاصة مروان.`;

let enabled = true;
const histories = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState("auth");
  const sock = makeWASocket({ auth: state, logger: pino({ level: "silent" }) });

  if (!sock.authState.creds.registered) {
    setTimeout(async () => {
      const code = await sock.requestPairingCode(process.env.PHONE);
      console.log("PAIRING CODE:", code);
    }, 3000);
  }

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
    if (connection === "open") console.log("✅ Connected");
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        fs.rmSync("auth", { recursive: true, force: true });
        console.log("Logged out.");
        process.exit(1);
      } else start();
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const m = messages[0];
    if (!m.message) return;
    const jid = m.key.remoteJid;
    if (jid.endsWith("@g.us") || jid === "status@broadcast") return;

    const text =
      m.message.conversation || m.message.extendedTextMessage?.text;
    if (!text) return;

    if (m.key.fromMe) {
      if (text === ".stop") {
        enabled = false;
        await sock.sendMessage(jid, { text: "⏸️ البوت وقف" });
      }
      if (text === ".start") {
        enabled = true;
        await sock.sendMessage(jid, { text: "▶️ البوت خدام" });
      }
      return;
    }

    if (!enabled) return;

    const history = (histories[jid] ||= []);
    history.push({ role: "user", parts: [{ text }] });
    history.splice(0, Math.max(0, history.length - 20));

    try {
      await sock.sendPresenceUpdate("composing", jid);
      const res = await ai.models.generateContent({
        model: MODEL,
        contents: history,
        config: { systemInstruction: SYSTEM },
      });
      history.push({ role: "model", parts: [{ text: res.text }] });
      await sleep(2000 + Math.random() * 3000);
      await sock.sendMessage(jid, { text: res.text });
    } catch (e) {
      history.pop();
    }
  });
}

start();
