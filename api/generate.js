const https = require("https");
const crypto = require("crypto");

// 腾讯混元 API 签名
function getHmacSHA256(key, msg) {
  return crypto.createHmac("sha256", key).update(msg).digest();
}
function sha256Hex(msg) {
  return crypto.createHash("sha256").update(msg).digest("hex");
}
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
    if (!secretId || !secretKey) return reject(new Error("未配置密钥"));
    const action = "ChatCompletions";
    const body = JSON.stringify({
      Model: "hunyuan-lite",
      Messages: [
        { Role: "system", Content: "你是一个资深职场沟通专家，精通中国职场文化，擅长生成高情商回复。" },
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
          else reject(new Error("API返回异常"));
        } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function parseAIResponse(text) {
  const result = { stable: "", counter: "", eq: "" };
  const s = text.match(/【稳住版】[：:]*\s*([\s\S]*?)(?=【体面反击版】|😏|$)/);
  const c = text.match(/【体面反击版】[：:]*\s*([\s\S]*?)(?=【高情商版】|🤝|$)/);
  const e = text.match(/【高情商版】[：:]*\s*([\s\S]*?)$/);
  if (s) result.stable = s[1].replace(/^[（(].*?[)）]\s*/, "").trim();
  if (c) result.counter = c[1].replace(/^[（(].*?[)）]\s*/, "").trim();
  if (e) result.eq = e[1].replace(/^[（(].*?[)）]\s*/, "").trim();
  if (!result.stable && !result.counter && !result.eq) {
    const lines = text.split("\n").filter((l) => l.trim());
    if (lines.length >= 3) { result.stable = lines[0]; result.counter = lines[1]; result.eq = lines[2]; }
    else { result.stable = result.counter = result.eq = text.trim(); }
  }
  return result;
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { bossText, scene } = req.body || {};
  if (!bossText || !bossText.trim()) return res.status(400).json({ error: "请输入领导的话" });

  const prompt = `用户会输入领导说的话，你需要生成3种不同风格的回复。

目标：
1. 不卑不亢
2. 不吃亏
3. 保持职场得体
4. 避免冲突升级

场景：${scene || "被批评"}
领导原话："${bossText.trim()}"

请严格按以下格式输出：

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
- 口语化，不要书面腔`;

  try {
    const aiText = await callHunyuan(prompt);
    res.status(200).json({ success: true, data: parseAIResponse(aiText) });
  } catch (err) {
    console.error("生成失败:", err);
    res.status(500).json({ error: err.message || "生成失败" });
  }
};
