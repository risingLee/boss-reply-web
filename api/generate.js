const https = require("https");
const crypto = require("crypto");

function getHmacSHA256(key, msg) { return crypto.createHmac("sha256", key).update(msg).digest(); }
function sha256Hex(msg) { return crypto.createHash("sha256").update(msg).digest("hex"); }

function signV3(secretId, secretKey, service, action, payload) {
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().split("T")[0];
  const contentType = "application/json; charset=utf-8";
  const canonicalHeaders = `content-type:${contentType}\nhost:hunyuan.tencentcloudapi.com\nx-tc-action:${action.toLowerCase()}\n`;
  const signedHeaders = "content-type;host;x-tc-action";
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${sha256Hex(payload)}`;
  const algorithm = "TC3-HMAC-SHA256";
  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = `${algorithm}\n${timestamp}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`;
  const secretDate = getHmacSHA256(`TC3${secretKey}`, date);
  const secretService = getHmacSHA256(secretDate, service);
  const secretSigning = getHmacSHA256(secretService, "tc3_request");
  const signature = getHmacSHA256(secretSigning, stringToSign).toString("hex");
  return {
    authorization: `${algorithm} Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    timestamp,
  };
}

function callHunyuan(prompt) {
  return new Promise((resolve, reject) => {
    const secretId = process.env.HUNYUAN_SECRET_ID;
    const secretKey = process.env.HUNYUAN_SECRET_KEY;
    if (!secretId || !secretKey) return reject(new Error("API key not configured"));
    const action = "ChatCompletions";
    const body = JSON.stringify({
      Model: "hunyuan-lite",
      Messages: [
        { Role: "system", Content: "You are a workplace communication expert. Generate professional, appropriate replies to boss/manager messages. Output ONLY plain text, no markdown formatting." },
        { Role: "user", Content: prompt },
      ],
      Temperature: 0.8, TopP: 0.9, Stream: false,
    });
    const { authorization, timestamp } = signV3(secretId, secretKey, "hunyuan", action, body);
    const req = https.request({
      hostname: "hunyuan.tencentcloudapi.com", path: "/", method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: authorization,
        "X-TC-Action": action, "X-TC-Version": "2023-09-01",
        "X-TC-Timestamp": String(timestamp), "X-TC-Region": "ap-guangzhou",
      },
    }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (json.Response?.Choices?.length > 0) resolve(json.Response.Choices[0].Message.Content);
          else if (json.Response?.Error) reject(new Error(json.Response.Error.Message));
          else reject(new Error("API error"));
        } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function cleanText(str) {
  return str
    .replace(/^#{1,4}\s*.*/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/^\s*[-*]\s*/gm, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^\s*>\s*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseResponse(text, lang) {
  const result = { stable: "", counter: "", eq: "" };
  
  if (lang === 'zh') {
    // 中文模式
    const s = text.match(/【稳住版】[：:\s]*([\s\S]*?)(?=【体面反击版】|😏|$)/);
    const c = text.match(/【体面反击版】[：:\s]*([\s\S]*?)(?=【高情商版】|🤝|$)/);
    const e = text.match(/【高情商版】[：:\s]*([\s\S]*?)$/);
    if (s) result.stable = cleanText(s[1]);
    if (c) result.counter = cleanText(c[1]);
    if (e) result.eq = cleanText(e[1]);
  } else {
    // 英文模式
    const patterns = [
      { s: /\[Safe\][：:\s]*([\s\S]*?)(?=\[Assertive\]|\[Diplomatic\]|$)/i, c: /\[Assertive\][：:\s]*([\s\S]*?)(?=\[Diplomatic\]|$)/i, e: /\[Diplomatic\][：:\s]*([\s\S]*?)$/i },
      { s: /\*?\*?Safe\*?\*?[：:\s]*([\s\S]*?)(?=\*?\*?Assertive)/i, c: /\*?\*?Assertive\*?\*?[：:\s]*([\s\S]*?)(?=\*?\*?Diplomatic)/i, e: /\*?\*?Diplomatic\*?\*?[：:\s]*([\s\S]*?)$/i },
      { s: /#{1,4}\s*Safe[：:\s]*([\s\S]*?)(?=#{1,4}\s*Assertive)/i, c: /#{1,4}\s*Assertive[：:\s]*([\s\S]*?)(?=#{1,4}\s*Diplomatic)/i, e: /#{1,4}\s*Diplomatic[：:\s]*([\s\S]*?)$/i },
    ];
    for (const pat of patterns) {
      const sm = text.match(pat.s), cm = text.match(pat.c), em = text.match(pat.e);
      if (sm && cm && em) {
        result.stable = cleanText(sm[1]);
        result.counter = cleanText(cm[1]);
        result.eq = cleanText(em[1]);
        break;
      }
    }
  }

  // Fallback
  if (!result.stable && !result.counter && !result.eq) {
    const paragraphs = text.split(/\n\s*\n/).map(p => cleanText(p)).filter(p => p.length > 10);
    if (paragraphs.length >= 3) {
      result.stable = paragraphs[0];
      result.counter = paragraphs[1];
      result.eq = paragraphs[2];
    } else {
      result.stable = result.counter = result.eq = cleanText(text);
    }
  }
  return result;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { bossText, scene, lang } = req.body || {};
  if (!bossText || !bossText.trim()) {
    return res.status(400).json({ error: lang === 'zh' ? "请输入领导的话" : "Please enter what your boss said" });
  }

  const isZh = lang === 'zh';
  const sceneMap = {
    criticized: isZh ? "被批评" : "being criticized",
    overloaded: isZh ? "被加任务" : "being assigned extra work",
    vague: isZh ? "模糊指令" : "vague instructions",
  };
  const sceneKey = scene || "criticized";
  const sceneName = sceneMap[sceneKey] || sceneMap.criticized;

  const prompt = isZh
    ? `用户会输入领导说的话，你需要生成3种不同风格的回复。

目标：
1. 不卑不亢
2. 不吃亏
3. 保持职场得体
4. 避免冲突升级

场景：${sceneName}
领导原话："${bossText.trim()}"

请严格按以下格式输出纯文本，不要任何markdown格式：

【稳住版】（安全、不出错）
{回复}

【体面反击版】（表达边界，但不冲突）
{回复}

【高情商版】（更圆滑，优先关系）
{回复}

要求：
- 每条不超过2句话
- 符合中国职场语境
- 不要过度客套，要像真人说话
- 口语化，不要书面腔
- 不要任何markdown标记`
    : `Generate 3 different reply styles to respond to your boss/manager.

Scenario: ${sceneName}
What your boss said: "${bossText.trim()}"

Output ONLY plain text in this format (no markdown, no **, no #):

[Safe] (Safe, professional, won't cause trouble)
{reply text}

[Assertive] (Sets boundaries but not confrontational)
{reply text}

[Diplomatic] (Smooth, prioritizes relationship)
{reply text}

Requirements:
- Each reply 2-3 sentences max
- Professional workplace tone
- Sound natural and human, not robotic
- No markdown formatting whatsoever`;

  try {
    const aiText = await callHunyuan(prompt);
    res.status(200).json({ success: true, data: parseResponse(aiText, lang) });
  } catch (err) {
    console.error("Generation failed:", err);
    res.status(500).json({ error: err.message || (isZh ? "生成失败" : "Generation failed") });
  }
};
