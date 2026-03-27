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

function getQuickReply() {
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
          quickReply: quickReply || getQuickReply(),
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
      // 📸 IMAGE (SCAN)
      // =========================
      if (event.type === "message" && event.message.type === "image") {
        await reply(event.replyToken, "ฟีเจอร์สแกนกำลังพัฒนาอยู่นะครับ 📸");
        return;
      }

      // =========================
      // 🔘 POSTBACK
      // =========================
      if (event.type === "postback") {
        const data = event.postback.data;

        // START ADD
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
            }),
          });

          await reply(event.replyToken, "จะเพิ่มอะไร กี่ชิ้นครับ");
          return;
        }

        // START USE
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
            }),
          });

          await reply(event.replyToken, "จะใช้ (ลด) อะไร กี่ชิ้นครับ");
          return;
        }

        // CANCEL
        if (data === "cancel") {
          await reply(event.replyToken, "ยกเลิกเรียบร้อยครับ 👍");
          return;
        }

        // CONFIRM
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

          if (!action?.payload) {
            await reply(event.replyToken, "ไม่พบข้อมูลครับ");
            return;
          }

          const { name, quantity, unit } = action.payload;

          // 🔥 CREATE / FIND PRODUCT
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
                product_id: productId,
                quantity,
                unit,
              }),
            });

            await reply(event.replyToken, `เพิ่ม "${name}" เรียบร้อยแล้วครับ ✅`);
            return;
          }

          // 🔥 USE
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
              return;
            }
            
            const productId = products[0].id;
            
            // 🔥 หา inventory
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
              return;
            }
            
            const currentQty = inv[0].quantity;
            const newQty = Math.max(0, currentQty - quantity);
            
            // 🔥 update quantity
            await fetch(
              `${process.env.SUPABASE_URL}/rest/v1/inventories?id=eq.${inv[0].id}`,
              {
                method: "PATCH",
                headers: {
                  apikey: process.env.SUPABASE_KEY,
                  Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  quantity: newQty,
                }),
              }
            );
            
            await reply(
              event.replyToken,
              newQty === 0
                ? `"${name}" หมดแล้วครับ`
                : `เหลือ "${name}" ${newQty} ${unit} ครับ`
            );
            
            return;
          }
        }
      }

      // =========================
      // 💬 TEXT
      // =========================
      if (event.type === "message" && event.message.type === "text") {
        const text = event.message.text;

        // VIEW
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
              msg += `• ${i.products?.name} — ${i.quantity} ${i.unit}\n`;
            });
          }

          await reply(event.replyToken, msg);
          return;
        }

        // MODE CHECK
        const pendingRes = await fetch(
          `${process.env.SUPABASE_URL}/rest/v1/pending_actions?user_id=eq.${dbUserId}&order=created_at.desc&limit=1`,
          {
            headers: {
              apikey: process.env.SUPABASE_KEY,
              Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
            },
          }
        );

        const current = (await pendingRes.json())[0];

        if (current && (current.action_type === "add" || current.action_type === "use")) {
          const parsed = parseItem(text);

          if (!parsed.quantity) {
            await reply(event.replyToken, "ต้องใส่จำนวนด้วยนะครับ เช่น ไข่ไก่ 30 ฟอง");
            return;
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
              body: JSON.stringify({
                payload: parsed,
              }),
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

          return;
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
