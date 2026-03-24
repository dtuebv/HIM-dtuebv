function parseItem(text) {
  // ตัวอย่าง: "น้ำยาซักผ้า 2 ขวด"
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

    const body = req.body;

    console.log("BODY:", JSON.stringify(body));

    const events = body.events || [];

    for (let event of events) {
      if (event.type === "message" && event.message.type === "text") {
        const userId = event.source.userId;
        const text = event.message.text;

        const parsed = parseItem(text);
        
        if (parsed) {
          const { name, quantity, unit } = parsed;
        
          // 1. หา product
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
            // 2. create product
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
                body: JSON.stringify({
                  name: name,
                }),
              }
            );
        
            const newProduct = await createRes.json();
            productId = newProduct[0].id;
          }

            // get user from DB
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
          
          // 3. update inventory
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
              quantity: quantity,
              unit: unit,
            }),
          });
        
          // 4. reply
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
        
          return;
        }     

        // save user
        await fetch(process.env.SUPABASE_URL + "/rest/v1/users", {
          method: "POST",
          headers: {
            apikey: process.env.SUPABASE_KEY,
            Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
            "Content-Type": "application/json",
            Prefer: "resolution=merge-duplicates",
          },
          body: JSON.stringify({
            line_user_id: userId,
          }),
        });

        // reply
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
                text: `คุณพิมพ์ว่า: ${text}`,
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
