// Netlify Function : send-to-depseudo.js
// Proxy vers le webhook Make de dépseudonymisation

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  const MAKE_DEPSEUDO_URL = "https://hook.eu1.make.com/4wefed7rch61rscetl4et9v286r8ex7d";

  try {
    const body = JSON.parse(event.body);

    const response = await fetch(MAKE_DEPSEUDO_URL, {
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
