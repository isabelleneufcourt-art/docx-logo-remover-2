// Netlify Function : depseudonymiser-docx.js
// Reçoit un .docx en base64 + session_id
// Récupère la table de correspondance depuis Make Data Store
// Remplace tous les placeholders dans le .docx
// Retourne le .docx final en base64

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

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "POST requis" }) };
  }

  try {
    const body = JSON.parse(event.body);
    const { docx_base64, session_id } = body;

    if (!docx_base64 || !session_id) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Champs docx_base64 et session_id requis" }),
      };
    }

    // 1. Récupérer la table de correspondance depuis Make Data Store
    const makeUrl = `https://${MAKE_ZONE}/api/v2/data-stores/${MAKE_DATASTORE_ID}/data?key=pii_${session_id}`;
    
    const makeResponse = await fetch(makeUrl, {
      headers: {
        "Authorization": `Token ${MAKE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
    });

    if (!makeResponse.ok) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ 
          error: "Session ID introuvable dans le Data Store",
          detail: `Session ID: ${session_id}`
        }),
      };
    }

    const makeData = await makeResponse.json();
    
    // Extraire la table de correspondance
    let tableCorrespondance = [];
    try {
      const record = makeData.record || makeData;
      const tableJson = record.table_json || record.data?.table_json;
      
      if (typeof tableJson === "string") {
        tableCorrespondance = JSON.parse(tableJson);
      } else if (Array.isArray(tableJson)) {
        tableCorrespondance = tableJson;
      }
    } catch (e) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Table de correspondance invalide", detail: e.message }),
      };
    }

    if (tableCorrespondance.length === 0) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: "Table de correspondance vide pour ce Session ID" }),
      };
    }

    // 2. Ouvrir le .docx
    const docxBuffer = Buffer.from(docx_base64, "base64");
    const zip = await JSZip.loadAsync(docxBuffer);

    // 3. Remplacer les placeholders dans tous les fichiers XML
    const xmlFiles = [];
    zip.forEach((relativePath) => {
      if (relativePath.match(/word\/(document|header\d*|footer\d*)\.xml$/)) {
        xmlFiles.push(relativePath);
      }
    });

    let totalRemplacement = 0;

    for (const xmlPath of xmlFiles) {
      let xmlContent = await zip.file(xmlPath).async("string");

      // Remplacer chaque placeholder par sa vraie valeur
      for (const item of tableCorrespondance) {
        const placeholder = item.placeholder || item.pseudonyme;
        const valeur = item.valeur_reelle || item.valeur_originale;
        
        if (placeholder && valeur) {
          // Echapper les caractères spéciaux regex
          const escaped = placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const regex = new RegExp(escaped, "g");
          const avant = xmlContent;
          xmlContent = xmlContent.replace(regex, valeur);
          if (xmlContent !== avant) totalRemplacement++;
        }
      }

      zip.file(xmlPath, xmlContent);
    }

    // 4. Rezipper
    const finalBuffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    const finalBase64 = finalBuffer.toString("base64");

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        session_id,
        remplacements_effectues: totalRemplacement,
        nb_placeholders: tableCorrespondance.length,
        docx_final_base64: finalBase64,
        message: `${tableCorrespondance.length} placeholders remplacés avec succès`,
      }),
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Erreur de traitement", detail: err.message }),
    };
  }
};
