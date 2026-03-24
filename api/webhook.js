function parseItem(text) {
  const match = text.match(/(.+?)\s+(\d+)\s*(.*)/);
  if (!match) return null;

  return {
    name: match[1].trim(),
    quantity: parseInt(match[2]),
    unit: match[3] || "ชิ้น",
  };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(200).send("OK");
    }

    const events = req.body.events || [];

    for (let event of events) {
      if (event.type === "message" && event.message.type === "text") {
        const userId = event.source.userId;
        const text = event.message.text;

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

        // 🔥 CASE 1: ดูของในบ้าน
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

          let message = "📦 ของในบ้านคุณตอนนี้:\n\n";

          if (items.length === 0) {
            message = "ยังไม่มีของในบ้านเลย ลองเพิ่มของก่อนนะ 😊";
          } else {
            items.forEach((item) => {
              const name = item.products?.name || "ไม่รู้จักสินค้า";

              if (item.quantity <= 0) {
                message += `• ${name} — หมดแล้ว 😅\n`;
              } else {
                message += `• ${name} — ${item.quantity} ${item.unit}\n`;
              }
            });
          }

          await fetch("https://api.line.me/v2/bot/message/reply", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.LINE_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              replyToken: event.replyToken,
              messages: [{ type: "text", text: message }],
            }),
          });

          continue;
        }

        // 🔥 CASE 2: เพิ่มของ
        const parsed = parseItem(text);

        if (parsed) {
          const { name, quantity, unit } = parsed;

          // หา product
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

          // update inventory
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

          await fetch("https://api.line.me/v2/bot/message/reply", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.LINE_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              replyToken: event.replyToken,
              messages: [
                {
                  type: "text",
                  text: `เพิ่ม "${name}" ${quantity} ${unit} เข้า stock แล้ว 📦`,
                },
              ],
            }),
          });

          continue;
        }

        // 🔹 fallback
        await fetch("https://api.line.me/v2/bot/message/reply", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.LINE_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            replyToken: event.replyToken,
            messages: [
              {
                type: "text",
                text: "ลองพิมพ์ เช่น:\nน้ำยาซักผ้า 2 ขวด\nหรือ\nของในบ้าน",
              },
            ],
          }),
        });
      }
    }

    return res.status(200).send("OK");
  } catch (err) {
    console.error("ERROR:", err);
    return res.status(200).send("ERROR");
  }
}
