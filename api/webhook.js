// ---------- HELPERS ----------

function parseItem(text) {
  const match = text.match(/(.+?)\s+(\d+)\s*(.*)/);

  if (!match) {
    return {
      name: text.trim(),
      quantity: null,
      unit: null,
    };
  }

  return {
    name: match[1].trim(),
    quantity: parseInt(match[2]),
    unit: match[3] || "ชิ้น",
  };
}

function getModeQuickReply() {
  return {
    items: [
      {
        type: "action",
        action: { type: "postback", label: "➕ เพิ่ม", data: "start_add" },
      },
      {
        type: "action",
        action: { type: "postback", label: "➖ ลด", data: "start_use" },
      },
      {
        type: "action",
        action: { type: "postback", label: "🗑 ลบ", data: "start_delete" },
      },
      {
        type: "action",
        action: { type: "message", label: "📦 ดูของ", text: "ของในบ้าน" },
      },
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
          quickReply: quickReply || getModeQuickReply(),
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

      // ---------- POSTBACK ----------
      if (event.type === "postback") {
        const data = event.postback.data;

        // 🔥 CONFIRM SCAN (FIXED POSITION)
        if (data === "confirm_scan") {
          const resPending = await fetch(
            `${process.env.SUPABASE_URL}/rest/v1/pending_actions?user_id=eq.${dbUserId}&action_type=eq.scan&order=created_at.desc&limit=1`,
            {
              headers: {
                apikey: process.env.SUPABASE_KEY,
                Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
              },
            }
          );

          const pending = await resPending.json();

          if (pending.length === 0) {
            await reply(event.replyToken, "ไม่พบข้อมูลครับ");
            continue;
          }

          const items = pending[0].payload;

          for (let item of items) {
            const name = item.name;
            const quantity = item.quantity || 1;

            const productRes = await fetch(
              `${process.env.SUPABASE_URL}/rest/v1/products?name=eq.${encodeURIComponent(name)}`,
              {
                headers: {
                  apikey: process.env.SUPABASE_KEY,
                  Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
                },
              }
            );

            const products = await productRes.json();
            let productId;

            if (products.length > 0) {
              productId = products[0].id;
            } else {
              const createRes = await fetch(
                `${process.env.SUPABASE_URL}/rest/v1/products`,
                {
                  method: "POST",
                  headers: {
                    apikey: process.env.SUPABASE_KEY,
                    Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
                    "Content-Type": "application/json",
                    Prefer: "return=representation",
                  },
                  body: JSON.stringify({ name }),
                }
              );

              const newProduct = await createRes.json();
              productId = newProduct[0].id;
            }

            await fetch(`${process.env.SUPABASE_URL}/rest/v1/inventories`, {
              method: "POST",
              headers: {
                apikey: process.env.SUPABASE_KEY,
                Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                user_id: dbUserId,
                product_id: productId,
                quantity,
                unit: "ชิ้น",
              }),
            });
          }

          await reply(event.replyToken, "เพิ่มของจากใบเสร็จเรียบร้อยแล้วครับ 🎉");
          continue;
        }

        // 🔥 START ADD
        if (data === "start_add") {
          await fetch(`${process.env.SUPABASE_URL}/rest/v1/pending_actions`, {
            method: "POST",
            headers: {
              apikey: process.env.SUPABASE_KEY,
              Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              user_id: dbUserId,
              action_type: "add",
              payload: {},
            }),
          });

          await reply(event.replyToken, "จะเพิ่มอะไร กี่ชิ้นครับ");
          continue;
        }

        // 🔥 START USE
        if (data === "start_use") {
          await fetch(`${process.env.SUPABASE_URL}/rest/v1/pending_actions`, {
            method: "POST",
            headers: {
              apikey: process.env.SUPABASE_KEY,
              Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              user_id: dbUserId,
              action_type: "use",
              payload: {},
            }),
          });

          await reply(event.replyToken, "จะใช้ (ลด) อะไร กี่ชิ้นครับ");
          continue;
        }

        // 🔥 CANCEL
        if (data === "cancel") {
          await reply(event.replyToken, "ยกเลิกเรียบร้อยครับ 👍");
          continue;
        }
      }

      // ---------- IMAGE (SCAN) ----------
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

        const arrayBuffer = await imgRes.arrayBuffer();
        const base64Image = Buffer.from(arrayBuffer).toString("base64");

        const aiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    {
                      text: "Extract items from this receipt. Return ONLY JSON array [{name, quantity}]",
                    },
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
          await reply(event.replyToken, "AI มีปัญหานิดหน่อย ลองใหม่อีกครั้งนะครับ");
          return;
        }

        let items = [];

        try {
          const raw = aiData.candidates[0].content.parts[0].text;
          const jsonMatch = raw.match(/\[.*\]/s);

          if (!jsonMatch) throw new Error();

          items = JSON.parse(jsonMatch[0]);
        } catch (e) {
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

        let msg = "ผมเจอรายการเหล่านี้ครับ:\n\n";
        items.slice(0, 10).forEach((i) => {
          msg += `• ${i.name} ${i.quantity}\n`;
        });

        await reply(event.replyToken, msg, {
          items: [
            {
              type: "action",
              action: { type: "postback", label: "✅ เพิ่มทั้งหมด", data: "confirm_scan" },
            },
            {
              type: "action",
              action: { type: "postback", label: "❌ ยกเลิก", data: "cancel" },
            },
          ],
        });

        return;
      }

      // ---------- TEXT ----------
      if (event.type === "message" && event.message.type === "text") {
        const text = event.message.text;

        if (text.includes("ของในบ้าน")) {
          const invRes = await fetch(
            `${process.env.SUPABASE_URL}/rest/v1/inventories?user_id=eq.${dbUserId}&select=quantity,unit,products(name)`
          );

          const items = await invRes.json();

          let message = "📦 ของในบ้านตอนนี้:\n\n";

          if (items.length === 0) {
            message = "ยังไม่มีของในบ้านเลยครับ";
          } else {
            items.forEach((i) => {
              message += `• ${i.products?.name} — ${i.quantity} ${i.unit}\n`;
            });
          }

          await reply(event.replyToken, message);
          continue;
        }

        await reply(event.replyToken, "วันนี้ต้องการทำอะไรครับ");
      }
    }

    return res.status(200).send("OK");
  } catch (err) {
    console.error(err);
    return res.status(200).send("ERROR");
  }
}
