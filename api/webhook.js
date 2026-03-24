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
