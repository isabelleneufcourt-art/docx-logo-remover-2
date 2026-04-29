// Netlify Function : send-to-make.js
// Proxy pour envoyer le texte pseudonymisé au webhook Make
// Evite le blocage CORS du navigateur

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "POST requis" }) };
  }

  const MAKE_WEBHOOK_URL = "https://hook.eu1.make.com/d8ddjdwr947ntxqi6trumfj2aomdwtts";

  try {
    const body = JSON.parse(event.body);

    const response = await fetch(MAKE_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const text = await response.text();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, make_response: text }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Erreur proxy", detail: err.message }),
    };
  }
};
