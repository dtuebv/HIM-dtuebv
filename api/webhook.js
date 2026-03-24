// ---------- HELPERS ----------

function parseItem(text) {
  const match = text.match(/(.+?)\s+(\d+)\s*(.*)/);

  if (!match) {
    return { name: text.trim(), quantity: null, unit: null };
  }

  return {
    name: match[1].trim(),
    quantity: parseInt(match[2]),
    unit: match[3] || "ชิ้น",
  };
}

function getQuickReplyMain() {
  return {
    items: [
      { type: "action", action: { type: "postback", label: "➕ เพิ่ม", data: "start_add" } },
      { type: "action", action: { type: "postback", label: "➖ ลด", data: "start_use" } },
      { type: "action", action: { type: "postback", label: "🗑 ลบ", data: "start_delete" } },
      { type: "action", action: { type: "message", label: "📦 ดูของ", text: "ของในบ้าน" } },
    ],
  };
}

async function reply(token, text, quickReply = null) {
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.LINE_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      replyToken: token,
      messages: [
        {
          type: "text",
          text,
          quickReply: quickReply || getQuickReplyMain(),
        },
      ],
    }),
  });
}

// ---------- MAIN ----------

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(200).send("OK");

    const events = req.body.events || [];

    for (let event of events) {
      const userId = event.source.userId;

      // 🔹 get user
      const userRes = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/users?line_user_id=eq.${userId}`,
        {
          headers: {
            apikey: process.env.SUPABASE_KEY,
            Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
          },
        }
      );

      const users = await userRes.json();
      const dbUserId = users[0]?.id;

      // =========================
      // 📸 IMAGE (SCAN RECEIPT)
      // =========================
      if (event.type === "message" && event.message.type === "image") {
        const messageId = event.message.id;

        const imgRes = await fetch(
          `https://api-data.line.me/v2/bot/message/${messageId}/content`,
          {
            headers: {
              Authorization: `Bearer ${process.env.LINE_TOKEN}`,
            },
          }
        );

        const buffer = await imgRes.arrayBuffer();
        const base64Image = Buffer.from(buffer).toString("base64");

        const aiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    { text: "Return ONLY JSON array [{name, quantity}] from this receipt" },
                    {
                      inlineData: {
                        mimeType: "image/jpeg",
                        data: base64Image,
                      },
                    },
                  ],
                },
              ],
            }),
          }
        );

        const aiData = await aiRes.json();

        if (!aiData.candidates) {
          await reply(event.replyToken, "AI มีปัญหา ลองใหม่อีกครั้งนะครับ");
          return;
        }

        let items = [];

        try {
          const raw = aiData.candidates[0].content.parts[0].text;
          const jsonMatch = raw.match(/\[.*\]/s);
          items = JSON.parse(jsonMatch[0]);
        } catch {
          await reply(event.replyToken, "อ่านใบเสร็จไม่สำเร็จ ลองใหม่อีกครั้งนะครับ");
          return;
        }

        await fetch(`${process.env.SUPABASE_URL}/rest/v1/pending_actions`, {
          method: "POST",
          headers: {
            apikey: process.env.SUPABASE_KEY,
            Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            user_id: dbUserId,
            action_type: "scan",
            payload: items,
          }),
        });

        let msg = `ผมเจอ ${items.length} รายการครับ:\n\n`;
        items.slice(0, 10).forEach((i) => {
          msg += `• ${i.name} ${i.quantity}\n`;
        });

        await reply(event.replyToken, msg, {
          items: [
            { type: "action", action: { type: "postback", label: "✅ เพิ่มทั้งหมด", data: "confirm_scan" } },
            { type: "action", action: { type: "postback", label: "❌ ยกเลิก", data: "cancel" } },
          ],
        });

        return;
      }

      // =========================
      // 🔘 POSTBACK
      // =========================
      if (event.type === "postback") {
        const data = event.postback.data;

        // confirm scan
        if (data === "confirm_scan") {
          const resPending = await fetch(
            `${process.env.SUPABASE_URL}/rest/v1/pending_actions?user_id=eq.${dbUserId}&action_type=eq.scan&order=created_at.desc&limit=1`,
            { headers: { apikey: process.env.SUPABASE_KEY, Authorization: `Bearer ${process.env.SUPABASE_KEY}` } }
          );

          const pending = await resPending.json();
          const items = pending[0]?.payload || [];

          for (let item of items) {
            await fetch(`${process.env.SUPABASE_URL}/rest/v1/inventories`, {
              method: "POST",
              headers: {
                apikey: process.env.SUPABASE_KEY,
                Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                user_id: dbUserId,
                product_id: null,
                quantity: item.quantity,
                unit: "ชิ้น",
              }),
            });
          }

          await reply(event.replyToken, "เพิ่มของจากใบเสร็จเรียบร้อยแล้วครับ 🎉");
          return;
        }

        if (data === "confirm") {
          const resPending = await fetch(
            `${process.env.SUPABASE_URL}/rest/v1/pending_actions?user_id=eq.${dbUserId}&order=created_at.desc&limit=1`,
            {
              headers: {
                apikey: process.env.SUPABASE_KEY,
                Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
              },
            }
          );
        
          const action = (await resPending.json())[0];
        
          if (!action || !action.payload) {
            await reply(event.replyToken, "ไม่พบข้อมูลครับ");
            return;
          }
        
          const { name, quantity, unit } = action.payload;
        
          // 🔥 ADD
          if (action.action_type === "add") {
            await fetch(`${process.env.SUPABASE_URL}/rest/v1/inventories`, {
              method: "POST",
              headers: {
                apikey: process.env.SUPABASE_KEY,
                Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                user_id: dbUserId,
                product_id: null,
                quantity,
                unit,
              }),
            });
        
            await reply(event.replyToken, `เพิ่ม "${name}" เรียบร้อยแล้วครับ ✅`);
            return;
          }
        
          // 🔥 USE
          if (action.action_type === "use") {
            await reply(event.replyToken, `ลด "${name}" เรียบร้อยแล้วครับ`);
            return;
          }
        }
        
        if (data === "start_add") {
          await fetch(`${process.env.SUPABASE_URL}/rest/v1/pending_actions`, {
            method: "POST",
            headers: {
              apikey: process.env.SUPABASE_KEY,
              Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ user_id: dbUserId, action_type: "add" }),
          });

          await reply(event.replyToken, "จะเพิ่มอะไร กี่ชิ้นครับ\nหรือส่งรูปใบเสร็จมาได้เลยครับ 📸");
          return;
        }

        if (data === "start_use") {
          await fetch(`${process.env.SUPABASE_URL}/rest/v1/pending_actions`, {
            method: "POST",
            headers: {
              apikey: process.env.SUPABASE_KEY,
              Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ user_id: dbUserId, action_type: "use" }),
          });

          await reply(event.replyToken, "จะใช้ (ลด) อะไร กี่ชิ้นครับ");
          return;
        }

        if (data === "cancel") {
          await reply(event.replyToken, "ยกเลิกเรียบร้อยครับ 👍");
          return;
        }
      }

      // =========================
      // 💬 TEXT
      // =========================
      if (event.type === "message" && event.message.type === "text") {
        const text = event.message.text;

        // view
        if (text.includes("ของในบ้าน")) {
          const invRes = await fetch(
            `${process.env.SUPABASE_URL}/rest/v1/inventories?user_id=eq.${dbUserId}&select=quantity,unit,products(name)`,
            {
              headers: {
                apikey: process.env.SUPABASE_KEY,
                Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
              },
            }
          );
          
          const items = await invRes.json();

          let msg = "📦 ของในบ้าน:\n\n";
          
          if (items.length === 0) {
            msg = "ยังไม่มีของในบ้านครับ";
          } else {
            items.forEach((i) => {
              msg += `• ${i.products?.name || "สินค้า"} — ${i.quantity} ${i.unit}\n`;
            });
          }

          await reply(event.replyToken, msg);
          return;
        }

        // mode
        const pendingRes = await fetch(
          `${process.env.SUPABASE_URL}/rest/v1/pending_actions?user_id=eq.${dbUserId}&order=created_at.desc&limit=1`,
          { headers: { apikey: process.env.SUPABASE_KEY, Authorization: `Bearer ${process.env.SUPABASE_KEY}` } }
        );

        const current = (await pendingRes.json())[0];

        if (current && (current.action_type === "add" || current.action_type === "use")) {
          const parsed = parseItem(text);

          if (!parsed.quantity) {
            await reply(event.replyToken, "ต้องใส่จำนวนด้วยนะครับ เช่น ไข่ไก่ 30 ฟอง");
            return;
          }

            // save ลง pending
            await fetch(
              `${process.env.SUPABASE_URL}/rest/v1/pending_actions?id=eq.${current.id}`,
              {
                method: "PATCH",
                headers: {
                  apikey: process.env.SUPABASE_KEY,
                  Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  payload: parsed,
                }),
              }
            );
            
            // 🔥 confirm
            await reply(
              event.replyToken,
              `${current.action_type === "add" ? "เพิ่ม" : "ใช้"} "${parsed.name}" ${parsed.quantity} ${parsed.unit} ใช่ไหมครับ`,
              {
                items: [
                  {
                    type: "action",
                    action: { type: "postback", label: "✅ ยืนยัน", data: "confirm" },
                  },
                  {
                    type: "action",
                    action: { type: "postback", label: "❌ ยกเลิก", data: "cancel" },
                  },
                ],
              }
            );
            
            return;
        }

        await reply(event.replyToken, "วันนี้ต้องการทำอะไรครับ\nหรือส่งรูปใบเสร็จมาได้เลยครับ 📸");
      }
    }

    return res.status(200).send("OK");
  } catch (err) {
    console.error(err);
    return res.status(200).send("ERROR");
  }
}
