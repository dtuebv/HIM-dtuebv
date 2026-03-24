// ---------- HELPERS ----------

function parseItem(text) {
  const match = text.match(/(.+?)\s+(\d+)\s*(.*)/);

  if (!match) {
    return {
      name: text.trim(),
      quantity: 1,
      unit: "ชิ้น",
    };
  }

  return {
    name: match[1].trim(),
    quantity: parseInt(match[2]),
    unit: match[3] || "ชิ้น",
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

        const { name, quantity, unit } = pending[0].payload;

        // 🔥 ADD
        if (data === "action_add") {
          // find/create product
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
            `เพิ่ม "${name}" ${quantity} ${unit} แล้ว ✅`
          );
          continue;
        }

        // 🔥 USE
        if (data === "action_use") {
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
            await reply(event.replyToken, "ไม่มีของนี้ 😅");
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
              : `เหลือ ${newQty} ${unit}`
          );

          continue;
        }

        // ❌ CANCEL
        if (data === "cancel") {
          await reply(event.replyToken, "ยกเลิกแล้ว 👍");
          continue;
        }
      }

      // ---------- MESSAGE ----------
      if (event.type === "message" && event.message.type === "text") {
        const text = event.message.text;

        // ดูของ
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

          let message = "📦 ของในบ้าน:\n\n";

          items.forEach((i) => {
            message += `• ${i.products?.name} — ${i.quantity} ${i.unit}\n`;
          });

          await reply(event.replyToken, message);
          continue;
        }

        // 🔥 parse only (no intent)
        const parsed = parseItem(text);

        // save pending
        await fetch(`${process.env.SUPABASE_URL}/rest/v1/pending_actions`, {
          method: "POST",
          headers: {
            apikey: process.env.SUPABASE_KEY,
            Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            user_id: dbUserId,
            action_type: "unknown",
            payload: parsed,
          }),
        });

        // 🔥 ask action
        await reply(
          event.replyToken,
          `ต้องการทำอะไรกับ "${parsed.name}" ${parsed.quantity} ${parsed.unit}?`,
          {
            items: [
              {
                type: "action",
                action: {
                  type: "postback",
                  label: "➕ เพิ่ม",
                  data: "action_add",
                },
              },
              {
                type: "action",
                action: {
                  type: "postback",
                  label: "➖ ใช้",
                  data: "action_use",
                },
              },
              {
                type: "action",
                action: {
                  type: "postback",
                  label: "❌ ยกเลิก",
                  data: "cancel",
                },
              },
            ],
          }
        );
      }
    }

    return res.status(200).send("OK");
  } catch (err) {
    console.error(err);
    return res.status(200).send("ERROR");
  }
}
