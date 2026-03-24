// ---------- HELPER ----------

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

function parseUse(text) {
  const match = text.match(/ใช้(.+?)ไป\s*(\d+)/);

  if (!match) return null;

  return {
    name: match[1].trim(),
    quantity: parseInt(match[2]),
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
          ...(quickReply && { quickReply }),
        },
      ],
    }),
  });
}

// ---------- MAIN ----------

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(200).send("OK");
    }

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

      // ---------- POSTBACK (CONFIRM) ----------
      if (event.type === "postback") {
        const data = event.postback.data;

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

        if (pending.length === 0) {
          await reply(event.replyToken, "ไม่พบรายการ 😅");
          continue;
        }

        const action = pending[0];

        // 🔥 CONFIRM ADD
        if (data === "confirm_add") {
          const { name, quantity, unit } = action.payload;

          // หา/สร้าง product
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
              unit,
            }),
          });

          await reply(
            event.replyToken,
            `เพิ่ม "${name}" ${quantity} ${unit} เรียบร้อยแล้ว ✅`
          );
          continue;
        }

        // 🔥 CONFIRM USE
        if (data === "confirm_use") {
          const { name, quantity } = action.payload;

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
            await reply(event.replyToken, "ไม่เจอสินค้า 😅");
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
            await reply(event.replyToken, "ไม่มีของนี้ในบ้าน 😅");
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
              ? `ใช้ "${name}" แล้วหมด 😅`
              : `เหลือ "${name}" ${newQty} ชิ้น`
          );

          continue;
        }
      }

      // ---------- MESSAGE ----------
      if (event.type === "message" && event.message.type === "text") {
        const text = event.message.text;

        // 🔹 ดูของ
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

          let message = "📦 ของในบ้านคุณ:\n\n";

          if (items.length === 0) {
            message = "ยังไม่มีของเลย 😊";
          } else {
            items.forEach((i) => {
              message += `• ${i.products?.name} — ${i.quantity} ${i.unit}\n`;
            });
          }

          await reply(event.replyToken, message);
          continue;
        }

        // 🔥 ใช้ของ
        const useParsed = parseUse(text);
        if (useParsed) {
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
              payload: useParsed,
            }),
          });

          await reply(
            event.replyToken,
            `จะใช้ "${useParsed.name}" ${useParsed.quantity} ใช่ไหม?`,
            {
              items: [
                {
                  type: "action",
                  action: {
                    type: "postback",
                    label: "✅ ยืนยัน",
                    data: "confirm_use",
                  },
                },
              ],
            }
          );

          continue;
        }

        // 🔥 เพิ่มของ
        const parsed = parseItem(text);

        if (parsed && !parsed.quantity) {
          await reply(event.replyToken, `จะเพิ่ม "${parsed.name}" กี่ชิ้นครับ?`);
          continue;
        }

        if (parsed) {
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
              payload: parsed,
            }),
          });

          await reply(
            event.replyToken,
            `เพิ่ม "${parsed.name}" ${parsed.quantity} ${parsed.unit} ใช่ไหม?`,
            {
              items: [
                {
                  type: "action",
                  action: {
                    type: "postback",
                    label: "✅ ยืนยัน",
                    data: "confirm_add",
                  },
                },
              ],
            }
          );

          continue;
        }

        // fallback
        await reply(
          event.replyToken,
          "ลองพิมพ์:\nน้ำยาซักผ้า 2 ขวด\nใช้โค้กไป 1\nของในบ้าน"
        );
      }
    }

    return res.status(200).send("OK");
  } catch (err) {
    console.error(err);
    return res.status(200).send("ERROR");
  }
}
