export default async function handler(req, res) {
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_KEY;
    const LINE_TOKEN = process.env.LINE_TOKEN;

    // 1. ดึง inventory ที่ใกล้หมด (<=1)
    const invRes = await fetch(
      `${SUPABASE_URL}/rest/v1/inventories?quantity=lte.1&select=quantity,unit,user_id,products(name)`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      }
    );

    const items = await invRes.json();

    // 2. loop user
    for (let item of items) {
      // หา LINE user id
      const userRes = await fetch(
        `${SUPABASE_URL}/rest/v1/users?id=eq.${item.user_id}`,
        {
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
          },
        }
      );

      const users = await userRes.json();
      const lineUserId = users[0]?.line_user_id;

      if (!lineUserId) continue;

      // 3. ส่ง push message
      await fetch("https://api.line.me/v2/bot/message/push", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LINE_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: lineUserId,
          messages: [
            {
              type: "text",
              text: `⚠️ "${item.products?.name}" เหลือ ${item.quantity} ${item.unit} แล้วนะครับ ใกล้หมดแล้ว`,
            },
          ],
        }),
      });
    }

    return res.status(200).send("OK");
  } catch (err) {
    console.error(err);
    return res.status(200).send("ERROR");
  }
}
