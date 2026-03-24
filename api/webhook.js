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

        // 🔥 CONFIRM
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

          const pending = await resPending.json();
          const action = pending[0];

          if (!action || !action.payload?.name) {
            await reply(event.replyToken, "ไม่พบข้อมูลครับ");
            continue;
          }

          const { name, quantity, unit } = action.payload;

          // ---------- ADD ----------
          if (action.action_type === "add") {
            let productId;

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
                unit,
              }),
            });

            await reply(
              event.replyToken,
              `เพิ่ม "${name}" ${quantity} ${unit} เรียบร้อยแล้วครับ ✅`
            );
            continue;
          }

          // ---------- USE ----------
          if (action.action_type === "use") {
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

            if (products.length === 0) {
              await reply(event.replyToken, "ไม่เจอสินค้านี้ครับ");
              continue;
            }

            const productId = products[0].id;

            const invRes = await fetch(
              `${process.env.SUPABASE_URL}/rest/v1/inventories?user_id=eq.${dbUserId}&product_id=eq.${productId}`,
              {
                headers: {
                  apikey: process.env.SUPABASE_KEY,
                  Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
                },
              }
            );

            const inv = await invRes.json();

            if (inv.length === 0) {
              await reply(event.replyToken, "ยังไม่มีของนี้ในบ้านครับ");
              continue;
            }

            const newQty = Math.max(0, inv[0].quantity - quantity);

            await fetch(
              `${process.env.SUPABASE_URL}/rest/v1/inventories?id=eq.${inv[0].id}`,
              {
                method: "PATCH",
                headers: {
                  apikey: process.env.SUPABASE_KEY,
                  Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ quantity: newQty }),
              }
            );

            await reply(
              event.replyToken,
              newQty === 0
                ? `ใช้ "${name}" แล้วหมดครับ 😅`
                : `เหลือ "${name}" ${newQty} ${unit} ครับ`
            );

            continue;
          }
        }

        // ❌ CANCEL
        if (data === "cancel") {
          await reply(event.replyToken, "ยกเลิกเรียบร้อยครับ 👍");
          continue;
        }
      }

      // ---------- MESSAGE ----------
      if (event.type === "message" && event.message.type === "text") {
        const text = event.message.text;

        // 🔥 VIEW
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

        // 🔥 check current mode
        const pendingRes = await fetch(
          `${process.env.SUPABASE_URL}/rest/v1/pending_actions?user_id=eq.${dbUserId}&order=created_at.desc&limit=1`,
          {
            headers: {
              apikey: process.env.SUPABASE_KEY,
              Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
            },
          }
        );

        const pending = await pendingRes.json();
        const current = pending[0];

        if (current && (current.action_type === "add" || current.action_type === "use")) {
          const parsed = parseItem(text);

          if (!parsed.quantity) {
            await reply(
              event.replyToken,
              "ต้องใส่จำนวนด้วยนะครับ เช่น โค้ก 2 ขวด"
            );
            continue;
          }

          await fetch(
            `${process.env.SUPABASE_URL}/rest/v1/pending_actions?id=eq.${current.id}`,
            {
              method: "PATCH",
              headers: {
                apikey: process.env.SUPABASE_KEY,
                Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ payload: parsed }),
            }
          );

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

          continue;
        }

        // 🔥 GREETING
        await reply(event.replyToken, "วันนี้ต้องการทำอะไรครับ");
      }
    }

    return res.status(200).send("OK");
  } catch (err) {
    console.error(err);
    return res.status(200).send("ERROR");
  }
}
