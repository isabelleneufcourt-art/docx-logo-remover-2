const JSZip = require("jszip");
const MAKE_API_TOKEN = process.env.MAKE_API_TOKEN;
const MAKE_DATASTORE_ID = 118525;
const MAKE_ZONE = "eu1.make.com";

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "POST requis" }) };

  try {
    const body = JSON.parse(event.body);
    const { docx_base64, session_id } = body;
    if (!docx_base64 || !session_id) return { statusCode: 400, headers, body: JSON.stringify({ error: "docx_base64 et session_id requis" }) };

    // 1. Récupérer tous les records Make et filtrer
    const makeUrl = `https://${MAKE_ZONE}/api/v2/data-stores/${MAKE_DATASTORE_ID}/data`;
    const makeResponse = await fetch(makeUrl, {
      headers: { "Authorization": `Token ${MAKE_API_TOKEN}`, "Content-Type": "application/json" },
    });

    if (!makeResponse.ok) {
      const errText = await makeResponse.text();
      return { statusCode: 500, headers, body: JSON.stringify({ error: "Erreur API Make", detail: errText }) };
    }

    const makeData = await makeResponse.json();
    const targetKey = `pii_${session_id}`;
    const records = makeData.records || makeData.data || makeData || [];
    const recordArr = Array.isArray(records) ? records : Object.values(records);
    const record = recordArr.find(r => r.key === targetKey);

    if (!record || !record.data || !record.data.table_json) {
      return { statusCode: 404, headers, body: JSON.stringify({ 
        error: "Table de correspondance vide pour ce Session ID",
        detail: `Clé: ${targetKey}`,
        disponibles: recordArr.map(r => r.key),
        raw: JSON.stringify(makeData).substring(0, 500)
      })};
    }

    // 2. Parser la table
    let table = [];
    try {
      table = JSON.parse("[" + record.data.table_json + "]");
    } catch(e) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: "Parsing JSON échoué", detail: e.message }) };
    }

    // 3. Ouvrir le .docx et remplacer
    const zip = await JSZip.loadAsync(Buffer.from(docx_base64, "base64"));
    const xmlFiles = [];
    zip.forEach(path => { if (path.match(/word\/(document|header\d*|footer\d*)\.xml$/)) xmlFiles.push(path); });

    let count = 0;
    for (const xmlPath of xmlFiles) {
      let xml = await zip.file(xmlPath).async("string");
      for (const item of table) {
        const ph = item.placeholder || item.pseudonyme || item.identifiant;
        const val = item.valeur_reelle || item.valeur_originale;
        if (ph && val) {
          const escaped = ph.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const before = xml;
          xml = xml.replace(new RegExp(escaped, "g"), val);
          if (xml !== before) count++;
        }
      }
      zip.file(xmlPath, xml);
    }

    const finalB64 = (await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } })).toString("base64");

    return { statusCode: 200, headers, body: JSON.stringify({
      success: true, session_id,
      remplacements_effectues: count,
      nb_placeholders: table.length,
      docx_final_base64: finalB64,
      message: `${table.length} placeholders remplacés avec succès`,
    })};

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Erreur", detail: err.message }) };
  }
};
